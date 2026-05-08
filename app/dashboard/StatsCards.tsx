"use client";
// ═══════════════════════════════════════════════════════════════
//  app/dashboard/StatsCards.tsx
//  Cards "Chiffre du jour" + "Chiffre du mois" en haut du dashboard
//  Dark theme assorti au dashboard Jardin-Confort
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

function formatCHF(n: number) {
  return new Intl.NumberFormat("fr-CH", {
    style: "currency",
    currency: "CHF",
    maximumFractionDigits: 0,
  }).format(n);
}

function StatCard({
  title,
  emoji,
  data,
  loading,
  accentClass,
  accentBg,
}: {
  title: string;
  emoji: string;
  data: SummaryData | null;
  loading: boolean;
  accentClass: string;     // tailwind border-t color class (e.g. "border-t-sky-500")
  accentBg: string;        // tailwind bg color class for progress bars
}) {
  return (
    <div className={`flex-1 min-w-[280px] rounded-2xl border border-white/10 bg-[#2a2d31] border-t-4 ${accentClass} p-5`}>
      <div className="mb-2 flex items-baseline justify-between">
        <div className="text-xs font-bold uppercase tracking-wider text-zinc-400">
          {emoji} {title}
        </div>
        {data && (
          <div className="text-[11px] italic text-zinc-500">
            {data.period}
          </div>
        )}
      </div>

      {loading ? (
        <div className="py-5 text-center text-sm text-zinc-500">Chargement…</div>
      ) : !data ? (
        <div className="py-5 text-center text-sm text-rose-400">Erreur de chargement</div>
      ) : (
        <>
          <div className="mb-1 text-3xl font-extrabold leading-tight tracking-tight text-zinc-100">
            {formatCHF(data.totals.total_montant)}
          </div>
          <div className="mb-3 text-xs text-zinc-400">
            <span className="font-bold text-zinc-200">{data.totals.nb_commandes}</span> commande{data.totals.nb_commandes > 1 ? "s" : ""}
            {" · "}
            <span className="font-bold text-zinc-200">{data.totals.total_qty}</span> pce{data.totals.total_qty > 1 ? "s" : ""}
          </div>

          {data.byCommercial.length > 0 ? (
            <div className="border-t border-white/5 pt-3">
              <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                Par commercial
              </div>
              <div className="space-y-2">
                {data.byCommercial.map((row) => {
                  const pct = data.totals.total_montant > 0
                    ? (row.total_montant / data.totals.total_montant) * 100
                    : 0;
                  return (
                    <div key={row.commercial} className="text-xs">
                      <div className="mb-1 flex items-baseline justify-between gap-2">
                        <span className="truncate font-semibold text-zinc-200">
                          {row.commercial}
                        </span>
                        <span className="whitespace-nowrap font-bold text-zinc-100">
                          {formatCHF(row.total_montant)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/5">
                          <div
                            className={`h-full ${accentBg} transition-all`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="min-w-[80px] whitespace-nowrap text-right text-[10px] text-zinc-500">
                          {row.nb_commandes} cmd · {row.total_qty} pce{row.total_qty > 1 ? "s" : ""}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="border-t border-white/5 pt-3 text-center text-xs italic text-zinc-500">
              Aucune commande sur cette période
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
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-400">
          📊 Activité commerciale
        </h2>
        <Link
          href="/dashboard/statistiques"
          className="inline-flex items-center gap-1 rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-xs font-semibold text-sky-300 transition hover:bg-sky-500/20"
        >
          Voir toutes les statistiques →
        </Link>
      </div>
      <div className="flex flex-wrap gap-4">
        <StatCard
          title="Chiffre du jour"
          emoji="📅"
          data={today}
          loading={loading}
          accentClass="border-t-sky-500"
          accentBg="bg-sky-500"
        />
        <StatCard
          title="Chiffre du mois"
          emoji="📈"
          data={month}
          loading={loading}
          accentClass="border-t-emerald-500"
          accentBg="bg-emerald-500"
        />
      </div>
    </div>
  );
}