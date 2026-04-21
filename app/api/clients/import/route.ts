// app/api/clients/import/route.ts
// POST — import CSV clients (Shopify ou WinBiz)

import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

type ClientRow = {
  nom: string
  prenom?: string
  societe?: string
  email?: string
  tel1?: string
  tel2?: string
  rue?: string
  rue2?: string
  numero_rue?: string
  npa?: string
  ville?: string
  pays?: string
  livr_societe?: string
  livr_nom?: string
  livr_prenom?: string
  livr_rue?: string
  livr_rue2?: string
  livr_npa?: string
  livr_ville?: string
  livr_tel?: string
  source: string
}

// Formater numéro de téléphone au format suisse +41 XX XXX XX XX
function formatSwissPhone(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const digits = raw.replace(/[^\d+]/g, "").replace(/^\+/, "")
  if (!digits) return undefined
  let n = digits
  if (n.startsWith("0041")) n = "41" + n.slice(4)
  else if (n.startsWith("00")) n = n.slice(2)
  if (n.startsWith("0")) n = "41" + n.slice(1)
  if (!n.startsWith("41") && n.length <= 9) n = "41" + n
  // Format +41 XX XXX XX XX
  if (n.startsWith("41") && n.length >= 10) {
    const local = n.slice(2)
    if (local.length === 9) {
      return `+41 ${local.slice(0,2)} ${local.slice(2,5)} ${local.slice(5,7)} ${local.slice(7,9)}`
    }
  }
  return raw // retourner l'original si on ne peut pas formater
}

function parseCols(line: string, sep: string = ","): string[] {
  const cols: string[] = []
  let inQuote = false, cur = ""
  for (const ch of line) {
    if (ch === '"') { inQuote = !inQuote }
    else if (ch === sep && !inQuote) { cols.push(cur.trim()); cur = "" }
    else cur += ch
  }
  cols.push(cur.trim())
  return cols.map(c => c.replace(/^"|"$/g, "").trim())
}

function parseShopifyCSV(text: string): ClientRow[] {
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean)
  if (lines.length < 2) return []
  const headers = parseCols(lines[0]).map(h => h.toLowerCase())
  const get = (cols: string[], key: string) => (cols[headers.indexOf(key)] || "").trim()

  return lines.slice(1).map(line => {
    const cols = parseCols(line)
    const g = (key: string) => get(cols, key)

    const firstName = g("first name")
    const lastName  = g("last name")
    const email     = g("email")

    if (!lastName && !firstName && !email) return null
    if (firstName === "Guest" && lastName === "Customer") return null

    // Adresse facturation
    const rue  = g("default address address1") || g("billing address1")
    const rue2 = g("default address address2") || g("billing address2")

    // Adresse livraison (différente si renseignée)
    const livrRue   = g("shipping address address1") || g("shipping address1")
    const livrRue2  = g("shipping address address2") || g("shipping address2")
    const livrNpa   = g("shipping address zip")  || g("shipping zip")
    const livrVille = g("shipping address city") || g("shipping city")
    const livrNom   = g("shipping address last name")
    const livrPrenom= g("shipping address first name")
    const livrSoc   = g("shipping address company")

    const hasLivr = livrRue && livrRue !== rue

    return {
      nom:         lastName  || firstName || "",
      prenom:      lastName  ? firstName || undefined : undefined,
      societe:     g("default address company") || g("company") || undefined,
      email:       email || undefined,
      tel1:        formatSwissPhone(g("phone") || g("default address phone")),
      rue:         rue || undefined,
      rue2:        rue2 || undefined,
      npa:         g("default address zip") || g("billing zip") || undefined,
      ville:       g("default address city") || g("billing city") || undefined,
      pays:        g("default address country code") || "CH",
      ...(hasLivr ? {
        livr_nom:    livrNom || undefined,
        livr_prenom: livrPrenom || undefined,
        livr_societe:livrSoc || undefined,
        livr_rue:    livrRue || undefined,
        livr_rue2:   livrRue2 || undefined,
        livr_npa:    livrNpa || undefined,
        livr_ville:  livrVille || undefined,
      } : {}),
      source: "shopify",
    }
  }).filter(Boolean) as ClientRow[]
}

function parseWinBizCSV(text: string): ClientRow[] {
  const sep = text.includes(";") ? ";" : ","
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean)
  if (lines.length < 2) return []
  const headers = parseCols(lines[0], sep).map(h => h.toLowerCase())

  return lines.slice(1).map(line => {
    const cols = parseCols(line, sep)
    const get = (key: string) => (cols[headers.indexOf(key)] || "").trim()

    const nom     = get("nom") || get("name") || get("lastname") || get("raison sociale")
    const prenom  = get("prénom") || get("prenom") || get("firstname") || get("first name")
    const societe = get("société") || get("societe") || get("company") || get("raison sociale")

    if (!nom && !prenom && !societe) return null

    return {
      nom:     nom || societe || prenom,
      prenom:  nom ? prenom || undefined : undefined,
      societe: societe !== nom ? societe || undefined : undefined,
      email:   get("email") || get("e-mail") || undefined,
      tel1:    formatSwissPhone(get("téléphone") || get("telephone") || get("tel") || get("phone")),
      tel2:    formatSwissPhone(get("mobile") || get("natel")),
      rue:     get("rue") || get("adresse") || get("address") || undefined,
      rue2:    get("complément") || get("complement") || get("adresse2") || undefined,
      npa:     get("npa") || get("cp") || get("zip") || undefined,
      ville:   get("ville") || get("localité") || get("city") || undefined,
      pays:    get("pays") || get("country") || "CH",
      source:  "winbiz",
    }
  }).filter(Boolean) as ClientRow[]
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { csv, format } = body as { csv: string; format: "shopify" | "winbiz" | "auto" }

    if (!csv) return NextResponse.json({ error: "CSV vide" }, { status: 400 })

    const detectedFormat = format === "auto"
      ? csv.toLowerCase().includes("first name") ? "shopify" : "winbiz"
      : format

    const rows = detectedFormat === "shopify"
      ? parseShopifyCSV(csv)
      : parseWinBizCSV(csv)

    if (!rows.length) return NextResponse.json({ error: "Aucune ligne valide trouvée" }, { status: 400 })

    let inserted = 0, skipped = 0, errors = 0
    const batchSize = 50

    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize)
      const { data, error } = await supabaseAdmin
        .from("clients")
        .upsert(batch, { onConflict: "email", ignoreDuplicates: true })
        .select()

      if (error) {
        for (const row of batch) {
          const { error: e } = await supabaseAdmin.from("clients").insert(row)
          if (e) errors++
          else inserted++
        }
      } else {
        inserted += (data?.length || 0)
        skipped += batch.length - (data?.length || 0)
      }
    }

    return NextResponse.json({ success: true, inserted, skipped, errors, total: rows.length })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}