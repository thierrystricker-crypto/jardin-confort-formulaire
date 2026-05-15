-- ============================================================
-- Session 2 : RPC next_dra_numero()
-- Chantier brouillons (feature/brouillons)
-- Date : 2026-05-14
-- ============================================================
-- Fonction de numérotation des brouillons.
-- Renvoie le prochain numéro formaté DRA-XXX (3 chiffres, padding zéros).
--
-- Décisions de design (voir journal-brouillons.md) :
--   - Utilise la séquence drafts_numero_seq (créée en Session 1)
--     plutôt qu'un COUNT(*) comme next_dev_numero, car les brouillons
--     sont purgés physiquement après 30j et la séquence reste stable
--     face à la purge (DRA-042 ne sera jamais réutilisé).
--   - Pas d'argument (contrairement à next_dev_numero qui prend
--     l'année) car les brouillons n'ont pas de notion d'année.
--   - LANGUAGE plpgsql / SECURITY INVOKER (cohérent avec
--     next_dev_numero / next_cmd_numero).
-- ============================================================

CREATE OR REPLACE FUNCTION next_dra_numero()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_numero INT;
BEGIN
  v_numero := nextval('drafts_numero_seq');
  RETURN 'DRA-' || LPAD(v_numero::TEXT, 3, '0');
END;
$$;