-- docs/sql/020-modeles-3d-skus.sql
-- Index 3D : SKU et variante de référence par fiche (20.09.2026)
--   - recherche par SKU dans l'Index 3D et le planner (skus_txt, ilike)
--   - export du planner vers une liste d'achat (sku_1 / variant_id_1 = première
--     variante, celle dont le modèle 3D est le plus proche tant que le 3D est
--     au niveau fiche)
-- Colonne `sol` sur planner_scenes : revêtement de la terrasse.
-- À exécuter dans le SQL Editor puis « Rafraîchir l'index 3D ».

alter table public.modeles_3d
  add column if not exists sku_1        text,
  add column if not exists variant_id_1 text,
  add column if not exists skus         text[] not null default '{}',
  add column if not exists skus_txt     text not null default '';

create index if not exists modeles_3d_skus_txt_idx on public.modeles_3d using gin (to_tsvector('simple', skus_txt));

alter table public.planner_scenes
  add column if not exists sol text not null default 'bois';
