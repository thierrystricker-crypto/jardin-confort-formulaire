// app/api/offres/[slug]/qr/route.ts
// Page de paiement dynamique au style du template print Jardin-Confort
// HTML → pdf.co → pdf4me (QR Swiss) → Supabase Storage

import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

const PDF4ME_API_KEY = process.env.PDF4ME_API_KEY || ""
const PDFCO_API_KEY = process.env.PDFCO_API_KEY || ""
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ""

const THEME = "#2b8ad1"
const BLACK = "#000000"
const GREY  = "#333333"

function buildReference(numero: string): string {
  // Max 27 chars alphanumériques
  return numero.replace(/[^A-Z0-9]/g, "").slice(0, 27)
}

function fmtMoney(v: number): string {
  return new Intl.NumberFormat("fr-CH", {
    style: "currency", currency: "CHF", minimumFractionDigits: 2
  }).format(v)
}

function generateQrPageHtml(offre: Record<string,unknown>, montant: number, isAcompte: boolean): string {
  const d = (offre.data as Record<string,unknown>) || {}
  const nomClient = [offre.client_prenom, offre.client_nom].filter(Boolean).join(" ") || offre.client_societe || ""
  const societe = (offre.client_societe as string) || ""
  const rue = [offre.client_rue, (d.numero as string) || ""].filter(Boolean).join(" ")
  const npaVille = [offre.client_npa, offre.client_ville].filter(Boolean).join(" ")
  const libelle = isAcompte ? "Acompte 50% à la commande" : "Paiement d'avance à la commande"
  const montantFormate = fmtMoney(montant)
  const numero = offre.numero_affiche as string
  const isCommande = (offre.type_document as string) === "Commande"

  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8">
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous"/>
<link href="https://fonts.googleapis.com/css2?family=Raleway:wght@300;400;700;900&display=swap" rel="stylesheet"/>
<style>
* { box-sizing:border-box; margin:0; padding:0; }
body {
  font-family:'Raleway','Helvetica Neue',Arial,sans-serif;
  font-size:13px; line-height:1.5; color:${GREY};
  background:white;
  width:210mm; min-height:180mm;
  padding:14mm 16mm 80mm 14mm;
  print-color-adjust:exact; -webkit-print-color-adjust:exact;
}
.doc-header {
  display:flex; justify-content:space-between; gap:20px;
  margin-bottom:6mm; padding-bottom:4mm;
  border-bottom:2px solid ${THEME};
}
.doc-logo { max-width:175px; max-height:65px; object-fit:contain; display:block; }
.doc-ref { text-align:right; }
.doc-ref h2 { font-size:22px; font-weight:400; color:${THEME}; }
.doc-ref p { font-size:11px; color:#888; margin-top:3px; }
.doc-meta { margin-top:4mm; margin-bottom:5mm; }
.doc-meta table { border-collapse:collapse; }
.doc-meta td { padding:2px 8px 2px 0; font-size:12px; vertical-align:top; }
.doc-meta .lbl { font-weight:700; color:${BLACK}; white-space:nowrap; min-width:130px; }
.section-title {
  font-size:10px; font-weight:700; text-transform:uppercase;
  letter-spacing:.06em; color:${THEME}; margin-bottom:6px; margin-top:5mm;
}
.client-block {
  padding:10px 14px; background:#f9f9f9;
  border-left:3px solid ${THEME}; font-size:13px; line-height:1.65;
}
.client-name { font-weight:700; font-size:15px; color:${BLACK}; }
.payment-block {
  margin-top:5mm; padding:14px 20px;
  background:#EBF4FB; border:1px solid ${THEME}; border-radius:4px;
}
.payment-label {
  font-size:10px; font-weight:700; text-transform:uppercase;
  letter-spacing:.06em; color:${THEME}; margin-bottom:6px;
}
.payment-amount { font-size:28px; font-weight:900; color:${BLACK}; }
.payment-mode { font-size:11px; color:#666; margin-top:4px; }
.note {
  margin-top:5mm; font-size:10.5px; color:#999; line-height:1.55;
  border-top:1px dashed #ddd; padding-top:4mm;
}
.doc-footer {
  margin-top:6mm; border-top:1px solid #ddd; padding-top:5px;
  text-align:center; font-size:10px; color:#888; line-height:1.7;
}
.doc-footer strong { color:${BLACK}; }
.doc-footer-url { font-weight:700; color:${THEME}; }
</style>
</head><body>

<div class="doc-header">
  <img class="doc-logo"
    src="https://cdn.shopify.com/s/files/1/0360/3251/2135/files/logo_JARDIN_CONFORT_shopify.jpg?v=1614107698"
    alt="Jardin-Confort"/>
  <div class="doc-ref">
    <h2>${isCommande ? "Commande" : "Offre"}</h2>
    <p>${numero}</p>
    <p style="margin-top:4px;font-size:11px;color:#aaa;">Bulletin de paiement</p>
  </div>
</div>

<div class="doc-meta">
  <table><tbody>
    <tr><td class="lbl">N° ${isCommande ? "de commande" : "d'offre"}</td><td>${numero}</td></tr>
    ${offre.date_document ? `<tr><td class="lbl">Date</td><td>${new Date(offre.date_document as string).toLocaleDateString("fr-CH", {day:"2-digit",month:"2-digit",year:"numeric"})}</td></tr>` : ""}
    ${offre.commercial ? `<tr><td class="lbl">Conseiller</td><td>${offre.commercial}</td></tr>` : ""}
    <tr><td class="lbl">Mode de paiement</td><td>${offre.payment_mode || ""}</td></tr>
  </tbody></table>
</div>

<div class="section-title">Adresse de facturation</div>
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
  Veuillez utiliser le bulletin de paiement ci-dessous pour effectuer votre virement.
  Merci de mentionner la référence <strong>${numero}</strong> lors de votre paiement.<br/>
  Coordonnées bancaires : Banque Cantonale Vaudoise · IBAN CH72 0076 7000 K033 3796 5 · SWIFT BCVLCH2LXXX
</div>

<div class="doc-footer">
  <div><strong>Jardin-Confort SA</strong> · Route de Lavaux 425 · 1095 Lutry · Suisse</div>
  <div>contact@jardinconfort.ch · +41 21 791 36 71 · TVA : CHE-100.142.327</div>
  <div class="doc-footer-url">www.jardin-confort.ch</div>
</div>

</body></html>`
}

async function htmlToPdfBase64(html: string): Promise<string> {
  const res = await fetch("https://api.pdf.co/v1/pdf/convert/from/html", {
    method: "POST",
    headers: { "x-api-key": PDFCO_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      html,
      name: "qr_base.pdf",
      paperSize: "A4",
      orientation: "Portrait",
      margins: "0px 0px 0px 0px",
      printBackground: true,
      async: false,
    }),
  })
  const data = await res.json()
  if (data.error || !data.url) throw new Error("pdf.co error: " + (data.message || JSON.stringify(data).slice(0, 200)))
  const pdfRes = await fetch(data.url)
  const pdfBuffer = await pdfRes.arrayBuffer()
  return Buffer.from(pdfBuffer).toString("base64")
}

async function addSwissQrBill(pdfBase64: string, offre: Record<string,unknown>, montant: number): Promise<ArrayBuffer> {
  const d = (offre.data as Record<string,unknown>) || {}
  const udName = ([offre.client_prenom, offre.client_nom].filter(Boolean).join(" ")
    || offre.client_societe || "Client").toString().slice(0, 70)
  const udStreet = ((offre.client_rue as string) || "Rue inconnue").slice(0, 70)
  const udNumber = ((d.numero as string) || "1").slice(0, 16)
  const udPostalCode = ((offre.client_npa as string) || "0000").slice(0, 16)
  const udCity = ((offre.client_ville as string) || "Suisse").slice(0, 35)
  const reference = buildReference((offre.numero_affiche as string) || "")

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
    reference,
    unstructuredMessage: (isAcompte ? `Acompte 50% - ${offre.numero_affiche}` : `Paiement ${offre.numero_affiche}`).slice(0, 140),
    languageType: "French",
    seperatorLine: "LineWithScissor",
    async: true,
  }

  const res = await fetch("https://api.pdf4me.com/api/v2/CreateSwissQrBill", {
    method: "POST",
    headers: { "Authorization": `Basic ${PDF4ME_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })

  if (res.status === 200) return await res.arrayBuffer()

  if (res.status === 202) {
    const locationUrl = res.headers.get("Location")
    if (!locationUrl) throw new Error("Pas de Location header 202")
    for (let i = 0; i < 6; i++) {
      await new Promise(r => setTimeout(r, 5000))
      const poll = await fetch(locationUrl, { headers: { "Authorization": `Basic ${PDF4ME_API_KEY}` } })
      if (poll.status === 200) return await poll.arrayBuffer()
      if (poll.status !== 202) throw new Error(`Poll error: ${poll.status}`)
    }
    throw new Error("Timeout pdf4me polling")
  }

  const errText = await res.text()
  throw new Error(`pdf4me error ${res.status}: ${errText.slice(0, 300)}`)
}

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
    if (readError || !offre) return NextResponse.json({ error: "Offre non trouvée" }, { status: 404 })

    const isAcompte = (offre.payment_mode || "").includes("50%")
    const montant = isAcompte
      ? Math.round(offre.total_ttc * 0.5 * 100) / 100
      : offre.total_ttc

    const html = generateQrPageHtml(offre as Record<string,unknown>, montant, isAcompte)
    const pdfBase64 = await htmlToPdfBase64(html)
    const qrPdfBuffer = await addSwissQrBill(pdfBase64, offre as Record<string,unknown>, montant)
    const qrUrl = await storeQrPdf(slug, qrPdfBuffer)

    return NextResponse.json({ success: true, qr_url: qrUrl, montant, isAcompte, slug })
  } catch (err) {
    console.error("QR generation error:", err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

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