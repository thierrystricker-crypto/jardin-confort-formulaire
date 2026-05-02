"use client";
// components/StockMovementsBlock.tsx
// Bloc à inclure dans /dashboard/[slug] pour afficher les mouvements de stock
// de la commande en cours.
//
// Usage :
//   import StockMovementsBlock from "@/components/StockMovementsBlock"
//   {isCommande && <StockMovementsBlock slug={slug} />}

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";

type StockMovement = {
  id: number;
  sku: string;
  product_title: string | null;
  quantity_change: number;
  quantity_before: number | null;
  quantity_after: number | null;
  status: "pending" | "completed" | "failed" | "skipped";
  error_message: string | null;
  created_at: string;
  executed_at: string | null;
};

function getStatusStyle(status: string) {
  switch (status) {
    case "completed": return { bg: "bg-emerald-500/15", text: "text-emerald-300", border: "border-emerald-500/30", icon: "✅", label: "OK" };
    case "failed": return { bg: "bg-rose-500/15", text: "text-rose-300", border: "border-rose-500/30", icon: "❌", label: "Erreur" };
    case "pending": return { bg: "bg-amber-500/15", text: "text-amber-300", border: "border-amber-500/30", icon: "⏳", label: "En cours" };
    case "skipped": return { bg: "bg-zinc-500/15", text: "text-zinc-400", border: "border-zinc-500/30", icon: "⏭", label: "Ignoré" };
    default: return { bg: "bg-white/5", text: "text-zinc-300", border: "border-white/10", icon: "•", label: status };
  }
}

export default function StockMovementsBlock({ slug }: { slug: string }) {
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/stock-movements?offre_slug=${slug}`);
      if (res.ok) {
        const json = await res.json();
        setMovements(json.movements || []);
      }
    } catch (e) {
      console.error("Stock movements error:", e);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    load();
    // Auto-refresh toutes les 15s pendant 2min après ouverture
    // (utile si on arrive sur la page juste après création de commande)
    const interval = setInterval(load, 15000);
    setTimeout(() => clearInterval(interval), 120000);
    return () => clearInterval(interval);
  }, [load]);

  // ── Action : retraiter / réessayer la sortie de stock ──
  async function handleRetry() {
    if (!confirm("Relancer la sortie de stock pour les articles non encore traités ?")) return;
    setRetrying(true);
    try {
      const res = await fetch("/api/stock-movements/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offre_slug: slug, reason: "manual" }),
      });
      const json = await res.json();
      if (json.success) {
        alert(`✅ ${json.summary.completed} OK · ${json.summary.skipped} ignorés · ${json.summary.failed} erreurs`);
      } else {
        alert(`⚠️ ${json.summary?.failed || 0} en erreur. Voir le détail ci-dessous.`);
      }
      load();
    } catch (e) {
      alert("Erreur : " + (e as Error).message);
    } finally {
      setRetrying(false);
    }
  }

  if (loading) {
    return (
      <section className="rounded-2xl border border-white/10 bg-[#2a2d31] p-6">
        <h2 className="text-xl font-semibold mb-3">📦 Mouvements de stock</h2>
        <div className="text-sm text-zinc-500">Chargement…</div>
      </section>
    );
  }

  if (movements.length === 0) {
    return (
      <section className="rounded-2xl border border-white/10 bg-[#2a2d31] p-6">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h2 className="text-xl font-semibold">📦 Mouvements de stock</h2>
          <button onClick={handleRetry} disabled={retrying}
            className="rounded-xl border border-amber-500/30 bg-amber-500/15 px-3 py-1.5 text-xs text-amber-300 hover:bg-amber-500/25 disabled:opacity-50">
            {retrying ? "⏳ Traitement…" : "🔄 Lancer la sortie de stock"}
          </button>
        </div>
        <div className="text-sm text-zinc-500 italic">
          Aucun mouvement de stock enregistré. La sortie automatique se fait normalement à la création.
        </div>
      </section>
    );
  }

  const completed = movements.filter(m => m.status === "completed").length;
  const failed = movements.filter(m => m.status === "failed").length;

  return (
    <section className="rounded-2xl border border-white/10 bg-[#2a2d31] p-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          📦 Mouvements de stock
          <span className="text-xs font-normal text-zinc-400">
            ({completed} OK{failed > 0 && <span className="text-rose-400"> · {failed} erreur{failed > 1 ? "s" : ""}</span>})
          </span>
        </h2>
        <div className="flex gap-2">
          {failed > 0 && (
            <button onClick={handleRetry} disabled={retrying}
              className="rounded-xl border border-amber-500/30 bg-amber-500/15 px-3 py-1.5 text-xs text-amber-300 hover:bg-amber-500/25 disabled:opacity-50">
              {retrying ? "⏳ Retry…" : "🔄 Réessayer les erreurs"}
            </button>
          )}
          <Link href="/dashboard/stock-movements"
            className="rounded-xl border border-white/10 bg-[#34383d] px-3 py-1.5 text-xs text-zinc-300 hover:bg-[#40454b]">
            Voir tout
          </Link>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-white/10">
        <table className="w-full text-sm">
          <thead className="bg-black/20 text-left text-xs text-zinc-400 uppercase">
            <tr>
              <th className="px-3 py-2">Statut</th>
              <th className="px-3 py-2">SKU</th>
              <th className="px-3 py-2">Article</th>
              <th className="px-3 py-2 text-center">Qté</th>
              <th className="px-3 py-2 text-center">Stock</th>
            </tr>
          </thead>
          <tbody>
            {movements.map((m, idx) => {
              const style = getStatusStyle(m.status);
              return (
                <tr key={m.id} className={`border-t border-white/5 ${idx % 2 === 0 ? "bg-white/[0.02]" : ""}`}>
                  <td className="px-3 py-2">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${style.bg} ${style.text} ${style.border} border`}>
                      {style.icon} {style.label}
                    </span>
                    {m.status === "failed" && m.error_message && (
                      <div className="mt-1 text-[10px] text-rose-400/80 max-w-[180px]" title={m.error_message}>
                        {m.error_message}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-zinc-300">{m.sku}</td>
                  <td className="px-3 py-2 text-zinc-300 text-xs">{m.product_title || "—"}</td>
                  <td className="px-3 py-2 text-center text-rose-300 font-semibold">{m.quantity_change}</td>
                  <td className="px-3 py-2 text-center text-xs text-zinc-400">
                    {m.quantity_before !== null && m.quantity_after !== null ? (
                      <span>{m.quantity_before} → <strong className="text-zinc-200">{m.quantity_after}</strong></span>
                    ) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}