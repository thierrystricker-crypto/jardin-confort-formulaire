// lib/configurateur-shop.ts — SERVEUR uniquement
// ─────────────────────────────────────────────────────────────────────────────
// Configurateur de parasols Glatz dans le formulaire (21.10.2026) — lecture des
// pages PUBLIQUES de jardin-confort.ch (aucun jeton).
//
// Utilisé par :
//   GET /api/configurateur          → page /pages/configurer-mon-parasol (données + adresses du code)
//   GET /api/configurateur/shopify  → relais des lectures produit de l'app (?view=cfgparasol, suggest)
//
// Variables d'environnement (facultatives) :
//   CONFIGURATEUR_SHOP_URL          adresse publique (défaut https://www.jardin-confort.ch)
//   CONFIGURATEUR_PREVIEW_THEME_ID  id numérique d'une copie de thème NON publiée, pour tester avant
//                                   publication (best effort : cookies d'aperçu Shopify relancés à la main)
// ─────────────────────────────────────────────────────────────────────────────

export const SHOP_URL = (process.env.CONFIGURATEUR_SHOP_URL || "https://www.jardin-confort.ch").replace(/\/$/, "");
const PREVIEW = (process.env.CONFIGURATEUR_PREVIEW_THEME_ID || "").replace(/\D/g, "");

// Cookies d'aperçu gardés entre deux appels (même instance serverless)
const cookies = new Map<string, string>();

/** Lit une page publique de la boutique. Renvoie { status, text }. */
export async function lireBoutique(cheminEtQuery: string): Promise<{ status: number; text: string }> {
  let url = SHOP_URL + cheminEtQuery;
  if (PREVIEW) url += (url.includes("?") ? "&" : "?") + `preview_theme_id=${PREVIEW}&_ab=0&_fd=0&_sc=1`;
  for (let i = 0; i < 5; i++) {
    const res = await fetch(url, {
      redirect: "manual",
      cache: "no-store",
      headers: {
        "User-Agent": "JardinConfort-Formulaire/1.0 (+offres.jardin-confort.ch)",
        Accept: "text/html,application/json",
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
      const suite = new URL(loc, url);
      if (suite.origin !== new URL(SHOP_URL).origin) throw new Error("Redirection hors boutique refusée");
      url = suite.toString();
      continue;
    }
    return { status: res.status, text: res.ok ? await res.text() : "" };
  }
  throw new Error("Trop de redirections Shopify");
}

/** Chemin demandé par l'app → chemin autorisé (ou null). Seules deux lectures publiques sont relayées. */
export function cheminAutorise(p: string): string | null {
  if (typeof p !== "string" || p.length > 400 || !p.startsWith("/")) return null;
  let u: URL;
  try {
    u = new URL(p, SHOP_URL);
  } catch {
    return null;
  }
  if (u.origin !== new URL(SHOP_URL).origin) return null;
  const q = u.searchParams;
  const cles = [...q.keys()];

  // 1. Fiche produit en vue « cfgparasol » (JSON des variantes)
  const m = u.pathname.match(/^\/products\/([a-z0-9][a-z0-9-]{0,250})$/);
  if (m) {
    if (q.get("view") !== "cfgparasol") return null;
    if (cles.some((k) => k !== "view" && k !== "option_values")) return null;
    const ov = q.get("option_values");
    if (ov !== null && !/^[0-9,]{1,200}$/.test(ov)) return null;
    return `/products/${m[1]}?view=cfgparasol` + (ov ? `&option_values=${ov}` : "");
  }

  // 2. Recherche d'un SKU (suggest)
  if (u.pathname === "/search/suggest.json") {
    const sku = q.get("q") || "";
    if (!/^[A-Za-z0-9.\- ]{1,40}$/.test(sku)) return null;
    if (q.get("resources[type]") !== "product" || q.get("resources[limit]") !== "4" || q.get("resources[options][fields]") !== "variants.sku") return null;
    if (cles.length !== 4) return null;
    return `/search/suggest.json?q=${encodeURIComponent(sku)}&resources[type]=product&resources[limit]=4&resources[options][fields]=variants.sku`;
  }
  return null;
}
