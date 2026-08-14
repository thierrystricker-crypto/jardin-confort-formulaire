-- ═══════════════════════════════════════════════════════════════════════
--  008 — Surveillance de l'import Shopify
--  Appliqué en production le 14.08.2026
--
--  La panne de mai→juillet 2026 a duré trois mois parce que rien ne la
--  signalait : le journal `shopify_sync_log` enregistrait bien cinq
--  passages consécutifs à « 0 commande ajoutée, curseur toujours en
--  attente », mais personne ne le lisait.
--
--  Deux ajouts :
--    • `curseur_depuis` — l'horodatage du moment où un curseur s'est
--      retrouvé en attente. S'il ne bouge pas de passage en passage, c'est
--      que le rattrapage n'avance pas : c'est ce signal que la tâche
--      planifiée surveille (seuil 6 h → notification interne).
--    • `shopify_sync_historique` — le journal en clair, affiché dans
--      /dashboard/statistiques sans avoir à ouvrir Supabase.
-- ═══════════════════════════════════════════════════════════════════════

alter table shopify_sync_etat add column if not exists curseur_depuis timestamptz;

comment on column shopify_sync_etat.curseur_depuis is
  'Posé quand une passe laisse un curseur en attente alors qu''il n''y en avait pas ; effacé dès qu''une passe va au bout. Un curseur qui traîne = rattrapage bloqué.';

create or replace view shopify_sync_historique
with (security_invoker = on)
as
select
  l.id,
  l.sync_type,
  l.started_at,
  l.finished_at,
  l.status,
  coalesce(l.orders_inserted, 0) as ajoutees,
  coalesce(l.orders_updated, 0)  as mises_a_jour,
  coalesce(l.clients_created, 0) as clients_crees,
  (l.details->>'duration_ms')::bigint as duree_ms,
  coalesce((l.details->>'has_more')::boolean, false) as reste_a_traiter,
  l.errors
from shopify_sync_log l
order by l.started_at desc;

grant select on shopify_sync_historique to anon, authenticated, service_role;


-- ─────────────────────────────────────────────────────────────────────
-- Les alertes passent par la table `notifications` existante, type
-- 'shopify_sync_erreur' — même centre de notifications que le reste du
-- dashboard, avec le badge dans la barre du haut. Une seule alerte non lue
-- à la fois (createNotificationUnique, fenêtre 12 h) : sinon une tâche
-- horaire empilerait 24 notifications par jour tant que le souci dure.
--
-- Trois déclencheurs, dans /api/cron/shopify-sync :
--   1. la passe lève une exception ;
--   2. la passe remonte des erreurs par lot ;
--   3. un curseur est en attente depuis plus de 6 h — le symptôme exact
--      qui est passé inaperçu trois mois.
-- ─────────────────────────────────────────────────────────────────────

-- Contrôles
-- select * from shopify_sync_historique limit 15;
-- select * from shopify_sync_etat;
-- select * from notifications where type = 'shopify_sync_erreur' order by created_at desc;
