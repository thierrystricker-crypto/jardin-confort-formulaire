// app/api/clients/route.ts
// GET  — liste clients avec recherche + compteurs documents (offres / commandes / factures)
// POST — créer un nouveau client
//
// Recherche étendue :
//   - DEV-XXXXX  → cherche dans offres.numero_offre
//   - CMD-XXXXX  → cherche dans offres.numero_commande / numero_affiche
//   - n° facture WinBiz  → cherche dans factures_winbiz.numero_facture
//   - n° commande Shopify (#65351, JAR12345, 152034) → commandes_shopify.shopify_order_name
//   - sinon → recherche classique nom/email/tel/société/etc.
//
// Compteurs documents :
//   - Logique alignée sur /api/clients/[id] (la fiche) pour cohérence visuelle
//   - Match offres : par email (ilike, case-insensitive) OU numero_client OU nom+npa fallback
//   - Match factures/shopify : par client_id direct (figé à l'import/sync)
//   - Toutes les offres comptent (peu importe le statut) — si la fiche l'affiche, la liste le compte

import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

type Client = {
  id: number
  numero_client: string | null
  email: string | null
  nom?: string | null
  npa?: string | null
  [key: string]: unknown
}

type ClientWithCounts = Client & {
  nb_offres: number
  nb_commandes_internes: number
  nb_commandes_shopify: number
  nb_factures_winbiz: number
}

/**
 * Découpe un tableau en chunks de taille `size` pour éviter les limites
 * silencieuses de Supabase/PostgREST sur les `.in(...)` à gros volume.
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
}

/**
 * Incrémente les compteurs offres/commandes pour un client donné.
 * Une offre = type_document="Offre" (toutes statuts confondus, pour cohérence avec la fiche).
 * Une commande interne = type_document="Commande" OU statut "Acceptée"/"Convertie".
 */
function tallyOffre(map: Map<number, { offres: number; commandes: number }>, clientId: number, o: OffreRow) {
  const counts = map.get(clientId) || { offres: 0, commandes: 0 }
  if (o.type_document === "Commande" || o.statut === "Acceptée" || o.statut === "Convertie") {
    counts.commandes++
  } else {
    counts.offres++
  }
  map.set(clientId, counts)
}

/**
 * Enrichit une liste de clients avec les compteurs de documents liés.
 *
 * Stratégie offres : on récupère TOUTES les offres potentiellement liées
 * via 3 voies (numero_client, email ilike, nom+npa fallback) en évitant
 * les doublons grâce à un Set de clés synthétiques.
 */
async function enrichWithCounts(clients: Client[]): Promise<ClientWithCounts[]> {
  if (clients.length === 0) return []

  const clientIds = clients.map(c => c.id)

  // Index pour reverse-lookup
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
  const offresMap = new Map<number, { offres: number; commandes: number }>()
  // Set de dédup : empêche de compter 2× la même offre quand elle matche par 2 voies
  const seenOffreKeys = new Set<string>()

  function offreKey(o: OffreRow, clientId: number): string {
    return `${clientId}::${o.client_numero_client || ""}::${(o.client_email || "").toLowerCase()}::${o.type_document}::${o.statut}`
  }

  // 1a — Match par numero_client (exact, fast path le plus fiable)
  const numerosClient = Array.from(numClientToIds.keys())
  for (const batch of chunk(numerosClient, 500)) {
    if (batch.length === 0) continue
    const { data } = await supabaseAdmin
      .from("offres")
      .select("client_numero_client, client_email, client_nom, client_npa, type_document, statut")
      .in("client_numero_client", batch)

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
  }

  // 1b — Match par email (ilike → case-insensitive)
  // On batche les emails par paquets de 50 dans un OR de ilike
  const emails = Array.from(emailToIds.keys())
  for (const batch of chunk(emails, 50)) {
    if (batch.length === 0) continue
    const orFilters = batch
      .map(e => `client_email.ilike.${escapeOrValue(e)}`)
      .join(",")

    const { data } = await supabaseAdmin
      .from("offres")
      .select("client_numero_client, client_email, client_nom, client_npa, type_document, statut")
      .or(orFilters)

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
  }

  // 1c — Fallback nom+npa pour clients sans email ni numero_client
  // (ou qui n'ont matché aucune offre par les 2 voies précédentes)
  const clientsSansMatch = clients.filter(c =>
    !offresMap.has(c.id) && (c.nom || "").trim() && (c.npa || "").trim()
  )
  if (clientsSansMatch.length > 0) {
    for (const batch of chunk(clientsSansMatch, 30)) {
      const orFilters = batch.map(c => {
        const nom = (c.nom as string).replace(/[(),"']/g, " ").trim()
        const npa = (c.npa as string).replace(/[(),"']/g, "").trim()
        return `and(client_nom.ilike.*${nom}*,client_npa.eq.${npa})`
      }).join(",")

      const { data } = await supabaseAdmin
        .from("offres")
        .select("client_numero_client, client_email, client_nom, client_npa, type_document, statut")
        .or(orFilters)

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
    }
  }

  // ─── 2) Factures WinBiz : par client_id direct ─────────────────
  const facturesMap = new Map<number, number>()
  for (const batch of chunk(clientIds, 500)) {
    const { data } = await supabaseAdmin
      .from("factures_winbiz")
      .select("client_id")
      .in("client_id", batch)
    for (const f of data || []) {
      if (f.client_id == null) continue
      facturesMap.set(f.client_id, (facturesMap.get(f.client_id) || 0) + 1)
    }
  }

  // ─── 3) Commandes Shopify : par client_id direct ───────────────
  const shopifyMap = new Map<number, number>()
  for (const batch of chunk(clientIds, 500)) {
    const { data } = await supabaseAdmin
      .from("commandes_shopify")
      .select("client_id")
      .in("client_id", batch)
    for (const s of data || []) {
      if (s.client_id == null) continue
      shopifyMap.set(s.client_id, (shopifyMap.get(s.client_id) || 0) + 1)
    }
  }

  // ─── 4) Assemblage final ───────────────────────────────────────
  return clients.map(c => {
    const offresCounts = offresMap.get(c.id) || { offres: 0, commandes: 0 }
    return {
      ...c,
      nb_offres: offresCounts.offres,
      nb_commandes_internes: offresCounts.commandes,
      nb_commandes_shopify: shopifyMap.get(c.id) || 0,
      nb_factures_winbiz: facturesMap.get(c.id) || 0,
    }
  })
}

/**
 * Échappe une valeur pour l'utiliser dans un filtre `.or()` PostgREST.
 * Les caractères , ( ) " ' cassent les expressions OR — on les remplace par espace.
 */
function escapeOrValue(v: string): string {
  const safe = v.replace(/[(),"']/g, " ").trim()
  return `*${safe}*`
}

/**
 * Charge des clients par leurs IDs.
 */
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

/**
 * Recherche un client à partir d'un numéro de document.
 */
async function searchByDocumentNumber(q: string, limit: number): Promise<Client[] | null> {
  const trimmed = q.trim()
  const upper = trimmed.toUpperCase()

  // Cas 1 : DEV-XXXXX
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

  // Cas 2 : CMD-XXXXX
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

  // Cas 3 : numéro Shopify ou WinBiz
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

    let query = supabaseAdmin
      .from("clients")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(limit)

    if (q) {
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
    const { nom, prenom, societe, email, tel1, tel2, rue, rue2, numero_rue, npa, ville, pays, notes, source } = body

    if (!nom?.trim()) return NextResponse.json({ error: "Nom requis" }, { status: 400 })

    const { data, error } = await supabaseAdmin
      .from("clients")
      .insert({
        nom: nom.trim(),
        prenom: prenom?.trim() || null,
        societe: societe?.trim() || null,
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