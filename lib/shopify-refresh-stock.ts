// lib/shopify-refresh-stock.ts
// Helper partagé : re-fetch le stock réel depuis Shopify Admin pour les lignes Shopify.
//
// Utilisé par :
//   - app/api/offres/[slug]/route.ts  (offres en cours → stock live)
//   - app/api/drafts/[slug]/route.ts  (brouillons → stock live)
//
// IMPORTANT — règle de stock par type de document (gérée par les APPELANTS, pas ici) :
//   - Offre en cours / brouillon → appeler refreshStock (stock dynamique)
//   - Offre signée (Convertie/Acceptée) → NE PAS appeler (stock figé J0 de la commande liée)
//   - Commande → NE PAS appeler (stock figé J0 à la création)
// refreshStock ne fait QUE rafraîchir ; c'est à l'appelant de décider s'il doit l'appeler.
//
// MATCHING : par ID de variante (shopifyVariantId) quand disponible — fiable même
// quand un SKU est partagé par plusieurs produits (les SKU ne sont pas uniques).
// FALLBACK : par SKU pour les anciennes lignes sans shopifyVariantId.

import { isShopifyLine } from "@/lib/jc-print-types";

const SHOP = process.env.SHOPIFY_STORE_DOMAIN;
const ADMIN_CLIENT_ID = process.env.SHOPIFY_ADMIN_CLIENT_ID;
const ADMIN_CLIENT_SECRET = process.env.SHOPIFY_ADMIN_CLIENT_SECRET;

// Cache token Admin Shopify en mémoire (réutilisé entre les requêtes)
let cachedAdminToken: string | null = null;
let tokenExpiry = 0;

async function getAdminToken(): Promise<string | null> {
  if (cachedAdminToken && Date.now() < tokenExpiry) return cachedAdminToken;
  if (!SHOP || !ADMIN_CLIENT_ID || !ADMIN_CLIENT_SECRET) return null;
  try {
    const res = await fetch(`https://${SHOP}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: ADMIN_CLIENT_ID,
        client_secret: ADMIN_CLIENT_SECRET,
        grant_type: "client_credentials",
      }),
      cache: "no-store",
    });
    const json = await res.json() as { access_token?: string; expires_in?: number };
    if (json.access_token) {
      cachedAdminToken = json.access_token;
      tokenExpiry = Date.now() + (json.expires_in || 3600) * 1000 - 60000;
      return cachedAdminToken;
    }
  } catch { /* ignore */ }
  return null;
}

export async function refreshStock(
  lines: Array<{ type: string; sku?: string; stock?: unknown; shopifyVariantId?: string }>
) {
  if (!lines || lines.length === 0) return lines;

  const shopifyLines = lines.filter(isShopifyLine);
  if (shopifyLines.length === 0) return lines;

  // Lignes récentes : on a l'ID de variante (gid). Lignes anciennes : seulement le SKU.
  const variantIds = Array.from(
    new Set(
      shopifyLines
        .map((l) => l.shopifyVariantId)
        .filter((v): v is string => typeof v === "string" && v.startsWith("gid://"))
    )
  );
  const fallbackSkus = Array.from(
    new Set(
      shopifyLines
        .filter((l) => !l.shopifyVariantId || !l.shopifyVariantId.startsWith("gid://"))
        .map((l) => l.sku as string)
        .filter(Boolean)
    )
  );

  if (variantIds.length === 0 && fallbackSkus.length === 0) return lines;

  const adminToken = await getAdminToken();
  if (!adminToken) return lines; // Pas de token → stock inchangé

  // Helper : calcule le délai depuis les tags Shopify
  // Cohérence métier : mêmes tags utilisés dans le template Liquid Order Printer Pro
  const DELAY_MAP: Array<{ tag: string; label: string }> = [
    { tag: "1week",   label: "1–2 semaines" },
    { tag: "2weeks",  label: "2–3 semaines" },
    { tag: "3weeks",  label: "3–4 semaines" },
    { tag: "4weeks",  label: "4–5 semaines" },
    { tag: "5weeks",  label: "5–6 semaines" },
    { tag: "6weeks",  label: "6–8 semaines" },
    { tag: "8weeks",  label: "8–10 semaines" },
    { tag: "10weeks", label: "10–12 semaines" },
  ];
  function getDelayFromTags(tags: string[] | undefined | null): string {
    if (!tags || tags.length === 0) return "Sur commande";
    const tagList = tags.map((t) => t.toLowerCase().trim());
    for (const { tag, label } of DELAY_MAP) {
      if (tagList.includes(tag)) return label;
    }
    return "Sur commande";
  }

  // Metachamp de VARIANTE "fournisseur.delai_semaines" : le delai client FINAL,
  // acheminement compris, sans mot d'unite (la boutique est trilingue, les
  // metachamps ne sont pas traduits - l'unite vient du gabarit).
  // Valeurs observees : "2-3", "5-6", "7-9", "10-12", parfois un nombre seul.
  // Rend null si la valeur ne parse pas : on retombe alors sur les tags.
  function getDelayFromMetafield(valeur: string | null | undefined): string | null {
    if (!valeur) return null;
    const m = /^\s*(\d{1,2})(?:\s*-\s*(\d{1,2}))?\s*$/.exec(valeur);
    if (!m) return null;
    const bas = parseInt(m[1], 10);
    const haut = m[2] ? parseInt(m[2], 10) : null;
    if (bas < 1 || bas > 52) return null;
    if (haut !== null && (haut < bas || haut > 52)) return null;
    return haut !== null ? `${bas}\u2013${haut} semaines` : `${bas} semaines`;
  }

  // La cascade du theme de la boutique : METACHAMP de variante d'abord, tags
  // produit en repli, sinon "Sur commande" sans delai. Le metachamp prime depuis
  // la publication du theme MAIN « Enterprise by Claude » le 23.08.2026 : c'est
  // lui que le client lit sur la fiche produit, donc lui qu'il doit relire sur
  // son offre. Voir doc 03 par. 4 ter.
  function getDelay(
    valeurMetachamp: string | null | undefined,
    tags: string[] | undefined | null
  ): string {
    return getDelayFromMetafield(valeurMetachamp) ?? getDelayFromTags(tags);
  }

  // Somme du stock "available" sur tous les emplacements (robuste multi-locations)
  function sumAvailable(inv: {
    inventoryLevels?: { nodes?: Array<{ quantities?: Array<{ name: string; quantity: number }> }> };
  } | null | undefined): number {
    return (inv?.inventoryLevels?.nodes ?? []).reduce((sum, lvl) => {
      const avail = lvl.quantities?.find((q) => q.name === "available")?.quantity ?? 0;
      return sum + avail;
    }, 0);
  }

  type VariantNode = {
    id?: string;
    sku?: string | null;
    inventoryPolicy?: "DENY" | "CONTINUE" | null;
    product?: { tags?: string[] } | null;
    metafield?: { value?: string | null } | null;
    inventoryItem?: {
      inventoryLevels?: {
        nodes?: Array<{ quantities?: Array<{ name: string; quantity: number }> }>;
      };
    } | null;
  };

  try {
    // Map par ID de variante (matching fiable) ET par SKU (fallback).
    // On transporte aussi inventoryPolicy (DENY = non-réassortable) pour le garde-fou interne.
    const idMap = new Map<string, { stock: number; delay: string; inventoryPolicy: "DENY" | "CONTINUE" | null }>();
    const skuMap = new Map<string, { stock: number; delay: string; inventoryPolicy: "DENY" | "CONTINUE" | null }>();

    // 1) Lignes récentes : query par IDs de variante (infaillible)
    if (variantIds.length > 0) {
      const gqlIds = `
        query($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on ProductVariant {
              id
              inventoryPolicy
              product { tags }
              metafield(namespace: "fournisseur", key: "delai_semaines") { value }
              inventoryItem {
                inventoryLevels(first: 20) {
                  nodes { quantities(names: ["available"]) { name quantity } }
                }
              }
            }
          }
        }
      `;
      const resIds = await fetch(`https://${SHOP}/admin/api/2026-04/graphql.json`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": adminToken },
        body: JSON.stringify({ query: gqlIds, variables: { ids: variantIds } }),
        cache: "no-store",
      });
      const jsonIds = await resIds.json() as { data?: { nodes?: Array<VariantNode | null> } };
      for (const node of jsonIds.data?.nodes ?? []) {
        if (!node?.id) continue;
        idMap.set(node.id, {
          stock: sumAvailable(node.inventoryItem),
          delay: getDelay(node.metafield?.value, node.product?.tags),
          inventoryPolicy: node.inventoryPolicy ?? null,
        });
      }
    }

    // 2) Lignes anciennes : fallback par SKU (peut être ambigu si SKU dupliqué — dette assumée)
    if (fallbackSkus.length > 0) {
      const query = fallbackSkus.map((s) => `sku:"${s.replace(/"/g, '\\"')}"`).join(" OR ");
      const gqlSku = `
        query($query: String!) {
          productVariants(first: 50, query: $query) {
            nodes {
              sku
              inventoryPolicy
              product { tags }
              metafield(namespace: "fournisseur", key: "delai_semaines") { value }
              inventoryItem {
                inventoryLevels(first: 20) {
                  nodes { quantities(names: ["available"]) { name quantity } }
                }
              }
            }
          }
        }
      `;
      const resSku = await fetch(`https://${SHOP}/admin/api/2026-04/graphql.json`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": adminToken },
        body: JSON.stringify({ query: gqlSku, variables: { query } }),
        cache: "no-store",
      });
      const jsonSku = await resSku.json() as { data?: { productVariants?: { nodes?: VariantNode[] } } };
      for (const node of jsonSku.data?.productVariants?.nodes ?? []) {
        const sku = node.sku ?? "";
        if (sku) skuMap.set(sku, {
          stock: sumAvailable(node.inventoryItem),
          delay: getDelay(node.metafield?.value, node.product?.tags),
          inventoryPolicy: node.inventoryPolicy ?? null,
        });
      }
    }

    // Mettre à jour le stock + délai dans chaque ligne
    return lines.map((line) => {
      if (line.type === "comment" || !line.sku) return line;
      // Priorité au matching par ID de variante, sinon fallback SKU
      const fresh =
        (line.shopifyVariantId && line.shopifyVariantId.startsWith("gid://")
          ? idMap.get(line.shopifyVariantId)
          : undefined) ?? skuMap.get(line.sku as string);

      if (!fresh) {
        // Variante/SKU introuvable côté Shopify (produit retiré du catalogue, etc.) :
        // pour une ligne Shopify d'origine, on invalide le stock pour ne pas afficher d'obsolète.
        // inventoryPolicy est PRÉSERVÉ tel quel (on n'écrase pas une valeur déjà connue).
        const lineWithLock = line as { shopifyLocked?: boolean; id?: string };
        const wasShopify = lineWithLock.shopifyLocked === true || lineWithLock.id?.startsWith("shopify-");
        if (wasShopify) {
          return { ...line, stock: null, delaiLivraison: undefined };
        }
        return line;
      }
      return {
        ...line,
        stock: fresh.stock < 1 ? "sur_commande" : fresh.stock,
        delaiLivraison: fresh.delay, // 🚚 Délai client : métachamp de variante d'abord, tags en repli
        inventoryPolicy: fresh.inventoryPolicy ?? undefined, // 🔒 DENY = non-réassortable (garde-fou interne)
      };
    });

  } catch (err) {
    console.error("Stock refresh error:", err);
    return lines; // En cas d'erreur, retourner les lignes sans modification
  }
}