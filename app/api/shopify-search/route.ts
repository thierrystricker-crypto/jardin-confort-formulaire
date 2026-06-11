import { NextRequest, NextResponse } from 'next/server';

const SHOP = process.env.SHOPIFY_STORE_DOMAIN;
const STOREFRONT_TOKEN = process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN;
const ADMIN_CLIENT_ID = process.env.SHOPIFY_ADMIN_CLIENT_ID;
const ADMIN_CLIENT_SECRET = process.env.SHOPIFY_ADMIN_CLIENT_SECRET;

type ShopifyProduct = {
  title: string;
  handle: string;
  onlineStoreUrl: string | null;
  tags: string[]; // ← tags pour délais de livraison
  images?: {
    nodes?: Array<{
      url: string;
      altText: string | null;
    }>;
  };
  variants?: {
    nodes?: Array<{
      id: string;
      title: string;
      sku: string | null;
      quantityAvailable: number | null;
      image?: {
        url: string;
        altText: string | null;
      } | null;
      price: {
                amount: string;
                currencyCode: string;
              };
              compareAtPrice: {
                amount: string;
                currencyCode: string;
              } | null;
    }>;
  };
};

type ShopifyResponse = {
  data?: {
    search?: {
      nodes?: ShopifyProduct[];
    };
  };
  errors?: unknown;
};

type AdminTokenResponse = {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

type AdminInventoryResponse = {
  data?: {
    productVariants?: {
      nodes?: Array<{
        sku: string | null;
        inventoryItem?: {
          inventoryLevels?: {
            nodes?: Array<{
              quantities?: Array<{
                name: string;
                quantity: number;
              }>;
            }>;
          };
        } | null;
      }>;
    };
  };
  errors?: unknown;
};

type AdminInventoryByIdResponse = {
  data?: {
    nodes?: Array<{
      id: string;
      inventoryItem?: {
        inventoryLevels?: {
          nodes?: Array<{
            quantities?: Array<{
              name: string;
              quantity: number;
            }>;
          }>;
        };
      } | null;
    } | null>;
  };
  errors?: unknown;
};

type ResultItem = {
  id: string;
  sku: string;
  variant: string;
  price: string;
  compareAtPrice: string | null;
  stock: number | null;
  productUrl: string;
  variantImage: string;
  image1: string;
  image2: string;
  image3: string;
  delaiLivraison: string; // ← délai basé sur les tags
};

let cachedAdminToken: string | null = null;
let cachedAdminTokenExpiresAt = 0;

function normalize(text: string) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

async function runStorefrontSearch(query: string): Promise<ShopifyProduct[]> {
  const graphqlQuery = `
    query SearchProducts($query: String!) {
      search(first: 20, types: PRODUCT, query: $query) {
        nodes {
          ... on Product {
            title
            handle
            onlineStoreUrl
            tags
            images(first: 4) {
              nodes {
                url
                altText
              }
            }
            variants(first: 100) {
              nodes {
                id
                title
                sku
                quantityAvailable
                image {
                  url
                  altText
                }
                price {
                  amount
                  currencyCode
                }
                compareAtPrice {
                  amount
                  currencyCode
                }
              }
            }
          }
        }
      }
    }
  `;

  const response = await fetch(`https://${SHOP}/api/2026-04/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Storefront-Access-Token': STOREFRONT_TOKEN as string,
    },
    body: JSON.stringify({ query: graphqlQuery, variables: { query } }),
    cache: 'no-store',
  });

  const json = (await response.json()) as ShopifyResponse;
  if (!response.ok || json.errors) throw new Error('Erreur Shopify Storefront');
  return json.data?.search?.nodes ?? [];
}

async function getAdminAccessToken() {
  const now = Date.now();
  if (cachedAdminToken && now < cachedAdminTokenExpiresAt) return cachedAdminToken;

  const body = new URLSearchParams();
  body.set('grant_type', 'client_credentials');
  body.set('client_id', ADMIN_CLIENT_ID as string);
  body.set('client_secret', ADMIN_CLIENT_SECRET as string);

  const response = await fetch(`https://${SHOP}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
    cache: 'no-store',
  });

  const json = (await response.json()) as AdminTokenResponse;
  if (!response.ok || !json.access_token)
    throw new Error(json.error_description || json.error || 'Impossible d\'obtenir le token Admin');

  cachedAdminToken = json.access_token;
  const expiresInMs = (json.expires_in ?? 86400) * 1000;
  cachedAdminTokenExpiresAt = now + expiresInMs - 5 * 60 * 1000;
  return cachedAdminToken;
}

async function getAdminAvailableByVariantId(variantIds: string[]) {
  if (!variantIds.length) return new Map<string, number>();
  const adminToken = await getAdminAccessToken();
  const graphqlQuery = `
    query VariantInventoryByIds($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on ProductVariant {
          id
          inventoryItem {
            inventoryLevels(first: 20) {
              nodes {
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
  `;

  const response = await fetch(`https://${SHOP}/admin/api/2026-04/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': adminToken },
    body: JSON.stringify({ query: graphqlQuery, variables: { ids: variantIds } }),
    cache: 'no-store',
  });
  const json = (await response.json()) as AdminInventoryByIdResponse;
  if (!response.ok || json.errors) throw new Error('Erreur Shopify Admin Inventory');
  const map = new Map<string, number>();
  for (const node of json.data?.nodes ?? []) {
    if (!node?.id) continue;
    // Somme du stock "available" sur tous les emplacements (robuste multi-locations).
    const qty = (node.inventoryItem?.inventoryLevels?.nodes ?? []).reduce((sum, lvl) => {
      const avail = lvl.quantities?.find((q) => q.name === 'available')?.quantity ?? 0;
      return sum + avail;
    }, 0);
    map.set(node.id, qty);
  }
  return map;
}

// ── Décoder les tags Shopify en délai de livraison ──
function getDelaiFromTags(tags: string[]): string {
  if (tags.includes('10weeks')) return 'Sur commande ✓ Délai 10-12 semaines';
  if (tags.includes('6weeks'))  return 'Sur commande ✓ Délai 6-8 semaines';
  if (tags.includes('5weeks'))  return 'Sur commande ✓ Délai 5-6 semaines';
  if (tags.includes('4weeks'))  return 'Sur commande ✓ Délai 4-5 semaines';
  if (tags.includes('3weeks'))  return 'Sur commande ✓ Délai 3-4 semaines';
  if (tags.includes('2weeks'))  return 'Sur commande ✓ Délai 2-3 semaines';
  if (tags.includes('1week'))   return 'Sur commande ✓ Délai 1-2 semaines';
  return 'Sur commande ✓';
}

function buildStorefrontItems(products: ShopifyProduct[], words: string[]): ResultItem[] {
  return products.flatMap((product) => {
    const productImages = product.images?.nodes ?? [];
    const variants = product.variants?.nodes ?? [];
    const delaiLivraison = getDelaiFromTags(product.tags ?? []);

    return variants
      .filter((variant) => {
        const haystack = normalize(
          [product.title, variant.title ?? '', variant.sku ?? ''].join(' ')
        );
        return words.every((word) => haystack.includes(word));
      })
      .map((variant) => {
        const variantNumericId = variant.id.split('/').pop() || '';
        return {
          id: variant.id,
          sku: variant.sku ?? '',
          variant:
            variant.title && variant.title !== 'Default Title'
              ? `${product.title} / ${variant.title}`
              : product.title,
          price: Number(variant.price.amount).toFixed(2),
          compareAtPrice: variant.compareAtPrice ? Number(variant.compareAtPrice.amount).toFixed(2) : null,
          stock: null,
          productUrl: product.onlineStoreUrl
            ? `${product.onlineStoreUrl}?variant=${variantNumericId}`
            : `https://${SHOP}/products/${product.handle}?variant=${variantNumericId}`,
          variantImage: variant.image?.url || productImages[0]?.url || '',
          image1: productImages[1]?.url || '',
          image2: productImages[2]?.url || '',
          image3: productImages[3]?.url || '',
          delaiLivraison,
        };
      });
  });
}

export async function GET(request: NextRequest) {
  try {
    if (!SHOP || !STOREFRONT_TOKEN)
      return NextResponse.json({ error: 'Variables Storefront manquantes dans Vercel.' }, { status: 500 });

    const rawQuery = request.nextUrl.searchParams.get('q')?.trim() || '';
    if (!rawQuery) return NextResponse.json({ items: [] });

    const normalizedQuery = normalize(rawQuery);
    const words = normalizedQuery.split(/\s+/).filter(Boolean);
    const searchQueries = Array.from(new Set([rawQuery, ...words])).filter(Boolean);

    const allProductsMap = new Map<string, ShopifyProduct>();
    for (const q of searchQueries) {
      try {
        const products = await runStorefrontSearch(q);
        for (const product of products) allProductsMap.set(product.handle, product);
      } catch { /* ignore */ }
    }

    const products = Array.from(allProductsMap.values());
    const storefrontItems = buildStorefrontItems(products, words);

    if (!ADMIN_CLIENT_ID || !ADMIN_CLIENT_SECRET)
      return NextResponse.json({ items: storefrontItems });

    try {
      const variantIds = storefrontItems.map((item) => item.id).filter(Boolean);
      const adminAvailableMap = await getAdminAvailableByVariantId(variantIds);
      const items = storefrontItems.map((item) => ({
        ...item,
        stock: adminAvailableMap.has(item.id) ? (adminAvailableMap.get(item.id) as number) : null,
      }));
      return NextResponse.json({ items });
    } catch {
      return NextResponse.json({ items: storefrontItems.map((item) => ({ ...item, stock: null })) });
    }
  } catch (error) {
    return NextResponse.json({ error: 'Erreur serveur', details: String(error) }, { status: 500 });
  }
}