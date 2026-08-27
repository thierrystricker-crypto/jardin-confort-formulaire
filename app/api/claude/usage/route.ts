// app/api/claude/usage/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// Statistiques d'utilisation de Jardi (27.08.2026) — panneau 📊 du chat.
//
// GET /api/claude/usage?jours=30 → résumé de la RPC `jardi_usage_resume`
// (totaux période + aujourd'hui, par auteur, par jour, par source) enrichi
// d'un coût ESTIMÉ (tarifs CLAUDE_PRIX_ENTREE / CLAUDE_PRIX_SORTIE en USD par
// million de tokens, défaut 3 / 15). La facture qui fait foi reste la console
// Anthropic. Table alimentée depuis le 27.08.2026 : rien avant.
//
// Route INTERNE : proxy.ts + revérification du cookie de session.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { coutUsd, tarifs } from "@/lib/jardi-usage";

type Totaux = {
  requetes: number;
  entree: number;
  sortie: number;
  cache_lecture: number;
  cache_creation: number;
  outils?: number;
  duree_moy_ms?: number;
};

type Resume = {
  periode_jours: number;
  depuis: string | null;
  total: Totaux;
  aujourdhui: Totaux;
  par_auteur: (Totaux & { auteur: string | null })[];
  par_jour: (Totaux & { jour: string })[];
  par_source: (Totaux & { source: string })[];
};

function sessionValide(req: NextRequest): boolean {
  const secret = process.env.DASHBOARD_SESSION_SECRET;
  const cookie = req.cookies.get("jc_acces")?.value;
  return Boolean(secret && cookie === secret);
}

function avecCout<T extends Totaux>(t: T): T & { cout_usd: number } {
  return { ...t, cout_usd: Math.round(coutUsd(t) * 10000) / 10000 };
}

export async function GET(req: NextRequest) {
  if (!sessionValide(req)) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 401 });
  }
  const joursBruts = Number(req.nextUrl.searchParams.get("jours"));
  const jours = Number.isFinite(joursBruts) && joursBruts > 0 ? Math.min(joursBruts, 365) : 30;

  const { data, error } = await supabaseAdmin.rpc("jardi_usage_resume", { p_jours: jours });
  if (error || !data) {
    console.error("jardi_usage_resume :", error);
    return NextResponse.json({ error: "Erreur base de données" }, { status: 500 });
  }
  const r = data as Resume;
  return NextResponse.json({
    periode_jours: r.periode_jours,
    depuis: r.depuis,
    tarifs: tarifs(),
    total: avecCout(r.total),
    aujourdhui: avecCout(r.aujourdhui),
    par_auteur: (r.par_auteur ?? []).map(avecCout),
    par_jour: (r.par_jour ?? []).map(avecCout),
    par_source: (r.par_source ?? []).map(avecCout),
  });
}
