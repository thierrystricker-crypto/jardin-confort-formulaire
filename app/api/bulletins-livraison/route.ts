// app/api/bulletins-livraison/route.ts
// Bulletins de livraison « à la volée » — envois partiels, lignes ajoutées,
// quantités modifiées. Chantier du 02.09.2026.
//
// - GET  ?slug=<slug>   → historique des bulletins d'une commande (plus récent
//                          en premier). Lecture seule.
// - POST { slug, mention, lines } → enregistre le bulletin dans
//   bulletins_livraison, puis génère le PDF via pdf.co en rendant la page
//   /print/bulletin-livraison/[slug]?bulletin=<id> (même chaîne que la fiche
//   de travail : jc_token en query pour passer le verrou proxy.ts), dépose le
//   fichier dans le bucket pdfs sous bulletins/, et écrit pdf_url.
//
// ⚠️ N'écrit JAMAIS dans `offres` : la commande reste la preuve. Un bulletin
//    est une photographie de ce qui part dans un colis, rien d'autre.
// ⚠️ Aucun prix ne transite ici : nettoyerLignes() ne laisse passer que
//    désignation / référence / quantité / visuels.

import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { randomBytes } from "crypto"

const PDFCO_API_KEY = process.env.PDFCO_API_KEY || ""
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://offres.jardin-confort.ch"
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ""

export type BulletinLine = {
  sourceId: string | null
  type: "product" | "custom" | "comment" | "media"
  sku: string
  title: string
  qty: number
  image?: string
  mediaUrl?: string
  mediaSize?: "small" | "medium" | "large"
  mediaSource?: "library" | "upload"
}

const MAX_LINES = 200
const MAX_TITLE = 500

function nettoyerLignes(brut: unknown): BulletinLine[] {
  if (!Array.isArray(brut)) return []
  const out: BulletinLine[] = []
  for (const l of brut.slice(0, MAX_LINES)) {
    if (!l || typeof l !== "object") continue
    const o = l as Record<string, unknown>
    const type = o.type
    if (type !== "product" && type !== "custom" && type !== "comment" && type !== "media") continue
    const title = String(o.title ?? "").slice(0, MAX_TITLE)
    const qtyNum = Math.floor(Number(o.qty))
    const qty = Number.isFinite(qtyNum) && qtyNum > 0 ? qtyNum : 1
    if (type === "media" && typeof o.mediaUrl !== "string") continue
    if ((type === "product" || type === "custom") && !title.trim()) continue
    const line: BulletinLine = {
      sourceId: typeof o.sourceId === "string" && o.sourceId ? o.sourceId : null,
      type,
      sku: String(o.sku ?? "").slice(0, 100),
      title,
      qty: type === "comment" || type === "media" ? 0 : qty,
    }
    if (typeof o.image === "string" && o.image.startsWith("http")) line.image = o.image
    if (typeof o.mediaUrl === "string") line.mediaUrl = o.mediaUrl
    if (o.mediaSize === "small" || o.mediaSize === "medium" || o.mediaSize === "large") line.mediaSize = o.mediaSize
    if (o.mediaSource === "library" || o.mediaSource === "upload") line.mediaSource = o.mediaSource
    out.push(line)
  }
  return out
}

async function genererPdf(slug: string, bulletinId: string, fileName: string): Promise<{ buffer: ArrayBuffer | null; error?: string }> {
  const jcToken = encodeURIComponent(process.env.DASHBOARD_SESSION_SECRET || "")
  const printUrl = `${APP_URL}/print/bulletin-livraison/${slug}?bulletin=${bulletinId}&jc_token=${jcToken}`

  const pdfcoRes = await fetch("https://api.pdf.co/v1/pdf/convert/from/url", {
    method: "POST",
    headers: { "x-api-key": PDFCO_API_KEY, "Content-Type": "application/json" },
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
  if (!pdfResponse.ok) return { buffer: null, error: "Téléchargement PDF échoué" }
  return { buffer: await pdfResponse.arrayBuffer() }
}

// ─────────────────────────────────────────────────────────────
// GET ?slug= — historique d'une commande
// ─────────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("slug")?.trim()
  if (!slug) return NextResponse.json({ error: "Paramètre slug manquant" }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from("bulletins_livraison")
    .select("id, offre_slug, numero_affiche, numero_bulletin, mention, lines, nb_lignes, nb_pieces, pdf_url, pdf_erreur, cree_par, created_at")
    .eq("offre_slug", slug)
    .order("numero_bulletin", { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ bulletins: data || [], count: data?.length || 0 })
}

// ─────────────────────────────────────────────────────────────
// POST — enregistrer un bulletin + générer son PDF
// ─────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const slug = typeof body.slug === "string" ? body.slug.trim() : ""
    if (!slug) return NextResponse.json({ error: "slug manquant" }, { status: 400 })

    const mention = typeof body.mention === "string" ? body.mention.trim().slice(0, 120) : ""
    const creePar = typeof body.cree_par === "string" ? body.cree_par.trim().slice(0, 60) : ""
    const lines = nettoyerLignes(body.lines)
    const articles = lines.filter((l) => l.type === "product" || l.type === "custom")
    if (articles.length === 0) {
      return NextResponse.json({ error: "Un bulletin doit contenir au moins un article" }, { status: 400 })
    }

    // 1. La commande doit exister et être une VRAIE commande (CMD-XXXXX)
    const { data: offre, error: readError } = await supabaseAdmin
      .from("offres")
      .select("slug, numero_affiche, type_document")
      .eq("slug", slug)
      .single()
    if (readError || !offre) return NextResponse.json({ error: "Commande introuvable" }, { status: 404 })
    if (offre.type_document !== "Commande") {
      return NextResponse.json({ error: "Un bulletin de livraison ne s'établit que sur une commande" }, { status: 400 })
    }

    // 2. Numéro du bulletin dans la commande (index unique → un doublon
    //    concurrent échoue bruyamment plutôt que de se glisser)
    const { count } = await supabaseAdmin
      .from("bulletins_livraison")
      .select("id", { count: "exact", head: true })
      .eq("offre_slug", slug)
    const numeroBulletin = (count || 0) + 1

    const nbPieces = articles.reduce((s, l) => s + l.qty, 0)

    // 3. Enregistrement AVANT le PDF : l'historique ne dépend pas de pdf.co
    const { data: row, error: insertError } = await supabaseAdmin
      .from("bulletins_livraison")
      .insert({
        offre_slug: slug,
        numero_affiche: offre.numero_affiche || null,
        numero_bulletin: numeroBulletin,
        mention: mention || null,
        lines,
        nb_lignes: articles.length,
        nb_pieces: nbPieces,
        cree_par: creePar || null,
      })
      .select("id, numero_bulletin, created_at")
      .single()
    if (insertError || !row) {
      return NextResponse.json({ error: "Enregistrement impossible : " + (insertError?.message || "inconnu") }, { status: 500 })
    }

    // 4. PDF
    if (!PDFCO_API_KEY) {
      await supabaseAdmin.from("bulletins_livraison").update({ pdf_erreur: "PDFCO_API_KEY non configurée" }).eq("id", row.id)
      return NextResponse.json({ error: "PDFCO_API_KEY non configurée", bulletin: { ...row, pdf_url: null } }, { status: 502 })
    }

    const fileName = `bulletin-${slug}-${numeroBulletin}.pdf`
    const { buffer, error: pdfError } = await genererPdf(slug, row.id, fileName)
    if (!buffer) {
      await supabaseAdmin.from("bulletins_livraison").update({ pdf_erreur: pdfError || "pdf.co" }).eq("id", row.id)
      return NextResponse.json({ error: "Génération PDF échouée : " + pdfError, bulletin: { ...row, pdf_url: null } }, { status: 502 })
    }

    const token = randomBytes(3).toString("hex")
    const storagePath = `bulletins/${slug}_${numeroBulletin}_${token}.pdf`
    const { error: uploadError } = await supabaseAdmin.storage
      .from("pdfs")
      .upload(storagePath, buffer, { contentType: "application/pdf", upsert: false })
    if (uploadError) {
      await supabaseAdmin.from("bulletins_livraison").update({ pdf_erreur: "Storage : " + uploadError.message }).eq("id", row.id)
      return NextResponse.json({ error: "Stockage PDF échoué : " + uploadError.message, bulletin: { ...row, pdf_url: null } }, { status: 502 })
    }

    const pdfUrl = `${SUPABASE_URL}/storage/v1/object/public/pdfs/${storagePath}`
    await supabaseAdmin.from("bulletins_livraison").update({ pdf_url: pdfUrl, pdf_erreur: null }).eq("id", row.id)

    return NextResponse.json({
      success: true,
      bulletin: { id: row.id, numero_bulletin: row.numero_bulletin, created_at: row.created_at, pdf_url: pdfUrl },
    })
  } catch (err) {
    console.error("Bulletin livraison POST error:", err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
