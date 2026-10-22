// app/api/configurateur/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// « Configurateur parasol » dans le formulaire (21.10.2026) — source de l'app.
//
// L'app vit dans le thème Shopify (page /pages/configurer-mon-parasol, section
// sections/configurateur-parasol.liquid + assets configurateur-parasol.js /
// -data.js / .css, thème v1.6 minimum). Cette route NE recalcule RIEN : elle lit
// la page publique et en extrait
//   • les 3 blocs JSON de la section (#cfgp-models, #cfgp-cfg, #cfgp-shop) ;
//   • les adresses CDN du code (attributs data-js / data-data / data-css).
// Le fichier maître reste dans Shopify : une modif publiée dans le thème arrive
// ici toute seule (cache 5 min).
//
// 22.10.2026 — « Shopify a répondu 500 » : la page complète met ~3 s à se calculer (boucle Liquid
// sur la collection parasols-glatz, articles à centaines de variantes) et Shopify coupe vers 3 s
// pour un appel serveur. Donc :
//   1. on lit d'abord la vue légère  /pages/configurer-mon-parasol?view=cfgdata
//      (templates/page.cfgdata.liquid : adresses du code + réglages, ~0,3 s) ;
//   2. la liste des modèles vient de l'API Admin (collection parasols-glatz, articles actifs) ;
//   3. repli : page complète (2 essais), puis dernière version en cache.
//
// Interne : non listée dans proxy.ts → protégée par le code d'équipe.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { SHOP_URL, lireBoutique } from "@/lib/configurateur-shop";
import { shopifyAdminGraphQL } from "@/lib/shopify-stock";

export const dynamic = "force-dynamic";

const PAGE = "/pages/configurer-mon-parasol";
const VUE = PAGE + "?view=cfgdata"; // templates/page.cfgdata.liquid
const TTL_MS = 5 * 60 * 1000;

export type ConfigurateurPayload = {
  models: Record<string, unknown>;
  cfg: Record<string, unknown>;
  shop: Record<string, unknown>;
  js: string;
  data: string;
  css: string;
  v: string;
  base: string;
  lu: string;
};

let cache: { at: number; payload: ConfigurateurPayload } | null = null;

function blocJson(html: string, id: string): Record<string, unknown> {
  const m = html.match(new RegExp(`<script[^>]*id="${id}"[^>]*>([\\s\\S]*?)</script>`));
  if (!m) return {};
  try {
    const v = JSON.parse(m[1]);
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

function attribut(html: string, nom: string): string {
  const m = html.match(new RegExp(`id="cfgp"[^>]*?\\s${nom}="([^"]+)"`));
  if (!m) return "";
  const u = m[1].replace(/&amp;/g, "&");
  return u.startsWith("//") ? "https:" + u : u;
}

/** Lit une page de la boutique qui contient le bloc #cfgp (plusieurs essais : Shopify répond parfois 500). */
async function lirePage(chemin: string, essais: number): Promise<string> {
  let dernier = 0;
  for (let i = 0; i < essais; i++) {
    const { status, text } = await lireBoutique(chemin);
    if (status === 200 && text.includes('id="cfgp"')) return text;
    dernier = status;
  }
  throw new Error(`Shopify a répondu ${dernier}`);
}

type ProduitAdmin = {
  id: string;
  handle: string;
  title: string;
  status: string;
  priceRangeV2: { minVariantPrice: { amount: string } } | null;
  featuredMedia: { preview: { image: { url: string } | null } | null } | null;
};

/** Modèles du configurateur (même forme que le bloc #cfgp-models du thème), lus par l'API Admin. */
async function modelesAdmin(): Promise<Record<string, unknown>> {
  const data = await shopifyAdminGraphQL<{ collections: { nodes: { products: { nodes: ProduitAdmin[] } }[] } }>(
    `query configurateurModeles {
      collections(first: 1, query: "handle:parasols-glatz") {
        nodes { products(first: 100) { nodes {
          id handle title status
          priceRangeV2 { minVariantPrice { amount } }
          featuredMedia { preview { image { url(transform: { maxWidth: 480, maxHeight: 480 }) } } }
        } } }
      }
    }`,
  );
  const out: Record<string, unknown> = {};
  for (const p of data.collections?.nodes?.[0]?.products?.nodes || []) {
    if (!p?.handle || p.status !== "ACTIVE") continue;
    const prix = Number(p.priceRangeV2?.minVariantPrice?.amount);
    out[p.handle] = {
      id: Number(p.id.split("/").pop()),
      t: p.title,
      u: "/products/" + encodeURIComponent(p.handle),
      pmin: Number.isFinite(prix) ? Math.round(prix * 100) : null,
      a: true,
      img: p.featuredMedia?.preview?.image?.url || null,
    };
  }
  return out;
}

export async function GET(req: Request) {
  const force = new URL(req.url).searchParams.get("frais") === "1";
  if (!force && cache && Date.now() - cache.at < TTL_MS) {
    return NextResponse.json(cache.payload, { headers: { "X-Cache": "HIT" } });
  }
  try {
    const [pageRes, adminRes] = await Promise.allSettled([
      lirePage(VUE, 2).catch(() => lirePage(PAGE, 2)),
      modelesAdmin(),
    ]);
    if (pageRes.status === "rejected") throw pageRes.reason;
    const html = pageRes.value;
    const modelesPage = blocJson(html, "cfgp-models");
    const modeles =
      adminRes.status === "fulfilled" && Object.keys(adminRes.value).length ? adminRes.value : modelesPage;
    const payload: ConfigurateurPayload = {
      models: modeles,
      cfg: blocJson(html, "cfgp-cfg"),
      shop: blocJson(html, "cfgp-shop"),
      js: attribut(html, "data-js"),
      data: attribut(html, "data-data"),
      css: attribut(html, "data-css"),
      v: attribut(html, "data-v"),
      base: SHOP_URL,
      lu: new Date().toISOString(),
    };
    if (!payload.js || !payload.data || !Object.keys(payload.models).length) {
      return NextResponse.json(
        {
          error:
            "La page Shopify « configurer-mon-parasol » ne contient pas encore le configurateur v1.6 " +
            "(copie de thème pas encore publiée ?). Pour tester avant publication : CONFIGURATEUR_PREVIEW_THEME_ID.",
        },
        { status: 502 },
      );
    }
    cache = { at: Date.now(), payload };
    return NextResponse.json(payload, { headers: { "X-Cache": "MISS" } });
  } catch (e) {
    if (cache) return NextResponse.json(cache.payload, { headers: { "X-Cache": "STALE" } });
    return NextResponse.json({ error: (e as Error).message || "Lecture Shopify impossible" }, { status: 502 });
  }
}
