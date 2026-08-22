// lib/arrivages.ts
// Chantier « Arrivages » — types partagés (page + API) et lecture du scan.
// Aucune dépendance serveur : importable côté navigateur.

export type LigneArrivage = {
  boutique: string; numero_commande: string; position: number
  sku: string|null; titre: string|null; marque: string|null
  stock_cmd: string|null
  qty_commandee: number; qty_stock_cmd: number; qty_recue_totale: number
  qty_couverte: number; qty_restante: number
  premiere_reception: string|null; derniere_reception: string|null
  nb_mouvements: number; ligne_disparue: boolean
  etat: "aucune"|"partielle"|"complete"|"excedent"
  mode_ligne: "en_stock"|"partiel_stock"|"a_recevoir"
}
export type Mouvement = {
  id: string; position: number; sku: string|null; titre: string|null; marque: string|null
  qty_recue: number; date_reception: string; saisi_par: string|null; commentaire: string|null
  created_at: string
}
export type CommandeArrivage = {
  boutique: string; numero_commande: string; canal: string
  client_nom: string|null; client_prenom: string|null; client_societe: string|null
  date_commande: string|null
  lignes: LigneArrivage[]
  mouvements: Mouvement[]
}
export type Candidat = {
  boutique: string; numero_commande: string
  client_nom: string|null; client_prenom: string|null; client_societe: string|null
  date_commande: string|null; marques: string[]
}

// ─── Normalisation du scan ──────────────────────────────────────────────────
// `JAR'13585`, `jar 13585`, `CMD_80877`, `CMD-80877` → `CMD-80877`.
// Tout séparateur (ou rien) entre les lettres et les chiffres devient « - ».
export function normaliserNumero(brut: string): string|null {
  const s = brut.trim().toUpperCase()
  const m = s.match(/^#?([A-Z]{2,4})[^A-Z0-9]*(\d{3,7})$/)
  return m ? `${m[1]}-${m[2]}` : null
}
// « Dupont Mag » → { ref: "Dupont", boutique: "magasin" } ; « Dupont web » →
// jardin-confort.ch ; « GAL » (Galaxus, vendu via Shopify) → jardin-confort.ch ;
// sans suffixe → les deux boutiques.
export function lireReferenceClient(brut: string): { ref: string; boutique: string|null } {
  const s = brut.trim().replace(/\s+/g, " ")
  const m = s.match(/^(.*?)\s+(mag|web|gal)$/i)
  if (!m) return { ref: s, boutique: null }
  const canal = m[2].toLowerCase()
  return { ref: m[1].trim(), boutique: canal === "mag" ? "magasin" : "jardin-confort.ch" }
}
export function boutiqueDepuisNumero(numero: string): string|null {
  if (numero.startsWith("JAR-")) return "jardin-confort.ch"
  if (numero.startsWith("CMD-")) return "magasin"
  return null
}

