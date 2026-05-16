// app/api/stock-movements/route.ts
// GET /api/stock-movements?offre_slug=xxx     → mouvements d'une commande
// GET /api/stock-movements?status=failed       → tous les mouvements en erreur
// GET /api/stock-movements                    → tous les mouvements récents

import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url)
    const offreSlug = url.searchParams.get("offre_slug")
    const status = url.searchParams.get("status")          // 'completed' | 'failed' | 'pending' | 'skipped'
    const limit = Math.min(Number(url.searchParams.get("limit") || 200), 500)

    let query = supabaseAdmin
      .from("stock_movements")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit)

    if (offreSlug) query = query.eq("offre_slug", offreSlug)
    if (status) query = query.eq("status", status)

    const { data, error } = await query

    if (error) {
      console.error("Stock movements GET error:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Compteurs globaux pour stats du dashboard
    const [
      { count: totalCount },
      { count: failedCount },
      { count: completedCount },
      { count: skippedNotShopifyCount },
    ] = await Promise.all([
      supabaseAdmin.from("stock_movements").select("*", { count: "exact", head: true }),
      supabaseAdmin.from("stock_movements").select("*", { count: "exact", head: true }).eq("status", "failed"),
      supabaseAdmin.from("stock_movements").select("*", { count: "exact", head: true }).eq("status", "completed"),
      supabaseAdmin.from("stock_movements").select("*", { count: "exact", head: true }).eq("status", "skipped_not_shopify"),
    ])

    return NextResponse.json({
      movements: data || [],
      stats: {
        total: totalCount || 0,
        completed: completedCount || 0,
        failed: failedCount || 0,
        skippedNotShopify: skippedNotShopifyCount || 0,
      },
    })

  } catch (err) {
    console.error("Stock movements GET error:", err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}