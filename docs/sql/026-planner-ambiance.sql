-- docs/sql/026-planner-ambiance.sql
-- Planner 3D : image d'ambiance générée par IA sur une version figée (21.09.2026)
--   ambiance_url     : PNG généré (bucket pdfs, planner/<token>-ambiance.png)
--   ambiance_prompt  : description donnée par le conseiller (sol, paysage, lumière)
--   ambiance_cree_le : horodatage
-- Toujours affichée avec la mention « Image d'inspiration libre générée par
-- l'IA, non contractuelle », en plus (jamais à la place) de la capture 3D.

alter table public.planner_scenes_versions
  add column if not exists ambiance_url      text,
  add column if not exists ambiance_prompt   text,
  add column if not exists ambiance_cree_le  timestamptz;
