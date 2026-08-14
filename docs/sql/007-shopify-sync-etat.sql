-- ═══════════════════════════════════════════════════════════════════════
--  007 — Réparation de l'import Shopify : état persistant du sync
--  Appliqué en production le 14.08.2026
--
--  La panne : `syncShopifyOrders` parcourait les commandes triées par
--  CREATED_AT croissant en partant TOUJOURS du curseur nul, c'est-à-dire
--  de la première commande de janvier 2021. Il en traitait 500, butait sur
--  les 50 s de Vercel, et renvoyait un `nextCursor` « à relancer » que
--  personne ne relançait jamais.
--
--  Trace dans shopify_sync_log (runs 11 à 15, de mai à juillet 2026) :
--      orders_fetched: 500, orders_inserted: 0, orders_updated: 500,
--      status: running, next_cursor: <toujours le même, 22.05.2022>
--
--  Autrement dit : cinq exécutions de suite ont remis à jour les 500 mêmes
--  commandes de 2021-2022, et pas une seule commande récente n'a été
--  importée depuis le 13.07.2026.
--
--  La correction tient en deux points, côté code :
--    1. tri par UPDATED_AT + filtre `updated_at:>=<dernier import − 2 h>`
--       → une passe ne regarde que ce qui a bougé ;
--    2. le curseur d'une passe interrompue est mémorisé ICI, et la passe
--       suivante reprend à cet endroit au lieu de tout recommencer.
--
--  Automatisation : tâche planifiée Vercel horaire (vercel.json →
--  /api/cron/shopify-sync), protégée par CRON_SECRET.
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists shopify_sync_etat (
  id        int primary key default 1 check (id = 1),  -- ligne unique
  mode      text not null default 'incremental',       -- 'incremental' | 'backfill'
  curseur   text,                                      -- passe interrompue : où reprendre
  depuis    timestamptz,                               -- borne basse de la passe en cours
  maj_le    timestamptz not null default now(),
  dernier_message text
);

comment on table shopify_sync_etat is
  'Ligne unique. curseur non nul = une passe a été interrompue et doit reprendre là.';

insert into shopify_sync_etat (id) values (1) on conflict (id) do nothing;

alter table shopify_sync_etat enable row level security;
grant select on shopify_sync_etat to anon, authenticated, service_role;


-- ─────────────────────────────────────────────────────────────────────
-- Exploitation
-- ─────────────────────────────────────────────────────────────────────
-- État courant :
--   select * from shopify_sync_etat;
--
-- Retard actuel :
--   select max(created_at_shopify) from commandes_shopify;
--
-- Forcer une reconstruction complète depuis 2021 (long, plusieurs passes,
-- la reprise est automatique) :
--   update shopify_sync_etat set mode='backfill', curseur=null, depuis=null where id=1;
-- ou POST /api/shopify/sync-orders avec {"mode":"backfill","forcerRedemarrage":true}
--
-- Repartir proprement en incrémental :
--   update shopify_sync_etat set mode='incremental', curseur=null, depuis=null where id=1;
