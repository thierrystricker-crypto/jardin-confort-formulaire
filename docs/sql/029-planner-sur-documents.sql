-- docs/sql/029-planner-sur-documents.sql
-- Planner 3D : joindre le plan aux documents du dossier (22.09.2026)
--
-- Les clients reçoivent un LIEN vers la page print de l'offre / commande (et
-- un PDF de cette même page via le flow Make à la validation en ligne). Pour
-- que le plan 3D et l'image d'ambiance y apparaissent, le conseiller coche
-- « Joindre aux documents » dans le planner. Décoché par défaut : un plan de
-- travail ne part jamais chez le client sans décision explicite.
--
-- Le drapeau vit sur la SCÈNE, pas sur l'offre : on ne touche ni à la table
-- des offres ni à leur sauvegarde. La page print lit les scènes liées par
-- offre_slug et n'affiche que celles qui sont cochées.

alter table public.planner_scenes
  add column if not exists sur_documents boolean not null default false;
