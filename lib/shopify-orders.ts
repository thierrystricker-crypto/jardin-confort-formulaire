// lib/shopify-orders.ts
// Helpers pour synchroniser les commandes Shopify dans Supabase
// Version BULK UPSERT + cache clients pour Vercel Hobby (60s)

import { supabaseAdmin } from "@/lib/supabase"

const SHOPIFY_API_VERSION = "2026-04"
const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || "www.jardin-confort.ch"
const SHOPIFY_CLIENT_ID = process.env.SHOPIFY_ADMIN_CLIENT_ID
const SHOPIFY_CLIENT_SECRET = process.env.SHOPIFY_ADMIN_CLIENT_SECRET

// ─── OAuth Client Credentials ────────────────────────────
let cachedToken: { token: string; expiresAt: number } | null = null

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 5 * 60 * 1000) {
    return cachedToken.token
  }

  if (!SHOPIFY_CLIENT_ID || !SHOPIFY_CLIENT_SECRET) {
    throw new Error("SHOPIFY_ADMIN_CLIENT_ID ou SHOPIFY_ADMIN_CLIENT_SECRET manquant")
  }

  const res = await fetch(`https://${SHOPIFY_DOMAIN}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: SHOPIFY_CLIENT_ID,
      client_secret: SHOPIFY_CLIENT_SECRET,
      grant_type: "client_credentials",
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Shopify OAuth error ${res.status}: ${text}`)
  }

  const json = await res.json()
  if (!json.access_token) {
    throw new Error(`Shopify OAuth: pas d'access_token retourné: ${JSON.stringify(json)}`)
  }

  const expiresIn = json.expires_in || 3600
  cachedToken = {
    token: json.access_token,
    expiresAt: Date.now() + expiresIn * 1000,
  }
  return json.access_token
}

// ─── Types ───────────────────────────────────────────────

type ShopifyOrder = {
  id: string
  legacyResourceId: string
  name: string
  number: number
  createdAt: string
  updatedAt: string
  cancelledAt: string | null
  cancelReason: string | null
  test: boolean
  email: string | null
  phone: string | null
  note: string | null
  tags: string[]
  sourceName: string | null
  statusPageUrl: string
  displayFinancialStatus: string | null
  displayFulfillmentStatus: string
  currencyCode: string
  totalPriceSet: { shopMoney: { amount: string; currencyCode: string } }
  subtotalPriceSet?: { shopMoney: { amount: string; currencyCode: string } }
  totalTaxSet?: { shopMoney: { amount: string; currencyCode: string } }
  totalShippingPriceSet?: { shopMoney: { amount: string; currencyCode: string } }
  totalDiscountsSet?: { shopMoney: { amount: string; currencyCode: string } }
  customer: {
    id: string
    email: string | null
    phone: string | null
    firstName: string | null
    lastName: string | null
  } | null
  shippingAddress: ShopifyAddress | null
  billingAddress: ShopifyAddress | null
  lineItems: {
    edges: Array<{
      node: {
        id: string
        title: string
        name: string
        sku: string | null
        quantity: number
        currentQuantity: number
        originalUnitPriceSet: { shopMoney: { amount: string; currencyCode: string } }
      }
    }>
  }
}

type ShopifyAddress = {
  address1: string | null
  address2: string | null
  city: string | null
  zip: string | null
  province: string | null
  country: string | null
  countryCodeV2: string | null
  phone: string | null
  firstName: string | null
  lastName: string | null
  company: string | null
}

export type SyncResult = {
  ordersFetched: number
  ordersInserted: number
  ordersUpdated: number
  clientsMatched: number
  clientsCreated: number
  errors: Array<{ shopifyId: string; message: string }>
  durationMs: number
  hasMore: boolean
  nextCursor: string | null
  totalProcessed: number
}

// ─── Cache clients (in-memory) ───────────────────────────

type ClientRow = {
  id: number
  email: string | null
  tel1: string | null
  tel2: string | null
  nom: string | null
  npa: string | null
}

type ClientsCache = {
  byEmail: Map<string, number>
  byPhoneLastNine: Map<string, number>
  byNomNpa: Map<string, number>
}

async function buildClientsCache(): Promise<ClientsCache> {
  const cache: ClientsCache = {
    byEmail: new Map(),
    byPhoneLastNine: new Map(),
    byNomNpa: new Map(),
  }

  let from = 0
  const pageSize = 1000
  while (true) {
    const { data, error } = await supabaseAdmin
      .from("clients")
      .select("id, email, tel1, tel2, nom, npa")
      .range(from, from + pageSize - 1)

    if (error) {
      console.error("Erreur build cache clients :", error)
      break
    }
    if (!data || data.length === 0) break

    for (const c of data as ClientRow[]) {
      const em = (c.email || "").toLowerCase().trim()
      if (em) cache.byEmail.set(em, c.id)

      for (const tel of [c.tel1, c.tel2]) {
        if (!tel) continue
        const digits = tel.replace(/[^\d]/g, "")
        if (digits.length >= 9) {
          cache.byPhoneLastNine.set(digits.slice(-9), c.id)
        }
      }

      const nom = (c.nom || "").toLowerCase().trim()
      const npa = (c.npa || "").trim()
      if (nom && npa) {
        cache.byNomNpa.set(`${nom}|${npa}`, c.id)
      }
    }

    if (data.length < pageSize) break
    from += pageSize
  }

  console.log(`[shopify-sync] Cache clients : ${cache.byEmail.size} emails, ${cache.byPhoneLastNine.size} tels, ${cache.byNomNpa.size} nom+NPA`)
  return cache
}

// ─── GraphQL Query ───────────────────────────────────────

// Tri par UPDATED_AT : c'est lui qui permet le mode incrémental
// (« tout ce qui a bougé depuis la dernière passe »), et il fonctionne
// aussi bien pour un backfill complet.
const ORDERS_QUERY = `
  query SyncOrders($first: Int!, $after: String, $query: String) {
    orders(first: $first, after: $after, query: $query, sortKey: UPDATED_AT, reverse: false) {
      edges {
        node {
          id
          legacyResourceId
          name
          number
          createdAt
          updatedAt
          cancelledAt
          cancelReason
          test
          email
          phone
          note
          tags
          sourceName
          statusPageUrl
          displayFinancialStatus
          displayFulfillmentStatus
          currencyCode
          totalPriceSet { shopMoney { amount currencyCode } }
          subtotalPriceSet { shopMoney { amount currencyCode } }
          totalTaxSet { shopMoney { amount currencyCode } }
          totalShippingPriceSet { shopMoney { amount currencyCode } }
          totalDiscountsSet { shopMoney { amount currencyCode } }
          customer {
            id
            email
            phone
            firstName
            lastName
          }
          shippingAddress {
            address1 address2 city zip province country countryCodeV2 phone firstName lastName company
          }
          billingAddress {
            address1 address2 city zip province country countryCodeV2 phone firstName lastName company
          }
          lineItems(first: 50) {
            edges {
              node {
                id
                title
                name
                sku
                quantity
                currentQuantity
                originalUnitPriceSet { shopMoney { amount currencyCode } }
              }
            }
          }
        }
        cursor
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`

async function fetchShopifyOrdersPage(
  cursor: string | null,
  pageSize: number = 50,
  searchQuery: string | null = null
): Promise<{ orders: ShopifyOrder[]; hasNextPage: boolean; endCursor: string | null }> {
  const token = await getAccessToken()
  const res = await fetch(
    `https://${SHOPIFY_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({
        query: ORDERS_QUERY,
        variables: { first: pageSize, after: cursor, query: searchQuery },
      }),
    }
  )

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Shopify API error ${res.status}: ${text}`)
  }

  const json = await res.json()
  if (json.errors) {
    throw new Error(`Shopify GraphQL error: ${JSON.stringify(json.errors)}`)
  }

  const edges = json.data?.orders?.edges || []
  return {
    orders: edges.map((e: { node: ShopifyOrder }) => e.node),
    hasNextPage: json.data?.orders?.pageInfo?.hasNextPage || false,
    endCursor: json.data?.orders?.pageInfo?.endCursor || null,
  }
}

// ─── Normalisation ───────────────────────────────────────

function normalizePhone(raw: string | null | undefined): string {
  if (!raw) return ""
  return raw.replace(/[^\d]/g, "")
}

function normalizeEmail(raw: string | null | undefined): string {
  if (!raw) return ""
  return raw.toLowerCase().trim()
}

// ─── Matching client (cache, instantané) ─────────────────

function findMatchingClientInCache(order: ShopifyOrder, cache: ClientsCache): number | null {
  const email = normalizeEmail(order.customer?.email || order.email)
  if (email) {
    const id = cache.byEmail.get(email)
    if (id) return id
  }

  const phone = normalizePhone(
    order.customer?.phone || order.phone || order.shippingAddress?.phone || order.billingAddress?.phone
  )
  if (phone && phone.length >= 9) {
    const id = cache.byPhoneLastNine.get(phone.slice(-9))
    if (id) return id
  }

  const lastName = order.customer?.lastName || order.shippingAddress?.lastName || order.billingAddress?.lastName
  const npa = order.shippingAddress?.zip || order.billingAddress?.zip
  if (lastName && npa) {
    const key = `${lastName.toLowerCase().trim()}|${npa.trim()}`
    const id = cache.byNomNpa.get(key)
    if (id) return id
  }

  return null
}

// ─── Bulk : créer les clients manquants en une seule requête ───

type PendingClient = {
  shopifyOrderId: string  // pour retrouver à quelle commande il appartient
  nom: string
  prenom: string | null
  societe: string | null
  email: string | null
  tel1: string | null
  rue: string | null
  rue2: string | null
  npa: string | null
  ville: string | null
  pays: string
}

function buildPendingClient(order: ShopifyOrder): PendingClient | null {
  const email = order.customer?.email || order.email
  const phone = order.customer?.phone || order.phone || order.shippingAddress?.phone || null
  const firstName = order.customer?.firstName || order.shippingAddress?.firstName || null
  const lastName = order.customer?.lastName || order.shippingAddress?.lastName || null
  const company = order.shippingAddress?.company || order.billingAddress?.company || null

  if (!lastName && !company) return null

  const addr = order.shippingAddress || order.billingAddress

  return {
    shopifyOrderId: order.id,
    nom: lastName?.trim() || company?.trim() || "—",
    prenom: firstName?.trim() || null,
    societe: company?.trim() || null,
    email: email?.trim() || null,
    tel1: phone?.trim() || null,
    rue: addr?.address1?.trim() || null,
    rue2: addr?.address2?.trim() || null,
    npa: addr?.zip?.trim() || null,
    ville: addr?.city?.trim() || null,
    pays: addr?.countryCodeV2 || "CH",
  }
}

// ─── Construction du payload pour bulk upsert ────────────

function buildOrderPayload(order: ShopifyOrder, clientId: number | null) {
  const lineItems = order.lineItems.edges.map(e => ({
    id: e.node.id,
    title: e.node.title,
    name: e.node.name,
    sku: e.node.sku,
    quantity: e.node.quantity,
    currentQuantity: e.node.currentQuantity,
    price: e.node.originalUnitPriceSet?.shopMoney?.amount || null,
  }))

  return {
    shopify_order_id: order.id,
    shopify_order_legacy_id: order.legacyResourceId ? Number(order.legacyResourceId) : null,
    shopify_order_name: order.name,
    shopify_order_number: order.number,
    client_id: clientId,
    customer_shopify_id: order.customer?.id || null,
    customer_email: order.customer?.email || order.email || null,
    customer_phone: order.customer?.phone || order.phone || null,
    customer_first_name: order.customer?.firstName || null,
    customer_last_name: order.customer?.lastName || null,
    total_price: parseFloat(order.totalPriceSet?.shopMoney?.amount || "0"),
    subtotal_price: parseFloat(order.subtotalPriceSet?.shopMoney?.amount || "0"),
    total_tax: parseFloat(order.totalTaxSet?.shopMoney?.amount || "0"),
    total_shipping: parseFloat(order.totalShippingPriceSet?.shopMoney?.amount || "0"),
    total_discounts: parseFloat(order.totalDiscountsSet?.shopMoney?.amount || "0"),
    currency: order.currencyCode,
    financial_status: order.displayFinancialStatus,
    fulfillment_status: order.displayFulfillmentStatus,
    cancelled_at: order.cancelledAt,
    cancel_reason: order.cancelReason,
    source_name: order.sourceName,
    test: order.test,
    tags: order.tags,
    note: order.note,
    status_page_url: order.statusPageUrl,
    shipping_address: order.shippingAddress,
    billing_address: order.billingAddress,
    line_items: lineItems,
    raw_data: order,
    created_at_shopify: order.createdAt,
    updated_at_shopify: order.updatedAt,
  }
}

// ─── État persistant du sync ─────────────────────────────
// Sans cette mémoire, une passe interrompue par le timeout Vercel était
// simplement perdue : le lancement suivant repartait de la première
// commande de 2021 et ne rattrapait jamais le présent.

type EtatSync = {
  mode: "incremental" | "backfill"
  curseur: string | null
  depuis: string | null
}

async function lireEtat(): Promise<EtatSync> {
  const { data } = await supabaseAdmin
    .from("shopify_sync_etat")
    .select("mode, curseur, depuis")
    .eq("id", 1)
    .maybeSingle()
  return {
    mode: (data?.mode === "backfill" ? "backfill" : "incremental"),
    curseur: data?.curseur ?? null,
    depuis: data?.depuis ?? null,
  }
}

async function ecrireEtat(etat: Partial<EtatSync> & { dernier_message?: string }) {
  await supabaseAdmin
    .from("shopify_sync_etat")
    .update({ ...etat, maj_le: new Date().toISOString() })
    .eq("id", 1)
}

// Borne basse d'une passe incrémentale : la commande la plus récemment
// modifiée en base, moins une marge. La marge couvre les commandes
// modifiées pendant la passe précédente et l'imprécision des horloges ;
// un doublon ne coûte rien (upsert), une commande manquée coûte cher.
const MARGE_RECOUVREMENT_MS = 2 * 60 * 60 * 1000  // 2 h

async function calculerDepuis(): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("commandes_shopify")
    .select("updated_at_shopify")
    .order("updated_at_shopify", { ascending: false })
    .limit(1)
    .maybeSingle()

  const derniere = data?.updated_at_shopify
  if (!derniere) return null  // base vide → backfill complet
  // Shopify accepte l'ISO 8601 ; on retire les millisecondes, inutiles ici
  // et source d'erreurs de parsing dans le langage de recherche.
  return new Date(new Date(derniere).getTime() - MARGE_RECOUVREMENT_MS)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
}

// ─── Sync principal (BULK UPSERT + CACHE) ────────────────

export async function syncShopifyOrders(options: {
  syncType: "initial" | "manual" | "cron"
  startCursor?: string | null
  maxOrders?: number
  pageSize?: number
  timeoutMs?: number
  /** 'incremental' (défaut) : seulement ce qui a changé depuis la dernière
   *  passe. 'backfill' : tout l'historique, pour une reconstruction. */
  mode?: "incremental" | "backfill"
  /** Ignore l'état mémorisé et repart de zéro dans le mode demandé. */
  forcerRedemarrage?: boolean
}): Promise<SyncResult> {
  const startTime = Date.now()
  const {
    syncType,
    startCursor = null,
    maxOrders = 500,           // On peut maintenant traiter 500 par chunk grâce au bulk
    pageSize = 50,
    timeoutMs = 50000,
    mode: modeDemande,
    forcerRedemarrage = false,
  } = options

  // ─── Reprise : où en était-on ? ───
  const etat = await lireEtat()
  const mode: "incremental" | "backfill" = modeDemande ?? etat.mode

  let curseurInitial: string | null = startCursor
  let depuis: string | null = null

  if (!startCursor && !forcerRedemarrage && etat.curseur && etat.mode === mode) {
    // Une passe précédente a été coupée en route : on la termine.
    curseurInitial = etat.curseur
    depuis = etat.depuis
    console.log(`[shopify-sync] Reprise d'une passe ${mode} interrompue (depuis=${depuis ?? "origine"})`)
  } else if (mode === "incremental") {
    depuis = await calculerDepuis()
    console.log(`[shopify-sync] Nouvelle passe incrémentale depuis ${depuis ?? "l'origine (base vide)"}`)
  } else {
    console.log(`[shopify-sync] Backfill complet demandé`)
  }

  // Filtre Shopify : ne redemander que ce qui a bougé.
  const searchQuery = depuis ? `updated_at:>='${depuis}'` : null

  // Log start (uniquement si premier appel)
  let logId: number | undefined
  if (!curseurInitial) {
    const { data: logRow } = await supabaseAdmin
      .from("shopify_sync_log")
      .insert({ sync_type: syncType, status: "running" })
      .select("id")
      .single()
    logId = logRow?.id
  }

  const result: SyncResult = {
    ordersFetched: 0,
    ordersInserted: 0,
    ordersUpdated: 0,
    clientsMatched: 0,
    clientsCreated: 0,
    errors: [],
    durationMs: 0,
    hasMore: false,
    nextCursor: null,
    totalProcessed: 0,
  }

  // Déclaré hors du try : en cas d'erreur, on veut encore savoir où on en
  // était pour pouvoir reprendre là plutôt que tout recommencer.
  let cursor: string | null = curseurInitial

  try {
    // 1. Construire le cache clients UNE FOIS au début
    const cacheStart = Date.now()
    const clientsCache = await buildClientsCache()
    console.log(`[shopify-sync] Cache construit en ${Date.now() - cacheStart}ms`)

    let processedInThisCall = 0

    // 2. Pour chaque page Shopify de 50 commandes
    while (processedInThisCall < maxOrders) {
      const elapsed = Date.now() - startTime
      if (elapsed > timeoutMs) {
        console.warn(`[shopify-sync] Stop avant timeout (${elapsed}ms écoulés)`)
        result.hasMore = true
        result.nextCursor = cursor
        break
      }

      const fetchStart = Date.now()
      const { orders, hasNextPage, endCursor } = await fetchShopifyOrdersPage(cursor, pageSize, searchQuery)
      console.log(`[shopify-sync] Page Shopify (${orders.length} commandes) fetched en ${Date.now() - fetchStart}ms`)
      result.ordersFetched += orders.length

      if (orders.length === 0) {
        result.hasMore = false
        result.nextCursor = null
        break
      }

      // 3. Phase 1 : Matching client en mémoire (instantané)
      const ordersWithClient: Array<{ order: ShopifyOrder; clientId: number | null }> = []
      const pendingClients: PendingClient[] = []

      for (const order of orders) {
        const matchedId = findMatchingClientInCache(order, clientsCache)
        if (matchedId) {
          result.clientsMatched++
          ordersWithClient.push({ order, clientId: matchedId })
        } else {
          // À créer en bulk plus tard
          const pending = buildPendingClient(order)
          if (pending) {
            pendingClients.push(pending)
          }
          ordersWithClient.push({ order, clientId: null }) // sera mis à jour après création
        }
      }

      // 4. Phase 2 : BULK INSERT des nouveaux clients (1 seule requête)
      if (pendingClients.length > 0) {
        const insertStart = Date.now()
        const { data: createdClients, error: createErr } = await supabaseAdmin
          .from("clients")
          .insert(pendingClients.map(p => ({
            nom: p.nom,
            prenom: p.prenom,
            societe: p.societe,
            email: p.email,
            tel1: p.tel1,
            rue: p.rue,
            rue2: p.rue2,
            npa: p.npa,
            ville: p.ville,
            pays: p.pays,
            source: "shopify",
          })))
          .select("id, email, tel1, nom, npa")

        console.log(`[shopify-sync] Bulk insert ${pendingClients.length} clients en ${Date.now() - insertStart}ms`)

        if (createErr) {
          console.error("Erreur bulk insert clients:", createErr)
          result.errors.push({ shopifyId: "bulk-clients", message: createErr.message })
        } else if (createdClients) {
          // Map shopify_order_id → new client_id (par ordre d'insertion)
          const orderIdToNewClientId = new Map<string, number>()
          for (let i = 0; i < pendingClients.length && i < createdClients.length; i++) {
            const newClient = createdClients[i]
            orderIdToNewClientId.set(pendingClients[i].shopifyOrderId, newClient.id)

            // Mettre à jour le cache pour les commandes suivantes
            const em = (newClient.email || "").toLowerCase().trim()
            if (em) clientsCache.byEmail.set(em, newClient.id)
            if (newClient.tel1) {
              const digits = newClient.tel1.replace(/[^\d]/g, "")
              if (digits.length >= 9) clientsCache.byPhoneLastNine.set(digits.slice(-9), newClient.id)
            }
            const nom = (newClient.nom || "").toLowerCase().trim()
            const npa = (newClient.npa || "").trim()
            if (nom && npa) clientsCache.byNomNpa.set(`${nom}|${npa}`, newClient.id)
          }

          // Mettre à jour ordersWithClient avec les nouveaux IDs
          for (const item of ordersWithClient) {
            if (item.clientId === null) {
              const newId = orderIdToNewClientId.get(item.order.id)
              if (newId) {
                item.clientId = newId
                result.clientsCreated++
              }
            }
          }
        }
      }

      // 5. Phase 3 : Vérifier quelles commandes existent déjà (1 seule requête)
      const checkStart = Date.now()
      const orderIds = orders.map(o => o.id)
      const { data: existingOrders } = await supabaseAdmin
        .from("commandes_shopify")
        .select("shopify_order_id")
        .in("shopify_order_id", orderIds)

      const existingIds = new Set((existingOrders || []).map(e => e.shopify_order_id))
      console.log(`[shopify-sync] Check existing en ${Date.now() - checkStart}ms (${existingIds.size}/${orderIds.length} déjà en base)`)

      // 6. Phase 4 : BULK UPSERT (1 seule requête pour insert + update)
      const upsertStart = Date.now()
      const payloads = ordersWithClient.map(({ order, clientId }) => buildOrderPayload(order, clientId))

      const { error: upsertErr } = await supabaseAdmin
        .from("commandes_shopify")
        .upsert(payloads, {
          onConflict: "shopify_order_id",
          ignoreDuplicates: false,  // false = update si conflit
        })

      console.log(`[shopify-sync] Bulk upsert ${payloads.length} commandes en ${Date.now() - upsertStart}ms`)

      if (upsertErr) {
        console.error("Erreur bulk upsert commandes:", upsertErr)
        result.errors.push({ shopifyId: "bulk-orders", message: upsertErr.message })
      } else {
        // Compter inserted vs updated
        for (const order of orders) {
          if (existingIds.has(order.id)) {
            result.ordersUpdated++
          } else {
            result.ordersInserted++
          }
          processedInThisCall++
        }
      }

      cursor = hasNextPage ? endCursor : null

      if (!cursor) {
        result.hasMore = false
        result.nextCursor = null
        break
      }

      if (processedInThisCall >= maxOrders) {
        result.hasMore = true
        result.nextCursor = cursor
        break
      }

      // Petit délai entre pages Shopify (rate limit ~2 req/s)
      await new Promise(r => setTimeout(r, 200))
    }

    result.durationMs = Date.now() - startTime
    result.totalProcessed = processedInThisCall

    // ─── Mémoriser où l'on s'arrête ───
    // hasMore → on note le curseur, la passe suivante reprendra ici.
    // Terminé  → on efface le curseur ; la prochaine passe repartira du
    //            dernier updated_at en base, et le backfill éventuel
    //            bascule en incrémental une fois l'historique rattrapé.
    await ecrireEtat({
      mode: result.hasMore ? mode : "incremental",
      curseur: result.hasMore ? result.nextCursor : null,
      depuis: result.hasMore ? depuis : null,
      dernier_message: result.hasMore
        ? `Passe ${mode} interrompue après ${processedInThisCall} commande(s) — reprise au prochain passage`
        : `${result.ordersInserted} ajoutée(s), ${result.ordersUpdated} mise(s) à jour en ${Math.round(result.durationMs / 1000)} s`,
    })

    if (logId) {
      await supabaseAdmin
        .from("shopify_sync_log")
        .update({
          finished_at: result.hasMore ? null : new Date().toISOString(),
          status: result.hasMore ? "running" : "success",
          orders_fetched: result.ordersFetched,
          orders_inserted: result.ordersInserted,
          orders_updated: result.ordersUpdated,
          clients_matched: result.clientsMatched,
          clients_created: result.clientsCreated,
          errors: result.errors.length > 0 ? result.errors : null,
          details: { duration_ms: result.durationMs, has_more: result.hasMore, next_cursor: result.nextCursor },
        })
        .eq("id", logId)
    }

    return result
  } catch (err) {
    result.durationMs = Date.now() - startTime
    // On garde le curseur : la passe suivante reprendra où ça a cassé
    // plutôt que de tout recommencer.
    await ecrireEtat({
      mode,
      curseur: cursor,
      depuis,
      dernier_message: `Échec : ${(err as Error).message}`,
    }).catch(() => {})
    if (logId) {
      await supabaseAdmin
        .from("shopify_sync_log")
        .update({
          finished_at: new Date().toISOString(),
          status: "error",
          orders_fetched: result.ordersFetched,
          orders_inserted: result.ordersInserted,
          orders_updated: result.ordersUpdated,
          clients_matched: result.clientsMatched,
          clients_created: result.clientsCreated,
          errors: [...result.errors, { shopifyId: "global", message: (err as Error).message }],
          details: { duration_ms: result.durationMs },
        })
        .eq("id", logId)
    }
    throw err
  }
}