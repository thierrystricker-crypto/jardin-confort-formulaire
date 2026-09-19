-- docs/sql/021-modeles-3d-variantes.sql
-- Index 3D : modèles 3D par variante (convention du 19.09.2026)
--   custom.model_3d_url existe aussi au niveau variante (taille / longueur /
--   nombre de places). Cascade : variante → Model3d fiche → URL fiche.
--   variantes_3d = [{variant_id, sku, titre, options:{Option: valeur}, url}]
--   model_level passe à 'variante' dès qu'une variante a son fichier, ce qui
--   éteint size_mismatch_possible (colonne générée) pour la fiche.
-- À exécuter dans le SQL Editor puis « Rafraîchir l'index 3D ».

alter table public.modeles_3d
  add column if not exists variantes_3d   jsonb   not null default '[]'::jsonb,
  add column if not exists variantes_3d_n integer not null default 0;
