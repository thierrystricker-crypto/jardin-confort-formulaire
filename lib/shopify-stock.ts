// lib/shopify-stock.ts
// Helpers pour gérer les sorties de stock Shopify Admin GraphQL.
// Utilise OAuth Client Credentials Flow (comme l'app jotform-iframe-test qui marche déjà).
// Pas besoin de token statique : on génère un token à la demande via CLIENT_ID/SECRET.

import { createHash, randomUUID } from "crypto"

const SHOP = process.env.SHOPIFY_STORE_DOMAIN || ""
const ADMIN_CLIENT_ID = process.env.SHOPIFY_ADMIN_CLIENT_ID || ""
const ADMIN_CLIENT_SECRET = process.env.SHOPIFY_ADMIN_CLIENT_SECRET || ""

// Location unique de Jardin-Confort
export const SHOPIFY_LOCATION_ID = "gid://shopify/Location/43228233863"

// ─── Cache du token Admin (valide 24h, on le rafraîchit avec 5min de marge) ───
let cachedAdminToken: string | null = null
let cachedAdminTokenExpiresAt = 0

async function getAdminAccessToken(): Promise<string> {
  const now = Date.now()

  if (cachedAdminToken && now < cachedAdminTokenExpiresAt) {
    return cachedAdminToken
  }

  if (!ADMIN_CLIENT_ID || !ADMIN_CLIENT_SECRET) {
    throw new Error("SHOPIFY_ADMIN_CLIENT_ID ou SHOPIFY_ADMIN_CLIENT_SECRET manquant")
  }

  const body = new URLSearchParams()
  body.set("grant_type", "client_credentials")
  body.set("client_id", ADMIN_CLIENT_ID)
  body.set("client_secret", ADMIN_CLIENT_SECRET)

  const response = await fetch(`https://${SHOP}/admin/oauth/access_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json",
    },
    body: body.toString(),
    cache: "no-store",
  })

  type TokenResponse = {
    access_token?: string
    expires_in?: number
    error?: string
    error_description?: string
  }

  const json = await response.json() as TokenResponse

  if (!response.ok || !json.access_token) {
    throw new Error(
      json.error_description || json.error || "Impossible d'obtenir le token Admin Shopify"
    )
  }

  cachedAdminToken = json.access_token
  const expiresInMs = (json.expires_in ?? 86400) * 1000
  cachedAdminTokenExpiresAt = now + expiresInMs - 5 * 60 * 1000

  return cachedAdminToken
}

// ─── Type retour : informations d'un variant Shopify trouvé par SKU ───
export type ShopifyVariantLookup = {
  variantId: string
  inventoryItemId: string
  productTitle: string
  variantTitle: string | null
  sku: string
  available: number
} | null

// ─── Appel GraphQL Admin générique ───
async function shopifyAdminGraphQL<T = unknown>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const token = await getAdminAccessToken()

  const res = await fetch(`https://${SHOP}/admin/api/2026-04/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  })

  if (!res.ok) {
    throw new Error(`Shopify HTTP ${res.status}: ${await res.text()}`)
  }

  const json = await res.json() as { data?: T; errors?: unknown[] }

  if (json.errors && json.errors.length > 0) {
    throw new Error(`Shopify GraphQL errors: ${JSON.stringify(json.errors)}`)
  }

  if (!json.data) {
    throw new Error("Shopify GraphQL: pas de data dans la réponse")
  }

  return json.data
}

// ─── Recherche d'un variant + inventory_item depuis un SKU ───
export async function findVariantBySKU(sku: string): Promise<ShopifyVariantLookup> {
  const query = `
    query findVariantBySKU($q: String!) {
      productVariants(first: 5, query: $q) {
        edges {
          node {
            id
            sku
            title
            product { title }
            inventoryItem {
              id
              inventoryLevel(locationId: "${SHOPIFY_LOCATION_ID}") {
                quantities(names: ["available"]) {
                  name
                  quantity
                }
              }
            }
          }
        }
      }
    }
  `

  type RawVariant = {
    id: string
    sku: string | null
    title: string | null
    product: { title: string }
    inventoryItem: {
      id: string
      inventoryLevel: { quantities: { name: string; quantity: number }[] } | null
    } | null
  }

  type Resp = {
    productVariants: {
      edges: { node: RawVariant }[]
    }
  }

  const data = await shopifyAdminGraphQL<Resp>(query, { q: `sku:${sku}` })

  // Match exact (Shopify peut renvoyer des matchs partiels)
  const variants = data.productVariants.edges.map(e => e.node)
  const exact = variants.find(v => v.sku === sku)
  if (!exact) return null
  if (!exact.inventoryItem) return null

  const availableQty = exact.inventoryItem.inventoryLevel?.quantities
    .find(q => q.name === "available")?.quantity ?? 0

  return {
    variantId: exact.id,
    inventoryItemId: exact.inventoryItem.id,
    productTitle: exact.product.title,
    variantTitle: exact.title,
    sku: exact.sku || sku,
    available: availableQty,
  }
}

// ─── Génère un idempotencyKey UUID-v4-like depuis une string stable ───
// Permet d'avoir le même key pour la même opération (CMD-XXX + SKU + reason)
// → si retry → Shopify ne fera PAS l'opération deux fois
function generateIdempotencyKey(seed: string): string {
  const hash = createHash("sha256").update(seed).digest("hex")
  // Format UUID v4 attendu par Shopify : 8-4-4-4-12
  return [
    hash.substring(0, 8),
    hash.substring(8, 12),
    "4" + hash.substring(13, 16),                            // version 4
    ((parseInt(hash.substring(16, 17), 16) & 0x3) | 0x8).toString(16) + hash.substring(17, 20),  // variant
    hash.substring(20, 32),
  ].join("-")
}

// ─── Ajustement d'inventaire (delta négatif = sortie, positif = entrée) ───
//
// changeFromQuantity = null
//   → désactive le compare-and-swap (CAS) car le dashboard n'est pas la source
//     unique de vérité (Shopify POS, ventes online, etc. peuvent modifier en parallèle)
//
// @idempotent(key: $idempotencyKey)
//   → exigé par l'API 2026-04
//   → garantit qu'un même mouvement ne peut être appliqué qu'une seule fois
//   → key dérivé du ledgerUri pour avoir une clé stable et reproductible
//
// ledgerDocumentUri / referenceDocumentUri
//   → identifie clairement la source dans Shopify Admin
//   → format : gid://offres-jardin-confort/StockMovement/CMD-XXXXX
export async function adjustInventory(
  inventoryItemId: string,
  delta: number,
  ledgerUri?: string,
): Promise<{ success: boolean; newQuantity?: number; raw?: unknown; error?: string }> {
  const mutation = `
    mutation adjustInventory($input: InventoryAdjustQuantitiesInput!, $idempotencyKey: String!) {
      inventoryAdjustQuantities(input: $input) @idempotent(key: $idempotencyKey) {
        inventoryAdjustmentGroup {
          createdAt
          reason
          referenceDocumentUri
          changes {
            name
            delta
            quantityAfterChange
            ledgerDocumentUri
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `

  // ─── Génération de l'idempotencyKey ───
  // Si on a un ledgerUri stable (gid://offres-jardin-confort/StockMovement/CMD-XXX),
  // on dérive le key de [ledgerUri + inventoryItemId + delta] pour être stable et reproductible.
  // Sinon on utilise un randomUUID (cas manuel).
  const idempotencyKey = ledgerUri
    ? generateIdempotencyKey(`${ledgerUri}|${inventoryItemId}|${delta}`)
    : randomUUID()

  const referenceUri = ledgerUri || `gid://offres-jardin-confort/StockMovement/manual-${Date.now()}`

  const input = {
    reason: "correction",
    name: "available",
    referenceDocumentUri: referenceUri,
    changes: [
      {
        delta,
        changeFromQuantity: null,     // CAS désactivé (pas de blocage en cas de race condition)
        inventoryItemId,
        locationId: SHOPIFY_LOCATION_ID,
      },
    ],
  }

  type Resp = {
    inventoryAdjustQuantities: {
      inventoryAdjustmentGroup: {
        changes: { name: string; delta: number; quantityAfterChange: number | null }[]
      } | null
      userErrors: { field: string[]; message: string }[]
    }
  }

  try {
    const data = await shopifyAdminGraphQL<Resp>(mutation, { input, idempotencyKey })
    const result = data.inventoryAdjustQuantities

    if (result.userErrors && result.userErrors.length > 0) {
      return {
        success: false,
        error: result.userErrors.map(e => `${e.field?.join(".")}: ${e.message}`).join("; "),
        raw: result,
      }
    }

    // Si pas d'inventoryAdjustmentGroup pour delta != 0 → erreur silencieuse
    // Pour delta=0 c'est normal (pas d'ajustement effectué)
    if (!result.inventoryAdjustmentGroup && delta !== 0) {
      return {
        success: false,
        error: "Aucun ajustement effectué (réponse vide)",
        raw: result,
      }
    }

    const change = result.inventoryAdjustmentGroup?.changes.find(c => c.name === "available")
    const newQty = (typeof change?.quantityAfterChange === "number")
      ? change.quantityAfterChange
      : undefined

    return {
      success: true,
      newQuantity: newQty,
      raw: result,
    }
  } catch (err) {
    return {
      success: false,
      error: (err as Error).message,
    }
  }
}