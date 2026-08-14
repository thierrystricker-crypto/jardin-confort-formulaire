// app/api/shopify/sync-orders/route.ts
// POST — Synchronise les commandes Shopify dans Supabase.
//
// Par défaut : mode incrémental (seulement ce qui a changé depuis la
// dernière passe) avec reprise automatique si une passe précédente a été
// interrompue — l'état vit dans la table shopify_sync_etat.
//
// Corps optionnel :
//   { "mode": "backfill" }          → rejoue tout l'historique depuis 2021
//   { "forcerRedemarrage": true }   → ignore le curseur mémorisé
//   { "maxOrders": 2000 }
//
// GET — état du sync (dernier passage, retard, reprise en attente).

import { NextRequest, NextResponse } from "next/server"
import { syncShopifyOrders } from "@/lib/shopify-orders"

export const maxDuration = 300 // Vercel Pro

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const syncType = body.syncType === "cron" ? "cron" : (body.syncType === "initial" ? "initial" : "manual")
    const mode = body.mode === "backfill" ? "backfill" : (body.mode === "incremental" ? "incremental" : undefined)
    const maxOrders = typeof body.maxOrders === "number" ? body.maxOrders : 2000

    console.log(`[shopify-sync] Démarrage type=${syncType} mode=${mode ?? "(état mémorisé)"} maxOrders=${maxOrders}`)

    const result = await syncShopifyOrders({
      syncType,
      mode,
      forcerRedemarrage: body.forcerRedemarrage === true,
      startCursor: body.startCursor || null,
      maxOrders,
      timeoutMs: 260000, // marge sous les 300 s
    })

    console.log(`[shopify-sync] Terminé en ${result.durationMs}ms : ${result.ordersInserted} insérées, ${result.ordersUpdated} mises à jour, ${result.clientsCreated} clients créés. hasMore=${result.hasMore}`)

    return NextResponse.json({
      success: true,
      ...result,
    })
  } catch (err) {
    console.error("[shopify-sync] Erreur :", err)
    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 500 }
    )
  }
}

export async function GET() {
  try {
    const { supabaseAdmin } = await import("@/lib/supabase")

    const [{ data: historique }, { count: totalOrders }, { data: etat }, { data: derniere }] = await Promise.all([
      supabaseAdmin
        .from("shopify_sync_historique")
        .select("*")
        .limit(15),
      supabaseAdmin
        .from("commandes_shopify")
        .select("*", { count: "exact", head: true }),
      supabaseAdmin
        .from("shopify_sync_etat")
        .select("*")
        .eq("id", 1)
        .maybeSingle(),
      supabaseAdmin
        .from("commandes_shopify")
        .select("created_at_shopify")
        .order("created_at_shopify", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    const passages = historique || []
    return NextResponse.json({
      historique: passages,
      lastSync: passages[0] ?? null,
      etat,
      totalOrders: totalOrders || 0,
      derniereCommande: derniere?.created_at_shopify ?? null,
      repriseEnAttente: !!etat?.curseur,
      bloqueDepuis: etat?.curseur_depuis ?? null,
    })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
