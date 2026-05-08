import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function getCurrentExercice(date = new Date()) {
  const month = date.getMonth();
  const year = date.getFullYear();
  const startYear = month >= 9 ? year : year - 1;
  return {
    label: `${startYear}-${(startYear + 1).toString().slice(2)}`,
    start: new Date(startYear, 9, 1),
    end:   new Date(startYear + 1, 9, 1),
  };
}

function resolvePeriod(period: string, from?: string | null, to?: string | null) {
  const now = new Date();

  if (period === "today") {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, end, label: "Aujourd'hui" };
  }
  if (period === "month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end   = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return { start, end, label: "Ce mois" };
  }
  if (period === "year") {
    const start = new Date(now.getFullYear(), 0, 1);
    const end   = new Date(now.getFullYear() + 1, 0, 1);
    return { start, end, label: `Année ${now.getFullYear()}` };
  }
  if (period === "exercice") {
    const ex = getCurrentExercice(now);
    return { start: ex.start, end: ex.end, label: `Exercice ${ex.label}` };
  }
  if (period === "custom" && from && to) {
    return { start: new Date(from), end: new Date(to), label: `${from} → ${to}` };
  }
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end   = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { start, end, label: "Ce mois" };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const period = searchParams.get("period") || "month";
  const from   = searchParams.get("from");
  const to     = searchParams.get("to");

  const { start, end, label } = resolvePeriod(period, from, to);

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const { data, error } = await supabase.rpc("stats_commandes_periode", {
    date_from: start.toISOString(),
    date_to:   end.toISOString(),
  });

  if (error) {
    console.error("[stats/summary] RPC error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  type Row = {
    commercial: string;
    nb_commandes: number;
    total_qty: number;
    total_montant: number;
  };

  const rows: Row[] = (data || []).map((r: Row) => ({
    // Réhabilite le label stylé côté client
    commercial: r.commercial === "Non assigne" ? "— Non assigné" : r.commercial,
    nb_commandes: Number(r.nb_commandes) || 0,
    total_qty:    Number(r.total_qty)    || 0,
    total_montant: Number(r.total_montant) || 0,
  }));

  const totals = rows.reduce(
    (acc, r) => ({
      nb_commandes: acc.nb_commandes + r.nb_commandes,
      total_qty:    acc.total_qty    + r.total_qty,
      total_montant: acc.total_montant + r.total_montant,
    }),
    { nb_commandes: 0, total_qty: 0, total_montant: 0 }
  );

  return NextResponse.json({
    period: label,
    from: start.toISOString(),
    to:   end.toISOString(),
    totals,
    byCommercial: rows,
  });
}