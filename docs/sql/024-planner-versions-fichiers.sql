-- docs/sql/024-planner-versions-fichiers.sql
-- Planner 3D : fichiers rattachés à une version figée (20.09.2026)
--   capture_url        : image PNG de la vue au moment de l'export (bucket pdfs, planner/<token>.png)
--   pdf_url            : fiche PDF avec prix (pdf.co, comme les offres)
--   pdf_sans_prix_url  : fiche PDF sans prix
--   Les cotes 3D mesurées sont stockées dans items[].dims au moment de figer.

alter table public.planner_scenes_versions
  add column if not exists capture_url       text,
  add column if not exists pdf_url           text,
  add column if not exists pdf_sans_prix_url text;
