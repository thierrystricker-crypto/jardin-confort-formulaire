// app/api/offres/[slug]/route.ts
// Lit une offre depuis Supabase + re-fetche le stock Shopify en temps réel
// GET /api/offres/[slug]
// GET /api/offres/[slug]?snapshot=true  → retourne le snapshot figé

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

const SHOP             = process.env.SHOPIFY_STORE_DOMAIN;
const STOREFRONT_TOKEN = process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN;
const ADMIN_CLIENT_ID  = process.env.SHOPIFY_ADMIN_CLIENT_ID;
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

// Re-fetch le stock réel depuis Shopify Admin pour chaque SKU des lignes
async function refreshStock(lines: Array<{ type: string; sku?: string; stock?: unknown }>) {
  if (!lines || lines.length === 0) return lines;

  const skus = lines
    .filter((l) => l.type !== "comment" && l.sku)
    .map((l) => l.sku as string);

  if (skus.length === 0) return lines;

  const adminToken = await getAdminToken();
  if (!adminToken) return lines; // Pas de token → stock inchangé

  try {
    const query = skus.map((s) => `sku:${s}`).join(" OR ");
    const gql = `
      query($query: String!) {
        productVariants(first: 50, query: $query) {
          nodes {
            sku
            inventoryItem {
              inventoryLevels(first: 5) {
                nodes {
                  quantities(names: ["available"]) {
                    name
                    quantity
                  }
                }
              }
            }
          }
        }
      }
    `;

    const res = await fetch(`https://${SHOP}/admin/api/2026-04/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": adminToken,
      },
      body: JSON.stringify({ query: gql, variables: { query } }),
      cache: "no-store",
    });

    const json = await res.json() as {
      data?: {
        productVariants?: {
          nodes?: Array<{
            sku: string | null;
            inventoryItem?: {
              inventoryLevels?: {
                nodes?: Array<{
                  quantities?: Array<{ name: string; quantity: number }>;
                }>;
              };
            } | null;
          }>;
        };
      };
    };

    // Construire la map SKU → stock
    const stockMap = new Map<string, number>();
    for (const node of json.data?.productVariants?.nodes ?? []) {
      const sku = node.sku ?? "";
      const qty =
        node.inventoryItem?.inventoryLevels?.nodes?.[0]?.quantities?.find(
          (q) => q.name === "available"
        )?.quantity ?? 0;
      if (sku) stockMap.set(sku, qty);
    }

    // Mettre à jour le stock dans chaque ligne
    return lines.map((line) => {
      if (line.type === "comment" || !line.sku) return line;
      const freshStock = stockMap.get(line.sku as string);
      if (freshStock === undefined) return line;
      return {
        ...line,
        stock: freshStock < 1 ? "sur_commande" : freshStock,
      };
    });

  } catch (err) {
    console.error("Stock refresh error:", err);
    return lines; // En cas d'erreur, retourner les lignes sans modification
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  try {
    const { slug } = params;
    const useSnapshot = request.nextUrl.searchParams.get("snapshot") === "true";

    // Lire l'offre depuis Supabase
    const { data: offre, error } = await supabase
      .from("offres")
      .select("*")
      .eq("slug", slug)
      .single();

    if (error || !offre) {
      return NextResponse.json(
        { error: "Offre non trouvée" },
        { status: 404 }
      );
    }

    // Si on demande le snapshot figé (pour l'impression)
    if (useSnapshot && offre.data_snapshot) {
      return NextResponse.json({
        offre: {
          ...offre,
          data: offre.data_snapshot,
          isSnapshot: true,
          snapshotAt: offre.snapshot_at,
        },
      });
    }

    // Sinon : re-fetcher le stock Shopify en temps réel
    const freshLines = await refreshStock(
      (offre.data as { lines?: Array<{ type: string; sku?: string; stock?: unknown }> })?.lines ?? []
    );

    const freshData = {
      ...(offre.data as Record<string, unknown>),
      lines: freshLines,
    };

    return NextResponse.json({
      offre: {
        ...offre,
        data: freshData,
        isSnapshot: false,
        stockRefreshedAt: new Date().toISOString(),
      },
    });

  } catch (err) {
    console.error("Get offre error:", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

// PATCH /api/offres/[slug] — mettre à jour le statut ou créer un snapshot
export async function PATCH(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  try {
    const { slug } = params;
    const body = await request.json();

    // Action : mettre à jour le statut
    if (body.statut) {
      const { error } = await supabase
        .from("offres")
        .update({ statut: body.statut })
        .eq("slug", slug);

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ success: true });
    }

    // Action : créer un snapshot figé (stock à l'instant t)
    if (body.createSnapshot) {
      // Lire l'offre
      const { data: offre } = await supabase
        .from("offres")
        .select("data")
        .eq("slug", slug)
        .single();

      if (!offre) return NextResponse.json({ error: "Offre non trouvée" }, { status: 404 });

      // Rafraîchir le stock une dernière fois
      const freshLines = await refreshStock(
        (offre.data as { lines?: Array<{ type: string; sku?: string; stock?: unknown }> })?.lines ?? []
      );
      const snapshot = { ...(offre.data as Record<string, unknown>), lines: freshLines };

      // Sauvegarder le snapshot
      const { error } = await supabase
        .from("offres")
        .update({
          data_snapshot: snapshot,
          snapshot_at: new Date().toISOString(),
        })
        .eq("slug", slug);

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ success: true, snapshot });
    }

    return NextResponse.json({ error: "Action non reconnue" }, { status: 400 });

  } catch (err) {
    console.error("Patch offre error:", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}