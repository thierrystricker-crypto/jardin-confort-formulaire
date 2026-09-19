// app/api/cron/modeles-3d-sync/route.ts
//
// Tâche planifiée : régénère l'index des modèles 3D (table modeles_3d) depuis
// Shopify, chaque nuit (vercel.json). Même mécanique d'authentification que
// /api/cron/shopify-sync : Vercel joint `Authorization: Bearer $CRON_SECRET`,
// la route refuse tout le reste ; le proxy laisse passer /api/cron/*.
//
// La synchro est résumable : si Shopify n'a pas fini de préparer l'export
// dans le temps imparti, l'état reste `running` et le prochain passage (cron
// du lendemain, ou bouton « Rafraîchir l'index 3D » du dashboard) reprend.
//
// Surveillance : une notification interne unique en cas d'échec, comme pour
// l'import des commandes.

import { NextRequest, NextResponse } from "next/server";
import { executerSynchro } from "@/lib/modeles-3d-sync";
import { createNotificationUnique } from "@/lib/notifications";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function autorise(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron/modeles-3d-sync] CRON_SECRET absent des variables d'environnement");
    return false;
  }
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: NextRequest) {
  if (!autorise(request)) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    const etat = await executerSynchro("cron", 230_000);
    console.log(`[cron/modeles-3d-sync] statut=${etat.statut} ${etat.message ?? ""} ${JSON.stringify(etat.stats)}`);

    if (etat.statut === "error") {
      await createNotificationUnique({
        type: "shopify_sync_erreur",
        titre: "⚠️ Index 3D : la synchronisation a échoué",
        message: (etat.message || "Erreur inconnue").slice(0, 500),
      });
    }

    return NextResponse.json({ success: etat.statut !== "error", etat });
  } catch (err) {
    console.error("[cron/modeles-3d-sync] Échec :", err);
    await createNotificationUnique({
      type: "shopify_sync_erreur",
      titre: "⚠️ Index 3D : la synchronisation a échoué",
      message: `${(err as Error).message}`.slice(0, 500),
    });
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 500 });
  }
}
