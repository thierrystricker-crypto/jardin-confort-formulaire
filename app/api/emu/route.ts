// app/api/emu/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// « Accords couleurs EMU » dans le formulaire (13.11.2026) — source de l'app.
//
// L'app vit dans le thème Shopify (page /pages/configurateur-emu-couleur, section
// sections/jc-emu-accords.liquid + assets jc-emu-accords.js / .css, thème v2.1 minimum).
// Cette route NE recalcule RIEN : elle lit la section par la Section Rendering API
//   /pages/configurateur-emu-couleur?section_id=jc-emu-accords&page=N
// (~1 à 1,6 s par page, sous la limite d'environ 3 s de Shopify pour un appel serveur ;
// la page complète met ~2,5 s, trop juste) et en extrait :
//   • les produits EMU (bloc <script data-emua-page>, 250 par page, toutes les pages) ;
//   • les coussins compatibles (bloc <script data-emua-cush>, dédoublonnés) ;
//   • les adresses CDN du code (jc-emu-accords.js / .css) et le format de prix (data-money).
// Le fichier maître reste dans Shopify : une modif publiée dans le thème arrive
// ici toute seule (cache 5 min). Les brouillons Shopify n'y sont pas (comme sur le site).
//
// Interne : non listée dans proxy.ts → protégée par le code d'équipe.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { SHOP_URL, lireBoutique } from "@/lib/configurateur-shop";

export const dynamic = "force-dynamic";

const PAGE = "/pages/configurateur-emu-couleur";
const SECTION = "jc-emu-accords";
const TTL_MS = 5 * 60 * 1000;
const MAX_PAGES = 8;

export type EmuPayload = {
  raw: unknown[];
  cush: unknown[];
  js: string;
  css: string;
  money: string;
  base: string;
  lu: string;
};

let cache: { at: number; payload: EmuPayload } | null = null;

function html2txt(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function absolu(u: string): string {
  const v = html2txt(u);
  return v.startsWith("//") ? "https:" + v : v;
}

function tableau(texte: string | undefined): unknown[] {
  if (!texte) return [];
  try {
    const v = JSON.parse(texte);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** Une page de la section (plusieurs essais : Shopify répond parfois 500). */
async function lirePage(n: number): Promise<string> {
  let dernier = 0;
  for (let i = 0; i < 2; i++) {
    const { status, text } = await lireBoutique(`${PAGE}?section_id=${SECTION}&page=${n}`);
    if (status === 200 && text.includes("data-emua-page")) return text;
    dernier = status;
  }
  throw new Error(`Shopify a répondu ${dernier} (page ${n})`);
}

function extraire(html: string) {
  const page = html.match(/<script[^>]*data-emua-pages="(\d+)"[^>]*>([\s\S]*?)<\/script>/);
  const cush = html.match(/<script[^>]*data-emua-cush[^>]*>([\s\S]*?)<\/script>/);
  return {
    pages: page ? Math.max(1, Math.min(MAX_PAGES, Number(page[1]) || 1)) : 1,
    raw: tableau(page?.[2]),
    cush: tableau(cush?.[1]),
  };
}

export async function GET(req: Request) {
  const force = new URL(req.url).searchParams.get("frais") === "1";
  if (!force && cache && Date.now() - cache.at < TTL_MS) {
    return NextResponse.json(cache.payload, { headers: { "X-Cache": "HIT" } });
  }
  try {
    const html1 = await lirePage(1);
    const p1 = extraire(html1);
    const suite = await Promise.all(
      Array.from({ length: p1.pages - 1 }, (_, i) => lirePage(i + 2).then(extraire)),
    );
    const raw = p1.raw.concat(...suite.map((p) => p.raw));
    // coussins : dédoublonnés par id (un coussin peut être lié à des sièges de plusieurs pages)
    const vus = new Set<unknown>();
    const cush = [p1, ...suite]
      .flatMap((p) => p.cush)
      .filter((c) => {
        const id = (c as { id?: unknown })?.id;
        if (id === undefined || vus.has(id)) return false;
        vus.add(id);
        return true;
      });

    const js = absolu(html1.match(/<script[^>]+src="([^"]*jc-emu-accords\.js[^"]*)"/)?.[1] || "");
    const css = absolu(html1.match(/<link[^>]+href="([^"]*jc-emu-accords\.css[^"]*)"/)?.[1] || "");
    const money = html2txt(html1.match(/data-money="([^"]*)"/)?.[1] || "") || "CHF {{amount}}";

    if (!js || !css || !raw.length) {
      return NextResponse.json(
        {
          error:
            "La page Shopify « configurateur-emu-couleur » ne contient pas encore l'app EMU v2.1 " +
            "(copie de thème pas encore publiée ?). Pour tester avant publication : CONFIGURATEUR_PREVIEW_THEME_ID.",
        },
        { status: 502 },
      );
    }
    const payload: EmuPayload = { raw, cush, js, css, money, base: SHOP_URL, lu: new Date().toISOString() };
    cache = { at: Date.now(), payload };
    return NextResponse.json(payload, { headers: { "X-Cache": "MISS" } });
  } catch (e) {
    if (cache) return NextResponse.json(cache.payload, { headers: { "X-Cache": "STALE" } });
    return NextResponse.json({ error: (e as Error).message || "Lecture Shopify impossible" }, { status: 502 });
  }
}
