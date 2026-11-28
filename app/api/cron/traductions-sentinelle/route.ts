// app/api/cron/traductions-sentinelle/route.ts
//
// Tâche planifiée nocturne (28.11.2026) : sentinelle des traductions DE / EN
// du webshop. Relit ce que l'app T Lab a retraduit depuis le dernier passage,
// applique les règles fixes + une relecture Claude, range les anomalies dans
// seo_traductions_controles. Logique : lib/traductions-sentinelle.ts.
//
// Authentification : Vercel joint `Authorization: Bearer $CRON_SECRET`, la
// route refuse tout le reste ; le proxy laisse passer /api/cron/*.
// Planification dans vercel.json.
//
// Écrit dans seo_traductions_runs, seo_traductions_controles et
// notifications. N'écrit dans Shopify (traductions DE / EN) que si
// TRADUCTIONS_AUTO_CORRECTION=1, et uniquement les corrections sûres.

import { NextRequest, NextResponse } from "next/server";
import { lancerSentinelle } from "@/lib/traductions-sentinelle";
import { messageErreur } from "@/lib/traductions-shopify";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function autorise(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron/traductions-sentinelle] CRON_SECRET absent des variables d'environnement");
    return false;
  }
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: NextRequest) {
  if (!autorise(request)) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  try {
    const resultat = await lancerSentinelle();
    console.log("[cron/traductions-sentinelle]", JSON.stringify(resultat));
    return NextResponse.json(resultat);
  } catch (err) {
    console.error("[cron/traductions-sentinelle] erreur:", err);
    return NextResponse.json({ error: messageErreur(err) }, { status: 500 });
  }
}
