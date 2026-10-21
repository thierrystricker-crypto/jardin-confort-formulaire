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
// ici toute seule (cache 5 min). Aucun jeton.
//
// Interne : non listée dans proxy.ts → protégée par le code d'équipe.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { SHOP_URL, lireBoutique } from "@/lib/configurateur-shop";

export const dynamic = "force-dynamic";

const PAGE = "/pages/configurer-mon-parasol";
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

export async function GET(req: Request) {
  const force = new URL(req.url).searchParams.get("frais") === "1";
  if (!force && cache && Date.now() - cache.at < TTL_MS) {
    return NextResponse.json(cache.payload, { headers: { "X-Cache": "HIT" } });
  }
  try {
    const { status, text: html } = await lireBoutique(PAGE);
    if (status !== 200) throw new Error(`Shopify a répondu ${status}`);
    const payload: ConfigurateurPayload = {
      models: blocJson(html, "cfgp-models"),
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
