-- docs/sql/031-matieres-pour-offre.sql
-- Chantier moodboard des matières (12.10.2026).
--
-- Rôle : à partir des options Shopify des lignes d'une offre, renvoyer les
-- finitions de la base `matieres` (dédoublonnées), avec leur poids dans l'offre.
--
-- LECTURE SEULE. Cette fonction n'écrit nulle part. Elle ne fait AUCUN
-- rapprochement par nom elle-même : elle découpe les valeurs d'option selon les
-- règles du journal moodboard, puis délègue CHAQUE morceau à
-- public.matiere_depuis_option(), maintenue par le projet « Import articles
-- Shopify ». Si une couleur manque ou se relie mal, c'est la base qu'on corrige.
--
-- Entrée p_lignes : [{ "ligne_id", "vendor", "handle", "poids",
--                      "options": [{ "name", "value" }] }]
-- Sortie : une ligne par finition reconnue, triée par poids décroissant.
--
-- À exécuter dans le SQL Editor Supabase (projet llkyzspixrbtoprtmvoh).

create or replace function public.matieres_pour_offre(p_lignes jsonb)
returns table (
  cle          text,
  nom          text,
  code         text,
  marque       text,
  famille      text,
  hex          text,
  motif        boolean,
  url_vignette text,
  url_maitre   text,
  lignes       text[],
  poids        numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with l as (
    select e->>'ligne_id'                       as ligne_id,
           e->>'vendor'                         as vendor,
           coalesce(e->>'handle', '')           as handle,
           coalesce((e->>'poids')::numeric, 1)  as poids,
           e->'options'                         as options
    from jsonb_array_elements(coalesce(p_lignes, '[]'::jsonb)) e
    where coalesce(e->>'vendor', '') <> ''
  ),
  o as (
    select l.ligne_id, l.vendor, l.handle, l.poids,
           x->>'name'  as opt_nom,
           x->>'value' as opt_val
    from l, jsonb_array_elements(coalesce(l.options, '[]'::jsonb)) x
    where coalesce(x->>'value', '') <> ''
  ),
  -- Découpage (journal moodboard §2) :
  --   • Suncomfort, Schaffner : « / » et « + » seulement (tirets dans leurs noms)
  --   • toutes les autres marques : « / », « + », « - » entourés d'espaces
  --   • Schaffner : l'option passée est toujours « Couleur »
  m as (
    select o.ligne_id, o.vendor, o.handle, o.poids,
           btrim(s) as morceau,
           case when lower(o.vendor) like 'schaffner%' then 'Couleur' else o.opt_nom end as opt_nom
    from o,
         regexp_split_to_table(
           o.opt_val,
           case when lower(o.vendor) ~ '^(suncomfort|schaffner)'
                then '\s*[/+]\s*'
                else '\s+[/+-]\s+' end
         ) s
    where btrim(s) <> ''
  ),
  -- distinct : une même ligne ne compte qu'une fois par finition
  r as (
    select distinct m.ligne_id, m.vendor, m.poids,
           public.matiere_depuis_option(m.vendor, m.morceau, m.opt_nom, m.handle)->>'cle' as cle
    from m
  )
  select t.cle, t.nom, t.code,
         min(r.vendor)                                  as marque,
         t.famille, t.hex, coalesce(t.motif, false)     as motif,
         coalesce(t.shop_url_vignette, t.url_vignette)  as url_vignette,
         coalesce(t.shop_url_maitre,  t.url_maitre)     as url_maitre,
         array_agg(r.ligne_id order by r.ligne_id)      as lignes,
         sum(r.poids)                                   as poids
  from r
  join public.matieres t on t.cle = r.cle and t.statut = 'actif'
  where coalesce(t.shop_url_vignette, t.url_vignette) is not null
  group by t.cle, t.nom, t.code, t.famille, t.hex, t.motif,
           t.shop_url_vignette, t.url_vignette, t.shop_url_maitre, t.url_maitre
  order by sum(r.poids) desc, t.nom;
$$;

comment on function public.matieres_pour_offre(jsonb) is
  'Moodboard des offres (jardin-confort-formulaire). Lecture seule : découpe les options Shopify et délègue chaque morceau à matiere_depuis_option. Voir docs/sql/031.';

-- Appelée uniquement côté serveur (route /api/offres/[slug]/matieres, clé service).
revoke all on function public.matieres_pour_offre(jsonb) from public, anon;
grant execute on function public.matieres_pour_offre(jsonb) to service_role, authenticated;

-- ─── Test (à lancer après création) ─────────────────────────────────────────
-- Attendu : Teak Natural (lignes a+b, poids 14520), Toscana, Fossil, Cactus.
-- « Rouille 09 » (absent de la base) et « Perle D4 » (coussin) n'apparaissent pas.
--
-- select * from public.matieres_pour_offre('[
--  {"ligne_id":"a","vendor":"Manutti","handle":"manutti-torsa-table-o80cm-d-75h-hauteur-75cm","poids":2120,
--   "options":[{"name":"Armature","value":"Teak Natural (HFTK)"},{"name":"Finition plateau","value":"Céramique Fossil 12mm (5K53)"}]},
--  {"ligne_id":"b","vendor":"Manutti","handle":"manutti-solid-barstool-79-avec-dossier-coussin-en-sus","poids":12400,
--   "options":[{"name":"Couleur armature","value":"Teak natural (HFTK)"}]},
--  {"ligne_id":"c","vendor":"Manutti","handle":"manutti-solid-set-de-coussins-assise-et-dossier-fauteuil-repas-et-barstool","poids":3320,
--   "options":[{"name":"Couleur","value":"(Cat.C) FR Toscana CF165"}]},
--  {"ligne_id":"d","vendor":"Fermob","handle":"fermob-luxembourg-chaise","poids":800,
--   "options":[{"name":"Couleur","value":"Rouille 09"}]},
--  {"ligne_id":"e","vendor":"Fermob","handle":"fermob-luxembourg-chaise","poids":800,
--   "options":[{"name":"Couleur","value":"Cactus 82 / Perle D4"}]}
-- ]'::jsonb);
