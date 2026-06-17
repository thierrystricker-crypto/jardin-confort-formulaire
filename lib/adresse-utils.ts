// lib/adresse-utils.ts
// Détection « adresse sans numéro de rue ».
//
// Contexte métier : beaucoup de fiches clients viennent de WinBiz avec le numéro
// COLLÉ dans le champ `rue` (ex: "Rte de Baumaroche 16B") et `numero` vide.
// Donc on ne peut PAS se contenter de tester si `numero` est rempli : il faut
// vérifier si un numéro existe QUELQUE PART dans (rue + numero) combinés.
//
// L'objectif est d'attraper les vrais cas problématiques (adresse réécrite à la
// main sans numéro → livreur qui ne trouve pas) sans générer de faux positif sur
// les adresses WinBiz normales où le numéro est dans `rue`.

/**
 * Renvoie true si l'adresse contient au moins un chiffre (= un numéro de rue
 * plausible), que ce soit dans `rue` ou dans `numero`.
 *
 * Exemples :
 *   aUnNumero("Rte de Baumaroche 16B", "")   → true  (numéro dans rue, WinBiz)
 *   aUnNumero("Route de Lavaux", "425")      → true  (champs séparés)
 *   aUnNumero("Route de Baumaroche", "")     → false (aucun numéro → alerte)
 *   aUnNumero("", "")                        → false (mais voir adresseEstRenseignee)
 */
export function aUnNumero(rue?: string | null, numero?: string | null): boolean {
  const combine = `${rue || ""} ${numero || ""}`;
  return /\d/.test(combine);
}

/**
 * Renvoie true si une adresse est effectivement saisie (au moins une rue non vide).
 * Sert à ne PAS alerter sur une adresse complètement vide (ex: "À l'emporter",
 * ou formulaire pas encore rempli).
 */
export function adresseEstRenseignee(rue?: string | null): boolean {
  return !!(rue && rue.trim().length > 0);
}

/**
 * true si une adresse est renseignée MAIS ne contient aucun numéro → cas à signaler.
 */
export function manqueNumero(rue?: string | null, numero?: string | null): boolean {
  return adresseEstRenseignee(rue) && !aUnNumero(rue, numero);
}

/**
 * Résout l'adresse de livraison EFFECTIVE (celle qui finira sur l'étiquette colis).
 * - Si livrDiff = true  → adresse de livraison propre (livrRue / livrNumero)
 * - Si livrDiff = false → héritée de la facturation (rue / numero)
 *
 * Renvoie { rue, numero } de l'adresse effectivement utilisée pour livrer.
 */
export function adresseLivraisonEffective(params: {
  livrDiff: boolean;
  rue?: string | null;
  numero?: string | null;
  livrRue?: string | null;
  livrNumero?: string | null;
}): { rue: string; numero: string } {
  if (params.livrDiff) {
    return { rue: params.livrRue || "", numero: params.livrNumero || "" };
  }
  return { rue: params.rue || "", numero: params.numero || "" };
}