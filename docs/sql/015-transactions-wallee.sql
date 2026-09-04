-- ============================================================================
-- Migration : table transactions_wallee
-- Date : 2026-09-04 — chantier « Lien de paiement Wallee » (suite de
--        « Acompte payé visible », 03.09.2026)
-- À exécuter dans le SQL Editor Supabase (projet llkyzspixrbtoprtmvoh).
--
-- Table SŒUR de acomptes_wallee, volontairement séparée :
--   - transactions_wallee = ce qu'on a DEMANDÉ au client (transaction créée
--     depuis le dashboard, quel que soit son état : PENDING, CONFIRMED,
--     FAILED, FULFILL…) ;
--   - acomptes_wallee     = ce qu'il a PAYÉ (une ligne = FULFILL, rien d'autre,
--     écrite uniquement par le webhook). Invariant du doc 02 conservé.
-- Le lien entre les deux est wallee_transaction_id.
--
-- Aucune colonne de offres touchée (les 5 RPC du connecteur sont hors de cause).
-- L'URL de page de paiement n'est JAMAIS stockée : tokenisée et temporaire,
-- elle est régénérée à la demande par GET /api/wallee-transactions.
-- ============================================================================

CREATE TABLE IF NOT EXISTS transactions_wallee (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  wallee_transaction_id bigint NOT NULL UNIQUE,
  commande_slug         text NOT NULL,
  merchant_reference    text NOT NULL,          -- = numero_affiche (CMD-80666)
  montant               numeric NOT NULL,       -- montant demandé (50 % ou 100 %)
  devise                text NOT NULL DEFAULT 'CHF',
  is_acompte            boolean NOT NULL,       -- true = 50 %, false = 100 %
  libelle               text,                   -- « Acompte 50% à la commande » / « Paiement d'avance à la commande »
  state                 text NOT NULL,          -- état Wallee tel que relu en dernier
  state_checked_at      timestamptz,            -- dernière relecture chez Wallee
  raw                   jsonb                   -- extrait de la transaction Wallee (sans URL)
);

CREATE INDEX IF NOT EXISTS transactions_wallee_slug_idx
  ON transactions_wallee (commande_slug, created_at DESC);

-- Même posture que acomptes_wallee et qr_libres : RLS activée SANS policy,
-- seul le service_role (routes API) y accède.
ALTER TABLE transactions_wallee ENABLE ROW LEVEL SECURITY;

-- Contrôle :
-- select commande_slug, merchant_reference, montant, state, state_checked_at, created_at
--   from transactions_wallee order by created_at desc;
