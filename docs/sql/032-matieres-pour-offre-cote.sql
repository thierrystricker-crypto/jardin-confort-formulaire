-- docs/sql/032-matieres-pour-offre-cote.sql
-- Moodboard (12.10.2026, suite de 031) : la fonction renvoie aussi `cote`,
-- la taille en px de l'image maître. Le composant s'en sert pour choisir :
--   • image assez grande  → étirée sur tout le bloc de la palette
--   • image trop petite   → répétée en motif (pas d'agrandissement flou)
--
-- Un changement de colonnes de sortie impose DROP puis CREATE (Postgres
-- refuse CREATE OR REPLACE dans ce cas). Toujours LECTURE SEULE, toujours
-- aucun rapprochement par nom : chaque morceau passe par matiere_depuis_option.
--
-- À exécuter dans le SQL Editor Supabase (projet llkyzspixrbtoprtmvoh).

drop function if exists public.matieres_pour_offre(jsonb);

create function public.matieres_pour_offre(p_lignes jsonb)
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
  cote         integer,
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
         t.maitre_cote                                  as cote,
         array_agg(r.ligne_id order by r.ligne_id)      as lignes,
         sum(r.poids)                                   as poids
  from r
  join public.matieres t on t.cle = r.cle and t.statut = 'actif'
  where coalesce(t.shop_url_vignette, t.url_vignette) is not null
  group by t.cle, t.nom, t.code, t.famille, t.hex, t.motif,
           t.shop_url_vignette, t.url_vignette, t.shop_url_maitre, t.url_maitre, t.maitre_cote
  order by sum(r.poids) desc, t.nom;
$$;

comment on function public.matieres_pour_offre(jsonb) is
  'Moodboard des offres (jardin-confort-formulaire). Lecture seule : découpe les options Shopify et délègue chaque morceau à matiere_depuis_option. Voir docs/sql/031 et 032.';

revoke all on function public.matieres_pour_offre(jsonb) from public, anon;
grant execute on function public.matieres_pour_offre(jsonb) to service_role, authenticated;

-- Test : même jeu que 031, la colonne `cote` doit être remplie
-- (Teak Natural = 195, petite image → répétée en motif dans la palette).
