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