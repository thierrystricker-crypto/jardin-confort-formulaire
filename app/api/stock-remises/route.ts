// app/api/stock-remises/route.ts
// GET  /api/stock-remises?status=a_remettre  → lignes en attente de remise en stock
// GET  /api/stock-remises                     → toutes les lignes (tous statuts)
// PATCH /api/stock-remises                    → { id, status: "remis" | "ignore", traite_par? }
//
// IMPORTANT : ce dashboard ne fait JAMAIS d'incrémentation Shopify.
// L'app ne pratique que des désincrémentations. Toute remise en stock (le +1)
// est faite à la main dans le back-office Shopify par un responsable, via le
// lien fourni — l'app se contente de MARQUER la ligne comme traitée.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { findVariantBySKU, SHOPIFY_LOCATION_ID } from "@/lib/shopify-stock";

const SHOPIFY_STORE = "le-meuble";
const LOCATION_NUM = (SHOPIFY_LOCATION_ID.split("/").pop() || "").trim();
const INV_COLS = "VARIANT_NAME,SKU,COMMITTED_QUANTITY,AVAILABLE_QUANTITY,INCOMING_QUANTITY";

function shopifyInventoryLink(sku: string): string {
  const params = new URLSearchParams({
    location_id: LOCATION_NUM,
    selectedColumns: INV_COLS,
    query: sku,
  });
  return `https://admin.shopify.com/store/${SHOPIFY_STORE}/products/inventory?${params.toString()}`;
}

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const status = url.searchParams.get("status"); // 'a_remettre' | 'remis' | 'ignore'
    const limit = Math.min(Number(url.searchParams.get("limit") || 200), 500);

    let query = supabaseAdmin
      .from("stock_remises_attente")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (status) query = query.eq("status", status);

    const { data, error } = await query;
    if (error) {
      console.error("Stock remises GET error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows = data || [];

    // Stock live Shopify par SKU (uniquement pour les lignes Shopify, en attente).
    // On déduplique les SKU pour limiter les appels.
    const skusToFetch = Array.from(
      new Set(
        rows
          .filter((r) => r.is_shopify && r.sku && r.status === "a_remettre")
          .map((r) => r.sku as string)
      )
    );

    const liveStock: Record<string, number | null> = {};
    await Promise.all(
      skusToFetch.map(async (sku) => {
        try {
          const variant = await findVariantBySKU(sku);
          liveStock[sku] = variant ? variant.available : null;
        } catch {
          liveStock[sku] = null;
        }
      })
    );

    const enriched = rows.map((r) => ({
      ...r,
      stock_live: r.sku && r.sku in liveStock ? liveStock[r.sku] : null,
      shopify_link: r.sku ? shopifyInventoryLink(r.sku) : null,
    }));

    // Compteurs pour les KPIs
    const [
      { count: aRemettreCount },
      { count: remisCount },
      { count: ignoreCount },
    ] = await Promise.all([
      supabaseAdmin.from("stock_remises_attente").select("*", { count: "exact", head: true }).eq("status", "a_remettre"),
      supabaseAdmin.from("stock_remises_attente").select("*", { count: "exact", head: true }).eq("status", "remis"),
      supabaseAdmin.from("stock_remises_attente").select("*", { count: "exact", head: true }).eq("status", "ignore"),
    ]);

    return NextResponse.json({
      remises: enriched,
      stats: {
        a_remettre: aRemettreCount || 0,
        remis: remisCount || 0,
        ignore: ignoreCount || 0,
      },
    });
  } catch (err) {
    console.error("Stock remises GET error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, status, traite_par } = body as {
      id?: number;
      status?: string;
      traite_par?: string;
    };

    if (!id || (status !== "remis" && status !== "ignore")) {
      return NextResponse.json(
        { error: "Paramètres invalides (id requis, status doit être 'remis' ou 'ignore')" },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("stock_remises_attente")
      .update({
        status,
        traite_par: traite_par || null,
        traite_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("status", "a_remettre") // garde-fou : on ne re-traite pas une ligne déjà traitée
      .select("id, status")
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json(
        { error: "Ligne introuvable ou déjà traitée" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, id: data.id, status: data.status });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}