// app/api/traductions/lancer/route.ts
//
// Sentinelle traductions (28.11.2026) — lancement MANUEL depuis la page
// /dashboard/traductions (route interne, cookie de session exigé par le proxy).
// Body : { heures?: number (1 à 720, défaut 26), maxClaude?: number (0 à 60) }
// Même passage que la tâche planifiée nocturne (y compris la correction
// automatique des règles sûres si TRADUCTIONS_AUTO_CORRECTION=1).

import { NextRequest, NextResponse } from "next/server";
import { lancerSentinelle } from "@/lib/traductions-sentinelle";
import { messageErreur } from "@/lib/traductions-shopify";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { heures?: unknown; maxClaude?: unknown };
    const heures = Math.min(720, Math.max(1, Number(body.heures) || 26));
    const maxClaude = body.maxClaude === undefined ? undefined : Math.min(60, Math.max(0, Number(body.maxClaude) || 0));
    const depuis = new Date(Date.now() - heures * 3600 * 1000).toISOString();
    const resultat = await lancerSentinelle({ depuis, maxClaude });
    return NextResponse.json(resultat);
  } catch (err) {
    console.error("[api/traductions/lancer] erreur:", err);
    return NextResponse.json({ error: messageErreur(err) }, { status: 500 });
  }
}
