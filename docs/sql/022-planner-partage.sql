-- docs/sql/022-planner-partage.sql
-- Planner 3D : partage client en lecture seule (20.09.2026)
--   partage_token : jeton aléatoire (32 hex) présent dans l'URL publique
--   /planner/partage/<token>. Null = pas de partage. Révocable (remis à null)
--   et régénérable. Le lien reste valable tant que le jeton existe.

alter table public.planner_scenes
  add column if not exists partage_token    text unique,
  add column if not exists partage_cree_le  timestamptz;

create index if not exists planner_scenes_partage_token_idx on public.planner_scenes (partage_token) where partage_token is not null;
