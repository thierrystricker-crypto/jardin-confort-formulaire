// lib/shopify-orders.ts
// Helpers pour synchroniser les commandes Shopify dans Supabase

import { supabaseAdmin } from "@/lib/supabase"
import { getShopifyAccessToken } from "@/lib/shopify-stock"

const SHOPIFY_API_VERSION = "2026-04"
const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || "www.jardin-confort.ch"

// ─── Types ───────────────────────────────────────────────

type ShopifyOrder = {
  id: string                           // gid://shopify/Order/123
  legacyResourceId: string             // 123 (UnsignedInt64 → string)
  name: string                         // JAR-11244
  number: number                       // 11244
  createdAt: string                    // ISO
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
  const token = await getShopifyAccessToken()
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

// ─── Matching client (strict) ────────────────────────────
// Priorité 1 : email exact (insensible casse)
// Priorité 2 : téléphone exact (chiffres normalisés)
// Priorité 3 : nom + NPA exact

async function findMatchingClient(order: ShopifyOrder): Promise<number | null> {
  const email = normalizeEmail(order.customer?.email || order.email)
  const phone = normalizePhone(
    order.customer?.phone || order.phone || order.shippingAddress?.phone || order.billingAddress?.phone
  )

  // 1. Email exact
  if (email) {
    const { data } = await supabaseAdmin
      .from("clients")
      .select("id")
      .ilike("email", email)
      .limit(1)
      .maybeSingle()
    if (data?.id) return data.id
  }

  // 2. Téléphone exact (chiffres seulement)
  // On compare les derniers 9 chiffres (numéro local sans code pays)
  if (phone && phone.length >= 9) {
    const lastNine = phone.slice(-9)
    const { data: clients } = await supabaseAdmin
      .from("clients")
      .select("id, tel1, tel2")

    for (const c of clients || []) {
      const t1 = normalizePhone(c.tel1)
      const t2 = normalizePhone(c.tel2)
      if (t1.endsWith(lastNine) || t2.endsWith(lastNine)) {
        return c.id
      }
    }
  }

  // 3. Nom + NPA exact (nom = lastName + NPA = shippingAddress.zip ou billingAddress.zip)
  const lastName = order.customer?.lastName || order.shippingAddress?.lastName || order.billingAddress?.lastName
  const npa = order.shippingAddress?.zip || order.billingAddress?.zip
  if (lastName && npa) {
    const { data } = await supabaseAdmin
      .from("clients")
      .select("id")
      .ilike("nom", lastName.trim())
      .eq("npa", npa.trim())
      .limit(1)
      .maybeSingle()
    if (data?.id) return data.id
  }

  return null
}

// ─── Création de client ──────────────────────────────────

async function createClientFromOrder(order: ShopifyOrder): Promise<number | null> {
  const email = order.customer?.email || order.email
  const phone = order.customer?.phone || order.phone || order.shippingAddress?.phone || null
  const firstName = order.customer?.firstName || order.shippingAddress?.firstName || null
  const lastName = order.customer?.lastName || order.shippingAddress?.lastName || null
  const company = order.shippingAddress?.company || order.billingAddress?.company || null

  // Si on n'a même pas de nom, on ne peut pas créer de client
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
  return data.id
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

  // Vérifier si la commande existe déjà
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

// ─── Sync principal ──────────────────────────────────────

export async function syncShopifyOrders(options: {
  syncType: "initial" | "manual" | "cron"
  maxPages?: number               // Limite de sécurité (par défaut illimité)
  pageSize?: number
}): Promise<SyncResult> {
  const startTime = Date.now()
  const { syncType, maxPages = 1000, pageSize = 50 } = options

  // Log start
  const { data: logRow } = await supabaseAdmin
    .from("shopify_sync_log")
    .insert({ sync_type: syncType, status: "running" })
    .select("id")
    .single()
  const logId = logRow?.id

  const result: SyncResult = {
    ordersFetched: 0,
    ordersInserted: 0,
    ordersUpdated: 0,
    clientsMatched: 0,
    clientsCreated: 0,
    errors: [],
    durationMs: 0,
  }

  try {
    let cursor: string | null = null
    let pageCount = 0

    do {
      const { orders, hasNextPage, endCursor } = await fetchShopifyOrdersPage(cursor, pageSize)
      result.ordersFetched += orders.length

      for (const order of orders) {
        try {
          // 1. Trouver ou créer le client
          let clientId = await findMatchingClient(order)
          if (clientId) {
            result.clientsMatched++
          } else {
            clientId = await createClientFromOrder(order)
            if (clientId) result.clientsCreated++
          }

          // 2. Upsert de la commande
          const action = await upsertOrder(order, clientId)
          if (action === "inserted") result.ordersInserted++
          else result.ordersUpdated++
        } catch (err) {
          result.errors.push({
            shopifyId: order.id,
            message: (err as Error).message,
          })
          console.error(`Erreur traitement commande ${order.name}:`, err)
        }
      }

      cursor = hasNextPage ? endCursor : null
      pageCount++

      if (pageCount >= maxPages) {
        console.warn(`Sync arrêté à ${maxPages} pages (limite de sécurité)`)
        break
      }

      // Petit délai entre pages pour être gentil avec l'API Shopify (rate limit ~2 req/s)
      await new Promise(r => setTimeout(r, 200))
    } while (cursor)

    result.durationMs = Date.now() - startTime

    // Log success
    if (logId) {
      await supabaseAdmin
        .from("shopify_sync_log")
        .update({
          finished_at: new Date().toISOString(),
          status: "success",
          orders_fetched: result.ordersFetched,
          orders_inserted: result.ordersInserted,
          orders_updated: result.ordersUpdated,
          clients_matched: result.clientsMatched,
          clients_created: result.clientsCreated,
          errors: result.errors.length > 0 ? result.errors : null,
          details: { duration_ms: result.durationMs, page_count: pageCount },
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