// app/api/clients/[id]/factures/route.ts
import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const { data, error } = await supabaseAdmin
    .from("factures_winbiz")
    .select("id, numero_facture, date_facture, montant, pdf_url, match_confiance, created_at")
    .eq("client_id", parseInt(id))
    .order("numero_facture", { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ factures: data || [] })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await request.json()
  const { numero_facture, date_facture, montant, pdf_url } = body

  if (!numero_facture?.trim()) return NextResponse.json({ error: "Numéro requis" }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from("factures_winbiz")
    .insert({
      client_id: parseInt(id),
      numero_facture: numero_facture.trim(),
      date_facture: date_facture || null,
      montant: montant || null,
      pdf_url: pdf_url || null,
      match_confiance: "manuel",
      match_auto: false,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ facture: data })
}