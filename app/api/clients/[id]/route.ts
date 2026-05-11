// app/api/clients/[id]/route.ts
// GET  — détail client + historique offres + commandes Shopify
// PATCH — modifier client

import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const { data: client, error } = await supabaseAdmin
      .from("clients")
      .select("*")
      .eq("id", id)
      .single()

    if (error || !client) return NextResponse.json({ error: "Client introuvable" }, { status: 404 })

    // Chercher les offres liées par email ou par nom+prenom
    let offres: unknown[] = []
    if (client.email) {
      const { data } = await supabaseAdmin
        .from("offres")
        .select("id, slug, numero_affiche, type_document, statut, date_document, total_ttc, commercial, payment_mode")
        .ilike("client_email", client.email)
        .order("created_at", { ascending: false })
      offres = data || []
    } else {
      // Fallback : recherche par nom + npa
      const { data } = await supabaseAdmin
        .from("offres")
        .select("id, slug, numero_affiche, type_document, statut, date_document, total_ttc, commercial, payment_mode")
        .ilike("client_nom", client.nom)
        .eq("client_npa", client.npa || "")
        .order("created_at", { ascending: false })
      offres = data || []
    }

    // Chercher les commandes Shopify liées via client_id
    const { data: commandesShopify } = await supabaseAdmin
      .from("commandes_shopify")
      .select(`
        id,
        shopify_order_id,
        shopify_order_legacy_id,
        shopify_order_name,
        shopify_order_number,
        total_price,
        subtotal_price,
        total_tax,
        total_shipping,
        currency,
        financial_status,
        fulfillment_status,
        cancelled_at,
        cancel_reason,
        source_name,
        test,
        tags,
        note,
        status_page_url,
        shipping_address,
        billing_address,
        line_items,
        created_at_shopify
      `)
      .eq("client_id", id)
      .order("created_at_shopify", { ascending: false })

    return NextResponse.json({
      client,
      offres,
      commandesShopify: commandesShopify || []
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()

    const allowed = ["nom","prenom","societe","email","tel1","tel2","rue","rue2","numero_rue","npa","ville","pays","notes",
      "complement_nom",
      "livr_societe","livr_nom","livr_prenom","livr_rue","livr_rue2","livr_npa","livr_ville","livr_tel",
      "livr_complement_nom"]
    const update: Record<string, unknown> = {}
    for (const key of allowed) {
      if (key in body) update[key] = body[key] || null
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "Rien à mettre à jour" }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
      .from("clients")
      .update(update)
      .eq("id", id)
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ client: data })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}