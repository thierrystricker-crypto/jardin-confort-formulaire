// app/api/moodboard/apercu/route.ts
// POST — aperçu de la planche couleurs pour le FORMULAIRE (brouillon pas
// forcément enregistré, donc sans slug). Chantier moodboard, 12.10.2026.
//
// INTERNE : protégée par le cookie de session (proxy.ts, comportement par
// défaut des routes /api/). Contrairement à /api/offres/[slug]/matieres, elle
// renvoie aussi la liste des articles NON reliés — information réservée au
// commercial, jamais affichée sur un document client.
//
// Lecture seule : Shopify (selectedOptions) + RPC matieres_pour_offre.
// Aucune écriture, ni en base ni dans Shopify.

import { NextRequest, NextResponse } from "next/server";
import { matieresPourLignes } from "@/lib/matieres-offre";

const MAX_LIGNES = 300;

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as { lines?: unknown } | null;
    const lignes = Array.isArray(body?.lines) ? body!.lines.slice(0, MAX_LIGNES) : [];
    const r = await matieresPourLignes(lignes as Parameters<typeof matieresPourLignes>[0]);
    return NextResponse.json(r, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("POST /api/moodboard/apercu:", e);
    return NextResponse.json(
      { matieres: [], couverture: { articles: 0, representes: 0, nonRelies: [] }, erreur: true },
      { status: 200 }
    );
  }
}
