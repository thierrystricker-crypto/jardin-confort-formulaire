"use client";
// ═══════════════════════════════════════════════════════════════
//  app/dashboard/StatsCards.tsx
//  2 cards compactes côte à côte
//  Calées en hauteur sur 2 lignes (quick-filters + probabilité)
//  Affichent breakdown commercial complet avec barres
// ═══════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import Link from "next/link";

type CommercialRow = {
  commercial: string;
  nb_commandes: number;
  total_qty: number;
  total_montant: number;
};

type SummaryData = {
  period: string;
  totals: { nb_commandes: number; total_qty: number; total_montant: number };
  byCommercial: CommercialRow[];
};

function fmtCHF(n: number) {
  return "CHF\u00a0" + new Intl.NumberFormat("de-CH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function MiniCard({
  title,
  emoji,
  data,
  loading,
  accentBorder,
  accentBg,
  accentText,
}: {
  title: string;
  emoji: string;
  data: SummaryData | null;
  loading: boolean;
  accentBorder: string;
  accentBg: string;
  accentText: string;
}) {
  // Top 3 commerciaux + reste agrégé
  const topRows = data?.byCommercial.slice(0, 3) || [];
  const restRows = data?.byCommercial.slice(3) || [];
  const restTotal = restRows.reduce((s, r) => s + r.total_montant, 0);

  return (
    <div className={`flex flex-col flex-1 min-w-0 rounded-xl border border-white/10 bg-[#2a2d31] border-l-2 ${accentBorder} px-3 py-2.5`}>
      {/* Header : titre + période */}
      <div className="flex items-center justify-between gap-2">
        <span className={`text-[10px] font-bold uppercase tracking-wider ${accentText} whitespace-nowrap`}>
          {emoji} {title}
        </span>
        <span className="text-[9px] italic text-zinc-500 whitespace-nowrap">
          {data?.period || ""}
        </span>
      </div>

      {loading ? (
        <div className="text-xs text-zinc-500 mt-1 flex-1 flex items-center justify-center">Chargement…</div>
      ) : !data ? (
        <div className="text-xs text-rose-400 mt-1 flex-1 flex items-center justify-center">Erreur</div>
      ) : (
        <>
          {/* Montant total + nb cmd/pces */}
          <div className="flex items-baseline justify-between gap-2 mt-0.5">
            <span className="text-lg font-extrabold leading-tight tracking-tight text-zinc-100 whitespace-nowrap">
              {fmtCHF(data.totals.total_montant)}
            </span>
            <span className="text-[10px] text-zinc-400 whitespace-nowrap">
              <span className="font-bold text-zinc-200">{data.totals.nb_commandes}</span> cmd ·{" "}
              <span className="font-bold text-zinc-200">{data.totals.total_qty}</span> p
            </span>
          </div>

          {/* Breakdown par commercial */}
          {data.byCommercial.length > 0 ? (
            <div className="border-t border-white/5 mt-1.5 pt-1.5 space-y-1 flex-1">
              {topRows.map((row) => {
                const pct = data.totals.total_montant > 0
                  ? (row.total_montant / data.totals.total_montant) * 100
                  : 0;
                return (
                  <div key={row.commercial} className="text-[10px]" title={`${row.commercial} · ${row.nb_commandes} cmd · ${row.total_qty} pces`}>
                    <div className="flex items-baseline justify-between gap-2 truncate">
                      <span className="font-semibold text-zinc-200 truncate">
                        {row.commercial}
                      </span>
                      <span className={`font-bold ${accentText} whitespace-nowrap`}>
                        {fmtCHF(row.total_montant)}
                      </span>
                    </div>
                    <div className="h-0.5 mt-0.5 overflow-hidden rounded-full bg-white/5">
                      <div className={`h-full ${accentBg}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
              {restRows.length > 0 && (
                <div className="flex items-baseline justify-between gap-2 text-[9px] text-zinc-500 italic pt-0.5">
                  <span>+ {restRows.length} autre{restRows.length > 1 ? "s" : ""}</span>
                  <span className="whitespace-nowrap">{fmtCHF(restTotal)}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="border-t border-white/5 mt-1.5 pt-2 text-[10px] italic text-zinc-500 text-center flex-1 flex items-center justify-center">
              Aucune commande
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function StatsCards() {
  const [today, setToday] = useState<SummaryData | null>(null);
  const [month, setMonth] = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const [r1, r2] = await Promise.all([
          fetch("/api/stats/summary?period=today").then(r => r.ok ? r.json() : null),
          fetch("/api/stats/summary?period=month").then(r => r.ok ? r.json() : null),
        ]);
        if (cancelled) return;
        setToday(r1);
        setMonth(r2);
      } catch (e) {
        console.error("[StatsCards] erreur:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="flex items-stretch gap-2 flex-1 min-w-0 self-stretch">
      <MiniCard
        title="Chiffre du jour"
        emoji="📅"
        data={today}
        loading={loading}
        accentBorder="border-l-sky-500"
        accentBg="bg-sky-500"
        accentText="text-sky-300"
      />
      <MiniCard
        title="Chiffre du mois"
        emoji="📈"
        data={month}
        loading={loading}
        accentBorder="border-l-emerald-500"
        accentBg="bg-emerald-500"
        accentText="text-emerald-300"
      />
      <Link
        href="/dashboard/statistiques"
        className="flex-shrink-0 inline-flex flex-col items-center justify-center gap-1 rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 text-[11px] font-semibold text-sky-300 transition hover:bg-sky-500/20 whitespace-nowrap"
        title="Voir toutes les statistiques"
      >
        <span className="text-base">📊</span>
        <span>Stats</span>
        <span>→</span>
      </Link>
    </div>
  );
}