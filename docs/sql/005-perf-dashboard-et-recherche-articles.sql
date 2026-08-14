-- ═══════════════════════════════════════════════════════════════════════
--  005 — Performance du dashboard + recherche par article
--  Appliqué en production le 14.08.2026
--
--  Contexte : le dashboard mettait plusieurs secondes à s'afficher, et le
--  délai augmentait à chaque nouvelle commande. Mesure à 1064 offres :
--    - lecture de la vue offres_dashboard ................  10 ms
--    - extraction de data->>'reference' sur la table offres  3051 ms  ← le coupable
--
--  Le JSONB `data` est stocké hors-ligne (TOAST). Extraire ne serait-ce
--  qu'une chaîne de caractères oblige Postgres à décompresser l'intégralité
--  des offres — ~29 Mo — pour en tirer 724 références. La colonne
--  offres.reference existait déjà et contenait la même chose.
--
--  Ce script est idempotent : il peut être rejoué sans dommage.
-- ═══════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────
-- 1) offres.reference : backfill + maintien automatique
-- ─────────────────────────────────────────────────────────────────────

-- Backfill : le JSONB fait foi (c'est ce que le dashboard affichait).
-- 3 lignes étaient désynchronisées sur 1064.
update offres o
set reference = nullif(trim(o.data->>'reference'), '')
where coalesce(nullif(trim(coalesce(o.reference, '')), ''), '')
      is distinct from coalesce(nullif(trim(coalesce(o.data->>'reference', '')), ''), '');

-- Trigger de synchro :
--   - INSERT : la colonne est remplie depuis le JSON si elle est vide
--   - UPDATE : uniquement si `data` a réellement changé, pour ne jamais
--     écraser une écriture faite directement sur la colonne
create or replace function offres_sync_reference()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.reference is null and new.data ? 'reference' then
      new.reference := nullif(trim(new.data->>'reference'), '');
    end if;
  elsif new.data is distinct from old.data and (new.data ? 'reference') then
    new.reference := nullif(trim(new.data->>'reference'), '');
  end if;
  return new;
end;
$$;

revoke execute on function offres_sync_reference() from public, anon, authenticated;

drop trigger if exists trg_offres_sync_reference on offres;
create trigger trg_offres_sync_reference
before insert or update on offres
for each row execute function offres_sync_reference();


-- ─────────────────────────────────────────────────────────────────────
-- 2) Vue offres_dashboard : + reference, - colonnes jamais affichées
--    398 ko → 252 ko transférés. create or replace ne sait pas retirer
--    de colonnes → drop + create.
-- ─────────────────────────────────────────────────────────────────────

drop view if exists offres_dashboard;

create view offres_dashboard
with (security_invoker = on)
as
select
  id, slug, type_document,
  numero_offre, numero_commande, offre_origine, numero_affiche,
  statut, date_document, reference, commercial,
  client_societe, client_nom, client_prenom, client_email, client_ville,
  total_ttc, nb_articles, probabilite,
  date_derniere_relance, nb_relances,
  created_at, updated_at
from offres;

grant select, insert, update, delete, truncate, references, trigger
  on offres_dashboard to anon, authenticated, service_role;


-- ─────────────────────────────────────────────────────────────────────
-- 3) offres_articles : les lignes d'articles à plat, pour répondre à
--    « quelles offres / commandes contiennent tel article ? »
-- ─────────────────────────────────────────────────────────────────────

create extension if not exists pg_trgm;

create table if not exists offres_articles (
  offre_id      bigint  not null references offres(id) on delete cascade,
  position      int     not null,
  sku           text,
  titre         text,
  qty           numeric,
  prix_unitaire numeric,
  primary key (offre_id, position)
);

comment on table offres_articles is
  'Lignes d''articles extraites de offres.data->''lines''. Alimentée automatiquement par trigger — ne jamais écrire dedans à la main.';

-- Normalisation accents + casse, immutable donc indexable
create or replace function jc_norm(t text)
returns text
language sql
immutable
parallel safe
set search_path = public, extensions
as $$
  select lower(unaccent('unaccent'::regdictionary, coalesce(t, '')));
$$;

-- Colonne de recherche calculée à l'écriture, indexée en trigramme
alter table offres_articles
  add column if not exists recherche text
  generated always as (jc_norm(coalesce(sku, '') || ' ' || coalesce(titre, ''))) stored;

create index if not exists idx_offres_articles_sku
  on offres_articles (upper(sku));
create index if not exists idx_offres_articles_offre
  on offres_articles (offre_id);
create index if not exists idx_offres_articles_recherche_trgm
  on offres_articles using gin (recherche gin_trgm_ops);

-- Synchronisation depuis offres.data->'lines'
create or replace function offres_articles_sync()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  delete from offres_articles where offre_id = new.id;

  insert into offres_articles (offre_id, position, sku, titre, qty, prix_unitaire)
  select
    new.id,
    (l.ord)::int,
    nullif(trim(l.val->>'sku'), ''),
    nullif(trim(l.val->>'title'), ''),
    case when (l.val->>'qty')       ~ '^-?[0-9]+(\.[0-9]+)?$' then (l.val->>'qty')::numeric end,
    case when (l.val->>'unitPrice') ~ '^-?[0-9]+(\.[0-9]+)?$' then (l.val->>'unitPrice')::numeric end
  from jsonb_array_elements(
         case when jsonb_typeof(new.data->'lines') = 'array'
              then new.data->'lines'
              else '[]'::jsonb end
       ) with ordinality as l(val, ord)
  where coalesce(l.val->>'type', '') not in ('comment', 'media')
    and (nullif(trim(l.val->>'sku'), '') is not null
         or nullif(trim(l.val->>'title'), '') is not null);

  return null;
end;
$$;

revoke execute on function offres_articles_sync() from public, anon, authenticated;

drop trigger if exists trg_offres_articles_sync on offres;
create trigger trg_offres_articles_sync
after insert or update of data on offres
for each row execute function offres_articles_sync();

-- Backfill de l'existant (3281 lignes sur 1054 dossiers au 14.08.2026)
insert into offres_articles (offre_id, position, sku, titre, qty, prix_unitaire)
select
  o.id,
  (l.ord)::int,
  nullif(trim(l.val->>'sku'), ''),
  nullif(trim(l.val->>'title'), ''),
  case when (l.val->>'qty')       ~ '^-?[0-9]+(\.[0-9]+)?$' then (l.val->>'qty')::numeric end,
  case when (l.val->>'unitPrice') ~ '^-?[0-9]+(\.[0-9]+)?$' then (l.val->>'unitPrice')::numeric end
from offres o,
     lateral jsonb_array_elements(
       case when jsonb_typeof(o.data->'lines') = 'array'
            then o.data->'lines'
            else '[]'::jsonb end
     ) with ordinality as l(val, ord)
where coalesce(l.val->>'type', '') not in ('comment', 'media')
  and (nullif(trim(l.val->>'sku'), '') is not null
       or nullif(trim(l.val->>'title'), '') is not null)
on conflict (offre_id, position) do nothing;

alter table offres_articles enable row level security;
grant select on offres_articles to anon, authenticated, service_role;


-- ─────────────────────────────────────────────────────────────────────
-- 4) Recherche : tous les mots doivent se trouver dans la MÊME ligne
--    d'article (n° d'article ou libellé), ordre libre, accents ignorés.
--    Appelée par GET /api/dashboard/articles?q=…
-- ─────────────────────────────────────────────────────────────────────

create or replace function offres_par_article(q text)
returns table (offre_id bigint, articles text)
language sql
stable
set search_path = public
as $$
  with mots as (
    select array_agg('%' || m || '%') as patterns
    from unnest(string_to_array(jc_norm(trim(q)), ' ')) as m
    where length(m) >= 2
  )
  select
    a.offre_id,
    string_agg(
      distinct coalesce(nullif(a.sku, '') || ' · ', '') || coalesce(a.titre, ''),
      ' | '
    ) as articles
  from offres_articles a, mots
  where mots.patterns is not null
    and a.recherche like all (mots.patterns)
  group by a.offre_id;
$$;

grant execute on function offres_par_article(text) to anon, authenticated, service_role;


-- ─────────────────────────────────────────────────────────────────────
-- Contrôles rapides
-- ─────────────────────────────────────────────────────────────────────
-- select count(*) from offres_articles;                    -- ~3281
-- explain analyze select * from offres_dashboard order by created_at desc;  -- ~6 ms
-- explain analyze select * from offres_par_article('tucson');               -- ~7 ms
