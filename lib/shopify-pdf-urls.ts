// lib/shopify-pdf-urls.ts
// Génère les URLs des PDFs Order Printer Pro pour une commande Shopify

const ORDER_PRINTER_TEMPLATES = {
  ficheTravail: { id: "489824f8d4293a5ce7ed", multiplier: 8779 },
  bulletinLivraison: { id: "257da9a09628d859ee52", multiplier: 4573 },
  facture: { id: "6ef74d9fb332bb591537", multiplier: 3849 },
} as const

/**
 * Transforme un nom de commande Shopify en handle URL-friendly
 * "JAR-11244" → "jar-11244"
 * "#1001" → "1001"
 */
function handleize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

export type ShopifyPdfUrls = {
  ficheTravail: string | null
  bulletinLivraison: string | null
  facture: string | null
}

/**
 * Génère les 3 URLs PDF pour une commande Shopify.
 * Retourne null pour chaque URL si les données nécessaires sont manquantes.
 */
export function getShopifyPdfUrls(
  legacyId: number | null,
  orderName: string | null
): ShopifyPdfUrls {
  if (!legacyId || !orderName) {
    return { ficheTravail: null, bulletinLivraison: null, facture: null }
  }

  const handle = handleize(orderName)
  const base = "https://www.jardin-confort.ch/apps/download-pdf/orders"

  return {
    ficheTravail: `${base}/${ORDER_PRINTER_TEMPLATES.ficheTravail.id}/${legacyId * ORDER_PRINTER_TEMPLATES.ficheTravail.multiplier}/${handle}.pdf`,
    bulletinLivraison: `${base}/${ORDER_PRINTER_TEMPLATES.bulletinLivraison.id}/${legacyId * ORDER_PRINTER_TEMPLATES.bulletinLivraison.multiplier}/${handle}.pdf`,
    facture: `${base}/${ORDER_PRINTER_TEMPLATES.facture.id}/${legacyId * ORDER_PRINTER_TEMPLATES.facture.multiplier}/${handle}.pdf`,
  }
}