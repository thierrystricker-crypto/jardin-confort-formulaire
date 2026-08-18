-- ============================================================================
-- Migration : table pieces_jointes + bucket annexes (doc 14 §4, tranche §6)
-- Date : 2026-08-18
-- Chantier : Scan Lot 2 (archive des scans AVANT purge côté Anthropic) —
--            absorbe la tranche minimale du chantier annexes (doc 14 §6).
-- À exécuter dans le SQL Editor Supabase (projet llkyzspixrbtoprtmvoh).
-- Diagnostic préalable (18.08.2026, lecture seule) :
--   - to_regclass('public.pieces_jointes') → NULL (la table n'existe pas)
--   - storage.buckets → brand-logos / factures / pdfs uniquement
-- ============================================================================

-- ── 1. Table polymorphe, sur le modèle de `corrections` ─────────────────────
-- Ne touche ni offres, ni drafts, ni data → aucun risque pour les 5 RPC
-- du connecteur.

CREATE TABLE IF NOT EXISTS pieces_jointes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Cible (NULL tant que le brouillon n'est pas créé / rattaché — doc 14 §6 ;
  -- le rattachement au DRA arrive avec le chantier annexes, pas au Lot 2)
  entity_type text CHECK (entity_type IN ('draft', 'offre', 'commande')),
  entity_id bigint,
  entity_slug text,

  categorie text NOT NULL DEFAULT 'autre'
    CHECK (categorie IN ('scan_commande', 'plan_client', 'photo', 'document', 'autre')),

  -- Le nom d'origine ne vit QU'ICI (jamais dans le chemin ni les URL :
  -- le photocopieur écrit « …53864_RAPPAZ__MAXIME… » dans ses noms de fichier)
  nom_fichier text NOT NULL,
  libelle text,

  -- Chemin Storage : <entity_type|chat>/<uuid>.<ext> — UUID, jamais le nom
  chemin text NOT NULL,
  mime text NOT NULL,
  taille_octets bigint NOT NULL,
  content_hash text,               -- déduplication, motif de mails_pj_hash

  ajoute_par text NOT NULL DEFAULT 'Claude',
  visibilite text NOT NULL DEFAULT 'interne',   -- inerte en v1 (doc 14 §4)

  -- Spécifique Lot 2 : identifiant du fichier côté API Files d'Anthropic.
  -- Non NULL = une copie existe encore chez Anthropic ; la purge planifiée
  -- (TTL 24 h) supprime cette copie PUIS remet la colonne à NULL.
  -- La purge ne s'applique QUE si l'archive locale existe (cette ligne).
  claude_file_id text,

  created_at timestamptz NOT NULL DEFAULT now(),
  supprime_at timestamptz          -- suppression douce (doc 14 §5.3)
);

CREATE INDEX IF NOT EXISTS idx_pieces_jointes_entity
  ON pieces_jointes (entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_pieces_jointes_slug
  ON pieces_jointes (entity_slug);

CREATE INDEX IF NOT EXISTS idx_pieces_jointes_categorie
  ON pieces_jointes (categorie);

CREATE INDEX IF NOT EXISTS idx_pieces_jointes_hash
  ON pieces_jointes (content_hash);

-- Purge : recherche des copies Anthropic à supprimer (partiel, quasi vide)
CREATE INDEX IF NOT EXISTS idx_pieces_jointes_claude_file
  ON pieces_jointes (created_at)
  WHERE claude_file_id IS NOT NULL;

-- RLS activée, AUCUNE policy → déni par défaut pour anon ; seul le serveur
-- (service_role) lit et écrit. Posture doc 14 §4.
ALTER TABLE pieces_jointes ENABLE ROW LEVEL SECURITY;

-- ── 2. Bucket `annexes` — public comme les 3 existants, mais borné ──────────
-- (contrairement à pdfs/factures : plafond + liste blanche MIME au niveau
-- du bucket, sur le modèle de brand-logos ; jamais de SVG ni d'exécutable)

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'annexes',
  'annexes',
  true,
  20971520,  -- 20 Mo (doc 14) ; le Lot 2 borne de toute façon à 4 Mo côté route
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
ON CONFLICT (id) DO NOTHING;

-- ── 3. Contrôles après exécution ────────────────────────────────────────────
-- select to_regclass('public.pieces_jointes');                  → doit rendre la table
-- select relrowsecurity from pg_class
--   where oid = 'public.pieces_jointes'::regclass;              → true
-- select id, public, file_size_limit, allowed_mime_types
--   from storage.buckets where id = 'annexes';                  → 1 ligne
-- select count(*) from pg_policies
--   where tablename = 'pieces_jointes';                         → 0 (aucune policy)
