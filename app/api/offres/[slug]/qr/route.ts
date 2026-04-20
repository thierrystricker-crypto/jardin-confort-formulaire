// app/api/offres/[slug]/qr/route.ts
// Génère une page de paiement dynamique (HTML→PDF via pdf.co)
// puis y ajoute le QR bill Swiss (pdf4me)
// Stocke le résultat dans Supabase Storage

import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

const PDF4ME_API_KEY = process.env.PDF4ME_API_KEY || ""
const PDFCO_API_KEY = process.env.PDFCO_API_KEY || ""
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ""
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://offres.jardin-confort.ch"

// ── HTML dynamique pour la page de paiement ──────────────────────────────
function generateQrPageHtml(offre: Record<string,unknown>, montant: number, isAcompte: boolean): string {
  const d = (offre.data as Record<string,unknown>) || {}
  const nomClient = [offre.client_prenom, offre.client_nom].filter(Boolean).join(" ")
    || offre.client_societe || ""
  const societe = (offre.client_societe as string) || ""
  const rue = [offre.client_rue, (d.numero as string) || ""].filter(Boolean).join(" ")
  const npaVille = [offre.client_npa, offre.client_ville].filter(Boolean).join(" ")
  const libelle = isAcompte ? "Acompte 50% à la commande" : "Paiement d'avance à la commande"
  const montantFormate = new Intl.NumberFormat("fr-CH", {
    style: "currency", currency: "CHF", minimumFractionDigits: 2
  }).format(montant)

  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8">
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family:Arial,sans-serif; font-size:13px; color:#2A2B2A; background:white;
  width:210mm; min-height:297mm; padding:18mm 18mm 80mm 18mm; }
.header { display:flex; justify-content:space-between; align-items:flex-start;
  margin-bottom:28px; padding-bottom:18px; border-bottom:2px solid #0060A9; }
.logo { width:150px; }
.ref { text-align:right; }
.ref h2 { font-size:18px; font-weight:bold; color:#0060A9; }
.ref p { font-size:11px; color:#6B7280; margin-top:3px; }
.section-title { font-size:10px; font-weight:bold; text-transform:uppercase;
  letter-spacing:.05em; color:#6B7280; margin-bottom:7px; margin-top:24px; }
.client-block { background:#F3F5F6; border-radius:6px; padding:14px 18px;
  font-size:13px; line-height:1.65; }
.client-name { font-weight:bold; font-size:14px; color:#0060A9; }
.payment-block { margin-top:24px; background:#EBF4FB; border:1px solid #2B8AD1;
  border-radius:8px; padding:18px 22px; }
.payment-label { font-size:11px; color:#2B8AD1; font-weight:bold;
  text-transform:uppercase; letter-spacing:.05em; margin-bottom:7px; }
.payment-amount { font-size:30px; font-weight:bold; color:#0060A9; }
.payment-mode { font-size:11px; color:#6B7280; margin-top:5px; }
.note { margin-top:24px; font-size:10.5px; color:#9CA3AF; line-height:1.55; }
.divider { margin-top:24px; border-top:1px dashed #D1D5DB; }
</style></head><body>
<div class="header">
  <img class="logo"
    src="https://cdn.shopify.com/s/files/1/0360/3251/2135/files/Logo_Jardin_Confort_2022_BLEU.png?v=1666175474"
    alt="Jardin-Confort" />
  <div class="ref">
    <h2>${offre.numero_affiche}</h2>
    <p>Bulletin de paiement</p>
  </div>
</div>
<div class="section-title">Destinataire</div>
<div class="client-block">
  <div class="client-name">${nomClient}</div>
  ${societe && nomClient !== societe ? `<div>${societe}</div>` : ""}
  ${rue ? `<div>${rue}</div>` : ""}
  ${npaVille ? `<div>${npaVille}</div>` : ""}
</div>
<div class="payment-block">
  <div class="payment-label">${libelle}</div>
  <div class="payment-amount">${montantFormate}</div>
  <div class="payment-mode">${offre.payment_mode || ""}</div>
</div>
<div class="note">
  Veuillez utiliser le bulletin de paiement ci-dessous pour effectuer votre virement.<br/>
  Merci de mentionner la référence <strong>${offre.numero_affiche}</strong> lors de votre paiement.
</div>
<div class="divider"></div>
</body></html>`
}

// ── Convertir HTML en PDF via pdf.co ─────────────────────────────────────
async function htmlToPdfBase64(html: string): Promise<string> {
  const encoded = Buffer.from(html).toString("base64")
  const res = await fetch("https://api.pdf.co/v1/pdf/convert/from/html", {
    method: "POST",
    headers: { "x-api-key": PDFCO_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      html: encoded,
      name: "qr_base.pdf",
      paperSize: "A4",
      orientation: "Portrait",
      margins: "0px 0px 0px 0px",
      printBackground: true,
      async: false,
    }),
  })
  const data = await res.json()
  if (data.error || !data.url) {
    throw new Error("pdf.co error: " + (data.message || JSON.stringify(data).slice(0, 200)))
  }
  // Télécharger le PDF et encoder en base64
  const pdfRes = await fetch(data.url)
  const pdfBuffer = await pdfRes.arrayBuffer()
  return Buffer.from(pdfBuffer).toString("base64")
}

// ── Ajouter QR bill via pdf4me ────────────────────────────────────────────
async function addSwissQrBill(
  pdfBase64: string,
  offre: Record<string,unknown>,
  montant: number
): Promise<ArrayBuffer> {
  const d = (offre.data as Record<string,unknown>) || {}
  const udName = ([offre.client_prenom, offre.client_nom].filter(Boolean).join(" ")
    || offre.client_societe || "Client").toString().slice(0, 70)
  const udStreet = ((offre.client_rue as string) || "Rue inconnue").slice(0, 70)
  const udNumber = ((d.numero as string) || "1").slice(0, 16)
  const udPostalCode = ((offre.client_npa as string) || "0000").slice(0, 16)
  const udCity = ((offre.client_ville as string) || "Suisse").slice(0, 35)

  const payload = {
    docContent: pdfBase64,
    docName: `qr_${offre.slug}.pdf`,
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

  const res = await fetch("https://api.pdf4me.com/api/v2/CreateSwissQrBill", {
    method: "POST",
    headers: {
      "Authorization": `Basic ${PDF4ME_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  })

  if (res.status === 200) return await res.arrayBuffer()

  if (res.status === 202) {
    const locationUrl = res.headers.get("Location")
    if (!locationUrl) throw new Error("Pas de Location header 202")
    // Polling max 30s
    for (let i = 0; i < 6; i++) {
      await new Promise(r => setTimeout(r, 5000))
      const poll = await fetch(locationUrl, {
        headers: { "Authorization": `Basic ${PDF4ME_API_KEY}` }
      })
      if (poll.status === 200) return await poll.arrayBuffer()
      if (poll.status !== 202) throw new Error(`Poll error: ${poll.status}`)
    }
    throw new Error("Timeout pdf4me polling")
  }

  const errText = await res.text()
  throw new Error(`pdf4me error ${res.status}: ${errText.slice(0, 300)}`)
}

// ── Stocker dans Supabase ─────────────────────────────────────────────────
async function storeQrPdf(slug: string, pdfData: ArrayBuffer | Buffer): Promise<string> {
  const buffer = Buffer.isBuffer(pdfData) ? pdfData : Buffer.from(pdfData)
  const storagePath = `qr/${slug}_qr.pdf`
  await supabaseAdmin.storage.from("pdfs").upload(storagePath, buffer, {
    contentType: "application/pdf", upsert: true,
  })
  const qrUrl = `${SUPABASE_URL}/storage/v1/object/public/pdfs/${storagePath}`
  await supabaseAdmin.from("offres").update({ qr_url: qrUrl }).eq("slug", slug)
  return qrUrl
}

// ── POST — générer QR ──────────────────────────────────────────────────────
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params

    if (!PDF4ME_API_KEY || !PDFCO_API_KEY) {
      return NextResponse.json({ error: "Clés API manquantes" }, { status: 500 })
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

    // 1. Générer la page HTML de paiement
    const html = generateQrPageHtml(offre as Record<string,unknown>, montant, isAcompte)

    // 2. Convertir en PDF via pdf.co
    const pdfBase64 = await htmlToPdfBase64(html)

    // 3. Ajouter le QR bill Swiss via pdf4me
    const qrPdfBuffer = await addSwissQrBill(pdfBase64, offre as Record<string,unknown>, montant)

    // 4. Stocker dans Supabase
    const qrUrl = await storeQrPdf(slug, qrPdfBuffer)

    return NextResponse.json({ success: true, qr_url: qrUrl, montant, isAcompte, slug })

  } catch (err) {
    console.error("QR generation error:", err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// ── GET — URL QR stockée ───────────────────────────────────────────────────
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const { data } = await supabaseAdmin
    .from("offres").select("qr_url").eq("slug", slug).single()

  return NextResponse.json({
    qr_url: (data as Record<string,unknown>)?.qr_url || null,
    slug
  })
}