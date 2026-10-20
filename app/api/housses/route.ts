// app/api/housses/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// « Trouver une housse » dans le formulaire (20.10.2026) — source des données.
//
// L'app housses vit dans le thème Shopify (page /pages/trouver-ma-housse,
// section sections/trouver-ma-housse.liquid + assets trouver-ma-housse.js/.css).
// Cette route NE recalcule RIEN : elle lit cette page publique et en extrait
//   • les 3 blocs JSON que la section y écrit (#tmh-data, #tmh-glatz, #tmh-sunc)
//     → mêmes housses, mêmes prix, même texte de stock/délai que le site ;
//   • les adresses CDN du JS et du CSS (attributs data-js / data-css)
//     → le formulaire charge exactement le code du thème publié.
// Le fichier maître reste donc dans Shopify : une modif publiée dans le thème
// arrive ici toute seule (cache 5 min). Aucun jeton n'est nécessaire.
//
// Interne : non listée dans proxy.ts → protégée par le code d'équipe.
//
// Variables d'environnement (facultatives) :
//   HOUSSES_SHOP_URL          adresse publique de la boutique (défaut https://www.jardin-confort.ch)
//   HOUSSES_PREVIEW_THEME_ID  id numérique d'une copie de thème NON publiée, pour tester
//                             avant publication (best effort : dépend des cookies d'aperçu Shopify)
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";

const SHOP_URL = (process.env.HOUSSES_SHOP_URL || "https://www.jardin-confort.ch").replace(/\/$/, "");
const PREVIEW = (process.env.HOUSSES_PREVIEW_THEME_ID || "").replace(/\D/g, "");
const PAGE = "/pages/trouver-ma-housse";
const TTL_MS = 5 * 60 * 1000;

export type HoussesPayload = {
  data: unknown[];
  glatz: unknown[];
  sunc: unknown[];
  js: string;
  css: string;
  base: string;
  lu: string; // horodatage de la lecture Shopify (ISO)
};

let cache: { at: number; payload: HoussesPayload } | null = null;

function blocJson(html: string, id: string): unknown[] {
  const m = html.match(new RegExp(`<script[^>]*id="${id}"[^>]*>([\\s\\S]*?)</script>`));
  if (!m) return [];
  try {
    const v = JSON.parse(m[1]);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function attribut(html: string, nom: string): string {
  const m = html.match(new RegExp(`id="tmh"[^>]*\\s${nom}="([^"]+)"`)) || html.match(new RegExp(`\\s${nom}="([^"]*trouver-ma-housse[^"]*)"`));
  if (!m) return "";
  const u = m[1].replace(/&amp;/g, "&");
  return u.startsWith("//") ? "https:" + u : u;
}

// Lecture de la page Shopify. Avec une copie de thème en aperçu, Shopify pose
// des cookies d'aperçu puis redirige : on les renvoie à la main (fetch serveur).
async function lirePage(): Promise<string> {
  let url = SHOP_URL + PAGE + (PREVIEW ? `?preview_theme_id=${PREVIEW}&_ab=0&_fd=0&_sc=1` : "");
  const cookies = new Map<string, string>();
  for (let i = 0; i < 4; i++) {
    const res = await fetch(url, {
      redirect: "manual",
      cache: "no-store",
      headers: {
        "User-Agent": "JardinConfort-Formulaire/1.0 (+offres.jardin-confort.ch)",
        Accept: "text/html",
        ...(cookies.size ? { Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
      },
    });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [paire] = c.split(";");
      const k = paire.split("=")[0]?.trim();
      if (k) cookies.set(k, paire.slice(paire.indexOf("=") + 1));
    }
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      url = new URL(loc, url).toString();
      continue;
    }
    if (!res.ok) throw new Error(`Shopify a répondu ${res.status}`);
    const html = await res.text();
    // Aperçu demandé mais page rendue avec le thème publié (sans l'app) : un essai de plus avec les cookies.
    if (PREVIEW && !html.includes('id="tmh-data"') && i === 0 && cookies.size) continue;
    return html;
  }
  throw new Error("Trop de redirections Shopify");
}

export async function GET(req: Request) {
  const force = new URL(req.url).searchParams.get("frais") === "1";
  if (!force && cache && Date.now() - cache.at < TTL_MS) {
    return NextResponse.json(cache.payload, { headers: { "X-Cache": "HIT" } });
  }
  try {
    const html = await lirePage();
    const payload: HoussesPayload = {
      data: blocJson(html, "tmh-data"),
      glatz: blocJson(html, "tmh-glatz"),
      sunc: blocJson(html, "tmh-sunc"),
      js: attribut(html, "data-js"),
      css: attribut(html, "data-css"),
      base: SHOP_URL,
      lu: new Date().toISOString(),
    };
    if (!payload.data.length || !payload.js) {
      return NextResponse.json(
        {
          error:
            "La page Shopify « trouver-ma-housse » ne contient pas encore l'app housses v1.8 " +
            "(copie de thème pas encore publiée ?). Pour tester avant publication : HOUSSES_PREVIEW_THEME_ID.",
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
