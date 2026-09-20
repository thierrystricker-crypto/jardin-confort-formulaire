-- docs/sql/023-planner-versions.sql
-- Planner 3D : versions figées à l'export (20.09.2026)
--   Chaque « Fiche » ou « Capture » fige un instantané de la scène (V1, V2…)
--   avec son propre jeton : le QR / lien imprimé montre exactement ce que le
--   document montrait, comme les révisions d'offres. Le lien « Partager » du
--   planner reste vivant (dernière version enregistrée).

create table if not exists public.planner_scenes_versions (
  id          uuid primary key default gen_random_uuid(),
  scene_id    uuid not null references public.planner_scenes(id) on delete cascade,
  numero      integer not null,
  token       text not null unique,
  motif       text not null default 'fiche',        -- fiche | capture | manuel
  nom         text not null,
  terrasse    jsonb not null,
  sol         text not null default 'bois',
  items       jsonb not null default '[]'::jsonb,
  mode        text not null default 'couleurs',
  vue         text not null default 'plan',
  cree_par    text,
  cree_le     timestamptz not null default now(),
  unique (scene_id, numero)
);

create index if not exists planner_scenes_versions_scene_idx on public.planner_scenes_versions (scene_id, numero desc);

alter table public.planner_scenes_versions enable row level security;   -- service role uniquement, comme planner_scenes
