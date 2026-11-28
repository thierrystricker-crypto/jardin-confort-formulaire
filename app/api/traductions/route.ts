// app/api/traductions/route.ts
//
// Sentinelle traductions (28.11.2026) — API INTERNE de la page
// /dashboard/traductions (cookie de session exigé par le proxy).
//   GET   : anomalies (filtres statut / langue / source / regle) + derniers passages
//   PATCH : changer le statut d'une ou plusieurs anomalies
// N'écrit que dans seo_traductions_controles. Aucune écriture Shopify.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const STATUTS = ["nouveau", "corrige", "ignore", "faux_positif"] as const;
type Statut = (typeof STATUTS)[number];

export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const statut = p.get("statut") || "nouveau";
  const langue = p.get("langue");
  const source = p.get("source");
  const regle = p.get("regle");

  try {
    let q = supabaseAdmin
      .from("seo_traductions_controles")
      .select("id, created_at, ressource_type, ressource_id, handle, marque, langue, champ, regle, source, extrait, correction_proposee, auto_corrigeable, statut, traduction_maj_at, traite_at")
      .order("created_at", { ascending: false })
      .limit(500); // PostgREST plafonne de toute façon à 1000 lignes
    if (statut !== "tous") q = q.eq("statut", statut);
    if (langue === "de" || langue === "en") q = q.eq("langue", langue);
    if (source === "regle" || source === "claude") q = q.eq("source", source);
    if (regle) q = q.eq("regle", regle);
    const { data: controles, error } = await q;
    if (error) throw new Error(error.message);

    const compteurs: Record<string, number> = {};
    for (const s of STATUTS) {
      const { count } = await supabaseAdmin
        .from("seo_traductions_controles")
        .select("id", { count: "exact", head: true })
        .eq("statut", s);
      compteurs[s] = count ?? 0;
    }

    const { data: runs, error: errRuns } = await supabaseAdmin
      .from("seo_traductions_runs")
      .select("id, started_at, finished_at, nb_ressources, nb_anomalies, nb_relues_claude, notes, erreur")
      .order("started_at", { ascending: false })
      .limit(10);
    if (errRuns) throw new Error(errRuns.message);

    return NextResponse.json({ controles: controles ?? [], compteurs, runs: runs ?? [] });
  } catch (err) {
    console.error("[api/traductions] GET:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = (await request.json()) as { ids?: unknown; statut?: unknown };
    const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string") : [];
    const statut = body.statut as Statut;
    if (!ids.length || !STATUTS.includes(statut)) {
      return NextResponse.json({ error: "ids et statut valides requis" }, { status: 400 });
    }
    const { error } = await supabaseAdmin
      .from("seo_traductions_controles")
      .update({ statut, traite_at: statut === "nouveau" ? null : new Date().toISOString() })
      .in("id", ids.slice(0, 500));
    if (error) throw new Error(error.message);
    return NextResponse.json({ success: true, modifies: Math.min(ids.length, 500) });
  } catch (err) {
    console.error("[api/traductions] PATCH:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
