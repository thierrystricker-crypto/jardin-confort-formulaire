// app/api/qr-libre/route.ts
// QR-paiement à la volée — hors documents offres/commandes.
//
// Cas d'usage : demande d'acompte à un nouveau client, ou solde d'une commande
// dont le QR figé (50 % / 100 % du montant convenu) ne correspond plus à ce que
// le client veut payer (acompte carte/cash au magasin, solde par QR, etc.).
//
// Même chaîne de génération que le QR des commandes (HTML → pdf.co → pdf4me
// Swiss QR → Supabase Storage), volontairement DUPLIQUÉE ici :
// app/api/offres/[slug]/qr/route.ts est sanctuarisé et n'est pas touché.
//
// - POST : génère le PDF (bulletin + QR suisse) et l'enregistre dans
//   qr_libres (historique). N'écrit JAMAIS dans offres.
// - GET ?commande=CMD-XXXXX : pré-remplissage depuis une commande/offre
//   existante (adresse + total). Lecture seule.
// - GET (sans paramètre) : historique des 30 derniers QR libres.
//
// Route INTERNE : protégée par le verrou proxy.ts (cookie jc_acces).

import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { randomBytes } from "crypto"

const PDF4ME_API_KEY = process.env.PDF4ME_API_KEY || ""
const PDFCO_API_KEY = process.env.PDFCO_API_KEY || ""
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ""

const THEME = "#2b8ad1"
const BLACK = "#000000"
const GREY  = "#333333"

type QrLibreInput = {
  societe?: string
  nom?: string
  prenom?: string
  rue?: string
  numero?: string
  npa?: string
  ville?: string
  montant?: number | string
  libelle?: string
  reference?: string
  commande_numero?: string
  commercial?: string
}

function s(v: unknown): string {
  return typeof v === "string" ? v.trim() : ""
}

function buildReference(numero: string): string {
  // Max 27 chars alphanumériques (même règle que le QR des commandes)
  return numero.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 27)
}

function fmtMoney(v: number): string {
  return new Intl.NumberFormat("fr-CH", {
    style: "currency", currency: "CHF", minimumFractionDigits: 2
  }).format(v)
}

function escapeHtml(v: string): string {
  return v
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;")
}

function generateQrLibreHtml(input: {
  nomClient: string
  personneNom: string
  societe: string
  rue: string
  npaVille: string
  montant: number
  libelle: string
  reference: string
  commercial: string
}): string {
  const montantFormate = fmtMoney(input.montant)
  const dateJour = new Date().toLocaleDateString("fr-CH", {
    day: "2-digit", month: "2-digit", year: "numeric",
  })
  const e = escapeHtml

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
    <h2>Bulletin de paiement</h2>
    ${input.reference ? `<p>Référence ${e(input.reference)}</p>` : ""}
    <p style="margin-top:4px;font-size:11px;color:#aaa;">${e(input.libelle)}</p>
  </div>
</div>

<div class="doc-meta">
  <table><tbody>
    <tr><td class="lbl">Date</td><td>${dateJour}</td></tr>
    ${input.reference ? `<tr><td class="lbl">Référence</td><td>${e(input.reference)}</td></tr>` : ""}
    ${input.commercial ? `<tr><td class="lbl">Conseiller</td><td>${e(input.commercial)}</td></tr>` : ""}
  </tbody></table>
</div>

<div class="section-title">Adresse de facturation</div>
<div class="client-block">
  <div class="client-name">${e(input.nomClient)}</div>
  ${input.societe && input.personneNom ? `<div style="font-size:11px;color:#666;">À l'attention de ${e(input.personneNom)}</div>` : ""}
  ${input.rue ? `<div>${e(input.rue)}</div>` : ""}
  ${input.npaVille ? `<div>${e(input.npaVille)}</div>` : ""}
</div>

<div class="payment-block">
  <div class="payment-label">${e(input.libelle)}</div>
  <div class="payment-amount">${montantFormate}</div>
</div>

<div class="note">
  Veuillez utiliser le bulletin de paiement ci-dessous pour effectuer votre virement.${input.reference ? `
  Merci de mentionner la référence <strong>${e(input.reference)}</strong> lors de votre paiement.` : ""}<br/>
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
      name: "qr_libre_base.pdf",
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

async function addSwissQrBill(pdfBase64: string, input: {
  docName: string
  udName: string
  udStreet: string
  udNumber: string
  udPostalCode: string
  udCity: string
  montant: number
  reference: string
  message: string
}): Promise<ArrayBuffer> {
  const payload = {
    docContent: pdfBase64,
    docName: input.docName,
    iban: "CH7200767000K03337965",
    crName: "JARDIN CONFORT SA",
    crAddressType: "S",
    crStreetOrAddressLine1: "Route de Lavaux",
    crStreetOrAddressLine2: "425",
    crPostalCode: "1095",
    crCity: "Lutry",
    amount: input.montant.toFixed(2),
    currency: "CHF",
    udName: input.udName.slice(0, 70),
    udAddressType: "S",
    udStreetOrAddressLine1: input.udStreet.slice(0, 70),
    udStreetOrAddressLine2: input.udNumber.slice(0, 16),
    udPostalCode: input.udPostalCode.slice(0, 16),
    udCity: input.udCity.slice(0, 35),
    referenceType: "NON",
    reference: input.reference,
    unstructuredMessage: input.message.slice(0, 140),
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

// ─────────────────────────────────────────────────────────────
// POST — générer un QR-paiement libre
// ─────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    if (!PDF4ME_API_KEY || !PDFCO_API_KEY) {
      return NextResponse.json({ error: "Clés API manquantes" }, { status: 500 })
    }

    const body = (await request.json().catch(() => ({}))) as QrLibreInput
    const societe = s(body.societe)
    const nom = s(body.nom)
    const prenom = s(body.prenom)
    const rue = s(body.rue)
    const numero = s(body.numero)
    const npa = s(body.npa)
    const ville = s(body.ville)
    const libelle = s(body.libelle) || "Acompte"
    const reference = s(body.reference)
    const commandeNumero = s(body.commande_numero)
    const commercial = s(body.commercial)

    const montant = Math.round(
      (typeof body.montant === "number"
        ? body.montant
        : parseFloat(String(body.montant ?? "").replace(/'/g, "").replace(",", "."))) * 100
    ) / 100

    // ─── Validations minimales ───
    // Le QR suisse exige un débiteur complet (nom + adresse structurée).
    if (!societe && !nom) {
      return NextResponse.json({ error: "Nom ou société obligatoire" }, { status: 400 })
    }
    if (!rue || !npa || !ville) {
      return NextResponse.json({ error: "Adresse complète obligatoire (rue, NPA, ville)" }, { status: 400 })
    }
    if (!Number.isFinite(montant) || montant <= 0) {
      return NextResponse.json({ error: "Montant invalide" }, { status: 400 })
    }
    if (montant > 999999999.99) {
      return NextResponse.json({ error: "Montant trop élevé" }, { status: 400 })
    }

    // Même convention que le QR des commandes : société = client principal
    // (B2B, un seul champ nom côté débiteur ISO 20022), sinon prénom + nom.
    const personneNom = [prenom, nom].filter(Boolean).join(" ")
    const nomClient = societe || personneNom

    const html = generateQrLibreHtml({
      nomClient,
      personneNom,
      societe,
      rue: [rue, numero].filter(Boolean).join(" "),
      npaVille: [npa, ville].filter(Boolean).join(" "),
      montant,
      libelle,
      reference: reference || commandeNumero,
      commercial,
    })

    const pdfBase64 = await htmlToPdfBase64(html)
    const qrPdfBuffer = await addSwissQrBill(pdfBase64, {
      docName: "qr_libre.pdf",
      udName: nomClient,
      udStreet: rue,
      udNumber: numero || "1",
      udPostalCode: npa,
      udCity: ville,
      montant,
      reference: buildReference(reference || commandeNumero),
      message: [libelle, reference || commandeNumero].filter(Boolean).join(" - "),
    })

    // ─── Stockage (bucket pdfs, dossier qr-libre/) ───
    const fileToken = `${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`
    const storagePath = `qr-libre/qr_libre_${fileToken}.pdf`
    const buffer = Buffer.from(qrPdfBuffer)
    const { error: uploadError } = await supabaseAdmin.storage
      .from("pdfs")
      .upload(storagePath, buffer, { contentType: "application/pdf", upsert: false })
    if (uploadError) throw new Error("Storage error: " + uploadError.message)
    const pdfUrl = `${SUPABASE_URL}/storage/v1/object/public/pdfs/${storagePath}`

    // ─── Historique ───
    const { data: row, error: insertError } = await supabaseAdmin
      .from("qr_libres")
      .insert({
        societe: societe || null,
        nom: nom || null,
        prenom: prenom || null,
        rue: rue || null,
        numero: numero || null,
        npa,
        ville,
        montant,
        libelle,
        reference: reference || null,
        commande_numero: commandeNumero || null,
        commercial: commercial || null,
        pdf_url: pdfUrl,
      })
      .select("id, created_at")
      .single()
    if (insertError) {
      // Le PDF existe déjà : on signale mais on ne bloque pas la réponse.
      console.error("qr_libres insert error:", insertError)
    }

    return NextResponse.json({
      success: true,
      pdf_url: pdfUrl,
      montant,
      id: row?.id ?? null,
    })
  } catch (err) {
    console.error("QR libre generation error:", err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// ─────────────────────────────────────────────────────────────
// GET — historique, ou pré-remplissage depuis une commande/offre
// ─────────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  try {
    const commande = s(request.nextUrl.searchParams.get("commande") || "")

    // ─── Pré-remplissage : /api/qr-libre?commande=CMD-80923 ───
    if (commande) {
      const q = commande.toUpperCase()
      const champs =
        "slug, type_document, numero_affiche, statut, date_document, payment_mode, total_ttc, " +
        "client_societe, client_nom, client_prenom, client_rue, client_numero, client_npa, client_ville, data"

      // 1. Correspondance exacte sur le numéro affiché (CMD-80923, DEV-2026-748)
      let { data: doc } = await supabaseAdmin
        .from("offres").select(champs)
        .ilike("numero_affiche", q)
        .order("created_at", { ascending: false })
        .limit(1).maybeSingle()

      // 2. Repli : numéro de commande ou d'offre (préférer la commande, plus récente)
      if (!doc) {
        const res = await supabaseAdmin
          .from("offres").select(champs)
          .or(`numero_commande.ilike.%${q}%,numero_offre.ilike.%${q}%`)
          .order("created_at", { ascending: false })
          .limit(1).maybeSingle()
        doc = res.data
      }

      if (!doc) {
        return NextResponse.json({ error: "Document introuvable" }, { status: 404 })
      }

      const d = (doc.data as Record<string, unknown>) || {}
      return NextResponse.json({
        document: {
          numero_affiche: doc.numero_affiche,
          type_document: doc.type_document,
          statut: doc.statut,
          date_document: doc.date_document,
          payment_mode: doc.payment_mode,
          total_ttc: doc.total_ttc,
          societe: doc.client_societe || "",
          nom: doc.client_nom || "",
          prenom: doc.client_prenom || "",
          rue: doc.client_rue || "",
          numero: doc.client_numero || (d.numero as string) || "",
          npa: doc.client_npa || "",
          ville: doc.client_ville || "",
        },
      })
    }

    // ─── Historique (30 derniers) ───
    const { data, error } = await supabaseAdmin
      .from("qr_libres")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(30)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ historique: data || [] })
  } catch (err) {
    console.error("QR libre GET error:", err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
