// app/api/offres/[slug]/statut/route.ts
import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

const STATUTS_VALIDES = ["En cours", "Envoyée", "Abandonnée", "Refusée", "Convertie", "Acceptée"]

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params
    const { statut } = await request.json()

    if (!STATUTS_VALIDES.includes(statut)) {
      return NextResponse.json({ error: "Statut invalide" }, { status: 400 })
    }

    const update: Record<string, unknown> = { statut }

    if (statut === "Abandonnée" || statut === "Refusée") {
      update.date_abandon = new Date().toISOString()
    } else if (statut === "En cours" || statut === "Envoyée") {
      update.date_abandon = null
    }

    const { error } = await supabaseAdmin
      .from("offres").update(update).eq("slug", slug)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ success: true, statut, date_abandon: update.date_abandon || null })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}