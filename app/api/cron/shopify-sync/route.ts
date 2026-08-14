// app/api/cron/shopify-sync/route.ts
//
// Tâche planifiée : importe les commandes Shopify modifiées depuis la
// dernière passe. Déclenchée toutes les heures par Vercel Cron (vercel.json).
//
// Vercel appelle en GET et joint `Authorization: Bearer $CRON_SECRET`
// dès que la variable d'environnement CRON_SECRET existe sur le projet.
// La route refuse tout appel qui n'a pas ce jeton — c'est elle qui porte
// son authentification, le proxy la laisse simplement passer.
//
// Le sync est incrémental et reprend tout seul : si une passe est coupée
// par la limite de durée, le curseur est mémorisé en base
// (shopify_sync_etat) et le passage suivant repart de là.
//
// Surveillance : la route lève une notification interne quand quelque chose
// cloche vraiment — échec de la passe, erreurs remontées, ou curseur en
// attente depuis plus de 6 h (le symptôme exact de la panne de mai→juillet
// 2026 : un rattrapage qui n'avance jamais). Une seule alerte non lue à la
// fois, sinon une tâche horaire empilerait 24 notifications par jour.

import { NextRequest, NextResponse } from "next/server";
import { syncShopifyOrders } from "@/lib/shopify-orders";
import { supabaseAdmin } from "@/lib/supabase";
import { createNotificationUnique } from "@/lib/notifications";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // Vercel Pro

const SEUIL_BLOCAGE_H = 6;

function autorise(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // Sans secret configuré, on refuse : une tâche planifiée ouverte à tous
    // permettrait à n'importe qui de marteler l'API Shopify.
    console.error("[cron/shopify-sync] CRON_SECRET absent des variables d'environnement");
    return false;
  }
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

async function alerter(titre: string, message: string) {
  const cree = await createNotificationUnique({
    type: "shopify_sync_erreur",
    titre,
    message,
  });
  console.error(`[cron/shopify-sync] ALERTE ${cree ? "créée" : "déjà signalée"} : ${message}`);
}

export async function GET(request: NextRequest) {
  if (!autorise(request)) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    const result = await syncShopifyOrders({
      syncType: "cron",
      maxOrders: 2000,
      timeoutMs: 260000, // marge sous les 300 s
    });

    const [{ data: derniere }, { data: etat }] = await Promise.all([
      supabaseAdmin
        .from("commandes_shopify")
        .select("created_at_shopify")
        .order("created_at_shopify", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabaseAdmin
        .from("shopify_sync_etat")
        .select("curseur, curseur_depuis")
        .eq("id", 1)
        .maybeSingle(),
    ]);

    console.log(
      `[cron/shopify-sync] ${result.ordersInserted} ajoutée(s), ${result.ordersUpdated} mise(s) à jour, ` +
      `${result.clientsCreated} client(s) créé(s) en ${result.durationMs}ms. hasMore=${result.hasMore}`
    );

    // ─── Surveillance ───
    if (result.errors.length > 0) {
      await alerter(
        "⚠️ Import Shopify : erreurs pendant la passe",
        result.errors.map(e => `${e.shopifyId} : ${e.message}`).join(" · ").slice(0, 500)
      );
    } else if (etat?.curseur && etat.curseur_depuis) {
      const heures = (Date.now() - new Date(etat.curseur_depuis).getTime()) / 3600000;
      if (heures >= SEUIL_BLOCAGE_H) {
        await alerter(
          "⚠️ Import Shopify : le rattrapage n'avance pas",
          `L'import a du retard depuis ${Math.round(heures)} h sans réussir à le combler. ` +
          `Dernière commande importée : ${derniere?.created_at_shopify?.slice(0, 10) ?? "aucune"}. ` +
          `Vérifier les journaux Vercel de /api/cron/shopify-sync.`
        );
      }
    }

    return NextResponse.json({
      success: true,
      ajoutees: result.ordersInserted,
      mises_a_jour: result.ordersUpdated,
      clients_crees: result.clientsCreated,
      duree_ms: result.durationMs,
      reste_a_traiter: result.hasMore,
      derniere_commande: derniere?.created_at_shopify ?? null,
      erreurs: result.errors,
    });
  } catch (err) {
    console.error("[cron/shopify-sync] Échec :", err);
    await alerter(
      "⚠️ Import Shopify : la synchronisation a échoué",
      `${(err as Error).message}`.slice(0, 500)
    );
    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 500 }
    );
  }
}
