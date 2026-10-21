// app/api/configurateur/shopify/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// GET /api/configurateur/shopify?p=<chemin>  (21.10.2026)
//
// L'app configurateur tourne dans un iframe isolé SANS accès réseau. Ses lectures
// de produits (prix, stock, variantes, images) passent par la page du formulaire,
// puis par cette route, qui ne relaie QUE deux lectures publiques de la boutique :
//   /products/<handle>?view=cfgparasol[&option_values=…]
//   /search/suggest.json?q=<SKU>&resources[…] (format exact de l'app)
// Tout autre chemin est refusé (400). Aucun jeton, aucune écriture.
// Réponse : le texte de Shopify tel quel (404 si le produit n'existe pas / n'est pas publié).
//
// Interne : non listée dans proxy.ts → protégée par le code d'équipe.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { cheminAutorise, lireBoutique } from "@/lib/configurateur-shop";

export const dynamic = "force-dynamic";

const TTL_MS = 2 * 60 * 1000;
const MAX_CACHE = 600;
const cache = new Map<string, { at: number; status: number; text: string }>();

export async function GET(req: NextRequest) {
  const chemin = cheminAutorise(req.nextUrl.searchParams.get("p") || "");
  if (!chemin) return NextResponse.json({ error: "Chemin refusé" }, { status: 400 });

  const c = cache.get(chemin);
  let r = c && Date.now() - c.at < TTL_MS ? c : null;
  if (!r) {
    try {
      const lu = await lireBoutique(chemin);
      r = { at: Date.now(), status: lu.status, text: lu.text };
      if (lu.status === 200 || lu.status === 404) {
        if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value as string);
        cache.set(chemin, r);
      }
    } catch (e) {
      if (c) r = c; // Shopify injoignable : dernière lecture
      else return NextResponse.json({ error: (e as Error).message || "Lecture Shopify impossible" }, { status: 502 });
    }
  }
  return new NextResponse(r.status === 200 ? r.text : "", {
    status: r.status === 200 ? 200 : r.status === 404 ? 404 : 502,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
