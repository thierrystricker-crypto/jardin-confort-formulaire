"use client";
// app/dashboard/stock-movements/page.tsx
// Vue globale des mouvements de stock — utile pour audit + débogage

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";

type StockMovement = {
  id: number;
  offre_slug: string;
  numero_affiche: string | null;
  sku: string;
  product_title: string | null;
  variant_id: string | null;
  inventory_item_id: string | null;
  quantity_change: number;
  quantity_before: number | null;
  quantity_after: number | null;
  reason: string;
  status: "pending" | "completed" | "failed" | "skipped" | "skipped_not_shopify";
  error_message: string | null;
  created_at: string;
  executed_at: string | null;
};

type Stats = { total: number; completed: number; failed: number; skippedNotShopify: number };

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("fr-CH", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function fmtRelative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24);
  return `il y a ${d} j`;
}

function getStatusStyle(status: string) {
  switch (status) {
    case "completed": return { bg: "bg-emerald-500/15", text: "text-emerald-300", border: "border-emerald-500/30", icon: "✅", label: "OK" };
    case "failed": return { bg: "bg-rose-500/15", text: "text-rose-300", border: "border-rose-500/30", icon: "❌", label: "Erreur" };
    case "pending": return { bg: "bg-amber-500/15", text: "text-amber-300", border: "border-amber-500/30", icon: "⏳", label: "En cours" };
    case "skipped": return { bg: "bg-zinc-500/15", text: "text-zinc-400", border: "border-zinc-500/30", icon: "⏭", label: "Ignoré" };
    case "skipped_not_shopify": return { bg: "bg-violet-500/15", text: "text-violet-300", border: "border-violet-500/30", icon: "📝", label: "À la volée" };
    default: return { bg: "bg-white/5", text: "text-zinc-300", border: "border-white/10", icon: "•", label: status };
  }
}

export default function StockMovementsPage() {
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [stats, setStats] = useState<Stats>({ total: 0, completed: 0, failed: 0, skippedNotShopify: 0 });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "completed" | "failed" | "pending" | "skipped_not_shopify">("all");

  const load = useCallback(async () => {
    try {
      const url = filter === "all" ? "/api/stock-movements" : `/api/stock-movements?status=${filter}`;
      const res = await fetch(url);
      if (res.ok) {
        const json = await res.json();
        setMovements(json.movements || []);
        setStats(json.stats || { total: 0, completed: 0, failed: 0, skippedNotShopify: 0 });
      }
    } catch (e) {
      console.error("Stock movements error:", e);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [load]);

  return (
    <main className="min-h-screen bg-[#1f2125] px-6 py-8 text-zinc-100">
      <div className="mx-auto max-w-[1400px] space-y-6">

        {/* HEADER */}
        <div className="flex flex-wrap items-center gap-3 justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/dashboard" className="inline-flex items-center rounded-xl border border-white/10 bg-[#34383d] px-4 py-2 text-sm text-zinc-100 transition hover:bg-[#40454b]">← Dashboard</Link>
            <div>
              <h1 className="text-2xl font-semibold flex items-center gap-3">
                📦 Sorties de stock Shopify (automatiques)
              </h1>
              <p className="mt-1 text-sm text-zinc-400">
                Décréments écrits par l&apos;app à la validation d&apos;une commande ou à l&apos;ajout d&apos;une révision. L&apos;app ne fait jamais d&apos;incrément.{" "}
                <Link href="/dashboard/stock-remises" className="text-sky-300 hover:underline">→ Retours à remettre en stock</Link>
              </p>
            </div>
          </div>
        </div>

        {/* STATS */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-white/10 bg-[#2a2d31] p-5">
            <div className="text-sm text-zinc-400">Total mouvements</div>
            <div className="mt-2 text-3xl font-semibold">{stats.total}</div>
          </div>
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-5">
            <div className="text-sm text-emerald-300/70">✅ Réussis</div>
            <div className="mt-2 text-3xl font-semibold text-emerald-300">{stats.completed}</div>
          </div>
          <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-5">
            <div className="text-sm text-rose-300/70">❌ En erreur</div>
            <div className="mt-2 text-3xl font-semibold text-rose-300">{stats.failed}</div>
          </div>
          <div className="rounded-2xl border border-violet-500/20 bg-violet-500/5 p-5">
            <div className="text-sm text-violet-300/70">📝 À la volée (hors-Shopify)</div>
            <div className="mt-2 text-3xl font-semibold text-violet-300">{stats.skippedNotShopify}</div>
          </div>
        </div>

        {/* FILTRES */}
        <div className="rounded-2xl border border-white/10 bg-[#2a2d31] p-4">
          <div className="flex gap-2 flex-wrap">
            {(["all", "completed", "failed", "pending", "skipped_not_shopify"] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
                  filter === f
                    ? "bg-[#2B8AD1]/20 text-sky-300 border border-sky-500/40"
                    : "bg-[#34383d] text-zinc-300 border border-white/10 hover:bg-[#40454b]"
                }`}>
                {f === "all" ? "Tous" : f === "completed" ? "✅ Réussis" : f === "failed" ? "❌ Erreurs" : f === "pending" ? "⏳ En cours" : "📝 À la volée"}
              </button>
            ))}
          </div>
        </div>

        {/* LISTE */}
        {loading ? (
          <div className="rounded-2xl border border-white/10 bg-[#2a2d31] p-12 text-center text-zinc-400">
            Chargement…
          </div>
        ) : movements.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-[#2a2d31] p-12 text-center text-zinc-400">
            <div className="text-4xl mb-3">📦</div>
            <div className="text-lg font-medium mb-1">Aucun mouvement</div>
            <div className="text-sm">Les sorties de stock apparaîtront ici à la création de chaque commande.</div>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#2a2d31]">
            <table className="w-full text-sm">
              <thead className="bg-black/10 text-left text-zinc-400">
                <tr>
                  <th className="px-4 py-3 font-medium">Statut</th>
                  <th className="px-4 py-3 font-medium">Commande</th>
                  <th className="px-4 py-3 font-medium">SKU</th>
                  <th className="px-4 py-3 font-medium">Article</th>
                  <th className="px-4 py-3 font-medium text-center">Qté</th>
                  <th className="px-4 py-3 font-medium text-center">Stock</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((m, idx) => {
                  const style = getStatusStyle(m.status);
                  return (
                    <tr key={m.id} className={`border-t border-white/5 ${idx % 2 === 0 ? "bg-white/[0.02]" : ""}`}>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${style.bg} ${style.text} ${style.border} border`}>
                          {style.icon} {style.label}
                        </span>
                        {m.status === "failed" && m.error_message && (
                          <div className="mt-1 text-[10px] text-rose-400/80 max-w-[200px] truncate" title={m.error_message}>
                            {m.error_message}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Link href={`/dashboard/${m.offre_slug}`}
                          className="font-bold text-zinc-100 hover:text-sky-300 transition">
                          {m.numero_affiche || m.offre_slug}
                        </Link>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-zinc-300">{m.sku}</td>
                      <td className="px-4 py-3 text-zinc-300">{m.product_title || "—"}</td>
                      <td className="px-4 py-3 text-center font-semibold text-rose-300">
                        {m.quantity_change}
                      </td>
                      <td className="px-4 py-3 text-center text-xs text-zinc-400">
                        {m.quantity_before !== null && m.quantity_after !== null ? (
                          <span>{m.quantity_before} → <strong className="text-zinc-200">{m.quantity_after}</strong></span>
                        ) : "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-zinc-500">
                        <div>{fmtDateTime(m.created_at)}</div>
                        <div className="text-[10px]">{fmtRelative(m.created_at)}</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

      </div>
    </main>
  );
}