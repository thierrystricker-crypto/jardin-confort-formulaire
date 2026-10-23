// app/api/toiles/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// « Toiles Glatz » dans le formulaire (23.10.2026) — source des données.
//
// L'app vit dans le thème Shopify (page /pages/toiles-glatz, section
// sections/toiles-glatz.liquid + assets toiles-glatz.js / .css / -data.js).
// Cette route NE recalcule RIEN : elle lit la page publique et en extrait
//   • les adresses CDN du code, du style et des données (data-js, data-css, data-data)
//     → le formulaire charge exactement les fichiers du thème publié ;
//   • les best-sellers (data-reco, réglage de la section) et les textes (#tgz-txt).
// Le fichier maître reste dans Shopify : une modif publiée dans le thème arrive
// ici toute seule (cache 5 min, ?frais=1 pour forcer). Aucun jeton nécessaire.
//
// Interne : non listée dans proxy.ts → protégée par le code d'équipe.
//
// Variables d'environnement (facultatives) :
//   TOILES_SHOP_URL  adresse publique de la boutique (défaut https://www.jardin-confort.ch)
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";

const SHOP_URL = (process.env.TOILES_SHOP_URL || "https://www.jardin-confort.ch").replace(/\/$/, "");
const PAGE = "/pages/toiles-glatz";
const TTL_MS = 5 * 60 * 1000;

export type ToilesPayload = {
  js: string;
  css: string;
  data: string;
  reco: string[];
  txt: Record<string, unknown>;
  v: string;
  base: string;
  page: string;
  lu: string; // horodatage de la lecture Shopify (ISO)
};

let cache: { at: number; payload: ToilesPayload } | null = null;

// Attribut de la racine <div id="tgz" …> (la section les écrit sur ce div).
function attribut(racine: string, nom: string): string {
  const m = racine.match(new RegExp(`\\s${nom}="([^"]*)"`));
  return m ? m[1].replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'") : "";
}

function adresse(u: string): string {
  return u.startsWith("//") ? "https:" + u : u;
}

function textes(html: string): Record<string, unknown> {
  const m = html.match(/<script[^>]*id="tgz-txt"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return {};
  try {
    const v = JSON.parse(m[1].trim() || "{}");
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    // seulement des textes (chaînes ou listes de chaînes), rien d'autre
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      if (typeof x === "string") out[k] = x.slice(0, 500);
      else if (Array.isArray(x) && x.every((y) => typeof y === "string")) out[k] = x.map((y) => y.slice(0, 500));
    }
    return out;
  } catch {
    return {};
  }
}

async function lirePage(): Promise<string> {
  let derniere: unknown = null;
  for (let i = 0; i < 2; i++) {
    try {
      const res = await fetch(SHOP_URL + PAGE, {
        cache: "no-store",
        headers: {
          "User-Agent": "JardinConfort-Formulaire/1.0 (+offres.jardin-confort.ch)",
          Accept: "text/html",
        },
      });
      if (!res.ok) throw new Error(`Shopify a répondu ${res.status}`);
      return await res.text();
    } catch (e) {
      derniere = e;
    }
  }
  throw derniere instanceof Error ? derniere : new Error("Lecture Shopify impossible");
}

export async function GET(req: Request) {
  const force = new URL(req.url).searchParams.get("frais") === "1";
  if (!force && cache && Date.now() - cache.at < TTL_MS) {
    return NextResponse.json(cache.payload, { headers: { "X-Cache": "HIT" } });
  }
  try {
    const html = await lirePage();
    const racine = html.match(/<div[^>]*\sid="tgz"[^>]*>/)?.[0] || "";
    const payload: ToilesPayload = {
      js: adresse(attribut(racine, "data-js")),
      css: adresse(attribut(racine, "data-css")),
      data: adresse(attribut(racine, "data-data")),
      reco: attribut(racine, "data-reco")
        .split(/[\s,;]+/)
        .filter((c) => /^\d{2,4}$/.test(c))
        .slice(0, 12),
      txt: textes(html),
      v: attribut(racine, "data-v"),
      base: SHOP_URL,
      page: attribut(racine, "data-page") || "toiles-glatz",
      lu: new Date().toISOString(),
    };
    if (!payload.js || !payload.css || !payload.data) {
      return NextResponse.json(
        {
          error:
            "La page Shopify « toiles-glatz » ne contient pas encore l'app des toiles " +
            "(copie de thème « configurateur tissu glatz » pas encore publiée ?).",
        },
        { status: 502 },
      );
    }
    cache = { at: Date.now(), payload };
    return NextResponse.json(payload, { headers: { "X-Cache": "MISS" } });
  } catch (e) {
    // Shopify injoignable : on sert la dernière lecture si on en a une.
    if (cache) return NextResponse.json(cache.payload, { headers: { "X-Cache": "STALE" } });
    return NextResponse.json({ error: (e as Error).message || "Lecture Shopify impossible" }, { status: 502 });
  }
}
