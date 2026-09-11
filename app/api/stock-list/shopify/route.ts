// app/api/stock-list/shopify/route.ts
// POST /api/stock-list/shopify  { variantIds: (string|number)[] }
//
// Complément Shopify de la page « Stock list » : pour les variantes affichées,
// UN seul appel GraphQL Admin `nodes(ids:[…])` rend l'image de la variante
// (repli : média principal du produit), l'URL frontstore du produit (null si
// fiche DRAFT / non publiée) et le lien vers l'admin Shopify en secours.
//
// Lecture seule. Réutilise shopifyAdminGraphQL (Client Credentials, même
// version d'API que le reste de l'app).
//
// Renvoie : { infos: { [variantId]: { varianteTitre, imageUrl, onlineStoreUrl, adminUrl } } }
// La clé est l'id numérique de la variante ; le client normalise de son côté
// (le miroir stocke les gid complets "gid://shopify/ProductVariant/…").

import { NextRequest, NextResponse } from "next/server";
import { shopifyAdminGraphQL } from "@/lib/shopify-stock";
import type { StockListShopifyInfo } from "@/lib/supabase-webshop";

export const dynamic = "force-dynamic";

const MAX_IDS = 300;   // = limite de la recherche
const PAR_APPEL = 250; // plafond Shopify pour nodes(ids)

type NodeVariant = {
  id: string;
  title: string | null;
  image: { url: string } | null;
  product: {
    legacyResourceId: string;
    onlineStoreUrl: string | null;
    featuredMedia: { preview: { image: { url: string } | null } | null } | null;
  } | null;
} | null;

function gidVariante(id: string | number): string {
  const s = String(id).trim();
  return s.startsWith("gid://") ? s : `gid://shopify/ProductVariant/${s}`;
}

function legacyId(gid: string): string {
  return gid.split("/").pop() || gid;
}

// Handle admin : SHOPIFY_STORE_DOMAIN = le-meuble.myshopify.com → le-meuble
function adminBase(): string | null {
  const domaine = process.env.SHOPIFY_STORE_DOMAIN || "";
  const handle = domaine.replace(/\.myshopify\.com$/i, "").trim();
  return handle ? `https://admin.shopify.com/store/${handle}` : null;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { variantIds?: (string | number)[] };
    const bruts = Array.isArray(body.variantIds) ? body.variantIds : [];
    const ids = Array.from(new Set(bruts.filter((v) => v !== null && v !== undefined && String(v).trim() !== "").map(gidVariante))).slice(0, MAX_IDS);

    if (ids.length === 0) {
      return NextResponse.json({ infos: {} });
    }

    const query = `
      query stockListVariantes($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on ProductVariant {
            id
            title
            image { url(transform: { maxWidth: 160, maxHeight: 160 }) }
            product {
              legacyResourceId
              onlineStoreUrl
              featuredMedia { preview { image { url(transform: { maxWidth: 160, maxHeight: 160 }) } } }
            }
          }
        }
      }
    `;

    const base = adminBase();
    const nodes: NodeVariant[] = [];
    for (let i = 0; i < ids.length; i += PAR_APPEL) {
      const data = await shopifyAdminGraphQL<{ nodes: NodeVariant[] }>(query, { ids: ids.slice(i, i + PAR_APPEL) });
      nodes.push(...(data.nodes || []));
    }

    const infos: Record<string, StockListShopifyInfo> = {};
    for (const node of nodes) {
      if (!node) continue;
      const produit = node.product;
      const titre = (node.title || "").trim();
      infos[legacyId(node.id)] = {
        varianteTitre: titre && titre !== "Default Title" ? titre : null,
        imageUrl: node.image?.url || produit?.featuredMedia?.preview?.image?.url || null,
        onlineStoreUrl: produit?.onlineStoreUrl || null,
        adminUrl: base && produit ? `${base}/products/${produit.legacyResourceId}` : null,
      };
    }

    return NextResponse.json({ infos });
  } catch (err) {
    console.error("Stock list Shopify error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
