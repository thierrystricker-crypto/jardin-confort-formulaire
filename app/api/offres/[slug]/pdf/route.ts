// app/api/offres/[slug]/pdf/route.ts
// POST — génère un PDF via pdf.co depuis la page print
// et le stocke dans Supabase Storage bucket "pdfs"

import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

const PDFCO_API_KEY = process.env.PDFCO_API_KEY || ""
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://offres.jardin-confort.ch"
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ""

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params

    if (!PDFCO_API_KEY) {
      return NextResponse.json({ error: "PDFCO_API_KEY non configurée" }, { status: 500 })
    }

    // 1. Vérifier que l'offre existe
    const { data: offre, error: readError } = await supabaseAdmin
      .from("offres")
      .select("id, slug, numero_affiche, type_document")
      .eq("slug", slug)
      .single()

    if (readError || !offre) {
      return NextResponse.json({ error: "Offre non trouvée" }, { status: 404 })
    }

    // 2. URL de la page print
    const printUrl = `${APP_URL}/print/offre/${slug}`

    // 3. Appel pdf.co — URL vers PDF
    const pdfcoRes = await fetch("https://api.pdf.co/v1/url/convert/to/pdf", {
      method: "POST",
      headers: {
        "x-api-key": PDFCO_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: printUrl,
        name: `${slug}.pdf`,
        async: false,
        printBackground: true,
        mediaType: "print",
        paperSize: "A4",
        orientation: "Portrait",
        margins: "10mm 10mm 10mm 10mm",
      }),
    })

    const pdfcoData = await pdfcoRes.json()

    if (pdfcoData.error || !pdfcoData.url) {
      console.error("pdf.co error:", pdfcoData)
      return NextResponse.json({
        error: "Erreur génération PDF",
        details: pdfcoData.message || pdfcoData.error
      }, { status: 500 })
    }

    // 4. Télécharger le PDF depuis pdf.co
    const pdfResponse = await fetch(pdfcoData.url)
    if (!pdfResponse.ok) {
      return NextResponse.json({ error: "Impossible de télécharger le PDF" }, { status: 500 })
    }
    const pdfBuffer = await pdfResponse.arrayBuffer()

    // 5. Déterminer le chemin dans Supabase Storage
    const folder = offre.type_document === "Commande" ? "commandes" : "offres"
    const storagePath = `${folder}/${slug}.pdf`

    // 6. Upload dans Supabase Storage bucket "pdfs"
    const { error: uploadError } = await supabaseAdmin.storage
      .from("pdfs")
      .upload(storagePath, pdfBuffer, {
        contentType: "application/pdf",
        upsert: true, // Écrase si existe déjà
      })

    if (uploadError) {
      console.error("Supabase storage error:", uploadError)
      return NextResponse.json({ error: "Erreur stockage PDF: " + uploadError.message }, { status: 500 })
    }

    // 7. Construire l'URL publique Supabase
    const pdfPublicUrl = `${SUPABASE_URL}/storage/v1/object/public/pdfs/${storagePath}`

    // 8. Mettre à jour l'URL dans la table offres
    await supabaseAdmin
      .from("offres")
      .update({ pdf_url: pdfPublicUrl })
      .eq("slug", slug)

    return NextResponse.json({
      success: true,
      pdf_url: pdfPublicUrl,
      slug,
    })

  } catch (err) {
    console.error("PDF generation error:", err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// GET — retourne l'URL PDF stockée
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params

  const { data, error } = await supabaseAdmin
    .from("offres")
    .select("pdf_url, numero_affiche")
    .eq("slug", slug)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: "Offre non trouvée" }, { status: 404 })
  }

  return NextResponse.json({ pdf_url: data.pdf_url || null, slug })
}