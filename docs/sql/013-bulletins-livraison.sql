-- ============================================================================
-- Migration : table bulletins_livraison (bulletin de livraison à la volée)
-- Date : 2026-09-02
-- Chantier : « Bulletin de livraison à la volée » — envois partiels, lignes
--            ajoutées / retirées / quantités modifiées, PDF enregistré.
-- À exécuter dans le SQL Editor Supabase (projet llkyzspixrbtoprtmvoh).
--
-- Principe : la COMMANDE reste la preuve et n'est JAMAIS modifiée. Un bulletin
-- est une photographie de ce qui part dans UN colis / UNE livraison. Une
-- commande peut en avoir plusieurs (1, 2, 3…), numérotés par commande.
--
-- Ne touche ni offres, ni drafts, ni data → aucun risque pour les 5 RPC du
-- connecteur (chercher_clients, dossier_client, chercher_commandes_magasin,
-- chercher_mails, chercher_pj).
-- ============================================================================

CREATE TABLE IF NOT EXISTS bulletins_livraison (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- La commande d'origine (slug + numéro affiché, dénormalisé pour l'historique)
  offre_slug text NOT NULL,
  numero_affiche text,

  -- Numéro du bulletin AU SEIN de la commande : 1, 2, 3…
  numero_bulletin integer NOT NULL,

  -- Mention libre imprimée sous le titre (« Livraison partielle 1/2 »,
  -- « Solde de commande »…). Vide = rien d'imprimé.
  mention text,

  -- Les lignes TELLES QU'IMPRIMÉES. Chaque ligne :
  --   { sourceId: string|null,   -- id de la ligne de la commande, null si ajoutée
  --     type: 'product'|'custom'|'comment'|'media',
  --     sku, title, qty, image?, mediaUrl?, mediaSize?, mediaSource? }
  -- JAMAIS de prix : le bulletin n'en porte pas.
  lines jsonb NOT NULL DEFAULT '[]'::jsonb,

  nb_lignes integer NOT NULL DEFAULT 0,   -- lignes article (hors comment/media)
  nb_pieces integer NOT NULL DEFAULT 0,   -- somme des quantités

  -- PDF généré par pdf.co, bucket pdfs, dossier bulletins/. NULL si la
  -- génération a échoué : la ligne reste (l'historique vaut plus que le PDF).
  pdf_url text,
  pdf_erreur text,

  cree_par text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Un numéro de bulletin ne sert qu'une fois par commande.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bulletins_livraison_slug_num
  ON bulletins_livraison (offre_slug, numero_bulletin);

CREATE INDEX IF NOT EXISTS idx_bulletins_livraison_slug
  ON bulletins_livraison (offre_slug, created_at DESC);

-- RLS activée, AUCUNE policy → déni par défaut pour anon ; seul le serveur
-- (service_role) lit et écrit. Même posture que pieces_jointes (doc 14 §4).
ALTER TABLE bulletins_livraison ENABLE ROW LEVEL SECURITY;

-- ── Contrôles après exécution ───────────────────────────────────────────────
-- select to_regclass('public.bulletins_livraison');             → la table
-- select relrowsecurity from pg_class
--   where oid = 'public.bulletins_livraison'::regclass;         → true
-- select count(*) from pg_policies
--   where tablename = 'bulletins_livraison';                    → 0
-- select id from storage.buckets where id = 'pdfs';            → 1 ligne (existe déjà)
