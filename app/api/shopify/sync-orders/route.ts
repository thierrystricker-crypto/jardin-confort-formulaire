// app/api/shopify/sync-orders/route.ts
// POST — Synchronise les commandes Shopify dans Supabase
// Compatible Vercel Hobby : sync chunked, à relancer plusieurs fois

import { NextRequest, NextResponse } from "next/server"
import { syncShopifyOrders } from "@/lib/shopify-orders"

export const maxDuration = 60 // Vercel Hobby max

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const syncType = body.syncType === "cron" ? "cron" : (body.syncType === "initial" ? "initial" : "manual")
    const startCursor = body.startCursor || null
    const maxOrders = typeof body.maxOrders === "number" ? body.maxOrders : 500

    console.log(`[shopify-sync] Démarrage sync chunk type=${syncType} cursor=${startCursor ? "..." + startCursor.slice(-10) : "DÉBUT"} maxOrders=${maxOrders}`)

    const result = await syncShopifyOrders({
      syncType,
      startCursor,
      maxOrders,
      timeoutMs: 50000, // Stop à 50s pour laisser marge avant 60s Vercel
    })

    console.log(`[shopify-sync] Chunk terminé en ${result.durationMs}ms : ${result.ordersInserted} insérées, ${result.ordersUpdated} mises à jour, ${result.clientsCreated} clients créés. hasMore=${result.hasMore}`)

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
    
    const { data: lastSync } = await supabaseAdmin
      .from("shopify_sync_log")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    const { count: totalOrders } = await supabaseAdmin
      .from("commandes_shopify")
      .select("*", { count: "exact", head: true })

    return NextResponse.json({
      lastSync,
      totalOrders: totalOrders || 0,
    })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}