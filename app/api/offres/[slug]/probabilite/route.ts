// app/api/offres/[slug]/probabilite/route.ts
import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const { probabilite } = await request.json()
  if (!["neutre","forte","moyenne","faible"].includes(probabilite)) {
    return NextResponse.json({ error: "Valeur invalide" }, { status: 400 })
  }
  const { error } = await supabaseAdmin
    .from("offres")
    .update({ probabilite })
    .eq("slug", slug)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, probabilite })
}