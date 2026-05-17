// lib/corrections-config.ts
// Source unique de vérité pour les champs corrigibles v1 (chantier corrections)
// Utilisé côté API (validation des PATCH) et côté front (drawer de correction)
//
// IMPORTANT : les noms ci-dessous sont les clés du JSONB `offres.data` telles
// que produites par le formulaire de création (cf. app/api/offres/save/route.ts).
// Ce ne sont PAS les labels UI ni les noms des colonnes plates.

/**
 * Liste blanche des champs qu'on autorise à modifier en v1 (corrections
 * cosmétiques). Tout autre champ envoyé dans `fields_changed` sera rejeté
 * par l'API avec un 400.
 *
 * Champs explicitement HORS scope v1 (à voir en v2 avec workflow dédié) :
 * - commercial, clientType (Privé/Pro), validiteDuree
 * - lines, discount, discountPercent, enabledServices, servicePrices,
 *   manualRounding, ambianceImages
 * - offerNumber, offerStatus, formType (jamais modifiables)
 */
export const CORRECTIBLE_FIELDS_V1 = [
  // Bloc en-tête (métadonnées document)
  "paymentMode",
  "deliveryMode",
  "leadTime",

  // Bloc facturation
  "societe",
  "nom",
  "prenom",
  "complement_nom",
  "rue",
  "numero",
  "rue2",
  "npa",
  "ville",
  "telephone1",
  "telephone2",
  "email",

  // Bloc livraison
  "livrDiff",
  "livrSociete",
  "livrNom",
  "livrPrenom",
  "livr_complement_nom",
  "livrRue",
  "livrNumero",
  "livrRue2",
  "livrNpa",
  "livrVille",
  "livrTel",
  "accesLivraison",

  // Bloc informations complémentaires
  "remarks",
  "notesInternes",
] as const;

export type CorrectibleFieldV1 = (typeof CORRECTIBLE_FIELDS_V1)[number];

/**
 * Champs qui identifient le client et peuvent affecter le rapprochement
 * statistique avec la fiche client dans le dashboard. Le drawer affiche
 * un avertissement informatif au moment de la confirmation si l'un de
 * ces champs est modifié (Option 1 du cadrage 2026-05-17).
 */
export const CLIENT_IDENTITY_FIELDS = ["nom", "prenom", "email"] as const;

/**
 * Vérifie qu'un nom de champ est dans la whitelist v1.
 */
export function isCorrectibleField(fieldName: string): fieldName is CorrectibleFieldV1 {
  return (CORRECTIBLE_FIELDS_V1 as readonly string[]).includes(fieldName);
}

/**
 * Mapping des clés JSONB vers les colonnes plates de la table `offres`.
 *
 * Quand une correction modifie un champ qui a une colonne plate associée,
 * l'API met à jour LES DEUX (cohérence avec le matching dashboard qui
 * utilise les colonnes plates).
 *
 * Source : cf. app/api/offres/save/route.ts pour la liste des assignations
 * data.X → row.client_X / livr_X / etc.
 */
export const FLAT_COLUMN_MAP: Record<string, string> = {
  // Métadonnées
  paymentMode: "payment_mode",
  deliveryMode: "delivery_mode",
  leadTime: "lead_time",

  // Client facturation
  societe: "client_societe",
  nom: "client_nom",
  prenom: "client_prenom",
  complement_nom: "client_complement_nom",
  rue: "client_rue",
  numero: "client_numero",
  npa: "client_npa",
  ville: "client_ville",
  telephone1: "client_tel1",
  telephone2: "client_tel2",
  email: "client_email",

  // Client livraison
  livrDiff: "livr_diff",
  livrSociete: "livr_societe",
  livrNom: "livr_nom",
  livrPrenom: "livr_prenom",
  livr_complement_nom: "livr_complement_nom",
  livrRue: "livr_rue",
  livrNumero: "livr_numero",
  livrNpa: "livr_npa",
  livrVille: "livr_ville",
  livrTel: "livr_tel",

  // Notes
  remarks: "remarques",
  notesInternes: "notes_internes",

  // Note : rue2, livrRue2 et accesLivraison n'ont pas de colonne plate,
  // ils vivent uniquement dans data JSONB.
};