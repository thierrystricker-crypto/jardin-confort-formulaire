// lib/listes-achat-lignes.ts — SERVEUR uniquement (Admin API Shopify)
// Transforme les lignes d'une liste d'achat en lignes de brouillon (QuoteLine,
// le format du formulaire). Utilisé par :
//   - POST /api/listes-achat/[id]/brouillon  (création d'un DRA)
//   - GET  /api/listes-achat/[id]/lignes     (ajout à un brouillon en cours,
//     onglet « Liste d'achat » du formulaire)
//
// Les prix sont relus chez Shopify À L'INSTANT. Même règle que le picker du
// formulaire : s'il y a un compareAtPrice supérieur au prix, la ligne part au
// prix barré avec le rabais en lineDiscount (promo visible sur l'offre).

import { randomUUID } from "crypto";
import { shopifyAdminGraphQL } from "@/lib/shopify-stock";
import type { QuoteLine } from "@/lib/jc-print-types";
import type { LigneListe } from "@/lib/listes-achat";

type NodeVariant = {
  id: string;
  sku: string | null;
  title: string | null;
  price: string;
  compareAtPrice: string | null;
  inventoryQuantity: number | null;
  inventoryPolicy: "DENY" | "CONTINUE";
  image: { url: string } | null;
  product: {
    title: string;
    status: string;
    featuredMedia: { preview: { image: { url: string } | null } | null } | null;
  } | null;
} | null;

function gid(id: string): string {
  return id.startsWith("gid://") ? id : `gid://shopify/ProductVariant/${id}`;
}

export async function construireLignesBrouillon(lignes: LigneListe[]): Promise<{ lines: QuoteLine[]; nbProduits: number; nbCustom: number }> {
  const ids = lignes.filter((x) => x.variant_id).map((x) => gid(String(x.variant_id)));
  const infos = new Map<string, NonNullable<NodeVariant>>();
  for (let i = 0; i < ids.length; i += 250) {
    const data = await shopifyAdminGraphQL<{ nodes: NodeVariant[] }>(
      `query listeAchatLignes($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on ProductVariant {
            id sku title price compareAtPrice inventoryQuantity inventoryPolicy
            image { url(transform: { maxWidth: 400, maxHeight: 400 }) }
            product { title status featuredMedia { preview { image { url(transform: { maxWidth: 400, maxHeight: 400 }) } } } }
          }
        }
      }`,
      { ids: ids.slice(i, i + 250) }
    );
    for (const n of data.nodes || []) if (n) infos.set(n.id, n);
  }

  const lines: QuoteLine[] = [];
  let nbProduits = 0, nbCustom = 0;
  for (const x of lignes) {
    const qty = Math.max(1, Number(x.qty) || 1);
    const info = x.variant_id ? infos.get(gid(String(x.variant_id))) : undefined;
    if (info) {
      const vt = (info.title || "").trim();
      const titre = info.product ? (vt && vt !== "Default Title" ? `${info.product.title} / ${vt}` : info.product.title) : (x.titre || x.sku);
      const prix = Number(info.price) || 0;
      const barre = info.compareAtPrice ? Number(info.compareAtPrice) : 0;
      const promo = barre > prix;
      lines.push({
        id: randomUUID(),
        type: "product",
        image: info.image?.url || info.product?.featuredMedia?.preview?.image?.url || x.image_url || "",
        sku: info.sku || x.sku,
        title: titre,
        unitPrice: promo ? barre : prix,
        qty,
        stock: info.inventoryQuantity === null ? null : info.inventoryQuantity === 0 ? "sur_commande" : info.inventoryQuantity,
        inventoryPolicy: info.inventoryPolicy,
        shopifyLocked: true,
        shopifyVariantId: info.id,
        lineDiscount: promo ? Math.round((barre - prix) * qty * 100) / 100 : 0,
        lineDiscountPerUnit: promo ? Math.round((barre - prix) * 100) / 100 : 0,
      });
      nbProduits++;
    } else {
      // Article à la volée de la liste, ou SKU hors Shopify, ou variante disparue
      lines.push({
        id: randomUUID(),
        type: "custom",
        image: x.image_url || "",
        sku: x.sku,
        title: x.titre ? [x.titre, x.variante_titre].filter(Boolean).join(" / ") : `${x.fournisseur} — ${x.sku} (article à créer)`,
        unitPrice: typeof x.prix === "number" ? x.prix : 0,
        qty,
        stock: null,
      });
      nbCustom++;
    }
  }
  return { lines, nbProduits, nbCustom };
}
