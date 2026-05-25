"use client";
// app/dashboard/clients/page.tsx

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import PrintAddressButton from "@/components/PrintAddressButton";

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
  // Numéros de documents (max 10 par catégorie)
  nums_offres?: { num: string; date?: string | null }[]
  nums_commandes_internes?: { num: string; date?: string | null }[]
  nums_shopify?: { num: string; date?: string | null }[]
  nums_factures_winbiz?: { num: string; date?: string | null }[]
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

// Détecte si un client contient au moins 1 document qui matche la recherche
function clientHasDocumentMatch(c: Client, query: string | undefined): boolean {
  if (!query) return false
  const q = query.toLowerCase().replace(/^#/, "").trim()
  if (!q) return false
  const all = [
    ...(c.nums_offres || []),
    ...(c.nums_commandes_internes || []),
    ...(c.nums_shopify || []),
    ...(c.nums_factures_winbiz || []),
  ]
  return all.some(d => d.num.toLowerCase().includes(q))
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
// ─── Bouton synchronisation Shopify (chunked pour Vercel Hobby) ────
function ShopifySyncButton({ onDone }: { onDone: () => void }) {
  const [syncing, setSyncing] = useState(false)
  const [progress, setProgress] = useState({
    chunks: 0,
    ordersFetched: 0,
    ordersInserted: 0,
    ordersUpdated: 0,
    clientsMatched: 0,
    clientsCreated: 0,
    errors: [] as Array<{ shopifyId: string; message: string }>,
    durationMs: 0,
  })
  const [done, setDone] = useState(false)
  const [error, setError] = useState("")

  async function handleSync() {
    if (!confirm("⚠️ Synchroniser TOUTES les commandes Shopify ?\n\nVu le volume (potentiellement 10 000+ commandes), le sync se fera en plusieurs étapes automatiques. Ne ferme pas l'onglet pendant l'opération (peut prendre 15-25 min).")) return

    setSyncing(true)
    setDone(false)
    setError("")
    setProgress({
      chunks: 0,
      ordersFetched: 0,
      ordersInserted: 0,
      ordersUpdated: 0,
      clientsMatched: 0,
      clientsCreated: 0,
      errors: [],
      durationMs: 0,
    })

    let cursor: string | null = null
    let totalChunks = 0
    const startedAt = Date.now()

    try {
      // Boucle : on relance le sync chunk par chunk jusqu'à ce que hasMore=false
      while (true) {
        totalChunks++
        const res: Response = await fetch("/api/shopify/sync-orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            syncType: "manual",
            startCursor: cursor,
            maxOrders: 500,
          })
        })
        const json: {
          success: boolean
          error?: string
          ordersFetched: number
          ordersInserted: number
          ordersUpdated: number
          clientsMatched: number
          clientsCreated: number
          errors: Array<{ shopifyId: string; message: string }>
          hasMore: boolean
          nextCursor: string | null
        } = await res.json()
        if (!res.ok || !json.success) {
          throw new Error(json.error || `Erreur HTTP ${res.status}`)
        }

        // Mettre à jour la progression cumulée
        setProgress(p => ({
          chunks: totalChunks,
          ordersFetched: p.ordersFetched + json.ordersFetched,
          ordersInserted: p.ordersInserted + json.ordersInserted,
          ordersUpdated: p.ordersUpdated + json.ordersUpdated,
          clientsMatched: p.clientsMatched + json.clientsMatched,
          clientsCreated: p.clientsCreated + json.clientsCreated,
          errors: [...p.errors, ...json.errors],
          durationMs: Date.now() - startedAt,
        }))

        if (!json.hasMore) {
          // Sync terminé
          break
        }

        cursor = json.nextCursor

        // Petit délai entre chunks pour laisser respirer
        await new Promise(r => setTimeout(r, 1000))
      }

      setDone(true)
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
        {syncing
          ? `⏳ Sync en cours… ${progress.ordersFetched} commandes`
          : "🛍️ Sync Shopify"}
      </button>

      {/* Modal pendant et après sync */}
      {(syncing || done || error) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => { if (!syncing) { setDone(false); setError("") } }}>
          <div className="max-w-md w-full rounded-2xl border border-white/10 bg-[#2a2d31] p-6"
            onClick={e => e.stopPropagation()}>
            {error ? (
              <>
                <h3 className="text-lg font-semibold text-rose-300 mb-3">❌ Erreur de synchronisation</h3>
                <p className="text-sm text-zinc-300 mb-4">{error}</p>
                <p className="text-xs text-zinc-500 mb-4">⚠️ {progress.ordersInserted + progress.ordersUpdated} commandes ont déjà été synchronisées avant l&apos;erreur. Tu peux relancer pour reprendre.</p>
              </>
            ) : (
              <>
                <h3 className="text-lg font-semibold mb-3">
                  {syncing
                    ? <span className="text-sky-300">⏳ Synchronisation Shopify en cours…</span>
                    : <span className="text-emerald-300">✅ Synchronisation terminée</span>}
                </h3>
                {syncing && (
                  <p className="text-xs text-amber-300 mb-3">⚠️ Ne ferme pas l&apos;onglet ! Le sync va continuer automatiquement…</p>
                )}
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-zinc-400">Lots traités</span>
                    <span className="font-mono text-zinc-100">{progress.chunks}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-400">Commandes récupérées</span>
                    <span className="font-mono text-zinc-100">{progress.ordersFetched}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-400">→ Nouvelles</span>
                    <span className="font-mono text-emerald-300">+{progress.ordersInserted}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-400">→ Mises à jour</span>
                    <span className="font-mono text-sky-300">↻{progress.ordersUpdated}</span>
                  </div>
                  <hr className="border-white/10 my-2" />
                  <div className="flex justify-between">
                    <span className="text-zinc-400">Clients existants matchés</span>
                    <span className="font-mono text-zinc-100">{progress.clientsMatched}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-400">Nouveaux clients créés</span>
                    <span className="font-mono text-amber-300">+{progress.clientsCreated}</span>
                  </div>
                  {progress.errors.length > 0 && (
                    <>
                      <hr className="border-white/10 my-2" />
                      <div className="flex justify-between text-rose-300">
                        <span>Erreurs</span>
                        <span className="font-mono">{progress.errors.length}</span>
                      </div>
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs text-zinc-500">Voir détails</summary>
                        <div className="mt-2 max-h-40 overflow-y-auto rounded-lg bg-black/30 p-2 text-xs font-mono text-rose-300/80">
                          {progress.errors.slice(0, 20).map((e, i) => (
                            <div key={i} className="mb-1">{e.shopifyId}: {e.message}</div>
                          ))}
                          {progress.errors.length > 20 && <div className="text-zinc-500">…et {progress.errors.length - 20} autres</div>}
                        </div>
                      </details>
                    </>
                  )}
                  <hr className="border-white/10 my-2" />
                  <div className="flex justify-between text-xs text-zinc-500">
                    <span>Durée totale</span>
                    <span className="font-mono">{(progress.durationMs / 1000).toFixed(1)}s</span>
                  </div>
                </div>
              </>
            )}
            {!syncing && (
              <button onClick={() => { setDone(false); setError("") }}
                className="mt-4 w-full rounded-xl bg-[#34383d] px-4 py-2 text-sm text-zinc-100 hover:bg-[#40454b]">
                Fermer
              </button>
            )}
          </div>
        </div>
      )}
    </>
  )
}
// Numéro de document avec mise en évidence si match
function DocNum({ num, label, count, color, matchQuery }: {
  num: string
  label: string  // "DEV", "CMD", "WB", "SHOP"
  count?: number
  color: "amber"|"emerald"|"orange"|"violet"
  matchQuery?: string
}) {
  const isMatch = matchQuery ? num.toLowerCase().includes(matchQuery.toLowerCase().replace(/^#/, "")) : false
  const palettes = {
    amber:   { base: "border-amber-500/30 bg-amber-500/10 text-amber-300",       match: "border-amber-400 bg-amber-500/30 text-amber-200 ring-2 ring-amber-400/40" },
    emerald: { base: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300", match: "border-emerald-400 bg-emerald-500/30 text-emerald-200 ring-2 ring-emerald-400/40" },
    orange:  { base: "border-orange-500/30 bg-orange-500/10 text-orange-300",    match: "border-orange-400 bg-orange-500/30 text-orange-200 ring-2 ring-orange-400/40" },
    violet:  { base: "border-violet-500/30 bg-violet-500/10 text-violet-300",    match: "border-violet-400 bg-violet-500/30 text-violet-200 ring-2 ring-violet-400/40" },
  }
  const cls = isMatch ? palettes[color].match : palettes[color].base
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-mono ${cls}`}
      title={isMatch ? `Match recherche ✓ ${num}` : num}>
      <span className="opacity-60">{label}</span>{num}
      {count !== undefined && count > 1 && <span className="text-[9px] opacity-60">×{count}</span>}
    </span>
  )
}

// Cellule "Offres / Commandes internes"
function DocsCellInternes({ client, matchQuery }: { client: Client; matchQuery?: string }) {
  const offres = client.nums_offres || []
  const commandes = client.nums_commandes_internes || []
  const total = offres.length + commandes.length
  const nbOffres = client.nb_offres || 0
  const nbCmd = client.nb_commandes_internes || 0
  const [showAll, setShowAll] = React.useState(false)

  if (total === 0) return <span className="text-zinc-600 text-xs">—</span>

  // On priorise le doc qui match en premier
  const sortByMatch = (a: {num:string}, b: {num:string}) => {
    if (!matchQuery) return 0
    const q = matchQuery.toLowerCase().replace(/^#/, "")
    const aM = a.num.toLowerCase().includes(q) ? 1 : 0
    const bM = b.num.toLowerCase().includes(q) ? 1 : 0
    return bM - aM
  }
  const offresSorted = [...offres].sort(sortByMatch)
  const cmdSorted = [...commandes].sort(sortByMatch)

  const visibleOffres = showAll ? offresSorted : offresSorted.slice(0, 3)
  const visibleCmd = showAll ? cmdSorted : cmdSorted.slice(0, 3)
  const moreOffres = nbOffres - visibleOffres.length
  const moreCmd = nbCmd - visibleCmd.length
  const hasMore = !showAll && (moreOffres > 0 || moreCmd > 0)

  return (
    <div className="flex flex-col gap-1">
      {visibleCmd.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {visibleCmd.map((d, i) => (
            <DocNum key={`cmd-${i}`} num={d.num} label="" color="emerald" matchQuery={matchQuery} />
          ))}
          {moreCmd > 0 && !showAll && (
            <button onClick={(e) => { e.stopPropagation(); setShowAll(true) }}
              className="text-[10px] text-emerald-400 hover:underline">+{moreCmd}</button>
          )}
        </div>
      )}
      {visibleOffres.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {visibleOffres.map((d, i) => (
            <DocNum key={`off-${i}`} num={d.num} label="" color="amber" matchQuery={matchQuery} />
          ))}
          {moreOffres > 0 && !showAll && (
            <button onClick={(e) => { e.stopPropagation(); setShowAll(true) }}
              className="text-[10px] text-amber-400 hover:underline">+{moreOffres}</button>
          )}
        </div>
      )}
      {showAll && hasMore === false && total > 3 && (
        <button onClick={(e) => { e.stopPropagation(); setShowAll(false) }}
          className="text-[10px] text-zinc-500 hover:underline self-start">réduire</button>
      )}
    </div>
  )
}

// Cellule "Factures / Shopify externes"
function DocsCellExternes({ client, matchQuery }: { client: Client; matchQuery?: string }) {
  const factures = client.nums_factures_winbiz || []
  const shopify = client.nums_shopify || []
  const total = factures.length + shopify.length
  const nbFact = client.nb_factures_winbiz || 0
  const nbShop = client.nb_commandes_shopify || 0
  const [showAll, setShowAll] = React.useState(false)

  if (total === 0) return <span className="text-zinc-600 text-xs">—</span>

  const sortByMatch = (a: {num:string}, b: {num:string}) => {
    if (!matchQuery) return 0
    const q = matchQuery.toLowerCase().replace(/^#/, "")
    const aM = a.num.toLowerCase().includes(q) ? 1 : 0
    const bM = b.num.toLowerCase().includes(q) ? 1 : 0
    return bM - aM
  }
  const facturesSorted = [...factures].sort(sortByMatch)
  const shopifySorted = [...shopify].sort(sortByMatch)

  const visibleFact = showAll ? facturesSorted : facturesSorted.slice(0, 3)
  const visibleShop = showAll ? shopifySorted : shopifySorted.slice(0, 3)
  const moreFact = nbFact - visibleFact.length
  const moreShop = nbShop - visibleShop.length
  const hasMore = !showAll && (moreFact > 0 || moreShop > 0)

  return (
    <div className="flex flex-col gap-1">
      {visibleFact.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {visibleFact.map((d, i) => (
            <DocNum key={`f-${i}`} num={d.num} label="WB " color="violet" matchQuery={matchQuery} />
          ))}
          {moreFact > 0 && !showAll && (
            <button onClick={(e) => { e.stopPropagation(); setShowAll(true) }}
              className="text-[10px] text-violet-400 hover:underline">+{moreFact}</button>
          )}
        </div>
      )}
      {visibleShop.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {visibleShop.map((d, i) => (
            <DocNum key={`s-${i}`} num={d.num} label="" color="orange" matchQuery={matchQuery} />
          ))}
          {moreShop > 0 && !showAll && (
            <button onClick={(e) => { e.stopPropagation(); setShowAll(true) }}
              className="text-[10px] text-orange-400 hover:underline">+{moreShop}</button>
          )}
        </div>
      )}
      {showAll && hasMore === false && total > 3 && (
        <button onClick={(e) => { e.stopPropagation(); setShowAll(false) }}
          className="text-[10px] text-zinc-500 hover:underline self-start">réduire</button>
      )}
    </div>
  )
}

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([])
  const [totalClients, setTotalClients] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [searchDoc, setSearchDoc] = useState("")
  const [activeSearch, setActiveSearch] = useState<"client" | "document">("client")
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
    nom:"", prenom:"", societe:"", complement_nom:"", email:"", tel1:"", tel2:"",
    rue:"", rue2:"", numero_rue:"", npa:"", ville:"", notes:""
  })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState("")

  // Recherche client live
  const [clientSuggestions, setClientSuggestions] = useState<Client[]>([])
  const [clientSearchField, setClientSearchField] = useState<"nom"|"email"|"tel"|null>(null)
  const [clientSuggestIndex, setClientSuggestIndex] = useState(-1)
  const clientSearchRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clientDropdownRef = useRef<HTMLDivElement | null>(null)

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
    setClientSuggestions([])
    setClientSuggestIndex(-1)
  }

  // Esc ferme le dropdown
  useEffect(() => {
    if (clientSuggestions.length === 0) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeClientDropdown()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [clientSuggestions.length])

  // Clic extérieur ferme le dropdown
  useEffect(() => {
    if (clientSuggestions.length === 0) return
    function onClick(e: MouseEvent) {
      const target = e.target as Node
      if (clientDropdownRef.current && !clientDropdownRef.current.contains(target)) {
        // Vérifier aussi qu'on n'a pas cliqué dans un input qui pourrait rouvrir le dropdown
        const isInput = (target as HTMLElement).tagName === "INPUT"
        if (!isInput) closeClientDropdown()
      }
    }
    // Petit délai pour ne pas intercepter le clic qui a ouvert le dropdown
    const t = setTimeout(() => window.addEventListener("mousedown", onClick), 50)
    return () => { clearTimeout(t); window.removeEventListener("mousedown", onClick) }
  }, [clientSuggestions.length])

  const fetchClients = useCallback(async (q: string, mode: "client" | "document" = "client") => {
    setLoading(true)
    try {
      const url = mode === "document"
        ? `/api/clients?q=${encodeURIComponent(q)}&limit=100&mode=document`
        : `/api/clients?q=${encodeURIComponent(q)}&limit=100`
      const res = await fetch(url)
      const json = await res.json()
      setClients(json.clients || [])
      if (json.total !== undefined) setTotalClients(json.total)
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchClients("") }, [fetchClients])

  useEffect(() => {
    if (searchRef.current) clearTimeout(searchRef.current)
    searchRef.current = setTimeout(() => {
      if (activeSearch === "document" && searchDoc.trim()) {
        fetchClients(searchDoc, "document")
      } else {
        fetchClients(search, "client")
      }
    }, 300)
    return () => { if (searchRef.current) clearTimeout(searchRef.current) }
  }, [search, searchDoc, activeSearch, fetchClients])

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
      setNewClient({ nom:"", prenom:"", societe:"", complement_nom:"", email:"", tel1:"", tel2:"", rue:"", rue2:"", numero_rue:"", npa:"", ville:"", notes:"" })
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
  {(search.trim() || searchDoc.trim()) ? (
    <>
      {clients.length} résultat{clients.length !== 1 ? "s" : ""}
      {activeSearch === "document" && searchDoc.trim() && (
        <span className="ml-2 text-xs text-violet-300">via document &laquo; {searchDoc} &raquo;</span>
      )}
      {totalClients !== null && ` (sur ${totalClients.toLocaleString("fr-CH")} clients)`}
    </>
  ) : (
    <>
      {clients.length} clients récents
      {totalClients !== null && ` · ${totalClients.toLocaleString("fr-CH")} au total`}
      <span className="ml-2 text-xs text-zinc-500">(utilise la recherche pour trouver un client précis)</span>
    </>
  )}
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
                    if (!e.target.value.trim()) { closeClientDropdown(); return }
                    clientSearchRef.current = setTimeout(() => searchClientSuggestions(e.target.value, "nom"), 300)
                  }}
                  onKeyDown={e => {
                    if (e.key === "Escape") { closeClientDropdown(); (e.target as HTMLInputElement).blur() }
                  }}
                  className="rounded-xl border border-white/10 bg-[#1f2125] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-[#2B8AD1]"/>
                {clientSuggestions.length > 0 && clientSearchField === "nom" && (
                  <div ref={clientDropdownRef} className="absolute top-full left-0 right-0 z-50 mt-1 rounded-xl border border-[#2B8AD1]/40 bg-[#2a2d31] shadow-xl">
                    <button type="button" onClick={closeClientDropdown}
                      className="absolute -top-2 -right-2 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-rose-500 text-xs font-bold text-white shadow hover:bg-rose-600"
                      title="Fermer (Esc)">
                      ✕
                    </button>
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

              {/* Complément nom */}
              <div className="flex flex-col gap-1 sm:col-span-2 lg:col-span-3">
                <label className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Complément nom <span className="text-[10px] font-normal text-zinc-500 normal-case">(optionnel — conjoint, c/o, contact...)</span></label>
                <input type="text" value={newClient.complement_nom} autoComplete="new-password"
                  onChange={e => setNewClient(p => ({...p, complement_nom: e.target.value}))}
                  placeholder="Ex: et Marie, c/o Crédit Suisse, Mesdames Roca et De Marco..."
                  className="rounded-xl border border-white/10 bg-[#1f2125] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-[#2B8AD1]"/>
              </div>

              {/* Téléphone 1 */}
              <div className="flex flex-col gap-1" style={{position:"relative"}}>
                <label className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Téléphone 1</label>
                <input type="text" value={newClient.tel1} autoComplete="new-password"
                  onChange={e => {
                    setNewClient(p => ({...p, tel1: e.target.value}))
                    if (clientSearchRef.current) clearTimeout(clientSearchRef.current)
                    if (!e.target.value.trim()) { closeClientDropdown(); return }
                    clientSearchRef.current = setTimeout(() => searchClientSuggestions(e.target.value, "tel"), 300)
                  }}
                  onBlur={e => setNewClient(p => ({...p, tel1: normalizeSwissPhone(e.target.value)}))}
                  onKeyDown={e => {
                    if (e.key === "Escape") { closeClientDropdown(); (e.target as HTMLInputElement).blur() }
                  }}
                  className="rounded-xl border border-white/10 bg-[#1f2125] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-[#2B8AD1]"/>
                {clientSuggestions.length > 0 && clientSearchField === "tel" && (
                  <div ref={clientDropdownRef} className="absolute top-full left-0 right-0 z-50 mt-1 rounded-xl border border-[#2B8AD1]/40 bg-[#2a2d31] shadow-xl">
                    <button type="button" onClick={closeClientDropdown}
                      className="absolute -top-2 -right-2 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-rose-500 text-xs font-bold text-white shadow hover:bg-rose-600"
                      title="Fermer (Esc)">
                      ✕
                    </button>
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
                    if (!e.target.value.trim()) { closeClientDropdown(); return }
                    clientSearchRef.current = setTimeout(() => searchClientSuggestions(e.target.value, "email"), 300)
                  }}
                  onKeyDown={e => {
                    if (e.key === "Escape") { closeClientDropdown(); (e.target as HTMLInputElement).blur() }
                  }}
                  className="rounded-xl border border-white/10 bg-[#1f2125] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-[#2B8AD1]"/>
                {clientSuggestions.length > 0 && clientSearchField === "email" && (
                  <div ref={clientDropdownRef} className="absolute top-full left-0 right-0 z-50 mt-1 rounded-xl border border-[#2B8AD1]/40 bg-[#2a2d31] shadow-xl">
                    <button type="button" onClick={closeClientDropdown}
                      className="absolute -top-2 -right-2 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-rose-500 text-xs font-bold text-white shadow hover:bg-rose-600"
                      title="Fermer (Esc)">
                      ✕
                    </button>
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

        {/* RECHERCHE — 2 barres séparées */}
        <div className="grid gap-3 md:grid-cols-2">
          {/* Barre 1 : Recherche CLIENT */}
          <div className={`rounded-2xl border bg-[#2a2d31] p-4 transition ${activeSearch === "client" ? "border-[#2B8AD1]/40" : "border-white/10"}`}>
            <div className="mb-2 flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wide text-zinc-400">👤 Rechercher un client</span>
              {activeSearch === "client" && search.trim() && (
                <span className="ml-auto rounded-full bg-[#2B8AD1]/15 px-2 py-0.5 text-[10px] font-semibold text-sky-300">actif</span>
              )}
            </div>
            <input
              type="text" value={search}
              onChange={e => { setSearch(e.target.value); setActiveSearch("client"); if (e.target.value.trim()) setSearchDoc("") }}
              onFocus={() => setActiveSearch("client")}
              placeholder="Nom, prénom, société, email, NPA, ville, tél, n° client…"
              className="w-full rounded-xl border border-white/10 bg-[#1f2125] px-4 py-3 text-sm text-zinc-100 outline-none focus:border-[#2B8AD1]"
            />
            <div className="mt-1.5 text-[11px] text-zinc-500">
              Cherche dans la fiche client (nom, contact, adresse).
            </div>
          </div>

          {/* Barre 2 : Recherche DOCUMENT */}
          <div className={`rounded-2xl border bg-[#2a2d31] p-4 transition ${activeSearch === "document" ? "border-violet-500/40" : "border-white/10"}`}>
            <div className="mb-2 flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wide text-zinc-400">📄 Retrouver depuis un numéro</span>
              {activeSearch === "document" && searchDoc.trim() && (
                <span className="ml-auto rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-semibold text-violet-300">actif</span>
              )}
            </div>
            <input
              type="text" value={searchDoc}
              onChange={e => { setSearchDoc(e.target.value); setActiveSearch("document"); if (e.target.value.trim()) setSearch("") }}
              onFocus={() => setActiveSearch("document")}
              placeholder="N° facture WinBiz, commande Shopify (#1234), DEV-2026-…, CMD-…"
              className="w-full rounded-xl border border-white/10 bg-[#1f2125] px-4 py-3 text-sm text-zinc-100 outline-none focus:border-violet-500"
            />
            <div className="mt-1.5 text-[11px] text-zinc-500">
              Ignore les NPA. Cherche dans factures WinBiz, commandes Shopify, offres & commandes internes.
            </div>
          </div>
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
                    <th className="px-4 py-3 font-medium">Adresse</th>
                    <th className="px-4 py-3 font-medium">Source</th>
                    <th className="px-4 py-3 font-medium" title="Offres et commandes internes Jardin-Confort">📄 Offres / 🛒 Commandes</th>
                    <th className="px-4 py-3 font-medium" title="Factures WinBiz et commandes Shopify">📊 WinBiz / 🛍️ Shopify</th>
                    <th className="px-4 py-3 font-medium">Créé le</th>
                    <th className="px-4 py-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {[...clients].sort((a, b) => {
                    const matchQ = activeSearch === "document" ? searchDoc : undefined
                    const aM = clientHasDocumentMatch(a, matchQ) ? 1 : 0
                    const bM = clientHasDocumentMatch(b, matchQ) ? 1 : 0
                    return bM - aM
                  }).map((c, idx) => {
  const src = sourceLabel(c.source)
  const matchQuery = activeSearch === "document" ? searchDoc : undefined
  const isMatch = clientHasDocumentMatch(c, matchQuery)
  return (
    <tr key={c.id}
      onClick={(e) => {
  // Ctrl/Cmd+click ou clic milieu → nouvel onglet
  if (e.ctrlKey || e.metaKey || e.button === 1) {
    window.open(`/dashboard/clients/${c.id}`, "_blank")
  } else {
    window.location.href = `/dashboard/clients/${c.id}`
  }
}}
      className={`border-t text-zinc-200 transition cursor-pointer ${
        isMatch
          ? "border-violet-500/40 bg-violet-500/15 hover:bg-violet-500/25 ring-1 ring-inset ring-violet-400/40 relative"
          : `border-white/5 hover:bg-white/10 ${idx % 2 === 0 ? "bg-white/[0.02]" : "bg-white/[0.04]"}`
      }`}
      style={isMatch ? { boxShadow: "inset 4px 0 0 0 rgb(167 139 250)" } : undefined}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {isMatch && (
                              <span className="inline-flex items-center gap-0.5 rounded-md bg-violet-500/30 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-violet-200 ring-1 ring-violet-400/50">
                                🎯 match
                              </span>
                            )}
                            <span className="font-mono text-xs font-semibold text-[#2B8AD1]">{c.numero_client}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-zinc-100">{nomClient(c)}</div>
                        </td>
                        <td className="px-4 py-3 text-zinc-400">{c.societe || "—"}</td>
                        <td className="px-4 py-3">
  {c.email
    ? <a href={`mailto:${c.email}`} onClick={e => e.stopPropagation()} className="text-sky-400 hover:underline text-xs">{c.email}</a>
    : <span className="text-zinc-600">—</span>}
</td>
                        <td className="px-4 py-3 text-zinc-400">{c.tel1 || "—"}</td>
                        <td className="px-4 py-3 text-zinc-400">
                          {(() => {
                            const ligne1 = [c.rue, c.numero_rue].filter(Boolean).join(" ")
                            const ligne2 = c.rue2 || ""
                            const ligne3 = [c.npa, c.ville].filter(Boolean).join(" ")
                            const lignes = [ligne1, ligne2, ligne3].filter(l => l.trim().length > 0)
                            if (lignes.length === 0) return "—"
                            return (
                              <div className="flex flex-col gap-0.5">
                                {lignes.map((l, i) => <div key={i}>{l}</div>)}
                              </div>
                            )
                          })()}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${src.cls}`}>{src.label}</span>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <DocsCellInternes client={c} matchQuery={activeSearch === "document" ? searchDoc : undefined} />
                        </td>
                        <td className="px-4 py-3 align-top">
                          <DocsCellExternes client={c} matchQuery={activeSearch === "document" ? searchDoc : undefined} />
                        </td>
                        <td className="px-4 py-3 text-zinc-500 text-xs align-top">{fmtDate(c.created_at)}</td>
                        <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
  <div className="flex justify-end gap-2">
    <PrintAddressButton client={c} compact />
    <Link href={`/drafts/nouveau?prefill=${encodeURIComponent(JSON.stringify({
                              nom: c.nom, prenom: c.prenom||"", societe: c.societe||"",
                              email: c.email||"", telephone1: c.tel1||"",
                              rue: c.rue||"", npa: c.npa||"", ville: c.ville||"",
                            }))}`} target="_blank" rel="noopener noreferrer"
                              className="rounded-lg border border-[#2B8AD1]/30 bg-[#2B8AD1]/10 px-3 py-1.5 text-xs text-sky-300 hover:bg-[#2B8AD1]/20">
                              + Offre (brouillon)
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