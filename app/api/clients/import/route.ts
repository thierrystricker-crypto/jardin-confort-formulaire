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
  numero_rue?: string
  npa?: string
  ville?: string
  pays?: string
  source: string
}

function parseShopifyCSV(text: string): ClientRow[] {
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean)
  if (lines.length < 2) return []
  const headers = lines[0].split(",").map(h => h.replace(/"/g, "").trim().toLowerCase())

  return lines.slice(1).map(line => {
    const cols: string[] = []
    let inQuote = false, cur = ""
    for (const ch of line) {
      if (ch === '"') { inQuote = !inQuote }
      else if (ch === "," && !inQuote) { cols.push(cur.trim()); cur = "" }
      else cur += ch
    }
    cols.push(cur.trim())

    const get = (key: string) => (cols[headers.indexOf(key)] || "").replace(/"/g, "").trim()

    const firstName = get("first name") || get("billing first name") || get("prenom") || get("prénom")
    const lastName  = get("last name")  || get("billing last name")  || get("nom")
    const email     = get("email")

    if (!lastName && !firstName && !email) return null
    if (firstName === "Guest" && lastName === "Customer") return null

    return {
      nom:        lastName  || firstName || "",
      prenom:     lastName  ? firstName || undefined : undefined,
      societe:    get("default address company") || get("company") || get("billing company") || undefined,
      email:      email || undefined,
      tel1:       get("phone") || get("default address phone") || get("billing phone") || undefined,
      rue:        get("default address address1") || get("billing address1") || undefined,
      npa:        get("default address zip") || get("billing zip") || undefined,
      ville:      get("default address city") || get("billing city") || undefined,
      pays:       get("default address country code") || get("billing country code") || "CH",
      source:     "shopify",
    }
  }).filter(Boolean) as ClientRow[]
}

function parseWinBizCSV(text: string): ClientRow[] {
  // WinBiz utilise souvent ; comme séparateur
  const sep = text.includes(";") ? ";" : ","
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean)
  if (lines.length < 2) return []
  const headers = lines[0].split(sep).map(h => h.replace(/"/g, "").trim().toLowerCase())

  return lines.slice(1).map(line => {
    const cols = line.split(sep).map(c => c.replace(/"/g, "").trim())
    const get = (key: string) => cols[headers.indexOf(key)] || ""

    // WinBiz : essayer plusieurs noms de colonnes possibles
    const nom     = get("nom") || get("name") || get("lastname") || get("raison sociale")
    const prenom  = get("prénom") || get("prenom") || get("firstname") || get("first name")
    const societe = get("société") || get("societe") || get("company") || get("raison sociale")

    if (!nom && !prenom && !societe) return null

    return {
      nom:        nom || societe || prenom,
      prenom:     nom ? prenom || undefined : undefined,
      societe:    societe !== nom ? societe || undefined : undefined,
      email:      get("email") || get("e-mail") || undefined,
      tel1:       get("téléphone") || get("telephone") || get("tel") || get("phone") || undefined,
      tel2:       get("mobile") || get("natel") || undefined,
      rue:        get("rue") || get("adresse") || get("address") || undefined,
      npa:        get("npa") || get("cp") || get("zip") || undefined,
      ville:      get("ville") || get("localité") || get("city") || undefined,
      pays:       get("pays") || get("country") || "CH",
      source:     "winbiz",
    }
  }).filter(Boolean) as ClientRow[]
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { csv, format } = body as { csv: string; format: "shopify" | "winbiz" | "auto" }

    if (!csv) return NextResponse.json({ error: "CSV vide" }, { status: 400 })

    // Détection auto du format
    const detectedFormat = format === "auto"
      ? csv.toLowerCase().includes("billing first name") || csv.toLowerCase().includes("first name")
        ? "shopify" : "winbiz"
      : format

    const rows = detectedFormat === "shopify"
      ? parseShopifyCSV(csv)
      : parseWinBizCSV(csv)

    if (!rows.length) return NextResponse.json({ error: "Aucune ligne valide trouvée" }, { status: 400 })

    // Insérer par batch de 50, ignorer les doublons sur email
    let inserted = 0, skipped = 0, errors = 0
    const batchSize = 50

    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize)
      const { data, error } = await supabaseAdmin
        .from("clients")
        .upsert(batch, {
          onConflict: "email",
          ignoreDuplicates: true,
        })
        .select()

      if (error) {
        // Si pas de contrainte unique sur email, insérer un par un
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