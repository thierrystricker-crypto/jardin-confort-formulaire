// app/api/clients/route.ts
// GET  — liste clients avec recherche + compteurs documents (offres / commandes / factures)
// POST — créer un nouveau client

import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

type Client = {
  id: number
  numero_client: string | null
  email: string | null
  [key: string]: unknown
}

type ClientWithCounts = Client & {
  nb_offres: number              // offres en cours/envoyées (type=Offre, statut PAS dans Acceptée/Convertie/Abandonnée/Refusée)
  nb_commandes_internes: number  // CMD-XXXXX (type=Commande OU statut Acceptée/Convertie)
  nb_commandes_shopify: number   // pour plus tard (toujours 0 pour l'instant)
  nb_factures_winbiz: number
}

/**
 * Enrichit une liste de clients avec les compteurs de documents liés.
 * Matching multi-critères pour les offres, robuste pour tous les clients :
 *   - Priorité 1 : client_numero_client (figé, format CL-XXXXX)
 *   - Priorité 2 : client_email (fallback pour offres sans numero_client)
 * Matching factures : par client_id direct (figé à l'import WinBiz).
 *
 * Total : 2 requêtes Supabase, peu importe le nombre de clients.
 */
async function enrichWithCounts(clients: Client[]): Promise<ClientWithCounts[]> {
  if (clients.length === 0) return []

  const clientIds = clients.map(c => c.id)

  // Préparer les listes pour le matching offres
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

  // 1. Récupérer toutes les offres matchant soit par numero_client soit par email
  // Une seule requête avec un OR
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

    // Index : numero_client → client.id et email → client.id
    const numClientToId = new Map<string, number>()
    const emailToId = new Map<string, number>()
    for (const c of clients) {
      const num = (c.numero_client || "").trim()
      const em = (c.email || "").toLowerCase().trim()
      if (num) numClientToId.set(num, c.id)
      if (em) emailToId.set(em, c.id)
    }

    // Pour chaque offre, retrouver le client (priorité 1: numero, priorité 2: email)
    for (const o of offresData || []) {
      let clientId: number | undefined
      const num = (o.client_numero_client || "").trim()
      if (num) clientId = numClientToId.get(num)
      if (!clientId) {
        const em = (o.client_email || "").toLowerCase().trim()
        if (em) clientId = emailToId.get(em)
      }
      if (!clientId) continue // Offre orpheline (pas de match)

      const counts = offresMap.get(clientId) || { offres: 0, commandes: 0 }
      // Une commande = type_document=Commande OU statut Acceptée/Convertie
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

  // 2. Récupérer toutes les factures WinBiz (matching par client_id direct, figé à l'import)
  const facturesMap = new Map<number, number>()
  const { data: facturesData } = await supabaseAdmin
    .from("factures_winbiz")
    .select("client_id")
    .in("client_id", clientIds)

  for (const f of facturesData || []) {
    if (f.client_id == null) continue
    facturesMap.set(f.client_id, (facturesMap.get(f.client_id) || 0) + 1)
  }

  // 2bis. Récupérer toutes les commandes Shopify (matching par client_id direct, figé au sync)
  const shopifyMap = new Map<number, number>()
  const { data: shopifyData } = await supabaseAdmin
    .from("commandes_shopify")
    .select("client_id")
    .in("client_id", clientIds)

  for (const s of shopifyData || []) {
    if (s.client_id == null) continue
    shopifyMap.set(s.client_id, (shopifyMap.get(s.client_id) || 0) + 1)
  }

  // 3. Assembler les compteurs sur chaque client
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

      // Si la recherche contient un espace → chercher nom+prénom séparément aussi
      const parts = q.split(/\s+/).filter(Boolean)

      let clients: any[] = []

      if (parts.length >= 2) {
        // Recherche multi-mots : chaque mot doit matcher nom OU prénom OU société
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

    // Compter le total en base (sans filtre de limite)
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