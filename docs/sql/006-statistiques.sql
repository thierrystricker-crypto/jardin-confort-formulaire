-- ═══════════════════════════════════════════════════════════════════════
--  006 — Socle des statistiques (/dashboard/statistiques)
--  Appliqué en production le 14.08.2026
--
--  Deux sources de vente qui ne se recoupent pas (aucun numéro commun) :
--    'app'     → offres.type_document = 'Commande'  (depuis 05.05.2026,
--                avec le conseiller, panier moyen ~2300 CHF, 358 commandes)
--    'shopify' → commandes_shopify                  (depuis 2021, web +
--                caisse magasin, sans conseiller, panier ~230 CHF, 11'879)
--
--  Conséquences assumées :
--    • le classement par conseiller n'existe que pour la source 'app'
--    • la comparaison à l'an dernier n'a de base que pour 'shopify'
--
--  Ce script est idempotent.
-- ═══════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────
-- 1) Référentiel des marques
--    Un libellé d'article catalogue commence toujours par sa marque.
--    Une marque peut avoir plusieurs préfixes (variantes, fautes).
--    Après toute modification de cette table : select recalculer_marques();
-- ─────────────────────────────────────────────────────────────────────

create table if not exists marques (
  prefixe text primary key,   -- normalisé : minuscules, sans accents
  nom     text not null       -- nom canonique affiché
);

comment on table marques is
  'Préfixes de libellés → marque. Après modification, appeler recalculer_marques().';

-- Seed depuis la bibliothèque de logos existante…
insert into marques (prefixe, nom)
select jc_norm(name), name from brand_logos
on conflict (prefixe) do nothing;

update marques set nom = 'Fermob' where nom = 'fermob';
update marques set nom = 'Fatboy' where nom = 'fatboy';

-- …puis les marques repérées dans l'historique réel des ventes.
insert into marques (prefixe, nom) values
  ('royal botania',       'Royal Botania'),
  ('royal garden',        'Royal Garden'),
  ('platinum aerocover',  'Platinum AeroCover'),
  ('plantinum aerocover', 'Platinum AeroCover'),
  ('aerocover',           'Platinum AeroCover'),
  ('sacs de sable aerocover', 'Platinum AeroCover'),
  ('emu', 'Emu'), ('zebra', 'Zebra'), ('lafuma', 'Lafuma'), ('houe', 'Houe'),
  ('arolla', 'Arolla'), ('diphano', 'Diphano'), ('hofats', 'Höfats'),
  ('nardi', 'Nardi'), ('solpuri', 'Solpuri'), ('keter', 'Keter'),
  ('blaser', 'Blaser + Troesch'), ('knirps', 'Knirps'), ('elefanto', 'Elefanto'),
  ('delschen', 'Delschen'), ('heatsail', 'Heatsail'), ('tria', 'Tria'),
  ('golden care', 'Golden Care'), ('starbrite', 'Starbrite'), ('hunn', 'Hunn'),
  ('dickson', 'Dickson'), ('blomus', 'Blomus'), ('powerflame', 'PowerFlame'),
  ('lotusgrill', 'LotusGrill'), ('blim plus', 'Blim Plus'),
  ('imagilights', 'Imagilights'), ('videx', 'Videx'), ('sifas', 'Sifas'),
  ('stockli', 'Stöckli'), ('maiori', 'Maiori'), ('ip44.de', 'IP44.DE'),
  ('leds c4', 'LEDS C4'), ('tiger fire', 'Tiger Fire'),
  -- Lignes qui ne sont pas des produits
  ('frais', 'Frais & services'), ('participation', 'Frais & services'),
  ('forfait', 'Frais & services'), ('carte cadeau', 'Frais & services'),
  ('carte-cadeau', 'Frais & services'), ('bon cadeau', 'Frais & services'),
  ('custom sale', 'Frais & services'), ('1 arbre', 'Frais & services')
on conflict (prefixe) do update set nom = excluded.nom;

alter table marques enable row level security;
grant select on marques to anon, authenticated, service_role;

-- Détection : le préfixe le plus long qui ouvre le libellé. Le caractère
-- suivant doit être une limite de mot pour que « fast » n'attrape pas
-- « Fastening ». Le libellé est nettoyé de tout emoji ou puce initiale.
create or replace function jc_marque(titre text)
returns text
language sql stable
set search_path = public
as $$
  with t as (select regexp_replace(jc_norm(titre), '^[^a-z0-9]+', '') as v)
  select m.nom
  from marques m, t
  where t.v like m.prefixe || '%'
    and (length(t.v) = length(m.prefixe)
         or substring(t.v from length(m.prefixe) + 1 for 1) !~ '[a-z0-9]')
  order by length(m.prefixe) desc
  limit 1;
$$;

grant execute on function jc_marque(text) to anon, authenticated, service_role;


-- ─────────────────────────────────────────────────────────────────────
-- 2) offres_articles : type de ligne, rabais, marque
--    (la table elle-même est créée par la migration 005)
--    Seuls les articles du catalogue ('product') portent une marque :
--    les articles saisis à la volée n'ont aucune règle de nommage.
-- ─────────────────────────────────────────────────────────────────────

alter table offres_articles add column if not exists type_ligne      text;
alter table offres_articles add column if not exists remise_ligne    numeric;
alter table offres_articles add column if not exists marque          text;
-- marque_presumee : déduite du libellé QUELLE QUE SOIT l'origine de la ligne.
-- Beaucoup d'articles saisis à la volée commencent malgré tout par le nom du
-- fabricant. Affichée à titre indicatif dans le top articles, jamais comptée
-- dans la répartition par marque — qui reste strictement fondée sur `marque`.
alter table offres_articles add column if not exists marque_presumee text;

create index if not exists idx_offres_articles_marque on offres_articles (marque);
create index if not exists idx_offres_articles_type   on offres_articles (type_ligne);

create or replace function offres_articles_sync()
returns trigger
language plpgsql security invoker
set search_path = public
as $$
begin
  delete from offres_articles where offre_id = new.id;

  insert into offres_articles (offre_id, position, sku, titre, qty, prix_unitaire,
                               type_ligne, remise_ligne, marque, marque_presumee)
  select
    new.id,
    (l.ord)::int,
    nullif(trim(l.val->>'sku'), ''),
    nullif(trim(l.val->>'title'), ''),
    case when (l.val->>'qty')          ~ '^-?[0-9]+(\.[0-9]+)?$' then (l.val->>'qty')::numeric end,
    case when (l.val->>'unitPrice')    ~ '^-?[0-9]+(\.[0-9]+)?$' then (l.val->>'unitPrice')::numeric end,
    coalesce(l.val->>'type', ''),
    case when (l.val->>'lineDiscount') ~ '^-?[0-9]+(\.[0-9]+)?$' then (l.val->>'lineDiscount')::numeric end,
    case when coalesce(l.val->>'type', '') = 'product' then jc_marque(l.val->>'title') end,
    jc_marque(l.val->>'title')
  from jsonb_array_elements(
         case when jsonb_typeof(new.data->'lines') = 'array' then new.data->'lines' else '[]'::jsonb end
       ) with ordinality as l(val, ord)
  where coalesce(l.val->>'type', '') not in ('comment', 'media')
    and (nullif(trim(l.val->>'sku'), '') is not null
         or nullif(trim(l.val->>'title'), '') is not null);

  return null;
end;
$$;

revoke execute on function offres_articles_sync() from public, anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────
-- 3) commandes_shopify_articles : les lignes Shopify à plat
-- ─────────────────────────────────────────────────────────────────────

create table if not exists commandes_shopify_articles (
  commande_id   bigint not null references commandes_shopify(id) on delete cascade,
  position      int    not null,
  sku           text,
  titre         text,
  qty           numeric,
  prix_unitaire numeric,
  marque        text,
  primary key (commande_id, position)
);

comment on table commandes_shopify_articles is
  'Lignes extraites de commandes_shopify.line_items. Alimentée par trigger — ne jamais écrire dedans à la main.';

create index if not exists idx_csa_commande on commandes_shopify_articles (commande_id);
create index if not exists idx_csa_marque   on commandes_shopify_articles (marque);
create index if not exists idx_csa_sku      on commandes_shopify_articles (upper(sku));

create or replace function commandes_shopify_articles_sync()
returns trigger
language plpgsql security invoker
set search_path = public
as $$
begin
  delete from commandes_shopify_articles where commande_id = new.id;

  insert into commandes_shopify_articles (commande_id, position, sku, titre, qty, prix_unitaire, marque)
  select
    new.id,
    (l.ord)::int,
    nullif(trim(l.val->>'sku'), ''),
    nullif(trim(coalesce(l.val->>'title', l.val->>'name')), ''),
    case when (l.val->>'quantity') ~ '^-?[0-9]+(\.[0-9]+)?$' then (l.val->>'quantity')::numeric end,
    case when (l.val->>'price')    ~ '^-?[0-9]+(\.[0-9]+)?$' then (l.val->>'price')::numeric end,
    jc_marque(coalesce(l.val->>'title', l.val->>'name'))
  from jsonb_array_elements(
         case when jsonb_typeof(new.line_items) = 'array' then new.line_items else '[]'::jsonb end
       ) with ordinality as l(val, ord);

  return null;
end;
$$;

revoke execute on function commandes_shopify_articles_sync() from public, anon, authenticated;

drop trigger if exists trg_csa_sync on commandes_shopify;
create trigger trg_csa_sync
after insert or update of line_items on commandes_shopify
for each row execute function commandes_shopify_articles_sync();

alter table commandes_shopify_articles enable row level security;
grant select on commandes_shopify_articles to anon, authenticated, service_role;

-- Recalcul global des marques — à lancer après toute modification de `marques`
create or replace function recalculer_marques()
returns text
language plpgsql security invoker
set search_path = public
as $$
declare n1 int; n2 int;
begin
  update offres_articles
     set marque = case when type_ligne = 'product' then jc_marque(titre) end,
         marque_presumee = jc_marque(titre)
   where marque is distinct from (case when type_ligne = 'product' then jc_marque(titre) end)
      or marque_presumee is distinct from jc_marque(titre);
  get diagnostics n1 = row_count;

  update commandes_shopify_articles
     set marque = jc_marque(titre)
   where marque is distinct from jc_marque(titre);
  get diagnostics n2 = row_count;

  return format('%s ligne(s) offres + %s ligne(s) Shopify mises à jour', n1, n2);
end;
$$;

-- Rejeu complet des deux tables de lignes
truncate offres_articles;
insert into offres_articles (offre_id, position, sku, titre, qty, prix_unitaire,
                             type_ligne, remise_ligne, marque, marque_presumee)
select o.id, (l.ord)::int,
       nullif(trim(l.val->>'sku'), ''), nullif(trim(l.val->>'title'), ''),
       case when (l.val->>'qty')          ~ '^-?[0-9]+(\.[0-9]+)?$' then (l.val->>'qty')::numeric end,
       case when (l.val->>'unitPrice')    ~ '^-?[0-9]+(\.[0-9]+)?$' then (l.val->>'unitPrice')::numeric end,
       coalesce(l.val->>'type', ''),
       case when (l.val->>'lineDiscount') ~ '^-?[0-9]+(\.[0-9]+)?$' then (l.val->>'lineDiscount')::numeric end,
       case when coalesce(l.val->>'type', '') = 'product' then jc_marque(l.val->>'title') end,
       jc_marque(l.val->>'title')
from offres o,
     lateral jsonb_array_elements(
       case when jsonb_typeof(o.data->'lines') = 'array' then o.data->'lines' else '[]'::jsonb end
     ) with ordinality as l(val, ord)
where coalesce(l.val->>'type', '') not in ('comment', 'media')
  and (nullif(trim(l.val->>'sku'), '') is not null or nullif(trim(l.val->>'title'), '') is not null);

truncate commandes_shopify_articles;
insert into commandes_shopify_articles (commande_id, position, sku, titre, qty, prix_unitaire, marque)
select c.id, (l.ord)::int,
       nullif(trim(l.val->>'sku'), ''),
       nullif(trim(coalesce(l.val->>'title', l.val->>'name')), ''),
       case when (l.val->>'quantity') ~ '^-?[0-9]+(\.[0-9]+)?$' then (l.val->>'quantity')::numeric end,
       case when (l.val->>'price')    ~ '^-?[0-9]+(\.[0-9]+)?$' then (l.val->>'price')::numeric end,
       jc_marque(coalesce(l.val->>'title', l.val->>'name'))
from commandes_shopify c,
     lateral jsonb_array_elements(
       case when jsonb_typeof(c.line_items) = 'array' then c.line_items else '[]'::jsonb end
     ) with ordinality as l(val, ord);


-- ─────────────────────────────────────────────────────────────────────
-- 4) Vues unifiées des ventes
-- ─────────────────────────────────────────────────────────────────────

drop view if exists ventes;

create view ventes
with (security_invoker = on) as
select 'app'::text  as source,
       o.id         as vente_id,
       o.created_at as date_vente,
       coalesce(o.total_ttc, 0)            as ca,
       coalesce(o.nb_articles, 0)::numeric as nb_articles,
       coalesce(nullif(trim(o.commercial), ''), '— Non assigné') as commercial,
       o.numero_affiche as numero,
       o.slug           as slug
from offres o
where o.type_document = 'Commande'
  and coalesce(o.statut, 'En cours') not in ('Refusée', 'Abandonnée', 'Refusee', 'Abandonnee')
union all
select 'shopify', c.id, c.created_at_shopify, coalesce(c.total_price, 0),
       coalesce(a.q, 0), null, c.shopify_order_name, null
from commandes_shopify c
left join (select commande_id, sum(coalesce(qty, 0)) q from commandes_shopify_articles group by 1) a
       on a.commande_id = c.id
where c.cancelled_at is null and coalesce(c.test, false) = false;

comment on view ventes is
  'Commandes des deux sources. ca = TTC (total_ttc côté app, total_price côté Shopify).';

-- valeur = qty × prix − rabais de ligne. Hors remise globale, services et
-- arrondi : ce n'est donc pas un CA comptable mais la valeur des articles.
-- Côté app, prix TTC pour les privés et HT pour les professionnels.
drop view if exists ventes_lignes;

create view ventes_lignes
with (security_invoker = on) as
select 'app'::text  as source,
       o.id         as vente_id,
       o.created_at as date_vente,
       a.sku        as sku,
       a.titre      as titre,
       a.marque     as marque,
       a.type_ligne as type_ligne,
       coalesce(a.qty, 0) as qty,
       coalesce(a.qty, 0) * coalesce(a.prix_unitaire, 0) - coalesce(a.remise_ligne, 0) as valeur,
       a.marque_presumee as marque_presumee
from offres o
join offres_articles a on a.offre_id = o.id
where o.type_document = 'Commande'
  and coalesce(o.statut, 'En cours') not in ('Refusée', 'Abandonnée', 'Refusee', 'Abandonnee')
union all
select 'shopify', c.id, c.created_at_shopify, a.sku, a.titre, a.marque, 'product',
       coalesce(a.qty, 0), coalesce(a.qty, 0) * coalesce(a.prix_unitaire, 0), a.marque
from commandes_shopify c
join commandes_shopify_articles a on a.commande_id = c.id
where c.cancelled_at is null and coalesce(c.test, false) = false;

grant select on ventes, ventes_lignes to anon, authenticated, service_role;


-- ─────────────────────────────────────────────────────────────────────
-- 5) Bornes des périodes, en heure suisse
--    jour | semaine | mois | trimestre | semestre | annee | exercice
--    exercice comptable = 1er octobre → 30 septembre
--    p_prorata : si la période est en cours, les comparatifs sont tronqués
--    à la même durée écoulée (sinon on comparerait 14 jours à 31).
-- ─────────────────────────────────────────────────────────────────────

drop function if exists stats_bornes(text, date);

create or replace function stats_bornes(p_periode text, p_ancre date default null, p_prorata boolean default true)
returns table (scope text, dfrom timestamptz, dto timestamptz, libelle text, partielle boolean)
language plpgsql stable
set search_path = public
as $$
declare
  a date := coalesce(p_ancre, (now() at time zone 'Europe/Zurich')::date);
  d0 date; d1 date; pas interval; recul_n interval;
  t0 timestamptz; t1 timestamptz; ecoule interval; en_cours boolean;
begin
  case p_periode
    when 'jour' then
      d0 := a; d1 := a + 1; pas := interval '1 day'; recul_n := interval '364 days';
    when 'semaine' then
      d0 := date_trunc('week', a)::date; d1 := d0 + 7;
      pas := interval '7 days'; recul_n := interval '364 days';
    when 'trimestre' then
      d0 := date_trunc('quarter', a)::date; d1 := (d0 + interval '3 months')::date;
      pas := interval '3 months'; recul_n := interval '1 year';
    when 'semestre' then
      d0 := make_date(extract(year from a)::int, case when extract(month from a) <= 6 then 1 else 7 end, 1);
      d1 := (d0 + interval '6 months')::date;
      pas := interval '6 months'; recul_n := interval '1 year';
    when 'annee' then
      d0 := date_trunc('year', a)::date; d1 := (d0 + interval '1 year')::date;
      pas := interval '1 year'; recul_n := interval '1 year';
    when 'exercice' then
      d0 := make_date(case when extract(month from a) >= 10 then extract(year from a)::int
                           else extract(year from a)::int - 1 end, 10, 1);
      d1 := (d0 + interval '1 year')::date;
      pas := interval '1 year'; recul_n := interval '1 year';
    else
      d0 := date_trunc('month', a)::date; d1 := (d0 + interval '1 month')::date;
      pas := interval '1 month'; recul_n := interval '1 year';
  end case;

  t0 := d0::timestamp at time zone 'Europe/Zurich';
  t1 := d1::timestamp at time zone 'Europe/Zurich';

  en_cours := p_prorata and now() > t0 and now() < t1;
  if en_cours then t1 := now(); ecoule := now() - t0; else ecoule := t1 - t0; end if;

  return query
  select 'courant', t0, t1,
         to_char(d0, 'DD.MM.YYYY') || ' → ' || to_char((case when en_cours then (now() at time zone 'Europe/Zurich')::date else d1 - 1 end), 'DD.MM.YYYY'),
         en_cours
  union all
  select 'precedent',
         (d0 - pas)::timestamp at time zone 'Europe/Zurich',
         ((d0 - pas)::timestamp at time zone 'Europe/Zurich') + ecoule,
         to_char((d0 - pas)::date, 'DD.MM.YYYY') || ' → ' || to_char(((((d0 - pas)::timestamp at time zone 'Europe/Zurich') + ecoule - interval '1 second') at time zone 'Europe/Zurich')::date, 'DD.MM.YYYY'),
         en_cours
  union all
  select 'an_dernier',
         (d0 - recul_n)::timestamp at time zone 'Europe/Zurich',
         ((d0 - recul_n)::timestamp at time zone 'Europe/Zurich') + ecoule,
         to_char((d0 - recul_n)::date, 'DD.MM.YYYY') || ' → ' || to_char(((((d0 - recul_n)::timestamp at time zone 'Europe/Zurich') + ecoule - interval '1 second') at time zone 'Europe/Zurich')::date, 'DD.MM.YYYY'),
         en_cours;
end;
$$;


-- ─────────────────────────────────────────────────────────────────────
-- 6) Agrégats. p_source ∈ 'app' | 'shopify' | 'total'
-- ─────────────────────────────────────────────────────────────────────

create or replace function stats_totaux(p_source text, p_from timestamptz, p_to timestamptz)
returns table (ca numeric, nb_commandes bigint, nb_articles numeric, panier_moyen numeric)
language sql stable set search_path = public as $$
  select coalesce(sum(v.ca), 0), count(*)::bigint, coalesce(sum(v.nb_articles), 0),
         case when count(*) > 0 then round(coalesce(sum(v.ca), 0) / count(*), 2) else 0 end
  from ventes v
  where (p_source = 'total' or v.source = p_source)
    and v.date_vente >= p_from and v.date_vente < p_to;
$$;

create or replace function stats_serie(p_source text, p_from timestamptz, p_to timestamptz, p_granularite text)
returns table (periode date, ca numeric, nb_commandes bigint)
language sql stable set search_path = public as $$
  select date_trunc(case when p_granularite in ('day','week','month','quarter','year') then p_granularite else 'day' end,
                    v.date_vente at time zone 'Europe/Zurich')::date,
         coalesce(sum(v.ca), 0), count(*)::bigint
  from ventes v
  where (p_source = 'total' or v.source = p_source)
    and v.date_vente >= p_from and v.date_vente < p_to
  group by 1 order by 1;
$$;

-- Source 'app' uniquement : Shopify n'enregistre pas le conseiller.
create or replace function stats_commerciaux(p_from timestamptz, p_to timestamptz)
returns table (commercial text, ca numeric, nb_commandes bigint, nb_articles numeric, panier_moyen numeric)
language sql stable set search_path = public as $$
  select v.commercial, coalesce(sum(v.ca), 0), count(*)::bigint, coalesce(sum(v.nb_articles), 0),
         case when count(*) > 0 then round(coalesce(sum(v.ca), 0) / count(*), 2) else 0 end
  from ventes v
  where v.source = 'app' and v.date_vente >= p_from and v.date_vente < p_to
  group by v.commercial order by 2 desc;
$$;

drop function if exists stats_articles(text, timestamptz, timestamptz, int);

create function stats_articles(p_source text, p_from timestamptz, p_to timestamptz, p_limit int default 25)
returns table (sku text, titre text, marque text, marque_presumee text, qty numeric, valeur numeric, nb_commandes bigint)
language sql stable set search_path = public as $$
  select coalesce(l.sku, '—'), min(l.titre), min(l.marque), min(l.marque_presumee),
         coalesce(sum(l.qty), 0), coalesce(sum(l.valeur), 0), count(distinct l.vente_id)::bigint
  from ventes_lignes l
  where (p_source = 'total' or l.source = p_source)
    and l.date_vente >= p_from and l.date_vente < p_to
  group by coalesce(l.sku, '—'), coalesce(l.titre, '')
  order by 6 desc
  limit greatest(1, least(coalesce(p_limit, 25), 200));
$$;

create or replace function stats_marques(p_source text, p_from timestamptz, p_to timestamptz)
returns table (marque text, qty numeric, valeur numeric, nb_commandes bigint)
language sql stable set search_path = public as $$
  select coalesce(l.marque, case when l.type_ligne = 'custom' then 'Articles à la volée' else 'Non identifiée' end),
         coalesce(sum(l.qty), 0), coalesce(sum(l.valeur), 0), count(distinct l.vente_id)::bigint
  from ventes_lignes l
  where (p_source = 'total' or l.source = p_source)
    and l.date_vente >= p_from and l.date_vente < p_to
  group by 1 order by 3 desc;
$$;

grant execute on function stats_bornes(text, date, boolean)                  to anon, authenticated, service_role;
grant execute on function stats_totaux(text, timestamptz, timestamptz)       to anon, authenticated, service_role;
grant execute on function stats_serie(text, timestamptz, timestamptz, text)  to anon, authenticated, service_role;
grant execute on function stats_commerciaux(timestamptz, timestamptz)        to anon, authenticated, service_role;
grant execute on function stats_articles(text, timestamptz, timestamptz, int) to anon, authenticated, service_role;
grant execute on function stats_marques(text, timestamptz, timestamptz)      to anon, authenticated, service_role;


-- ─────────────────────────────────────────────────────────────────────
-- 7) Les cartes « Chiffre du jour / du mois » du dashboard passaient par
--    data->>'commercial' — décompression du JSONB de chaque offre pour
--    rien. La colonne offres.commercial contient la même valeur
--    (vérifié : 0 divergence sur 358 commandes).
-- ─────────────────────────────────────────────────────────────────────

create or replace function stats_commandes_periode(date_from timestamptz, date_to timestamptz)
returns table (commercial text, nb_commandes bigint, total_qty bigint, total_montant numeric)
language sql stable set search_path = public as $$
  select coalesce(nullif(trim(o.commercial), ''), 'Non assigne'),
         count(*)::bigint,
         coalesce(sum(coalesce(o.nb_articles, 0)), 0)::bigint,
         coalesce(sum(coalesce(o.total_ttc, 0)), 0)::numeric
  from offres o
  where o.type_document = 'Commande'
    and coalesce(o.statut, 'En cours') not in ('Refusee', 'Abandonnee', 'Refusée', 'Abandonnée')
    and o.created_at >= date_from and o.created_at < date_to
  group by 1 order by 4 desc;
$$;


-- ─────────────────────────────────────────────────────────────────────
-- Contrôles
-- ─────────────────────────────────────────────────────────────────────
-- select count(*), count(marque) from offres_articles where type_ligne='product';  -- 2116 / 2116
-- select count(*), count(marque) from commandes_shopify_articles;                  -- 17012 / 16897
-- select b.scope, b.libelle, t.* from stats_bornes('mois') b, lateral stats_totaux('total', b.dfrom, b.dto) t;
--
-- Marques non reconnues, à compléter dans `marques` puis recalculer_marques() :
-- select split_part(trim(titre),' ',1), count(*) from commandes_shopify_articles
--   where marque is null group by 1 order by 2 desc limit 20;
