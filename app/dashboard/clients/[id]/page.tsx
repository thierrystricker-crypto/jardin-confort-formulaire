"use client";
// app/dashboard/clients/[id]/page.tsx

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { getShopifyPdfUrls } from "@/lib/shopify-pdf-urls";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://offres.jardin-confort.ch"

type Client = {
  id: number
  numero_client: string
  nom: string
  prenom: string | null
  societe: string | null
  complement_nom: string | null
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
  livr_complement_nom: string | null
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

type Facture = {
  id: number
  numero_facture: string
  date_facture: string | null
  montant: number | null
  pdf_url: string | null
  match_confiance: string | null
  created_at: string
}

type CommandeShopify = {
  id: number
  shopify_order_id: string
  shopify_order_legacy_id: number | null
  shopify_order_name: string
  shopify_order_number: number
  total_price: number
  subtotal_price: number
  total_tax: number
  total_shipping: number
  currency: string
  financial_status: string | null
  fulfillment_status: string
  cancelled_at: string | null
  cancel_reason: string | null
  source_name: string | null
  test: boolean
  tags: string[]
  note: string | null
  status_page_url: string | null
  shipping_address: {
    address1: string | null
    address2: string | null
    city: string | null
    zip: string | null
    country: string | null
  } | null
  billing_address: unknown
  line_items: Array<{
    id: string
    title: string
    name: string
    sku: string | null
    quantity: number
    currentQuantity: number
    price: string | null
  }>
  created_at_shopify: string
}

function fmtDate(iso: string | null) {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("fr-CH", { day: "2-digit", month: "2-digit", year: "numeric" })
}
function fmtMoney(v: number | null | undefined) {
  if (!v) return "—"
  return "CHF\u00a0" + new Intl.NumberFormat("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)
}
function getStatusColor(statut: string, type: string) {
  if (type === "Commande" || statut === "Acceptée" || statut === "Convertie") return "bg-emerald-500/15 text-emerald-300"
  if (statut === "Abandonnée" || statut === "Refusée") return "bg-rose-500/15 text-rose-300"
  if (statut === "Envoyée") return "bg-sky-500/15 text-sky-300"
  return "bg-amber-500/15 text-amber-300"
}

// ─── Bloc commandes Shopify ──────────────────────────────
function CommandesShopifyBlock({ commandes }: { commandes: CommandeShopify[] }) {
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())

  if (commandes.length === 0) return null

  function toggleExpand(id: number) {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function fmtMoney(amount: number, currency: string) {
    return new Intl.NumberFormat("fr-CH", {
      style: "currency",
      currency: currency || "CHF",
      minimumFractionDigits: 2,
    }).format(amount)
  }

  function fmtDateTime(iso: string) {
    return new Date(iso).toLocaleDateString("fr-CH", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    })
  }

  function financialBadge(status: string | null) {
    const s = (status || "").toUpperCase()
    if (s === "PAID") return { label: "✅ Payé", cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" }
    if (s === "PENDING") return { label: "⏳ En attente", cls: "bg-amber-500/15 text-amber-300 border-amber-500/30" }
    if (s === "REFUNDED") return { label: "↩️ Remboursé", cls: "bg-rose-500/15 text-rose-300 border-rose-500/30" }
    if (s === "PARTIALLY_REFUNDED") return { label: "↩️ Partiellement remboursé", cls: "bg-rose-500/15 text-rose-300 border-rose-500/30" }
    if (s === "VOIDED") return { label: "❌ Annulé (paiement)", cls: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30" }
    if (s === "AUTHORIZED") return { label: "🔒 Autorisé", cls: "bg-sky-500/15 text-sky-300 border-sky-500/30" }
    return { label: status || "—", cls: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30" }
  }

  function fulfillmentBadge(status: string) {
    const s = status.toUpperCase()
    if (s === "FULFILLED") return { label: "📦 Expédié", cls: "bg-emerald-500/15 text-emerald-300" }
    if (s === "PARTIALLY_FULFILLED") return { label: "📦 Partiellement expédié", cls: "bg-amber-500/15 text-amber-300" }
    if (s === "UNFULFILLED") return { label: "📋 Non expédié", cls: "bg-zinc-500/15 text-zinc-400" }
    if (s === "RESTOCKED") return { label: "🔁 Restocké", cls: "bg-violet-500/15 text-violet-300" }
    return { label: status, cls: "bg-zinc-500/15 text-zinc-400" }
  }

  function shopifyAdminUrl(order: CommandeShopify) {
    if (!order.shopify_order_legacy_id) return null
    return `https://admin.shopify.com/store/le-meuble/orders/${order.shopify_order_legacy_id}`
  }

  // Stats globales
  const totalCA = commandes
    .filter(c => !c.cancelled_at && c.financial_status === "PAID")
    .reduce((sum, c) => sum + (c.total_price || 0), 0)
  const nbActives = commandes.filter(c => !c.cancelled_at).length
  const nbAnnulees = commandes.filter(c => c.cancelled_at).length

  return (
    <div className="rounded-2xl border border-orange-500/20 bg-[#2a2d31] p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          🛍️ <span>Commandes Shopify</span>
          <span className="ml-2 text-sm font-normal text-zinc-400">({commandes.length})</span>
        </h2>
        <div className="flex items-center gap-4 text-xs text-zinc-400">
          <span>{nbActives} active{nbActives > 1 ? "s" : ""}</span>
          {nbAnnulees > 0 && <span className="text-rose-300/70">{nbAnnulees} annulée{nbAnnulees > 1 ? "s" : ""}</span>}
          <span className="font-mono text-emerald-300">{fmtMoney(totalCA, "CHF")} CA payé</span>
        </div>
      </div>

      <div className="space-y-2">
        {commandes.map(cmd => {
          const isExpanded = expandedIds.has(cmd.id)
          const finBadge = financialBadge(cmd.financial_status)
          const fulBadge = fulfillmentBadge(cmd.fulfillment_status)
          const adminUrl = shopifyAdminUrl(cmd)
          const isCancelled = !!cmd.cancelled_at

          return (
            <div key={cmd.id}
              className={`rounded-xl border ${isCancelled ? "border-rose-500/20 bg-rose-500/5 opacity-70" : "border-white/10 bg-[#1f2125]"} overflow-hidden`}>

              {/* Ligne compacte (cliquable) */}
              <button onClick={() => toggleExpand(cmd.id)}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-white/5 transition text-left">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <span className="text-xs">{isExpanded ? "▼" : "▶"}</span>
                  <span className={`font-mono font-semibold text-sm ${isCancelled ? "line-through text-zinc-500" : "text-orange-300"}`}>
                    {cmd.shopify_order_name}
                  </span>
                  <span className="text-xs text-zinc-500">
                    {fmtDateTime(cmd.created_at_shopify)}
                  </span>
                  {cmd.test && (
                    <span className="rounded-full bg-purple-500/15 px-2 py-0.5 text-xs text-purple-300">TEST</span>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${finBadge.cls}`}>
                    {finBadge.label}
                  </span>
                  {!isCancelled && (
                    <span className={`rounded-full px-2 py-0.5 text-xs ${fulBadge.cls}`}>
                      {fulBadge.label}
                    </span>
                  )}
                  {isCancelled && (
                    <span className="rounded-full border border-rose-500/30 bg-rose-500/15 px-2 py-0.5 text-xs text-rose-300">
                      ❌ Annulée
                    </span>
                  )}
                  <span className="font-mono text-sm font-semibold text-zinc-100 min-w-[100px] text-right">
                    {fmtMoney(cmd.total_price, cmd.currency)}
                  </span>
                  {/* Icône facture rapide en vue compacte */}
                  {(() => {
                    const pdfs = getShopifyPdfUrls(cmd.shopify_order_legacy_id, cmd.shopify_order_name)
                    if (!pdfs.facture) return null
                    return (
                      <a
                        href={pdfs.facture}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        title="Télécharger la facture PDF"
                        className="inline-flex items-center justify-center w-7 h-7 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 transition flex-shrink-0"
                      >
                        💰
                      </a>
                    )
                  })()}
                </div>
              </button>

              {/* Détail (expandable) */}
              {isExpanded && (
                <div className="border-t border-white/5 bg-black/20 px-4 py-3 space-y-3 text-sm">

                  {/* Liens Shopify */}
                  <div className="flex flex-wrap gap-2">
                    {adminUrl && (
                      <a href={adminUrl} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-300 hover:bg-emerald-500/20">
                        🛍️ Voir sur Shopify Admin
                      </a>
                    )}
                    {cmd.status_page_url && (
                      <a href={cmd.status_page_url} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-xs text-sky-300 hover:bg-sky-500/20">
                        🧾 Reçu client (page de suivi)
                      </a>
                    )}
                  </div>

                  {/* Documents PDF Order Printer Pro */}
                  {(() => {
                    const pdfs = getShopifyPdfUrls(cmd.shopify_order_legacy_id, cmd.shopify_order_name)
                    if (!pdfs.ficheTravail) return null
                    return (
                      <div>
                        <div className="text-xs font-semibold uppercase text-zinc-500 mb-1.5">📄 Documents PDF</div>
                        <div className="flex flex-wrap gap-2">
                          <a href={pdfs.ficheTravail} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-300 hover:bg-amber-500/20">
                            📋 Fiche de travail
                          </a>
                          <a href={pdfs.bulletinLivraison!} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-1.5 text-xs text-violet-300 hover:bg-violet-500/20">
                            📦 Bulletin de livraison
                          </a>
                          <a href={pdfs.facture!} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-300 hover:bg-emerald-500/20">
                            💰 Facture
                          </a>
                        </div>
                        <div className="text-[10px] text-zinc-600 mt-1 italic">
                          Documents générés par Order Printer Pro · Si erreur 404, le PDF n&apos;est pas disponible pour cette commande
                        </div>
                      </div>
                    )
                  })()}

                  {/* Annulation */}
                  {isCancelled && (
                    <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-2 text-xs text-rose-300">
                      ❌ Commande annulée le {fmtDateTime(cmd.cancelled_at!)}
                      {cmd.cancel_reason && <span> · Raison : {cmd.cancel_reason}</span>}
                    </div>
                  )}

                  {/* Articles */}
                  {cmd.line_items && cmd.line_items.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold uppercase text-zinc-500 mb-1.5">Articles ({cmd.line_items.length})</div>
                      <div className="space-y-1">
                        {cmd.line_items.map((item, i) => (
                          <div key={i} className="flex items-center justify-between gap-3 rounded-lg bg-white/[0.02] px-3 py-1.5">
                            <div className="flex-1 min-w-0">
                              <div className="text-zinc-200 text-sm">{item.title || item.name}</div>
                              {item.sku && <div className="text-xs text-zinc-500 font-mono">{item.sku}</div>}
                            </div>
                            <div className="text-zinc-400 text-xs">×{item.quantity}</div>
                            {item.price && (
                              <div className="font-mono text-xs text-zinc-300 min-w-[80px] text-right">
                                {fmtMoney(parseFloat(item.price) * item.quantity, cmd.currency)}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Adresse de livraison */}
                  {cmd.shipping_address && (
                    <div>
                      <div className="text-xs font-semibold uppercase text-zinc-500 mb-1">Livraison</div>
                      <div className="text-xs text-zinc-300 leading-relaxed">
                        {cmd.shipping_address.address1}
                        {cmd.shipping_address.address2 && <><br/>{cmd.shipping_address.address2}</>}
                        <br/>
                        {cmd.shipping_address.zip} {cmd.shipping_address.city}
                        {cmd.shipping_address.country && <>, {cmd.shipping_address.country}</>}
                      </div>
                    </div>
                  )}

                  {/* Détail montants */}
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    <div className="flex justify-between">
                      <span className="text-zinc-500">Sous-total</span>
                      <span className="font-mono text-zinc-300">{fmtMoney(cmd.subtotal_price, cmd.currency)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-500">TVA</span>
                      <span className="font-mono text-zinc-300">{fmtMoney(cmd.total_tax, cmd.currency)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-500">Livraison</span>
                      <span className="font-mono text-zinc-300">{fmtMoney(cmd.total_shipping, cmd.currency)}</span>
                    </div>
                    <div className="flex justify-between font-semibold">
                      <span className="text-zinc-300">TOTAL</span>
                      <span className="font-mono text-zinc-100">{fmtMoney(cmd.total_price, cmd.currency)}</span>
                    </div>
                  </div>

                  {/* Tags & note */}
                  {(cmd.tags?.length > 0 || cmd.note) && (
                    <div className="flex flex-wrap gap-2 items-center">
                      {cmd.tags?.length > 0 && cmd.tags.map((tag, i) => (
                        <span key={i} className="rounded-full bg-white/5 px-2 py-0.5 text-xs text-zinc-400">
                          {tag}
                        </span>
                      ))}
                      {cmd.note && (
                        <div className="text-xs italic text-amber-300/80">
                          📝 {cmd.note}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Source */}
                  <div className="text-xs text-zinc-500">
                    Source : {cmd.source_name || "web"}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [client, setClient] = useState<Client | null>(null)
  const [offres, setOffres] = useState<Offre[]>([])
  const [commandesShopify, setCommandesShopify] = useState<CommandeShopify[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState("")
  const [saveKind, setSaveKind] = useState<"success" | "error">("success")
  const [form, setForm] = useState<Partial<Client>>({})
  const [emailCopied, setEmailCopied] = useState(false)
  const [factures, setFactures] = useState<Facture[]>([])
  const [showAddFacture, setShowAddFacture] = useState(false)
  const [newFacture, setNewFacture] = useState({ numero_facture: "", date_facture: "", montant: "" })
  const [addingFacture, setAddingFacture] = useState(false)
  const [addFactureError, setAddFactureError] = useState("")
  const [factureFile, setFactureFile] = useState<File | null>(null)
  const [factureDragOver, setFactureDragOver] = useState(false)

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
        setCommandesShopify(json.commandesShopify || [])
        try {
          const fRes = await fetch(`/api/clients/${id}/factures`)
          if (fRes.ok) {
            const fJson = await fRes.json()
            setFactures(fJson.factures || [])
          }
        } catch { /* ignore */ }
      } catch { /* ignore */ }
      finally { setLoading(false) }
    }
    load()
  }, [params])

  async function saveClient() {
    if (!client) return
    setSaving(true); setSaveStatus("")
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

  async function addFacture() {
    if (!client || !newFacture.numero_facture.trim()) { setAddFactureError("Numéro requis"); return }
    setAddingFacture(true); setAddFactureError("")
    try {
      let pdfUrl: string | null = null
      if (factureFile) {
        const formData = new FormData()
        formData.append("file", factureFile)
        formData.append("numero_facture", newFacture.numero_facture.trim())
        const upRes = await fetch(`/api/clients/${client.id}/factures/upload`, {
          method: "POST",
          body: formData,
        })
        const upText = await upRes.text()
        console.log("Upload response:", upRes.status, upText)
        const upJson = upText ? JSON.parse(upText) : {}
        if (!upRes.ok) throw new Error(upJson.error || "Erreur upload PDF")
        pdfUrl = upJson.pdf_url
      }
      const res = await fetch(`/api/clients/${client.id}/factures`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          numero_facture: newFacture.numero_facture.trim(),
          date_facture: newFacture.date_facture || null,
          montant: newFacture.montant ? parseFloat(newFacture.montant) : null,
          pdf_url: pdfUrl,
        })
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Erreur")
      setFactures(prev => [json.facture, ...prev])
      setNewFacture({ numero_facture: "", date_facture: "", montant: "" })
      setFactureFile(null)
      setShowAddFacture(false)
    } catch (e) { setAddFactureError((e as Error).message) }
    finally { setAddingFacture(false) }
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
  const caWinbiz = factures.reduce((s, f) => s + (f.montant || 0), 0)

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
              complement_nom: client.complement_nom || "",
              email: client.email || "", telephone1: client.tel1 || "",
              rue: client.rue || "", numero: client.numero_rue || "",
              npa: client.npa || "", ville: client.ville || "",
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
            <div className="flex gap-4 text-right flex-wrap">
              <div className="rounded-xl border border-white/10 bg-black/10 px-6 py-3">
                <div className="text-xs text-zinc-400">Offres</div>
                <div className="mt-1 text-2xl font-bold">{offres.length}</div>
              </div>
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-6 py-3">
                <div className="text-xs text-zinc-400">CA offres</div>
                <div className="mt-1 text-2xl font-bold text-emerald-300">{fmtMoney(caTotal)}</div>
              </div>
              {caWinbiz > 0 && (
                <div className="rounded-xl border border-sky-500/20 bg-sky-500/10 px-6 py-3">
                  <div className="text-xs text-zinc-400">CA WinBiz</div>
                  <div className="mt-1 text-2xl font-bold text-sky-300">{fmtMoney(caWinbiz)}</div>
                </div>
              )}
              {commandesShopify.length > 0 && (() => {
                const caShopify = commandesShopify
                  .filter(c => !c.cancelled_at && c.financial_status === "PAID")
                  .reduce((s, c) => s + (c.total_price || 0), 0)
                return (
                  <div className="rounded-xl border border-orange-500/20 bg-orange-500/10 px-6 py-3">
                    <div className="text-xs text-zinc-400">CA Shopify</div>
                    <div className="mt-1 text-2xl font-bold text-orange-300">{fmtMoney(caShopify)}</div>
                  </div>
                )
              })()}
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
                  {/* Société */}
                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-zinc-400">Société</label>
                    <input type="text" value={(form.societe as string) || ""}
                      onChange={e => setForm(p => ({ ...p, societe: e.target.value }))}
                      className="w-full rounded-xl border border-white/10 bg-[#1f2125] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-[#2B8AD1]"/>
                  </div>

                  {/* Nom + Prénom */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-zinc-400">Nom *</label>
                      <input type="text" value={(form.nom as string) || ""}
                        onChange={e => setForm(p => ({ ...p, nom: e.target.value }))}
                        className="w-full rounded-xl border border-white/10 bg-[#1f2125] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-[#2B8AD1]"/>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-zinc-400">Prénom</label>
                      <input type="text" value={(form.prenom as string) || ""}
                        onChange={e => setForm(p => ({ ...p, prenom: e.target.value }))}
                        className="w-full rounded-xl border border-white/10 bg-[#1f2125] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-[#2B8AD1]"/>
                    </div>
                  </div>

                  {/* Complément nom */}
                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-zinc-400">Complément nom (optionnel)</label>
                    <input type="text" value={(form.complement_nom as string) || ""}
                      onChange={e => setForm(p => ({ ...p, complement_nom: e.target.value }))}
                      placeholder="conjoint, c/o, contact..."
                      className="w-full rounded-xl border border-white/10 bg-[#1f2125] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-[#2B8AD1]"/>
                  </div>

                  {/* Rue + N° */}
                  <div className="grid grid-cols-[1fr_100px] gap-3">
                    <div>
                      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-zinc-400">Rue</label>
                      <input type="text" value={(form.rue as string) || ""}
                        onChange={e => setForm(p => ({ ...p, rue: e.target.value }))}
                        className="w-full rounded-xl border border-white/10 bg-[#1f2125] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-[#2B8AD1]"/>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-zinc-400">N°</label>
                      <input type="text" value={(form.numero_rue as string) || ""}
                        onChange={e => setForm(p => ({ ...p, numero_rue: e.target.value }))}
                        className="w-full rounded-xl border border-white/10 bg-[#1f2125] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-[#2B8AD1]"/>
                    </div>
                  </div>

                  {/* Complément d'adresse */}
                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-zinc-400">Complément d&apos;adresse</label>
                    <input type="text" value={(form.rue2 as string) || ""}
                      onChange={e => setForm(p => ({ ...p, rue2: e.target.value }))}
                      placeholder="Bâtiment, case postale, lieu-dit..."
                      className="w-full rounded-xl border border-white/10 bg-[#1f2125] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-[#2B8AD1]"/>
                  </div>

                  {/* NPA + Ville */}
                  <div className="grid grid-cols-[100px_1fr] gap-3">
                    <div>
                      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-zinc-400">NPA</label>
                      <input type="text" value={(form.npa as string) || ""}
                        onChange={e => setForm(p => ({ ...p, npa: e.target.value }))}
                        className="w-full rounded-xl border border-white/10 bg-[#1f2125] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-[#2B8AD1]"/>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-zinc-400">Ville</label>
                      <input type="text" value={(form.ville as string) || ""}
                        onChange={e => setForm(p => ({ ...p, ville: e.target.value }))}
                        className="w-full rounded-xl border border-white/10 bg-[#1f2125] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-[#2B8AD1]"/>
                    </div>
                  </div>

                  {/* Tél 1 + Tél 2 */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-zinc-400">Téléphone 1</label>
                      <input type="text" value={(form.tel1 as string) || ""}
                        onChange={e => setForm(p => ({ ...p, tel1: e.target.value }))}
                        className="w-full rounded-xl border border-white/10 bg-[#1f2125] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-[#2B8AD1]"/>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-zinc-400">Téléphone 2</label>
                      <input type="text" value={(form.tel2 as string) || ""}
                        onChange={e => setForm(p => ({ ...p, tel2: e.target.value }))}
                        className="w-full rounded-xl border border-white/10 bg-[#1f2125] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-[#2B8AD1]"/>
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-zinc-400">Email</label>
                    <input type="email" value={(form.email as string) || ""}
                      onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                      className="w-full rounded-xl border border-white/10 bg-[#1f2125] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-[#2B8AD1]"/>
                  </div>
                  <div className="pt-2 border-t border-white/5 space-y-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">📦 Adresse de livraison (si différente)</div>

                    {/* Société livraison */}
                    <div>
                      <label className="mb-1 block text-xs text-zinc-500">Société</label>
                      <input type="text" value={(form.livr_societe as string) || ""}
                        onChange={e => setForm(p => ({ ...p, livr_societe: e.target.value }))}
                        className="w-full rounded-xl border border-white/10 bg-[#1f2125] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-[#2B8AD1]"/>
                    </div>

                    {/* Nom + Prénom livraison */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="mb-1 block text-xs text-zinc-500">Nom livraison</label>
                        <input type="text" value={(form.livr_nom as string) || ""}
                          onChange={e => setForm(p => ({ ...p, livr_nom: e.target.value }))}
                          className="w-full rounded-xl border border-white/10 bg-[#1f2125] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-[#2B8AD1]"/>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-zinc-500">Prénom</label>
                        <input type="text" value={(form.livr_prenom as string) || ""}
                          onChange={e => setForm(p => ({ ...p, livr_prenom: e.target.value }))}
                          className="w-full rounded-xl border border-white/10 bg-[#1f2125] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-[#2B8AD1]"/>
                      </div>
                    </div>

                    {/* Complément nom livraison */}
                    <div>
                      <label className="mb-1 block text-xs text-zinc-500">Complément nom livraison (optionnel)</label>
                      <input type="text" value={(form.livr_complement_nom as string) || ""}
                        onChange={e => setForm(p => ({ ...p, livr_complement_nom: e.target.value }))}
                        placeholder="conjoint, c/o, contact..."
                        className="w-full rounded-xl border border-white/10 bg-[#1f2125] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-[#2B8AD1]"/>
                    </div>

                    {/* Rue livraison (avec n° dedans car pas de colonne livr_numero_rue en base) */}
                    <div>
                      <label className="mb-1 block text-xs text-zinc-500">Rue (avec n°)</label>
                      <input type="text" value={(form.livr_rue as string) || ""}
                        onChange={e => setForm(p => ({ ...p, livr_rue: e.target.value }))}
                        className="w-full rounded-xl border border-white/10 bg-[#1f2125] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-[#2B8AD1]"/>
                    </div>

                    {/* Complément d'adresse livraison */}
                    <div>
                      <label className="mb-1 block text-xs text-zinc-500">Complément d&apos;adresse</label>
                      <input type="text" value={(form.livr_rue2 as string) || ""}
                        onChange={e => setForm(p => ({ ...p, livr_rue2: e.target.value }))}
                        className="w-full rounded-xl border border-white/10 bg-[#1f2125] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-[#2B8AD1]"/>
                    </div>

                    {/* NPA + Ville livraison */}
                    <div className="grid grid-cols-[100px_1fr] gap-3">
                      <div>
                        <label className="mb-1 block text-xs text-zinc-500">NPA</label>
                        <input type="text" value={(form.livr_npa as string) || ""}
                          onChange={e => setForm(p => ({ ...p, livr_npa: e.target.value }))}
                          className="w-full rounded-xl border border-white/10 bg-[#1f2125] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-[#2B8AD1]"/>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-zinc-500">Ville</label>
                        <input type="text" value={(form.livr_ville as string) || ""}
                          onChange={e => setForm(p => ({ ...p, livr_ville: e.target.value }))}
                          className="w-full rounded-xl border border-white/10 bg-[#1f2125] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-[#2B8AD1]"/>
                      </div>
                    </div>

                    {/* Tél livraison */}
                    <div>
                      <label className="mb-1 block text-xs text-zinc-500">Tél.</label>
                      <input type="text" value={(form.livr_tel as string) || ""}
                        onChange={e => setForm(p => ({ ...p, livr_tel: e.target.value }))}
                        className="w-full rounded-xl border border-white/10 bg-[#1f2125] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-[#2B8AD1]"/>
                    </div>
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
                    ["Société", client.societe],
                    ["Nom", [client.nom, client.prenom].filter(Boolean).join(" ")],
                    ["Complément nom", client.complement_nom],
                    ["Rue", [client.rue, client.numero_rue].filter(Boolean).join(" ")],
                    ["Complément d'adresse", client.rue2],
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

                  {client.livr_rue && (
                    <div className="mt-3 rounded-xl border border-white/10 bg-black/10 p-3 space-y-1">
                      <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-2">📦 Adresse de livraison</div>
                      {([
                        ["Société", client.livr_societe],
                        ["Nom", [client.livr_nom, client.livr_prenom].filter(Boolean).join(" ")],
                        ["Complément nom livraison", client.livr_complement_nom],
                        ["Rue", client.livr_rue],
                        ["Complément d'adresse", client.livr_rue2],
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
                    complement_nom: client.complement_nom || "",
                    email: client.email || "", telephone1: client.tel1 || "",
                    rue: client.rue || "", numero: client.numero_rue || "",
                    npa: client.npa || "", ville: client.ville || "",
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
{/* COMMANDES SHOPIFY */}
        <CommandesShopifyBlock commandes={commandesShopify} />

        {/* FACTURES WINBIZ */}
        <section className="rounded-2xl border border-white/10 bg-[#2a2d31] p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-semibold">Factures WinBiz</h2>
            <div className="flex items-center gap-3">
              <span className="text-sm text-zinc-400">{factures.length} facture{factures.length !== 1 ? "s" : ""}</span>
              <button onClick={() => setShowAddFacture(v => !v)}
                className="rounded-xl border border-sky-500/30 bg-sky-500/15 px-3 py-1.5 text-xs text-sky-300 hover:bg-sky-500/20">
                + Ajouter
              </button>
            </div>
          </div>

          {showAddFacture && (
            <div className="mb-4 rounded-xl border border-sky-500/20 bg-[#1f2125] p-4 space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-zinc-400">N° Facture *</label>
                  <input type="text" value={newFacture.numero_facture}
                    onChange={e => setNewFacture(p => ({...p, numero_facture: e.target.value}))}
                    placeholder="53999"
                    className="w-full rounded-xl border border-white/10 bg-[#2a2d31] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-[#2B8AD1]"/>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-zinc-400">Date</label>
                  <input type="date" value={newFacture.date_facture}
                    onChange={e => setNewFacture(p => ({...p, date_facture: e.target.value}))}
                    className="w-full rounded-xl border border-white/10 bg-[#2a2d31] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-[#2B8AD1]"/>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-zinc-400">Montant CHF</label>
                  <input type="number" value={newFacture.montant}
                    onChange={e => setNewFacture(p => ({...p, montant: e.target.value}))}
                    placeholder="1500"
                    className="w-full rounded-xl border border-white/10 bg-[#2a2d31] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-[#2B8AD1]"/>
                </div>
              </div>
              {/* Zone upload PDF */}
              <div
                onDragOver={e => { e.preventDefault(); setFactureDragOver(true) }}
                onDragLeave={() => setFactureDragOver(false)}
                onDrop={e => {
                  e.preventDefault(); setFactureDragOver(false)
                  const f = e.dataTransfer.files?.[0]
                  if (f && f.type === "application/pdf") setFactureFile(f)
                  else setAddFactureError("Fichier PDF uniquement")
                }}
                className={`rounded-xl border-2 border-dashed p-4 text-center text-sm transition cursor-pointer ${factureDragOver ? "border-sky-400 bg-sky-500/10" : "border-white/10 bg-[#2a2d31]"}`}>
                <input type="file" accept=".pdf" className="hidden" id="facture-pdf-input"
                  onChange={e => {
                    const f = e.target.files?.[0]
                    if (f) setFactureFile(f)
                    e.target.value = ""
                  }}
                />
                <label htmlFor="facture-pdf-input" className="cursor-pointer">
                  {factureFile ? (
                    <div className="flex items-center justify-center gap-2 text-emerald-300">
                      <span>📄 {factureFile.name}</span>
                      <button type="button" onClick={e => { e.preventDefault(); setFactureFile(null) }}
                        className="text-zinc-500 hover:text-rose-300">✕</button>
                    </div>
                  ) : (
                    <span className="text-zinc-500">📎 Glissez un PDF ici ou <span className="text-sky-400 underline">cliquez pour sélectionner</span></span>
                  )}
                </label>
              </div>
              {addFactureError && <div className="text-xs text-rose-300">{addFactureError}</div>}
              <div className="flex gap-2">
                <button onClick={addFacture} disabled={addingFacture}
                  className="rounded-xl bg-[#2B8AD1] px-4 py-2 text-sm font-semibold text-white hover:bg-[#2478b8] disabled:opacity-50">
                  {addingFacture ? "Enregistrement…" : "Enregistrer"}
                </button>
                <button onClick={() => { setShowAddFacture(false); setFactureFile(null) }}
                  className="rounded-xl border border-white/10 bg-[#34383d] px-4 py-2 text-sm text-zinc-300 hover:bg-[#40454b]">
                  Annuler
                </button>
              </div>
            </div>
          )}

          {factures.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-black/10 p-6 text-center text-zinc-500">
              Aucune facture WinBiz importée pour ce client.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse text-sm">
                <thead className="bg-black/10 text-left text-zinc-400">
                  <tr>
                    <th className="px-4 py-3 font-medium">N° Facture</th>
                    <th className="px-4 py-3 font-medium">Date</th>
                    <th className="px-4 py-3 font-medium text-right">Montant</th>
                    <th className="px-4 py-3 font-medium text-right">PDF</th>
                  </tr>
                </thead>
                <tbody>
                  {factures.sort((a, b) => (b.numero_facture > a.numero_facture ? 1 : -1)).map((f, idx) => (
                    <tr key={f.id}
                      className={`border-t border-white/5 text-zinc-200 ${idx % 2 === 0 ? "bg-white/[0.02]" : "bg-white/[0.04]"}`}>
                      <td className="px-4 py-3 font-mono text-xs font-semibold text-[#2B8AD1]">#{f.numero_facture}</td>
                      <td className="px-4 py-3 text-zinc-400">{fmtDate(f.date_facture)}</td>
                      <td className="px-4 py-3 text-right font-medium text-zinc-100">{fmtMoney(f.montant)}</td>
                      <td className="px-4 py-3 text-right">
                        {f.pdf_url ? (
                          <a href={f.pdf_url} target="_blank" rel="noopener noreferrer"
                            className="rounded-lg border border-sky-500/30 bg-sky-500/15 px-3 py-1.5 text-xs text-sky-300 hover:bg-sky-500/20">
                            📄 Ouvrir
                          </a>
                        ) : <span className="text-zinc-600">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

      </div>
    </main>
  )
}