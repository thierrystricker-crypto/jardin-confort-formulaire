-- ─────────────────────────────────────────────────────────────────────────────
-- Chat Jardi — statistiques d'utilisation + échanges ThunderAI dans l'historique
-- 27.08.2026 (soir) — appliqué sur llkyzspixrbtoprtmvoh (migration
-- `jardi_usage_et_thunderai`). Trace conservée ici pour le dépôt.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Une ligne par requête au modèle (chat du dashboard ET façade ThunderAI).
--    Les tokens viennent des événements `message_start` / `message_delta` du
--    flux Anthropic, comptés au passage par les routes — la réponse au
--    navigateur n'est ni retardée ni modifiée. RLS sans policy : service key.
create table if not exists public.jardi_usage (
  id                    bigint generated always as identity primary key,
  cree_le               timestamptz not null default now(),
  source                text not null check (source in ('chat', 'thunderai')),
  auteur                text,
  modele                text,
  conversation_id       uuid,
  tokens_entree         integer not null default 0,
  tokens_sortie         integer not null default 0,
  tokens_cache_lecture  integer not null default 0,
  tokens_cache_creation integer not null default 0,
  nb_outils             integer not null default 0,
  duree_ms              integer,
  stop_reason           text
);
comment on table public.jardi_usage is
  'Une ligne par requête Jardi (chat dashboard ou façade ThunderAI) : tokens, outils, durée. Alimentée par les routes, jamais à la main. Commence le 27.08.2026.';
alter table public.jardi_usage enable row level security;
create index if not exists jardi_usage_cree_le on public.jardi_usage (cree_le desc);

-- 2. Résumé pour le panneau 📊 : totaux de la période et du jour (Europe/Zurich),
--    puis ventilation par auteur, par jour et par source. Un seul appel.
create or replace function public.jardi_usage_resume(p_jours int default 30)
returns jsonb
language sql
stable
as $$
  with base as (
    select *,
           (cree_le at time zone 'Europe/Zurich')::date as jour
      from public.jardi_usage
     where cree_le >= now() - make_interval(days => greatest(1, least(coalesce(p_jours, 30), 365)))
  ),
  aujourdhui as (
    select * from base where jour = (now() at time zone 'Europe/Zurich')::date
  )
  select jsonb_build_object(
    'periode_jours', greatest(1, least(coalesce(p_jours, 30), 365)),
    'depuis', (select min(cree_le) from public.jardi_usage),
    'total', (select jsonb_build_object(
        'requetes', count(*),
        'entree', coalesce(sum(tokens_entree), 0),
        'sortie', coalesce(sum(tokens_sortie), 0),
        'cache_lecture', coalesce(sum(tokens_cache_lecture), 0),
        'cache_creation', coalesce(sum(tokens_cache_creation), 0),
        'outils', coalesce(sum(nb_outils), 0),
        'duree_moy_ms', coalesce(round(avg(duree_ms)), 0)
      ) from base),
    'aujourdhui', (select jsonb_build_object(
        'requetes', count(*),
        'entree', coalesce(sum(tokens_entree), 0),
        'sortie', coalesce(sum(tokens_sortie), 0),
        'cache_lecture', coalesce(sum(tokens_cache_lecture), 0),
        'cache_creation', coalesce(sum(tokens_cache_creation), 0),
        'outils', coalesce(sum(nb_outils), 0)
      ) from aujourdhui),
    'par_auteur', (select coalesce(jsonb_agg(jsonb_build_object(
        'auteur', auteur, 'requetes', n, 'entree', e, 'sortie', s,
        'cache_lecture', cl, 'cache_creation', cc, 'outils', o) order by n desc), '[]'::jsonb)
      from (select auteur, count(*) n, sum(tokens_entree) e, sum(tokens_sortie) s,
                   sum(tokens_cache_lecture) cl, sum(tokens_cache_creation) cc, sum(nb_outils) o
              from base group by auteur) x),
    'par_jour', (select coalesce(jsonb_agg(jsonb_build_object(
        'jour', jour, 'requetes', n, 'entree', e, 'sortie', s,
        'cache_lecture', cl, 'cache_creation', cc) order by jour), '[]'::jsonb)
      from (select jour, count(*) n, sum(tokens_entree) e, sum(tokens_sortie) s,
                   sum(tokens_cache_lecture) cl, sum(tokens_cache_creation) cc
              from base group by jour) x),
    'par_source', (select coalesce(jsonb_agg(jsonb_build_object(
        'source', source, 'requetes', n, 'entree', e, 'sortie', s,
        'cache_lecture', cl, 'cache_creation', cc) order by n desc), '[]'::jsonb)
      from (select source, count(*) n, sum(tokens_entree) e, sum(tokens_sortie) s,
                   sum(tokens_cache_lecture) cl, sum(tokens_cache_creation) cc
              from base group by source) x)
  );
$$;
revoke execute on function public.jardi_usage_resume(int) from anon, authenticated;

-- 3. Liste / recherche v2 : les échanges ThunderAI (table `thunderai_echanges`,
--    purge 60 j) apparaissent dans le même historique, avec une colonne
--    `source`. p_source : 'jardi' (défaut) | 'thunderai' | 'tous'.
--    Un échange ThunderAI n'a pas d'auteur : un filtre par auteur l'exclut.
drop function if exists public.jardi_conversations_lister(text, text, int);

create or replace function public.jardi_conversations_lister(
  p_q      text default null,
  p_auteur text default null,
  p_limite int  default 200,
  p_source text default 'jardi'
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
  extrait     text,
  source      text
)
language plpgsql
stable
as $$
declare
  mots     text[];
  patterns text[];
  src      text := coalesce(nullif(p_source, ''), 'jardi');
begin
  mots := array_remove(
    regexp_split_to_array(lower(unaccent(coalesce(p_q, ''))), '\s+'), '');
  select coalesce(array_agg('%' || m || '%'), '{}') into patterns from unnest(mots) m;

  return query
  select * from (
    select
      c.id,
      c.titre,
      c.auteur,
      c.created_at,
      c.updated_at,
      jsonb_array_length(c.messages)::int as nb_messages,
      left(coalesce((select m->>'content'
                     from jsonb_array_elements(c.messages) with ordinality as t(m, i)
                     where m->>'role' = 'user' and coalesce(m->>'content', '') <> ''
                     order by i limit 1), ''), 400) as question,
      left(coalesce((select m->>'content'
                     from jsonb_array_elements(c.messages) with ordinality as t(m, i)
                     where m->>'role' = 'assistant' and coalesce(m->>'content', '') <> ''
                     order by i limit 1), ''), 400) as reponse,
      (select array_agg(distinct o)
         from jsonb_array_elements(c.messages) m,
              jsonb_array_elements_text(coalesce(m->'outils', '[]'::jsonb)) o) as outils,
      case when cardinality(mots) > 0
           then public.jardi_conv_extrait(c.messages, mots[1])
           else null end as extrait,
      'jardi'::text as source
    from public.claude_conversations c
    where src in ('jardi', 'tous')
      and (p_auteur is null or p_auteur = '' or c.auteur = p_auteur)
      and (cardinality(patterns) = 0 or c.texte like all (patterns))

    union all

    select
      t.id,
      left(regexp_replace(coalesce(t.question, ''), '\s+', ' ', 'g'), 80) as titre,
      null::text as auteur,
      t.cree_le,
      t.cree_le,
      2 as nb_messages,
      left(coalesce(t.question, ''), 400),
      left(coalesce(t.reponse, ''), 400),
      null::text[],
      case when cardinality(mots) > 0
           then public.jardi_conv_extrait(
                  jsonb_build_array(jsonb_build_object('content', t.question),
                                    jsonb_build_object('content', t.reponse)),
                  mots[1])
           else null end,
      'thunderai'::text
    from public.thunderai_echanges t
    where src in ('thunderai', 'tous')
      and (p_auteur is null or p_auteur = '')
      and (cardinality(patterns) = 0
           or lower(unaccent(coalesce(t.question, '') || ' ' || coalesce(t.reponse, ''))) like all (patterns))
  ) u
  order by u.updated_at desc
  limit greatest(1, least(coalesce(p_limite, 200), 500));
end;
$$;
revoke execute on function public.jardi_conversations_lister(text, text, int, text) from anon, authenticated;
