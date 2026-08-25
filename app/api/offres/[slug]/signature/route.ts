// app/api/offres/[slug]/signature/route.ts
// GET — signature manuscrite du client pour un document (offre OU commande).
//
// Ajouté le 25.08.2026. Pourquoi cette route existe :
// /valider écrit la signature (data.signature_base64) UNIQUEMENT sur la ligne
// de l'OFFRE. La ligne CMD créée dans la foulée est construite à partir de
// offre.data lu AVANT cette écriture, et ne réinjecte que signataire et
// date_signature — le tracé n'y est donc jamais copié (vérifié en base le
// 25.08 : 0 commande sur 387 porte une image, 144 offres sur 144 signées en
// ligne en portent une).
//
// Plutôt que de toucher à /valider — fichier au cœur du chantier 3, et qui ne
// réglerait que les commandes futures — on résout ici, à la lecture, en
// remontant de la commande vers son offre parente. Les 387 commandes déjà en
// base sont donc couvertes elles aussi.
//
// Route additive et en lecture seule : elle ne modifie aucun parcours existant.
// PUBLIQUE (liste blanche de proxy.ts) parce que /print/offre/[slug] est
// public et que pdf.co va chercher cette page depuis ses serveurs, sans cookie.

import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

const CHAMPS = "slug, type_document, numero_affiche, commercial, data"

type LigneOffre = {
  slug: string
  type_document: string | null
  numero_affiche: string | null
  commercial: string | null
  data: Record<string, unknown> | null
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params

    const { data: doc, error } = await supabaseAdmin
      .from("offres")
      .select(CHAMPS)
      .eq("slug", slug)
      .single()

    if (error || !doc) {
      return NextResponse.json({ error: "Document non trouvé" }, { status: 404 })
    }

    // Le porteur de la signature : le document lui-même pour une offre,
    // l'offre parente pour une commande.
    let porteur = doc as LigneOffre

    if (doc.type_document === "Commande" && doc.numero_affiche) {
      // .limit(1) et non .single() : la base contient des documents en double
      // (P0-9). Deux offres pointant sur le même n° CMD ne doivent pas faire
      // planter la route — on prend la plus récente.
      const { data: parentes } = await supabaseAdmin
        .from("offres")
        .select(CHAMPS)
        .eq("numero_commande", doc.numero_affiche)
        .eq("type_document", "Offre")
        .order("created_at", { ascending: false })
        .limit(1)

      if (parentes && parentes.length > 0) porteur = parentes[0] as LigneOffre
    }

    const d = (porteur.data || {}) as Record<string, unknown>
    const brut = typeof d.signature_base64 === "string" ? d.signature_base64 : ""

    // On ne renvoie que ce qui est réellement une image encodée : le tracé
    // finit dans un src d'<img>, on ne lui laisse pas passer autre chose.
    const image = brut.startsWith("data:image/") ? brut : null

    return NextResponse.json(
      {
        image,
        signataire: (d.signataire as string) || null,
        date_signature: (d.date_signature as string) || null,
        date_validation: (d.date_validation as string) || null,
        // "document" = la signature est sur la ligne demandée (une offre) ;
        // "offre_parente" = elle a été remontée depuis le DEV d'origine.
        source: porteur.slug === slug ? "document" : "offre_parente",
        dev_numero: porteur.numero_affiche || null,
      },
      { headers: { "Cache-Control": "no-store" } }
    )
  } catch (err) {
    console.error("[signature] ", err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
