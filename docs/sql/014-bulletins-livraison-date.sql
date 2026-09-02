-- ============================================================================
-- Migration : bulletins_livraison.date_bulletin
-- Date : 2026-09-02 (même chantier que 013, décision prise après le premier test)
-- À exécuter dans le SQL Editor Supabase (projet llkyzspixrbtoprtmvoh).
--
-- Règle métier (Thierry) : la date du bulletin (= date d'envoi) est
-- INDÉPENDANTE de la date de commande — aucun lien — sauf qu'elle ne peut
-- jamais lui être antérieure. La borne est vérifiée par la route POST (elle
-- lit offres.date_document) et par la page ; la base ne porte que la colonne.
-- ============================================================================

ALTER TABLE bulletins_livraison
  ADD COLUMN IF NOT EXISTS date_bulletin date;

-- Les bulletins déjà enregistrés (tests du 02.09) prennent leur jour de création
UPDATE bulletins_livraison
   SET date_bulletin = (created_at AT TIME ZONE 'Europe/Zurich')::date
 WHERE date_bulletin IS NULL;

-- Contrôle : select numero_bulletin, date_bulletin, created_at from bulletins_livraison order by created_at;
