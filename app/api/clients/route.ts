// app/api/clients/route.ts
// GET  — liste clients avec recherche + compteurs documents (offres / commandes / factures)
// POST — créer un nouveau client

import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

type Client = {
  id: number
  numero_client: string | null
  email: string | null
  nom?: string | null
  npa?: string | null
  complement_nom?: string | null
  livr_complement_nom?: string | null
  [key: string]: unknown
}

type DocRef = { num: string; date?: string | null }

type ClientWithCounts = Client & {
  nb_offres: number
  nb_commandes_internes: number
  nb_commandes_shopify: number
  nb_factures_winbiz: number
  // Listes de numéros récents (max 10 par catégorie)
  nums_offres: DocRef[]
  nums_commandes_internes: DocRef[]
  nums_shopify: DocRef[]
  nums_factures_winbiz: DocRef[]
}

/**
 * Découpe un tableau en chunks. Taille 200 pour rester sous les limites
 * URL/PostgREST sur les `.in(...)` à gros volume (au-delà, des batches
 * peuvent silencieusement échouer ou être tronqués).
 */
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

type OffreRow = {
  client_numero_client: string | null
  client_email: string | null
  client_nom?: string | null
  client_npa?: string | null
  type_document: string | null
  statut: string | null
  numero_affiche?: string | null
  numero_offre?: string | null
  numero_commande?: string | null
  date_document?: string | null
}

function tallyOffre(
  map: Map<number, { offres: number; commandes: number; numsOffres: DocRef[]; numsCommandes: DocRef[] }>,
  clientId: number,
  o: OffreRow
) {
  const entry = map.get(clientId) || { offres: 0, commandes: 0, numsOffres: [], numsCommandes: [] }
  const isCmd = o.type_document === "Commande" || o.statut === "Acceptée" || o.statut === "Convertie"
  const num = o.numero_affiche || o.numero_commande || o.numero_offre || ""
  const date = o.date_document || null

  if (isCmd) {
    entry.commandes++
    if (num && entry.numsCommandes.length < 10) {
      entry.numsCommandes.push({ num, date })
    }
  } else {
    entry.offres++
    if (num && entry.numsOffres.length < 10) {
      entry.numsOffres.push({ num, date })
    }
  }
  map.set(clientId, entry)
}

/**
 * Récupère tous les `client_id` matchés par une requête simple sur une table
 * en chunkant la liste d'IDs (200 max par batch) et en parallélisant les appels.
 * Les erreurs sont loggées mais ne bloquent pas — on retourne les données
 * partielles qu'on a pu récupérer (mieux que de tout perdre).
 */
async function fetchClientIdCountsByIn(
  table: "factures_winbiz" | "commandes_shopify",
  clientIds: number[]
): Promise<{ counts: Map<number, number>; nums: Map<number, DocRef[]> }> {
  const counts = new Map<number, number>()
  const nums = new Map<number, DocRef[]>()
  const batches = chunk(clientIds, 200)

  const numField = table === "factures_winbiz" ? "numero_facture" : "shopify_order_name"
  const dateField = table === "factures_winbiz" ? "date_facture" : "created_at_shopify"

  const responses = await Promise.all(
    batches.map(async (batch, idx) => {
      const { data, error } = await supabaseAdmin
        .from(table)
        .select(`client_id, ${numField}, ${dateField}`)
        .in("client_id", batch)
        .order(dateField, { ascending: false })

      if (error) {
        console.error(`[enrichWithCounts] Batch ${idx + 1}/${batches.length} on ${table} FAILED:`, error.message)
        return null
      }
      return data
    })
  )

  for (const data of responses) {
    if (!data) continue
    for (const row of data as Array<Record<string, unknown>>) {
      const cid = row.client_id as number | null
      if (cid == null) continue
      counts.set(cid, (counts.get(cid) || 0) + 1)

      const num = (row[numField] as string | null) || ""
      const date = (row[dateField] as string | null) || null
      if (num) {
        const list = nums.get(cid) || []
        // On garde max 10 numéros par client (les plus récents grâce à l'order by)
        if (list.length < 10) {
          list.push({ num, date })
          nums.set(cid, list)
        }
      }
    }
  }

  return { counts, nums }
}

/**
 * Enrichit une liste de clients avec les compteurs de documents liés.
 *
 * Stratégie offres : 3 voies de match (numero_client + email ilike + nom+npa).
 * Stratégie factures/shopify : par client_id direct, batches parallèles de 200.
 */
async function enrichWithCounts(clients: Client[]): Promise<ClientWithCounts[]> {
  if (clients.length === 0) return []

  const clientIds = clients.map(c => c.id)

  // ─── Index pour reverse-lookup ──────────────────────────────
  const emailToIds = new Map<string, number[]>()
  const numClientToIds = new Map<string, number[]>()
  const nomNpaToIds = new Map<string, number[]>()

  for (const c of clients) {
    const em = (c.email || "").toLowerCase().trim()
    const num = (c.numero_client || "").trim()
    const nom = (c.nom || "").toLowerCase().trim()
    const npa = (c.npa || "").trim()

    if (em) {
      const arr = emailToIds.get(em) || []
      arr.push(c.id); emailToIds.set(em, arr)
    }
    if (num) {
      const arr = numClientToIds.get(num) || []
      arr.push(c.id); numClientToIds.set(num, arr)
    }
    if (nom && npa) {
      const arr = nomNpaToIds.get(`${nom}||${npa}`) || []
      arr.push(c.id); nomNpaToIds.set(`${nom}||${npa}`, arr)
    }
  }

  // ─── 1) Offres ─────────────────────────────────────────────────
  const offresMap = new Map<number, {
    offres: number; commandes: number;
    numsOffres: DocRef[]; numsCommandes: DocRef[]
  }>()
  const seenOffreKeys = new Set<string>()

  function offreKey(o: OffreRow, clientId: number): string {
    return `${clientId}::${o.numero_affiche || ""}::${o.type_document}::${o.statut}`
  }

  // 1a — Match par numero_client (chunks de 200, parallèle)
  const numerosClient = Array.from(numClientToIds.keys())
  await Promise.all(
    chunk(numerosClient, 200).map(async (batch, idx) => {
      if (batch.length === 0) return
      const { data, error } = await supabaseAdmin
        .from("offres")
        .select("client_numero_client, client_email, client_nom, client_npa, type_document, statut, numero_affiche, numero_offre, numero_commande, date_document")
        .in("client_numero_client", batch)

      if (error) {
        console.error(`[enrichWithCounts] Batch numero_client ${idx} FAILED:`, error.message)
        return
      }
      for (const o of data || []) {
        const num = (o.client_numero_client || "").trim()
        const ids = numClientToIds.get(num)
        if (!ids) continue
        for (const cid of ids) {
          const key = offreKey(o, cid)
          if (seenOffreKeys.has(key)) continue
          seenOffreKeys.add(key)
          tallyOffre(offresMap, cid, o)
        }
      }
    })
  )

  // 1b — Match par email (ilike, batches de 30, parallèle)
  const emails = Array.from(emailToIds.keys())
  await Promise.all(
    chunk(emails, 30).map(async (batch, idx) => {
      if (batch.length === 0) return
      const orFilters = batch.map(e => `client_email.ilike.${escapeOrValue(e)}`).join(",")
      const { data, error } = await supabaseAdmin
        .from("offres")
        .select("client_numero_client, client_email, client_nom, client_npa, type_document, statut")
        .or(orFilters)

      if (error) {
        console.error(`[enrichWithCounts] Batch email ${idx} FAILED:`, error.message)
        return
      }
      for (const o of data || []) {
        const em = (o.client_email || "").toLowerCase().trim()
        const ids = emailToIds.get(em)
        if (!ids) continue
        for (const cid of ids) {
          const key = offreKey(o, cid)
          if (seenOffreKeys.has(key)) continue
          seenOffreKeys.add(key)
          tallyOffre(offresMap, cid, o)
        }
      }
    })
  )

  // 1c — Fallback nom+npa pour clients sans match
  const clientsSansMatch = clients.filter(c =>
    !offresMap.has(c.id) && (c.nom || "").trim() && (c.npa || "").trim()
  )
  if (clientsSansMatch.length > 0) {
    await Promise.all(
      chunk(clientsSansMatch, 20).map(async (batch, idx) => {
        const orFilters = batch.map(c => {
          const nom = (c.nom as string).replace(/[(),"']/g, " ").trim()
          const npa = (c.npa as string).replace(/[(),"']/g, "").trim()
          return `and(client_nom.ilike.*${nom}*,client_npa.eq.${npa})`
        }).join(",")

        const { data, error } = await supabaseAdmin
          .from("offres")
          .select("client_numero_client, client_email, client_nom, client_npa, type_document, statut")
          .or(orFilters)

        if (error) {
          console.error(`[enrichWithCounts] Batch nom+npa ${idx} FAILED:`, error.message)
          return
        }
        for (const o of data || []) {
          const nom = (o.client_nom || "").toLowerCase().trim()
          const npa = (o.client_npa || "").trim()
          const ids = nomNpaToIds.get(`${nom}||${npa}`)
          if (!ids) continue
          for (const cid of ids) {
            const key = offreKey(o, cid)
            if (seenOffreKeys.has(key)) continue
            seenOffreKeys.add(key)
            tallyOffre(offresMap, cid, o)
          }
        }
      })
    )
  }

  // ─── 2 + 3) Factures WinBiz et Commandes Shopify en parallèle ──
  const [facturesRes, shopifyRes] = await Promise.all([
    fetchClientIdCountsByIn("factures_winbiz", clientIds),
    fetchClientIdCountsByIn("commandes_shopify", clientIds),
  ])

  // ─── 4) Assemblage final ───────────────────────────────────────
  return clients.map(c => {
    const offresEntry = offresMap.get(c.id) || { offres: 0, commandes: 0, numsOffres: [], numsCommandes: [] }
    return {
      ...c,
      nb_offres: offresEntry.offres,
      nb_commandes_internes: offresEntry.commandes,
      nb_commandes_shopify: shopifyRes.counts.get(c.id) || 0,
      nb_factures_winbiz: facturesRes.counts.get(c.id) || 0,
      nums_offres: offresEntry.numsOffres,
      nums_commandes_internes: offresEntry.numsCommandes,
      nums_shopify: shopifyRes.nums.get(c.id) || [],
      nums_factures_winbiz: facturesRes.nums.get(c.id) || [],
    }
  })
}

function escapeOrValue(v: string): string {
  const safe = v.replace(/[(),"']/g, " ").trim()
  return `*${safe}*`
}

async function loadClientsByIds(ids: number[], limit: number): Promise<Client[]> {
  if (ids.length === 0) return []
  const uniqueIds = Array.from(new Set(ids)).slice(0, limit)
  const { data } = await supabaseAdmin
    .from("clients")
    .select("*")
    .in("id", uniqueIds)
    .order("updated_at", { ascending: false })
    .limit(limit)
  return (data || []) as Client[]
}

async function searchByDocumentNumber(q: string, limit: number): Promise<Client[] | null> {
  const trimmed = q.trim()
  const upper = trimmed.toUpperCase()

  if (/^DEV[-\s]?\d+/i.test(trimmed)) {
    const digits = trimmed.replace(/\D/g, "")
    if (!digits) return null
    const { data: offres } = await supabaseAdmin
      .from("offres")
      .select("client_numero_client, client_email")
      .or(`numero_offre.ilike.%${digits}%,numero_affiche.ilike.%DEV%${digits}%`)
      .limit(50)
    if (!offres || offres.length === 0) return []
    return await resolveClientsFromOffres(offres, limit)
  }

  if (/^CMD[-\s]?\d+/i.test(trimmed)) {
    const digits = trimmed.replace(/\D/g, "")
    if (!digits) return null
    const { data: offres } = await supabaseAdmin
      .from("offres")
      .select("client_numero_client, client_email")
      .or(`numero_commande.ilike.%${digits}%,numero_affiche.ilike.%CMD%${digits}%`)
      .limit(50)
    if (!offres || offres.length === 0) return []
    return await resolveClientsFromOffres(offres, limit)
  }

  const digitsOnly = trimmed.replace(/\D/g, "")
  const isLikelyDocNumber =
    digitsOnly.length >= 4 &&
    (/^#?\d{4,}$/.test(trimmed) ||
     /^JAR[-\s]?\d{4,}$/i.test(trimmed) ||
     /^\d{4,}$/.test(trimmed) ||
     (upper.includes("JAR") && digitsOnly.length >= 4))

  if (isLikelyDocNumber) {
    const matchedClientIds = new Set<number>()

    const { data: factures } = await supabaseAdmin
      .from("factures_winbiz")
      .select("client_id, numero_facture")
      .ilike("numero_facture", `%${digitsOnly}%`)
      .limit(50)
    for (const f of factures || []) {
      if (f.client_id != null) matchedClientIds.add(f.client_id)
    }

    const { data: shopify } = await supabaseAdmin
      .from("commandes_shopify")
      .select("client_id, shopify_order_name")
      .ilike("shopify_order_name", `%${digitsOnly}%`)
      .limit(50)
    for (const s of shopify || []) {
      if (s.client_id != null) matchedClientIds.add(s.client_id)
    }

    if (matchedClientIds.size === 0) return []
    return await loadClientsByIds(Array.from(matchedClientIds), limit)
  }

  return null
}

async function resolveClientsFromOffres(
  offres: Array<{ client_numero_client: string | null; client_email: string | null }>,
  limit: number
): Promise<Client[]> {
  const numeros = Array.from(new Set(
    offres.map(o => (o.client_numero_client || "").trim()).filter(n => n.length > 0)
  ))
  const emails = Array.from(new Set(
    offres.map(o => (o.client_email || "").toLowerCase().trim()).filter(e => e.length > 0)
  ))

  const filters: string[] = []
  if (numeros.length > 0) {
    filters.push(`numero_client.in.(${numeros.map(n => `"${n}"`).join(",")})`)
  }
  if (emails.length > 0) {
    const emailFilters = emails.map(e => `email.ilike.${escapeOrValue(e)}`).join(",")
    filters.push(emailFilters)
  }
  if (filters.length === 0) return []

  const { data } = await supabaseAdmin
    .from("clients")
    .select("*")
    .or(filters.join(","))
    .order("updated_at", { ascending: false })
    .limit(limit)

  return (data || []) as Client[]
}

export async function GET(request: NextRequest) {
  try {
    const q = request.nextUrl.searchParams.get("q")?.trim() || ""
    const limit = parseInt(request.nextUrl.searchParams.get("limit") || "50")
    const mode = request.nextUrl.searchParams.get("mode") || "client" // "client" | "document"

    let query = supabaseAdmin
      .from("clients")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(limit)

    if (q) {
      // Mode document : on cherche UNIQUEMENT dans les factures/commandes/offres
      // Pas de fallback sur clients (évite collision NPA/facture)
      if (mode === "document") {
        const docResults = await searchByDocumentNumber(q, limit)
        const { count } = await supabaseAdmin
          .from("clients")
          .select("*", { count: "exact", head: true })

        if (docResults && docResults.length > 0) {
          const enriched = await enrichWithCounts(docResults)
          return NextResponse.json({ clients: enriched, total: count || 0, matchedBy: "document" })
        }
        return NextResponse.json({ clients: [], total: count || 0, matchedBy: "document" })
      }

      const docResults = await searchByDocumentNumber(q, limit)
      if (docResults !== null) {
        if (docResults.length > 0) {
          const { count } = await supabaseAdmin
            .from("clients")
            .select("*", { count: "exact", head: true })
          const enriched = await enrichWithCounts(docResults)
          return NextResponse.json({ clients: enriched, total: count || 0 })
        }
        if (/^(DEV|CMD|JAR|#)/i.test(q.trim())) {
          const { count } = await supabaseAdmin
            .from("clients")
            .select("*", { count: "exact", head: true })
          return NextResponse.json({ clients: [], total: count || 0 })
        }
      }

      const qDigits = q.replace(/[^\d]/g, "")

      if (qDigits.length >= 3) {
        const { data: d1 } = await supabaseAdmin.from("clients").select("*")
          .or(`nom.ilike.%${q}%,prenom.ilike.%${q}%,societe.ilike.%${q}%,email.ilike.%${q}%,npa.ilike.%${q}%,ville.ilike.%${q}%,numero_client.ilike.%${q}%`)
          .order("updated_at", { ascending: false }).limit(limit)

        const { data: d2 } = await supabaseAdmin.rpc("search_clients_by_phone", {
          phone_digits: qDigits,
          max_results: limit
        })

        const merged = [...(d1 || [])]
        for (const c of (d2 || [])) {
          if (!merged.find((m: {id: number}) => m.id === c.id)) merged.push(c)
        }
        const { count } = await supabaseAdmin
          .from("clients")
          .select("*", { count: "exact", head: true })
        const enriched = await enrichWithCounts(merged.slice(0, limit))
        return NextResponse.json({ clients: enriched, total: count || 0 })
      }

      const parts = q.split(/\s+/).filter(Boolean)

      let clients: any[] = []

      if (parts.length >= 2) {
        const { data: d1 } = await supabaseAdmin
          .from("clients")
          .select("*")
          .ilike("nom", `%${parts[0]}%`)
          .or(`prenom.ilike.%${parts[1]}%,nom.ilike.%${parts[1]}%`)
          .order("updated_at", { ascending: false })
          .limit(limit)

        const { data: d2 } = await supabaseAdmin
          .from("clients")
          .select("*")
          .ilike("prenom", `%${parts[0]}%`)
          .or(`nom.ilike.%${parts[1]}%,prenom.ilike.%${parts[1]}%`)
          .order("updated_at", { ascending: false })
          .limit(limit)

        const { data: d3 } = await supabaseAdmin
          .from("clients")
          .select("*")
          .or(`nom.ilike.%${q}%,prenom.ilike.%${q}%,societe.ilike.%${q}%,email.ilike.%${q}%`)
          .order("updated_at", { ascending: false })
          .limit(limit)

        const merged: any[] = []
        for (const c of [...(d1 || []), ...(d2 || []), ...(d3 || [])]) {
          if (!merged.find((m: {id: number}) => m.id === c.id)) merged.push(c)
        }
        clients = merged.slice(0, limit)
      } else {
        const { data } = await supabaseAdmin
          .from("clients")
          .select("*")
          .or(`nom.ilike.%${q}%,prenom.ilike.%${q}%,societe.ilike.%${q}%,email.ilike.%${q}%,npa.ilike.%${q}%,ville.ilike.%${q}%,numero_client.ilike.%${q}%,tel1.ilike.%${q}%,tel2.ilike.%${q}%`)
          .order("updated_at", { ascending: false })
          .limit(limit)
        clients = data || []
      }

      const { count } = await supabaseAdmin
        .from("clients")
        .select("*", { count: "exact", head: true })
      const enriched = await enrichWithCounts(clients)
      return NextResponse.json({ clients: enriched, total: count || 0 })
    }

    const { data, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const { count } = await supabaseAdmin
      .from("clients")
      .select("*", { count: "exact", head: true })

    const enriched = await enrichWithCounts(data || [])
    return NextResponse.json({ clients: enriched, total: count || 0 })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { nom, prenom, societe, email, tel1, tel2, rue, rue2, numero_rue, npa, ville, pays, notes, source, complement_nom, livr_complement_nom } = body

    if (!nom?.trim()) return NextResponse.json({ error: "Nom requis" }, { status: 400 })

    const { data, error } = await supabaseAdmin
      .from("clients")
      .insert({
        nom: nom.trim(),
        prenom: prenom?.trim() || null,
        societe: societe?.trim() || null,
        complement_nom: complement_nom?.trim() || null,
        livr_complement_nom: livr_complement_nom?.trim() || null,
        email: email?.trim() || null,
        tel1: tel1?.trim() || null,
        tel2: tel2?.trim() || null,
        rue: rue?.trim() || null,
        rue2: body.rue2?.trim() || null,
        numero_rue: numero_rue?.trim() || null,
        npa: npa?.trim() || null,
        ville: ville?.trim() || null,
        pays: pays || "CH",
        notes: notes?.trim() || null,
        source: source || "manuel",
      })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ client: data })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}