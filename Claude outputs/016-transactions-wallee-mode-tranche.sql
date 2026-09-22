-- ============================================================================
-- Migration 016 : transactions_wallee — colonnes mode + tranche
-- Date : 2026-09-05 — chantier « Wallee v2 : TWINT/PostFinance/PayPal + solde
--        + QR-facture sur la page de confirmation » (suite de 015, 04.09.2026)
-- À exécuter dans le SQL Editor Supabase (projet llkyzspixrbtoprtmvoh).
--
-- Pourquoi :
--   - mode    = le GROUPE de moyens de paiement autorisés sur la transaction :
--               'qr'    → virement bancaire avec QR-facture (méthode 243711)
--               'twint' → TWINT / PostFinance Pay / e-finance / Carte PostFinance /
--                         PayPal (liste explicite, JAMAIS 255090 « Facture »)
--               ('carte' est réservé pour un futur prestataire cartes, hors Wallee)
--   - tranche = ce que le lien encaisse : 'acompte' (50 % ou 100 % selon le
--               mode de paiement du document) ou 'solde' (total − acompte,
--               créé à la demande par le vendeur quand la livraison approche).
--
-- Règle métier (Thierry, 04.09.2026) : les liens QR et TWINT d'une même
-- commande vivent EN PARALLÈLE (le client choisit, le QR reste actif). La
-- règle « une seule transaction vivante par commande » devient
-- « une seule vivante par (commande, mode, tranche) » — appliquée dans la
-- route, pas par contrainte SQL (l'historique des échecs reste en table).
--
-- Aucune colonne de offres touchée (les 5 RPC du connecteur hors de cause).
-- Les lignes existantes (587401300 témoin, CMD-80947, CMD-80953…) sont toutes
-- des liens QR d'acompte : les DEFAULT les qualifient correctement.
-- ============================================================================

ALTER TABLE transactions_wallee
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'qr',
  ADD COLUMN IF NOT EXISTS tranche text NOT NULL DEFAULT 'acompte';

ALTER TABLE transactions_wallee
  DROP CONSTRAINT IF EXISTS transactions_wallee_mode_check,
  ADD CONSTRAINT transactions_wallee_mode_check
    CHECK (mode IN ('qr', 'twint', 'carte'));

ALTER TABLE transactions_wallee
  DROP CONSTRAINT IF EXISTS transactions_wallee_tranche_check,
  ADD CONSTRAINT transactions_wallee_tranche_check
    CHECK (tranche IN ('acompte', 'solde'));

CREATE INDEX IF NOT EXISTS transactions_wallee_slug_mode_tranche_idx
  ON transactions_wallee (commande_slug, mode, tranche, created_at DESC);

-- Contrôle :
-- select commande_slug, merchant_reference, mode, tranche, montant, state, created_at
--   from transactions_wallee order by created_at desc;
