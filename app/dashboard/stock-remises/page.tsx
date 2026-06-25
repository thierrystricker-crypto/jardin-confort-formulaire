"use client";
// app/dashboard/stock-remises/page.tsx
// Remise en stock — supervision des articles retirés d'une commande révisée.
//
// L'app ne fait JAMAIS l'incrémentation Shopify. Cette page liste ce qui peut
// devoir revenir en stock, donne le lien direct vers l'inventaire Shopify pour
// que le responsable juge sur le stock réel, et permet de MARQUER chaque ligne
// comme « Remis en stock » ou « Ignoré ».

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";

type Remise = {
  id: number;
  commande_slug: string;
  numero_affiche: string | null;
  version_num: number | null;
  sku: string;
  product_title: string | null;
  quantity: number;
  inventory_policy: string | null;
  is_shopify: boolean;
  status: "a_remettre" | "remis" | "ignore";
  retire_par: string | null;
  traite_par: string | null;
  created_at: string;
  traite_at: string | null;
  stock_live: number | null;
  shopify_link: string | null;
};

type Stats = { a_remettre: number; remis: number; ignore: number };

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("fr-CH", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function StockRemisesPage() {
  const [remises, setRemises] = useState<Remise[]>([]);
  const [stats, setStats] = useState<Stats>({ a_remettre: 0, remis: 0, ignore: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [filter, setFilter] = useState<"a_remettre" | "remis" | "ignore" | "all">("a_remettre");
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const qs = filter === "all" ? "" : `?status=${filter}`;
      const res = await fetch(`/api/stock-remises${qs}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Erreur ${res.status}`);
      setRemises(json.remises || []);
      setStats(json.stats || { a_remettre: 0, remis: 0, ignore: 0 });
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  async function marquer(id: number, status: "remis" | "ignore") {
    const verbe = status === "remis" ? "marquer comme remis en stock" : "ignorer";
    if (!confirm(`Confirmer : ${verbe} cette ligne ?\n\nRappel : l'app ne touche pas Shopify. La remise en stock (+) se fait à la main dans le back-office.`)) return;
    setBusyId(id);
    try {
      const author = (typeof window !== "undefined" && localStorage.getItem("corrections-author")) || "";
      const res = await fetch("/api/stock-remises", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status, traite_par: author }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Erreur ${res.status}`);
      await load();
    } catch (e) {
      alert(String(e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 text-zinc-100">
      <div className="mb-6 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Remise en stock</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Articles retirés d&apos;une commande révisée. L&apos;app ne remet jamais en stock automatiquement :
            ouvre le lien Shopify pour réintégrer à la main, puis marque la ligne.
          </p>
        </div>
        <Link href="/dashboard" className="rounded-xl border border-white/10 bg-[#34383d] px-4 py-2 text-sm text-zinc-200 transition hover:bg-[#40454b]">
          ← Dashboard
        </Link>
      </div>

      {/* KPIs */}
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <button onClick={() => setFilter("a_remettre")}
          className={`rounded-2xl border p-5 text-left transition ${filter === "a_remettre" ? "border-amber-500/50 bg-amber-500/10" : "border-amber-500/20 bg-amber-500/5 hover:bg-amber-500/10"}`}>
          <div className="text-sm text-amber-300/70">📦 À remettre en stock</div>
          <div className="mt-2 text-3xl font-semibold text-amber-300">{stats.a_remettre}</div>
        </button>
        <button onClick={() => setFilter("remis")}
          className={`rounded-2xl border p-5 text-left transition ${filter === "remis" ? "border-emerald-500/50 bg-emerald-500/10" : "border-emerald-500/20 bg-emerald-500/5 hover:bg-emerald-500/10"}`}>
          <div className="text-sm text-emerald-300/70">✅ Remis en stock</div>
          <div className="mt-2 text-3xl font-semibold text-emerald-300">{stats.remis}</div>
        </button>
        <button onClick={() => setFilter("ignore")}
          className={`rounded-2xl border p-5 text-left transition ${filter === "ignore" ? "border-zinc-400/50 bg-zinc-500/10" : "border-zinc-500/20 bg-zinc-500/5 hover:bg-zinc-500/10"}`}>
          <div className="text-sm text-zinc-400">🚫 Ignorés</div>
          <div className="mt-2 text-3xl font-semibold text-zinc-300">{stats.ignore}</div>
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>
      )}

      {loading ? (
        <div className="rounded-2xl border border-white/10 bg-[#2a2d31] p-8 text-center text-zinc-400">Chargement…</div>
      ) : remises.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-[#2a2d31] p-8 text-center text-zinc-400">
          Aucune ligne {filter === "a_remettre" ? "à remettre en stock" : filter === "remis" ? "remise" : filter === "ignore" ? "ignorée" : ""}.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#2a2d31]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-zinc-400">
                <th className="px-4 py-3 font-medium">Article</th>
                <th className="px-4 py-3 font-medium">Commande</th>
                <th className="px-4 py-3 text-center font-medium">Qté</th>
                <th className="px-4 py-3 text-center font-medium">Stock Shopify</th>
                <th className="px-4 py-3 font-medium">Retiré le</th>
                <th className="px-4 py-3 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {remises.map((r) => (
                <tr key={r.id} className="border-b border-white/5 last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium text-zinc-100">{r.product_title || "(sans titre)"}</div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-zinc-500">
                      <span>SKU : {r.sku || "—"}</span>
                      {r.is_shopify ? (
                        <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-sky-300 border border-sky-500/30">Shopify</span>
                      ) : (
                        <span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-violet-300 border border-violet-500/30">À la volée</span>
                      )}
                      {r.inventory_policy === "DENY" && (
                        <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-rose-300 border border-rose-500/30">🔒 Non-réassort.</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/dashboard/${r.commande_slug}`} className="text-sky-300 hover:underline">
                      {r.numero_affiche || r.commande_slug}
                    </Link>
                    {r.version_num != null && <span className="ml-1 text-xs text-zinc-500">· V{r.version_num}</span>}
                  </td>
                  <td className="px-4 py-3 text-center font-semibold">{r.quantity}</td>
                  <td className="px-4 py-3 text-center">
                    {r.is_shopify ? (
                      <span className={r.stock_live != null && r.stock_live < 0 ? "text-rose-300" : "text-zinc-300"}>
                        {r.stock_live != null ? r.stock_live : "—"}
                      </span>
                    ) : (
                      <span className="text-zinc-600">n/a</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-zinc-400">{fmtDateTime(r.created_at)}</td>
                  <td className="px-4 py-3">
                    {r.status === "a_remettre" ? (
                      <div className="flex items-center justify-end gap-2">
                        {r.shopify_link && (
                          <a href={r.shopify_link} target="_blank" rel="noopener noreferrer"
                            className="rounded-lg border border-sky-500/30 bg-sky-500/15 px-3 py-1.5 text-xs text-sky-300 transition hover:bg-sky-500/25">
                            Ouvrir Shopify ↗
                          </a>
                        )}
                        <button disabled={busyId === r.id} onClick={() => marquer(r.id, "remis")}
                          className="rounded-lg border border-emerald-500/30 bg-emerald-500/15 px-3 py-1.5 text-xs text-emerald-300 transition hover:bg-emerald-500/25 disabled:opacity-50">
                          ✅ Remis
                        </button>
                        <button disabled={busyId === r.id} onClick={() => marquer(r.id, "ignore")}
                          className="rounded-lg border border-zinc-500/30 bg-zinc-500/15 px-3 py-1.5 text-xs text-zinc-300 transition hover:bg-zinc-500/25 disabled:opacity-50">
                          🚫 Ignorer
                        </button>
                      </div>
                    ) : (
                      <div className="text-right text-xs text-zinc-500">
                        {r.status === "remis" ? "✅ Remis" : "🚫 Ignoré"}
                        {r.traite_par ? ` · ${r.traite_par}` : ""}
                        {r.traite_at ? ` · ${fmtDateTime(r.traite_at)}` : ""}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}