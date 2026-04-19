// app/api/offres/[slug]/statut/route.ts
// POST — changer le statut d'une offre (Abandonnée, En cours, etc.)

import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

const STATUTS_VALIDES = ["En cours", "Envoyée", "Abandonnée", "Refusée", "Convertie", "Acceptée"]

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params
    const body = await request.json()
    const { statut } = body

    if (!STATUTS_VALIDES.includes(statut)) {
      return NextResponse.json({ error: "Statut invalide" }, { status: 400 })
    }

    const { error } = await supabaseAdmin
      .from("offres")
      .update({ statut })
      .eq("slug", slug)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, statut })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}