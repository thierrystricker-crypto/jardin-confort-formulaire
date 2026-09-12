-- ============================================================================
-- Migration : table listes_achat
-- Date : 2026-09-12 — chantier « Stock list » (listes d'achat / pré-commande)
-- À exécuter dans le SQL Editor Supabase (projet llkyzspixrbtoprtmvoh — l'app,
-- PAS le webshop).
--
-- Une liste d'achat = un panier de variantes choisies dans la page Stock list,
-- nommé, sauvegardé, rappelable, transformable en brouillon (DRA-xxx) en un
-- clic. Les prix ne sont JAMAIS stockés ici : ils sont relus chez Shopify au
-- moment de créer le brouillon.
--
-- lignes : jsonb, tableau de
--   { fournisseur, sku, titre, variante_titre, variant_id, product_id,
--     statut_fiche, qty, image_url }
-- Les SKU hors Shopify (variant_id null) deviennent des lignes « custom » du
-- brouillon, à compléter par le vendeur (prix à 0).
--
-- est_modele : les vendeurs revendent souvent les mêmes combos (socle + poids +
-- tube + parasol). Une liste « modèle » est un gabarit : on la charge dans le
-- panier (copie), on ajuste, on transforme la copie — le modèle reste intact.
-- ============================================================================

CREATE TABLE IF NOT EXISTS listes_achat (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  nom           text NOT NULL,
  cree_par      text,                                  -- prénom (EQUIPE_JARDI)
  statut        text NOT NULL DEFAULT 'ouverte'
                CHECK (statut IN ('ouverte', 'transformee', 'archivee')),
  lignes        jsonb NOT NULL DEFAULT '[]'::jsonb,
  nb_articles   integer NOT NULL DEFAULT 0,            -- somme des qty, maintenu par l'API
  notes         text,
  est_modele    boolean NOT NULL DEFAULT false,        -- combo réutilisable (socle + poids + tube + parasol…) :
                                                       -- jamais transformé lui-même, on part d'une copie
  draft_slug    text,                                  -- renseigné à la transformation
  draft_numero  text                                   -- DRA-xxx
);

CREATE INDEX IF NOT EXISTS listes_achat_statut_idx
  ON listes_achat (statut, updated_at DESC);

-- Même posture que transactions_wallee et qr_libres : RLS activée SANS policy,
-- seul le service_role (routes API) y accède.
ALTER TABLE listes_achat ENABLE ROW LEVEL SECURITY;

-- Contrôle :
-- select nom, cree_par, statut, nb_articles, draft_numero, updated_at
--   from listes_achat order by updated_at desc;
