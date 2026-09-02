// app/api/bulletins-livraison/[id]/route.ts
// Lecture d'UN bulletin de livraison enregistré, par son uuid.
//
// Consommé par /print/bulletin-livraison/[slug]?bulletin=<id> — donc aussi par
// pdf.co au moment de générer le PDF. pdf.co n'a pas de cookie : la page lui
// transmet le jc_token reçu en query, et proxy.ts l'accepte pour ce GET
// précis (voir proxy.ts, bloc « pdf.co »). Lecture seule, aucun prix.

import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Identifiant invalide" }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from("bulletins_livraison")
    .select("id, offre_slug, numero_affiche, numero_bulletin, mention, date_bulletin, lines, nb_lignes, nb_pieces, pdf_url, created_at")
    .eq("id", id)
    .single()

  if (error || !data) return NextResponse.json({ error: "Bulletin introuvable" }, { status: 404 })
  return NextResponse.json({ bulletin: data })
}
