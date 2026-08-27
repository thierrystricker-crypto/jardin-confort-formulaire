-- ─────────────────────────────────────────────────────────────────────────────
-- Chat Jardi — historique enrichi, recherche, classement par utilisateur
-- 27.08.2026 — appliqué sur le projet llkyzspixrbtoprtmvoh (migration
-- `jardi_conversations_recherche`). Trace conservée ici pour le dépôt.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Auteurs normalisés. Avant : champ libre hérité de « corrections-author »
--    (thierry / TS / brice c / Michel / Fabian) et 49 conversations sans auteur.
--    Désormais l'UI impose une liste fermée : Thierry, Michel, Brice, Fabian,
--    Sabrina, Alejandro.
update public.claude_conversations set auteur = 'Thierry' where lower(auteur) in ('thierry', 'ts');
update public.claude_conversations set auteur = 'Brice'   where lower(auteur) like 'brice%';
update public.claude_conversations set auteur = 'Michel'  where lower(auteur) = 'michel';
update public.claude_conversations set auteur = 'Fabian'  where lower(auteur) = 'fabian';

-- 2. Colonne `texte` : titre + tous les contenus, minuscules et sans accents,
--    maintenue par trigger. C'est LA surface de recherche (index trigram).
alter table public.claude_conversations add column if not exists texte text;

create or replace function public.jardi_conv_texte(p_titre text, p_messages jsonb)
returns text
language sql
stable
as $$
  select lower(unaccent(
    coalesce(p_titre, '') || ' ' ||
    coalesce((select string_agg(coalesce(m->>'content', ''), ' ')
              from jsonb_array_elements(coalesce(p_messages, '[]'::jsonb)) m), '')
  ));
$$;

create or replace function public.jardi_conv_maj_texte()
returns trigger
language plpgsql
as $$
begin
  new.texte := public.jardi_conv_texte(new.titre, new.messages);
  return new;
end;
$$;

drop trigger if exists trg_claude_conv_texte on public.claude_conversations;
create trigger trg_claude_conv_texte
  before insert or update of titre, messages on public.claude_conversations
  for each row execute function public.jardi_conv_maj_texte();

update public.claude_conversations set texte = public.jardi_conv_texte(titre, messages);

create index if not exists claude_conv_texte_trgm
  on public.claude_conversations using gin (texte gin_trgm_ops);
create index if not exists claude_conv_auteur_maj
  on public.claude_conversations (auteur, updated_at desc);

-- 3. Extrait autour du premier mot cherché (texte ORIGINAL, accents conservés).
--    L'offset est calculé sur la version normalisée : unaccent conserve la
--    longueur sauf ligatures rares (æ, œ) — décalage d'un caractère au pire.
create or replace function public.jardi_conv_extrait(p_messages jsonb, p_mot text)
returns text
language plpgsql
stable
as $$
declare
  brut text;
  norm text;
  pos  int;
  deb  int;
  lng  int := 170;
begin
  select string_agg(coalesce(m->>'content', ''), ' · ')
    into brut
    from jsonb_array_elements(coalesce(p_messages, '[]'::jsonb)) m;
  if brut is null or p_mot is null or p_mot = '' then
    return null;
  end if;
  norm := lower(unaccent(brut));
  pos  := position(p_mot in norm);
  if pos = 0 then
    return null;
  end if;
  deb := greatest(1, pos - 60);
  return (case when deb > 1 then '…' else '' end)
      || regexp_replace(substr(brut, deb, lng), '\s+', ' ', 'g')
      || (case when deb + lng < length(brut) then '…' else '' end);
end;
$$;

-- 4. Liste / recherche. Chaque ligne porte de quoi faire un VRAI aperçu :
--    question complète (400 car.), début de la première réponse, nombre de
--    messages, outils utilisés, extrait autour du mot cherché.
--    Recherche : tous les mots doivent être présents (ET), sans accents ni casse.
create or replace function public.jardi_conversations_lister(
  p_q      text default null,
  p_auteur text default null,
  p_limite int  default 200
)
returns table (
  id          uuid,
  titre       text,
  auteur      text,
  created_at  timestamptz,
  updated_at  timestamptz,
  nb_messages int,
  question    text,
  reponse     text,
  outils      text[],
  extrait     text
)
language plpgsql
stable
as $$
declare
  mots     text[];
  patterns text[];
begin
  mots := array_remove(
    regexp_split_to_array(lower(unaccent(coalesce(p_q, ''))), '\s+'), '');
  select coalesce(array_agg('%' || m || '%'), '{}') into patterns from unnest(mots) m;

  return query
  select
    c.id,
    c.titre,
    c.auteur,
    c.created_at,
    c.updated_at,
    jsonb_array_length(c.messages)::int,
    left(coalesce((select m->>'content'
                   from jsonb_array_elements(c.messages) with ordinality as t(m, i)
                   where m->>'role' = 'user' and coalesce(m->>'content', '') <> ''
                   order by i limit 1), ''), 400),
    left(coalesce((select m->>'content'
                   from jsonb_array_elements(c.messages) with ordinality as t(m, i)
                   where m->>'role' = 'assistant' and coalesce(m->>'content', '') <> ''
                   order by i limit 1), ''), 400),
    (select array_agg(distinct o)
       from jsonb_array_elements(c.messages) m,
            jsonb_array_elements_text(coalesce(m->'outils', '[]'::jsonb)) o),
    case when cardinality(mots) > 0
         then public.jardi_conv_extrait(c.messages, mots[1])
         else null end
  from public.claude_conversations c
  where (p_auteur is null or p_auteur = '' or c.auteur = p_auteur)
    and (cardinality(patterns) = 0 or c.texte like all (patterns))
  order by c.updated_at desc
  limit greatest(1, least(coalesce(p_limite, 200), 500));
end;
$$;

-- Service key seulement (comme la table : RLS sans policy).
revoke execute on function public.jardi_conversations_lister(text, text, int) from anon, authenticated;
revoke execute on function public.jardi_conv_extrait(jsonb, text) from anon, authenticated;
revoke execute on function public.jardi_conv_texte(text, jsonb) from anon, authenticated;
