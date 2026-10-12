// lib/matieres-offre.ts
// Moodboard des matières en fin d'offre (chantier du 12.10.2026).
//
// Chemin : lignes de l'offre → variantes Shopify (selectedOptions, vendor,
// handle) → RPC matieres_pour_offre → finitions dédoublonnées, avec leur poids.
//
// Règles du chantier (journal-moodboard-matieres.md) :
//   • LECTURE SEULE sur la base matières. L'app n'écrit jamais dans `matieres`.
//   • AUCUN rapprochement par nom ici : la RPC découpe les valeurs d'option et
//     délègue chaque morceau à matiere_depuis_option. Une couleur qui manque se
//     corrige dans la base (projet « Import articles Shopify »), pas ici.
//
// Robustesse : si Shopify ne répond pas, ou si une variante a été supprimée,
// la ligne est ignorée. Le moodboard est un bonus : il ne bloque jamais le
// document — au pire, la page n'apparaît pas.
//
// Ce fichier ne touche à aucun lib/shopify-*.ts (sanctuarisés) : le token
// Admin est obtenu ici, avec le même flux client_credentials.

import { supabaseAdmin } from "@/lib/supabase";
import { isShopifyLine } from "@/lib/jc-print-types";
import type { MatiereMoodboard, ResultatMoodboard } from "@/lib/moodboard";

export type { MatiereMoodboard, CouvertureMoodboard, ResultatMoodboard } from "@/lib/moodboard";

const SHOP = process.env.SHOPIFY_STORE_DOMAIN;
const ADMIN_CLIENT_ID = process.env.SHOPIFY_ADMIN_CLIENT_ID;
const ADMIN_CLIENT_SECRET = process.env.SHOPIFY_ADMIN_CLIENT_SECRET;
const API_VERSION = "2026-04";
const TIMEOUT_MS = 8000;

type LigneOffre = {
  id?: string;
  type?: string;
  title?: string;
  sku?: string;
  qty?: number;
  unitPrice?: number;
  lineDiscountPerUnit?: number;
  shopifyLocked?: boolean;
  shopifyVariantId?: string;
};

type VarianteShopify = {
  id: string;
  selectedOptions: { name: string; value: string }[];
  product: { vendor: string; handle: string } | null;
};

// ─── Token Admin (cache mémoire) ─────────────────────────────────────────────
let cachedToken: string | null = null;
let tokenExpiry = 0;

async function getAdminToken(): Promise<string | null> {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
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
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (json.access_token) {
      cachedToken = json.access_token;
      tokenExpiry = Date.now() + (json.expires_in || 3600) * 1000 - 60000;
      return cachedToken;
    }
  } catch { /* ignore : pas de moodboard plutôt qu'une erreur */ }
  return null;
}

// ─── Lecture des variantes (lecture seule, read_products) ───────────────────
const QUERY_VARIANTES = `
  query MoodboardVariantes($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on ProductVariant {
        id
        selectedOptions { name value }
        product { vendor handle }
      }
    }
  }`;

async function lireVariantes(ids: string[]): Promise<Map<string, VarianteShopify>> {
  const out = new Map<string, VarianteShopify>();
  if (ids.length === 0) return out;
  const token = await getAdminToken();
  if (!token) return out;

  // nodes() accepte 250 ids ; on reste large avec des paquets de 100.
  for (let i = 0; i < ids.length; i += 100) {
    const paquet = ids.slice(i, i + 100);
    try {
      const res = await fetch(`https://${SHOP}/admin/api/${API_VERSION}/graphql.json`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
        body: JSON.stringify({ query: QUERY_VARIANTES, variables: { ids: paquet } }),
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const json = (await res.json()) as { data?: { nodes?: (VarianteShopify | null)[] } };
      for (const n of json.data?.nodes ?? []) {
        // null = variante supprimée depuis l'offre → ligne ignorée
        if (n && n.id && n.product) out.set(n.id, n);
      }
    } catch { /* paquet ignoré */ }
  }
  return out;
}

// ─── Point d'entrée ──────────────────────────────────────────────────────────
export async function matieresPourLignes(lignes: LigneOffre[]): Promise<ResultatMoodboard> {
  // Tous les articles Shopify de l'offre comptent dans la couverture, y compris
  // les anciennes lignes sans ID de variante (elles ne peuvent pas être reliées).
  const articles = (lignes ?? [])
    .filter((l) => isShopifyLine(l))
    .map((l, i) => ({ ...l, _id: l.id || `ligne-${i}` }));

  const vide = (): ResultatMoodboard => ({
    matieres: [],
    couverture: { articles: articles.length, representes: 0, nonRelies: articles.map((l) => l.title || l.sku || "") },
  });
  if (articles.length === 0) return vide();

  const avecVariante = articles.filter(
    (l) => typeof l.shopifyVariantId === "string" && l.shopifyVariantId.startsWith("gid://")
  );
  const variantes = await lireVariantes(Array.from(new Set(avecVariante.map((l) => l.shopifyVariantId as string))));
  if (variantes.size === 0) return vide();

  const pLignes = avecVariante.flatMap((l) => {
    const v = variantes.get(l.shopifyVariantId as string);
    if (!v || !v.product) return [];
    const qty = Number(l.qty) || 1;
    const montant = qty * ((Number(l.unitPrice) || 0) - (Number(l.lineDiscountPerUnit) || 0));
    return [{
      ligne_id: l._id,
      vendor: v.product.vendor,
      handle: v.product.handle,
      // Article offert (prix 0) : il compte quand même, au minimum.
      poids: montant > 0 ? montant : 1,
      options: v.selectedOptions,
    }];
  });
  if (pLignes.length === 0) return vide();

  const { data, error } = await supabaseAdmin.rpc("matieres_pour_offre", { p_lignes: pLignes });
  if (error || !Array.isArray(data)) {
    console.error("matieres_pour_offre:", error?.message);
    return vide();
  }
  const matieres = (data as MatiereMoodboard[]).map((m) => ({ ...m, poids: Number(m.poids) || 0 }));

  const couvertes = new Set(matieres.flatMap((m) => m.lignes ?? []));
  return {
    matieres,
    couverture: {
      articles: articles.length,
      representes: articles.filter((l) => couvertes.has(l._id)).length,
      nonRelies: articles.filter((l) => !couvertes.has(l._id)).map((l) => l.title || l.sku || ""),
    },
  };
}
