// app/api/modeles-3d/lignes/route.ts
//
// Badge « 3D » sur les lignes du formulaire (07.10.2026). Route interne,
// lecture seule, protegee par le proxy comme toute route /api/.
//
//   POST { lignes: [{ id, sku, shopifyVariantId }] }  (200 lignes max)
//   → { has3d: { [id]: boolean } }
//
// Meme resolution que le planner et le badge du picker : lib/modeles-3d-lookup
// (gid de variante d'abord, SKU en repli). Jamais bloquant : en cas d'erreur
// on rend un objet vide, donc aucun badge.

import { NextRequest, NextResponse } from "next/server";
import { resoudreLignes3d, type LigneCle } from "@/lib/modeles-3d-lookup";

export const dynamic = "force-dynamic";

const MAX_LIGNES = 200;

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as { lignes?: unknown } | null;
    const brutes = Array.isArray(body?.lignes) ? (body!.lignes as unknown[]) : [];
    const lignes: LigneCle[] = brutes
      .slice(0, MAX_LIGNES)
      .map((l) => l as Record<string, unknown>)
      .filter((l) => typeof l?.id === "string")
      .map((l) => ({
        id: l.id as string,
        sku: typeof l.sku === "string" ? l.sku : null,
        shopifyVariantId: typeof l.shopifyVariantId === "string" ? l.shopifyVariantId : null,
      }));
    if (!lignes.length) return NextResponse.json({ has3d: {} });

    const res = await resoudreLignes3d(lignes);
    const has3d: Record<string, boolean> = {};
    for (const l of lignes) has3d[l.id] = Boolean(res.get(l.id)?.has_3d);
    return NextResponse.json({ has3d });
  } catch {
    return NextResponse.json({ has3d: {} });
  }
}
