// lib/revision-diff.ts
// Compare l'état AVANT et APRÈS d'une révision de commande.
// Matching par `id` de ligne (stable : "shopify-XXX", "custom-XXX").
// Produit :
//   - un diff lisible (audit + fiche de travail)
//   - la liste des retraits à remettre en stock (tous types : Shopify ET à la volée)
//   - la liste des ajouts/augmentations (delta à décrémenter sur Shopify)

import { isShopifyLine } from "@/lib/jc-print-types";

// Forme minimale d'une ligne (on ne dépend que de ce dont on a besoin)
export type RevisionLine = {
  id?: string;
  type?: "product" | "custom" | "comment" | "media";
  sku?: string;
  title?: string;
  qty?: number;
  unitPrice?: number;
  lineDiscount?: number;
  shopifyLocked?: boolean;
  inventoryPolicy?: "DENY" | "CONTINUE";
  variantId?: string;
  inventoryItemId?: string;
  locationId?: string;
  // tolérance aux variantes de nommage rencontrées dans le data
  variant_id?: string;
  inventory_item_id?: string;
  location_id?: string;
};

// Un retrait à insérer dans stock_remises_attente
export type Retrait = {
  sku: string;
  product_title: string;
  variant_id: string | null;
  inventory_item_id: string | null;
  location_id: string | null;
  quantity: number;
  inventory_policy: string | null;
  is_shopify: boolean;
};

// Un ajout/augmentation à décrémenter sur Shopify (delta)
export type Ajout = {
  id: string;
  sku: string;
  title: string;
  quantity: number; // delta positif à sortir du stock
  is_shopify: boolean;
};

// Le diff lisible complet
export type RevisionDiff = {
  ajouts: { sku: string; title: string; qty: number }[];
  retraits: { sku: string; title: string; qty: number }[];
  qtyChanges: { sku: string; title: string; avant: number; apres: number }[];
  prixChanges: { sku: string; title: string; avant: number; apres: number }[];
  remiseChanges: { sku: string; title: string; avant: number; apres: number }[];
};

// Le résultat complet du calcul
export type RevisionComputation = {
  diff: RevisionDiff;
  retraits: Retrait[]; // pour stock_remises_attente (RPC)
  ajouts: Ajout[];     // pour décrément Shopify (côté route)
  hasChanges: boolean;
};

// Helpers d'accès tolérants aux 2 conventions de nommage
function getVariantId(l: RevisionLine): string | null {
  return l.variantId || l.variant_id || null;
}
function getInventoryItemId(l: RevisionLine): string | null {
  return l.inventoryItemId || l.inventory_item_id || null;
}
function getLocationId(l: RevisionLine): string | null {
  return l.locationId || l.location_id || null;
}

// On ignore les lignes non-matérielles pour le stock (commentaires, media)
function isStockRelevant(l: RevisionLine): boolean {
  return l.type !== "comment" && l.type !== "media";
}

/**
 * Calcule le diff entre l'ancienne et la nouvelle liste de lignes.
 * @param before lignes de la commande AVANT révision
 * @param after  lignes de la commande APRÈS révision
 */
export function computeRevisionDiff(
  before: RevisionLine[],
  after: RevisionLine[]
): RevisionComputation {
  const beforeById = new Map<string, RevisionLine>();
  for (const l of before) {
    if (l.id) beforeById.set(l.id, l);
  }
  const afterById = new Map<string, RevisionLine>();
  for (const l of after) {
    if (l.id) afterById.set(l.id, l);
  }

  const diff: RevisionDiff = {
    ajouts: [],
    retraits: [],
    qtyChanges: [],
    prixChanges: [],
    remiseChanges: [],
  };
  const retraits: Retrait[] = [];
  const ajouts: Ajout[] = [];

  const buildRetrait = (l: RevisionLine, qty: number): Retrait => ({
    sku: l.sku || "",
    product_title: l.title || "",
    variant_id: getVariantId(l),
    inventory_item_id: getInventoryItemId(l),
    location_id: getLocationId(l),
    quantity: qty,
    inventory_policy: l.inventoryPolicy || null,
    is_shopify: isShopifyLine(l),
  });

  // 1. Parcours des lignes APRÈS → détecte ajouts et lignes conservées
  for (const a of after) {
    if (!a.id) continue;
    const b = beforeById.get(a.id);

    if (!b) {
      // Ligne AJOUTÉE (id absent avant)
      if (isStockRelevant(a)) {
        const qty = a.qty || 0;
        if (qty > 0) {
          diff.ajouts.push({ sku: a.sku || "", title: a.title || "", qty });
          ajouts.push({
            id: a.id,
            sku: a.sku || "",
            title: a.title || "",
            quantity: qty,
            is_shopify: isShopifyLine(a),
          });
        }
      }
      continue;
    }

    // Ligne CONSERVÉE → comparer qty, prix, remise
    const qtyAvant = b.qty || 0;
    const qtyApres = a.qty || 0;
    const prixAvant = b.unitPrice || 0;
    const prixApres = a.unitPrice || 0;
    const remiseAvant = b.lineDiscount || 0;
    const remiseApres = a.lineDiscount || 0;

    if (qtyApres !== qtyAvant) {
      diff.qtyChanges.push({
        sku: a.sku || "", title: a.title || "",
        avant: qtyAvant, apres: qtyApres,
      });
      if (isStockRelevant(a)) {
        if (qtyApres < qtyAvant) {
          // Réduction → retrait du delta à remettre en stock
          retraits.push(buildRetrait(a, qtyAvant - qtyApres));
        } else {
          // Augmentation → décrément Shopify du delta
          ajouts.push({
            id: a.id, sku: a.sku || "", title: a.title || "",
            quantity: qtyApres - qtyAvant,
            is_shopify: isShopifyLine(a as never),
          });
        }
      }
    }

    if (prixApres !== prixAvant) {
      diff.prixChanges.push({
        sku: a.sku || "", title: a.title || "",
        avant: prixAvant, apres: prixApres,
      });
    }
    if (remiseApres !== remiseAvant) {
      diff.remiseChanges.push({
        sku: a.sku || "", title: a.title || "",
        avant: remiseAvant, apres: remiseApres,
      });
    }
  }

  // 2. Parcours des lignes AVANT → détecte les retraits complets (id absent après)
  for (const b of before) {
    if (!b.id) continue;
    if (afterById.has(b.id)) continue; // conservée, déjà traitée
    if (!isStockRelevant(b)) continue;

    const qty = b.qty || 0;
    if (qty > 0) {
      diff.retraits.push({ sku: b.sku || "", title: b.title || "", qty });
      retraits.push(buildRetrait(b, qty));
    }
  }

  const hasChanges =
    diff.ajouts.length > 0 ||
    diff.retraits.length > 0 ||
    diff.qtyChanges.length > 0 ||
    diff.prixChanges.length > 0 ||
    diff.remiseChanges.length > 0;

  return { diff, retraits, ajouts, hasChanges };
}