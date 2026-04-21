"use client";
// app/dashboard/clients/[id]/page.tsx

import React, { useEffect, useState } from "react";
import Link from "next/link";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://offres.jardin-confort.ch"

type Client = {
  id: number
  numero_client: string
  nom: string
  prenom: string | null
  societe: string | null
  email: string | null
  tel1: string | null
  tel2: string | null
  rue: string | null
  rue2: string | null
  numero_rue: string | null
  npa: string | null
  ville: string | null
  pays: string | null
  notes: string | null
  source: string | null
  livr_societe: string | null
  livr_nom: string | null
  livr_prenom: string | null
  livr_rue: string | null
  livr_rue2: string | null
  livr_npa: string | null
  livr_ville: string | null
  livr_tel: string | null
  created_at: string
  updated_at: string
}

type Offre = {
  id: number
  slug: string
  numero_affiche: string
  type_document: string
  statut: string
  date_document: string | null
  total_ttc: number
  commercial: string | null
  payment_mode: string | null
}

function fmtDate(iso: string | null) {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("fr-CH", { day: "2-digit", month: "2-digit", year: "numeric" })
}
function fmtMoney(v: number | null | undefined) {
  if (!v) return "—"
  return new Intl.NumberFormat("fr-CH", { style: "currency", currency: "CHF", maximumFractionDigits: 0 }).format(v)
}
function getStatusColor(statut: string, type: string) {
  if (type === "Commande" || statut === "Acceptée" || statut === "Convertie") return "bg-emerald-500/15 text-emerald-300"
  if (statut === "Abandonnée" || statut === "Refusée") return "bg-rose-500/15 text-rose-300"
  if (statut === "Envoyée") return "bg-sky-500/15 text-sky-300"
  return "bg-amber-500/15 text-amber-300"
}

export default function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [client, setClient] = useState<Client | null>(null)
  const [offres, setOffres] = useState<Offre[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState("")
  const [saveKind, setSaveKind] = useState<"success" | "error">("success")
  const [form, setForm] = useState<Partial<Client>>({})
  const [emailCopied, setEmailCopied] = useState(false)

  useEffect(() => {
    async function load() {
      const { id } = await params
      try {
        const res = await fetch(`/api/clients/${id}`)
        if (!res.ok) throw new Error("Client introuvable")
        const json = await res.json()
        setClient(json.client)
        setForm(json.client)
        setOffres(json.offres || [])
      } catch { /* ignore */ }
      finally { setLoading(false) }
    }
    load()
  }, [params])

  async function saveClient() {
    if (!client) return
    setSaving(true); setSaveStatus(""); 
    try {
      const res = await fetch(`/api/clients/${client.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Erreur")
      setClient(json.client)
      setForm(json.client)
      setEditing(false)
      setSaveStatus("✅ Enregistré")
      setSaveKind("success")
      setTimeout(() => setSaveStatus(""), 3000)
    } catch (e) {
      setSaveStatus("Erreur: " + (e as Error).message)
      setSaveKind("error")
    }
    finally { setSaving(false) }
  }

  if (loading) return (
    <main className="min-h-screen bg-[#1f2125] px-6 py-8 text-zinc-100">
      <div className="mx-auto max-w-[1400px] rounded-2xl border border-white/10 bg-[#2a2d31] p-8 text-zinc-400">Chargement…</div>
    </main>
  )

  if (!client) return (
    <main className="min-h-screen bg-[#1f2125] px-6 py-8 text-zinc-100">
      <div className="mx-auto max-w-[1400px] rounded-2xl border border-rose-500/20 bg-[#2a2d31] p-8 text-rose-300">Client introuvable.</div>
    </main>
  )

  const nomComplet = [client.prenom, client.nom].filter(Boolean).join(" ") || client.societe || "—"
  const caTotal = offres.filter(o => o.type_document === "Commande" || o.statut === "Acceptée").reduce((s, o) => s + (o.total_ttc || 0), 0)

  return (
    <main className="min-h-screen bg-[#1f2125] px-6 py-8 text-zinc-100">
      <div className="mx-auto max-w-[1400px] space-y-6">

        {/* HEADER */}
        <div className="rounded-2xl border border-white/10 bg-[#2a2d31] p-6">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Link href="/dashboard/clients" className="inline-flex items-center rounded-xl border border-white/10 bg-[#34383d] px-4 py-2 text-sm text-zinc-100 hover:bg-[#40454b]">← Fichier clients</Link>
            <Link href="/dashboard" className="inline-flex items-center rounded-xl border border-white/10 bg-[#34383d] px-4 py-2 text-sm text-zinc-100 hover:bg-[#40454b]">📊 Dashboard</Link>
            <Link href={`/offres/nouveau?prefill=${encodeURIComponent(JSON.stringify({
              nom: client.nom, prenom: client.prenom || "", societe: client.societe || "",
              email: client.email || "", telephone1: client.tel1 || "",
              rue: client.rue || "", npa: client.npa || "", ville: client.ville || "",
            }))}`} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center rounded-xl border border-[#2B8AD1]/40 bg-[#2B8AD1]/15 px-4 py-2 text-sm text-sky-300 hover:bg-[#2B8AD1]/25">
              + Nouvelle offre
            </Link>
          </div>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="text-sm text-zinc-400">Client</div>
              <h1 className="mt-1 text-3xl font-semibold">{nomComplet}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <span className="font-mono text-sm font-semibold text-[#2B8AD1]">{client.numero_client}</span>
                {client.societe && <span className="text-sm text-zinc-400">{client.societe}</span>}
                <span className="text-xs text-zinc-500">Depuis le {fmtDate(client.created_at)}</span>
              </div>
            </div>
            <div className="flex gap-4 text-right">
              <div className="rounded-xl border border-white/10 bg-black/10 px-6 py-3">
                <div className="text-xs text-zinc-400">Offres</div>
                <div className="mt-1 text-2xl font-bold">{offres.length}</div>
              </div>
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-6 py-3">
                <div className="text-xs text-zinc-400">CA total</div>
                <div className="mt-1 text-2xl font-bold text-emerald-300">{fmtMoney(caTotal)}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[400px_minmax(0,1fr)]">

          {/* FICHE CLIENT */}
          <div className="space-y-6">
            <section className="rounded-2xl border border-white/10 bg-[#2a2d31] p-6">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-xl font-semibold">Coordonnées</h2>
                {!editing ? (
                  <button onClick={() => setEditing(true)}
                    className="rounded-xl border border-white/10 bg-[#34383d] px-4 py-2 text-sm text-zinc-100 hover:bg-[#40454b]">
                    ✏️ Modifier
                  </button>
                ) : (
                  <div className="flex gap-2">
                    <button onClick={saveClient} disabled={saving}
                      className="rounded-xl bg-[#2B8AD1] px-4 py-2 text-sm font-semibold text-white hover:bg-[#2478b8] disabled:opacity-50">
                      {saving ? "…" : "💾 Enregistrer"}
                    </button>
                    <button onClick={() => { setEditing(false); setForm(client) }}
                      className="rounded-xl border border-white/10 bg-[#34383d] px-4 py-2 text-sm text-zinc-300 hover:bg-[#40454b]">
                      Annuler
                    </button>
                  </div>
                )}
              </div>

              {saveStatus && (
                <div className={`mb-4 rounded-xl px-4 py-2 text-sm ${saveKind === "success" ? "border border-emerald-500/20 bg-emerald-500/10 text-emerald-300" : "border border-rose-500/20 bg-rose-500/10 text-rose-300"}`}>
                  {saveStatus}
                </div>
              )}

              {editing ? (
                <div className="space-y-3">
                  {([
                    ["Nom *", "nom"], ["Prénom", "prenom"], ["Société", "societe"],
                    ["Rue", "rue"], ["Complément", "rue2"], ["N°", "numero_rue"],
                    ["NPA", "npa"], ["Ville", "ville"],
                    ["Téléphone 1", "tel1"], ["Téléphone 2", "tel2"],
                  ] as [string, keyof Client][]).map(([label, key]) => (
                    <div key={key}>
                      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-zinc-400">{label}</label>
                      <input type="text" value={(form[key] as string) || ""}
                        onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))}
                        className="w-full rounded-xl border border-white/10 bg-[#1f2125] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-[#2B8AD1]"/>
                    </div>
                  ))}
                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-zinc-400">Email</label>
                    <input type="email" value={(form.email as string) || ""}
                      onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                      className="w-full rounded-xl border border-white/10 bg-[#1f2125] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-[#2B8AD1]"/>
                  </div>
                  <div className="pt-2 border-t border-white/5">
                    <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-2">📦 Adresse de livraison (si différente)</div>
                    {([
                      ["Nom livraison", "livr_nom"], ["Prénom", "livr_prenom"],
                      ["Société", "livr_societe"], ["Rue", "livr_rue"],
                      ["Complément", "livr_rue2"], ["NPA", "livr_npa"],
                      ["Ville", "livr_ville"], ["Tél.", "livr_tel"],
                    ] as [string, keyof Client][]).map(([label, key]) => (
                      <div key={key} className="mb-2">
                        <label className="mb-1 block text-xs text-zinc-500">{label}</label>
                        <input type="text" value={(form[key] as string) || ""}
                          onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))}
                          className="w-full rounded-xl border border-white/10 bg-[#1f2125] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-[#2B8AD1]"/>
                      </div>
                    ))}
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-zinc-400">Notes</label>
                    <textarea value={(form.notes as string) || ""} rows={3}
                      onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                      className="w-full rounded-xl border border-white/10 bg-[#1f2125] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-[#2B8AD1]"/>
                  </div>
                </div>
              ) : (
                <div className="space-y-2 text-sm">
                  {([
                    ["Nom", [client.nom, client.prenom].filter(Boolean).join(" ")],
                    ["Société", client.societe],
                    ["Rue", [client.rue, client.numero_rue].filter(Boolean).join(" ")],
                    ["Complément", client.rue2],
                    ["NPA / Ville", [client.npa, client.ville].filter(Boolean).join(" ")],
                    ["Pays", client.pays],
                    ["Téléphone 1", client.tel1],
                    ["Téléphone 2", client.tel2],
                  ] as [string, string | null][]).map(([k, v]) => v ? (
                    <div key={k} className="flex gap-2">
                      <span className="w-28 shrink-0 text-zinc-400">{k} :</span>
                      <span>{v}</span>
                    </div>
                  ) : null)}
                  <div className="flex gap-2 items-center">
                    <span className="w-28 shrink-0 text-zinc-400">Email :</span>
                    <span className="flex-1">{client.email || "—"}</span>
                    {client.email && (
                      <button onClick={() => { navigator.clipboard.writeText(client.email!); setEmailCopied(true); setTimeout(() => setEmailCopied(false), 2000) }}
                        className="rounded-lg border border-white/10 bg-[#34383d] px-2 py-0.5 text-xs text-zinc-400 hover:text-zinc-100 transition">
                        {emailCopied ? "✓" : "📋"}
                      </button>
                    )}
                  </div>

                  {/* Adresse de livraison si différente */}
                  {client.livr_rue && (
                    <div className="mt-3 rounded-xl border border-white/10 bg-black/10 p-3 space-y-1">
                      <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-2">📦 Adresse de livraison</div>
                      {([
                        ["Nom", [client.livr_nom, client.livr_prenom].filter(Boolean).join(" ")],
                        ["Société", client.livr_societe],
                        ["Rue", client.livr_rue],
                        ["Complément", client.livr_rue2],
                        ["NPA / Ville", [client.livr_npa, client.livr_ville].filter(Boolean).join(" ")],
                        ["Tél.", client.livr_tel],
                      ] as [string, string | null][]).map(([k, v]) => v ? (
                        <div key={k} className="flex gap-2 text-xs">
                          <span className="w-24 shrink-0 text-zinc-500">{k} :</span>
                          <span className="text-zinc-300">{v}</span>
                        </div>
                      ) : null)}
                    </div>
                  )}

                  {client.notes && (
                    <div className="mt-3 rounded-xl border border-white/10 bg-black/10 p-3 text-xs text-zinc-400 whitespace-pre-wrap">
                      {client.notes}
                    </div>
                  )}
                  <div className="mt-3 pt-3 border-t border-white/5 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 font-medium ${
                      client.source === "shopify" ? "bg-emerald-500/15 text-emerald-300" :
                      client.source === "winbiz"  ? "bg-sky-500/15 text-sky-300" :
                      client.source === "offre"   ? "bg-amber-500/15 text-amber-300" :
                      "bg-white/5 text-zinc-400"
                    }`}>
                      {client.source === "shopify" ? "🛍 Shopify" :
                       client.source === "winbiz"  ? "📊 WinBiz" :
                       client.source === "offre"   ? "📄 Offre" : "✏️ Manuel"}
                    </span>
                    <span>Créé le {fmtDate(client.created_at)}</span>
                    <span>· Modifié le {fmtDate(client.updated_at)}</span>
                  </div>
                </div>
              )}
            </section>

            {/* Actions rapides */}
            {client.email && (
              <section className="rounded-2xl border border-white/10 bg-[#2a2d31] p-6">
                <h2 className="mb-4 text-xl font-semibold">Actions</h2>
                <div className="flex flex-col gap-2">
                  <a href={`mailto:${client.email}`}
                    className="inline-flex items-center rounded-xl border border-sky-500/30 bg-sky-500/15 px-4 py-2 text-sm text-sky-300 hover:bg-sky-500/20">
                    ✉ Envoyer un email
                  </a>
                  {client.tel1 && (
                    <a href={`tel:${client.tel1}`}
                      className="inline-flex items-center rounded-xl border border-white/10 bg-[#34383d] px-4 py-2 text-sm text-zinc-100 hover:bg-[#40454b]">
                      📞 Appeler {client.tel1}
                    </a>
                  )}
                </div>
              </section>
            )}
          </div>

          {/* HISTORIQUE OFFRES */}
          <section className="rounded-2xl border border-white/10 bg-[#2a2d31] p-6">
            <h2 className="mb-4 text-xl font-semibold">Historique offres & commandes</h2>
            {offres.length === 0 ? (
              <div className="rounded-xl border border-white/10 bg-black/10 p-8 text-center text-zinc-500">
                Aucune offre enregistrée pour ce client.
                <div className="mt-4">
                  <Link href={`/offres/nouveau?prefill=${encodeURIComponent(JSON.stringify({
                    nom: client.nom, prenom: client.prenom || "", societe: client.societe || "",
                    email: client.email || "", telephone1: client.tel1 || "",
                    rue: client.rue || "", npa: client.npa || "", ville: client.ville || "",
                  }))}`} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center rounded-xl bg-[#2B8AD1] px-4 py-2 text-sm font-semibold text-white hover:bg-[#2478b8]">
                    + Créer une offre
                  </Link>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full border-collapse text-sm">
                  <thead className="bg-black/10 text-left text-zinc-400">
                    <tr>
                      <th className="px-4 py-3 font-medium">Référence</th>
                      <th className="px-4 py-3 font-medium">Type</th>
                      <th className="px-4 py-3 font-medium">Statut</th>
                      <th className="px-4 py-3 font-medium">Date</th>
                      <th className="px-4 py-3 font-medium">Conseiller</th>
                      <th className="px-4 py-3 font-medium text-right">Montant</th>
                      <th className="px-4 py-3 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {offres.map((o, idx) => (
                      <tr key={o.id}
                        className={`border-t border-white/5 text-zinc-200 transition hover:bg-white/5 cursor-pointer ${idx % 2 === 0 ? "bg-white/[0.02]" : "bg-white/[0.04]"}`}
                        onClick={() => window.location.href = `/dashboard/${o.slug}`}>
                        <td className="px-4 py-3 font-semibold text-zinc-100">{o.numero_affiche}</td>
                        <td className="px-4 py-3 text-zinc-400">{o.type_document}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${getStatusColor(o.statut, o.type_document)}`}>{o.statut}</span>
                        </td>
                        <td className="px-4 py-3 text-zinc-400">{fmtDate(o.date_document)}</td>
                        <td className="px-4 py-3 text-zinc-400">{o.commercial || "—"}</td>
                        <td className="px-4 py-3 text-right font-medium text-zinc-100">{fmtMoney(o.total_ttc)}</td>
                        <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                          <div className="flex justify-end gap-2">
                            <Link href={`/dashboard/${o.slug}`}
                              className="rounded-lg border border-white/10 bg-[#34383d] px-3 py-1.5 text-xs text-zinc-100 hover:bg-[#40454b]">
                              Voir
                            </Link>
                            <a href={`${APP_URL}/offre/${o.slug}`} target="_blank" rel="noopener noreferrer"
                              className="rounded-lg border border-white/10 bg-[#34383d] px-3 py-1.5 text-xs text-zinc-100 hover:bg-[#40454b]">
                              Client
                            </a>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

      </div>
    </main>
  )
}