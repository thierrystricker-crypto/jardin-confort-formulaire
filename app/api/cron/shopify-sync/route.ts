// app/api/cron/shopify-sync/route.ts
//
// Tâche planifiée : importe les commandes Shopify modifiées depuis la
// dernière passe. Déclenchée par Vercel Cron (voir vercel.json).
//
// Vercel appelle en GET et joint `Authorization: Bearer $CRON_SECRET`
// dès que la variable d'environnement CRON_SECRET existe sur le projet.
// La route refuse tout appel qui n'a pas ce jeton — c'est elle qui porte
// son authentification, le proxy la laisse simplement passer.
//
// Le sync est incrémental et reprend tout seul : si une passe est coupée
// par la limite de durée, le curseur est mémorisé en base
// (shopify_sync_etat) et le passage suivant repart de là.

import { NextRequest, NextResponse } from "next/server";
import { syncShopifyOrders } from "@/lib/shopify-orders";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // Vercel Pro

function autorise(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // Sans secret configuré, on refuse : une tâche planifiée ouverte à tous
    // permettrait à n'importe qui de marteler l'API Shopify.
    console.error("[cron/shopify-sync] CRON_SECRET absent des variables d'environnement");
    return false;
  }
  const entete = request.headers.get("authorization");
  return entete === `Bearer ${secret}`;
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

    const { data: derniere } = await supabaseAdmin
      .from("commandes_shopify")
      .select("created_at_shopify")
      .order("created_at_shopify", { ascending: false })
      .limit(1)
      .maybeSingle();

    console.log(
      `[cron/shopify-sync] ${result.ordersInserted} ajoutée(s), ${result.ordersUpdated} mise(s) à jour, ` +
      `${result.clientsCreated} client(s) créé(s) en ${result.durationMs}ms. hasMore=${result.hasMore}`
    );

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
    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 500 }
    );
  }
}
