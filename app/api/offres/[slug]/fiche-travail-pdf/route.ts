// app/api/offres/[slug]/fiche-travail-pdf/route.ts
// Génère un PDF "fiche de travail" via pdf.co
//
// 2 modes :
//   - POST avec body { mode: "initial" } → fige la fiche à l'état actuel (stock du moment).
//     Stocke à fiches-travail/{slug}_initial.pdf et met à jour fiche_travail_initial_url.
//     Génère SEULEMENT si elle n'existe pas déjà (sauf si force=true).
//   - POST sans body OU body { mode: "current" } → regénère la version courante (stock à jour).
//     Stocke à fiches-travail/{slug}.pdf et met à jour fiche_travail_pdf_url.
//
// GET → retourne les 2 URLs (initiale + courante) si elles existent.

import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

const PDFCO_API_KEY = process.env.PDFCO_API_KEY || ""
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://offres.jardin-confort.ch"
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ""

async function generatePdfFromPrintPage(slug: string, fileName: string): Promise<{ buffer: ArrayBuffer | null; error?: string }> {
  const printUrl = `${APP_URL}/print/fiche-travail/${slug}`

  const pdfcoRes = await fetch("https://api.pdf.co/v1/pdf/convert/from/url", {
    method: "POST",
    headers: {
      "x-api-key": PDFCO_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url: printUrl,
      name: fileName,
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
    return { buffer: null, error: pdfcoData.message || pdfcoData.error || "pdf.co error" }
  }

  const pdfResponse = await fetch(pdfcoData.url)
  if (!pdfResponse.ok) {
    return { buffer: null, error: "Téléchargement PDF échoué" }
  }
  const buffer = await pdfResponse.arrayBuffer()
  return { buffer }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params

    if (!PDFCO_API_KEY) {
      return NextResponse.json({ error: "PDFCO_API_KEY non configurée" }, { status: 500 })
    }

    // Lire le mode depuis le body (par défaut: current)
    let mode: "initial" | "current" = "current"
    let force = false
    try {
      const body = await request.json()
      if (body?.mode === "initial") mode = "initial"
      if (body?.force === true) force = true
    } catch { /* pas de body, on reste sur current */ }

    // 1. Vérifier que le document existe
    const { data: offre, error: readError } = await supabaseAdmin
      .from("offres")
      .select("id, slug, numero_affiche, type_document, fiche_travail_initial_url")
      .eq("slug", slug)
      .single()

    if (readError || !offre) {
      return NextResponse.json({ error: "Document non trouvé" }, { status: 404 })
    }

    // ─── MODE INITIAL : ne pas régénérer si déjà figée (sauf force=true) ───
    if (mode === "initial" && offre.fiche_travail_initial_url && !force) {
      return NextResponse.json({
        success: true,
        already_exists: true,
        pdf_url: offre.fiche_travail_initial_url,
        slug,
        mode,
      })
    }

    // 2. Générer le PDF
    const fileName = mode === "initial"
      ? `fiche-travail-${slug}-initial.pdf`
      : `fiche-travail-${slug}.pdf`

    const { buffer: pdfBuffer, error: pdfError } = await generatePdfFromPrintPage(slug, fileName)
    if (!pdfBuffer) {
      console.error("pdf.co error:", pdfError)
      return NextResponse.json({ error: "Erreur génération PDF", details: pdfError }, { status: 500 })
    }

    // 3. Stockage Supabase
    const storagePath = mode === "initial"
      ? `fiches-travail/${slug}_initial.pdf`
      : `fiches-travail/${slug}.pdf`

    const { error: uploadError } = await supabaseAdmin.storage
      .from("pdfs")
      .upload(storagePath, pdfBuffer, {
        contentType: "application/pdf",
        upsert: true,
      })

    if (uploadError) {
      console.error("Supabase storage error:", uploadError)
      return NextResponse.json({ error: "Erreur stockage PDF: " + uploadError.message }, { status: 500 })
    }

    const pdfPublicUrl = `${SUPABASE_URL}/storage/v1/object/public/pdfs/${storagePath}`

    // 4. Mise à jour de la colonne correspondante dans Supabase
    const updateData: Record<string, unknown> = {}
    if (mode === "initial") {
      updateData.fiche_travail_initial_url = pdfPublicUrl
      updateData.fiche_travail_initial_at = new Date().toISOString()
    } else {
      updateData.fiche_travail_pdf_url = pdfPublicUrl
    }

    await supabaseAdmin
      .from("offres")
      .update(updateData)
      .eq("slug", slug)

    return NextResponse.json({
      success: true,
      pdf_url: pdfPublicUrl,
      slug,
      mode,
    })

  } catch (err) {
    console.error("Fiche travail PDF generation error:", err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// GET — retourne les URLs des 2 versions
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params

  const { data, error } = await supabaseAdmin
    .from("offres")
    .select("fiche_travail_pdf_url, fiche_travail_initial_url, fiche_travail_initial_at, numero_affiche")
    .eq("slug", slug)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: "Document non trouvé" }, { status: 404 })
  }

  return NextResponse.json({
    pdf_url: data.fiche_travail_pdf_url || null,
    initial_url: data.fiche_travail_initial_url || null,
    initial_at: data.fiche_travail_initial_at || null,
    slug,
  })
}