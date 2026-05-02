-- ═══════════════════════════════════════════════════════════════
--  Notifications internes + Healthcheck Make
--  À exécuter dans l'éditeur SQL de Supabase
-- ═══════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────
-- TABLE 1 : notifications
-- Liste des événements importants à signaler à l'équipe
-- (commande validée, commande directe, abandon offre...)
-- ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id BIGSERIAL PRIMARY KEY,

  -- Type d'événement
  type TEXT NOT NULL,                -- 'commande_validee' | 'commande_directe' | 'offre_abandonnee'

  -- Liens vers le document concerné
  offre_slug TEXT,
  numero_affiche TEXT,
  type_document TEXT,                -- 'Offre' | 'Commande'

  -- Infos client (dénormalisées pour requêtes rapides)
  client_nom TEXT,
  client_prenom TEXT,
  client_societe TEXT,

  -- Infos commerciales
  commercial TEXT,
  total_ttc NUMERIC,
  payment_mode TEXT,

  -- Message d'affichage
  titre TEXT,                        -- ex: "Nouvelle commande validée online"
  message TEXT,                      -- ex: "Stricker Thierry · CHF 1'345.00"

  -- Marquage comme vue (partagé pour l'instant)
  vue BOOLEAN NOT NULL DEFAULT FALSE,
  vue_at TIMESTAMPTZ,
  vue_par TEXT,                      -- nom du commercial qui a marqué comme vu

  -- Timestamp de création
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index pour récupérer rapidement les non-lues
CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON notifications (created_at DESC)
  WHERE vue = FALSE;

-- Index global ordre temporel
CREATE INDEX IF NOT EXISTS idx_notifications_created
  ON notifications (created_at DESC);


-- ───────────────────────────────────────────────
-- TABLE 2 : make_pings
-- Healthcheck : Make ping chaque fois qu'il traite avec succès
-- une commande validée. Ça nous permet de détecter si Make est HS.
-- ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS make_pings (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'make',         -- 'make' | 'vercel' | 'manual'
  event TEXT NOT NULL,                         -- 'flow_completed' | 'flow_started' | 'flow_error'
  scenario_name TEXT,                          -- ex: 'validation_offre'
  run_id TEXT,                                 -- ID de run Make
  offre_slug TEXT,
  numero_affiche TEXT,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_make_pings_recent
  ON make_pings (created_at DESC);


-- ───────────────────────────────────────────────
-- (OPTIONNEL) RLS désactivé : ces tables ne sont accédées que
-- par l'API admin avec service_role. Pas besoin de policies.
-- ───────────────────────────────────────────────
ALTER TABLE notifications DISABLE ROW LEVEL SECURITY;
ALTER TABLE make_pings DISABLE ROW LEVEL SECURITY;