-- docs/sql/027-planner-ambiances.sql
-- Planner 3D : PLUSIEURS images d'ambiance IA par version figée (22.09.2026).
-- Régénérer n'écrase plus rien : chaque génération ajoute une ligne ici.
-- La version garde ambiance_url / ambiance_prompt (026) = l'image RETENUE
-- pour les documents (fiche, PDF, page client) ; null = aucune sur les
-- documents. Supprimer une image efface la ligne et le fichier du bucket.

create table if not exists public.planner_ambiances (
  id          uuid primary key default gen_random_uuid(),
  version_id  uuid not null references public.planner_scenes_versions(id) on delete cascade,
  scene_id    uuid not null references public.planner_scenes(id) on delete cascade,
  url         text not null,
  chemin      text not null,            -- chemin dans le bucket pdfs (pour la suppression)
  prompt      text,
  modele      text,
  cree_par    text,
  cree_le     timestamptz not null default now()
);

create index if not exists planner_ambiances_version_idx on public.planner_ambiances (version_id, cree_le desc);

-- Reprise de l'existant : l'image unique déjà générée devient la 1re ligne.
insert into public.planner_ambiances (version_id, scene_id, url, chemin, prompt, cree_le)
select v.id, v.scene_id, v.ambiance_url,
       'planner/' || v.token || '-ambiance.png',
       v.ambiance_prompt, coalesce(v.ambiance_cree_le, now())
from public.planner_scenes_versions v
where v.ambiance_url is not null
  and not exists (select 1 from public.planner_ambiances a where a.version_id = v.id);
