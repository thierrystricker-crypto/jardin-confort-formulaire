// app/api/offres/[slug]/route.ts
// Lit une offre depuis Supabase + re-fetche le stock Shopify en temps réel
// GET /api/offres/[slug]
// GET /api/offres/[slug]?snapshot=true  → retourne le snapshot figé

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase";
import { isShopifyLine } from "@/lib/jc-print-types";

const SHOP             = process.env.SHOPIFY_STORE_DOMAIN;
const STOREFRONT_TOKEN = process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN;
const ADMIN_CLIENT_ID  = process.env.SHOPIFY_ADMIN_CLIENT_ID;
const ADMIN_CLIENT_SECRET = process.env.SHOPIFY_ADMIN_CLIENT_SECRET;

// Cache token Admin Shopify en mémoire (réutilisé entre les requêtes)
let cachedAdminToken: string | null = null;
let tokenExpiry = 0;

async function getAdminToken(): Promise<string | null> {
  if (cachedAdminToken && Date.now() < tokenExpiry) return cachedAdminToken;
  if (!SHOP || !ADMIN_CLIENT_ID || !ADMIN_CLIENT_SECRET) return null;
  try {
    const res = await fetch(`https://${SHOP}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: ADMIN_CLIENT_ID,
        client_secret: ADMIN_CLIENT_SECRET,
        grant_type: "client_credentials",
      }),
      cache: "no-store",
    });
    const json = await res.json() as { access_token?: string; expires_in?: number };
    if (json.access_token) {
      cachedAdminToken = json.access_token;
      tokenExpiry = Date.now() + (json.expires_in || 3600) * 1000 - 60000;
      return cachedAdminToken;
    }
  } catch { /* ignore */ }
  return null;
}

// Re-fetch le stock réel depuis Shopify Admin pour chaque SKU des lignes
async function refreshStock(lines: Array<{ type: string; sku?: string; stock?: unknown }>) {
  if (!lines || lines.length === 0) return lines;

  // Ne consulter Shopify QUE pour les lignes Shopify (cf. helper isShopifyLine).
  // Les lignes "à la volée" (custom) sont par définition hors-Shopify : leur
  // stock est saisi manuellement ou laissé null, et ne doit pas être rafraîchi.
  // Bénéfice supplémentaire : évite qu'un SKU custom à syntaxe bizarre
  // (ex: avec espaces) ne casse la query GraphQL et invalide TOUTES les lignes.
  const skus = lines
    .filter(isShopifyLine)
    .map((l) => l.sku as string);

  if (skus.length === 0) return lines;

  const adminToken = await getAdminToken();
  if (!adminToken) return lines; // Pas de token → stock inchangé

  try {
    // Échappement : SKUs entre guillemets pour gérer ceux qui contiennent des espaces
    // ou d'autres caractères spéciaux (rare mais possible côté fournisseur).
    // Sans ça, `sku:123 456 789` serait interprété par Shopify comme `sku:123` suivi
    // de termes parasites → query invalide ou résultat erroné.
    const query = skus.map((s) => `sku:"${s.replace(/"/g, '\\"')}"`).join(" OR ");
    const gql = `
      query($query: String!) {
        productVariants(first: 50, query: $query) {
          nodes {
            sku
            product {
              tags
            }
            inventoryItem {
              inventoryLevels(first: 5) {
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

    const res = await fetch(`https://${SHOP}/admin/api/2026-04/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": adminToken,
      },
      body: JSON.stringify({ query: gql, variables: { query } }),
      cache: "no-store",
    });

    const json = await res.json() as {
      data?: {
        productVariants?: {
          nodes?: Array<{
            sku: string | null;
            product?: { tags?: string[] } | null;
            inventoryItem?: {
              inventoryLevels?: {
                nodes?: Array<{
                  quantities?: Array<{ name: string; quantity: number }>;
                }>;
              };
            } | null;
          }>;
        };
      };
    };

    // Helper : calcule le délai depuis les tags Shopify
    // Cohérence métier : mêmes tags utilisés dans le template Liquid Order Printer Pro
    const DELAY_MAP: Array<{ tag: string; label: string }> = [
      { tag: "1week",   label: "1–2 semaines" },
      { tag: "2weeks",  label: "2–3 semaines" },
      { tag: "3weeks",  label: "3–4 semaines" },
      { tag: "4weeks",  label: "4–5 semaines" },
      { tag: "5weeks",  label: "5–6 semaines" },
      { tag: "6weeks",  label: "6–8 semaines" },
      { tag: "8weeks",  label: "8–10 semaines" },
      { tag: "10weeks", label: "10–12 semaines" },
    ];
    function getDelayFromTags(tags: string[] | undefined | null): string {
      if (!tags || tags.length === 0) return "Sur commande";
      const tagList = tags.map((t) => t.toLowerCase().trim());
      for (const { tag, label } of DELAY_MAP) {
        if (tagList.includes(tag)) return label;
      }
      return "Sur commande";
    }

    // Construire la map SKU → { stock, delay }
    const skuMap = new Map<string, { stock: number; delay: string }>();
    for (const node of json.data?.productVariants?.nodes ?? []) {
      const sku = node.sku ?? "";
      const qty =
        node.inventoryItem?.inventoryLevels?.nodes?.[0]?.quantities?.find(
          (q) => q.name === "available"
        )?.quantity ?? 0;
      const delay = getDelayFromTags(node.product?.tags);
      if (sku) skuMap.set(sku, { stock: qty, delay });
    }

    // Mettre à jour le stock + délai dans chaque ligne
    return lines.map((line) => {
      if (line.type === "comment" || !line.sku) return line;
      const fresh = skuMap.get(line.sku as string);
      if (!fresh) {
        // SKU introuvable côté Shopify (modif à la volée OU produit retiré du catalogue) :
        // - Si la ligne était une ligne Shopify d'origine (locked ou id "shopify-*") → on
        //   invalide le stock pour éviter d'afficher un snapshot obsolète au client.
        // - Si c'est une ligne custom (sans lock), on garde le stock manuel saisi.
        const lineWithLock = line as { shopifyLocked?: boolean; id?: string };
        const wasShopify = lineWithLock.shopifyLocked === true || lineWithLock.id?.startsWith("shopify-");
        if (wasShopify) {
          return { ...line, stock: null, delaiLivraison: undefined };
        }
        return line;
      }
      return {
        ...line,
        stock: fresh.stock < 1 ? "sur_commande" : fresh.stock,
        delaiLivraison: fresh.delay, // 🚚 Délai estimé depuis tags Shopify
      };
    });

  } catch (err) {
    console.error("Stock refresh error:", err);
    return lines; // En cas d'erreur, retourner les lignes sans modification
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const useSnapshot = request.nextUrl.searchParams.get("snapshot") === "true";

    // Lire l'offre depuis Supabase
    const { data: offre, error } = await supabase
      .from("offres")
      .select("*")
      .eq("slug", slug)
      .single();

    if (error || !offre) {
      return NextResponse.json(
        { error: "Offre non trouvée" },
        { status: 404 }
      );
    }

    // Si on demande le snapshot figé (pour l'impression)
    if (useSnapshot && offre.data_snapshot) {
      let numeroClient = null
      const clientEmail = (offre.data as Record<string,unknown>)?.email as string || offre.client_email
      if (clientEmail) {
        const { data: clientData } = await supabase
          .from("clients")
          .select("numero_client")
          .eq("email", clientEmail)
          .single()
        if (clientData) numeroClient = clientData.numero_client
      }
      return NextResponse.json({
        offre: {
          ...offre,
          data: offre.data_snapshot,
          isSnapshot: true,
          snapshotAt: offre.snapshot_at,
          numero_client: numeroClient,
        },
      });
    }

    // Pour les COMMANDES, le stock est figé au moment de la conversion offre→commande.
    // Pour les OFFRES SIGNÉES (Convertie/Acceptée), on récupère le stock J0 + PDF + QR
    // de la commande liée (cohérence parfaite entre /offre/dev-XXX et /offre/cmd-XXX).
    // Pour les OFFRES EN COURS, on refresh le stock Shopify en temps réel.
    const dataLines = (offre.data as { lines?: Array<{ type: string; sku?: string; stock?: unknown }> })?.lines ?? [];
    const isCommande = offre.type_document === "Commande";
    const isOffreConvertie = !isCommande && (offre.statut === "Convertie" || offre.statut === "Acceptée");

    let freshLines: typeof dataLines;
    let stockFrozen: string | null = null;
    let frozenPdfUrl: string | null = null;
    let frozenQrUrl: string | null = null;

    if (isCommande) {
      // 🔒 Commande : stock figé J0 dans data.lines, on garde tel quel
      freshLines = dataLines;
      stockFrozen = (offre.data as Record<string, unknown>)?.stock_frozen_at as string || null;
    } else if (isOffreConvertie && offre.numero_commande) {
      // 🔒 Offre signée → on va chercher le stock J0 + PDF + QR de la commande liée
      const { data: cmd } = await supabase
        .from("offres")
        .select("data, pdf_url, qr_url")
        .eq("numero_commande", offre.numero_commande)
        .eq("type_document", "Commande")
        .single();

      if (cmd?.data) {
        const cmdLines = (cmd.data as { lines?: typeof dataLines }).lines;
        if (Array.isArray(cmdLines) && cmdLines.length > 0) {
          freshLines = cmdLines;  // ✅ Stock J0 de la commande
          stockFrozen = (cmd.data as Record<string, unknown>)?.stock_frozen_at as string || null;
          frozenPdfUrl = cmd.pdf_url || null;  // ✅ PDF de la commande
          frozenQrUrl = cmd.qr_url || null;    // ✅ QR paiement de la commande
        } else {
          freshLines = dataLines;  // Fallback : stock de l'offre
        }
      } else {
        freshLines = dataLines;  // Fallback : commande introuvable
      }
    } else {
      // 🔄 Offre en cours : stock live Shopify
      freshLines = await refreshStock(dataLines);
    }

    const isFrozen = isCommande || isOffreConvertie;

    const freshData = {
      ...(offre.data as Record<string, unknown>),
      lines: freshLines,
    };

    // Chercher le numéro client en base
    let numeroClient = null
    const clientEmail = (offre.data as Record<string,unknown>)?.email as string || offre.client_email
    if (clientEmail) {
      const { data: clientData } = await supabase
        .from("clients")
        .select("numero_client")
        .eq("email", clientEmail)
        .single()
      if (clientData) numeroClient = clientData.numero_client
    }

    return NextResponse.json({
      offre: {
        ...offre,
        data: freshData,
        // Pour une offre signée : on remplace pdf_url ET qr_url par ceux de la commande liée
        // (les boutons "Télécharger la confirmation PDF" et "Télécharger le QR paiement"
        //  pointent ainsi vers les bons documents — ceux de la CMD, pas de l'offre)
        pdf_url: frozenPdfUrl || offre.pdf_url,
        qr_url: frozenQrUrl || offre.qr_url,
        isSnapshot: false,
        stockFrozen: !!stockFrozen,
        stockFrozenAt: stockFrozen || null,
        stockRefreshedAt: isFrozen ? null : new Date().toISOString(),
        numero_client: numeroClient,
      },
    });

  } catch (err) {
    console.error("Get offre error:", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

// PATCH /api/offres/[slug] — mettre à jour le statut ou créer un snapshot
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const body = await request.json();

    // Action : mettre à jour le statut
    if (body.statut) {
      const { error } = await supabase
        .from("offres")
        .update({ statut: body.statut })
        .eq("slug", slug);

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ success: true });
    }

    // Action : créer un snapshot figé (stock à l'instant t)
    if (body.createSnapshot) {
      // Lire l'offre
      const { data: offre } = await supabase
        .from("offres")
        .select("data")
        .eq("slug", slug)
        .single();

      if (!offre) return NextResponse.json({ error: "Offre non trouvée" }, { status: 404 });

      // Rafraîchir le stock une dernière fois
      const freshLines = await refreshStock(
        (offre.data as { lines?: Array<{ type: string; sku?: string; stock?: unknown }> })?.lines ?? []
      );
      const snapshot = { ...(offre.data as Record<string, unknown>), lines: freshLines };

      // Sauvegarder le snapshot
      const { error } = await supabase
        .from("offres")
        .update({
          data_snapshot: snapshot,
          snapshot_at: new Date().toISOString(),
        })
        .eq("slug", slug);

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ success: true, snapshot });
    }

    return NextResponse.json({ error: "Action non reconnue" }, { status: 400 });

  } catch (err) {
    console.error("Patch offre error:", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}