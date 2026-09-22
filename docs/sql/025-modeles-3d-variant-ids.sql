-- docs/sql/025-modeles-3d-variant-ids.sql
-- Index 3D : identifiants de toutes les variantes de la fiche (21.09.2026)
--   Les lignes d'offre portent shopifyVariantId (gid) — c'est la clé fiable
--   (le SKU n'est pas unique entre marques). Sert à la card « faisabilité 3D »
--   et au pré-remplissage du planner depuis une offre.
-- À exécuter puis « Rafraîchir l'index 3D ».

alter table public.modeles_3d
  add column if not exists variant_ids text[] not null default '{}';

create index if not exists modeles_3d_variant_ids_idx on public.modeles_3d using gin (variant_ids);
create index if not exists modeles_3d_skus_idx on public.modeles_3d using gin (skus);
