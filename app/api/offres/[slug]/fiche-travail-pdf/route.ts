// app/api/offres/[slug]/fiche-travail-pdf/route.ts
// POST — génère un PDF "fiche de travail" via pdf.co depuis la page print
// et le stocke dans Supabase Storage bucket "pdfs", dossier "fiches-travail/"
// GET  — retourne l'URL PDF stockée

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

    // 1. Vérifier que l'offre/commande existe
    const { data: offre, error: readError } = await supabaseAdmin
      .from("offres")
      .select("id, slug, numero_affiche, type_document")
      .eq("slug", slug)
      .single()

    if (readError || !offre) {
      return NextResponse.json({ error: "Document non trouvé" }, { status: 404 })
    }

    // 2. URL de la page print fiche de travail
    const printUrl = `${APP_URL}/print/fiche-travail/${slug}`

    // 3. Appel pdf.co — URL vers PDF
    //    Délai un peu plus long que pour l'offre car JsBarcode + qrcode-generator
    //    se chargent en CDN après render initial.
    const pdfcoRes = await fetch("https://api.pdf.co/v1/pdf/convert/from/url", {
      method: "POST",
      headers: {
        "x-api-key": PDFCO_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: printUrl,
        name: `fiche-travail-${slug}.pdf`,
        async: false,
        printBackground: true,
        mediaType: "print",
        paperSize: "A4",
        orientation: "Portrait",
        margins: "10mm 10mm 10mm 10mm",
        // Attendre que les codes-barres soient rendus avant capture
        renderingMode: "default",
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

    // 5. Stockage dans le bucket "pdfs", sous-dossier dédié "fiches-travail/"
    const storagePath = `fiches-travail/${slug}.pdf`

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

    // 6. URL publique Supabase
    const pdfPublicUrl = `${SUPABASE_URL}/storage/v1/object/public/pdfs/${storagePath}`

    // 7. Mettre à jour l'URL dans la table offres (colonne dédiée)
    await supabaseAdmin
      .from("offres")
      .update({ fiche_travail_pdf_url: pdfPublicUrl })
      .eq("slug", slug)

    return NextResponse.json({
      success: true,
      pdf_url: pdfPublicUrl,
      slug,
    })

  } catch (err) {
    console.error("Fiche travail PDF generation error:", err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// GET — retourne l'URL PDF stockée pour la fiche de travail
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params

  const { data, error } = await supabaseAdmin
    .from("offres")
    .select("fiche_travail_pdf_url, numero_affiche")
    .eq("slug", slug)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: "Document non trouvé" }, { status: 404 })
  }

  return NextResponse.json({
    pdf_url: data.fiche_travail_pdf_url || null,
    slug,
  })
}