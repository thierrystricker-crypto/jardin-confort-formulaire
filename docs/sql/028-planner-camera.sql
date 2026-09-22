-- docs/sql/028-planner-camera.sql
-- Planner 3D : point de vue enregistré (22.09.2026). À la réouverture d'un
-- plan, la caméra revenait au cadrage par défaut. On mémorise, pour chaque vue
-- (plan / 3d) : position, cible et zoom. La version figée garde la caméra de
-- sa capture, pour que la page client s'ouvre sous le même angle que la fiche.
--   camera = { "plan": { "pos": [x,y,z], "target": [x,y,z], "zoom": n },
--              "3d":   { "pos": [x,y,z], "target": [x,y,z] } }

alter table public.planner_scenes           add column if not exists camera jsonb;
alter table public.planner_scenes_versions  add column if not exists camera jsonb;
