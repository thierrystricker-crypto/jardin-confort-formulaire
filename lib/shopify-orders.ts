// lib/shopify-orders.ts
// Helpers pour synchroniser les commandes Shopify dans Supabase
// Version chunked + cache clients pour Vercel Hobby (60s)

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

// ─── Cache clients (in-memory, hot) ──────────────────────
// Évite de requêter Supabase pour chaque commande Shopify

type ClientRow = {
  id: number
  email: string | null
  tel1: string | null
  tel2: string | null
  nom: string | null
  npa: string | null
}

type ClientsCache = {
  byEmail: Map<string, number>          // email lowercased → id
  byPhoneLastNine: Map<string, number>  // 9 derniers chiffres → id
  byNomNpa: Map<string, number>         // "nom_lowercased|npa" → id
}

async function buildClientsCache(): Promise<ClientsCache> {
  const cache: ClientsCache = {
    byEmail: new Map(),
    byPhoneLastNine: new Map(),
    byNomNpa: new Map(),
  }

  // Fetch en pagination par lots de 1000 (limite Supabase par défaut)
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
      // Index par email
      const em = (c.email || "").toLowerCase().trim()
      if (em) cache.byEmail.set(em, c.id)

      // Index par téléphone (9 derniers chiffres = numéro local)
      for (const tel of [c.tel1, c.tel2]) {
        if (!tel) continue
        const digits = tel.replace(/[^\d]/g, "")
        if (digits.length >= 9) {
          cache.byPhoneLastNine.set(digits.slice(-9), c.id)
        }
      }

      // Index par nom+NPA
      const nom = (c.nom || "").toLowerCase().trim()
      const npa = (c.npa || "").trim()
      if (nom && npa) {
        cache.byNomNpa.set(`${nom}|${npa}`, c.id)
      }
    }

    if (data.length < pageSize) break
    from += pageSize
  }

  console.log(`[shopify-sync] Cache clients construit : ${cache.byEmail.size} emails, ${cache.byPhoneLastNine.size} tels, ${cache.byNomNpa.size} nom+NPA`)
  return cache
}

// ─── GraphQL Query ───────────────────────────────────────

const ORDERS_QUERY = `
  query SyncOrders($first: Int!, $after: String) {
    orders(first: $first, after: $after, sortKey: CREATED_AT, reverse: false) {
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

// ─── Fetch Shopify ───────────────────────────────────────

async function fetchShopifyOrdersPage(
  cursor: string | null,
  pageSize: number = 50
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
        variables: { first: pageSize, after: cursor },
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

// ─── Matching client (utilise le cache, INSTANTANÉ) ──────

function findMatchingClientInCache(order: ShopifyOrder, cache: ClientsCache): number | null {
  // 1. Email exact
  const email = normalizeEmail(order.customer?.email || order.email)
  if (email) {
    const id = cache.byEmail.get(email)
    if (id) return id
  }

  // 2. Téléphone exact (9 derniers chiffres)
  const phone = normalizePhone(
    order.customer?.phone || order.phone || order.shippingAddress?.phone || order.billingAddress?.phone
  )
  if (phone && phone.length >= 9) {
    const id = cache.byPhoneLastNine.get(phone.slice(-9))
    if (id) return id
  }

  // 3. Nom + NPA exact
  const lastName = order.customer?.lastName || order.shippingAddress?.lastName || order.billingAddress?.lastName
  const npa = order.shippingAddress?.zip || order.billingAddress?.zip
  if (lastName && npa) {
    const key = `${lastName.toLowerCase().trim()}|${npa.trim()}`
    const id = cache.byNomNpa.get(key)
    if (id) return id
  }

  return null
}

// ─── Création de client + ajout au cache ─────────────────

async function createClientFromOrder(order: ShopifyOrder, cache: ClientsCache): Promise<number | null> {
  const email = order.customer?.email || order.email
  const phone = order.customer?.phone || order.phone || order.shippingAddress?.phone || null
  const firstName = order.customer?.firstName || order.shippingAddress?.firstName || null
  const lastName = order.customer?.lastName || order.shippingAddress?.lastName || null
  const company = order.shippingAddress?.company || order.billingAddress?.company || null

  if (!lastName && !company) return null

  const addr = order.shippingAddress || order.billingAddress

  const { data, error } = await supabaseAdmin
    .from("clients")
    .insert({
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
      source: "shopify",
    })
    .select("id")
    .single()

  if (error || !data) {
    console.error("Erreur création client depuis commande Shopify", error)
    return null
  }

  // Ajouter le nouveau client au cache pour les commandes suivantes
  const newId = data.id
  if (email) cache.byEmail.set(email.toLowerCase().trim(), newId)
  if (phone) {
    const digits = phone.replace(/[^\d]/g, "")
    if (digits.length >= 9) cache.byPhoneLastNine.set(digits.slice(-9), newId)
  }
  if (lastName && addr?.zip) {
    cache.byNomNpa.set(`${lastName.toLowerCase().trim()}|${addr.zip.trim()}`, newId)
  }

  return newId
}

// ─── Upsert d'une commande ───────────────────────────────

async function upsertOrder(
  order: ShopifyOrder,
  clientId: number | null
): Promise<"inserted" | "updated"> {
  const lineItems = order.lineItems.edges.map(e => ({
    id: e.node.id,
    title: e.node.title,
    name: e.node.name,
    sku: e.node.sku,
    quantity: e.node.quantity,
    currentQuantity: e.node.currentQuantity,
    price: e.node.originalUnitPriceSet?.shopMoney?.amount || null,
  }))

  const { data: existing } = await supabaseAdmin
    .from("commandes_shopify")
    .select("id")
    .eq("shopify_order_id", order.id)
    .maybeSingle()

  const payload = {
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

  if (existing) {
    await supabaseAdmin
      .from("commandes_shopify")
      .update(payload)
      .eq("id", existing.id)
    return "updated"
  } else {
    await supabaseAdmin
      .from("commandes_shopify")
      .insert(payload)
    return "inserted"
  }
}

// ─── Sync principal (CHUNKED + CACHED) ───────────────────

export async function syncShopifyOrders(options: {
  syncType: "initial" | "manual" | "cron"
  startCursor?: string | null
  maxOrders?: number
  pageSize?: number
  timeoutMs?: number
}): Promise<SyncResult> {
  const startTime = Date.now()
  const {
    syncType,
    startCursor = null,
    maxOrders = 200,
    pageSize = 50,
    timeoutMs = 50000,
  } = options

  // Log start (uniquement si premier appel)
  let logId: number | undefined
  if (!startCursor) {
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

  try {
    // 1. Construire le cache clients UNE FOIS au début
    const cacheStart = Date.now()
    const clientsCache = await buildClientsCache()
    console.log(`[shopify-sync] Cache construit en ${Date.now() - cacheStart}ms`)

    let cursor: string | null = startCursor
    let processedInThisCall = 0

    while (processedInThisCall < maxOrders) {
      const elapsed = Date.now() - startTime
      if (elapsed > timeoutMs) {
        console.warn(`[shopify-sync] Stop avant timeout (${elapsed}ms écoulés). Cursor: ${cursor}`)
        result.hasMore = true
        result.nextCursor = cursor
        break
      }

      const { orders, hasNextPage, endCursor } = await fetchShopifyOrdersPage(cursor, pageSize)
      result.ordersFetched += orders.length

      for (const order of orders) {
        try {
          // Lookup INSTANTANÉ dans le cache (pas de requête Supabase)
          let clientId = findMatchingClientInCache(order, clientsCache)
          if (clientId) {
            result.clientsMatched++
          } else {
            // Pas trouvé → créer (et ajouter au cache)
            clientId = await createClientFromOrder(order, clientsCache)
            if (clientId) result.clientsCreated++
          }

          const action = await upsertOrder(order, clientId)
          if (action === "inserted") result.ordersInserted++
          else result.ordersUpdated++
          processedInThisCall++
        } catch (err) {
          result.errors.push({
            shopifyId: order.id,
            message: (err as Error).message,
          })
          console.error(`Erreur traitement commande ${order.name}:`, err)
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