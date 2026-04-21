// app/api/offres/[slug]/relance/route.ts
// POST — enregistre la date de relance + ajoute note horodatée

import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params
    const now = new Date()
    const dateStr = now.toLocaleDateString("fr-CH", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit"
    }).replace(",", "")

    // Lire la note commerciale actuelle
    const { data: offre } = await supabaseAdmin
      .from("offres")
      .select("note_commerciale, nb_relances")
      .eq("slug", slug)
      .single()

    const nbRelances = ((offre?.nb_relances as number) || 0) + 1
    const noteActuelle = (offre?.note_commerciale as string) || ""
    const noteRelance = `📧 Relance #${nbRelances} envoyée — ${dateStr}`
    const nouvelleNote = noteActuelle
      ? `${noteActuelle}\n${noteRelance}`
      : noteRelance

    const { error } = await supabaseAdmin
      .from("offres")
      .update({
        date_derniere_relance: now.toISOString(),
        nb_relances: nbRelances,
        note_commerciale: nouvelleNote,
        statut: "Envoyée",
      })
      .eq("slug", slug)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({
      success: true,
      date_relance: now.toISOString(),
      nb_relances: nbRelances,
      note_commerciale: nouvelleNote,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}