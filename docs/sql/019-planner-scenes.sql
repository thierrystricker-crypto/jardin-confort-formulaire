-- docs/sql/019-planner-scenes.sql
-- Scènes du planner 3D (chantier planner, étape 2 — 20.09.2026)
--
-- Une scène = une terrasse (largeur × profondeur en m) + une liste d'articles
-- posés (produit Shopify, URL du modèle, position x/z en m, rotation en
-- degrés). Même objet qu'une offre, deux vues : plus tard, `offre_slug`
-- reliera la scène à l'offre/commande dont elle est issue (étape 3).
--
-- À exécuter dans le SQL Editor de Supabase (projet de l'app).

create table if not exists public.planner_scenes (
  id            uuid primary key default gen_random_uuid(),
  nom           text not null default 'Sans titre',
  cree_par      text,                                  -- jardi-utilisateur (même clé que les listes d'achat)
  offre_slug    text,                                  -- null tant que la scène n'est pas liée à une offre
  terrasse      jsonb not null default '{"largeur": 6, "profondeur": 4}'::jsonb,
  items         jsonb not null default '[]'::jsonb,    -- [{ product_id, titre, marque, url, x, z, rot, source, size_warn, color_warn }]
  mode          text not null default 'couleurs',      -- couleurs | maquette
  vue           text not null default 'plan',          -- plan | 3d (dernière vue utilisée)
  capture_url   text,                                  -- dernière image exportée (Supabase Storage), plus tard
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists planner_scenes_offre_idx on public.planner_scenes (offre_slug) where offre_slug is not null;
create index if not exists planner_scenes_updated_idx on public.planner_scenes (updated_at desc);

alter table public.planner_scenes enable row level security;
-- Aucune policy : service role seulement (routes internes). La lecture
-- publique d'une scène partagée (page client) viendra avec le planner public.
