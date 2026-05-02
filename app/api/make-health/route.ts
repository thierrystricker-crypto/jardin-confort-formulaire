// app/api/make-health/route.ts
// GET   : retourne l'état du flow Make (dernier ping, écart de temps)
// POST  : Make appelle cette route quand il termine un scénario (heartbeat)

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

// ─── POST /api/make-health ───
// Make poste ici en fin de scénario pour signaler qu'il tourne bien
// Body : { event: 'flow_completed', scenario_name: 'validation_offre',
//          run_id: 'xxx', offre_slug: 'cmd-80520-abc', numero_affiche: 'CMD-80520' }
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      event = "flow_completed",
      scenario_name = "validation_offre",
      run_id,
      offre_slug,
      numero_affiche,
      details,
    } = body;

    const { error } = await supabaseAdmin
      .from("make_pings")
      .insert({
        source: "make",
        event,
        scenario_name,
        run_id: run_id || null,
        offre_slug: offre_slug || null,
        numero_affiche: numero_affiche || null,
        details: details || null,
      });

    if (error) {
      console.error("make_pings insert error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });

  } catch (err) {
    console.error("make-health POST error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// ─── GET /api/make-health ───
// Retourne :
//  - last_ping_at : dernier moment où Make a complété un scénario
//  - last_validation_at : dernière validation de commande dans Supabase
//  - gap_minutes : différence entre les deux (devrait être < 5min)
//  - status : 'healthy' | 'warning' | 'critical' | 'unknown'
//  - alert : true si statut warning/critical
export async function GET() {
  try {
    // 1. Dernier ping Make réussi
    const { data: lastPing } = await supabaseAdmin
      .from("make_pings")
      .select("created_at, event, scenario_name, run_id, numero_affiche")
      .eq("event", "flow_completed")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    // 2. Dernière commande validée (= moment où Make aurait dû ping)
    const { data: lastCommande } = await supabaseAdmin
      .from("offres")
      .select("created_at, numero_affiche, slug")
      .eq("type_document", "Commande")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    const now = new Date();
    const lastPingDate = lastPing?.created_at ? new Date(lastPing.created_at) : null;
    const lastCommandeDate = lastCommande?.created_at ? new Date(lastCommande.created_at) : null;

    // Si pas de commande récente, on ne peut rien dire
    if (!lastCommandeDate) {
      return NextResponse.json({
        status: "unknown",
        alert: false,
        last_ping_at: lastPingDate?.toISOString() || null,
        last_validation_at: null,
        gap_minutes: null,
        message: "Aucune commande dans la base — impossible de vérifier",
      });
    }

    // Délai depuis la dernière commande (en minutes)
    const minutesSinceLastCommande = Math.floor(
      (now.getTime() - lastCommandeDate.getTime()) / 60000
    );

    // Si la dernière commande date d'il y a > 24h, on ne peut pas conclure
    // (peut-être qu'il n'y a juste pas eu de commandes)
    if (minutesSinceLastCommande > 24 * 60) {
      return NextResponse.json({
        status: "unknown",
        alert: false,
        last_ping_at: lastPingDate?.toISOString() || null,
        last_validation_at: lastCommandeDate.toISOString(),
        gap_minutes: null,
        message: "Pas de commande récente (< 24h) pour vérifier",
      });
    }

    // Si on a une commande récente, Make aurait dû ping après
    if (!lastPingDate || lastPingDate < lastCommandeDate) {
      // Make n'a pas ping après la dernière commande
      const gap = minutesSinceLastCommande;
      let status: "warning" | "critical" = "warning";
      if (gap > 30) status = "critical"; // > 30 min = sérieux problème

      return NextResponse.json({
        status,
        alert: true,
        last_ping_at: lastPingDate?.toISOString() || null,
        last_validation_at: lastCommandeDate.toISOString(),
        last_validation_numero: lastCommande?.numero_affiche || null,
        gap_minutes: gap,
        message: `Make n'a pas ping depuis la commande ${lastCommande?.numero_affiche || "(inconnu)"} (il y a ${gap} min)`,
      });
    }

    // OK : Make a ping après la dernière commande
    const pingGapMinutes = Math.floor(
      (lastPingDate.getTime() - lastCommandeDate.getTime()) / 60000
    );
    return NextResponse.json({
      status: "healthy",
      alert: false,
      last_ping_at: lastPingDate.toISOString(),
      last_validation_at: lastCommandeDate.toISOString(),
      last_validation_numero: lastCommande?.numero_affiche || null,
      gap_minutes: pingGapMinutes,
      message: `Make a traité ${lastCommande?.numero_affiche || "la commande"} en ${pingGapMinutes} min`,
    });

  } catch (err) {
    console.error("make-health GET error:", err);
    return NextResponse.json({
      status: "unknown",
      alert: false,
      error: String(err),
    }, { status: 500 });
  }
}