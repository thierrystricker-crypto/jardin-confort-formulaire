// app/api/modeles-3d/sync/route.ts
//
// Synchro à la demande de l'index 3D (bouton « Rafraîchir l'index 3D »).
// Route INTERNE : derrière le verrou d'accès (cookie), rien à ajouter au proxy.
//
//   GET  → état courant (statut, dernière synchro, stats)
//   POST → un pas de synchro : démarre la bulk operation Shopify si rien ne
//          tourne, sinon vérifie où elle en est et importe dès que c'est prêt.
//          La page appelle POST toutes les 5 s tant que statut = running.
//
// Un seul pas par appel pour rester loin de la limite de durée des routes :
// c'est le navigateur qui fait la boucle.

import { NextResponse } from "next/server";
import { etapeSynchro, lireEtatSynchro } from "@/lib/modeles-3d-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET() {
  try {
    const etat = await lireEtatSynchro();
    return NextResponse.json({ etat });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST() {
  try {
    const etat = await etapeSynchro("manuel");
    return NextResponse.json({ etat });
  } catch (err) {
    console.error("[modeles-3d/sync] Échec :", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
