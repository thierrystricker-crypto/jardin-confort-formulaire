"use client";
// app/dashboard/page.tsx

import StatsCards from "./StatsCards";
import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import Link from "next/link";
import AnnonceStockPopup from "@/components/AnnonceStockPopup";
import ReleaseNotesPopup from "@/components/ReleaseNotesPopup";
import { clicLigne, clicMilieuLigne, useFiltresMemorises } from "@/lib/liste-navigation";

type OffreStatut = "En cours"|"Envoyée"|"Convertie"|"Acceptée"|"Abandonnée"|"Refusée"
type TypeDocument = "Offre"|"Commande"

// ─── Brouillons (Session 6) ───
type DraftRecord = {
  id: number
  slug: string
  numero_draft: number
  numero_affiche: string
  reference: string|null
  client_societe: string|null
  client_nom: string|null
  client_prenom: string|null
  client_email: string|null
  commercial: string|null
  total_ttc: number
  nb_articles: number
  created_at: string
  updated_at: string|null
  transformed_at: string|null
  transformed_into_offre_slug: string|null
  archived: boolean
}
// ──────────────────────────────

// Reflète exactement les colonnes de la vue offres_dashboard.
// La vue ne renvoie plus que ce que ce tableau affiche réellement
// (les notes, adresses et sous-totaux ne servaient à rien ici et
// alourdissaient le chargement pour rien).
type OffreRecord = {
  id: number; slug: string; type_document: TypeDocument
  numero_offre: string|null; numero_commande: string|null; offre_origine: string|null
  numero_affiche: string; statut: OffreStatut; date_document: string|null
  reference: string|null
  commercial: string|null
  client_societe: string|null; client_nom: string|null
  client_prenom: string|null; client_email: string|null; client_ville: string|null
  total_ttc: number; nb_articles: number
  date_derniere_relance: string|null; nb_relances: number|null
  probabilite: string|null
  statut_livraison: "ouverte"|"livree"|null; date_livraison: string|null
  created_at: string; updated_at: string|null
}

function fmtDate(iso: string|null) {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("fr-CH", { day:"2-digit", month:"2-digit", year:"numeric" })
}
function fmtMoney(v: number|null|undefined) {
  if (!v) return "—"
  return "CHF\u00a0" + new Intl.NumberFormat("de-CH", { minimumFractionDigits:2, maximumFractionDigits:2 }).format(v)
}
function nomClient(o: OffreRecord) {
  return [o.client_prenom, o.client_nom].filter(Boolean).join(" ") || "—"
}
// Normalise une chaîne : minuscules + suppression des accents.
// "Château" → "chateau", "CHATEAU" → "chateau" → match croisé garanti.
function normalize(s: string|null|undefined): string {
  return (s||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
}
// Découpe un terme normalisé en mots non vides.
function tokenize(needleNorm: string): string[] {
  return needleNorm.split(/\s+/).filter(Boolean)
}
// Un ensemble de champs matche-t-il TOUS les mots recherchés ?
// Chaque mot doit apparaître dans au moins un des champs (ordre libre).
function matchesAllWords(fields: (string|null|undefined)[], words: string[]): boolean {
  if (words.length === 0) return false
  const blob = fields.map(normalize).join(" ")
  return words.every(w => blob.includes(w))
}
// Score de pertinence (BAS = meilleur). Combine match exact de la chaîne
// complète sur le nom, puis nombre de mots trouvés dans le nom.
function relevanceScore(nameField: string, allFields: (string|null|undefined)[], needleNorm: string, words: string[]): number {
  const name = normalize(nameField)
  if (needleNorm && name === needleNorm) return 0          // nom = terme exact
  if (needleNorm && name.startsWith(needleNorm)) return 1  // nom commence par le terme entier
  if (needleNorm && name.includes(needleNorm)) return 2    // nom contient le terme entier
  // sinon : compter combien de mots tombent dans le nom (plus il y en a, mieux c'est)
  const hitsInName = words.filter(w => name.includes(w)).length
  if (hitsInName === words.length) return 3   // tous les mots dans le nom (ordre différent)
  if (hitsInName > 0) return 4                // certains mots dans le nom
  // aucun mot dans le nom mais match ailleurs (email, ville…) → score faible
  return matchesAllWords(allFields, words) ? 5 : 9
}
function nomClientDraft(d: DraftRecord) {
  return [d.client_prenom, d.client_nom].filter(Boolean).join(" ") || "—"
}
function offreNumeroFromSlug(slug: string|null): string|null {
  // Slug format : "dev-2026-050-cd94b" → "DEV-2026-050"
  // ou           : "cmd-80539-xxxxx"   → "CMD-80539"
  if (!slug) return null
  const parts = slug.split("-")
  if (parts.length < 2) return null
  // On retire le dernier segment (le token aléatoire 5 chars) et on remet en UPPERCASE
  return parts.slice(0, -1).join("-").toUpperCase()
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

type SortKey = "date"|"client"|"montant"|"statut"|"commercial"|"jours"|"numero"|"probabilite"
type SortDir = "asc"|"desc"
type QuickFilter = "all"|"offres"|"commandes"|"a_livrer"|"abandonnes"|"relance"|"prob_forte"|"prob_moyenne"|"prob_faible"|"prob_neutre"

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
    <div onClick={onClick} className={`relative rounded-2xl border p-6 transition ${onClick?"cursor-pointer":""} ${active?"border-2 border-[#2B8AD1] bg-[#2B8AD1]/20 shadow-[0_0_0_3px_rgba(43,138,209,0.35)] ring-1 ring-[#2B8AD1]":"border border-white/10 bg-[#2a2d31] hover:bg-[#34383d]"}`}>
      {active && <div className="absolute right-3 top-3 rounded-full bg-[#2B8AD1] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">✓ Filtré</div>}
      <div className={`text-sm ${active?"text-[#5BB3F0] font-semibold":"text-zinc-400"}`}>{title}</div>
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

// ─── Bouton Notifications avec badge live (compteur des non-lues) ───
// Auto-refresh toutes les 30s. S'anime si nouvelles notifs détectées.
function NotificationsButton() {
  const [unreadCount, setUnreadCount] = useState<number|null>(null)
  const [makeAlert, setMakeAlert] = useState(false)
  const [pulse, setPulse] = useState(false)
  

  // useRef pour stocker previousCount sans déclencher de re-render quand il change.
  // Évite la boucle "fetch → setPreviousCount → loadCount recréé → useEffect
  // redéclenché → nouveau fetch" qui causait des appels en cascade.
  const previousCountRef = useRef<number | null>(null)

  const loadCount = useCallback(async () => {
    try {
      const [notifsRes, healthRes] = await Promise.all([
        fetch("/api/notifications?status=unread&limit=1"),
        fetch("/api/make-health"),
      ])
      if (notifsRes.ok) {
        const json = await notifsRes.json()
        const newCount = json.unread_count || 0
        // Animation pulse si nouvelle notif arrivée
        if (previousCountRef.current !== null && newCount > previousCountRef.current) {
          setPulse(true)
          setTimeout(() => setPulse(false), 3000)
        }
        previousCountRef.current = newCount
        setUnreadCount(newCount)
      }
      if (healthRes.ok) {
        const json = await healthRes.json()
        setMakeAlert(json.alert === true)
      }
    } catch (e) {
      console.error("Notifications count error:", e)
    }
  }, [])  // ← plus de dépendance, useCallback ne se recrée plus jamais

  useEffect(() => {
    loadCount()
    const interval = setInterval(loadCount, 30000)
    return () => clearInterval(interval)
  }, [loadCount])

  const hasUnread = unreadCount !== null && unreadCount > 0

  return (
    <Link href="/dashboard/notifications"
      className={`relative inline-flex items-center gap-2 rounded-2xl border px-4 py-3 text-sm transition ${
        hasUnread
          ? "border-amber-500/40 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25"
          : "border-white/10 bg-[#2a2d31] text-zinc-300 hover:bg-[#34383d]"
      } ${pulse ? "ring-2 ring-amber-400 ring-offset-2 ring-offset-[#1f2125]" : ""}`}>
      <span className={pulse ? "animate-bounce" : ""}>🔔</span>
      <span>Notifications</span>
      {hasUnread && (
        <span className="inline-flex items-center justify-center rounded-full bg-rose-500 px-2 py-0.5 text-xs font-bold text-white min-w-[1.5rem]">
          {unreadCount}
        </span>
      )}
      {makeAlert && (
        <span className="ml-1 inline-flex items-center text-rose-400" title="Le flow Make semble en panne — vérifier dans le centre de notifications">
          ⚠
        </span>
      )}
    </Link>
  )
}
// ──────────────────────────────────────────────────────────────────

const PROB_ORDER: Record<string,number> = { forte:0, moyenne:1, neutre:2, faible:3 }

export default function DashboardPage() {
  const [offres,setOffres]=useState<OffreRecord[]>([])
  const [remisesCount, setRemisesCount] = useState(0)
  const [loading,setLoading]=useState(true)
  const [search,setSearch]=useState("")
  const [quickFilter,setQuickFilter]=useState<QuickFilter>("all")
  const [commercial,setCommercial]=useState("all")
  const [hideAbandoned,setHideAbandoned]=useState(true)  // masqué par défaut
  const [hideConverted,setHideConverted]=useState(true)  // offres converties masquées par défaut
  const [sortKey,setSortKey]=useState<SortKey>("date")
  const [sortDir,setSortDir]=useState<SortDir>("desc")

  // ─── Brouillons (Session 6) ───
  const [drafts,setDrafts]=useState<DraftRecord[]>([])
  const [hideTransformedDrafts,setHideTransformedDrafts]=useState(true)
  const [draftsCollapsed,setDraftsCollapsed]=useState(false)
  // ──────────────────────────────

  // ─── Recherche par article ───
  // articleHits : { idOffre → "SKU · libellé | SKU · libellé" }
  // Rempli par /api/dashboard/articles, qui interroge la table
  // offres_articles (lignes extraites du JSON des offres par trigger).
  // La recherche texte classique reste 100 % locale et instantanée ;
  // celle-ci vient s'y ajouter, en léger différé.
  const [articleHits,setArticleHits]=useState<Record<number,string>>({})
  const [articleSearching,setArticleSearching]=useState(false)
  const [searchArticles,setSearchArticles]=useState(true)

  // Filtres mémorisés le temps de l'onglet : on ouvre une offre, on revient,
  // et la recherche, les filtres rapides, le commercial et le tri sont encore
  // là. Voir lib/liste-navigation.ts.
  useFiltresMemorises("dashboard:filtres", {
    search, quickFilter, commercial, hideAbandoned, hideConverted,
    sortKey, sortDir, searchArticles, hideTransformedDrafts, draftsCollapsed,
  }, v => {
    if (typeof v.search === "string") setSearch(v.search)
    if (typeof v.quickFilter === "string") setQuickFilter(v.quickFilter as QuickFilter)
    if (typeof v.commercial === "string") setCommercial(v.commercial)
    if (typeof v.hideAbandoned === "boolean") setHideAbandoned(v.hideAbandoned)
    if (typeof v.hideConverted === "boolean") setHideConverted(v.hideConverted)
    if (typeof v.sortKey === "string") setSortKey(v.sortKey as SortKey)
    if (typeof v.sortDir === "string") setSortDir(v.sortDir as SortDir)
    if (typeof v.searchArticles === "boolean") setSearchArticles(v.searchArticles)
    if (typeof v.hideTransformedDrafts === "boolean") setHideTransformedDrafts(v.hideTransformedDrafts)
    if (typeof v.draftsCollapsed === "boolean") setDraftsCollapsed(v.draftsCollapsed)
  })
  // ─────────────────────────────

  function loadOffres() {
    setLoading(true)
    fetch("/api/dashboard/offres")
      .then(r=>r.json()).then(d=>setOffres(Array.isArray(d)?d:[]))
      .catch(()=>setOffres([])).finally(()=>setLoading(false))
  }
  function loadDrafts() {
    fetch("/api/drafts?archived=all")
      .then(r=>r.json()).then(d=>setDrafts(Array.isArray(d?.drafts)?d.drafts:[]))
      .catch(()=>setDrafts([]))
  }
  useEffect(()=>{loadOffres();loadDrafts()},[])

  // Compteur "à remettre en stock" pour le badge du lien Remise en stock.
  // countOnly=1 : trois COUNT(*) et rien d'autre. Sans ce paramètre,
  // l'endpoint interrogeait Shopify une fois par article en attente
  // (plusieurs secondes) pour un simple chiffre dans un badge.
  useEffect(()=>{
    fetch("/api/stock-remises?countOnly=1")
      .then(r=>r.ok?r.json():null)
      .then(j=>{ if(j?.stats?.a_remettre!=null) setRemisesCount(j.stats.a_remettre) })
      .catch(()=>{})
  },[])

  // Recherche pré-remplie depuis l'URL (?recherche=…) — utilisé par les liens
  // « Voir les dossiers » de la page Statistiques.
  useEffect(()=>{
    const q = new URLSearchParams(window.location.search).get("recherche")
    if (q) setSearch(q)
  },[])

  // Recherche par article : appel serveur débouncé (300 ms) sur le terme saisi.
  // Annulé proprement si l'utilisateur continue de taper.
  useEffect(()=>{
    const q = search.trim()
    if (!searchArticles || q.length < 2) { setArticleHits({}); setArticleSearching(false); return }
    const ctrl = new AbortController()
    const timer = setTimeout(()=>{
      setArticleSearching(true)
      fetch(`/api/dashboard/articles?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
        .then(r=>r.ok?r.json():null)
        .then(j=>{ setArticleHits(j?.hits || {}) })
        .catch(()=>{ /* abort ou erreur réseau : on garde la recherche locale */ })
        .finally(()=>setArticleSearching(false))
    }, 300)
    return ()=>{ clearTimeout(timer); ctrl.abort() }
  },[search,searchArticles])

  // Préférence "chercher aussi dans les articles"
  useEffect(()=>{
    const saved = localStorage.getItem("dashboard-search-articles")
    if (saved !== null) setSearchArticles(saved === "true")
  },[])
  useEffect(()=>{
    localStorage.setItem("dashboard-search-articles", String(searchArticles))
  },[searchArticles])

  // Charger les préférences "masquer" depuis localStorage
  useEffect(()=>{
    const savedAb = localStorage.getItem("dashboard-hide-abandoned")
    if (savedAb !== null) setHideAbandoned(savedAb === "true")
    const savedConv = localStorage.getItem("dashboard-hide-converted")
    if (savedConv !== null) setHideConverted(savedConv === "true")
  },[])

  // Sauvegarder les préférences à chaque changement
  useEffect(()=>{
    localStorage.setItem("dashboard-hide-abandoned", String(hideAbandoned))
  },[hideAbandoned])

  useEffect(()=>{
    localStorage.setItem("dashboard-hide-converted", String(hideConverted))
  },[hideConverted])

  // ─── Brouillons (Session 6) : prefs localStorage + auto-collapse ───
  useEffect(()=>{
    const savedHide = localStorage.getItem("dashboard-hide-transformed-drafts")
    if (savedHide !== null) setHideTransformedDrafts(savedHide === "true")
    const savedCollapsed = localStorage.getItem("dashboard-drafts-collapsed")
    if (savedCollapsed !== null) setDraftsCollapsed(savedCollapsed === "true")
  },[])

  useEffect(()=>{
    localStorage.setItem("dashboard-hide-transformed-drafts", String(hideTransformedDrafts))
  },[hideTransformedDrafts])

  useEffect(()=>{
    localStorage.setItem("dashboard-drafts-collapsed", String(draftsCollapsed))
  },[draftsCollapsed])

  // Filtrage des brouillons (commercial global + filtre transformés + recherche)
  const filteredDrafts = useMemo(()=>{
    let list = drafts
    if (commercial !== "all") list = list.filter(d => d.commercial === commercial)
    if (hideTransformedDrafts) list = list.filter(d => !d.archived)
    const qNorm = normalize(search.trim())
    const qWords = tokenize(qNorm)
    if (qNorm) {
      const nomD = (d:DraftRecord)=>[d.client_prenom,d.client_nom].filter(Boolean).join(" ")
      const fieldsOf = (d:DraftRecord) => [nomD(d), d.numero_affiche, d.client_email, d.client_societe, d.commercial, d.reference]
      list = list.filter(d => matchesAllWords(fieldsOf(d), qWords))
      // Tri par pertinence (meilleur match en tête), départage updated_at DESC
      list = [...list].sort((a,b)=>{
        const sa = relevanceScore(nomD(a), fieldsOf(a), qNorm, qWords)
        const sb = relevanceScore(nomD(b), fieldsOf(b), qNorm, qWords)
        if (sa!==sb) return sa-sb
        return (b.updated_at||"").localeCompare(a.updated_at||"")
      })
    }
    return list  // sans recherche : déjà trié updated_at DESC côté API
  },[drafts,commercial,hideTransformedDrafts,search])

  const draftsActifs = useMemo(()=>{
    const scope = commercial==="all" ? drafts : drafts.filter(d=>d.commercial===commercial)
    return scope.filter(d => !d.archived).length
  },[drafts,commercial])

  const draftsTotal = useMemo(()=>{
    const scope = commercial==="all" ? drafts : drafts.filter(d=>d.commercial===commercial)
    return scope.length
  },[drafts,commercial])
  // ──────────────────────────────────────────────────────────────────

  function handleSort(k:SortKey) {
    if(k===sortKey){setSortDir(d=>d==="asc"?"desc":"asc");return}
    setSortKey(k);setSortDir("desc")
  }

  const filtered=useMemo(()=>{
    let list=offres
    // Masquer les abandonnées/refusées par défaut (sauf si on est explicitement sur le filtre "abandonnés")
    if(hideAbandoned && quickFilter !== "abandonnes") {
      list=list.filter(o=>!["Abandonnée","Refusée"].includes(o.statut))
    }
    // Masquer les offres converties (Acceptée + Convertie) - leurs commandes apparaissent juste à côté
    if(hideConverted && quickFilter !== "commandes") {
      list=list.filter(o=>!(o.type_document==="Offre"&&["Acceptée","Convertie"].includes(o.statut)))
    }
    if(quickFilter==="offres") list=list.filter(o=>o.type_document==="Offre"&&!["Abandonnée","Convertie","Refusée"].includes(o.statut))
    else if(quickFilter==="commandes") list=list.filter(o=>o.type_document==="Commande"||o.statut==="Acceptée")
    else if(quickFilter==="a_livrer") list=list.filter(o=>o.type_document==="Commande"&&o.statut_livraison!=="livree")
    else if(quickFilter==="abandonnes") list=list.filter(o=>["Abandonnée","Refusée"].includes(o.statut))
    else if(quickFilter==="relance") list=list.filter(o=>{const d=getDaysOpen(o);return d!==null&&d>=7})
    // ─── Filtres par probabilité (uniquement sur les offres en cours, pas les commandes) ───
    else if(quickFilter==="prob_forte") list=list.filter(o=>o.type_document==="Offre"&&!["Acceptée","Convertie","Abandonnée","Refusée"].includes(o.statut)&&o.probabilite==="forte")
    else if(quickFilter==="prob_moyenne") list=list.filter(o=>o.type_document==="Offre"&&!["Acceptée","Convertie","Abandonnée","Refusée"].includes(o.statut)&&o.probabilite==="moyenne")
    else if(quickFilter==="prob_faible") list=list.filter(o=>o.type_document==="Offre"&&!["Acceptée","Convertie","Abandonnée","Refusée"].includes(o.statut)&&o.probabilite==="faible")
    else if(quickFilter==="prob_neutre") list=list.filter(o=>o.type_document==="Offre"&&!["Acceptée","Convertie","Abandonnée","Refusée"].includes(o.statut)&&(!o.probabilite||o.probabilite==="neutre"))
    if(commercial!=="all") list=list.filter(o=>o.commercial===commercial)
    const qNorm = normalize(search.trim())
    const qWords = tokenize(qNorm)
    const fieldsOf = (o:OffreRecord) => [nomClient(o), o.numero_affiche, o.client_email, o.client_ville, o.client_societe, o.commercial, o.reference]
    if(qNorm){
      // Chaque mot recherché doit matcher au moins un champ (ordre libre),
      // OU le dossier contient un article correspondant au terme cherché.
      list=list.filter(o => matchesAllWords(fieldsOf(o), qWords) || !!articleHits[o.id])
    }
    // Quand une recherche est active, on classe par pertinence AVANT le tri colonne.
    // Un dossier trouvé uniquement par son contenu (article) passe après ceux
    // trouvés par le nom du client, mais reste visible.
    function bestScore(o:OffreRecord): number {
      const s = relevanceScore(nomClient(o), fieldsOf(o), qNorm, qWords)
      if (s === 9 && articleHits[o.id]) return 6
      return s
    }
    return [...list].sort((a,b)=>{
      if(qNorm){
        const sa=bestScore(a), sb=bestScore(b)
        if(sa!==sb) return sa-sb  // pertinence d'abord (0 = meilleur)
      }
      let av:string|number="",bv:string|number=""
      if(sortKey==="numero"){av=a.id;bv=b.id}
      else if(sortKey==="date"){av=a.date_document||"";bv=b.date_document||""}
      else if(sortKey==="client"){av=nomClient(a);bv=nomClient(b)}
      else if(sortKey==="montant"){av=a.total_ttc||0;bv=b.total_ttc||0}
      else if(sortKey==="statut"){av=a.statut;bv=b.statut}
      else if(sortKey==="commercial"){av=a.commercial||"";bv=b.commercial||""}
      else if(sortKey==="jours"){av=getDaysOpen(a)??-1;bv=getDaysOpen(b)??-1}
      else if(sortKey==="probabilite"){
        av=PROB_ORDER[a.probabilite||"neutre"]??2
        bv=PROB_ORDER[b.probabilite||"neutre"]??2
      }
      if(av<bv) return sortDir==="asc"?-1:1
      if(av>bv) return sortDir==="asc"?1:-1
      return 0
    })
  },[offres,quickFilter,commercial,search,sortKey,sortDir,hideAbandoned,hideConverted,articleHits])

  // Nombre de dossiers ramenés uniquement par la recherche article
  const nbParArticle = useMemo(()=>{
    const qWords = tokenize(normalize(search.trim()))
    if (qWords.length === 0) return 0
    return filtered.filter(o =>
      articleHits[o.id] && !matchesAllWords(
        [nomClient(o), o.numero_affiche, o.client_email, o.client_ville, o.client_societe, o.commercial, o.reference],
        qWords
      )
    ).length
  },[filtered,articleHits,search])

  const statsFiltered=useMemo(()=>computeStats(
    commercial==="all" ? offres : offres.filter(o=>o.commercial===commercial)
  ),[offres,commercial])

  const quickFilters:{label:string;value:QuickFilter}[] = [
    {label:"Toutes",value:"all"},{label:"Offres actives",value:"offres"},
    {label:"Commandes",value:"commandes"},
    {label:"🚚 Commandes à livrer",value:"a_livrer"},
    {label:"Abandonnées",value:"abandonnes"},
    {label:"À relancer (≥7j)",value:"relance"},
  ]

  if(loading) return (
    <main className="min-h-screen bg-[#1f2125] px-6 py-8 text-zinc-100">
      <div className="mx-auto max-w-[1700px] rounded-2xl border border-white/10 bg-[#2a2d31] p-8 text-zinc-400">Chargement…</div>
    </main>
  )

  return (
    <main className="min-h-screen bg-[#1f2125] px-6 py-8 text-zinc-100">
      {/* Annonce temporaire équipe : bug sorties de stock corrigé (jusqu'au 10.08.2026) */}
      <AnnonceStockPopup />
      {/* Release notes 23.08.2026 : flèches de déplacement, Arrivages, Délais
          fournisseurs. Monté ici plutôt que sur /drafts/nouveau — deux des trois
          nouveautés vivent sur cette page. S'éteint seul le 31.08. */}
      <ReleaseNotesPopup />
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
              <Link href="/drafts/nouveau" target="_blank" rel="noopener noreferrer" className="inline-flex items-center rounded-2xl bg-[#2B8AD1] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#2478b8]">+ Nouvelle offre (brouillon)</Link>
              <NotificationsButton/>
              <Link href="/dashboard/jardi" target="_blank" rel="noopener noreferrer" className="inline-flex items-center rounded-2xl border border-sky-500/30 bg-sky-500/15 px-4 py-3 text-sm text-sky-300 transition hover:bg-sky-500/25">💬 Jardi</Link>
              <Link href="/dashboard/clients" className="inline-flex items-center rounded-2xl border border-white/10 bg-[#2a2d31] px-4 py-3 text-sm text-zinc-300 transition hover:bg-[#34383d]">👥 Clients</Link>
              <Link href="/dashboard/arrivages" className="inline-flex items-center rounded-2xl border border-emerald-500/30 bg-emerald-500/15 px-4 py-3 text-sm text-emerald-300 transition hover:bg-emerald-500/20" title="Réception des marchandises par article et par quantité — scan de la fiche de travail">📦 Arrivages</Link>
              <Link href="/dashboard/delais" className="inline-flex items-center rounded-2xl border border-rose-500/30 bg-rose-500/15 px-4 py-3 text-sm text-rose-300 transition hover:bg-rose-500/20" title="Suivi des délais fournisseurs : retards, échéances, délais manquants — alimenté automatiquement par les mails">⏱ Délais fournisseurs</Link>
              <Link href="/dashboard/stock-movements" className="inline-flex items-center rounded-2xl border border-purple-500/30 bg-purple-500/15 px-4 py-3 text-sm text-purple-300 transition hover:bg-purple-500/20">📦 Mouvements de stock</Link>
                <Link href="/dashboard/stock-remises" className="inline-flex items-center gap-2 rounded-2xl border border-amber-500/30 bg-amber-500/15 px-4 py-3 text-sm text-amber-300 transition hover:bg-amber-500/20">📦 Remise en stock{remisesCount > 0 && (<span className="inline-flex min-w-[20px] items-center justify-center rounded-full bg-amber-500 px-1.5 text-xs font-bold text-black">{remisesCount}</span>)}</Link>
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
            <div className="relative w-full">
              <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Recherche : client, référence, email, ville, article (n° ou libellé)…"
                className="w-full rounded-xl border border-white/10 bg-[#2a2d31] px-4 py-2.5 pr-28 text-sm text-zinc-100 outline-none placeholder:text-zinc-500"/>
              {articleSearching && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-500">
                  📦 recherche…
                </span>
              )}
            </div>
            <button onClick={()=>{setSearch("");setQuickFilter("all");setCommercial("all")}} className="rounded-xl border border-white/10 bg-[#34383d] px-4 py-2.5 text-sm text-zinc-100 transition hover:bg-[#40454b]">Reset</button>
          </div>

          {/* Toggles masquer abandonnées + converties */}
          <div className="flex items-center gap-6 flex-wrap">
            <label className="inline-flex items-center gap-2 cursor-pointer text-sm text-zinc-400 hover:text-zinc-200">
              <input
                type="checkbox"
                checked={hideAbandoned}
                onChange={e=>setHideAbandoned(e.target.checked)}
                className="rounded border-white/20"
              />
              <span>Masquer les abandonnées et refusées</span>
              {hideAbandoned && (
                <span className="text-xs text-zinc-500">
                  ({offres.filter(o=>["Abandonnée","Refusée"].includes(o.statut)).length} masquées)
                </span>
              )}
            </label>
            <label className="inline-flex items-center gap-2 cursor-pointer text-sm text-zinc-400 hover:text-zinc-200">
              <input
                type="checkbox"
                checked={hideConverted}
                onChange={e=>setHideConverted(e.target.checked)}
                className="rounded border-white/20"
              />
              <span>Masquer les offres converties</span>
              {hideConverted && (
                <span className="text-xs text-zinc-500">
                  ({offres.filter(o=>o.type_document==="Offre"&&["Acceptée","Convertie"].includes(o.statut)).length} masquées)
                </span>
              )}
            </label>
            <label className="inline-flex items-center gap-2 cursor-pointer text-sm text-zinc-400 hover:text-zinc-200"
              title="Cherche aussi le terme saisi dans les articles des offres et commandes (n° d'article ou libellé)">
              <input
                type="checkbox"
                checked={searchArticles}
                onChange={e=>setSearchArticles(e.target.checked)}
                className="rounded border-white/20"
              />
              <span>📦 Chercher aussi dans les articles</span>
            </label>
          </div>

         {/* Wrapper : 2 lignes de filtres à gauche + StatsCards à droite occupant la hauteur des 2 lignes */}
          {/* Mobile (24.08.2026) — la colonne de gauche était en `flex-shrink-0`
              alors qu'elle contient deux rangées en `flex-wrap` : elle prenait
              donc sa largeur max-content (tous les boutons sur une ligne, ~1000 px)
              et ne rétrécissait jamais. Le document dépassait la largeur de
              l'écran, Safari réduisait toute la page pour la faire tenir, et les
              StatsCards à droite se retrouvaient écrasées, texte superposé.
              Empilé en dessous de xl, côte à côte au-delà. */}
          <div className="flex flex-col gap-3 xl:flex-row xl:items-stretch">
            {/* Colonne de gauche : 2 lignes empilées (quick-filters + probabilité) */}
            <div className="flex min-w-0 flex-col gap-2 xl:flex-shrink-0">
              {/* Ligne 1 : filtres rapides */}
              <div className="flex flex-wrap gap-2 items-center">
                {quickFilters.map(f=>(
                  <button key={f.value} type="button" onClick={()=>setQuickFilter(f.value)}
                    className={`rounded-full px-4 py-2 text-sm transition ${quickFilter===f.value?"bg-zinc-100 text-zinc-900":"border border-white/10 bg-[#34383d] text-zinc-200 hover:bg-[#40454b]"}`}>
                    {f.label}
                  </button>
                ))}
              </div>
              {/* Ligne 2 : probabilités */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Probabilité :</span>
                {[
                  {value:"prob_forte" as QuickFilter, icon:"🟢", label:"Forte", count:offres.filter(o=>o.type_document==="Offre"&&!["Acceptée","Convertie","Abandonnée","Refusée"].includes(o.statut)&&o.probabilite==="forte").length},
                  {value:"prob_moyenne" as QuickFilter, icon:"🟡", label:"Moyenne", count:offres.filter(o=>o.type_document==="Offre"&&!["Acceptée","Convertie","Abandonnée","Refusée"].includes(o.statut)&&o.probabilite==="moyenne").length},
                  {value:"prob_faible" as QuickFilter, icon:"🔴", label:"Faible", count:offres.filter(o=>o.type_document==="Offre"&&!["Acceptée","Convertie","Abandonnée","Refusée"].includes(o.statut)&&o.probabilite==="faible").length},
                  {value:"prob_neutre" as QuickFilter, icon:"⚪", label:"Non définie", count:offres.filter(o=>o.type_document==="Offre"&&!["Acceptée","Convertie","Abandonnée","Refusée"].includes(o.statut)&&(!o.probabilite||o.probabilite==="neutre")).length},
                ].map(f=>(
                  <button key={f.value} type="button" onClick={()=>setQuickFilter(quickFilter===f.value?"all":f.value)}
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition ${quickFilter===f.value?"bg-zinc-100 text-zinc-900":"border border-white/10 bg-[#34383d] text-zinc-200 hover:bg-[#40454b]"}`}>
                    <span>{f.icon}</span>
                    <span>{f.label}</span>
                    <span className={`inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 text-xs font-semibold ${quickFilter===f.value?"bg-zinc-300 text-zinc-700":"bg-white/10 text-zinc-400"}`}>{f.count}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Colonne de droite : StatsCards calées sur la hauteur des 2 lignes filtres */}
            <StatsCards />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <KpiCard title="Offres actives" value={statsFiltered.totalOffres} sub={`${offres.length} dossiers total`} extra={`${fmtMoney(statsFiltered.caOffres)} potentiel`}
            onClick={()=>setQuickFilter(quickFilter==="offres"?"all":"offres")} active={quickFilter==="offres"}/>
          <KpiCard title="Commandes" value={statsFiltered.totalCommandes} sub={`${offres.length} dossiers total`} extra={`${fmtMoney(statsFiltered.caCommandes)} confirmé`}
            onClick={()=>setQuickFilter(quickFilter==="commandes"?"all":"commandes")} active={quickFilter==="commandes"}/>
          <KpiCard title="À relancer" value={statsFiltered.aRelancer} sub="Offres ouvertes ≥ 7 jours" extra={statsFiltered.aRelancer>0?"⚠ Action requise":"✓ À jour"}
            onClick={()=>setQuickFilter(quickFilter==="relance"?"all":"relance")} active={quickFilter==="relance"}/>
          <KpiCard title="Abandonnées" value={statsFiltered.totalAbandonnes} sub={`${offres.length} dossiers total`}
            onClick={()=>setQuickFilter(quickFilter==="abandonnes"?"all":"abandonnes")} active={quickFilter==="abandonnes"}/>
          <KpiCard title="📝 Brouillons" value={draftsActifs} sub={`${draftsTotal} au total`} extra={draftsActifs>0?"À finaliser":"✓ Rien en attente"}
            onClick={()=>{ setDraftsCollapsed(false); document.getElementById("section-brouillons")?.scrollIntoView({behavior:"smooth"}); }} active={false}/>
        </div>

        
        <div className="space-y-3">
          <div className="text-sm text-zinc-400">
            {filtered.length} résultat(s)
            {nbParArticle > 0 && (
              <span className="ml-2 text-violet-300">
                · dont {nbParArticle} trouvé{nbParArticle>1?"s":""} par article
              </span>
            )}
          </div>
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
                    <SortTh label="Prob." k="probabilite" cur={sortKey} dir={sortDir} onSort={handleSort}/>
                    <SortTh label="Jours" k="jours" cur={sortKey} dir={sortDir} onSort={handleSort}/>
                    <SortTh label="Date" k="date" cur={sortKey} dir={sortDir} onSort={handleSort}/>
                    <th className="px-4 py-3 text-right font-medium text-zinc-400">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length===0?(
                    <tr><td colSpan={10} className="px-4 py-10 text-center text-zinc-500">Aucun dossier trouvé.</td></tr>
                  ):filtered.map((o,idx)=>{
                    const days=getDaysOpen(o)
                    // Distinction visuelle : seules les vraies CMD sont vertes, tout le reste bleu (offres)
                    const isCmd = o.type_document==="Commande"
                    const rowBg = isCmd
                      ? (idx%2===0 ? "bg-emerald-500/[0.10]" : "bg-emerald-500/[0.14]")
                      : (idx%2===0 ? "bg-sky-500/[0.03]" : "bg-sky-500/[0.06]")
                    const leftBorder = isCmd
                      ? "border-l-4 border-l-emerald-400/80"
                      : "border-l-4 border-l-sky-500/40"
                    return (
                      <tr key={o.id}
                        onClick={e=>clicLigne(`/dashboard/${o.slug}`,e)}
                        onAuxClick={e=>clicMilieuLigne(`/dashboard/${o.slug}`,e)}
                        title="Ctrl/Cmd+clic ou clic milieu : ouvrir dans un nouvel onglet"
                        className={`${rowBg} ${leftBorder} cursor-pointer border-t border-white/5 text-zinc-200 transition hover:bg-white/10`}>
                        <td className="px-4 py-4">
                          <div className="font-semibold text-zinc-100">{o.numero_affiche}</div>
                          {o.reference && (
                            <div className="text-xs text-amber-300 mt-0.5 italic" title="Référence client">
                              📌 {o.reference}
                            </div>
                          )}
                          <div className="text-xs text-zinc-500 mt-0.5">{o.type_document}</div>
                          {o.statut==="Convertie" && o.numero_commande && (
                            <div className="text-xs text-emerald-400 mt-0.5">→ {o.numero_commande}</div>
                          )}
                          {o.offre_origine && (
                            <div className="text-xs text-sky-400 mt-0.5">← {o.offre_origine}</div>
                          )}
                          {articleHits[o.id] && (
                            <div className="text-xs text-violet-300 mt-1 max-w-[260px] truncate"
                              title={articleHits[o.id].replace(/ \| /g, "\n")}>
                              📦 {articleHits[o.id].replace(/\s*\n\s*/g, " ")}
                            </div>
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
                          <div className="flex flex-col items-start gap-1">
                            <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${getStatusColor(o.statut,o.type_document)}`}>{o.statut}</span>
                            {/* Livraison (commandes magasin) — équivalent du fulfilled Shopify.
                                Le clic « Marquer livrée » est sur la page commande (Voir). */}
                            {o.type_document==="Commande"&&(
                              o.statut_livraison==="livree" ? (
                                <span className="inline-flex items-center rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-medium text-emerald-300"
                                  title={o.date_livraison?`Livrée le ${fmtDate(o.date_livraison)}`:"Livrée"}>
                                  🚚 Livrée
                                </span>
                              ) : (
                                <span className="inline-flex items-center rounded-full bg-amber-500/15 px-3 py-1 text-xs font-medium text-amber-300"
                                  title="Pas encore livrée — clic « Marquer livrée » sur la page commande">
                                  ⏳ À livrer
                                </span>
                              )
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-4 text-center text-lg">
                          {/* Le feu de probabilité ne s'affiche QUE pour les offres en cours.
                              Les commandes (CMD-XXXXX) ou offres acceptées/converties/abandonnées
                              n'ont plus besoin de feu : le statut suffit. */}
                          {(o.type_document==="Commande"||["Acceptée","Convertie","Abandonnée","Refusée"].includes(o.statut)) ? (
                            <span className="text-zinc-700">—</span>
                          ) : o.probabilite==="forte"  ? <span title="Forte">🟢</span>
                          : o.probabilite==="moyenne" ? <span title="Moyenne">🟡</span>
                          : o.probabilite==="faible"  ? <span title="Faible">🔴</span>
                          : <span title="Non définie" className="text-zinc-600">⚪</span>}
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
                          <div className="flex justify-end gap-2" onClick={e=>e.stopPropagation()} onAuxClick={e=>e.stopPropagation()}>
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

        {/* ─── Section Brouillons (Session 6) ─── */}
        <div id="section-brouillons" className="space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <button type="button" onClick={()=>setDraftsCollapsed(c=>!c)}
                className="inline-flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-200 transition hover:bg-amber-500/15">
                <span>{draftsCollapsed?"▶":"▼"}</span>
                <span>📝 Brouillons</span>
                <span className="inline-flex items-center justify-center rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-semibold">
                  {draftsActifs} {draftsActifs>1?"actifs":"actif"} / {draftsTotal} au total
                </span>
              </button>
              <button type="button" onClick={()=>window.scrollTo({top:0,behavior:"smooth"})}
                title="Remonter en haut du dashboard"
                className="inline-flex items-center gap-1 rounded-xl border border-white/10 bg-[#2a2d31] px-3 py-2 text-sm text-zinc-300 transition hover:bg-[#34383d]">
                <span>⬆</span>
                <span>Haut</span>
              </button>
            </div>
            {!draftsCollapsed && (
              <div className="flex items-center gap-4 flex-wrap">
                <label className="inline-flex items-center gap-2 cursor-pointer text-sm text-zinc-400 hover:text-zinc-200">
                  <input type="checkbox" checked={hideTransformedDrafts}
                    onChange={e=>setHideTransformedDrafts(e.target.checked)}
                    className="rounded border-white/20"/>
                  <span>Masquer brouillons transformés</span>
                  {hideTransformedDrafts && (
                    <span className="text-xs text-zinc-500">
                      ({drafts.filter(d=>d.archived&&(commercial==="all"||d.commercial===commercial)).length} masqués)
                    </span>
                  )}
                </label>
                <Link href="/drafts/nouveau" target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-200 transition hover:bg-amber-500/15">
                  + Nouveau brouillon
                </Link>
                <button onClick={loadDrafts}
                  className="inline-flex items-center rounded-xl border border-white/10 bg-[#2a2d31] px-3 py-2 text-xs text-zinc-300 transition hover:bg-[#34383d]">
                  🔄
                </button>
              </div>
            )}
          </div>

          {!draftsCollapsed && (
            <>
              <div className="text-sm text-zinc-400">{filteredDrafts.length} brouillon(s) affiché(s)</div>
              <div className="overflow-hidden rounded-2xl border border-amber-500/20 bg-[#2a2d31]">
                <div className="overflow-x-auto">
                  <table className="min-w-full border-collapse text-sm">
                    <thead className="bg-amber-500/5 text-left text-zinc-400">
                      <tr>
                        <th className="px-4 py-3 font-medium">Réf.</th>
                        <th className="px-4 py-3 font-medium">Client</th>
                        <th className="px-4 py-3 font-medium">Conseiller</th>
                        <th className="px-4 py-3 font-medium">Montant</th>
                        <th className="px-4 py-3 font-medium">Statut</th>
                        <th className="px-4 py-3 font-medium">Modifié le</th>
                        <th className="px-4 py-3 text-right font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredDrafts.length===0 ? (
                        <tr><td colSpan={7} className="px-4 py-10 text-center text-zinc-500">
                          {drafts.length===0 ? "Aucun brouillon créé." : "Aucun brouillon ne correspond aux filtres."}
                        </td></tr>
                      ) : filteredDrafts.map((d,idx)=>{
                        const isTransformed = d.archived
                        const rowBg = isTransformed
                          ? (idx%2===0 ? "bg-zinc-700/10" : "bg-zinc-700/20")
                          : (idx%2===0 ? "bg-amber-500/[0.04]" : "bg-amber-500/[0.08]")
                        const leftBorder = isTransformed
                          ? "border-l-4 border-l-zinc-600/50"
                          : "border-l-4 border-l-amber-400/60"
                        const textOpacity = isTransformed ? "text-zinc-400" : "text-zinc-200"
                        return (
                          <tr key={d.id}
                            onClick={e=>clicLigne(`/dashboard/draft/${d.slug}`,e)}
                            onAuxClick={e=>clicMilieuLigne(`/dashboard/draft/${d.slug}`,e)}
                            title="Ctrl/Cmd+clic ou clic milieu : ouvrir dans un nouvel onglet"
                            className={`${rowBg} ${leftBorder} ${textOpacity} cursor-pointer border-t border-white/5 transition hover:bg-white/10`}>
                            <td className="px-4 py-4">
                              <div className={`font-semibold ${isTransformed?"text-zinc-400":"text-amber-200"}`}>{d.numero_affiche}</div>
                              {d.reference && (
                                <div className="text-xs text-amber-300 mt-0.5 italic" title="Référence client">
                                  📌 {d.reference}
                                </div>
                              )}
                              {isTransformed && d.transformed_into_offre_slug && (
                                <div className="text-xs text-emerald-400 mt-0.5">
                                  → {offreNumeroFromSlug(d.transformed_into_offre_slug) || "Transformé"}
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-4">
                              <div>{nomClientDraft(d)}</div>
                              {d.client_societe && <div className="text-xs text-zinc-500">{d.client_societe}</div>}
                              {d.client_email && <div className="text-xs text-zinc-500">{d.client_email}</div>}
                            </td>
                            <td className="px-4 py-4">{d.commercial||"—"}</td>
                            <td className="px-4 py-4 font-medium">{fmtMoney(d.total_ttc)}</td>
                            <td className="px-4 py-4">
                              {isTransformed ? (
                                <span className="inline-flex items-center rounded-full bg-zinc-600/30 px-3 py-1 text-xs font-medium text-zinc-300">🔒 Transformé</span>
                              ) : (
                                <span className="inline-flex items-center rounded-full bg-amber-500/15 px-3 py-1 text-xs font-medium text-amber-300">📝 Brouillon</span>
                              )}
                            </td>
                            <td className="px-4 py-4 text-zinc-400">{fmtDate(d.updated_at)}</td>
                            <td className="px-4 py-4">
                              <div className="flex justify-end gap-2" onClick={e=>e.stopPropagation()} onAuxClick={e=>e.stopPropagation()}>
                                <Link href={`/dashboard/draft/${d.slug}`}
                                  className="rounded-lg border border-white/10 bg-[#34383d] px-3 py-1.5 text-xs text-zinc-100 transition hover:bg-[#40454b]">Voir</Link>
                                {!isTransformed && (
                                  <Link href={`/drafts/${d.slug}/editer`}
                                    className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-200 transition hover:bg-amber-500/20">✏️ Modifier</Link>
                                )}
                                {isTransformed && d.transformed_into_offre_slug && (
                                  <Link href={`/dashboard/${d.transformed_into_offre_slug}`}
                                    className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-200 transition hover:bg-emerald-500/20">→ Offre</Link>
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
            </>
          )}
        </div>
        {/* ─── Fin section Brouillons ─── */}

      </div>
    </main>
  )
}