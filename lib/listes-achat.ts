// lib/listes-achat.ts
// Listes d'achat (chantier Stock list, 12.09.2026) — types partagés entre la
// page Stock list (panier), la page /dashboard/listes-achat et les routes API.
//
// Une liste = un panier de variantes choisies dans la Stock list, nommé,
// sauvegardé en base (table listes_achat, Supabase de l'app), rappelable, et
// transformable en brouillon DRA-xxx. Les prix ne sont jamais stockés : ils
// sont relus chez Shopify au moment de créer le brouillon.
//
// Modèle (est_modele) : combo que les vendeurs revendent souvent (socle +
// poids + tube + parasol). Jamais transformé lui-même — on charge une copie.

export type LigneListe = {
  fournisseur: string;
  sku: string;
  titre: string | null;            // titre Shopify, null si SKU hors boutique
  variante_titre: string | null;   // ex. "260x260cm / 605 Clay"
  variant_id: string | null;       // gid Shopify, null = hors Shopify → ligne custom du brouillon
  product_id: string | null;
  statut_fiche: "ACTIVE" | "DRAFT" | "ARCHIVED" | null;
  qty: number;
  image_url: string | null;
};

export type StatutListe = "ouverte" | "transformee" | "archivee";

export type ListeAchat = {
  id: string;
  created_at: string;
  updated_at: string;
  nom: string;
  cree_par: string | null;
  statut: StatutListe;
  lignes: LigneListe[];
  nb_articles: number;
  notes: string | null;
  est_modele: boolean;
  draft_slug: string | null;
  draft_numero: string | null;
};

// Clé localStorage du panier en cours (non encore sauvegardé, ou copie de
// travail d'une liste sauvegardée) sur la page Stock list.
export const CLE_PANIER = "stock-list-panier-v1";

export type PanierLocal = {
  id: string | null;       // id de la liste sauvegardée dont on est la copie de travail
  nom: string;
  est_modele: boolean;
  lignes: LigneListe[];
};

export const PANIER_VIDE: PanierLocal = { id: null, nom: "", est_modele: false, lignes: [] };

export function cleLigne(l: Pick<LigneListe, "fournisseur" | "sku">): string {
  return `${l.fournisseur}|${l.sku}`;
}

export function nbArticles(lignes: LigneListe[]): number {
  return lignes.reduce((n, l) => n + (Number(l.qty) || 0), 0);
}

// Nettoie ce qui arrive du client avant d'écrire en base.
export function normaliserLignes(brut: unknown): LigneListe[] {
  if (!Array.isArray(brut)) return [];
  const out: LigneListe[] = [];
  const vues = new Set<string>();
  for (const x of brut) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const fournisseur = String(o.fournisseur ?? "").trim();
    const sku = String(o.sku ?? "").trim();
    if (!fournisseur || !sku) continue;
    const cle = `${fournisseur}|${sku}`;
    if (vues.has(cle)) continue;
    vues.add(cle);
    const qty = Math.max(1, Math.min(999, Math.round(Number(o.qty) || 1)));
    const statut = o.statut_fiche;
    out.push({
      fournisseur,
      sku,
      titre: typeof o.titre === "string" ? o.titre : null,
      variante_titre: typeof o.variante_titre === "string" ? o.variante_titre : null,
      variant_id: typeof o.variant_id === "string" && o.variant_id ? o.variant_id : null,
      product_id: typeof o.product_id === "string" && o.product_id ? o.product_id : null,
      statut_fiche: statut === "ACTIVE" || statut === "DRAFT" || statut === "ARCHIVED" ? statut : null,
      qty,
      image_url: typeof o.image_url === "string" && o.image_url ? o.image_url : null,
    });
  }
  return out.slice(0, 200);
}
