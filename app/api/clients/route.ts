// app/api/clients/route.ts
// GET  — liste clients avec recherche
// POST — créer un nouveau client

import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

export async function GET(request: NextRequest) {
  try {
    const q = request.nextUrl.searchParams.get("q")?.trim() || ""
    const limit = parseInt(request.nextUrl.searchParams.get("limit") || "50")

    let query = supabaseAdmin
      .from("clients")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(limit)

    if (q) {
      query = query.or(
        `nom.ilike.%${q}%,prenom.ilike.%${q}%,societe.ilike.%${q}%,email.ilike.%${q}%,npa.ilike.%${q}%,ville.ilike.%${q}%,numero_client.ilike.%${q}%,tel1.ilike.%${q}%,tel2.ilike.%${q}%`
      )
    }

    const { data, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ clients: data || [] })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { nom, prenom, societe, email, tel1, tel2, rue, rue2, numero_rue, npa, ville, pays, notes, source } = body

    if (!nom?.trim()) return NextResponse.json({ error: "Nom requis" }, { status: 400 })

    const { data, error } = await supabaseAdmin
      .from("clients")
      .insert({
        nom: nom.trim(),
        prenom: prenom?.trim() || null,
        societe: societe?.trim() || null,
        email: email?.trim() || null,
        tel1: tel1?.trim() || null,
        tel2: tel2?.trim() || null,
        rue: rue?.trim() || null,
        rue2: body.rue2?.trim() || null,
        numero_rue: numero_rue?.trim() || null,
        npa: npa?.trim() || null,
        ville: ville?.trim() || null,
        pays: pays || "CH",
        notes: notes?.trim() || null,
        source: source || "manuel",
      })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ client: data })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}