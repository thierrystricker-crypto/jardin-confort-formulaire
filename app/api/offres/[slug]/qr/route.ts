// app/api/offres/[slug]/qr/route.ts
// Basé sur le sample officiel JavaScript pdf4me
// Endpoint: /api/v2/CreateSwissQrBill
// Auth: Basic YOUR_API_KEY (clé directe, pas encodée)
// Réponse 200: binary PDF (arrayBuffer)
// Réponse 202: async, polling via Location header

import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

const PDF4ME_API_KEY = process.env.PDF4ME_API_KEY || ""
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ""
const API_ENDPOINT = "https://api.pdf4me.com/api/v2/CreateSwissQrBill"

const BLANK_PDF_BASE64 = "JVBERi0xLjQKJeLjz9MKMSAwIG9iago8PAovVHlwZSAvQ2F0YWxvZwovUGFnZXMgMiAwIFIKPj4KZW5kb2JqCjIgMCBvYmoKPDwKL1R5cGUgL1BhZ2VzCi9LaWRzIFszIDAgUl0KL0NvdW50IDEKPD4KZW5kb2JqCjMgMCBvYmoKPDwKL1R5cGUgL1BhZ2UKL1BhcmVudCAyIDAgUgovTWVkaWFCb3ggWzAgMCA2MTIgNzkyXQovUmVzb3VyY2VzIDw8Ci9Gb250IDw8Ci9GMSA0IDAgUgo+Pgo+PgovQ29udGVudHMgNSAwIFIKPj4KZW5kb2JqCjQgMCBvYmoKPDwKL1R5cGUgL0ZvbnQKL1N1YnR5cGUgL1R5cGUxCi9CYXNlRm9udCAvSGVsdmV0aWNhCj4+CmVuZG9iago1IDAgb2JqCjw8Ci9MZW5ndGggNDQKPj4Kc3RyZWFtCkJUCi9GMSAxMiBUZgoxMDAgNzAwIFRkCihIZWxsbyBXb3JsZCkgVGoKRVQKZW5kc3RyZWFtCmVuZG9iagp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1NCAwMDAwMCBuIAowMDAwMDAwMTAxIDAwMDAwIG4gCjAwMDAwMDAxNzAgMDAwMDAgbiAKMDAwMDAwMDI0NCAwMDAwMCBuIAp0cmFpbGVyCjw8Ci9TaXplIDYKL1Jvb3QgMSAwIFIKPj4Kc3RhcnR4cmVmCjM0MQolJUVPRg=="

async function storeQrPdf(slug: string, pdfBuffer: Buffer): Promise<string> {
  const storagePath = `qr/${slug}_qr.pdf`
  await supabaseAdmin.storage.from("pdfs").upload(storagePath, pdfBuffer, {
    contentType: "application/pdf", upsert: true,
  })
  const qrUrl = `${SUPABASE_URL}/storage/v1/object/public/pdfs/${storagePath}`
  await supabaseAdmin.from("offres").update({ qr_url: qrUrl }).eq("slug", slug)
  return qrUrl
}

async function processPdfResponse(result: ArrayBuffer, slug: string): Promise<string> {
  const buffer = Buffer.from(result)
  
  // Vérifier si c'est un PDF binaire direct
  if (buffer.length > 4 && buffer.toString("ascii", 0, 4) === "%PDF") {
    return await storeQrPdf(slug, buffer)
  }

  // Sinon essayer de parser comme JSON
  try {
    const json = JSON.parse(buffer.toString())
    const b64 = json.document?.docData || json.docData || json.docContent || json.data
    if (b64) {
      return await storeQrPdf(slug, Buffer.from(b64, "base64"))
    }
    throw new Error("Pas de données PDF dans la réponse JSON: " + JSON.stringify(json).slice(0, 200))
  } catch {
    if (buffer.length > 1000) {
      return await storeQrPdf(slug, buffer)
    }
    throw new Error("Réponse invalide: " + buffer.toString("hex", 0, 50))
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params

    if (!PDF4ME_API_KEY) {
      return NextResponse.json({ error: "PDF4ME_API_KEY non configurée" }, { status: 500 })
    }

    const { data: offre, error: readError } = await supabaseAdmin
      .from("offres").select("*").eq("slug", slug).single()

    if (readError || !offre) {
      return NextResponse.json({ error: "Offre non trouvée" }, { status: 404 })
    }

    const isAcompte = (offre.payment_mode || "").includes("50%")
    const montant = isAcompte
      ? Math.round(offre.total_ttc * 0.5 * 100) / 100
      : offre.total_ttc

    const udName = ([offre.client_prenom, offre.client_nom].filter(Boolean).join(" ")
      || offre.client_societe || "Client").slice(0, 70)
    const udStreet = (offre.client_rue || "Rue inconnue").slice(0, 70)
    const udNumber = (((offre.data as Record<string,unknown>)?.numero as string) || "1").slice(0, 16)
    const udPostalCode = (offre.client_npa || "0000").slice(0, 16)
    const udCity = (offre.client_ville || "Suisse").slice(0, 35)

    const payload = {
      docContent: BLANK_PDF_BASE64,
      docName: `qr_${slug}.pdf`,
      iban: "CH7200767000K03337965",
      crName: "JARDIN CONFORT SA",
      crAddressType: "S",
      crStreetOrAddressLine1: "Route de Lavaux",
      crStreetOrAddressLine2: "425",
      crPostalCode: "1095",
      crCity: "Lutry",
      amount: montant.toFixed(2),
      currency: "CHF",
      udName,
      udAddressType: "S",
      udStreetOrAddressLine1: udStreet,
      udStreetOrAddressLine2: udNumber,
      udPostalCode,
      udCity,
      referenceType: "NON",
      languageType: "French",
      seperatorLine: "LineWithScissor",
      async: true,
    }

    const headers = {
      "Authorization": `Basic ${PDF4ME_API_KEY}`,
      "Content-Type": "application/json",
    }

    const pdf4meRes = await fetch(API_ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    })

    if (pdf4meRes.status === 200) {
      const result = await pdf4meRes.arrayBuffer()
      const qrUrl = await processPdfResponse(result, slug)
      return NextResponse.json({ success: true, qr_url: qrUrl, montant, isAcompte, slug })
    }

    if (pdf4meRes.status === 202) {
      const locationUrl = pdf4meRes.headers.get("Location")
      if (!locationUrl) {
        return NextResponse.json({ error: "Pas de Location header dans la réponse 202" }, { status: 500 })
      }
      return NextResponse.json({ async: true, locationUrl, slug })
    }

    const errText = await pdf4meRes.text()
    return NextResponse.json({
      error: "Erreur pdf4me",
      status: pdf4meRes.status,
      details: errText.slice(0, 500),
      
    }, { status: 500 })

  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const { searchParams } = new URL(request.url)
  const locationUrl = searchParams.get("locationUrl")

  if (locationUrl) {
    try {
      const headers = {
        "Authorization": `Basic ${PDF4ME_API_KEY}`,
        "Content-Type": "application/json",
      }

      const statusRes = await fetch(locationUrl, { method: "GET", headers })

      if (statusRes.status === 202) {
        return NextResponse.json({ ready: false, status: 202 })
      }

      if (statusRes.status === 200) {
        const result = await statusRes.arrayBuffer()
        const qrUrl = await processPdfResponse(result, slug)
        return NextResponse.json({ ready: true, qr_url: qrUrl, slug })
      }

      const errText = await statusRes.text()
      return NextResponse.json({ ready: false, status: statusRes.status, error: errText.slice(0, 200) })

    } catch (err) {
      return NextResponse.json({ error: String(err) }, { status: 500 })
    }
  }

  // URL QR stockée
  const { data } = await supabaseAdmin
    .from("offres").select("qr_url").eq("slug", slug).single()

  return NextResponse.json({
    qr_url: (data as Record<string,unknown>)?.qr_url || null,
    slug
  })
}