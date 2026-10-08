"use client";
// app/v2/page.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Dashboard 2.0 — accueil « Offres & commandes ».
//
// LA LOGIQUE EST CELLE DE app/dashboard/page.tsx, reprise à l'identique :
// mêmes endpoints, même recherche multi-mots normalisée + par article, mêmes
// filtres, même tri, mêmes préférences localStorage, mêmes règles de statut.
// Seule la présentation change :
//   • les 16 boutons de navigation → menu latéral (V2Shell) ;
//   • select + pastilles + rangée probabilité + 3 cases → 1 barre d'onglets
//     et 1 bouton « Filtres » ; les filtres actifs s'affichent en étiquettes ;
//   • Voir / Client / Mail par ligne → ligne cliquable + menu ⋯ ;
//   • la section Brouillons devient un onglet.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import StatsCards from "@/app/dashboard/StatsCards";
import { useFiltresMemorises } from "@/lib/liste-navigation";
import Legacy from "./_components/Legacy";

type OffreStatut = "En cours" | "Envoyée" | "Convertie" | "Acceptée" | "Abandonnée" | "Refusée";
type TypeDocument = "Offre" | "Commande";

type DraftRecord = {
  id: number;
  slug: string;
  numero_draft: number;
  numero_affiche: string;
  reference: string | null;
  client_societe: string | null;
  client_nom: string | null;
  client_prenom: string | null;
  client_email: string | null;
  commercial: string | null;
  total_ttc: number;
  nb_articles: number;
  created_at: string;
  updated_at: string | null;
  transformed_at: string | null;
  transformed_into_offre_slug: string | null;
  archived: boolean;
};

// Colonnes de la vue offres_dashboard (identique à la v1).
type OffreRecord = {
  id: number; slug: string; type_document: TypeDocument;
  numero_offre: string | null; numero_commande: string | null; offre_origine: string | null;
  numero_affiche: string; statut: OffreStatut; date_document: string | null;
  reference: string | null;
  commercial: string | null;
  client_societe: string | null; client_nom: string | null;
  client_prenom: string | null; client_email: string | null; client_ville: string | null;
  total_ttc: number; nb_articles: number;
  date_derniere_relance: string | null; nb_relances: number | null;
  probabilite: string | null;
  statut_livraison: "ouverte" | "livree" | null; date_livraison: string | null;
  created_at: string; updated_at: string | null;
};

type SortKey = "date" | "client" | "montant" | "statut" | "commercial" | "jours" | "numero" | "probabilite";
type SortDir = "asc" | "desc";
type QuickFilter =
  | "all" | "offres" | "commandes" | "a_livrer" | "abandonnes" | "relance"
  | "prob_forte" | "prob_moyenne" | "prob_faible" | "prob_neutre";
type Onglet = "documents" | "brouillons";

const COMMERCIAUX = ["Brice Chappé", "Alejandro Gallegos", "Fabian Coquoz", "Michel Gédéon", "Sabrina Striberni", "Team Jardin-Confort", "Thierry Stricker"];
const FERMEES = ["Acceptée", "Convertie", "Abandonnée", "Refusée"];
const PROB_ORDER: Record<string, number> = { forte: 0, moyenne: 1, neutre: 2, faible: 3 };
const PROBAS: { value: QuickFilter; label: string; couleur: string; cle: string | null }[] = [
  { value: "prob_forte", label: "Forte", couleur: "#22c55e", cle: "forte" },
  { value: "prob_moyenne", label: "Moyenne", couleur: "#eab308", cle: "moyenne" },
  { value: "prob_faible", label: "Faible", couleur: "#ef4444", cle: "faible" },
  { value: "prob_neutre", label: "Non définie", couleur: "#a1a1aa", cle: null },
];

// ─── Helpers (repris de la v1) ───
function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("fr-CH", { day: "2-digit", month: "2-digit", year: "numeric" });
}
function fmtMoney(v: number | null | undefined) {
  if (!v) return "—";
  return "CHF " + new Intl.NumberFormat("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
}
function fmtMoneyCourt(v: number) {
  return "CHF " + new Intl.NumberFormat("de-CH", { maximumFractionDigits: 0 }).format(v);
}
function nomClient(o: { client_prenom: string | null; client_nom: string | null }) {
  return [o.client_prenom, o.client_nom].filter(Boolean).join(" ") || "—";
}
function normalize(s: string | null | undefined): string {
  return (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}
function tokenize(needleNorm: string): string[] {
  return needleNorm.split(/\s+/).filter(Boolean);
}
function matchesAllWords(fields: (string | null | undefined)[], words: string[]): boolean {
  if (words.length === 0) return false;
  const blob = fields.map(normalize).join(" ");
  return words.every((w) => blob.includes(w));
}
function relevanceScore(nameField: string, allFields: (string | null | undefined)[], needleNorm: string, words: string[]): number {
  const name = normalize(nameField);
  if (needleNorm && name === needleNorm) return 0;
  if (needleNorm && name.startsWith(needleNorm)) return 1;
  if (needleNorm && name.includes(needleNorm)) return 2;
  const hitsInName = words.filter((w) => name.includes(w)).length;
  if (hitsInName === words.length) return 3;
  if (hitsInName > 0) return 4;
  return matchesAllWords(allFields, words) ? 5 : 9;
}
function offreNumeroFromSlug(slug: string | null): string | null {
  if (!slug) return null;
  const parts = slug.split("-");
  if (parts.length < 2) return null;
  return parts.slice(0, -1).join("-").toUpperCase();
}
function getDaysOpen(o: OffreRecord): number | null {
  if (!o.date_document) return null;
  if (["Acceptée", "Convertie", "Abandonnée"].includes(o.statut)) return null;
  return Math.floor((Date.now() - new Date(o.date_document).getTime()) / 86400000);
}
function getDaysSinceRelance(o: OffreRecord): number | null {
  if (!o.date_derniere_relance) return null;
  if (["Acceptée", "Convertie", "Abandonnée"].includes(o.statut)) return null;
  return Math.floor((Date.now() - new Date(o.date_derniere_relance).getTime()) / 86400000);
}
function classeStatut(statut: string, type: string) {
  if (type === "Commande" || statut === "Acceptée" || statut === "Convertie") return "b-ok";
  if (statut === "Abandonnée" || statut === "Refusée") return "b-bad";
  if (statut === "Envoyée") return "b-info";
  return "b-warn";
}
function classeJours(days: number | null) {
  if (days === null) return "b-neu";
  if (days >= 14) return "b-bad";
  if (days >= 7) return "b-warn";
  return "b-neu";
}
function computeStats(offres: OffreRecord[]) {
  const actives = offres.filter((o) => o.type_document === "Offre" && !["Abandonnée", "Convertie", "Refusée"].includes(o.statut));
  const commandes = offres.filter((o) => o.type_document === "Commande" || o.statut === "Acceptée");
  const abandonnes = offres.filter((o) => ["Abandonnée", "Refusée"].includes(o.statut));
  const aRelancer = actives.filter((o) => {
    const d = getDaysOpen(o);
    return d !== null && d >= 7;
  });
  const aLivrer = offres.filter((o) => o.type_document === "Commande" && o.statut_livraison !== "livree");
  return {
    totalOffres: actives.length, totalCommandes: commandes.length,
    totalAbandonnes: abandonnes.length, aRelancer: aRelancer.length, aLivrer: aLivrer.length,
    caOffres: actives.reduce((s, o) => s + (o.total_ttc || 0), 0),
    caCommandes: commandes.reduce((s, o) => s + (o.total_ttc || 0), 0),
  };
}
function todayLabel() {
  const now = new Date();
  const t = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const day = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - day + 3);
  const jan4 = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const dayJ = (jan4.getUTCDay() + 6) % 7;
  jan4.setUTCDate(jan4.getUTCDate() - dayJ + 3);
  const semaine = 1 + Math.round((t.getTime() - jan4.getTime()) / 604800000);
  const date = new Intl.DateTimeFormat("fr-CH", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(now);
  return `${date.charAt(0).toUpperCase()}${date.slice(1)} · semaine ${semaine}`;
}

// ─── Petits composants ───
function Th({ label, k, cur, dir, onSort, className }: { label: string; k: SortKey; cur: SortKey; dir: SortDir; onSort: (k: SortKey) => void; className?: string }) {
  const on = k === cur;
  return (
    <th className={className}>
      <button type="button" className={on ? "on" : ""} onClick={() => onSort(k)}>
        {label} <span className="fl">{on ? (dir === "asc" ? "↑" : "↓") : "↕"}</span>
      </button>
    </th>
  );
}

function MenuLigne({ id, ouvert, setOuvert, children }: { id: string; ouvert: string | null; setOuvert: (v: string | null) => void; children: React.ReactNode }) {
  return (
    <div className="v2-pop-wrap" onClick={(e) => e.stopPropagation()} onAuxClick={(e) => e.stopPropagation()}>
      <button type="button" className="v2-menu-ligne" aria-label="Actions" onClick={() => setOuvert(ouvert === id ? null : id)}>
        ⋯
      </button>
      {ouvert === id && (
        <div className="v2-pop" style={{ minWidth: 230 }} onClick={() => setOuvert(null)}>
          {children}
        </div>
      )}
    </div>
  );
}

export default function DashboardV2Page() {
  const router = useRouter();
  const [offres, setOffres] = useState<OffreRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");
  const [commercial, setCommercial] = useState("all");
  const [hideAbandoned, setHideAbandoned] = useState(true);
  const [hideConverted, setHideConverted] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [onglet, setOnglet] = useState<Onglet>("documents");
  const [popFiltres, setPopFiltres] = useState(false);
  const [menuOuvert, setMenuOuvert] = useState<string | null>(null);

  const [drafts, setDrafts] = useState<DraftRecord[]>([]);
  const [hideTransformedDrafts, setHideTransformedDrafts] = useState(true);

  const [articleHits, setArticleHits] = useState<Record<number, string>>({});
  const [articleSearching, setArticleSearching] = useState(false);
  const [searchArticles, setSearchArticles] = useState(true);

  const refFiltres = useRef<HTMLDivElement>(null);

  // Clé distincte de la v1 : les deux versions ne se marchent pas dessus.
  useFiltresMemorises("v2:dashboard:filtres", {
    search, quickFilter, commercial, hideAbandoned, hideConverted,
    sortKey, sortDir, searchArticles, hideTransformedDrafts, onglet,
  }, (v) => {
    if (typeof v.search === "string") setSearch(v.search);
    if (typeof v.quickFilter === "string") setQuickFilter(v.quickFilter as QuickFilter);
    if (typeof v.commercial === "string") setCommercial(v.commercial);
    if (typeof v.hideAbandoned === "boolean") setHideAbandoned(v.hideAbandoned);
    if (typeof v.hideConverted === "boolean") setHideConverted(v.hideConverted);
    if (typeof v.sortKey === "string") setSortKey(v.sortKey as SortKey);
    if (typeof v.sortDir === "string") setSortDir(v.sortDir as SortDir);
    if (typeof v.searchArticles === "boolean") setSearchArticles(v.searchArticles);
    if (typeof v.hideTransformedDrafts === "boolean") setHideTransformedDrafts(v.hideTransformedDrafts);
    if (v.onglet === "documents" || v.onglet === "brouillons") setOnglet(v.onglet);
  });

  function loadOffres() {
    setLoading(true);
    fetch("/api/dashboard/offres")
      .then((r) => r.json())
      .then((d) => setOffres(Array.isArray(d) ? d : []))
      .catch(() => setOffres([]))
      .finally(() => setLoading(false));
  }
  function loadDrafts() {
    fetch("/api/drafts?archived=all")
      .then((r) => r.json())
      .then((d) => setDrafts(Array.isArray(d?.drafts) ? d.drafts : []))
      .catch(() => setDrafts([]));
  }
  useEffect(() => {
    loadOffres();
    loadDrafts();
  }, []);

  // ?recherche=… (liens « Voir les dossiers » des Statistiques)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("recherche");
    if (q) setSearch(q);
  }, []);

  // Recherche par article — débounce 300 ms, annulable (identique v1)
  useEffect(() => {
    const q = search.trim();
    if (!searchArticles || q.length < 2) {
      setArticleHits({});
      setArticleSearching(false);
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      setArticleSearching(true);
      fetch(`/api/dashboard/articles?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => setArticleHits(j?.hits || {}))
        .catch(() => {})
        .finally(() => setArticleSearching(false));
    }, 300);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [search, searchArticles]);

  // Préférences partagées avec la v1 (mêmes clés localStorage)
  useEffect(() => {
    try {
      const a = localStorage.getItem("dashboard-search-articles");
      if (a !== null) setSearchArticles(a === "true");
      const ab = localStorage.getItem("dashboard-hide-abandoned");
      if (ab !== null) setHideAbandoned(ab === "true");
      const cv = localStorage.getItem("dashboard-hide-converted");
      if (cv !== null) setHideConverted(cv === "true");
      const td = localStorage.getItem("dashboard-hide-transformed-drafts");
      if (td !== null) setHideTransformedDrafts(td === "true");
    } catch {}
  }, []);
  useEffect(() => { try { localStorage.setItem("dashboard-search-articles", String(searchArticles)); } catch {} }, [searchArticles]);
  useEffect(() => { try { localStorage.setItem("dashboard-hide-abandoned", String(hideAbandoned)); } catch {} }, [hideAbandoned]);
  useEffect(() => { try { localStorage.setItem("dashboard-hide-converted", String(hideConverted)); } catch {} }, [hideConverted]);
  useEffect(() => { try { localStorage.setItem("dashboard-hide-transformed-drafts", String(hideTransformedDrafts)); } catch {} }, [hideTransformedDrafts]);

  // Fermeture des menus au clic extérieur / Échap
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (popFiltres && refFiltres.current && !refFiltres.current.contains(e.target as Node)) setPopFiltres(false);
      if (menuOuvert && !(e.target as Element).closest?.(".v2-pop-wrap")) setMenuOuvert(null);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPopFiltres(false);
        setMenuOuvert(null);
      }
    };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", esc);
    };
  }, [popFiltres, menuOuvert]);

  // ─── Brouillons ───
  const filteredDrafts = useMemo(() => {
    let list = drafts;
    if (commercial !== "all") list = list.filter((d) => d.commercial === commercial);
    if (hideTransformedDrafts) list = list.filter((d) => !d.archived);
    const qNorm = normalize(search.trim());
    const qWords = tokenize(qNorm);
    if (qNorm) {
      const nomD = (d: DraftRecord) => [d.client_prenom, d.client_nom].filter(Boolean).join(" ");
      const fieldsOf = (d: DraftRecord) => [nomD(d), d.numero_affiche, d.client_email, d.client_societe, d.commercial, d.reference];
      list = list.filter((d) => matchesAllWords(fieldsOf(d), qWords));
      list = [...list].sort((a, b) => {
        const sa = relevanceScore(nomD(a), fieldsOf(a), qNorm, qWords);
        const sb = relevanceScore(nomD(b), fieldsOf(b), qNorm, qWords);
        if (sa !== sb) return sa - sb;
        return (b.updated_at || "").localeCompare(a.updated_at || "");
      });
    }
    return list;
  }, [drafts, commercial, hideTransformedDrafts, search]);

  const draftsScope = useMemo(() => (commercial === "all" ? drafts : drafts.filter((d) => d.commercial === commercial)), [drafts, commercial]);
  const draftsActifs = draftsScope.filter((d) => !d.archived).length;
  const draftsTotal = draftsScope.length;

  function handleSort(k: SortKey) {
    if (k === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(k);
    setSortDir("desc");
  }

  // ─── Documents : filtrage + tri (identique v1) ───
  const filtered = useMemo(() => {
    let list = offres;
    if (hideAbandoned && quickFilter !== "abandonnes") list = list.filter((o) => !["Abandonnée", "Refusée"].includes(o.statut));
    if (hideConverted && quickFilter !== "commandes") list = list.filter((o) => !(o.type_document === "Offre" && ["Acceptée", "Convertie"].includes(o.statut)));
    if (quickFilter === "offres") list = list.filter((o) => o.type_document === "Offre" && !["Abandonnée", "Convertie", "Refusée"].includes(o.statut));
    else if (quickFilter === "commandes") list = list.filter((o) => o.type_document === "Commande" || o.statut === "Acceptée");
    else if (quickFilter === "a_livrer") list = list.filter((o) => o.type_document === "Commande" && o.statut_livraison !== "livree");
    else if (quickFilter === "abandonnes") list = list.filter((o) => ["Abandonnée", "Refusée"].includes(o.statut));
    else if (quickFilter === "relance") list = list.filter((o) => { const d = getDaysOpen(o); return d !== null && d >= 7; });
    else if (quickFilter === "prob_forte") list = list.filter((o) => o.type_document === "Offre" && !FERMEES.includes(o.statut) && o.probabilite === "forte");
    else if (quickFilter === "prob_moyenne") list = list.filter((o) => o.type_document === "Offre" && !FERMEES.includes(o.statut) && o.probabilite === "moyenne");
    else if (quickFilter === "prob_faible") list = list.filter((o) => o.type_document === "Offre" && !FERMEES.includes(o.statut) && o.probabilite === "faible");
    else if (quickFilter === "prob_neutre") list = list.filter((o) => o.type_document === "Offre" && !FERMEES.includes(o.statut) && (!o.probabilite || o.probabilite === "neutre"));
    if (commercial !== "all") list = list.filter((o) => o.commercial === commercial);
    const qNorm = normalize(search.trim());
    const qWords = tokenize(qNorm);
    const fieldsOf = (o: OffreRecord) => [nomClient(o), o.numero_affiche, o.client_email, o.client_ville, o.client_societe, o.commercial, o.reference];
    if (qNorm) list = list.filter((o) => matchesAllWords(fieldsOf(o), qWords) || !!articleHits[o.id]);
    function bestScore(o: OffreRecord): number {
      const s = relevanceScore(nomClient(o), fieldsOf(o), qNorm, qWords);
      if (s === 9 && articleHits[o.id]) return 6;
      return s;
    }
    return [...list].sort((a, b) => {
      if (qNorm) {
        const sa = bestScore(a), sb = bestScore(b);
        if (sa !== sb) return sa - sb;
      }
      let av: string | number = "", bv: string | number = "";
      if (sortKey === "numero") { av = a.id; bv = b.id; }
      else if (sortKey === "date") { av = a.date_document || ""; bv = b.date_document || ""; }
      else if (sortKey === "client") { av = nomClient(a); bv = nomClient(b); }
      else if (sortKey === "montant") { av = a.total_ttc || 0; bv = b.total_ttc || 0; }
      else if (sortKey === "statut") { av = a.statut; bv = b.statut; }
      else if (sortKey === "commercial") { av = a.commercial || ""; bv = b.commercial || ""; }
      else if (sortKey === "jours") { av = getDaysOpen(a) ?? -1; bv = getDaysOpen(b) ?? -1; }
      else if (sortKey === "probabilite") { av = PROB_ORDER[a.probabilite || "neutre"] ?? 2; bv = PROB_ORDER[b.probabilite || "neutre"] ?? 2; }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [offres, quickFilter, commercial, search, sortKey, sortDir, hideAbandoned, hideConverted, articleHits]);

  const nbParArticle = useMemo(() => {
    const qWords = tokenize(normalize(search.trim()));
    if (qWords.length === 0) return 0;
    return filtered.filter((o) => articleHits[o.id] && !matchesAllWords([nomClient(o), o.numero_affiche, o.client_email, o.client_ville, o.client_societe, o.commercial, o.reference], qWords)).length;
  }, [filtered, articleHits, search]);

  const scope = useMemo(() => (commercial === "all" ? offres : offres.filter((o) => o.commercial === commercial)), [offres, commercial]);
  const stats = useMemo(() => computeStats(scope), [scope]);
  const compteProba = (cle: string | null) =>
    scope.filter((o) => o.type_document === "Offre" && !FERMEES.includes(o.statut) && (cle ? o.probabilite === cle : !o.probabilite || o.probabilite === "neutre")).length;

  const segments: { value: QuickFilter; label: string; n?: number }[] = [
    { value: "all", label: "Toutes" },
    { value: "offres", label: "Offres actives", n: stats.totalOffres },
    { value: "commandes", label: "Commandes", n: stats.totalCommandes },
    { value: "a_livrer", label: "À livrer", n: stats.aLivrer },
    { value: "relance", label: "À relancer", n: stats.aRelancer },
    { value: "abandonnes", label: "Abandonnées", n: stats.totalAbandonnes },
  ];
  const probaActive = PROBAS.find((p) => p.value === quickFilter) || null;
  const nbFiltresAvances = (commercial !== "all" ? 1 : 0) + (probaActive ? 1 : 0);

  const basculer = (q: QuickFilter) => {
    setOnglet("documents");
    setQuickFilter(quickFilter === q ? "all" : q);
  };
  const reset = () => {
    setSearch("");
    setQuickFilter("all");
    setCommercial("all");
    setHideAbandoned(true);
    setHideConverted(true);
  };

  // Ligne cliquable : Ctrl/Cmd/Maj+clic ou clic milieu → nouvel onglet
  const ouvrir = (url: string, e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      e.preventDefault();
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    router.push(url);
  };
  const ouvrirMilieu = (url: string, e: React.MouseEvent) => {
    if (e.button !== 1) return;
    e.preventDefault();
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="v2-page">
      {/* ─── En-tête : titre + chiffres du jour / du mois ─── */}
      <div className="v2-page-h">
        <div>
          <h1>Offres & commandes</h1>
          <p>{todayLabel()}</p>
        </div>
        <div className="v2-stats">
          <Legacy>
            <StatsCards />
          </Legacy>
        </div>
      </div>

      {/* ─── Indicateurs cliquables ─── */}
      <div className="v2-kpis">
        <button type="button" className={`v2-kpi${quickFilter === "offres" && onglet === "documents" ? " on" : ""}`} onClick={() => basculer("offres")}>
          <div className="t">Offres actives</div>
          <div className="v">{stats.totalOffres}</div>
          <div className="s">{fmtMoneyCourt(stats.caOffres)} potentiel</div>
        </button>
        <button type="button" className={`v2-kpi${quickFilter === "commandes" && onglet === "documents" ? " on" : ""}`} onClick={() => basculer("commandes")}>
          <div className="t">Commandes</div>
          <div className="v">{stats.totalCommandes}</div>
          <div className="s">{fmtMoneyCourt(stats.caCommandes)} confirmé</div>
        </button>
        <button type="button" className={`v2-kpi${quickFilter === "relance" && onglet === "documents" ? " on" : ""}`} onClick={() => basculer("relance")}>
          <div className="t">À relancer</div>
          <div className="v">{stats.aRelancer}</div>
          <div className={`s ${stats.aRelancer > 0 ? "warn" : "ok"}`}>{stats.aRelancer > 0 ? "⚠ Offres ouvertes ≥ 7 jours" : "✓ À jour"}</div>
        </button>
        <button type="button" className={`v2-kpi${quickFilter === "a_livrer" && onglet === "documents" ? " on" : ""}`} onClick={() => basculer("a_livrer")}>
          <div className="t">À livrer</div>
          <div className="v">{stats.aLivrer}</div>
          <div className="s">commandes pas encore livrées</div>
        </button>
        <button type="button" className={`v2-kpi${onglet === "brouillons" ? " on" : ""}`} onClick={() => setOnglet(onglet === "brouillons" ? "documents" : "brouillons")}>
          <div className="t">Brouillons</div>
          <div className="v">{draftsActifs}</div>
          <div className={`s ${draftsActifs > 0 ? "" : "ok"}`}>{draftsActifs > 0 ? `À finaliser · ${draftsTotal} au total` : "✓ Rien en attente"}</div>
        </button>
      </div>

      <div className="v2-carte">
        {/* ─── Onglets ─── */}
        <div className="v2-onglets">
          <button type="button" className={onglet === "documents" ? "on" : ""} onClick={() => setOnglet("documents")}>
            Offres & commandes <span className="v2-n">{filtered.length}</span>
          </button>
          <button type="button" className={onglet === "brouillons" ? "on" : ""} onClick={() => setOnglet("brouillons")}>
            Brouillons <span className="v2-n">{filteredDrafts.length}</span>
          </button>
        </div>

        {/* ─── Barre : catégories, recherche, filtres ─── */}
        <div className="v2-barre">
          {onglet === "documents" && (
            <div className="v2-seg">
              {segments.map((s) => (
                <button key={s.value} type="button" className={quickFilter === s.value ? "on" : ""} onClick={() => setQuickFilter(s.value)}>
                  {s.label}
                  {s.n !== undefined && <span className="n">{s.n}</span>}
                </button>
              ))}
            </div>
          )}
          <label className="v2-champ">
            <span>🔍</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={onglet === "documents" ? "Client, référence, e-mail, ville, article (n° ou libellé)…" : "Client, n° de brouillon, e-mail, référence…"}
            />
            {articleSearching && <span className="info">📦 recherche…</span>}
            {search && (
              <button type="button" className="effacer" onClick={() => setSearch("")} aria-label="Effacer">
                ✕
              </button>
            )}
          </label>
          <div className="v2-pop-wrap" ref={refFiltres}>
            <button type="button" className="v2-btn" onClick={() => setPopFiltres((p) => !p)}>
              ⚙︎ Filtres
              {nbFiltresAvances > 0 && <span className="v2-badge b-info" style={{ padding: "0 7px" }}>{nbFiltresAvances}</span>}
            </button>
            {popFiltres && (
              <div className="v2-pop" style={{ width: 320 }}>
                <h6>Conseiller</h6>
                <div style={{ padding: "0 8px 6px" }}>
                  <select value={commercial} onChange={(e) => setCommercial(e.target.value)}>
                    <option value="all">Tous les conseillers</option>
                    {COMMERCIAUX.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                {onglet === "documents" && (
                  <>
                    <h6>Probabilité de closing (offres en cours)</h6>
                    <div className="v2-chips">
                      {PROBAS.map((p) => (
                        <button key={p.value} type="button" className={`v2-chip${quickFilter === p.value ? " on" : ""}`} onClick={() => basculer(p.value)}>
                          <span className="v2-prob" style={{ background: p.couleur }} />
                          {p.label} <span className="n">{compteProba(p.cle)}</span>
                        </button>
                      ))}
                    </div>
                    <hr />
                    <label className="v2-pop-item">
                      <input type="checkbox" checked={hideAbandoned} onChange={(e) => setHideAbandoned(e.target.checked)} />
                      Masquer les abandonnées et refusées
                    </label>
                    <label className="v2-pop-item">
                      <input type="checkbox" checked={hideConverted} onChange={(e) => setHideConverted(e.target.checked)} />
                      Masquer les offres converties
                    </label>
                    <label className="v2-pop-item" title="Cherche aussi le terme saisi dans les articles des offres et commandes (n° d'article ou libellé)">
                      <input type="checkbox" checked={searchArticles} onChange={(e) => setSearchArticles(e.target.checked)} />
                      📦 Chercher aussi dans les articles
                    </label>
                  </>
                )}
                {onglet === "brouillons" && (
                  <label className="v2-pop-item">
                    <input type="checkbox" checked={hideTransformedDrafts} onChange={(e) => setHideTransformedDrafts(e.target.checked)} />
                    Masquer les brouillons transformés
                  </label>
                )}
                <hr />
                <button type="button" className="v2-pop-item" onClick={reset}>
                  ↺ Réinitialiser les filtres
                </button>
              </div>
            )}
          </div>
          {onglet === "brouillons" && (
            <a href="/drafts/nouveau" target="_blank" rel="noopener noreferrer" className="v2-btn">
              ＋ Nouveau brouillon
            </a>
          )}
          <button
            type="button"
            className="v2-btn v2-btn-icone"
            title="Actualiser"
            onClick={() => {
              loadOffres();
              loadDrafts();
            }}
          >
            ↻
          </button>
        </div>

        {/* ─── Filtres actifs ─── */}
        <div className="v2-actifs">
          {onglet === "documents" ? (
            <>
              {commercial !== "all" && (
                <span className="v2-chip on">
                  {commercial}
                  <button type="button" className="v2-chip-x" onClick={() => setCommercial("all")} aria-label="Retirer">✕</button>
                </span>
              )}
              {probaActive && (
                <span className="v2-chip on">
                  Probabilité : {probaActive.label}
                  <button type="button" className="v2-chip-x" onClick={() => setQuickFilter("all")} aria-label="Retirer">✕</button>
                </span>
              )}
              {hideAbandoned && quickFilter !== "abandonnes" && (
                <span className="v2-chip">
                  Abandonnées masquées ({scope.filter((o) => ["Abandonnée", "Refusée"].includes(o.statut)).length})
                  <button type="button" className="v2-chip-x" onClick={() => setHideAbandoned(false)} aria-label="Afficher">✕</button>
                </span>
              )}
              {hideConverted && quickFilter !== "commandes" && (
                <span className="v2-chip">
                  Converties masquées ({scope.filter((o) => o.type_document === "Offre" && ["Acceptée", "Convertie"].includes(o.statut)).length})
                  <button type="button" className="v2-chip-x" onClick={() => setHideConverted(false)} aria-label="Afficher">✕</button>
                </span>
              )}
              <span className="compte">
                {filtered.length} résultat{filtered.length > 1 ? "s" : ""}
                {nbParArticle > 0 && <> · dont {nbParArticle} par article</>}
              </span>
            </>
          ) : (
            <>
              {commercial !== "all" && (
                <span className="v2-chip on">
                  {commercial}
                  <button type="button" className="v2-chip-x" onClick={() => setCommercial("all")} aria-label="Retirer">✕</button>
                </span>
              )}
              {hideTransformedDrafts && (
                <span className="v2-chip">
                  Transformés masqués ({draftsScope.filter((d) => d.archived).length})
                  <button type="button" className="v2-chip-x" onClick={() => setHideTransformedDrafts(false)} aria-label="Afficher">✕</button>
                </span>
              )}
              <span className="compte">
                {filteredDrafts.length} brouillon{filteredDrafts.length > 1 ? "s" : ""} · {draftsActifs} actif{draftsActifs > 1 ? "s" : ""} / {draftsTotal}
              </span>
            </>
          )}
        </div>

        {/* ─── Tableau des documents ─── */}
        {onglet === "documents" && (
          <div className="v2-tbl">
            <table>
              <thead>
                <tr>
                  <Th label="Réf." k="numero" cur={sortKey} dir={sortDir} onSort={handleSort} />
                  <Th label="Client" k="client" cur={sortKey} dir={sortDir} onSort={handleSort} />
                  <th className="v2-col-opt">Ville</th>
                  <Th label="Conseiller" k="commercial" cur={sortKey} dir={sortDir} onSort={handleSort} className="v2-col-opt" />
                  <Th label="Montant" k="montant" cur={sortKey} dir={sortDir} onSort={handleSort} className="v2-num" />
                  <Th label="Statut" k="statut" cur={sortKey} dir={sortDir} onSort={handleSort} />
                  <Th label="Prob." k="probabilite" cur={sortKey} dir={sortDir} onSort={handleSort} className="v2-col-opt" />
                  <Th label="Jours" k="jours" cur={sortKey} dir={sortDir} onSort={handleSort} className="v2-col-opt" />
                  <Th label="Date" k="date" cur={sortKey} dir={sortDir} onSort={handleSort} className="v2-col-opt" />
                  <th />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={10} className="vide">Chargement…</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={10} className="vide">Aucun dossier trouvé.</td></tr>
                ) : (
                  filtered.map((o) => {
                    const days = getDaysOpen(o);
                    const dr = getDaysSinceRelance(o);
                    const isCmd = o.type_document === "Commande";
                    const url = `/v2/${o.slug}`;
                    const fermee = isCmd || FERMEES.includes(o.statut);
                    const proba = PROBAS.find((p) => (p.cle ? o.probabilite === p.cle : !o.probabilite || o.probabilite === "neutre"));
                    return (
                      <tr
                        key={o.id}
                        className={isCmd ? "cmd" : "off"}
                        onClick={(e) => ouvrir(url, e)}
                        onAuxClick={(e) => ouvrirMilieu(url, e)}
                        title="Ctrl/Cmd+clic ou clic milieu : ouvrir dans un nouvel onglet"
                      >
                        <td>
                          <span className="v2-ref">{o.numero_affiche}</span>
                          {o.reference && <span className="v2-sous ref-client" title="Référence client">📌 {o.reference}</span>}
                          <span className="v2-sous">{o.type_document}</span>
                          {o.statut === "Convertie" && o.numero_commande && <span className="v2-sous vers">→ {o.numero_commande}</span>}
                          {o.offre_origine && <span className="v2-sous depuis">← {o.offre_origine}</span>}
                          {articleHits[o.id] && (
                            <span className="v2-sous article" title={articleHits[o.id].replace(/ \| /g, "\n")}>
                              📦 {articleHits[o.id].replace(/\s*\n\s*/g, " ")}
                            </span>
                          )}
                        </td>
                        <td>
                          <div style={{ fontWeight: 500 }}>{nomClient(o)}</div>
                          {o.client_societe && <span className="v2-sous">{o.client_societe}</span>}
                          {o.client_email && <span className="v2-sous">{o.client_email}</span>}
                        </td>
                        <td className="v2-col-opt v2-pale">{o.client_ville || "—"}</td>
                        <td className="v2-col-opt v2-pale">{o.commercial || "—"}</td>
                        <td className="v2-num" style={{ fontWeight: 600 }}>{fmtMoney(o.total_ttc)}</td>
                        <td>
                          <div className="v2-badges">
                            <span className={`v2-badge ${classeStatut(o.statut, o.type_document)}`}>{o.statut}</span>
                            {isCmd &&
                              (o.statut_livraison === "livree" ? (
                                <span className="v2-badge b-ok" title={o.date_livraison ? `Livrée le ${fmtDate(o.date_livraison)}` : "Livrée"}>🚚 Livrée</span>
                              ) : (
                                <span className="v2-badge b-warn" title="Pas encore livrée — « Marquer livrée » sur la fiche">⏳ À livrer</span>
                              ))}
                          </div>
                        </td>
                        <td className="v2-col-opt">
                          {fermee ? (
                            <span className="v2-pale">—</span>
                          ) : (
                            <span className="v2-prob" style={{ background: proba?.couleur || "#a1a1aa" }} title={proba?.label || "Non définie"} />
                          )}
                        </td>
                        <td className="v2-col-opt">
                          <div className="v2-badges">
                            {days !== null ? <span className={`v2-badge ${classeJours(days)}`} title="Jours depuis création">{days} j</span> : <span className="v2-pale">—</span>}
                            {dr !== null && (
                              <span className={`v2-badge ${dr >= 14 ? "b-bad" : dr >= 7 ? "b-warn" : "b-info"}`} title={`Jours depuis relance #${o.nb_relances || 0}`}>
                                📧 R{o.nb_relances || 0} · {dr} j
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="v2-col-opt v2-pale" style={{ whiteSpace: "nowrap" }}>{fmtDate(o.date_document)}</td>
                        <td className="v2-num">
                          <MenuLigne id={`o${o.id}`} ouvert={menuOuvert} setOuvert={setMenuOuvert}>
                            <a className="v2-pop-item" href={url} onClick={(e) => { e.preventDefault(); router.push(url); }}>👁 Ouvrir la fiche</a>
                            <a className="v2-pop-item" href={url} target="_blank" rel="noopener noreferrer">↗ Fiche dans un nouvel onglet</a>
                            <a className="v2-pop-item" href={`/offre/${o.slug}`} target="_blank" rel="noopener noreferrer">🌐 Page client</a>
                            {o.client_email && (
                              <a className="v2-pop-item" href={`mailto:${o.client_email}?subject=${encodeURIComponent(`Suivi offre ${o.numero_affiche}`)}`}>
                                ✉ E-mail au client
                              </a>
                            )}
                          </MenuLigne>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* ─── Tableau des brouillons ─── */}
        {onglet === "brouillons" && (
          <div className="v2-tbl">
            <table>
              <thead>
                <tr>
                  <th>Réf.</th>
                  <th>Client</th>
                  <th className="v2-col-opt">Conseiller</th>
                  <th className="v2-num">Montant</th>
                  <th>Statut</th>
                  <th className="v2-col-opt">Modifié le</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filteredDrafts.length === 0 ? (
                  <tr><td colSpan={7} className="vide">{drafts.length === 0 ? "Aucun brouillon créé." : "Aucun brouillon ne correspond aux filtres."}</td></tr>
                ) : (
                  filteredDrafts.map((d) => {
                    const arch = d.archived;
                    const url = `/v2/draft/${d.slug}`;
                    return (
                      <tr key={d.id} className={arch ? "drf-arch" : "drf"} onClick={(e) => ouvrir(url, e)} onAuxClick={(e) => ouvrirMilieu(url, e)}>
                        <td>
                          <span className="v2-ref">{d.numero_affiche}</span>
                          {d.reference && <span className="v2-sous ref-client">📌 {d.reference}</span>}
                          {arch && d.transformed_into_offre_slug && <span className="v2-sous vers">→ {offreNumeroFromSlug(d.transformed_into_offre_slug) || "Transformé"}</span>}
                        </td>
                        <td>
                          <div style={{ fontWeight: 500 }}>{nomClient(d)}</div>
                          {d.client_societe && <span className="v2-sous">{d.client_societe}</span>}
                          {d.client_email && <span className="v2-sous">{d.client_email}</span>}
                        </td>
                        <td className="v2-col-opt v2-pale">{d.commercial || "—"}</td>
                        <td className="v2-num" style={{ fontWeight: 600 }}>{fmtMoney(d.total_ttc)}</td>
                        <td>{arch ? <span className="v2-badge b-neu">🔒 Transformé</span> : <span className="v2-badge b-warn">📝 Brouillon</span>}</td>
                        <td className="v2-col-opt v2-pale">{fmtDate(d.updated_at)}</td>
                        <td className="v2-num">
                          <MenuLigne id={`d${d.id}`} ouvert={menuOuvert} setOuvert={setMenuOuvert}>
                            <a className="v2-pop-item" href={url} onClick={(e) => { e.preventDefault(); router.push(url); }}>👁 Voir le brouillon</a>
                            {!arch && <a className="v2-pop-item" href={`/drafts/${d.slug}/editer`}>✏️ Modifier</a>}
                            {arch && d.transformed_into_offre_slug && (
                              <a className="v2-pop-item" href={`/v2/${d.transformed_into_offre_slug}`} onClick={(e) => { e.preventDefault(); router.push(`/v2/${d.transformed_into_offre_slug}`); }}>
                                → Ouvrir l&apos;offre
                              </a>
                            )}
                          </MenuLigne>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        <div className="v2-pied-tbl">
          <span>Clic = ouvrir · Ctrl+clic ou clic molette = nouvel onglet · ⋯ = actions</span>
          <span>Ctrl K = recherche rapide partout</span>
        </div>
      </div>
    </div>
  );
}
