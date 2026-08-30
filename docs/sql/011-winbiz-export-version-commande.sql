-- 011-winbiz-export-version-commande.sql
-- Chantier « Export Winbiz » — retour de Thierry du 31.08 : la carte affichait
-- « v1, v2, v3 » qui sont les numéros d'EXPORT, pas la version de la COMMANDE
-- (le « · Vn » des révisions). On enregistre désormais la version vivante de la
-- commande au moment de chaque export (version vivante = MAX(version_num des
-- révisions archivées) + 1, doc 03 §2).
-- À exécuter dans le SQL Editor Supabase (projet llkyzspixrbtoprtmvoh).
-- Table neuve du chantier : aucune RPC du connecteur concernée.

alter table public.winbiz_exports
  add column if not exists commande_version int;

comment on column public.winbiz_exports.commande_version is
  'Version vivante de la commande au moment de l''export (1 = jamais révisée). NULL sur les exports antérieurs au 31.08.2026.';

-- Contrôle : la colonne existe, les anciennes lignes sont à NULL
select version, commande_version, created_at from public.winbiz_exports order by created_at desc limit 5;
