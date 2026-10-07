// Badge de stock du picker Shopify (P1-47).
// Sorti de DraftFormulaire.tsx le 07.10.2026 pour etre partage avec la vue
// etendue du picker (components/ShopifyPickerEtendu.tsx) : une seule regle,
// pas deux copies qui divergent (doc 04).
//
// Le stock seul ne veut rien dire : un 0 en CONTINUE reste commandable au
// fournisseur (cas courant chez Jardin-Confort), un 0 en DENY est une piece
// perdue. On lit donc toujours stock ET inventoryPolicy dans la meme main, avec
// le vocabulaire deja employe sur la ligne du tableau (voir doc 03 par.3).
// Politique inconnue (API Admin injoignable) = on ne sait pas : neutre, jamais rouge.

export type PolitiqueStock = "DENY" | "CONTINUE" | null;

export type EtatStockPicker = "en_stock" | "sur_commande" | "rupture" | "inconnu";

export const COULEURS_STOCK: Record<EtatStockPicker | "faible", string> = {
  en_stock: "#2C7E3F",
  faible: "#E67E22",
  sur_commande: "#E67E22",
  rupture: "#dc2626",
  inconnu: "#888888",
};

export function etatStockPicker(stock: number | null, policy: PolitiqueStock): EtatStockPicker {
  if (stock === null || policy === null) return "inconnu";
  if (stock > 0) return "en_stock";
  if (policy === "CONTINUE") return "sur_commande";
  return "rupture";
}

export function badgeStockPicker(
  stock: number | null,
  policy: PolitiqueStock
): { texte: string; couleur: string } {
  if (stock === null || policy === null) return { texte: "Stock à vérifier", couleur: COULEURS_STOCK.inconnu };
  if (stock > 2) return { texte: "✓ " + stock, couleur: COULEURS_STOCK.en_stock };
  if (stock > 0) return { texte: "⚠ " + stock, couleur: COULEURS_STOCK.faible };
  if (policy === "CONTINUE") return { texte: "Sur commande", couleur: COULEURS_STOCK.sur_commande };
  return { texte: "Rupture", couleur: COULEURS_STOCK.rupture };
}
