// lib/corrections-config.ts
// Source unique de vérité pour les champs corrigibles v1 (chantier corrections)
// Utilisé côté API (validation des PATCH) et côté front (drawer de correction)

/**
 * Liste blanche des champs qu'on autorise à modifier en v1 (corrections
 * cosmétiques). Tout autre champ envoyé dans `fields_changed` sera rejeté
 * par l'API avec un 400.
 *
 * Ces noms correspondent aux clés réelles dans la colonne `offres.data` (JSONB)
 * et/ou aux colonnes plates de la table `offres`.
 *
 * Champs explicitement HORS scope v1 (à voir en v2 avec workflow dédié) :
 * - commercial, type_client (Privé/Pro), validité de l'offre
 * - lignes, prix, remises, services, arrondi, TVA, totaux
 * - numero_offre / numero_commande (jamais modifiables)
 */
export const CORRECTIBLE_FIELDS_V1 = [
  // Bloc en-tête
  "modePaiement",
  "modeLivraison",

  // Bloc facturation
  "societe",
  "nom",
  "prenom",
  "complement_nom",
  "rue",
  "numero",
  "npa",
  "ville",
  "complement_adresse",
  "tel1",
  "tel2",
  "email",
  "delaiLivraison",

  // Bloc livraison (sub-bloc complet)
  "adresseLivraisonDifferente",
  "livr_societe",
  "livr_nom",
  "livr_prenom",
  "livr_complement_nom",
  "livr_rue",
  "livr_numero",
  "livr_npa",
  "livr_ville",
  "livr_complement_adresse",
  "livr_tel",
  "accesLivraison",

  // Bloc informations complémentaires
  "remarques",
  "notesInternes",
] as const;

export type CorrectibleFieldV1 = (typeof CORRECTIBLE_FIELDS_V1)[number];

/**
 * Champs qui identifient le client et peuvent affecter le rapprochement
 * statistique avec la fiche client dans le dashboard. Le drawer affiche
 * un avertissement informatif au moment de la confirmation si l'un de
 * ces champs est modifié (Option 1 du cadrage).
 */
export const CLIENT_IDENTITY_FIELDS = ["nom", "prenom", "email"] as const;

/**
 * Vérifie qu'un nom de champ est dans la whitelist v1.
 */
export function isCorrectibleField(fieldName: string): fieldName is CorrectibleFieldV1 {
  return (CORRECTIBLE_FIELDS_V1 as readonly string[]).includes(fieldName);
}