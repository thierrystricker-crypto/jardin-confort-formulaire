"use client";
// ═══════════════════════════════════════════════════════════════
//  app/dashboard/StatsCards.tsx
//  2 mini-cards compactes côte à côte
//  Conçues pour s'intégrer à droite des boutons de filtres rapides
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
  const top = data?.byCommercial[0];
  const rest = data?.byCommercial.slice(1) || [];
  const restCount = rest.length;
  const pct = top && data && data.totals.total_montant > 0
    ? (top.total_montant / data.totals.total_montant) * 100
    : 0;

  return (
    <div className={`flex-1 min-w-0 rounded-xl border border-white/10 bg-[#2a2d31] border-l-2 ${accentBorder} px-3 py-2`}>
      <div className="flex items-center justify-between gap-2">
        <span className={`text-[9px] font-bold uppercase tracking-wider ${accentText} whitespace-nowrap`}>
          {emoji} {title}
        </span>
        <span className="text-[9px] italic text-zinc-500 whitespace-nowrap">
          {data?.period || ""}
        </span>
      </div>

      {loading ? (
        <div className="text-xs text-zinc-500 mt-0.5">Chargement…</div>
      ) : !data ? (
        <div className="text-xs text-rose-400 mt-0.5">Erreur</div>
      ) : (
        <>
          <div className="flex items-baseline justify-between gap-2 mt-0.5">
            <span className="text-base font-extrabold leading-none tracking-tight text-zinc-100 whitespace-nowrap">
              {fmtCHF(data.totals.total_montant)}
            </span>
            <span className="text-[10px] text-zinc-400 whitespace-nowrap">
              <span className="font-bold text-zinc-200">{data.totals.nb_commandes}</span> cmd ·{" "}
              <span className="font-bold text-zinc-200">{data.totals.total_qty}</span> p
            </span>
          </div>

          {top && (
            <div className="mt-1 text-[10px]" title={`${top.commercial} · ${top.nb_commandes} cmd · ${top.total_qty} pces${restCount > 0 ? ` · + ${restCount} autre${restCount > 1 ? "s" : ""}` : ""}`}>
              <div className="flex items-baseline justify-between gap-2 truncate">
                <span className="font-semibold text-zinc-300 truncate">
                  {top.commercial}
                  {restCount > 0 && <span className="text-zinc-500 italic font-normal"> +{restCount}</span>}
                </span>
                <span className={`font-bold ${accentText} whitespace-nowrap`}>
                  {fmtCHF(top.total_montant)}
                </span>
              </div>
              <div className="h-0.5 mt-0.5 overflow-hidden rounded-full bg-white/5">
                <div className={`h-full ${accentBg}`} style={{ width: `${pct}%` }} />
              </div>
            </div>
          )}

          {data.byCommercial.length === 0 && (
            <div className="text-[10px] italic text-zinc-500 mt-1">Aucune commande</div>
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
    <div className="flex items-stretch gap-2 flex-1 min-w-0">
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
        className="flex-shrink-0 inline-flex items-center justify-center gap-1 rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 text-[11px] font-semibold text-sky-300 transition hover:bg-sky-500/20 whitespace-nowrap"
        title="Voir toutes les statistiques"
      >
        📊 →
      </Link>
    </div>
  );
}