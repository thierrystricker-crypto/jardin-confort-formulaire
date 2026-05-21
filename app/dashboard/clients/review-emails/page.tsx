"use client"
// app/dashboard/clients/review-emails/page.tsx
//
// Page de revue dédiée : liste tous les clients avec email_status='auto_thunderbird'
// (ou autres statuts à valider) pour validation en masse.
//
// Workflow :
//   1. Affiche les clients par batch de 50, triés par nom
//   2. Pour chaque client : email + bouton Confirmer / Supprimer
//   3. Quand tu confirmes → le client disparaît de la liste (animation)
//   4. Compteur en haut + filtres par statut + barre de recherche

import React, { useCallback, useEffect, useState } from "react"
import Link from "next/link"

type EmailStatus =
  | "verified"
  | "auto_thunderbird"
  | "auto_low_confidence"
  | "manual_unverified"

type ClientToReview = {
  id: number
  numero_client: string
  nom: string
  prenom: string | null
  societe: string | null
  email: string
  email_status: EmailStatus
  email_source: string | null
  email_verified_at: string | null
  npa: string | null
  ville: string | null
  tel1: string | null
  // Nb de docs pour info contextuelle
  nb_factures_winbiz?: number
  nb_commandes_shopify?: number
}

function fmtDate(iso: string | null) {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("fr-CH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })
}

export default function ReviewEmailsPage() {
  const [clients, setClients] = useState<ClientToReview[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<EmailStatus>("auto_thunderbird")
  const [search, setSearch] = useState("")
  const [processing, setProcessing] = useState<Set<number>>(new Set())

  // Compteurs par statut
  const [stats, setStats] = useState<Record<EmailStatus, number>>({
    verified: 0,
    auto_thunderbird: 0,
    auto_low_confidence: 0,
    manual_unverified: 0,
  })

  const fetchClients = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        status: filter,
        limit: "100",
      })
      if (search.trim()) params.set("q", search.trim())
      const res = await fetch(`/api/clients/review-emails?${params}`)
      const json = await res.json()
      setClients(json.clients || [])
      if (json.total !== undefined) setTotal(json.total)
      if (json.stats) setStats(json.stats)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [filter, search])

  useEffect(() => {
    const t = setTimeout(() => fetchClients(), 300)
    return () => clearTimeout(t)
  }, [fetchClients])

  async function handleAction(clientId: number, action: "confirm" | "delete") {
    setProcessing(prev => new Set(prev).add(clientId))
    try {
      const res = await fetch(`/api/clients/${clientId}/verify-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        alert(`Erreur : ${json.error || res.status}`)
        return
      }
      // Retirer le client de la liste (il a changé de statut)
      setClients(prev => prev.filter(c => c.id !== clientId))
      // Décrémenter le compteur courant
      setStats(s => ({ ...s, [filter]: Math.max(0, s[filter] - 1) }))
    } catch (e) {
      alert(`Erreur : ${(e as Error).message}`)
    } finally {
      setProcessing(prev => {
        const next = new Set(prev)
        next.delete(clientId)
        return next
      })
    }
  }

  const filterLabels: Record<EmailStatus, { label: string; cls: string; icon: string }> = {
    auto_thunderbird: {
      label: "À vérifier (Thunderbird)",
      cls: "border-amber-500/40 bg-amber-500/15 text-amber-300",
      icon: "⚠",
    },
    auto_low_confidence: {
      label: "Incertain (Phase 2)",
      cls: "border-rose-500/40 bg-rose-500/15 text-rose-300",
      icon: "⚠",
    },
    manual_unverified: {
      label: "Non confirmé",
      cls: "border-zinc-500/40 bg-zinc-500/15 text-zinc-300",
      icon: "?",
    },
    verified: {
      label: "Vérifiés",
      cls: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
      icon: "✓",
    },
  }

  return (
    <main className="min-h-screen bg-[#1f2125] px-6 py-8 text-zinc-100">
      <div className="mx-auto max-w-[1400px] space-y-6">
        {/* HEADER */}
        <div className="flex flex-wrap items-center gap-4">
          <Link
            href="/dashboard/clients"
            className="inline-flex items-center rounded-xl border border-white/10 bg-[#34383d] px-4 py-2 text-sm text-zinc-100 hover:bg-[#40454b]"
          >
            ← Fichier clients
          </Link>
          <div>
            <h1 className="text-2xl font-semibold">📧 Revue des emails à vérifier</h1>
            <p className="text-sm text-zinc-400">
              {total !== null
                ? `${clients.length} affichés${total > clients.length ? ` (sur ${total})` : ""}`
                : "Chargement…"}
            </p>
          </div>
        </div>

        {/* TABS FILTRES */}
        <div className="flex flex-wrap gap-2">
          {(["auto_thunderbird", "auto_low_confidence", "manual_unverified", "verified"] as EmailStatus[]).map(
            s => {
              const meta = filterLabels[s]
              const count = stats[s] ?? 0
              const isActive = filter === s
              return (
                <button
                  key={s}
                  onClick={() => setFilter(s)}
                  className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm transition ${
                    isActive
                      ? meta.cls
                      : "border-white/10 bg-[#34383d] text-zinc-300 hover:bg-[#40454b]"
                  }`}
                >
                  <span>{meta.icon}</span>
                  <span>{meta.label}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      isActive ? "bg-black/30" : "bg-white/10"
                    }`}
                  >
                    {count}
                  </span>
                </button>
              )
            }
          )}
        </div>

        {/* RECHERCHE */}
        <div className="rounded-2xl border border-white/10 bg-[#2a2d31] p-4">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filtrer par nom, prénom, email, NPA, ville…"
            className="w-full rounded-xl border border-white/10 bg-[#1f2125] px-4 py-3 text-sm text-zinc-100 outline-none focus:border-[#2B8AD1]"
          />
        </div>

        {/* LISTE */}
        <div className="rounded-2xl border border-white/10 bg-[#2a2d31]">
          {loading ? (
            <div className="p-8 text-center text-zinc-400">Chargement…</div>
          ) : clients.length === 0 ? (
            <div className="p-12 text-center text-zinc-500">
              {stats[filter] === 0 ? (
                <>
                  <div className="text-4xl mb-3">🎉</div>
                  <div>Aucun email avec ce statut. Tout est traité !</div>
                </>
              ) : (
                "Aucun résultat pour cette recherche."
              )}
            </div>
          ) : (
            <div className="divide-y divide-white/5">
              {clients.map(c => {
                const isProcessing = processing.has(c.id)
                return (
                  <div
                    key={c.id}
                    className={`flex flex-wrap items-center gap-4 px-6 py-4 transition ${
                      isProcessing ? "opacity-40" : "hover:bg-white/5"
                    }`}
                  >
                    {/* Identification client */}
                    <div className="flex-1 min-w-[280px]">
                      <div className="flex items-center gap-2 mb-1">
                        <Link
                          href={`/dashboard/clients/${c.id}`}
                          target="_blank"
                          className="font-mono text-xs font-semibold text-[#2B8AD1] hover:underline"
                        >
                          {c.numero_client}
                        </Link>
                        <span className="font-medium text-zinc-100">
                          {[c.nom, c.prenom].filter(Boolean).join(" ")}
                        </span>
                        {c.societe && (
                          <span className="text-sm text-zinc-400">· {c.societe}</span>
                        )}
                      </div>
                      <div className="text-xs text-zinc-500">
                        {[c.npa, c.ville].filter(Boolean).join(" ") || "—"}
                        {c.tel1 && ` · ${c.tel1}`}
                        {(c.nb_factures_winbiz || c.nb_commandes_shopify) && (
                          <>
                            {" · "}
                            {c.nb_factures_winbiz ? (
                              <span className="text-violet-300/70">
                                {c.nb_factures_winbiz} facture
                                {c.nb_factures_winbiz > 1 ? "s" : ""}
                              </span>
                            ) : null}
                            {c.nb_factures_winbiz && c.nb_commandes_shopify ? " · " : ""}
                            {c.nb_commandes_shopify ? (
                              <span className="text-orange-300/70">
                                {c.nb_commandes_shopify} commande
                                {c.nb_commandes_shopify > 1 ? "s" : ""}
                              </span>
                            ) : null}
                          </>
                        )}
                      </div>
                    </div>

                    {/* Email proposé */}
                    <div className="flex-1 min-w-[260px]">
                      <a
                        href={`mailto:${c.email}`}
                        className="font-mono text-sm text-sky-400 hover:underline break-all"
                      >
                        {c.email}
                      </a>
                      {c.email_source && (
                        <div className="text-[10px] text-zinc-500 mt-0.5">
                          Source : {c.email_source}
                          {c.email_verified_at && ` · Vérifié le ${fmtDate(c.email_verified_at)}`}
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    {(c.email_status === "auto_thunderbird" ||
                      c.email_status === "auto_low_confidence" ||
                      c.email_status === "manual_unverified") && (
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleAction(c.id, "confirm")}
                          disabled={isProcessing}
                          className="rounded-lg border border-emerald-500/30 bg-emerald-500/15 px-3 py-1.5 text-xs text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-50"
                        >
                          ✓ Confirmer
                        </button>
                        <button
                          onClick={() => handleAction(c.id, "delete")}
                          disabled={isProcessing}
                          className="rounded-lg border border-rose-500/30 bg-rose-500/15 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-500/25 disabled:opacity-50"
                        >
                          ✕ Supprimer
                        </button>
                        <Link
                          href={`/dashboard/clients/${c.id}`}
                          target="_blank"
                          className="rounded-lg border border-white/10 bg-[#34383d] px-3 py-1.5 text-xs text-zinc-100 hover:bg-[#40454b]"
                        >
                          Voir →
                        </Link>
                      </div>
                    )}

                    {c.email_status === "verified" && (
                      <Link
                        href={`/dashboard/clients/${c.id}`}
                        target="_blank"
                        className="rounded-lg border border-white/10 bg-[#34383d] px-3 py-1.5 text-xs text-zinc-100 hover:bg-[#40454b]"
                      >
                        Voir →
                      </Link>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </main>
  )
}