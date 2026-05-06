// app/api/clients/route.ts
// GET  — liste clients avec recherche + compteurs documents (offres / commandes / factures)
// POST — créer un nouveau client
//
// Recherche étendue :
//   - DEV-XXXXX / DEVXXXXX  → cherche dans offres.numero_offre
//   - CMD-XXXXX / CMDXXXXX  → cherche dans offres.numero_commande / numero_affiche
//   - n° de facture WinBiz  → cherche dans factures_winbiz.numero_facture
//   - n° de commande Shopify (#65351, JAR12345, 152034, etc.) → cherche dans commandes_shopify.shopify_order_name
//   - sinon → recherche classique nom/email/tel/société/etc.

import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

type Client = {
  id: number
  numero_client: string | null
  email: string | null
  [key: string]: unknown
}

type ClientWithCounts = Client & {
  nb_offres: number
  nb_commandes_internes: number
  nb_commandes_shopify: number
  nb_factures_winbiz: number
}

/**
 * Enrichit une liste de clients avec les compteurs de documents liés.
 */
async function enrichWithCounts(clients: Client[]): Promise<ClientWithCounts[]> {
  if (clients.length === 0) return []

  const clientIds = clients.map(c => c.id)

  const numerosClient = Array.from(new Set(
    clients
      .map(c => (c.numero_client || "").trim())
      .filter(n => n.length > 0)
  ))
  const emails = Array.from(new Set(
    clients
      .map(c => (c.email || "").toLowerCase().trim())
      .filter(e => e.length > 0)
  ))

  const offresMap = new Map<number, { offres: number; commandes: number }>()

  if (numerosClient.length > 0 || emails.length > 0) {
    const filters: string[] = []
    if (numerosClient.length > 0) {
      filters.push(`client_numero_client.in.(${numerosClient.map(n => `"${n}"`).join(",")})`)
    }
    if (emails.length > 0) {
      filters.push(`client_email.in.(${emails.map(e => `"${e}"`).join(",")})`)
    }

    const { data: offresData } = await supabaseAdmin
      .from("offres")
      .select("client_numero_client, client_email, type_document, statut")
      .or(filters.join(","))

    const numClientToId = new Map<string, number>()
    const emailToId = new Map<string, number>()
    for (const c of clients) {
      const num = (c.numero_client || "").trim()
      const em = (c.email || "").toLowerCase().trim()
      if (num) numClientToId.set(num, c.id)
      if (em) emailToId.set(em, c.id)
    }

    for (const o of offresData || []) {
      let clientId: number | undefined
      const num = (o.client_numero_client || "").trim()
      if (num) clientId = numClientToId.get(num)
      if (!clientId) {
        const em = (o.client_email || "").toLowerCase().trim()
        if (em) clientId = emailToId.get(em)
      }
      if (!clientId) continue

      const counts = offresMap.get(clientId) || { offres: 0, commandes: 0 }
      if (o.type_document === "Commande" || o.statut === "Acceptée" || o.statut === "Convertie") {
        counts.commandes++
      } else if (
        o.type_document === "Offre" &&
        !["Abandonnée", "Refusée"].includes(o.statut || "")
      ) {
        counts.offres++
      }
      offresMap.set(clientId, counts)
    }
  }

  const facturesMap = new Map<number, number>()
  const { data: facturesData } = await supabaseAdmin
    .from("factures_winbiz")
    .select("client_id")
    .in("client_id", clientIds)

  for (const f of facturesData || []) {
    if (f.client_id == null) continue
    facturesMap.set(f.client_id, (facturesMap.get(f.client_id) || 0) + 1)
  }

  const shopifyMap = new Map<number, number>()
  const { data: shopifyData } = await supabaseAdmin
    .from("commandes_shopify")
    .select("client_id")
    .in("client_id", clientIds)

  for (const s of shopifyData || []) {
    if (s.client_id == null) continue
    shopifyMap.set(s.client_id, (shopifyMap.get(s.client_id) || 0) + 1)
  }

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
 * Charge des clients par leurs IDs (sans dépendre de l'ordre).
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
 * Recherche un client à partir d'un numéro de document (offre, commande,
 * facture WinBiz, ou commande Shopify). Retourne la liste des clients matchés.
 *
 * Détection :
 *   - DEV-?\d+        → offres.numero_offre
 *   - CMD-?\d+        → offres.numero_commande OR offres.numero_affiche
 *   - chiffres ≥4 OU contient "JAR" + chiffres → factures_winbiz.numero_facture + commandes_shopify.shopify_order_name
 */
async function searchByDocumentNumber(q: string, limit: number): Promise<Client[] | null> {
  const trimmed = q.trim()
  const upper = trimmed.toUpperCase()

  // ─── Cas 1 : DEV-XXXXX (numéro d'offre) ────────────────────────
  if (/^DEV[-\s]?\d+/i.test(trimmed)) {
    // Reconstruit le numéro normalisé (DEV-12345)
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

  // ─── Cas 2 : CMD-XXXXX (numéro de commande interne) ────────────
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

  // ─── Cas 3 : numéro alphanumérique pouvant être Shopify ou WinBiz ──
  // Détecte : "12345", "#65351", "JAR12345", "152034", "1-12345", etc.
  // Critère : contient au moins 4 chiffres consécutifs ET aucun caractère alphabétique sauf JAR/# éventuel
  const digitsOnly = trimmed.replace(/\D/g, "")
  const isLikelyDocNumber =
    digitsOnly.length >= 4 &&
    (/^#?\d{4,}$/.test(trimmed) ||                  // 12345 ou #12345
     /^JAR[-\s]?\d{4,}$/i.test(trimmed) ||          // JAR12345
     /^\d{4,}$/.test(trimmed) ||                     // pur numérique
     (upper.includes("JAR") && digitsOnly.length >= 4))

  if (isLikelyDocNumber) {
    const matchedClientIds = new Set<number>()

    // 3a — Factures WinBiz : numero_facture (string)
    const { data: factures } = await supabaseAdmin
      .from("factures_winbiz")
      .select("client_id, numero_facture")
      .ilike("numero_facture", `%${digitsOnly}%`)
      .limit(50)

    for (const f of factures || []) {
      if (f.client_id != null) matchedClientIds.add(f.client_id)
    }

    // 3b — Commandes Shopify : on cherche dans shopify_order_name (qui contient
    // le préfixe historique #, JAR, 6, 1, etc.) avec un ilike sur les chiffres.
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

  // Pas de pattern document détecté → laisse passer à la recherche classique
  return null
}

/**
 * Helper : transforme une liste d'offres (avec client_numero_client + client_email)
 * en liste de clients réels.
 */
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
    filters.push(`email.in.(${emails.map(e => `"${e}"`).join(",")})`)
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
      // ═══════════════════════════════════════════════════════════════
      // PRIORITÉ : recherche par numéro de document (DEV/CMD/Shopify/WinBiz)
      // ═══════════════════════════════════════════════════════════════
      const docResults = await searchByDocumentNumber(q, limit)
      if (docResults !== null) {
        // Si on a un match document (même 0 résultat), on retourne directement
        // — sauf si 0 résultat ET q ressemble plus à un nom : on continue en classique
        if (docResults.length > 0) {
          const { count } = await supabaseAdmin
            .from("clients")
            .select("*", { count: "exact", head: true })
          const enriched = await enrichWithCounts(docResults)
          return NextResponse.json({ clients: enriched, total: count || 0 })
        }
        // Si 0 résultat ET on est sûr que c'est un n° de doc (DEV/CMD/JAR/#),
        // on retourne vide. Sinon on fallback en recherche classique.
        if (/^(DEV|CMD|JAR|#)/i.test(q.trim())) {
          const { count } = await supabaseAdmin
            .from("clients")
            .select("*", { count: "exact", head: true })
          return NextResponse.json({ clients: [], total: count || 0 })
        }
        // Sinon (ex: "52201" qui n'a rien donné) → fallback classique en dessous
      }

      // ═══════════════════════════════════════════════════════════════
      // RECHERCHE CLASSIQUE (nom/email/tel/société/etc.)
      // ═══════════════════════════════════════════════════════════════
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