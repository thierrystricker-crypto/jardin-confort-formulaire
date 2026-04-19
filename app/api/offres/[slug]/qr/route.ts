// app/api/offres/[slug]/qr/route.ts — v2
// POST — génère un QR paiement Swiss via pdf4me
// et le stocke dans Supabase Storage bucket "pdfs"

import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

const PDF4ME_API_KEY = process.env.PDF4ME_API_KEY || ""
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ""

// Coordonnées bancaires Jardin-Confort
const CREDITOR = {
  name: "Jardin-Confort SA",
  addressType: "S",
  addressLine1: "Route de Lavaux 425",
  addressLine2: "1095",  // NPA pour type S
  city: "Lutry",
  postalCode: "1095",
  iban: "CH7200767000K033379650", // IBAN sans espaces
}

// PDF vide 1 page en base64 (page blanche A4)
// Utilisé comme base pour le QR bill
const BLANK_PDF_BASE64 = "JVBERi0xLjQKMSAwIG9iago8PAovVHlwZSAvQ2F0YWxvZwovUGFnZXMgMiAwIFIKPj4KZW5kb2JqCjIgMCBvYmoKPDwKL1R5cGUgL1BhZ2VzCi9LaWRzIFszIDAgUl0KL0NvdW50IDEKPJ4KZW5kb2JqCjMgMCBvYmoKPDwKL1R5cGUgL1BhZ2UKL1BhcmVudCAyIDAgUgovTWVkaWFCb3ggWzAgMCA1OTUgODQyXQo+PgplbmRvYmoKeHJlZgowIDQKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTggMDAwMDAgbiAKMDAwMDAwMDExNSAwMDAwMCBuIAp0cmFpbGVyCjw8Ci9TaXplIDQKL1Jvb3QgMSAwIFIKPj4Kc3RhcnR4cmVmCjE5MAolJUVPRgo="

function formatAmount(amount: number): string {
  // Format sans zéros en tête, avec 2 décimales
  return amount.toFixed(2)
}

function formatIban(iban: string): string {
  // Supprimer espaces et tirets
  return iban.replace(/[\s-]/g, "")
}

function buildReference(numeroCommande: string): string {
  // Référence max 27 caractères, sans caractères spéciaux
  return numeroCommande.replace(/[^A-Z0-9]/g, "").slice(0, 27)
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    return NextResponse.json({ test: "version-3", timestamp: Date.now() })
    const { slug } = await params

    if (!PDF4ME_API_KEY) {
      return NextResponse.json({ error: "PDF4ME_API_KEY non configurée" }, { status: 500 })
    }

    // 1. Lire l'offre depuis Supabase
    const { data: offre, error: readError } = await supabaseAdmin
      .from("offres")
      .select("*")
      .eq("slug", slug)
      .single()

    if (readError || !offre) {
      return NextResponse.json({ error: "Offre non trouvée" }, { status: 404 })
    }

    // 2. Calculer le montant selon le mode de paiement
    const isAcompte = (offre.payment_mode || "").includes("50%")
    const montant = isAcompte
      ? Math.round(offre.total_ttc * 0.5 * 100) / 100
      : offre.total_ttc

    // 3. Infos débiteur (client)
    const debtorName = [offre.client_prenom, offre.client_nom].filter(Boolean).join(" ")
      || offre.client_societe
      || "Client"
    const debtorAddress1 = [offre.client_rue, (offre.data as Record<string,unknown>)?.numero || ""].filter(Boolean).join(" ") || "Adresse inconnue"
    const debtorPostalCode = offre.client_npa || "0000"
    const debtorCity = offre.client_ville || "Suisse"

    // 4. Référence de paiement
    const reference = buildReference(offre.numero_affiche)
    const message = `Offre ${offre.numero_affiche}`.slice(0, 140)

    // 5. Appel API pdf4me
    const pdf4meRes = await fetch("https://api.pdf4me.com/SwissQr/CreateSwissQrBill", {
      method: "POST",
      headers: {
        "Authorization": PDF4ME_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        document: {
          docData: BLANK_PDF_BASE64,
          name: `qr_${slug}.pdf`,
        },
        swissQrCreatorAction: {
          pageNumber: 1,
          amount: formatAmount(montant),
          currency: "CHF",
          iban: formatIban(CREDITOR.iban),
          referenceType: "NON",
          reference: reference,
          unstructuredMessage: message,
          languageType: "French",
          seperatorLine: "LineWithScissor",
          // Créditeur — format S (structured)
          creditorAddressType: "S",
          creditorName: "JARDIN CONFORT SA",
          creditorAddressLine1: "Route de Lavaux",
          creditorAddressLine2: "425",
          creditorPostalCode: "1095",
          creditorCity: "Lutry",
          // Débiteur
          ultimateDebtorAddressType: "S",
          ultimateDebtorName: debtorName.slice(0, 70),
          ultimateDebtorAddressLine1: debtorAddress1.slice(0, 70),
          ultimateDebtorAddressLine2: debtorPostalCode.slice(0, 16),
          ultimateDebtorCity: debtorCity.slice(0, 35),
          ultimateDebtorPostalCode: debtorPostalCode.slice(0, 16),
          billingInfo: "",
          aV1Parameters: "",
          aV2Parameter: "",
          async: false,
        }
      }),
    })

    if (!pdf4meRes.ok) {
      const errText = await pdf4meRes.text()
      console.error("pdf4me error:", pdf4meRes.status, errText)
      return NextResponse.json({
        error: "Erreur pdf4me",
        details: errText,
        status: pdf4meRes.status
      }, { status: 500 })
    }

    const pdf4meData = await pdf4meRes.json()
    const base64Content = pdf4meData.document?.docData

    // Toujours async — retourner statusUrl pour polling côté client
    if (pdf4meData.statusUrl != null) {
      return NextResponse.json({
        async: true,
        statusUrl: pdf4meData.statusUrl,
        jobId: pdf4meData.jobId,
        slug,
      })
    }

    if (!base64Content) {
      return NextResponse.json({
        error: "Pas de contenu PDF dans la réponse pdf4me",
        responseKeys: Object.keys(pdf4meData),
        responseSample: JSON.stringify(pdf4meData).slice(0, 300)
      }, { status: 500 })
    }

    // 6. Décoder le PDF base64
    const pdfBuffer = Buffer.from(base64Content, "base64")

    // 7. Stocker dans Supabase Storage
    const storagePath = `qr/${slug}_qr.pdf`
    const { error: uploadError } = await supabaseAdmin.storage
      .from("pdfs")
      .upload(storagePath, pdfBuffer, {
        contentType: "application/pdf",
        upsert: true,
      })

    if (uploadError) {
      return NextResponse.json({ error: "Erreur stockage: " + uploadError?.message }, { status: 500 })
    }

    // 8. URL publique
    const qrUrl = `${SUPABASE_URL}/storage/v1/object/public/pdfs/${storagePath}`

    // 9. Stocker l'URL dans Supabase
    await supabaseAdmin
      .from("offres")
      .update({ qr_url: qrUrl })
      .eq("slug", slug)

    return NextResponse.json({
      success: true,
      qr_url: qrUrl,
      montant,
      isAcompte,
      slug,
    })

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
  const { searchParams } = new URL(request.url)
  const statusUrl = searchParams.get("statusUrl")

  // Mode polling — vérifier le statut d'un job pdf4me
  if (statusUrl) {
    try {
      const statusRes = await fetch(statusUrl, {
        headers: { "Authorization": PDF4ME_API_KEY }
      })
      const statusData = await statusRes.json()
      const base64Content = statusData.document?.docData

      if (!base64Content) {
        return NextResponse.json({ ready: false, docStatus: statusData.document?.docStatus })
      }

      // PDF prêt — stocker dans Supabase
      const pdfBuffer = Buffer.from(base64Content, "base64")
      const storagePath = `qr/${slug}_qr.pdf`
      await supabaseAdmin.storage.from("pdfs").upload(storagePath, pdfBuffer, {
        contentType: "application/pdf", upsert: true,
      })
      const qrUrl = `${SUPABASE_URL}/storage/v1/object/public/pdfs/${storagePath}`
      await supabaseAdmin.from("offres").update({ qr_url: qrUrl }).eq("slug", slug)

      return NextResponse.json({ ready: true, qr_url: qrUrl, slug })
    } catch (err) {
      return NextResponse.json({ error: String(err) }, { status: 500 })
    }
  }

  // Mode normal — retourner l'URL QR stockée
  const { data } = await supabaseAdmin
    .from("offres")
    .select("qr_url, total_ttc, payment_mode")
    .eq("slug", slug)
    .single()

  return NextResponse.json({
    qr_url: (data as Record<string,unknown>)?.qr_url || null,
    slug
  })
}
