"use client";
// app/dashboard/page.tsx

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type OffreStatut = "En cours"|"Envoyée"|"Convertie"|"Acceptée"|"Abandonnée"|"Refusée"
type TypeDocument = "Offre"|"Commande"
type OffreRecord = {
  id: number; slug: string; type_document: TypeDocument
  numero_offre: string|null; numero_commande: string|null; offre_origine: string|null
  numero_affiche: string; statut: OffreStatut; date_document: string|null
  commercial: string|null; payment_mode: string|null; delivery_mode: string|null
  lead_time: string|null; client_societe: string|null; client_nom: string|null
  client_prenom: string|null; client_email: string|null; client_tel1: string|null
  client_rue: string|null; client_npa: string|null; client_ville: string|null
  sous_total: number; remise_chf: number; services_total: number
  tva_montant: number; total_ttc: number; nb_articles: number
  remarques: string|null; notes_internes: string|null; note_commerciale: string|null
  date_abandon: string|null; date_derniere_relance: string|null; nb_relances: number|null
  data: Record<string,unknown>; created_at: string; updated_at: string|null
}

function fmtDate(iso: string|null) {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("fr-CH", { day:"2-digit", month:"2-digit", year:"numeric" })
}
function fmtMoney(v: number|null|undefined) {
  if (!v) return "—"
  return new Intl.NumberFormat("fr-CH", { style:"currency", currency:"CHF", maximumFractionDigits:0 }).format(v)
}
function nomClient(o: OffreRecord) {
  return [o.client_prenom, o.client_nom].filter(Boolean).join(" ") || "—"
}
function getDaysOpen(o: OffreRecord): number|null {
  if (!o.date_document) return null
  if (["Acceptée","Convertie","Abandonnée"].includes(o.statut)) return null
  return Math.floor((Date.now()-new Date(o.date_document).getTime())/86400000)
}
function getDaysSinceRelance(o: OffreRecord): number|null {
  if (!o.date_derniere_relance) return null
  if (["Acceptée","Convertie","Abandonnée"].includes(o.statut)) return null
  return Math.floor((Date.now()-new Date(o.date_derniere_relance).getTime())/86400000)
}
function getStatusColor(statut: string, type: string) {
  if (type==="Commande"||statut==="Acceptée"||statut==="Convertie") return "bg-emerald-500/15 text-emerald-300"
  if (statut==="Abandonnée"||statut==="Refusée") return "bg-rose-500/15 text-rose-300"
  if (statut==="Envoyée") return "bg-sky-500/15 text-sky-300"
  return "bg-amber-500/15 text-amber-300"
}
function getDaysBadgeColor(days: number|null) {
  if (days===null) return "bg-white/5 text-zinc-400"
  if (days>=14) return "bg-rose-500/15 text-rose-300"
  if (days>=7) return "bg-amber-500/15 text-amber-300"
  return "bg-white/5 text-zinc-300"
}
function computeStats(offres: OffreRecord[]) {
  const actives = offres.filter(o => o.type_document==="Offre"&&!["Abandonnée","Convertie","Refusée"].includes(o.statut))
  const commandes = offres.filter(o => o.type_document==="Commande"||o.statut==="Acceptée")
  const abandonnes = offres.filter(o => ["Abandonnée","Refusée"].includes(o.statut))
  const aRelancer = actives.filter(o => { const d=getDaysOpen(o); return d!==null&&d>=7 })
  return {
    totalOffres:actives.length, totalCommandes:commandes.length,
    totalAbandonnes:abandonnes.length, aRelancer:aRelancer.length,
    caOffres:actives.reduce((s,o)=>s+(o.total_ttc||0),0),
    caCommandes:commandes.reduce((s,o)=>s+(o.total_ttc||0),0),
  }
}
const COMMERCIAUX = ["Brice Chappé","Alejandro Gallegos","Fabian Coquoz","Michel Gédéon","Sabrina Striberni","Team Jardin-Confort","Thierry Stricker"]

type SortKey = "date"|"client"|"montant"|"statut"|"commercial"|"jours"|"numero"
type SortDir = "asc"|"desc"
type QuickFilter = "all"|"offres"|"commandes"|"abandonnes"|"relance"

function isoWeek(d: Date) {
  const t = new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()))
  const day=(t.getUTCDay()+6)%7; t.setUTCDate(t.getUTCDate()-day+3)
  const jan4=new Date(Date.UTC(t.getUTCFullYear(),0,4))
  const dayJ=(jan4.getUTCDay()+6)%7; jan4.setUTCDate(jan4.getUTCDate()-dayJ+3)
  return 1+Math.round((t.getTime()-jan4.getTime())/604800000)
}
function todayLabel() {
  const now=new Date()
  return `${new Intl.DateTimeFormat("fr-CH",{weekday:"long",day:"2-digit",month:"2-digit",year:"numeric"}).format(now)} · Semaine ${isoWeek(now)}`
}

function KpiCard({title,value,sub,extra,onClick,active}:{title:string;value:string|number;sub?:string;extra?:string;onClick?:()=>void;active?:boolean}) {
  return (
    <div onClick={onClick} className={`rounded-2xl border p-6 transition ${onClick?"cursor-pointer hover:bg-[#34383d]":""} ${active?"border-[#2B8AD1]/50 bg-[#2B8AD1]/10":"border-white/10 bg-[#2a2d31]"}`}>
      <div className="text-sm text-zinc-400">{title}</div>
      <div className="mt-4 text-4xl font-semibold tracking-tight text-zinc-100">{value}</div>
      {sub&&<div className="mt-3 text-sm text-zinc-500">{sub}</div>}
      {extra&&<div className="mt-2 text-sm text-sky-300">{extra}</div>}
    </div>
  )
}
function SortTh({label,k,cur,dir,onSort}:{label:string;k:SortKey;cur:SortKey;dir:SortDir;onSort:(k:SortKey)=>void}) {
  const active=k===cur
  return (
    <th className="px-4 py-3 font-medium">
      <button type="button" onClick={()=>onSort(k)}
        className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 transition ${active?"bg-white/10 text-zinc-100":"text-zinc-400 hover:bg-white/5 hover:text-zinc-200"}`}>
        {label} <span className="text-xs">{active?(dir==="asc"?"↑":"↓"):"↕"}</span>
      </button>
    </th>
  )
}

export default function DashboardPage() {
  const [offres,setOffres]=useState<OffreRecord[]>([])
  const [loading,setLoading]=useState(true)
  const [search,setSearch]=useState("")
  const [quickFilter,setQuickFilter]=useState<QuickFilter>("all")
  const [commercial,setCommercial]=useState("all")
  const [sortKey,setSortKey]=useState<SortKey>("date")
  const [sortDir,setSortDir]=useState<SortDir>("desc")

  function loadOffres() {
    setLoading(true)
    fetch("/api/dashboard/offres")
      .then(r=>r.json()).then(d=>setOffres(Array.isArray(d)?d:[]))
      .catch(()=>setOffres([])).finally(()=>setLoading(false))
  }
  useEffect(()=>{loadOffres()},[])

  function handleSort(k:SortKey) {
    if(k===sortKey){setSortDir(d=>d==="asc"?"desc":"asc");return}
    setSortKey(k);setSortDir("desc")
  }

  const filtered=useMemo(()=>{
    let list=offres
    if(quickFilter==="offres") list=list.filter(o=>o.type_document==="Offre"&&!["Abandonnée","Convertie","Refusée"].includes(o.statut))
    else if(quickFilter==="commandes") list=list.filter(o=>o.type_document==="Commande"||o.statut==="Acceptée")
    else if(quickFilter==="abandonnes") list=list.filter(o=>["Abandonnée","Refusée"].includes(o.statut))
    else if(quickFilter==="relance") list=list.filter(o=>{const d=getDaysOpen(o);return d!==null&&d>=7})
    if(commercial!=="all") list=list.filter(o=>o.commercial===commercial)
    if(search.trim()){
      const q=search.toLowerCase()
      list=list.filter(o=>
        nomClient(o).toLowerCase().includes(q)||(o.numero_affiche||"").toLowerCase().includes(q)||
        (o.client_email||"").toLowerCase().includes(q)||(o.client_ville||"").toLowerCase().includes(q)||
        (o.commercial||"").toLowerCase().includes(q))
    }
    return [...list].sort((a,b)=>{
      let av:string|number="",bv:string|number=""
      if(sortKey==="numero"){av=a.id;bv=b.id}
      else if(sortKey==="date"){av=a.date_document||"";bv=b.date_document||""}
      else if(sortKey==="client"){av=nomClient(a);bv=nomClient(b)}
      else if(sortKey==="montant"){av=a.total_ttc||0;bv=b.total_ttc||0}
      else if(sortKey==="statut"){av=a.statut;bv=b.statut}
      else if(sortKey==="commercial"){av=a.commercial||"";bv=b.commercial||""}
      else if(sortKey==="jours"){av=getDaysOpen(a)??-1;bv=getDaysOpen(b)??-1}
      if(av<bv) return sortDir==="asc"?-1:1
      if(av>bv) return sortDir==="asc"?1:-1
      return 0
    })
  },[offres,quickFilter,commercial,search,sortKey,sortDir])

  const statsFiltered=useMemo(()=>computeStats(
    commercial==="all" ? offres : offres.filter(o=>o.commercial===commercial)
  ),[offres,commercial])
  const quickFilters:{label:string;value:QuickFilter}[] = [
    {label:"Toutes",value:"all"},{label:"Offres actives",value:"offres"},
    {label:"Commandes",value:"commandes"},{label:"Abandonnées",value:"abandonnes"},
    {label:"À relancer (≥7j)",value:"relance"},
  ]

  if(loading) return (
    <main className="min-h-screen bg-[#1f2125] px-6 py-8 text-zinc-100">
      <div className="mx-auto max-w-[1700px] rounded-2xl border border-white/10 bg-[#2a2d31] p-8 text-zinc-400">Chargement…</div>
    </main>
  )

  return (
    <main className="min-h-screen bg-[#1f2125] px-6 py-8 text-zinc-100">
      <div className="mx-auto max-w-[1700px] space-y-6">

        <div className="space-y-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="flex items-start gap-4">
              <img src="https://cdn.shopify.com/s/files/1/0360/3251/2135/files/picto_jardin_confort_apple_low.png?v=1775944940"
                alt="" className="h-16 w-16 rounded-xl object-contain"/>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">Suivi offres & commandes</h1>
                <p className="mt-1 text-sm text-zinc-400">Vue commerciale centralisée — Jardin-Confort</p>
                <p className="mt-1 text-xs text-zinc-500">{todayLabel()}</p>
              </div>
            </div>
            <div className="flex gap-3 flex-wrap">
              <Link href="/offres/nouveau" target="_blank" rel="noopener noreferrer" className="inline-flex items-center rounded-2xl bg-[#2B8AD1] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#2478b8]">+ Nouvelle offre</Link>
              <Link href="/dashboard/clients" className="inline-flex items-center rounded-2xl border border-white/10 bg-[#2a2d31] px-4 py-3 text-sm text-zinc-300 transition hover:bg-[#34383d]">👥 Clients</Link>
              <button onClick={loadOffres} className="inline-flex items-center rounded-2xl border border-white/10 bg-[#2a2d31] px-4 py-3 text-sm text-zinc-300 transition hover:bg-[#34383d]">🔄 Actualiser</button>
            </div>
          </div>

          <div className="grid gap-3 xl:grid-cols-[240px_200px_minmax(0,1fr)_160px]">
            <select value={commercial} onChange={e=>setCommercial(e.target.value)} className="w-full rounded-xl border border-white/10 bg-[#2a2d31] px-4 py-2.5 text-sm text-zinc-100 outline-none">
              <option value="all">Tous les conseillers</option>
              {COMMERCIAUX.map(c=><option key={c} value={c}>{c}</option>)}
            </select>
            <select value={quickFilter} onChange={e=>setQuickFilter(e.target.value as QuickFilter)} className="w-full rounded-xl border border-white/10 bg-[#2a2d31] px-4 py-2.5 text-sm text-zinc-100 outline-none">
              {quickFilters.map(f=><option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Recherche : client, référence, email, ville…"
              className="w-full rounded-xl border border-white/10 bg-[#2a2d31] px-4 py-2.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-500"/>
            <button onClick={()=>{setSearch("");setQuickFilter("all");setCommercial("all")}} className="rounded-xl border border-white/10 bg-[#34383d] px-4 py-2.5 text-sm text-zinc-100 transition hover:bg-[#40454b]">Reset</button>
          </div>

          <div className="flex flex-wrap gap-2">
            {quickFilters.map(f=>(
              <button key={f.value} type="button" onClick={()=>setQuickFilter(f.value)}
                className={`rounded-full px-4 py-2 text-sm transition ${quickFilter===f.value?"bg-zinc-100 text-zinc-900":"border border-white/10 bg-[#34383d] text-zinc-200 hover:bg-[#40454b]"}`}>
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <KpiCard title="Offres actives" value={statsFiltered.totalOffres} sub={`${offres.length} dossiers total`} extra={`${fmtMoney(stats.caOffres)} potentiel`}
            onClick={()=>setQuickFilter(quickFilter==="offres"?"all":"offres")} active={quickFilter==="offres"}/>
          <KpiCard title="Commandes" value={statsFiltered.totalCommandes} sub={`${offres.length} dossiers total`} extra={`${fmtMoney(stats.caCommandes)} confirmé`}
            onClick={()=>setQuickFilter(quickFilter==="commandes"?"all":"commandes")} active={quickFilter==="commandes"}/>
          <KpiCard title="À relancer" value={statsFiltered.aRelancer} sub="Offres ouvertes ≥ 7 jours" extra={stats.aRelancer>0?"⚠ Action requise":"✓ À jour"}
            onClick={()=>setQuickFilter(quickFilter==="relance"?"all":"relance")} active={quickFilter==="relance"}/>
          <KpiCard title="Abandonnées" value={statsFiltered.totalAbandonnes} sub={`${offres.length} dossiers total`}
            onClick={()=>setQuickFilter(quickFilter==="abandonnes"?"all":"abandonnes")} active={quickFilter==="abandonnes"}/>
        </div>

        <div className="space-y-3">
          <div className="text-sm text-zinc-400">{filtered.length} résultat(s)</div>
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#2a2d31]">
            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse text-sm">
                <thead className="bg-black/10 text-left text-zinc-400">
                  <tr>
                    <SortTh label="Réf." k="numero" cur={sortKey} dir={sortDir} onSort={handleSort}/>
                    <SortTh label="Client" k="client" cur={sortKey} dir={sortDir} onSort={handleSort}/>
                    <th className="px-4 py-3 font-medium text-zinc-400">Ville</th>
                    <SortTh label="Conseiller" k="commercial" cur={sortKey} dir={sortDir} onSort={handleSort}/>
                    <SortTh label="Montant" k="montant" cur={sortKey} dir={sortDir} onSort={handleSort}/>
                    <SortTh label="Statut" k="statut" cur={sortKey} dir={sortDir} onSort={handleSort}/>
                    <SortTh label="Jours" k="jours" cur={sortKey} dir={sortDir} onSort={handleSort}/>
                    <SortTh label="Date" k="date" cur={sortKey} dir={sortDir} onSort={handleSort}/>
                    <th className="px-4 py-3 text-right font-medium text-zinc-400">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length===0?(
                    <tr><td colSpan={9} className="px-4 py-10 text-center text-zinc-500">Aucun dossier trouvé.</td></tr>
                  ):filtered.map((o,idx)=>{
                    const days=getDaysOpen(o)
                    const rowBg=idx%2===0?"bg-white/[0.02]":"bg-white/[0.05]"
                    return (
                      <tr key={o.id} onClick={()=>window.location.href=`/dashboard/${o.slug}`}
                        className={`${rowBg} cursor-pointer border-t border-white/5 text-zinc-200 transition hover:bg-white/10`}>
                        <td className="px-4 py-4">
                          <div className="font-semibold text-zinc-100">{o.numero_affiche}</div>
                          <div className="text-xs text-zinc-500">{o.type_document}</div>
                          {o.statut==="Convertie" && o.numero_commande && (
                            <div className="text-xs text-emerald-400 mt-0.5">→ {o.numero_commande}</div>
                          )}
                          {o.offre_origine && (
                            <div className="text-xs text-sky-400 mt-0.5">← {o.offre_origine}</div>
                          )}
                        </td>
                        <td className="px-4 py-4">
                          <div>{nomClient(o)}</div>
                          {o.client_societe&&<div className="text-xs text-zinc-400">{o.client_societe}</div>}
                          {o.client_email&&<div className="text-xs text-zinc-500">{o.client_email}</div>}
                        </td>
                        <td className="px-4 py-4 text-zinc-400">{o.client_ville||"—"}</td>
                        <td className="px-4 py-4 text-zinc-300">{o.commercial||"—"}</td>
                        <td className="px-4 py-4 font-medium text-zinc-100">{fmtMoney(o.total_ttc)}</td>
                        <td className="px-4 py-4">
                          <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${getStatusColor(o.statut,o.type_document)}`}>{o.statut}</span>
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex flex-col gap-1">
                            {days!==null?(
                              <span className={`inline-flex min-w-8 items-center justify-center rounded-full px-3 py-1 text-xs font-medium ${getDaysBadgeColor(days)}`} title="Jours depuis création">📅 {days}j</span>
                            ):<span className="text-zinc-600">—</span>}
                            {(()=>{
                              const dr=getDaysSinceRelance(o)
                              if(dr===null) return null
                              const nb=o.nb_relances||0
                              return (
                                <span className={`inline-flex items-center justify-center rounded-full px-3 py-1 text-xs font-medium ${dr>=14?"bg-rose-500/15 text-rose-300":dr>=7?"bg-amber-500/15 text-amber-300":"bg-sky-500/15 text-sky-300"}`} title={`Jours depuis relance #${nb}`}>
                                  📧 R{nb} · {dr}j
                                </span>
                              )
                            })()}
                          </div>
                        </td>
                        <td className="px-4 py-4 text-zinc-400">{fmtDate(o.date_document)}</td>
                        <td className="px-4 py-4">
                          <div className="flex justify-end gap-2" onClick={e=>e.stopPropagation()}>
                            <Link href={`/dashboard/${o.slug}`} className="rounded-lg border border-white/10 bg-[#34383d] px-3 py-1.5 text-xs text-zinc-100 transition hover:bg-[#40454b]">Voir</Link>
                            <a href={`/offre/${o.slug}`} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-white/10 bg-[#34383d] px-3 py-1.5 text-xs text-zinc-100 transition hover:bg-[#40454b]">Client</a>
                            {o.client_email&&(
                              <a href={`mailto:${o.client_email}?subject=${encodeURIComponent(`Suivi offre ${o.numero_affiche}`)}`}
                                className="rounded-lg border border-white/10 bg-[#34383d] px-3 py-1.5 text-xs text-zinc-100 transition hover:bg-[#40454b]">Mail</a>
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