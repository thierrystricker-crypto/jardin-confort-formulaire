"use client";
// app/dashboard/notifications/page.tsx
// Centre de notifications — toutes les commandes validées + healthcheck Make

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";

type Notification = {
  id: number;
  type: string;
  offre_slug: string | null;
  numero_affiche: string | null;
  type_document: string | null;
  client_nom: string | null;
  client_prenom: string | null;
  client_societe: string | null;
  commercial: string | null;
  total_ttc: number | null;
  payment_mode: string | null;
  titre: string | null;
  message: string | null;
  vue: boolean;
  vue_at: string | null;
  vue_par: string | null;
  created_at: string;
};

type MakeHealth = {
  status: "healthy" | "warning" | "critical" | "unknown";
  alert: boolean;
  last_ping_at: string | null;
  last_validation_at: string | null;
  last_validation_numero?: string;
  gap_minutes: number | null;
  message: string;
};

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

function fmtMoney(v: number | null) {
  if (v === null || v === undefined) return "—";
  return "CHF\u00a0" + new Intl.NumberFormat("de-CH", { minimumFractionDigits: 2 }).format(v);
}

function getTypeStyle(type: string) {
  switch (type) {
    case "commande_validee":
      return { color: "text-emerald-300", bg: "bg-emerald-500/15", border: "border-emerald-500/30", icon: "✅", label: "Commande validée online" };
    case "commande_directe":
      return { color: "text-sky-300", bg: "bg-sky-500/15", border: "border-sky-500/30", icon: "📋", label: "Commande directe" };
    case "offre_abandonnee":
      return { color: "text-rose-300", bg: "bg-rose-500/15", border: "border-rose-500/30", icon: "❌", label: "Offre abandonnée" };
    default:
      return { color: "text-zinc-300", bg: "bg-white/5", border: "border-white/10", icon: "🔔", label: type };
  }
}

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "unread" | "read">("unread");
  const [makeHealth, setMakeHealth] = useState<MakeHealth | null>(null);
  const [marking, setMarking] = useState(false);

  // Chargement notifications
  const loadNotifications = useCallback(async () => {
    try {
      const res = await fetch(`/api/notifications?status=${filter}&limit=200`);
      if (res.ok) {
        const json = await res.json();
        setNotifications(json.notifications || []);
        setUnreadCount(json.unread_count || 0);
      }
    } catch (e) {
      console.error("Erreur chargement notifs:", e);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  // Chargement healthcheck Make
  const loadMakeHealth = useCallback(async () => {
    try {
      const res = await fetch("/api/make-health");
      if (res.ok) {
        const json = await res.json();
        setMakeHealth(json);
      }
    } catch (e) {
      console.error("Erreur health Make:", e);
    }
  }, []);

  useEffect(() => {
    loadNotifications();
    loadMakeHealth();
    // Auto-refresh toutes les 30s
    const interval = setInterval(() => {
      loadNotifications();
      loadMakeHealth();
    }, 30000);
    return () => clearInterval(interval);
  }, [loadNotifications, loadMakeHealth]);

  // Marquer une notif comme vue
  async function markAsRead(id: number, vue = true) {
    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [id], vue }),
      });
      loadNotifications();
    } catch (e) {
      console.error("Erreur marquage:", e);
    }
  }

  // Marquer toutes comme vues
  async function markAllAsRead() {
    if (!confirm("Marquer toutes les notifications comme vues ?")) return;
    setMarking(true);
    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true, vue: true }),
      });
      loadNotifications();
    } catch (e) {
      console.error("Erreur marquage all:", e);
    } finally {
      setMarking(false);
    }
  }

  const healthBg = makeHealth?.status === "critical" ? "bg-rose-500/15 border-rose-500/40 text-rose-200"
    : makeHealth?.status === "warning" ? "bg-amber-500/15 border-amber-500/40 text-amber-200"
    : makeHealth?.status === "healthy" ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-200"
    : "bg-white/5 border-white/10 text-zinc-400";

  const healthIcon = makeHealth?.status === "critical" ? "🚨"
    : makeHealth?.status === "warning" ? "⚠️"
    : makeHealth?.status === "healthy" ? "✅"
    : "❓";

  return (
    <main className="min-h-screen bg-[#1f2125] px-6 py-8 text-zinc-100">
      <div className="mx-auto max-w-[1400px] space-y-6">

        {/* HEADER */}
        <div className="flex flex-wrap items-center gap-3 justify-between">
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="inline-flex items-center rounded-xl border border-white/10 bg-[#34383d] px-4 py-2 text-sm text-zinc-100 transition hover:bg-[#40454b]">← Dashboard</Link>
            <h1 className="text-2xl font-semibold flex items-center gap-3">
              🔔 Centre de notifications
              {unreadCount > 0 && (
                <span className="inline-flex items-center justify-center rounded-full bg-rose-500/20 border border-rose-500/40 px-3 py-0.5 text-sm font-bold text-rose-300">
                  {unreadCount} non lue{unreadCount > 1 ? "s" : ""}
                </span>
              )}
            </h1>
          </div>
          <button onClick={markAllAsRead} disabled={marking || unreadCount === 0}
            className="rounded-xl border border-white/10 bg-[#34383d] px-4 py-2 text-sm text-zinc-100 hover:bg-[#40454b] disabled:opacity-50">
            ✓ Tout marquer comme lu
          </button>
        </div>

        {/* HEALTHCHECK MAKE */}
        {makeHealth && (
          <div className={`rounded-2xl border px-6 py-4 ${healthBg}`}>
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <div className="flex items-center gap-2 text-base font-semibold">
                  <span className="text-xl">{healthIcon}</span>
                  <span>État du flow Make</span>
                  <span className="text-xs uppercase tracking-wide opacity-80 font-bold">
                    {makeHealth.status === "healthy" ? "OK" :
                     makeHealth.status === "warning" ? "ATTENTION" :
                     makeHealth.status === "critical" ? "PROBLÈME" : "—"}
                  </span>
                </div>
                <div className="mt-2 text-sm opacity-90">{makeHealth.message}</div>
                <div className="mt-1 text-xs opacity-70 space-x-3">
                  {makeHealth.last_ping_at && <span>Dernier ping Make : {fmtRelative(makeHealth.last_ping_at)}</span>}
                  {makeHealth.last_validation_at && <span>· Dernière commande : {fmtRelative(makeHealth.last_validation_at)}</span>}
                </div>
              </div>
              <div className="text-xs opacity-60">
                Auto-refresh 30s
              </div>
            </div>
          </div>
        )}

        {/* FILTRES */}
        <div className="rounded-2xl border border-white/10 bg-[#2a2d31] p-4">
          <div className="flex gap-2">
            {(["unread", "all", "read"] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
                  filter === f
                    ? "bg-[#2B8AD1]/20 text-sky-300 border border-sky-500/40"
                    : "bg-[#34383d] text-zinc-300 border border-white/10 hover:bg-[#40454b]"
                }`}>
                {f === "unread" ? `🔴 Non lues (${unreadCount})` : f === "read" ? "✓ Lues" : "Toutes"}
              </button>
            ))}
          </div>
        </div>

        {/* LISTE */}
        {loading ? (
          <div className="rounded-2xl border border-white/10 bg-[#2a2d31] p-12 text-center text-zinc-400">
            Chargement…
          </div>
        ) : notifications.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-[#2a2d31] p-12 text-center text-zinc-400">
            <div className="text-4xl mb-3">📭</div>
            <div className="text-lg font-medium mb-1">Aucune notification {filter === "unread" ? "non lue" : filter === "read" ? "lue" : ""}</div>
            <div className="text-sm">Toutes les nouvelles commandes validées apparaîtront ici.</div>
          </div>
        ) : (
          <div className="space-y-3">
            {notifications.map(n => {
              const style = getTypeStyle(n.type);
              const nomComplet = [n.client_prenom, n.client_nom].filter(Boolean).join(" ") || "—";

              return (
                <div key={n.id}
                  className={`rounded-2xl border p-5 transition ${n.vue
                    ? "border-white/10 bg-[#2a2d31]/60 opacity-70"
                    : "border-white/15 bg-[#2a2d31] shadow-lg"}`}>
                  <div className="flex items-start gap-4 flex-wrap">
                    {/* Icône type */}
                    <div className={`text-3xl flex-shrink-0 rounded-xl border p-3 ${style.bg} ${style.border}`}>
                      {style.icon}
                    </div>

                    {/* Contenu */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${style.bg} ${style.color}`}>
                          {style.label}
                        </span>
                        {n.numero_affiche && (
                          <span className="text-sm font-bold text-zinc-100">{n.numero_affiche}</span>
                        )}
                        {!n.vue && (
                          <span className="inline-flex items-center rounded-full bg-rose-500/20 border border-rose-500/40 px-2 py-0.5 text-[10px] font-bold uppercase text-rose-300">
                            Nouveau
                          </span>
                        )}
                      </div>

                      <div className="text-base font-semibold text-zinc-100 mb-1">
                        {n.titre || `Commande ${n.numero_affiche}`}
                      </div>

                      <div className="text-sm text-zinc-400 space-y-1">
                        <div>👤 <strong>{nomComplet}</strong>{n.client_societe && <span> · {n.client_societe}</span>}</div>
                        {n.commercial && <div>🧑‍💼 Commercial : {n.commercial}</div>}
                        {n.total_ttc !== null && (
                          <div>💰 Total : <strong className="text-zinc-200">{fmtMoney(n.total_ttc)}</strong>{n.payment_mode && <span className="text-zinc-500"> · {n.payment_mode}</span>}</div>
                        )}
                      </div>

                      <div className="text-xs text-zinc-500 mt-2 space-x-2">
                        <span>📅 {fmtDateTime(n.created_at)}</span>
                        <span>·</span>
                        <span>{fmtRelative(n.created_at)}</span>
                        {n.vue && n.vue_par && (
                          <>
                            <span>·</span>
                            <span>✓ Lu par {n.vue_par} {n.vue_at && `(${fmtRelative(n.vue_at)})`}</span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-col gap-2 flex-shrink-0">
                      {n.offre_slug && (
                        <Link href={`/dashboard/${n.offre_slug}`}
                          className="rounded-xl border border-sky-500/40 bg-sky-500/15 px-4 py-2 text-sm text-sky-300 text-center hover:bg-sky-500/25 transition">
                          Ouvrir →
                        </Link>
                      )}
                      <button onClick={() => markAsRead(n.id, !n.vue)}
                        className="rounded-xl border border-white/10 bg-[#34383d] px-4 py-2 text-sm text-zinc-300 hover:bg-[#40454b] transition">
                        {n.vue ? "↩ Marquer non lu" : "✓ Marquer lu"}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

      </div>
    </main>
  );
}