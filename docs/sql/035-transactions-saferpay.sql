-- ============================================================================
-- Migration 035 : paiement par carte Saferpay + réparation de transactions_wallee
-- Date : 2026-11-02 — chantier « Lien carte Saferpay »
-- À exécuter dans le SQL Editor Supabase (projet llkyzspixrbtoprtmvoh).
--
-- PARTIE 1 — transactions_saferpay (nouvelle)
--   Table SŒUR de transactions_wallee, même philosophie :
--     transactions_saferpay = ce qu'on a DEMANDÉ au client par carte,
--     quel que soit le statut (OPEN, PAID, EXPIRED, DISABLED).
--   Un lien Saferpay est un « Secure PayGate Single-Use Payment Link » créé par
--   POST /rest/customers/{customerId}/terminals/{terminalId}/spg-offers.
--   ⚠️ Contrairement à Wallee, on STOCKE le lien : celui de Saferpay est stable
--   et valable jusqu'à sa date d'expiration (ici +30 j), c'est lui qu'on envoie
--   au client. L'URL Wallee, elle, était tokenisée et jetable.
--   Clé de rattachement à la commande : merchant_reference = numero_affiche,
--   envoyé à Saferpay comme Payment.OrderId et ressorti tel quel sur la page de
--   confirmation (prouvé en test le 02.11.2026, CMD-TEST-001).
--
-- PARTIE 2 — transactions_wallee : colonnes mode + tranche
--   La migration 016 (écrite le 05.09.2026) n'a JAMAIS été exécutée, alors que
--   le code qui en dépend est parti en production : la route
--   /api/wallee-transactions sélectionne `mode` et `tranche`, échoue, et le
--   composant — qui rend `null` en cas d'erreur — faisait disparaître le bloc
--   Wallee de la fiche commande sans le moindre message. Ces trois lignes
--   referment la panne. Le fichier 016 est supprimé du dépôt dans le même
--   commit : un script de migration jamais appliqué, coincé au milieu d'une
--   série exécutée jusqu'à 034, est un piège.
--
--   'twint' disparaît des valeurs admises : TWINT passe désormais par Saferpay.
--   Wallee ne garde que le QR-facture et PostFinance / PayPal.
--
-- Aucune colonne de `offres` touchée → les 5 RPC du connecteur jardi-mail-mcp
-- (chercher_clients, dossier_client, chercher_commandes_magasin, chercher_mails,
-- chercher_pj) sont hors de cause.
-- ============================================================================

-- ─── PARTIE 1 ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS transactions_saferpay (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  offer_id            text NOT NULL UNIQUE,   -- OfferId Saferpay (uuid)
  commande_slug       text NOT NULL,
  merchant_reference  text NOT NULL,          -- = numero_affiche (CMD-80666)
  montant             numeric NOT NULL,       -- en CHF, pas en centimes
  devise              text NOT NULL DEFAULT 'CHF',
  tranche             text NOT NULL DEFAULT 'acompte',
  libelle             text,
  statut              text NOT NULL DEFAULT 'OPEN',
  transaction_id      text,                   -- rempli quand le client a payé
  payment_link        text NOT NULL,          -- https://www.saferpay.com/SPG/s/…
  expiration_date     timestamptz,
  paid_at             timestamptz,
  statut_checked_at   timestamptz,
  environnement       text NOT NULL DEFAULT 'production',  -- 'test' | 'production'
  raw                 jsonb
);

ALTER TABLE transactions_saferpay
  DROP CONSTRAINT IF EXISTS transactions_saferpay_statut_check,
  ADD CONSTRAINT transactions_saferpay_statut_check
    CHECK (statut IN ('OPEN', 'PAID', 'EXPIRED', 'DISABLED'));

ALTER TABLE transactions_saferpay
  DROP CONSTRAINT IF EXISTS transactions_saferpay_tranche_check,
  ADD CONSTRAINT transactions_saferpay_tranche_check
    CHECK (tranche IN ('acompte', 'solde'));

CREATE INDEX IF NOT EXISTS transactions_saferpay_slug_idx
  ON transactions_saferpay (commande_slug, tranche, created_at DESC);

CREATE INDEX IF NOT EXISTS transactions_saferpay_reference_idx
  ON transactions_saferpay (merchant_reference);

-- Les lignes encore ouvertes, relues par le cron.
CREATE INDEX IF NOT EXISTS transactions_saferpay_ouvertes_idx
  ON transactions_saferpay (statut) WHERE statut = 'OPEN';

-- Même posture que acomptes_wallee, transactions_wallee et qr_libres :
-- RLS activée SANS policy, seul le service_role (routes API) y accède.
ALTER TABLE transactions_saferpay ENABLE ROW LEVEL SECURITY;

-- ─── PARTIE 2 ───────────────────────────────────────────────────────────────

ALTER TABLE transactions_wallee
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'qr',
  ADD COLUMN IF NOT EXISTS tranche text NOT NULL DEFAULT 'acompte';

ALTER TABLE transactions_wallee
  DROP CONSTRAINT IF EXISTS transactions_wallee_mode_check,
  ADD CONSTRAINT transactions_wallee_mode_check
    CHECK (mode IN ('qr', 'postfinance'));

ALTER TABLE transactions_wallee
  DROP CONSTRAINT IF EXISTS transactions_wallee_tranche_check,
  ADD CONSTRAINT transactions_wallee_tranche_check
    CHECK (tranche IN ('acompte', 'solde'));

CREATE INDEX IF NOT EXISTS transactions_wallee_slug_mode_tranche_idx
  ON transactions_wallee (commande_slug, mode, tranche, created_at DESC);

-- ─── Contrôles ──────────────────────────────────────────────────────────────
-- select commande_slug, merchant_reference, tranche, montant, statut,
--        expiration_date, paid_at, environnement, created_at
--   from transactions_saferpay order by created_at desc;
--
-- select commande_slug, merchant_reference, mode, tranche, montant, state
--   from transactions_wallee order by created_at desc;
