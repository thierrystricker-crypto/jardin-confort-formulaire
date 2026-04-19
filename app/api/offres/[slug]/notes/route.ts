// app/api/offres/[slug]/notes/route.ts
// POST — sauvegarder notes internes et note commerciale

import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params
    const body = await request.json()
    const { note_commerciale, notes_internes } = body

    const update: Record<string, string> = {}
    if (note_commerciale !== undefined) update.note_commerciale = note_commerciale
    if (notes_internes !== undefined) update.notes_internes = notes_internes

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "Rien à mettre à jour" }, { status: 400 })
    }

    const { error } = await supabaseAdmin
      .from("offres")
      .update(update)
      .eq("slug", slug)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}