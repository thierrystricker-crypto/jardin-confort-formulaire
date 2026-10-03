-- docs/sql/030-modeles-3d-zones.sql
-- Index 3D : couleurs appliquées à l'affichage (Fermob, 04.10.2026)
--
-- Fermob n'a plus un fichier 3D par couleur : chaque fiche a UNE forme
-- (géométrie, matières nommées par zone) dans le métachamp produit
-- custom.model_3d_zones, et le lecteur repeint le modèle selon la variante,
-- à partir de la palette de la boutique (métachamp shop custom.palette_3d).
-- Voir le doc projet « passation-couleurs-3d-a-la-volee.md ».
--
--   zones            = le json du métachamp de la fiche (forme, zones, formes)
--   zones_variantes  = les variantes de la fiche avec leurs options, et leur
--                      éventuel métachamp model_3d_zones (exception Oulala)
--                      — rempli seulement pour les fiches à zones
--   source = 'zones' → has_3d vrai (colonne générée inchangée)
--
-- La couleur est désormais JUSTE pour toutes les variantes d'une fiche à
-- zones : color_mismatch_possible doit donc l'ignorer. La colonne étant
-- générée, il faut la recréer, et la vue qui s'en sert avec.
--
-- À exécuter dans le SQL Editor de Supabase, puis « Rafraîchir l'index 3D ».

alter table public.modeles_3d
  add column if not exists zones           jsonb,
  add column if not exists zones_variantes jsonb not null default '[]'::jsonb;

drop view if exists public.v_modeles_3d_marques;

alter table public.modeles_3d drop column if exists color_mismatch_possible;
alter table public.modeles_3d
  add column color_mismatch_possible boolean
  generated always as (source is not null and source <> 'zones' and model_level = 'fiche' and has_color_option) stored;

create or replace view public.v_modeles_3d_marques as
select
  coalesce(marque, '(sans marque)')                                      as marque,
  count(*)                                                                as produits,
  count(*) filter (where statut = 'ACTIVE')                               as actifs,
  count(*) filter (where has_3d)                                          as avec_3d,
  count(*) filter (where has_3d and statut = 'ACTIVE')                    as actifs_avec_3d,
  count(*) filter (where statut = 'ACTIVE' and not has_3d)                as actifs_sans_3d,
  count(*) filter (where source = 'model3d')                              as via_model3d,
  count(*) filter (where source = 'url')                                  as via_url,
  count(*) filter (where source = 'zones')                                as via_zones,
  count(*) filter (where has_3d and size_mismatch_possible)               as taille_non_garantie,
  count(*) filter (where has_3d and color_mismatch_possible)              as couleur_non_garantie,
  count(*) filter (where has_3d and cardinality(anomalies) > 0)           as avec_anomalies,
  count(*) filter (where tag_no3dfile)                                    as tag_no3dfile,
  count(distinct collection) filter (where collection is not null)        as collections
from public.modeles_3d
group by 1
order by avec_3d desc, produits desc;

-- Palette de la boutique (métachamp shop custom.palette_3d), copiée à chaque
-- synchro. Une seule ligne : c'est une photo, Shopify reste la source.
create table if not exists public.modeles_3d_palette (
  id        integer primary key default 1 check (id = 1),
  data      jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now()
);
insert into public.modeles_3d_palette (id) values (1) on conflict (id) do nothing;
alter table public.modeles_3d_palette enable row level security;
