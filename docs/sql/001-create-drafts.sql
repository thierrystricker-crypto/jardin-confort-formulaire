-- ============================================================
-- Session 1 : Création de la table `drafts` (brouillons)
-- Chantier brouillons (feature/brouillons)
-- Date : 2026-05-14
-- ============================================================
-- Ce script DROP la table drafts existante et la recrée
-- avec une structure complète alignée sur la table `offres`.
--
-- Décisions de design (voir journal-brouillons.md) :
--   - id en bigint (cohérence avec offres)
--   - RLS désactivée (cohérence avec offres, sécurité gérée côté API
--     via SUPABASE_SERVICE_ROLE_KEY)
--   - Toutes les colonnes pertinentes de offres sont répliquées
--   - Colonnes spécifiques aux brouillons :
--       numero_draft, numero_affiche, transformed_at,
--       transformed_into_offre_slug, archived
--   - Trigger automatique pour updated_at à chaque UPDATE
-- ============================================================

-- ─── Nettoyage de l'existant ──────────────────────────────────
DROP TABLE IF EXISTS drafts CASCADE;
DROP SEQUENCE IF EXISTS drafts_numero_seq CASCADE;
DROP SEQUENCE IF EXISTS drafts_id_seq CASCADE;

-- ─── Séquences ────────────────────────────────────────────────
CREATE SEQUENCE drafts_id_seq START 1;
CREATE SEQUENCE drafts_numero_seq START 1;

-- ─── Table drafts ─────────────────────────────────────────────
CREATE TABLE drafts (
  -- Identifiants
  id              bigint PRIMARY KEY DEFAULT nextval('drafts_id_seq'),
  slug            text UNIQUE NOT NULL,
  numero_draft    int NOT NULL,
  numero_affiche  text,

  -- Métadonnées document
  type_document   text NOT NULL DEFAULT 'Brouillon',
  reference       text,
  date_document   date,
  commercial      text,
  validite_duree  text DEFAULT '30 jours',

  -- Modes
  payment_mode    text,
  delivery_mode   text,
  lead_time       text,
  client_type     text,

  -- Client
  client_societe        text,
  client_nom            text,
  client_prenom         text,
  client_complement_nom text,
  client_email          text,
  client_tel1           text,
  client_tel2           text,
  client_rue            text,
  client_numero         text,
  client_npa            text,
  client_ville          text,
  client_numero_client  text,

  -- Livraison
  livr_diff            boolean DEFAULT false,
  livr_societe         text,
  livr_nom             text,
  livr_prenom          text,
  livr_complement_nom  text,
  livr_tel             text,
  livr_rue             text,
  livr_numero          text,
  livr_npa             text,
  livr_ville           text,

  -- Totaux
  sous_total      numeric DEFAULT 0,
  remise_chf      numeric DEFAULT 0,
  services_total  numeric DEFAULT 0,
  arrondi         numeric DEFAULT 0,
  tva_montant     numeric DEFAULT 0,
  total_ttc       numeric DEFAULT 0,
  nb_articles     integer DEFAULT 0,

  -- Notes
  remarques        text,
  notes_internes   text,
  note_commerciale text,

  -- Données complètes (lignes, services, ambianceImages, etc.)
  data jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Timestamps
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- Cycle de vie brouillon
  transformed_at              timestamptz,
  transformed_into_offre_slug text,
  archived                    boolean DEFAULT false
);

-- ─── RLS désactivée (cohérence avec offres) ───────────────────
ALTER TABLE drafts DISABLE ROW LEVEL SECURITY;

-- ─── Index ────────────────────────────────────────────────────
CREATE INDEX drafts_archived_idx       ON drafts(archived);
CREATE INDEX drafts_transformed_at_idx ON drafts(transformed_at);
CREATE INDEX drafts_commercial_idx     ON drafts(commercial);
CREATE INDEX drafts_updated_at_idx     ON drafts(updated_at DESC);

-- ─── Trigger updated_at automatique ───────────────────────────
CREATE OR REPLACE FUNCTION drafts_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS drafts_updated_at_trigger ON drafts;
CREATE TRIGGER drafts_updated_at_trigger
BEFORE UPDATE ON drafts
FOR EACH ROW
EXECUTE FUNCTION drafts_set_updated_at();