"use client";
// app/dashboard/[slug]/page.tsx
// Page détail d'une offre ou commande — backoffice

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { OffreRecord } from "@/types/dashboard";
import {
  fmtDate, fmtMoney, nomClient, getDaysOpen,
  getStatusColor, getDaysBadgeColor
} from "@/lib/dashboard-utils";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://offres.jardin-confort.ch"

function ts() {
  return new Intl.DateTimeFormat("fr-CH", {
    day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit"
  }).format(new Date()).replace(",", "")
}

function appendTs(cur: string, prev: string) {
  const c = cur.replace(/\r\n/g, "\n")
  const p = prev.replace(/\r\n/g, "\n")
  if (c.trim() === p.trim()) return c
  const lines = c.split("\n")
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim()) { lines[i] = `${lines[i].trimEnd()} — ${ts()}`; return lines.join("\n") }
  }
  return c
}

export default function DashboardDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const [offre, setOffre] = useState<OffreRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [slug, setSlug] = useState("")
  const [error, setError] = useState("")

  // Notes state
  const [noteCommerciale, setNoteCommerciale] = useState("")
  const [notesInternes, setNotesInternes] = useState("")
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState("")
  const [saveKind, setSaveKind] = useState<"success"|"error"|"info">("info")

  useEffect(() => {
    async function load() {
      const { slug: s } = await params
      setSlug(s)
      try {
        const res = await fetch(`/api/offres/${s}`)
        if (!res.ok) throw new Error(`Erreur ${res.status}`)
        const json = await res.json()
        const o = json.offre as OffreRecord
        setOffre(o)
        setNoteCommerciale(o.note_commerciale || "")
        setNotesInternes(o.notes_internes || "")
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [params])

  async function saveNotes() {
    if (!offre) return
    setSaving(true); setSaveStatus("Enregistrement…"); setSaveKind("info")
    try {
      const stampedComm = appendTs(noteCommerciale, offre.note_commerciale || "")
      const stampedInt = appendTs(notesInternes, offre.notes_internes || "")

      const res = await fetch(`/api/offres/${slug}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note_commerciale: stampedComm, notes_internes: stampedInt })
      })
      if (!res.ok) throw new Error("Erreur sauvegarde")
      setNoteCommerciale(stampedComm)
      setNotesInternes(stampedInt)
      setOffre(prev => prev ? { ...prev, note_commerciale: stampedComm, notes_internes: stampedInt } : prev)
      setSaveStatus(`Enregistré à ${ts()}`); setSaveKind("success")
      setTimeout(() => setSaveStatus(""), 3000)
    } catch {
      setSaveStatus("Erreur lors de la sauvegarde"); setSaveKind("error")
    } finally {
      setSaving(false)
    }
  }

  async function markAbandonne() {
    if (!offre || !confirm("Confirmer l'abandon de cette offre ?")) return
    const res = await fetch(`/api/offres/${slug}/statut`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ statut: "Abandonnée" })
    })
    if (res.ok) {
      setOffre(prev => prev ? { ...prev, statut: "Abandonnée" } : prev)
    }
  }

  async function reactivate() {
    if (!offre || !confirm("Confirmer la réactivation ?")) return
    const res = await fetch(`/api/offres/${slug}/statut`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ statut: "En cours" })
    })
    if (res.ok) {
      setOffre(prev => prev ? { ...prev, statut: "En cours" } : prev)
    }
  }

  // Mail de relance
  const mailBody = useMemo(() => {
    if (!offre) return ""
    const prenom = offre.client_prenom || ""
    const greeting = prenom ? `Bonjour ${prenom},` : "Bonjour,"
    const urlOffre = `${APP_URL}/offre/${offre.slug}`
    return `\n${greeting}\n\nJe me permets de reprendre contact avec vous suite à notre offre concernant votre mobilier d'extérieur.\n\nEst-ce que vous avez eu l'occasion de consulter notre offre ?\n\nLien vers votre offre : ${urlOffre}\n\nCordialement,\n${offre.commercial || "L'équipe Jardin-Confort"}`
  }, [offre])

  if (loading) return (
    <main className="min-h-screen bg-[#1f2125] px-6 py-8 text-zinc-100">
      <div className="mx-auto max-w-[1800px] rounded-2xl border border-white/10 bg-[#2a2d31] p-8 text-zinc-400">
        Chargement du dossier…
      </div>
    </main>
  )

  if (error || !offre) return (
    <main className="min-h-screen bg-[#1f2125] px-6 py-8 text-zinc-100">
      <div className="mx-auto max-w-[1800px] rounded-2xl border border-red-500/20 bg-[#2a2d31] p-8 text-red-300">
        Impossible de charger le dossier. {error}
      </div>
    </main>
  )

  const days = getDaysOpen(offre)
  const statusCls = getStatusColor(offre.statut, offre.type_document)
  const d = offre.data as Record<string, unknown>
  const urlPublique = `${APP_URL}/offre/${offre.slug}`
  const urlPrint = `${APP_URL}/print/offre/${offre.slug}`
  const isAbandonne = offre.statut === "Abandonnée"
  const isOffre = offre.type_document === "Offre" && !["Convertie","Acceptée"].includes(offre.statut)

  return (
    <main className="min-h-screen bg-[#1f2125] px-6 py-8 text-zinc-100 font-sans">
      <div className="mx-auto max-w-[1800px] space-y-6">

        {/* ── TOP ── */}
        <div className="rounded-2xl border border-white/10 bg-[#2a2d31] p-6">
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <Link href="/dashboard"
              className="inline-flex items-center rounded-xl border border-white/10 bg-[#34383d] px-4 py-2 text-sm text-zinc-100 transition hover:bg-[#40454b]">
              ← Retour à la liste
            </Link>
            {offre.client_email && (
              <a href={`mailto:${offre.client_email}?subject=${encodeURIComponent(`Suivi offre ${offre.numero_affiche}`)}&body=${encodeURIComponent(mailBody)}`}
                className="inline-flex items-center rounded-xl border border-white/10 bg-[#34383d] px-4 py-2 text-sm text-zinc-100 transition hover:bg-[#40454b]">
                ✉ Envoyer email
              </a>
            )}
            <a href={urlPublique} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center rounded-xl border border-white/10 bg-[#34383d] px-4 py-2 text-sm text-zinc-100 transition hover:bg-[#40454b]">
              👁 Page client
            </a>
            <a href={urlPrint} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center rounded-xl border border-white/10 bg-[#34383d] px-4 py-2 text-sm text-zinc-100 transition hover:bg-[#40454b]">
              🖨 Imprimer / PDF
            </a>
          </div>

          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex items-start gap-4">
              <img src="https://cdn.shopify.com/s/files/1/0360/3251/2135/files/picto_jardin_confort_apple_low.png?v=1775944940"
                alt="" className="h-16 w-16 rounded-xl object-contain" />
              <div>
                <div className="text-sm text-zinc-400">Dossier</div>
                <h1 className="mt-2 text-3xl font-semibold">{offre.numero_affiche}</h1>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${statusCls}`}>
                    {offre.statut}
                  </span>
                  <span className="text-sm text-zinc-400">{offre.type_document}</span>
                  {offre.offre_origine && (
                    <span className="text-sm text-zinc-500">Issu de : {offre.offre_origine}</span>
                  )}
                  {days !== null && (
                    <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${getDaysBadgeColor(days)}`}>
                      {days} jour{days > 1 ? "s" : ""} ouvert
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-3xl font-bold text-zinc-100">{fmtMoney(offre.total_ttc)}</div>
              <div className="mt-1 text-sm text-zinc-400">{offre.payment_mode || "—"}</div>
              <div className="mt-1 text-sm text-zinc-500">{offre.nb_articles} article{offre.nb_articles !== 1 ? "s" : ""}</div>
            </div>
          </div>
        </div>

        {/* ── GRILLE PRINCIPALE ── */}
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_680px]">

          {/* Colonne gauche */}
          <div className="space-y-6">

            {/* Client + Offre */}
            <div className="grid gap-6 lg:grid-cols-2">
              <section className="rounded-2xl border border-white/10 bg-[#2a2d31] p-6">
                <h2 className="mb-4 text-xl font-semibold">Client</h2>
                <div className="space-y-2 text-sm">
                  {[
                    ["Nom", nomClient(offre)],
                    ["Société", offre.client_societe],
                    ["Email", offre.client_email],
                    ["Tél.", offre.client_tel1],
                    ["Rue", [offre.client_rue, (d.numero as string)||""].filter(Boolean).join(" ")],
                    ["NPA / Ville", [offre.client_npa, offre.client_ville].filter(Boolean).join(" ")],
                  ].map(([k, v]) => (
                    <div key={k} className="flex gap-2">
                      <span className="w-24 shrink-0 text-zinc-400">{k} :</span>
                      <span>{v || "—"}</span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-2xl border border-white/10 bg-[#2a2d31] p-6">
                <h2 className="mb-4 text-xl font-semibold">Offre</h2>
                <div className="space-y-2 text-sm">
                  {[
                    ["Conseiller", offre.commercial],
                    ["Date", fmtDate(offre.date_document)],
                    ["Paiement", offre.payment_mode],
                    ["Livraison", offre.delivery_mode || (d.deliveryMode as string)],
                    ["Délai", offre.lead_time || (d.leadTime as string)],
                    ["Référence", (d.reference as string)],
                    ["Articles", String(offre.nb_articles || 0)],
                  ].map(([k, v]) => (
                    <div key={k} className="flex gap-2">
                      <span className="w-24 shrink-0 text-zinc-400">{k} :</span>
                      <span>{v || "—"}</span>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            {/* Montants */}
            <section className="rounded-2xl border border-white/10 bg-[#2a2d31] p-6">
              <h2 className="mb-4 text-xl font-semibold">Montants</h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  ["Sous-total", fmtMoney(offre.sous_total)],
                  ["Remise", offre.remise_chf > 0 ? `− ${fmtMoney(offre.remise_chf)}` : "—"],
                  ["Services", offre.services_total > 0 ? fmtMoney(offre.services_total) : "—"],
                  ["TVA 8.1%", fmtMoney(offre.tva_montant)],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-xl border border-white/10 bg-black/10 p-4">
                    <div className="text-xs text-zinc-400">{k}</div>
                    <div className="mt-2 text-lg font-semibold text-zinc-100">{v}</div>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex items-center justify-between rounded-xl border border-white/10 bg-[#2B8AD1]/10 px-6 py-4">
                <span className="text-lg font-semibold text-zinc-100">TOTAL TTC</span>
                <span className="text-2xl font-bold text-white">{fmtMoney(offre.total_ttc)}</span>
              </div>
            </section>

            {/* Remarques */}
            {offre.remarques && (
              <section className="rounded-2xl border border-white/10 bg-[#2a2d31] p-6">
                <h2 className="mb-3 text-xl font-semibold">Remarques client</h2>
                <p className="whitespace-pre-wrap text-sm text-zinc-300">{offre.remarques}</p>
              </section>
            )}

            {/* Notes commerciales */}
            <section className="rounded-2xl border border-white/10 bg-[#2a2d31] p-6">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-xl font-semibold">Suivi commercial</h2>
                <button type="button" onClick={saveNotes} disabled={saving}
                  className="rounded-xl border border-white/10 bg-[#34383d] px-4 py-2 text-sm text-zinc-100 transition hover:bg-[#40454b] disabled:opacity-50">
                  {saving ? "Enregistrement…" : "Enregistrer"}
                </button>
              </div>

              {/* Actions rapides */}
              <div className="mb-4 flex flex-wrap gap-2 rounded-xl border border-white/10 bg-black/10 p-4">
                {isOffre && (
                  <button type="button" onClick={markAbandonne}
                    className="rounded-xl border border-rose-500/30 bg-rose-500/15 px-4 py-2 text-sm text-rose-300 transition hover:bg-rose-500/20">
                    Abandonner l&apos;offre
                  </button>
                )}
                {isAbandonne && (
                  <button type="button" onClick={reactivate}
                    className="rounded-xl border border-emerald-500/30 bg-emerald-500/15 px-4 py-2 text-sm text-emerald-300 transition hover:bg-emerald-500/20">
                    Réactiver l&apos;offre
                  </button>
                )}
                {offre.client_email && (
                  <a href={`mailto:${offre.client_email}?subject=${encodeURIComponent(`Suivi offre ${offre.numero_affiche}`)}&body=${encodeURIComponent(mailBody)}`}
                    className="rounded-xl border border-sky-500/30 bg-sky-500/15 px-4 py-2 text-sm text-sky-300 transition hover:bg-sky-500/20">
                    ✉ Mail de relance
                  </a>
                )}
              </div>

              {saveStatus && (
                <div className={`mb-4 rounded-xl px-4 py-3 text-sm ${
                  saveKind === "success" ? "border border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
                    : saveKind === "error" ? "border border-rose-500/20 bg-rose-500/10 text-rose-300"
                    : "border border-white/10 bg-black/10 text-zinc-300"
                }`}>{saveStatus}</div>
              )}

              <div className="space-y-4">
                <div>
                  <label className="mb-2 block text-sm text-zinc-400">Note commerciale</label>
                  <textarea value={noteCommerciale} onChange={e => setNoteCommerciale(e.target.value)} rows={4}
                    className="w-full rounded-xl border border-white/10 bg-[#1f2125] px-4 py-3 text-sm text-zinc-100 outline-none" />
                </div>
                <div>
                  <label className="mb-2 block text-sm text-zinc-400">Notes internes</label>
                  <textarea value={notesInternes} onChange={e => setNotesInternes(e.target.value)} rows={4}
                    className="w-full rounded-xl border border-white/10 bg-[#1f2125] px-4 py-3 text-sm text-zinc-100 outline-none" />
                </div>
              </div>
            </section>

            {/* Template email relance */}
            <section className="rounded-2xl border border-white/10 bg-[#2a2d31] p-6">
              <h2 className="mb-2 text-xl font-semibold">Brouillon mail de relance</h2>
              <p className="mb-4 text-sm text-zinc-400">Cliquez sur &quot;✉ Mail de relance&quot; pour ouvrir votre client mail avec ce texte prérempli.</p>
              <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-zinc-300 whitespace-pre-wrap">
                {mailBody}
              </div>
            </section>

          </div>

          {/* Colonne droite — iframe offre */}
          <section className="rounded-2xl border border-white/10 bg-[#2a2d31] p-6 xl:sticky xl:top-6 xl:self-start">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold">Aperçu de l&apos;offre</h2>
              <a href={urlPublique} target="_blank" rel="noopener noreferrer"
                className="rounded-xl border border-white/10 bg-[#34383d] px-3 py-1.5 text-xs text-zinc-100 hover:bg-[#40454b]">
                Ouvrir ↗
              </a>
            </div>
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/20">
              <iframe src={urlPublique} title="Aperçu offre" className="h-[900px] w-full border-0" />
            </div>
          </section>

        </div>

        {/* Footer nav */}
        <div className="rounded-2xl border border-white/10 bg-[#2a2d31] p-6">
          <div className="flex flex-wrap gap-3">
            <Link href="/dashboard"
              className="inline-flex items-center rounded-xl border border-white/10 bg-[#34383d] px-4 py-2 text-sm text-zinc-100 hover:bg-[#40454b]">
              ← Retour à la liste
            </Link>
            <Link href="/offres/nouveau"
              className="inline-flex items-center rounded-xl border border-white/10 bg-[#34383d] px-4 py-2 text-sm text-zinc-100 hover:bg-[#40454b]">
              + Nouvelle offre
            </Link>
          </div>
        </div>

      </div>
    </main>
  )
}