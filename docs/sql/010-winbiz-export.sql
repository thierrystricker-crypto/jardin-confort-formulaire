-- 010-winbiz-export.sql
-- Chantier « Export Winbiz » — étape 2 : les deux tables neuves.
-- À exécuter dans le SQL Editor Supabase (projet llkyzspixrbtoprtmvoh), jamais via PowerShell.
-- Les 5 RPC du connecteur ont été vérifiées le 29.08.2026 : présentes, non concernées
-- (tables neuves uniquement, aucune colonne existante touchée).
-- Contrôle après exécution : les deux SELECT de fin doivent rendre 0 ligne chacun.

-- ── winbiz_adresses : le fichier clients Winbiz, par exercice ──
-- Source : export Winbiz « liste d'adresses, étiquettes » (.xls, 111 colonnes).
-- Relevé sur pièce le 29.08.2026 : ad_code = code adresse (numérique, 1823 fiches
-- SANS code sur 8664 — elles ne sont pas matchables) ; ni e-mail ni téléphone
-- saisis (2-3 fiches sur 8664) ; ad_codes (code complémentaire) vide partout.
-- L'exercice n'est PAS dans le fichier : il est saisi à l'upload.
create table public.winbiz_adresses (
  id          bigint generated always as identity primary key,
  exercice    int  not null,
  code        text not null,              -- ad_code — alphanumérique C(15) côté Winbiz
  societe     text,
  nom         text,                       -- ad_nom (espaces de tête possibles — normalisés à l'import)
  prenom      text,
  rue         text,
  npa         text,
  ville       text,
  raw         jsonb not null default '{}'::jsonb,  -- toutes les colonnes non vides de l'export
  importe_le  timestamptz not null default now(),
  unique (exercice, code)
);

-- Index de match : mêmes normalisations que le matcher (jc_norm est IMMUTABLE, indexable)
create index winbiz_adresses_match_idx
  on public.winbiz_adresses (exercice, jc_norm(coalesce(nom, '')), jc_norm(coalesce(prenom, '')), npa);

alter table public.winbiz_adresses enable row level security;
-- RLS activée sans policy : accès service_role uniquement, comme le reste de l'app.

-- ── winbiz_exports : la traçabilité de chaque génération ──
create table public.winbiz_exports (
  id                bigint generated always as identity primary key,
  created_at        timestamptz not null default now(),
  commande_slug     text not null,
  numero_commande   text not null,          -- CMD-80xxx, identité du document
  numero_winbiz     text not null,          -- chiffres émis au champ 1
  exercice_adresses int,                    -- exercice du fichier clients utilisé (null si repli sans fichier)
  run_id            text not null,
  filename          text not null,
  montant           numeric(12,2) not null, -- total émis au champ 6 (HT pour un document Pro)
  pro_ht            boolean not null default false,
  contenu_hash      text not null,          -- sha256 du fichier émis
  version           int  not null,          -- n° d'export pour cette commande (1, 2, …)
  client_code       text,                   -- code Winbiz attribué, ou '999'
  match_type        text not null check (match_type in
                      ('nom_prenom_npa','nom_prenom_npa_rue','societe_npa','repli_aucun','repli_ambigu','repli_sans_fichier')),
  match_detail      text,                   -- « attribuée à {code} — {nom} ({critère}) » / raison du repli
  statut            text not null default 'genere' check (statut in ('genere','depose','erreur')),
  erreur            text,
  cree_par          text,
  unique (commande_slug, version)
);

create index winbiz_exports_slug_idx on public.winbiz_exports (commande_slug, created_at desc);

alter table public.winbiz_exports enable row level security;

-- ── Contrôles (doc 04 §12 : un SELECT de contrôle après toute écriture) ──
select * from public.winbiz_adresses limit 5;
select * from public.winbiz_exports limit 5;
