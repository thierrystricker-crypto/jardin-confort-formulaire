"use client";
// app/dashboard/clients/page.tsx

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

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
  created_at: string
  updated_at: string
  // Compteurs documents (enrichis par /api/clients GET)
  nb_offres?: number
  nb_commandes_internes?: number
  nb_commandes_shopify?: number
  nb_factures_winbiz?: number
}

function normalizeSwissPhone(raw: string) {
  const digits = raw.replace(/[^\d]/g, "")
  if (!digits) return ""
  let n = digits
  if (n.startsWith("0041")) n = "41" + n.slice(4)
  else if (n.startsWith("0")) n = "41" + n.slice(1)
  else if (!n.startsWith("41")) n = "41" + n
  const t = n.slice(0, 11)
  return ["+" + t.slice(0, 2), t.slice(2, 4), t.slice(4, 7), t.slice(7, 9), t.slice(9, 11)].filter(Boolean).join(" ")
}

function nomClient(c: Client) {
  return [c.nom, c.prenom].filter(Boolean).join(" ") || c.societe || "—"
}
function fmtDate(iso: string | null) {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("fr-CH", { day: "2-digit", month: "2-digit", year: "numeric" })
}
function sourceLabel(s: string | null) {
  if (s === "shopify") return { label: "Shopify", cls: "bg-emerald-500/15 text-emerald-300" }
  if (s === "winbiz")  return { label: "WinBiz",  cls: "bg-sky-500/15 text-sky-300" }
  if (s === "offre")   return { label: "Offre",   cls: "bg-amber-500/15 text-amber-300" }
  return { label: "Manuel", cls: "bg-white/5 text-zinc-400" }
}

// ─── Badges compacts pour les documents liés à un client ───
// Affiche uniquement les badges avec au moins 1 document.
// Tiret — si aucun document.
// ─── Bouton synchronisation Shopify ───────────────────
function ShopifySyncButton({ onDone }: { onDone: () => void }) {
  const [syncing, setSyncing] = useState(false)
  const [result, setResult] = useState<{
    ordersFetched: number
    ordersInserted: number
    ordersUpdated: number
    clientsMatched: number
    clientsCreated: number
    errors: Array<{ shopifyId: string; message: string }>
    durationMs: number
  } | null>(null)
  const [error, setError] = useState("")

  async function handleSync() {
    if (!confirm("⚠️ Synchroniser TOUTES les commandes Shopify ? Cette opération peut prendre plusieurs minutes pour le premier lancement.")) return

    setSyncing(true)
    setError("")
    setResult(null)

    try {
      const res = await fetch("/api/shopify/sync-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ syncType: "manual" })
      })
      const json = await res.json()
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Erreur de synchronisation")
      }
      setResult(json)
      onDone()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSyncing(false)
    }
  }

  return (
    <>
      <button
        onClick={handleSync}
        disabled={syncing}
        className="inline-flex items-center rounded-xl border border-emerald-500/30 bg-emerald-500/15 px-4 py-2 text-sm text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
        title="Importer les commandes Shopify dans la base"
      >
        {syncing ? "⏳ Synchro en cours…" : "🛍️ Sync Shopify"}
      </button>

      {/* Modal résultat */}
      {(result || error) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => { setResult(null); setError("") }}>
          <div className="max-w-md w-full rounded-2xl border border-white/10 bg-[#2a2d31] p-6"
            onClick={e => e.stopPropagation()}>
            {error ? (
              <>
                <h3 className="text-lg font-semibold text-rose-300 mb-3">❌ Erreur de synchronisation</h3>
                <p className="text-sm text-zinc-300 mb-4">{error}</p>
              </>
            ) : result && (
              <>
                <h3 className="text-lg font-semibold text-emerald-300 mb-3">✅ Synchronisation Shopify terminée</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-zinc-400">Commandes récupérées</span>
                    <span className="font-mono text-zinc-100">{result.ordersFetched}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-400">→ Nouvelles</span>
                    <span className="font-mono text-emerald-300">+{result.ordersInserted}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-400">→ Mises à jour</span>
                    <span className="font-mono text-sky-300">↻{result.ordersUpdated}</span>
                  </div>
                  <hr className="border-white/10 my-2" />
                  <div className="flex justify-between">
                    <span className="text-zinc-400">Clients existants matchés</span>
                    <span className="font-mono text-zinc-100">{result.clientsMatched}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-400">Nouveaux clients créés</span>
                    <span className="font-mono text-amber-300">+{result.clientsCreated}</span>
                  </div>
                  {result.errors.length > 0 && (
                    <>
                      <hr className="border-white/10 my-2" />
                      <div className="flex justify-between text-rose-300">
                        <span>Erreurs</span>
                        <span className="font-mono">{result.errors.length}</span>
                      </div>
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs text-zinc-500">Voir détails</summary>
                        <div className="mt-2 max-h-40 overflow-y-auto rounded-lg bg-black/30 p-2 text-xs font-mono text-rose-300/80">
                          {result.errors.map((e, i) => (
                            <div key={i} className="mb-1">{e.shopifyId} : {e.message}</div>
                          ))}
                        </div>
                      </details>
                    </>
                  )}
                  <hr className="border-white/10 my-2" />
                  <div className="flex justify-between text-xs text-zinc-500">
                    <span>Durée</span>
                    <span className="font-mono">{(result.durationMs / 1000).toFixed(1)}s</span>
                  </div>
                </div>
              </>
            )}
            <button onClick={() => { setResult(null); setError("") }}
              className="mt-4 w-full rounded-xl bg-[#34383d] px-4 py-2 text-sm text-zinc-100 hover:bg-[#40454b]">
              Fermer
            </button>
          </div>
        </div>
      )}
    </>
  )
}
function DocBadges({ client }: { client: Client }) {
  const offres = client.nb_offres || 0
  const commandes = client.nb_commandes_internes || 0
  const shopify = client.nb_commandes_shopify || 0
  const factures = client.nb_factures_winbiz || 0
  const hasAny = offres + commandes + shopify + factures > 0

  if (!hasAny) return <span className="text-zinc-600">—</span>

  return (
    <div className="flex flex-wrap gap-1.5">
      {offres > 0 && (
        <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-300"
          title={`${offres} offre${offres > 1 ? "s" : ""} active${offres > 1 ? "s" : ""}`}>
          📄 {offres}
        </span>
      )}
      {commandes > 0 && (
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-300"
          title={`${commandes} commande${commandes > 1 ? "s" : ""} interne${commandes > 1 ? "s" : ""} (CMD)`}>
          🛒 {commandes}
        </span>
      )}
      {shopify > 0 && (
        <span className="inline-flex items-center gap-1 rounded-full border border-orange-500/30 bg-orange-500/10 px-2 py-0.5 text-xs font-semibold text-orange-300"
          title={`${shopify} commande${shopify > 1 ? "s" : ""} Shopify`}>
          🛍️ {shopify}
        </span>
      )}
      {factures > 0 && (
        <span className="inline-flex items-center gap-1 rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-xs font-semibold text-violet-300"
          title={`${factures} facture${factures > 1 ? "s" : ""} WinBiz`}>
          📊 {factures}
        </span>
      )}
    </div>
  )
}

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([])
  const [totalClients, setTotalClients] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [showImport, setShowImport] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const addrDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [addrSuggestions, setAddrSuggestions] = useState<{placeId:string;label:string}[]>([])

  async function fetchSuggestions(q: string) {
    if (q.length < 3) { setAddrSuggestions([]); return }
    try {
      const res = await fetch(`/api/places?type=autocomplete&q=${encodeURIComponent(q)}`)
      const json = await res.json()
      setAddrSuggestions((json.predictions||[]).map((p:{place_id:string;description:string}) => ({
        placeId: p.place_id,
        label: p.description.replace(", Suisse","").replace(", Switzerland","")
      })))
    } catch { setAddrSuggestions([]) }
  }

  async function applyAddrSuggestion(s: {placeId:string;label:string}) {
    setAddrSuggestions([])
    try {
      const res = await fetch(`/api/places?type=details&place_id=${encodeURIComponent(s.placeId)}`)
      const json = await res.json()
      if (json.status !== "OK") return
      const comps = json.result?.address_components || []
      const get = (type: string) => comps.find((c:{types:string[];long_name:string}) => c.types.includes(type))?.long_name || ""
      const getShort = (type: string) => comps.find((c:{types:string[];short_name:string}) => c.types.includes(type))?.short_name || ""
      setNewClient(p => ({
        ...p,
        rue: get("route"),
        numero_rue: get("street_number"),
        npa: getShort("postal_code").slice(0,4),
        ville: get("locality") || get("administrative_area_level_2"),
      }))
    } catch { /* ignore */ }
  }

  // Import state
  const [csvText, setCsvText] = useState("")
  const [csvFormat, setCsvFormat] = useState<"auto"|"shopify"|"winbiz">("auto")
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<{inserted:number;skipped:number;errors:number;total:number}|null>(null)
  const [importError, setImportError] = useState("")

  // Nouveau client state
  const [newClient, setNewClient] = useState({
    nom:"", prenom:"", societe:"", email:"", tel1:"", tel2:"",
    rue:"", rue2:"", numero_rue:"", npa:"", ville:"", notes:""
  })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState("")

  // Recherche client live
  const [clientSuggestions, setClientSuggestions] = useState<Client[]>([])
  const [clientSearchField, setClientSearchField] = useState<"nom"|"email"|"tel"|null>(null)
  const clientSearchRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function searchClientSuggestions(q: string, field: "nom"|"email"|"tel") {
    if (q.length < 2) { setClientSuggestions([]); return }
    try {
      let searchQ = q
      if (field === "tel") {
        let digits = q.replace(/[^\d]/g, "")
        if (digits.startsWith("0041")) digits = digits.slice(4)
        else if (digits.startsWith("41") && digits.length > 6) digits = digits.slice(2)
        else if (digits.startsWith("0")) digits = digits.slice(1)
        searchQ = digits.length >= 2 ? digits : q
      }
      const res = await fetch(`/api/clients?q=${encodeURIComponent(searchQ)}&limit=5`)
      const json = await res.json()
      setClientSuggestions(json.clients || [])
      setClientSearchField(field)
    } catch { setClientSuggestions([]) }
  }

  // Ne pas appliquer — juste naviguer vers la fiche
  function applyClientSuggestion(c: Client) {
    window.open(`/dashboard/clients/${c.id}`, "_blank")
    setClientSuggestions([])
  }

  function closeClientDropdown() {
    setTimeout(() => setClientSuggestions([]), 200)
  }

  const fetchClients = useCallback(async (q: string) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/clients?q=${encodeURIComponent(q)}&limit=2000`)
      const json = await res.json()
      setClients(json.clients || [])
      if (json.total !== undefined) setTotalClients(json.total)
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchClients("") }, [fetchClients])

  useEffect(() => {
    if (searchRef.current) clearTimeout(searchRef.current)
    searchRef.current = setTimeout(() => fetchClients(search), 300)
    return () => { if (searchRef.current) clearTimeout(searchRef.current) }
  }, [search, fetchClients])

  async function handleImport() {
    if (!csvText.trim()) return
    setImporting(true); setImportError(""); setImportResult(null)
    try {
      const res = await fetch("/api/clients/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: csvText, format: csvFormat })
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Erreur import")
      setImportResult(json)
      setCsvText("")
      fetchClients(search)
    } catch (e) { setImportError((e as Error).message) }
    finally { setImporting(false) }
  }

  async function handleNewClient() {
    if (!newClient.nom.trim()) { setSaveError("Nom requis"); return }
    setSaving(true); setSaveError("")
    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newClient)
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Erreur")
      setShowNew(false)
      setNewClient({ nom:"", prenom:"", societe:"", email:"", tel1:"", tel2:"", rue:"", rue2:"", numero_rue:"", npa:"", ville:"", notes:"" })
      fetchClients(search)
    } catch (e) { setSaveError((e as Error).message) }
    finally { setSaving(false) }
  }

  return (
    <main className="min-h-screen bg-[#1f2125] px-6 py-8 text-zinc-100">
      <div className="mx-auto max-w-[1600px] space-y-6">

        {/* HEADER */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className="inline-flex items-center rounded-xl border border-white/10 bg-[#34383d] px-4 py-2 text-sm text-zinc-100 hover:bg-[#40454b]">← Dashboard</Link>
            <div>
              <h1 className="text-2xl font-semibold">Fichier clients</h1>
              <p className="text-sm text-zinc-400">
                {clients.length} client{clients.length !== 1 ? "s" : ""}
                {totalClients !== null && totalClients > clients.length && ` / ${totalClients.toLocaleString("fr-CH")}`}
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={() => setShowImport(v => !v)}
              className="inline-flex items-center rounded-xl border border-sky-500/30 bg-sky-500/15 px-4 py-2 text-sm text-sky-300 hover:bg-sky-500/20">
              📥 Importer CSV
            </button>
            <ShopifySyncButton onDone={() => fetchClients(search)} />
            <button onClick={() => setShowNew(v => !v)}
              className="inline-flex items-center rounded-xl bg-[#2B8AD1] px-4 py-2 text-sm font-semibold text-white hover:bg-[#2478b8]">
              + Nouveau client
            </button>
          </div>
        </div>

        {/* IMPORT CSV */}
        {showImport && (
          <div className="rounded-2xl border border-sky-500/20 bg-[#2a2d31] p-6">
            <h2 className="mb-4 text-lg font-semibold">Import CSV clients</h2>
            <div className="mb-4 flex gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <label className="text-sm text-zinc-400">Format :</label>
                {(["auto","shopify","winbiz"] as const).map(f => (
                  <button key={f} onClick={() => setCsvFormat(f)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold border transition ${csvFormat === f ? "bg-[#2B8AD1] border-[#2B8AD1] text-white" : "border-white/10 bg-[#34383d] text-zinc-300 hover:bg-[#40454b]"}`}>
                    {f === "auto" ? "Détection auto" : f.charAt(0).toUpperCase() + f.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <div className="mb-3 rounded-xl border border-white/10 bg-[#1f2125] p-3 text-xs text-zinc-500 space-y-1">
              <div><strong className="text-zinc-400">Shopify :</strong> colonnes attendues — First Name, Last Name, Email, Phone, Billing Address1, Billing Zip, Billing City, Company</div>
              <div><strong className="text-zinc-400">WinBiz :</strong> colonnes attendues — Nom, Prénom, Société, Email, Téléphone, Rue, NPA, Ville (séparateur ; ou ,)</div>
              <div><strong className="text-zinc-400">Détection auto :</strong> détecte le format selon les en-têtes</div>
            </div>
            <textarea
              value={csvText}
              onChange={e => setCsvText(e.target.value)}
              rows={8}
              placeholder="Collez ici le contenu CSV ou déposez le fichier..."
              className="w-full rounded-xl border border-white/10 bg-[#1f2125] px-4 py-3 text-sm text-zinc-100 outline-none font-mono mb-3"
            />
            <label className="mb-3 flex cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-white/10 p-4 text-sm text-zinc-500 hover:border-sky-500/40 hover:text-zinc-300 transition">
              <input type="file" accept=".csv,.txt" className="hidden"
                onChange={e => {
                  const f = e.target.files?.[0]
                  if (!f) return
                  const reader = new FileReader()
                  reader.onload = ev => setCsvText(ev.target?.result as string)
                  reader.readAsText(f, "utf-8")
                  e.target.value = ""
                }}
              />
              📁 Ou cliquez pour sélectionner un fichier CSV
            </label>
            {importError && <div className="mb-3 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{importError}</div>}
            {importResult && (
              <div className="mb-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
                ✅ Import terminé — {importResult.inserted} insérés · {importResult.skipped} ignorés (doublons) · {importResult.errors} erreurs · {importResult.total} lignes traitées
              </div>
            )}
            <div className="flex gap-3">
              <button onClick={handleImport} disabled={importing || !csvText.trim()}
                className="rounded-xl bg-[#2B8AD1] px-6 py-2 text-sm font-semibold text-white hover:bg-[#2478b8] disabled:opacity-50">
                {importing ? "Import en cours…" : "Importer"}
              </button>
              <button onClick={() => { setShowImport(false); setImportResult(null); setCsvText("") }}
                className="rounded-xl border border-white/10 bg-[#34383d] px-4 py-2 text-sm text-zinc-300 hover:bg-[#40454b]">
                Fermer
              </button>
            </div>
          </div>
        )}

        {/* NOUVEAU CLIENT */}
        {showNew && (
          <div className="rounded-2xl border border-emerald-500/20 bg-[#2a2d31] p-6">
            <h2 className="mb-4 text-lg font-semibold">Nouveau client</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">

              {/* Nom */}
              <div className="flex flex-col gap-1" style={{position:"relative"}}>
                <label className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Nom *</label>
                <input type="text" value={newClient.nom} autoComplete="new-password"
                  onChange={e => {
                    setNewClient(p => ({...p, nom: e.target.value}))
                    if (clientSearchRef.current) clearTimeout(clientSearchRef.current)
                    clientSearchRef.current = setTimeout(() => searchClientSuggestions(e.target.value, "nom"), 300)
                  }}
                  onBlur={closeClientDropdown}
                  className="rounded-xl border border-white/10 bg-[#1f2125] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-[#2B8AD1]"/>
                {clientSuggestions.length > 0 && clientSearchField === "nom" && (
                  <div className="absolute top-full left-0 right-0 z-50 mt-1 rounded-xl border border-[#2B8AD1]/40 bg-[#2a2d31] shadow-xl">
                    {clientSuggestions.map(c => (
                      <div key={c.id} className="border-b border-white/5 last:border-0">
                        <div className="px-4 pt-2.5 pb-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-bold text-amber-400">⚠ Client existant</span>
                          </div>
                          <div className="text-sm font-semibold text-zinc-100">{c.nom} {c.prenom} {c.societe && <span className="font-normal text-zinc-400">· {c.societe}</span>}</div>
                          <div className="text-xs text-zinc-500 mt-0.5">{[c.rue, c.npa, c.ville, c.email, c.tel1].filter(Boolean).join(" · ")}</div>
                        </div>
                        <div className="px-4 pb-2.5 flex gap-2">
                          <button onClick={() => applyClientSuggestion(c)}
                            className="rounded-lg bg-[#2B8AD1]/15 border border-[#2B8AD1]/30 px-3 py-1 text-xs text-sky-300 hover:bg-[#2B8AD1]/25">
                            Voir la fiche →
                          </button>
                          <button onClick={() => setClientSuggestions([])}
                            className="rounded-lg bg-white/5 border border-white/10 px-3 py-1 text-xs text-zinc-400 hover:bg-white/10">
                            Créer quand même
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Prénom */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Prénom</label>
                <input type="text" value={newClient.prenom} autoComplete="new-password"
                  onChange={e => setNewClient(p => ({...p, prenom: e.target.value}))}
                  className="rounded-xl border border-white/10 bg-[#1f2125] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-[#2B8AD1]"/>
              </div>

              {/* Société */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Société</label>
                <input type="text" value={newClient.societe} autoComplete="new-password"
                  onChange={e => setNewClient(p => ({...p, societe: e.target.value}))}
                  className="rounded-xl border border-white/10 bg-[#1f2125] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-[#2B8AD1]"/>
              </div>

              {/* Téléphone 1 */}
              <div className="flex flex-col gap-1" style={{position:"relative"}}>
                <label className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Téléphone 1</label>
                <input type="text" value={newClient.tel1} autoComplete="new-password"
                  onChange={e => {
                    setNewClient(p => ({...p, tel1: e.target.value}))
                    if (clientSearchRef.current) clearTimeout(clientSearchRef.current)
                    clientSearchRef.current = setTimeout(() => searchClientSuggestions(e.target.value, "tel"), 300)
                  }}
                  onBlur={e => { setNewClient(p => ({...p, tel1: normalizeSwissPhone(e.target.value)})); closeClientDropdown(); }}
                  className="rounded-xl border border-white/10 bg-[#1f2125] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-[#2B8AD1]"/>
                {clientSuggestions.length > 0 && clientSearchField === "tel" && (
                  <div className="absolute top-full left-0 right-0 z-50 mt-1 rounded-xl border border-[#2B8AD1]/40 bg-[#2a2d31] shadow-xl">
                    {clientSuggestions.map(c => (
                      <div key={c.id} className="border-b border-white/5 last:border-0">
                        <div className="px-4 pt-2.5 pb-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-bold text-amber-400">⚠ Client existant</span>
                          </div>
                          <div className="text-sm font-semibold text-zinc-100">{c.nom} {c.prenom} {c.societe && <span className="font-normal text-zinc-400">· {c.societe}</span>}</div>
                          <div className="text-xs text-zinc-500 mt-0.5">{[c.rue, c.npa, c.ville, c.email, c.tel1].filter(Boolean).join(" · ")}</div>
                        </div>
                        <div className="px-4 pb-2.5 flex gap-2">
                          <button onClick={() => applyClientSuggestion(c)}
                            className="rounded-lg bg-[#2B8AD1]/15 border border-[#2B8AD1]/30 px-3 py-1 text-xs text-sky-300 hover:bg-[#2B8AD1]/25">
                            Voir la fiche →
                          </button>
                          <button onClick={() => setClientSuggestions([])}
                            className="rounded-lg bg-white/5 border border-white/10 px-3 py-1 text-xs text-zinc-400 hover:bg-white/10">
                            Créer quand même
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Téléphone 2 */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Téléphone 2</label>
                <input type="text" value={newClient.tel2} autoComplete="new-password"
                  onChange={e => setNewClient(p => ({...p, tel2: e.target.value}))}
                  onBlur={e => setNewClient(p => ({...p, tel2: normalizeSwissPhone(e.target.value)}))}
                  className="rounded-xl border border-white/10 bg-[#1f2125] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-[#2B8AD1]"/>
              </div>

              {/* Email */}
              <div className="flex flex-col gap-1" style={{position:"relative"}}>
                <label className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Email</label>
                <input type="email" value={newClient.email} autoComplete="new-password"
                  onChange={e => {
                    setNewClient(p => ({...p, email: e.target.value}))
                    if (clientSearchRef.current) clearTimeout(clientSearchRef.current)
                    clientSearchRef.current = setTimeout(() => searchClientSuggestions(e.target.value, "email"), 300)
                  }}
                  onBlur={closeClientDropdown}
                  className="rounded-xl border border-white/10 bg-[#1f2125] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-[#2B8AD1]"/>
                {clientSuggestions.length > 0 && clientSearchField === "email" && (
                  <div className="absolute top-full left-0 right-0 z-50 mt-1 rounded-xl border border-[#2B8AD1]/40 bg-[#2a2d31] shadow-xl">
                    {clientSuggestions.map(c => (
                      <div key={c.id} className="border-b border-white/5 last:border-0">
                        <div className="px-4 pt-2.5 pb-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-bold text-amber-400">⚠ Client existant</span>
                          </div>
                          <div className="text-sm font-semibold text-zinc-100">{c.nom} {c.prenom} {c.societe && <span className="font-normal text-zinc-400">· {c.societe}</span>}</div>
                          <div className="text-xs text-zinc-500 mt-0.5">{[c.rue, c.npa, c.ville, c.email, c.tel1].filter(Boolean).join(" · ")}</div>
                        </div>
                        <div className="px-4 pb-2.5 flex gap-2">
                          <button onClick={() => applyClientSuggestion(c)}
                            className="rounded-lg bg-[#2B8AD1]/15 border border-[#2B8AD1]/30 px-3 py-1 text-xs text-sky-300 hover:bg-[#2B8AD1]/25">
                            Voir la fiche →
                          </button>
                          <button onClick={() => setClientSuggestions([])}
                            className="rounded-lg bg-white/5 border border-white/10 px-3 py-1 text-xs text-zinc-400 hover:bg-white/10">
                            Créer quand même
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Trick pour bloquer l'autocomplete navigateur */}
              <><input type="text" style={{display:"none"}} autoComplete="new-password" readOnly/><input type="password" style={{display:"none"}} autoComplete="new-password" readOnly/></>

              {/* Adresse */}
              <div className="sm:col-span-2 lg:col-span-3 grid grid-cols-[1fr_80px_80px_1fr] gap-2">
                <div className="flex flex-col gap-1" style={{position:"relative"}}>
                  <label className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Rue</label>
                  <input type="text" value={newClient.rue}
                    onChange={e => {
                      setNewClient(p => ({...p, rue: e.target.value}))
                      if (addrDebounceRef.current) clearTimeout(addrDebounceRef.current)
                      addrDebounceRef.current = setTimeout(() => fetchSuggestions(e.target.value), 400)
                    }}
                    placeholder="Commencez à taper…"
                    autoComplete="new-password"
                    className="rounded-xl border border-white/10 bg-[#1f2125] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-[#2B8AD1]"/>
                  {addrSuggestions.length > 0 && (
                    <div className="absolute top-full left-0 right-0 z-50 mt-1 rounded-xl border border-white/10 bg-[#2a2d31] shadow-xl">
                      {addrSuggestions.map((s,i) => (
                        <div key={i} onClick={() => applyAddrSuggestion(s)}
                          className="cursor-pointer px-4 py-2 text-sm text-zinc-200 hover:bg-white/5 border-b border-white/5 last:border-0">
                          {s.label}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold uppercase tracking-wide text-zinc-400">N°</label>
                  <input type="text" value={newClient.numero_rue}
                    onChange={e => setNewClient(p => ({...p, numero_rue: e.target.value}))}
                    autoComplete="new-password"
                    className="rounded-xl border border-white/10 bg-[#1f2125] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-[#2B8AD1]"/>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold uppercase tracking-wide text-zinc-400">NPA</label>
                  <input type="text" value={newClient.npa}
                    onChange={e => setNewClient(p => ({...p, npa: e.target.value}))}
                    autoComplete="new-password"
                    className="rounded-xl border border-white/10 bg-[#1f2125] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-[#2B8AD1]"/>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Ville</label>
                  <input type="text" value={newClient.ville}
                    onChange={e => setNewClient(p => ({...p, ville: e.target.value}))}
                    autoComplete="new-password"
                    className="rounded-xl border border-white/10 bg-[#1f2125] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-[#2B8AD1]"/>
                </div>
              </div>

              <div className="flex flex-col gap-1 sm:col-span-2 lg:col-span-3">
                <label className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Complément d&apos;adresse</label>
                <input type="text" value={newClient.rue2 || ""}
                  onChange={e => setNewClient(p => ({...p, rue2: e.target.value}))}
                  placeholder="Bâtiment, case postale, lieu-dit…"
                  autoComplete="new-password"
                  className="rounded-xl border border-white/10 bg-[#1f2125] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-[#2B8AD1]"/>
              </div>

              <div className="flex flex-col gap-1 sm:col-span-2 lg:col-span-3">
                <label className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Notes</label>
                <textarea value={newClient.notes} onChange={e => setNewClient(p => ({ ...p, notes: e.target.value }))} rows={2}
                  className="w-full rounded-xl border border-white/10 bg-[#1f2125] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-[#2B8AD1]"/>
              </div>
            </div>
            {saveError && <div className="mt-3 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{saveError}</div>}
            <div className="mt-4 flex gap-3">
              <button onClick={handleNewClient} disabled={saving}
                className="rounded-xl bg-[#2B8AD1] px-6 py-2 text-sm font-semibold text-white hover:bg-[#2478b8] disabled:opacity-50">
                {saving ? "Enregistrement…" : "Enregistrer"}
              </button>
              <button onClick={() => setShowNew(false)}
                className="rounded-xl border border-white/10 bg-[#34383d] px-4 py-2 text-sm text-zinc-300 hover:bg-[#40454b]">
                Annuler
              </button>
            </div>
          </div>
        )}

        {/* RECHERCHE */}
        <div className="rounded-2xl border border-white/10 bg-[#2a2d31] p-4">
          <input
            type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="🔍 Rechercher par nom, prénom, société, email, NPA, ville, n° client…"
            className="w-full rounded-xl border border-white/10 bg-[#1f2125] px-4 py-3 text-sm text-zinc-100 outline-none focus:border-[#2B8AD1]"
          />
        </div>

        {/* LISTE */}
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#2a2d31]">
          {loading ? (
            <div className="p-8 text-center text-zinc-400">Chargement…</div>
          ) : clients.length === 0 ? (
            <div className="p-8 text-center text-zinc-500">Aucun client trouvé.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse text-sm">
                <thead className="bg-black/10 text-left text-zinc-400">
                  <tr>
                    <th className="px-4 py-3 font-medium">N° client</th>
                    <th className="px-4 py-3 font-medium">Nom</th>
                    <th className="px-4 py-3 font-medium">Société</th>
                    <th className="px-4 py-3 font-medium">Email</th>
                    <th className="px-4 py-3 font-medium">Téléphone</th>
                    <th className="px-4 py-3 font-medium">Ville</th>
                    <th className="px-4 py-3 font-medium">Source</th>
                    <th className="px-4 py-3 font-medium">Documents</th>
                    <th className="px-4 py-3 font-medium">Créé le</th>
                    <th className="px-4 py-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {clients.map((c, idx) => {
                    const src = sourceLabel(c.source)
                    return (
                      <tr key={c.id}
                        className={`border-t border-white/5 text-zinc-200 transition hover:bg-white/5 ${idx % 2 === 0 ? "bg-white/[0.02]" : "bg-white/[0.04]"}`}>
                        <td className="px-4 py-3">
                          <span className="font-mono text-xs font-semibold text-[#2B8AD1]">{c.numero_client}</span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-zinc-100">{nomClient(c)}</div>
                        </td>
                        <td className="px-4 py-3 text-zinc-400">{c.societe || "—"}</td>
                        <td className="px-4 py-3">
                          {c.email
                            ? <a href={`mailto:${c.email}`} className="text-sky-400 hover:underline text-xs">{c.email}</a>
                            : <span className="text-zinc-600">—</span>}
                        </td>
                        <td className="px-4 py-3 text-zinc-400">{c.tel1 || "—"}</td>
                        <td className="px-4 py-3 text-zinc-400">{[c.npa, c.ville].filter(Boolean).join(" ") || "—"}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${src.cls}`}>{src.label}</span>
                        </td>
                        <td className="px-4 py-3">
                          <DocBadges client={c} />
                        </td>
                        <td className="px-4 py-3 text-zinc-500 text-xs">{fmtDate(c.created_at)}</td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                            <Link href={`/dashboard/clients/${c.id}`}
                              className="rounded-lg border border-white/10 bg-[#34383d] px-3 py-1.5 text-xs text-zinc-100 hover:bg-[#40454b]">
                              Voir
                            </Link>
                            <Link href={`/offres/nouveau?prefill=${encodeURIComponent(JSON.stringify({
                              nom: c.nom, prenom: c.prenom||"", societe: c.societe||"",
                              email: c.email||"", telephone1: c.tel1||"",
                              rue: c.rue||"", npa: c.npa||"", ville: c.ville||"",
                            }))}`} target="_blank" rel="noopener noreferrer"
                              className="rounded-lg border border-[#2B8AD1]/30 bg-[#2B8AD1]/10 px-3 py-1.5 text-xs text-sky-300 hover:bg-[#2B8AD1]/20">
                              + Offre
                            </Link>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </main>
  )
}