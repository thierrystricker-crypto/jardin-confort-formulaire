-- docs/sql/034-regler-planche.sql
-- Planche couleurs, chantier « réglages après coup et décor » (13.10.2026).
-- RPC regler_planche : change le réglage d'affichage de la planche d'une offre
-- ou d'une commande DEPUIS LE DASHBOARD, et le TRACE dans `corrections`.
--
-- Pourquoi une RPC plutôt que POST /api/corrections :
--   • une seule transaction : le réglage et sa trace sont écrits ensemble, ou
--     aucun des deux (pas de rollback applicatif à la main) ;
--   • FUSION jsonb : seule la clé data.moodboard est touchée, et à l'intérieur
--     seules affichage / actif / mode / sens. Jamais `data` en bloc
--     (doc 04 §8 : un jsonb écrit en bloc efface ce que l'appelant ne connaît
--     pas) ;
--   • aucune régénération de PDF : le PDF se régénère quand quelqu'un
--     l'ouvre depuis le dashboard. Le PDF initial archivé d'une commande
--     (commandes/<slug>_initial.pdf) n'est jamais touché.
--
-- Règles :
--   • offre SIGNÉE (Offre + statut Convertie ou Acceptée) : REFUS. C'est la
--     preuve contractuelle ; la planche se règle sur la commande née de la
--     signature, dont le PDF est celui que voit le client.
--   • offre non signée et commande : écriture + trace.
--   • affichage = "aucune" | "planche" | "planche-decor" ; `actif` est
--     recopié (actif = affichage <> 'aucune') pour rester compatible avec le
--     code et les documents antérieurs.
--   • aucun changement réel → rien n'est écrit, aucune trace.
--
-- Aucune colonne ajoutée : les 5 RPC du connecteur ne sont pas concernées.
-- Triggers de offres déclenchés par l'UPDATE (relevé du 13.10.2026) :
-- offres_updated_at, trg_offres_sync_reference, trg_offres_articles_sync
-- (lines inchangées, donc sans effet). offres_sync_suivi_livraison ne porte
-- que sur statut_livraison : non déclenché.
--
-- À exécuter dans le SQL Editor Supabase (projet llkyzspixrbtoprtmvoh).

create or replace function public.regler_planche(
  p_slug         text,
  p_affichage    text,
  p_mode         text,
  p_sens         text,
  p_corrected_by text,
  p_reason       text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_offre   record;
  v_mb      jsonb;
  v_old_aff text;
  v_old_mod text;
  v_old_sen text;
  v_changes jsonb := '{}'::jsonb;
  v_type    text;
  v_numero  text;
  v_corr_id uuid;
begin
  -- Contrôles des paramètres
  if p_affichage is null or p_affichage not in ('aucune', 'planche', 'planche-decor') then
    raise exception 'affichage invalide : %', p_affichage;
  end if;
  if p_mode is null or p_mode not in ('poids', 'degrade') then
    raise exception 'mode invalide : %', p_mode;
  end if;
  if p_sens is null or p_sens not in ('clair-fonce', 'fonce-clair') then
    raise exception 'sens invalide : %', p_sens;
  end if;
  if length(btrim(coalesce(p_corrected_by, ''))) < 2 then
    raise exception 'corrected_by requis (au moins 2 caractères)';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'raison requise (au moins 5 caractères)';
  end if;

  -- Document, verrouillé pour la durée de la transaction
  select id, slug, type_document, statut, numero_offre, numero_commande, data
    into v_offre
    from public.offres
   where slug = p_slug
   for update;

  if not found then
    raise exception 'document introuvable : %', p_slug;
  end if;

  if v_offre.type_document = 'Offre' and v_offre.statut in ('Convertie', 'Acceptée') then
    raise exception 'offre signée : la planche se règle sur la commande %', coalesce(v_offre.numero_commande, '');
  end if;

  -- Réglages actuels (compatibilité : sans « affichage », actif décide)
  v_mb := case when jsonb_typeof(v_offre.data->'moodboard') = 'object'
               then v_offre.data->'moodboard' else '{}'::jsonb end;
  v_old_aff := coalesce(
    case when v_mb->>'affichage' in ('aucune', 'planche', 'planche-decor') then v_mb->>'affichage' end,
    case when v_mb->>'actif' = 'true' then 'planche' else 'aucune' end
  );
  v_old_mod := case when v_mb->>'mode' = 'degrade' then 'degrade' else 'poids' end;
  v_old_sen := case when v_mb->>'sens' = 'fonce-clair' then 'fonce-clair' else 'clair-fonce' end;

  if v_old_aff <> p_affichage then
    v_changes := v_changes || jsonb_build_object('moodboard.affichage', jsonb_build_object('old', v_old_aff, 'new', p_affichage));
  end if;
  if v_old_mod <> p_mode then
    v_changes := v_changes || jsonb_build_object('moodboard.mode', jsonb_build_object('old', v_old_mod, 'new', p_mode));
  end if;
  if v_old_sen <> p_sens then
    v_changes := v_changes || jsonb_build_object('moodboard.sens', jsonb_build_object('old', v_old_sen, 'new', p_sens));
  end if;

  if v_changes = '{}'::jsonb then
    return jsonb_build_object('changed', false);
  end if;

  -- Écriture : FUSION dans data.moodboard, rien d'autre
  update public.offres
     set data = jsonb_set(
                  coalesce(data, '{}'::jsonb),
                  '{moodboard}',
                  v_mb || jsonb_build_object(
                    'affichage', p_affichage,
                    'actif',     p_affichage <> 'aucune',
                    'mode',      p_mode,
                    'sens',      p_sens
                  ),
                  true
                )
   where id = v_offre.id;

  -- Trace, même convention que POST /api/corrections
  v_type   := case when v_offre.type_document = 'Commande' then 'commande' else 'offre' end;
  v_numero := case when v_type = 'commande'
                   then coalesce(v_offre.numero_commande, v_offre.numero_offre, v_offre.slug)
                   else coalesce(v_offre.numero_offre, v_offre.slug) end;

  insert into public.corrections (entity_type, entity_id, entity_slug, entity_numero, corrected_by, fields_changed, reason)
  values (v_type, v_offre.id, v_offre.slug, v_numero, btrim(p_corrected_by), v_changes, btrim(p_reason))
  returning id into v_corr_id;

  return jsonb_build_object('changed', true, 'correction_id', v_corr_id, 'fields_changed', v_changes);
end;
$$;

comment on function public.regler_planche(text, text, text, text, text, text) is
  'Planche couleurs (jardin-confort-formulaire) : règle data.moodboard d''une offre non signée ou d''une commande, par fusion jsonb, et trace dans corrections. Refuse une offre signée. Voir docs/sql/034.';

-- Écriture : réservée au serveur (route /api/offres/[slug]/planche, service_role).
revoke all on function public.regler_planche(text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.regler_planche(text, text, text, text, text, text) to service_role;

-- Contrôles après exécution (lecture seule) :
-- select proname, prosecdef from pg_proc where proname = 'regler_planche';
-- Le test d'écriture se fait depuis la preview, sur CMD-80666 uniquement.
