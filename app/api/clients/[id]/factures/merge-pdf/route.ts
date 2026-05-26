// app/api/clients/[id]/factures/merge-pdf/route.ts
import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { PDFDocument } from "pdf-lib"

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idStr } = await params
    const clientId = parseInt(idStr, 10)
    if (isNaN(clientId)) {
      return NextResponse.json({ error: "ID invalide" }, { status: 400 })
    }

    // Récupérer le client (pour le nom du fichier final)
    const { data: client, error: clientErr } = await supabaseAdmin
      .from("clients")
      .select("numero_client, nom, prenom, societe")
      .eq("id", clientId)
      .single()

    if (clientErr || !client) {
      return NextResponse.json({ error: "Client introuvable" }, { status: 404 })
    }

    // Récupérer les factures triées plus récent → plus ancien
    const { data: factures, error: facturesErr } = await supabaseAdmin
      .from("factures_winbiz")
      .select("id, numero_facture, date_facture, pdf_url")
      .eq("client_id", clientId)
      .not("pdf_url", "is", null)
      .order("date_facture", { ascending: false, nullsFirst: false })
      .order("numero_facture", { ascending: false })

    if (facturesErr) {
      return NextResponse.json({ error: facturesErr.message }, { status: 500 })
    }

    const facturesAvecPdf = (factures || []).filter(f => f.pdf_url)
    if (facturesAvecPdf.length === 0) {
      return NextResponse.json({ error: "Aucune facture avec PDF disponible" }, { status: 404 })
    }

    // Fusionner les PDFs
    const mergedPdf = await PDFDocument.create()
    const errors: { numero: string; reason: string }[] = []

    for (const facture of facturesAvecPdf) {
      try {
        const pdfResponse = await fetch(facture.pdf_url!)
        if (!pdfResponse.ok) {
          errors.push({ numero: facture.numero_facture, reason: `HTTP ${pdfResponse.status}` })
          continue
        }
        const pdfBytes = await pdfResponse.arrayBuffer()
        const sourcePdf = await PDFDocument.load(pdfBytes, { ignoreEncryption: true })
        const pages = await mergedPdf.copyPages(sourcePdf, sourcePdf.getPageIndices())
        pages.forEach(p => mergedPdf.addPage(p))
      } catch (e) {
        errors.push({ numero: facture.numero_facture, reason: (e as Error).message })
      }
    }

    if (mergedPdf.getPageCount() === 0) {
      return NextResponse.json({
        error: "Aucun PDF n'a pu être lu",
        details: errors,
      }, { status: 500 })
    }

    const mergedBytes = await mergedPdf.save()

    // Nom du fichier
    const nomClient = (client.societe || [client.prenom, client.nom].filter(Boolean).join("-") || "client")
      .replace(/[^a-zA-Z0-9\-_]/g, "_")
      .slice(0, 40)
    const dateStr = new Date().toISOString().slice(0, 10)
    const fileName = `factures-${client.numero_client}-${nomClient}-${dateStr}.pdf`

    const headers = new Headers({
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${fileName}"`,
      "Cache-Control": "no-store",
    })
    if (errors.length > 0) {
      headers.set("X-Merge-Errors", JSON.stringify(errors).slice(0, 1000))
    }

    return new NextResponse(new Uint8Array(mergedBytes), { status: 200, headers })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}