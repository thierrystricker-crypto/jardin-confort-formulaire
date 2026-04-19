"use client";
// app/dashboard/page.tsx
// Dashboard backoffice — liste des offres et commandes depuis Supabase

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { OffreRecord } from "@/types/dashboard";
import {
  fmtDate, fmtMoney, nomClient, getDaysOpen,
  getStatusColor, getDaysBadgeColor, computeStats, COMMERCIAUX
} from "@/lib/dashboard-utils";

type SortKey = "date" | "client" | "montant" | "statut" | "commercial" | "jours" | "numero"
type SortDir = "asc" | "desc"
type QuickFilter = "all" | "offres" | "commandes" | "abandonnes" | "relance"

function isoWeek(d: Date) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const day = (t.getUTCDay() + 6) % 7
  t.setUTCDate(t.getUTCDate() - day + 3)
  const jan4 = new Date(Date.UTC(t.getUTCFullYear(), 0, 4))
  const dayJan = (jan4.getUTCDay() + 6) % 7
  jan4.setUTCDate(jan4.getUTCDate() - dayJan + 3)
  return 1 + Math.round((t.getTime() - jan4.getTime()) / 604800000)
}

function todayLabel() {
  const now = new Date()
  const d = new Intl.DateTimeFormat("fr-CH", { weekday:"long", day:"2-digit", month:"2-digit", year:"numeric" }).format(now)
  return `${d} · Semaine ${isoWeek(now)}`
}

function KpiCard({ title, value, sub, extra }: { title: string; value: string | number; sub?: string; extra?: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#2a2d31] p-6">
      <div className="text-sm text-zinc-400">{title}</div>
      <div className="mt-4 text-4xl font-semibold tracking-tight text-zinc-100">{value}</div>
      {sub && <div className="mt-3 text-sm text-zinc-500">{sub}</div>}
      {extra && <div className="mt-2 text-sm text-sky-300">{extra}</div>}
    </div>
  )
}

function SortTh({ label, k, cur, dir, onSort }: {
  label: string; k: SortKey; cur: SortKey; dir: SortDir; onSort: (k: SortKey) => void
}) {
  const active = k === cur
  return (
    <th className="px-4 py-3 font-medium">
      <button type="button" onClick={() => onSort(k)}
        className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 transition ${active ? "bg-white/10 text-zinc-100" : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"}`}>
        {label} <span className="text-xs">{active ? (dir === "asc" ? "↑" : "↓") : "↕"}</span>
      </button>
    </th>
  )
}

export default function DashboardPage() {
  const [offres, setOffres] = useState<OffreRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all")
  const [commercial, setCommercial] = useState("all")
  const [sortKey, setSortKey] = useState<SortKey>("date")
  const [sortDir, setSortDir] = useState<SortDir>("desc")

  useEffect(() => {
    fetch("/api/dashboard/offres")
      .then(r => r.json())
      .then(d => setOffres(Array.isArray(d) ? d : []))
      .catch(() => setOffres([]))
      .finally(() => setLoading(false))
  }, [])

  function handleSort(k: SortKey) {
    if (k === sortKey) { setSortDir(d => d === "asc" ? "desc" : "asc"); return }
    setSortKey(k); setSortDir("desc")
  }

  const filtered = useMemo(() => {
    let list = offres

    // Quick filter
    if (quickFilter === "offres") list = list.filter(o => o.type_document === "Offre" && !["Abandonnée","Convertie","Refusée"].includes(o.statut))
    else if (quickFilter === "commandes") list = list.filter(o => o.type_document === "Commande" || o.statut === "Acceptée")
    else if (quickFilter === "abandonnes") list = list.filter(o => ["Abandonnée","Refusée"].includes(o.statut))
    else if (quickFilter === "relance") list = list.filter(o => { const d = getDaysOpen(o); return d !== null && d >= 7 })

    // Commercial
    if (commercial !== "all") list = list.filter(o => o.commercial === commercial)

    // Search
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(o =>
        nomClient(o).toLowerCase().includes(q) ||
        (o.numero_affiche || "").toLowerCase().includes(q) ||
        (o.client_email || "").toLowerCase().includes(q) ||
        (o.client_ville || "").toLowerCase().includes(q) ||
        (o.commercial || "").toLowerCase().includes(q)
      )
    }

    // Sort
    return [...list].sort((a, b) => {
      let av: string | number = "", bv: string | number = ""
      switch (sortKey) {
        case "numero": av = a.id; bv = b.id; break
        case "date": av = a.date_document || ""; bv = b.date_document || ""; break
        case "client": av = nomClient(a); bv = nomClient(b); break
        case "montant": av = a.total_ttc || 0; bv = b.total_ttc || 0; break
        case "statut": av = a.statut; bv = b.statut; break
        case "commercial": av = a.commercial || ""; bv = b.commercial || ""; break
        case "jours": av = getDaysOpen(a) ?? -1; bv = getDaysOpen(b) ?? -1; break
      }
      if (av < bv) return sortDir === "asc" ? -1 : 1
      if (av > bv) return sortDir === "asc" ? 1 : -1
      return 0
    })
  }, [offres, quickFilter, commercial, search, sortKey, sortDir])

  const stats = useMemo(() => computeStats(offres), [offres])

  const quickFilters: { label: string; value: QuickFilter }[] = [
    { label: "Toutes", value: "all" },
    { label: "Offres actives", value: "offres" },
    { label: "Commandes", value: "commandes" },
    { label: "Abandonnées", value: "abandonnes" },
    { label: "À relancer (≥7j)", value: "relance" },
  ]

  if (loading) return (
    <main className="min-h-screen bg-[#1f2125] px-6 py-8 text-zinc-100">
      <div className="mx-auto max-w-[1700px]">
        <div className="rounded-2xl border border-white/10 bg-[#2a2d31] p-8 text-zinc-400">
          Chargement des offres…
        </div>
      </div>
    </main>
  )

  return (
    <main className="min-h-screen bg-[#1f2125] px-6 py-8 text-zinc-100 font-sans">
      <div className="mx-auto max-w-[1700px] space-y-6">

        {/* ── HEADER ── */}
        <div className="space-y-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="flex items-start gap-4">
              <img src="https://cdn.shopify.com/s/files/1/0360/3251/2135/files/picto_jardin_confort_apple_low.png?v=1775944940"
                alt="Jardin-Confort" className="h-16 w-16 rounded-xl object-contain" />
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">Suivi offres & commandes</h1>
                <p className="mt-1 text-sm text-zinc-400">Vue commerciale centralisée Jardin-Confort</p>
                <p className="mt-1 text-xs text-zinc-500">{todayLabel()}</p>
              </div>
            </div>
            <div className="flex gap-3 flex-wrap">
              <Link href="/offres/nouveau"
                className="inline-flex items-center rounded-2xl bg-[#2B8AD1] px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-[#2B8AD1]/20 transition hover:bg-[#2478b8]">
                + Nouvelle offre
              </Link>
              <button onClick={() => { setLoading(true); fetch("/api/dashboard/offres").then(r=>r.json()).then(d=>setOffres(Array.isArray(d)?d:[])).finally(()=>setLoading(false)) }}
                className="inline-flex items-center rounded-2xl border border-white/10 bg-[#2a2d31] px-4 py-3 text-sm text-zinc-300 transition hover:bg-[#34383d]">
                🔄 Actualiser
              </button>
            </div>
          </div>

          {/* Filtres */}
          <div className="grid gap-3 xl:grid-cols-[240px_200px_minmax(0,1fr)_160px]">
            <select value={commercial} onChange={e => setCommercial(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-[#2a2d31] px-4 py-2.5 text-sm text-zinc-100 outline-none">
              <option value="all">Tous les conseillers</option>
              {COMMERCIAUX.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={quickFilter} onChange={e => setQuickFilter(e.target.value as QuickFilter)}
              className="w-full rounded-xl border border-white/10 bg-[#2a2d31] px-4 py-2.5 text-sm text-zinc-100 outline-none">
              {quickFilters.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Recherche : client, référence, email, ville…"
              className="w-full rounded-xl border border-white/10 bg-[#2a2d31] px-4 py-2.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-500" />
            <button onClick={() => { setSearch(""); setQuickFilter("all"); setCommercial("all") }}
              className="rounded-xl border border-white/10 bg-[#34383d] px-4 py-2.5 text-sm text-zinc-100 transition hover:bg-[#40454b]">
              Reset filtres
            </button>
          </div>

          {/* Boutons quick filter */}
          <div className="flex flex-wrap gap-2">
            {quickFilters.map(f => (
              <button key={f.value} type="button" onClick={() => setQuickFilter(f.value)}
                className={`rounded-full px-4 py-2 text-sm transition ${quickFilter === f.value ? "bg-zinc-100 text-zinc-900" : "border border-white/10 bg-[#34383d] text-zinc-200 hover:bg-[#40454b]"}`}>
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── KPIs ── */}
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <KpiCard title="Offres actives" value={stats.totalOffres}
            sub={`${offres.length} dossiers total`} extra={`${fmtMoney(stats.caOffres)} potentiel`} />
          <KpiCard title="Commandes" value={stats.totalCommandes}
            sub={`${offres.length} dossiers total`} extra={`${fmtMoney(stats.caCommandes)} confirmé`} />
          <KpiCard title="À relancer" value={stats.aRelancer}
            sub="Offres ouvertes ≥ 7 jours" extra={stats.aRelancer > 0 ? "⚠ Action requise" : "✓ À jour"} />
          <KpiCard title="Abandonnées" value={stats.totalAbandonnes}
            sub={`${offres.length} dossiers total`} />
        </div>

        {/* ── TABLEAU ── */}
        <div className="space-y-3">
          <div className="text-sm text-zinc-400">{filtered.length} résultat(s)</div>
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#2a2d31]">
            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse text-sm">
                <thead className="bg-black/10 text-left text-zinc-400">
                  <tr>
                    <SortTh label="Réf." k="numero" cur={sortKey} dir={sortDir} onSort={handleSort} />
                    <SortTh label="Client" k="client" cur={sortKey} dir={sortDir} onSort={handleSort} />
                    <th className="px-4 py-3 font-medium text-zinc-400">Ville</th>
                    <SortTh label="Conseiller" k="commercial" cur={sortKey} dir={sortDir} onSort={handleSort} />
                    <SortTh label="Montant" k="montant" cur={sortKey} dir={sortDir} onSort={handleSort} />
                    <SortTh label="Statut" k="statut" cur={sortKey} dir={sortDir} onSort={handleSort} />
                    <SortTh label="Jours" k="jours" cur={sortKey} dir={sortDir} onSort={handleSort} />
                    <SortTh label="Date" k="date" cur={sortKey} dir={sortDir} onSort={handleSort} />
                    <th className="px-4 py-3 font-medium text-right text-zinc-400">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr><td colSpan={9} className="px-4 py-10 text-center text-zinc-500">Aucun dossier trouvé.</td></tr>
                  ) : filtered.map((o, idx) => {
                    const days = getDaysOpen(o)
                    const statusCls = getStatusColor(o.statut, o.type_document)
                    const daysCls = getDaysBadgeColor(days)
                    const rowBg = idx % 2 === 0 ? "bg-white/[0.02]" : "bg-white/[0.05]"
                    return (
                      <tr key={o.id} onClick={() => window.location.href = `/dashboard/${o.slug}`}
                        className={`${rowBg} cursor-pointer border-t border-white/5 text-zinc-200 transition hover:bg-white/10`}>
                        <td className="px-4 py-4">
                          <div className="font-semibold text-zinc-100">{o.numero_affiche}</div>
                          <div className="text-xs text-zinc-500">{o.type_document}</div>
                        </td>
                        <td className="px-4 py-4">
                          <div>{nomClient(o)}</div>
                          {o.client_societe && <div className="text-xs text-zinc-400">{o.client_societe}</div>}
                          {o.client_email && <div className="text-xs text-zinc-500">{o.client_email}</div>}
                        </td>
                        <td className="px-4 py-4 text-zinc-400">{o.client_ville || "—"}</td>
                        <td className="px-4 py-4 text-zinc-300">{o.commercial || "—"}</td>
                        <td className="px-4 py-4 font-medium text-zinc-100">{fmtMoney(o.total_ttc)}</td>
                        <td className="px-4 py-4">
                          <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${statusCls}`}>
                            {o.statut}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          {days !== null ? (
                            <span className={`inline-flex min-w-8 items-center justify-center rounded-full px-3 py-1 text-xs font-medium ${daysCls}`}>
                              {days}j
                            </span>
                          ) : <span className="text-zinc-600">—</span>}
                        </td>
                        <td className="px-4 py-4 text-zinc-400">{fmtDate(o.date_document)}</td>
                        <td className="px-4 py-4">
                          <div className="flex justify-end gap-2" onClick={e => e.stopPropagation()}>
                            <Link href={`/dashboard/${o.slug}`}
                              className="rounded-lg border border-white/10 bg-[#34383d] px-3 py-1.5 text-xs text-zinc-100 transition hover:bg-[#40454b]">
                              Voir
                            </Link>
                            <a href={`/offre/${o.slug}`} target="_blank" rel="noopener noreferrer"
                              className="rounded-lg border border-white/10 bg-[#34383d] px-3 py-1.5 text-xs text-zinc-100 transition hover:bg-[#40454b]">
                              Client
                            </a>
                            {o.client_email && (
                              <a href={`mailto:${o.client_email}?subject=Suivi%20offre%20${o.numero_affiche}&body=Bonjour%20${o.client_prenom || ""}%2C%0A%0AVeuillez%20trouver%20ci-joint%20votre%20offre%20Jardin-Confort.%0A%0ACordialement%2C%0A${o.commercial || "L'équipe Jardin-Confort"}`}
                                className="rounded-lg border border-white/10 bg-[#34383d] px-3 py-1.5 text-xs text-zinc-100 transition hover:bg-[#40454b]">
                                Mail
                              </a>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

      </div>
    </main>
  )
}