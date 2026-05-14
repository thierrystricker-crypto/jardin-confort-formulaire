-- docs/sql/003-rpc-transformer-draft.sql
-- Session 5 — Transformation atomique brouillon → offre
-- Toujours en Offre (jamais directement en Commande)
-- Reproduit fidèlement la branche "Offre" de /api/offres/save
--
-- NOTE: la colonne offres.numero_affiche est une GENERATED column côté Postgres.
-- On NE la liste PAS dans l'INSERT, elle est calculée automatiquement à partir
-- de numero_offre / numero_commande. C'est le même comportement que save/route.ts.

CREATE OR REPLACE FUNCTION transformer_draft(p_slug TEXT)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_draft RECORD;
  v_numero TEXT;
  v_offre_slug TEXT;
  v_annee INT;
  v_token TEXT;
  v_data JSONB;
BEGIN
  -- 1. Lock + chargement du brouillon (FOR UPDATE = pas de race condition)
  SELECT * INTO v_draft FROM drafts WHERE slug = p_slug FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DRAFT_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- 2. Refuser si déjà transformé
  IF v_draft.transformed_at IS NOT NULL THEN
    RAISE EXCEPTION 'ALREADY_TRANSFORMED:%', v_draft.transformed_into_offre_slug
      USING ERRCODE = 'P0002';
  END IF;

  -- 3. Générer numéro d'offre via la séquence existante
  v_annee := EXTRACT(YEAR FROM NOW())::INT;
  SELECT next_dev_numero(v_annee) INTO v_numero;

  -- 4. Générer slug avec token aléatoire de 5 chars (reproduction de makeSlug() côté JS)
  v_token := substring(md5(random()::text || clock_timestamp()::text), 1, 5);
  v_offre_slug := lower(v_numero) || '-' || v_token;

  -- 5. Préparer data enrichi : traçabilité + force formType=Offre + offerNumber officiel
  v_data := COALESCE(v_draft.data, '{}'::jsonb)
    || jsonb_build_object(
      'fromDraftSlug', p_slug,
      'formType', 'Offre',
      'offerNumber', v_numero
    );

  -- 6. INSERT dans offres (recopie complète)
  -- numero_affiche NON listée : c'est une GENERATED column, Postgres la calcule
  INSERT INTO offres (
    slug,
    type_document,
    numero_offre,
    reference,
    statut,
    date_document,
    commercial,
    client_type,
    payment_mode,
    delivery_mode,
    lead_time,
    validite_duree,
    client_societe, client_nom, client_prenom, client_complement_nom,
    client_email, client_tel1, client_tel2,
    client_rue, client_numero, client_npa, client_ville,
    livr_diff,
    livr_societe, livr_nom, livr_prenom, livr_complement_nom,
    livr_tel, livr_rue, livr_numero, livr_npa, livr_ville,
    sous_total, remise_chf, services_total, arrondi,
    tva_montant, total_ttc, nb_articles,
    remarques, notes_internes,
    data
  )
  VALUES (
    v_offre_slug,
    'Offre',
    v_numero,
    v_draft.reference,
    'En cours',
    v_draft.date_document,
    v_draft.commercial,
    v_draft.client_type,
    v_draft.payment_mode,
    v_draft.delivery_mode,
    v_draft.lead_time,
    COALESCE(v_draft.validite_duree, '30 jours'),
    v_draft.client_societe, v_draft.client_nom, v_draft.client_prenom,
    v_draft.client_complement_nom,
    v_draft.client_email, v_draft.client_tel1, v_draft.client_tel2,
    v_draft.client_rue, v_draft.client_numero, v_draft.client_npa, v_draft.client_ville,
    COALESCE(v_draft.livr_diff, FALSE),
    v_draft.livr_societe, v_draft.livr_nom, v_draft.livr_prenom,
    v_draft.livr_complement_nom,
    v_draft.livr_tel, v_draft.livr_rue, v_draft.livr_numero,
    v_draft.livr_npa, v_draft.livr_ville,
    COALESCE(v_draft.sous_total, 0),
    COALESCE(v_draft.remise_chf, 0),
    COALESCE(v_draft.services_total, 0),
    COALESCE(v_draft.arrondi, 0),
    COALESCE(v_draft.tva_montant, 0),
    COALESCE(v_draft.total_ttc, 0),
    COALESCE(v_draft.nb_articles, 0),
    v_draft.remarques,
    v_draft.notes_internes,
    v_data
  );

  -- 7. UPDATE draft : marquer transformé (verrou levé en fin de transaction)
  UPDATE drafts SET
    transformed_at = NOW(),
    transformed_into_offre_slug = v_offre_slug,
    archived = TRUE,
    updated_at = NOW()
  WHERE slug = p_slug;

  -- 8. Retour
  RETURN jsonb_build_object(
    'offre_slug', v_offre_slug,
    'offre_numero', v_numero
  );
END;
$$;