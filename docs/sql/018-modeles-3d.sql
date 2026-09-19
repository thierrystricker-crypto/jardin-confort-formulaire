-- docs/sql/018-modeles-3d.sql
-- Index des modèles 3D du catalogue Shopify — miroir, jamais source.
-- (Chantier planner 3D, étape 1 — 20.09.2026)
--
-- La table contient TOUS les produits de jardin-confort.ch (avec ou sans
-- modèle), pour que le picker du planner puisse afficher une collection
-- entière en grisant les articles sans 3D. Elle est régénérée chaque nuit par
-- /api/cron/modeles-3d-sync (bulk operation Admin API) et à la demande par le
-- bouton « Rafraîchir l'index 3D » du dashboard.
--
-- Les colonnes « géométrie » (bbox_*, top_view_*, footprint_*) sont remplies
-- plus tard par la passe géométrie (script qui charge chaque GLB), pas par la
-- synchro Shopify : la synchro ne les touche jamais.
--
-- À exécuter dans le SQL Editor de Supabase (projet de l'app, llkyzspixrbtoprtmvoh).

create table if not exists public.modeles_3d (
  product_id            bigint primary key,                 -- id numérique Shopify du produit
  handle                text not null,
  titre                 text not null,
  marque                text,                               -- vendor Shopify
  statut                text not null,                      -- ACTIVE | DRAFT | ARCHIVED
  publie                boolean not null default false,     -- publié sur la boutique en ligne (publishedAt non nul)
  type_produit          text,
  tags                  text[] not null default '{}',
  collection            text,                               -- tag Collection_xxx (valeur après le préfixe)
  categories            text[] not null default '{}',       -- tags Catégorie_xxx
  tag_no3dfile          boolean not null default false,     -- tag no3dfile — état actuel seulement, ne veut pas dire « n'existera jamais »
  image_url             text,
  prix_min              numeric(10,2),                      -- prix TTC le plus bas des variantes (indicatif, compteur du planner)

  -- Variantes / options (pour les avertissements taille / couleur)
  variant_count         integer not null default 0,
  variant_mode          text not null default 'sans_variante', -- sans_variante | avec_options
  option_names          text[] not null default '{}',
  option_values         jsonb not null default '{}'::jsonb, -- { "Couleur": ["Cactus 82", …], "Taille": [...] }
  has_size_option       boolean not null default false,
  has_color_option      boolean not null default false,
  options_signature     text,                               -- hash noms + valeurs d'options
  options_changed_at    timestamptz,                        -- dernière fois où la signature a changé

  -- Modèle 3D rattaché (niveau fiche)
  model_level           text not null default 'fiche',      -- fiche | variante (plus tard)
  source                text,                               -- model3d | url | null
  url_glb               text,
  url_usdz              text,
  gid_model3d           text,
  nom_fichier           text,
  taille_octets         bigint,
  fichier_partage_n     integer not null default 0,         -- nb de produits qui pointent sur le même fichier (1 = normal)
  model_attached_at     timestamptz,                        -- première synchro où un modèle a été vu sur la fiche
  has_3d                boolean generated always as (source is not null) stored,
  size_mismatch_possible  boolean generated always as (source is not null and model_level = 'fiche' and has_size_option) stored,
  color_mismatch_possible boolean generated always as (source is not null and model_level = 'fiche' and has_color_option) stored,
  anomalies             text[] not null default '{}',

  -- Géométrie (passe séparée, jamais écrite par la synchro Shopify)
  bbox_x                numeric(8,3),
  bbox_y                numeric(8,3),
  bbox_z                numeric(8,3),
  top_view_url          text,
  top_view_clay_url     text,
  top_view_lines_url    text,
  footprint_svg         text,
  footprint_source      text,                               -- fournisseur | genere | null
  geometry_version      text,                               -- valeur ?v= de l'URL au moment du calcul
  geometry_checked_at   timestamptz,

  synced_at             timestamptz not null default now(),
  created_at            timestamptz not null default now()
);

create index if not exists modeles_3d_marque_collection_idx on public.modeles_3d (marque, collection);
create index if not exists modeles_3d_has_3d_idx on public.modeles_3d (has_3d) where has_3d;
create index if not exists modeles_3d_handle_idx on public.modeles_3d (handle);
create index if not exists modeles_3d_url_glb_idx on public.modeles_3d (url_glb) where url_glb is not null;

-- Écriture réservée au serveur (service role). Aucune policy : la clé anon ne
-- lit rien. Une policy de lecture sur (statut = 'ACTIVE' and publie) viendra
-- avec le planner public.
alter table public.modeles_3d enable row level security;

-- État de la synchro (une seule ligne, id = 1)
create table if not exists public.modeles_3d_sync_etat (
  id                    integer primary key default 1 check (id = 1),
  bulk_operation_id     text,                               -- gid Shopify de la bulk operation en cours / dernière
  statut                text not null default 'idle',       -- idle | running | importing | done | error
  declencheur           text,                               -- cron | manuel
  demarre_le            timestamptz,
  termine_le            timestamptz,
  message               text,
  stats                 jsonb not null default '{}'::jsonb, -- { produits, avec_3d, model3d, url, anomalies, duree_ms … }
  updated_at            timestamptz not null default now()
);
insert into public.modeles_3d_sync_etat (id) values (1) on conflict (id) do nothing;
alter table public.modeles_3d_sync_etat enable row level security;

-- Synthèse par marque pour le dashboard
create or replace view public.v_modeles_3d_marques as
select
  coalesce(marque, '(sans marque)')                                      as marque,
  count(*)                                                                as produits,
  count(*) filter (where statut = 'ACTIVE')                               as actifs,
  count(*) filter (where has_3d)                                          as avec_3d,
  count(*) filter (where has_3d and statut = 'ACTIVE')                    as actifs_avec_3d,
  count(*) filter (where statut = 'ACTIVE' and not has_3d)                as actifs_sans_3d,
  count(*) filter (where source = 'model3d')                              as via_model3d,
  count(*) filter (where source = 'url')                                  as via_url,
  count(*) filter (where has_3d and size_mismatch_possible)               as taille_non_garantie,
  count(*) filter (where has_3d and color_mismatch_possible)              as couleur_non_garantie,
  count(*) filter (where has_3d and cardinality(anomalies) > 0)           as avec_anomalies,
  count(*) filter (where tag_no3dfile)                                    as tag_no3dfile,
  count(distinct collection) filter (where collection is not null)        as collections
from public.modeles_3d
group by 1
order by avec_3d desc, produits desc;
