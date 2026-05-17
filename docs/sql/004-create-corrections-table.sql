-- ============================================================================
-- Migration : table corrections (chantier corrections v1)
-- Date : 2026-05-17
-- Description : Table polymorphe pour tracer les corrections cosmétiques
--               sur les offres (DEV-XXXX) et commandes (CMD-XXXXX), stockées
--               dans la même table `offres` distinguée par `type_document`.
-- ============================================================================

CREATE TABLE IF NOT EXISTS corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Cible de la correction (polymorphe au sens "offre" vs "commande" métier,
  -- mais en pratique toutes les corrections pointent vers la table `offres`
  -- distinguée par `type_document`)
  entity_type text NOT NULL CHECK (entity_type IN ('offre', 'commande')),
  entity_id bigint NOT NULL,
  entity_slug text NOT NULL,
  entity_numero text NOT NULL,

  -- Métadonnées
  corrected_at timestamptz NOT NULL DEFAULT now(),
  corrected_by text NOT NULL CHECK (length(trim(corrected_by)) >= 2),

  -- Contenu de la correction
  fields_changed jsonb NOT NULL,
  reason text NOT NULL CHECK (length(trim(reason)) >= 5),

  -- Suivi PDF (utile pour retry si pdf.co timeout)
  pdf_regenerated_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_corrections_entity
  ON corrections (entity_type, entity_id, corrected_at DESC);

CREATE INDEX IF NOT EXISTS idx_corrections_slug
  ON corrections (entity_slug);

ALTER TABLE corrections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "corrections_select_all"
  ON corrections
  FOR SELECT
  USING (true);

CREATE POLICY "corrections_insert_all"
  ON corrections
  FOR INSERT
  WITH CHECK (true);

-- Pas de policy UPDATE ni DELETE = bloqués par défaut = historique immuable.