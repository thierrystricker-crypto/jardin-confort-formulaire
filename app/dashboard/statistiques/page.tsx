"use client";
// ═══════════════════════════════════════════════════════════════════════
//  app/dashboard/statistiques/page.tsx
//
//  Statistiques Jardin-Confort : CA, conseillers, articles, marques,
//  avec comparaison à la période précédente et à l'an dernier.
//
//  Deux sources qui ne se recoupent pas (aucun numéro commun) :
//    • Commandes formulaire — depuis mai 2026, avec le conseiller
//    • Ventes Shopify       — depuis 2021, web + caisse, sans conseiller
//  Le sélecteur du haut cadre toute la page ; les blocs qui n'ont pas de
//  sens pour la source choisie le disent au lieu de disparaître.
//
//  Graphiques en SVG/CSS, sans librairie. Palette validée pour le fond
//  sombre du dashboard (contraste ≥ 3:1, écarts sûrs en vision des
//  couleurs déficiente).
// ═══════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

// ─── Palette (validée sur la surface #2a2d31) ───
const C_SERIE      = "#3987e5"; // période courante
const C_COMPARE    = "#898781"; // comparatif — gris, jamais une 2ᵉ couleur vive
const C_GRID       = "#3a3e44";
const C_AXE        = "#4a4f56";
const C_TXT_MUTED  = "#898781";
const C_POSITIF    = "#0ca30c";
const C_NEGATIF    = "#e66767";

type Source = "app" | "shopify" | "total";
type Periode = "jour" | "semaine" | "mois" | "trimestre" | "semestre" | "annee" | "exercice";
type Compare = "precedent" | "an_dernier";

type Totaux = { ca: number; nb_commandes: number; nb_articles: number; panier_moyen: number };
type Borne = { scope: string; dfrom: string; dto: string; libelle: string; partielle: boolean };
type PointSerie = {
  i: number; date: string; ca: number; nb: number;
  ca_precedent: number | null; date_precedent: string | null;
  ca_an_dernier: number | null; date_an_dernier: string | null;
};
type LigneCommercial = {
  commercial: string; ca: number; nb_commandes: number;
  nb_articles: number; panier_moyen: number; ca_precedent: number;
};
type LigneArticle = {
  sku: string; titre: string;
  marque: string | null;          // catalogue : fiable, comptée dans la répartition
  marque_presumee: string | null; // déduite du libellé : indicative seulement
  qty: number; valeur: number; nb_commandes: number;
};
type LigneMarque = { marque: string; qty: number; valeur: number; nb_commandes: number; valeur_precedent: number };

type Donnees = {
  source: Source; periode: Periode; granularite: "day" | "week" | "month"; prorata: boolean;
  bornes: Record<"courant" | "precedent" | "an_dernier", Borne>;
  totaux: Record<"courant" | "precedent" | "an_dernier", Totaux>;
  serie: PointSerie[];
  commerciaux: LigneCommercial[];
  articles: LigneArticle[];
  marques: LigneMarque[];
  meta: {
    shopify_derniere_commande: string | null;
    app_premiere_commande: string | null;
    commerciaux_disponibles: boolean;
  };
};

// ─── Formats suisses ───
const nfCHF = new Intl.NumberFormat("de-CH", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const nfCHF2 = new Intl.NumberFormat("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nfNb = new Intl.NumberFormat("de-CH");

function chf(v: number, decimales = false) {
  return "CHF " + (decimales ? nfCHF2 : nfCHF).format(Math.round(decimales ? v * 100 : v) / (decimales ? 100 : 1));
}
function dateCH(iso: string) {
  if (!iso) return "—";
  const [a, m, j] = iso.slice(0, 10).split("-");
  return `${j}.${m}.${a}`;
}
function dateCourte(iso: string, pas: "day" | "week" | "month") {
  if (!iso) return "";
  const [a, m, j] = iso.slice(0, 10).split("-");
  if (pas === "month") return `${m}.${a.slice(2)}`;
  return `${j}.${m}`;
}
function pct(courant: number, ref: number): number | null {
  if (!ref) return courant > 0 ? null : 0; // pas de base de comparaison
  return ((courant - ref) / ref) * 100;
}

// ─── Petits composants ───

function Delta({ courant, ref: reference, titre }: { courant: number; ref: number; titre?: string }) {
  const p = pct(courant, reference);
  if (p === null) {
    return <span className="text-xs text-zinc-500" title={titre}>nouveau</span>;
  }
  const positif = p >= 0;
  return (
    <span
      className="inline-flex items-center gap-1 text-xs font-semibold tabular-nums"
      style={{ color: positif ? C_POSITIF : C_NEGATIF }}
      title={titre}
    >
      <span aria-hidden>{positif ? "▲" : "▼"}</span>
      {positif ? "+" : ""}{p.toFixed(1)} %
    </span>
  );
}

function Tuile({
  titre, valeur, courant, reference, libelleRef, sous,
}: {
  titre: string; valeur: string; courant: number; reference: number; libelleRef: string; sous?: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#2a2d31] p-5">
      <div className="text-xs font-semibold uppercase tracking-wide text-zinc-400">{titre}</div>
      <div className="mt-3 text-3xl font-semibold tracking-tight text-zinc-100">{valeur}</div>
      <div className="mt-2 flex items-baseline gap-2">
        <Delta courant={courant} ref={reference} titre={`Référence : ${libelleRef}`} />
        <span className="text-xs text-zinc-500">vs {libelleRef}</span>
      </div>
      {sous && <div className="mt-1 text-xs text-zinc-500">{sous}</div>}
    </div>
  );
}

// ─── Courbe CA : période courante + comparatif en trait gris ───
function CourbeCA({
  serie, pas, libelleCourant, libelleCompare, compare,
}: {
  serie: PointSerie[]; pas: "day" | "week" | "month";
  libelleCourant: string; libelleCompare: string; compare: Compare;
}) {
  const [survol, setSurvol] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const W = 1000, H = 320;
  const M = { haut: 20, bas: 34, gauche: 74, droite: 16 };
  const largeur = W - M.gauche - M.droite;
  const hauteur = H - M.haut - M.bas;

  const valCompare = (p: PointSerie) => (compare === "precedent" ? p.ca_precedent : p.ca_an_dernier);
  const dateCompare = (p: PointSerie) => (compare === "precedent" ? p.date_precedent : p.date_an_dernier);

  const max = useMemo(() => {
    const vals = serie.flatMap(p => [p.ca, valCompare(p) ?? 0]);
    return Math.max(1, ...vals);
  }, [serie, compare]);

  // Échelle arrondie vers le haut pour des graduations lisibles
  const echelle = useMemo(() => {
    const brut = max * 1.08;
    const ordre = Math.pow(10, Math.floor(Math.log10(brut)));
    return Math.ceil(brut / (ordre / 2)) * (ordre / 2);
  }, [max]);

  const x = (i: number) => M.gauche + (serie.length <= 1 ? largeur / 2 : (i / (serie.length - 1)) * largeur);
  const y = (v: number) => M.haut + hauteur - (v / echelle) * hauteur;

  const chemin = (get: (p: PointSerie) => number | null) => {
    let d = "", ouvert = false;
    serie.forEach((p, i) => {
      const v = get(p);
      if (v === null) { ouvert = false; return; }
      d += `${ouvert ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
      ouvert = true;
    });
    return d.trim();
  };

  const graduations = [0, 0.25, 0.5, 0.75, 1].map(f => f * echelle);
  const pasEtiquettes = Math.max(1, Math.ceil(serie.length / 12));

  const surSouris = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg || serie.length === 0) return;
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const ratio = (px - M.gauche) / largeur;
    const i = Math.round(ratio * (serie.length - 1));
    setSurvol(Math.min(serie.length - 1, Math.max(0, i)));
  }, [serie.length, largeur]);

  const pointSurvole = survol !== null ? serie[survol] : null;
  const dernier = serie.length > 0 ? serie[serie.length - 1] : null;

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height: "auto" }}
        onMouseMove={surSouris}
        onMouseLeave={() => setSurvol(null)}
        role="img"
        aria-label={`Chiffre d'affaires — ${libelleCourant}, comparé à ${libelleCompare}`}
      >
        {/* Graduations horizontales, hairlines pleines */}
        {graduations.map((g, k) => (
          <g key={k}>
            <line x1={M.gauche} x2={W - M.droite} y1={y(g)} y2={y(g)} stroke={C_GRID} strokeWidth={1} />
            <text x={M.gauche - 10} y={y(g) + 4} textAnchor="end" fontSize={11} fill={C_TXT_MUTED}
              style={{ fontVariantNumeric: "tabular-nums" }}>
              {g >= 1000 ? `${Math.round(g / 1000)}k` : Math.round(g)}
            </text>
          </g>
        ))}
        <line x1={M.gauche} x2={W - M.droite} y1={y(0)} y2={y(0)} stroke={C_AXE} strokeWidth={1} />

        {/* Étiquettes de l'axe du temps */}
        {serie.map((p, i) =>
          i % pasEtiquettes === 0 ? (
            <text key={i} x={x(i)} y={H - 12} textAnchor="middle" fontSize={11} fill={C_TXT_MUTED}
              style={{ fontVariantNumeric: "tabular-nums" }}>
              {dateCourte(p.date, pas)}
            </text>
          ) : null
        )}

        {/* Comparatif d'abord, en dessous */}
        <path d={chemin(valCompare)} fill="none" stroke={C_COMPARE} strokeWidth={2}
          strokeLinejoin="round" strokeLinecap="round" opacity={0.85} />
        {/* Période courante */}
        <path d={chemin(p => p.ca)} fill="none" stroke={C_SERIE} strokeWidth={2}
          strokeLinejoin="round" strokeLinecap="round" />

        {/* Repère de survol */}
        {pointSurvole && (
          <g>
            <line x1={x(pointSurvole.i)} x2={x(pointSurvole.i)} y1={M.haut} y2={M.haut + hauteur}
              stroke={C_AXE} strokeWidth={1} />
            {valCompare(pointSurvole) !== null && (
              <circle cx={x(pointSurvole.i)} cy={y(valCompare(pointSurvole) as number)} r={4}
                fill={C_COMPARE} stroke="#2a2d31" strokeWidth={2} />
            )}
            <circle cx={x(pointSurvole.i)} cy={y(pointSurvole.ca)} r={4.5}
              fill={C_SERIE} stroke="#2a2d31" strokeWidth={2} />
          </g>
        )}

        {/* Étiquette directe sur le dernier point, uniquement s'il porte une valeur */}
        {dernier && dernier.ca > 0 && survol === null && (
          <text x={x(dernier.i) - 6} y={y(dernier.ca) - 10} textAnchor="end" fontSize={12}
            fill="#e4e4e7" fontWeight={600}>
            {chf(dernier.ca)}
          </text>
        )}
      </svg>

      {/* Infobulle */}
      {pointSurvole && (
        <div
          className="pointer-events-none absolute top-2 rounded-xl border border-white/15 bg-[#1f2125]/95 px-3 py-2 text-xs shadow-lg"
          style={{
            left: `calc(${((x(pointSurvole.i) / W) * 100).toFixed(2)}% + ${x(pointSurvole.i) > W / 2 ? "-150px" : "12px"})`,
            minWidth: 138,
          }}
        >
          <div className="font-semibold text-zinc-100">{dateCH(pointSurvole.date)}</div>
          <div className="mt-1.5 flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: C_SERIE }} />
            <span className="text-zinc-300">{chf(pointSurvole.ca)}</span>
            <span className="text-zinc-500">· {pointSurvole.nb} cmd</span>
          </div>
          {valCompare(pointSurvole) !== null && (
            <div className="mt-1 flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: C_COMPARE }} />
              <span className="text-zinc-400">{chf(valCompare(pointSurvole) as number)}</span>
            </div>
          )}
          {dateCompare(pointSurvole) && (
            <div className="mt-0.5 text-[10px] text-zinc-500">
              comparé au {dateCH(dateCompare(pointSurvole) as string)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Barres horizontales (une seule couleur : catégories sans ordre naturel) ───
function Barres({
  lignes, max, formatValeur,
}: {
  lignes: { cle: string; libelle: string; valeur: number; reference?: number; detail?: string }[];
  max: number;
  formatValeur: (v: number) => string;
}) {
  if (lignes.length === 0) {
    return <div className="py-8 text-center text-sm text-zinc-500">Aucune donnée sur cette période.</div>;
  }
  return (
    <div className="space-y-3">
      {lignes.map(l => (
        <div key={l.cle}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="truncate text-sm text-zinc-200">{l.libelle}</span>
            <span className="flex items-baseline gap-2 whitespace-nowrap">
              <span className="text-sm font-semibold tabular-nums text-zinc-100">{formatValeur(l.valeur)}</span>
              {l.reference !== undefined && <Delta courant={l.valeur} ref={l.reference} />}
            </span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/5">
            <div className="h-full rounded-full"
              style={{ width: `${max > 0 ? Math.max(1.5, (l.valeur / max) * 100) : 0}%`, background: C_SERIE }} />
          </div>
          {l.detail && <div className="mt-1 text-xs text-zinc-500">{l.detail}</div>}
        </div>
      ))}
    </div>
  );
}

function Carte({
  titre, sous, actions, children,
}: { titre: string; sous?: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-[#2a2d31] p-5">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-zinc-100">{titre}</h2>
          {sous && <p className="mt-0.5 text-xs text-zinc-500">{sous}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

function BoutonTableau({ actif, onClick }: { actif: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className={`rounded-lg border px-3 py-1.5 text-xs transition ${
        actif ? "border-white/20 bg-white/10 text-zinc-100" : "border-white/10 bg-[#34383d] text-zinc-400 hover:text-zinc-200"
      }`}>
      {actif ? "Voir le graphique" : "Voir le tableau"}
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  Page
// ═══════════════════════════════════════════════════════════════════════

const LIBELLES_PERIODE: Record<Periode, string> = {
  jour: "Jour", semaine: "Semaine", mois: "Mois", trimestre: "Trimestre",
  semestre: "Semestre", annee: "Année civile", exercice: "Exercice (1.10 → 30.09)",
};

const LIBELLES_SOURCE: Record<Source, string> = {
  app: "Commandes formulaire",
  shopify: "Ventes Shopify",
  total: "Les deux cumulées",
};

export default function StatistiquesPage() {
  const [source, setSource] = useState<Source>("total");
  const [periode, setPeriode] = useState<Periode>("mois");
  const [compare, setCompare] = useState<Compare>("an_dernier");
  const [prorata, setProrata] = useState(true);
  const [decalage, setDecalage] = useState(0); // nb de périodes en arrière

  const [donnees, setDonnees] = useState<Donnees | null>(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);

  const [tabCourbe, setTabCourbe] = useState(false);
  const [tabConseillers, setTabConseillers] = useState(false);
  const [tabMarques, setTabMarques] = useState(false);

  // Rattrapage manuel de l'import Shopify
  const [syncEnCours, setSyncEnCours] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [rechargement, setRechargement] = useState(0);

  // Ancre = aujourd'hui reculé de `decalage` périodes
  const ancre = useMemo(() => {
    const d = new Date();
    if (decalage !== 0) {
      if (periode === "jour") d.setDate(d.getDate() - decalage);
      else if (periode === "semaine") d.setDate(d.getDate() - 7 * decalage);
      else if (periode === "mois") d.setMonth(d.getMonth() - decalage);
      else if (periode === "trimestre") d.setMonth(d.getMonth() - 3 * decalage);
      else if (periode === "semestre") d.setMonth(d.getMonth() - 6 * decalage);
      else d.setFullYear(d.getFullYear() - decalage);
    }
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }, [periode, decalage]);

  useEffect(() => { setDecalage(0); }, [periode]);

  useEffect(() => {
    let annule = false;
    const ctrl = new AbortController();
    setChargement(true);
    setErreur(null);
    const url = `/api/stats/dashboard?source=${source}&periode=${periode}&ancre=${ancre}&prorata=${prorata ? 1 : 0}`;
    fetch(url, { signal: ctrl.signal })
      .then(r => r.json())
      .then(j => {
        if (annule) return;
        if (j?.error) { setErreur(String(j.error)); return; }
        setDonnees(j as Donnees);
      })
      .catch(e => { if (!annule && e?.name !== "AbortError") setErreur(String(e)); })
      .finally(() => { if (!annule) setChargement(false); });
    return () => { annule = true; ctrl.abort(); };
  }, [source, periode, ancre, prorata, rechargement]);

  // Lance un rattrapage de l'import Shopify, puis recharge les chiffres.
  const lancerSync = useCallback(async () => {
    setSyncEnCours(true);
    setSyncMessage("Import en cours — cela peut prendre une à deux minutes…");
    try {
      const r = await fetch("/api/shopify/sync-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ syncType: "manual" }),
      });
      const j = await r.json();
      if (!r.ok || j?.success === false) {
        setSyncMessage(`Échec de l'import : ${j?.error || r.status}`);
        return;
      }
      const reste = j.hasMore
        ? " Il reste des commandes à traiter : relance pour continuer (la reprise est automatique)."
        : "";
      setSyncMessage(
        `${j.ordersInserted ?? 0} commande(s) ajoutée(s), ${j.ordersUpdated ?? 0} mise(s) à jour` +
        ` en ${Math.round((j.durationMs ?? 0) / 1000)} s.${reste}`
      );
      setRechargement(n => n + 1);
    } catch (e) {
      setSyncMessage(`Échec de l'import : ${String(e)}`);
    } finally {
      setSyncEnCours(false);
    }
  }, []);

  const ref = donnees ? donnees.totaux[compare] : null;
  const libelleRef = donnees
    ? (compare === "precedent" ? "période précédente" : "l'an dernier")
    : "";
  const bornesRef = donnees ? donnees.bornes[compare] : null;

  // Fraîcheur Shopify : l'import est manuel et peut avoir pris du retard
  const retardShopify = useMemo(() => {
    const iso = donnees?.meta?.shopify_derniere_commande;
    if (!iso) return null;
    const jours = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    return jours >= 3 ? { jours, date: iso } : null;
  }, [donnees]);

  const maxCommercial = useMemo(
    () => Math.max(1, ...(donnees?.commerciaux || []).map(c => c.ca)),
    [donnees]
  );

  // Top 8 marques + regroupement du reste — on ne multiplie pas les catégories
  const marquesAffichees = useMemo(() => {
    const src = donnees?.marques || [];
    if (src.length <= 9) return src;
    const tete = src.slice(0, 8);
    const reste = src.slice(8);
    return [
      ...tete,
      {
        marque: `Autres (${reste.length})`,
        qty: reste.reduce((s, r) => s + r.qty, 0),
        valeur: reste.reduce((s, r) => s + r.valeur, 0),
        nb_commandes: 0,
        valeur_precedent: reste.reduce((s, r) => s + r.valeur_precedent, 0),
      },
    ];
  }, [donnees]);

  const maxMarque = useMemo(
    () => Math.max(1, ...marquesAffichees.map(m => m.valeur)),
    [marquesAffichees]
  );

  return (
    <main className="min-h-screen bg-[#1f2125] px-6 py-8 text-zinc-100">
      <div className="mx-auto max-w-[1500px] space-y-5">

        {/* En-tête */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link href="/dashboard" className="text-sm text-[#5BB3F0] hover:underline">← Retour au dashboard</Link>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">📊 Statistiques</h1>
            <p className="mt-1 text-sm text-zinc-400">
              {donnees ? `${LIBELLES_SOURCE[donnees.source]} · ${donnees.bornes.courant.libelle}` : "Chargement…"}
            </p>
          </div>
        </div>

        {/* ─── Barre de filtres : cadre toute la page ─── */}
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-[#2a2d31] p-3">
          <div className="flex rounded-xl border border-white/10 bg-[#22252a] p-1">
            {(Object.keys(LIBELLES_SOURCE) as Source[]).map(s => (
              <button key={s} type="button" onClick={() => setSource(s)}
                className={`rounded-lg px-3 py-1.5 text-sm transition ${
                  source === s ? "bg-[#2B8AD1] text-white" : "text-zinc-400 hover:text-zinc-200"
                }`}>
                {LIBELLES_SOURCE[s]}
              </button>
            ))}
          </div>

          <select value={periode} onChange={e => setPeriode(e.target.value as Periode)}
            className="rounded-xl border border-white/10 bg-[#22252a] px-3 py-2 text-sm text-zinc-100 outline-none">
            {(Object.keys(LIBELLES_PERIODE) as Periode[]).map(p => (
              <option key={p} value={p}>{LIBELLES_PERIODE[p]}</option>
            ))}
          </select>

          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setDecalage(d => d + 1)} title="Période précédente"
              className="rounded-lg border border-white/10 bg-[#22252a] px-3 py-2 text-sm text-zinc-300 hover:bg-[#34383d]">←</button>
            <button type="button" onClick={() => setDecalage(0)} disabled={decalage === 0}
              className="rounded-lg border border-white/10 bg-[#22252a] px-3 py-2 text-sm text-zinc-300 hover:bg-[#34383d] disabled:opacity-40">
              Actuelle
            </button>
            <button type="button" onClick={() => setDecalage(d => Math.max(0, d - 1))} disabled={decalage === 0}
              title="Période suivante"
              className="rounded-lg border border-white/10 bg-[#22252a] px-3 py-2 text-sm text-zinc-300 hover:bg-[#34383d] disabled:opacity-40">→</button>
          </div>

          <div className="flex rounded-xl border border-white/10 bg-[#22252a] p-1">
            {([["precedent", "vs période précédente"], ["an_dernier", "vs an dernier"]] as [Compare, string][]).map(([c, lib]) => (
              <button key={c} type="button" onClick={() => setCompare(c)}
                className={`rounded-lg px-3 py-1.5 text-sm transition ${
                  compare === c ? "bg-white/10 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"
                }`}>
                {lib}
              </button>
            ))}
          </div>

          <label className="ml-auto inline-flex cursor-pointer items-center gap-2 text-sm text-zinc-400 hover:text-zinc-200"
            title="Quand la période en cours n'est pas terminée, les comparatifs sont tronqués à la même durée écoulée — sinon on comparerait 14 jours à 31.">
            <input type="checkbox" checked={prorata} onChange={e => setProrata(e.target.checked)}
              className="rounded border-white/20" />
            <span>Comparer à durée égale</span>
          </label>
        </div>

        {/* ─── Avertissements de fraîcheur / périmètre ─── */}
        {retardShopify && source !== "app" && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>
                ⚠ Dernière commande Shopify importée le <strong>{dateCH(retardShopify.date)}</strong> ({retardShopify.jours} jours de retard).
                Les périodes récentes sont donc incomplètes côté Shopify.
              </span>
              <button type="button" onClick={lancerSync} disabled={syncEnCours}
                className="shrink-0 rounded-lg border border-amber-500/40 bg-amber-500/20 px-3 py-1.5 text-xs font-semibold text-amber-100 transition hover:bg-amber-500/30 disabled:opacity-50">
                {syncEnCours ? "Import en cours…" : "Synchroniser maintenant"}
              </button>
            </div>
            {syncMessage && <div className="mt-2 text-xs text-amber-200/80">{syncMessage}</div>}
          </div>
        )}
        {!retardShopify && syncMessage && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
            {syncMessage}
          </div>
        )}
        {source !== "shopify" && donnees?.meta?.app_premiere_commande && bornesRef &&
          new Date(bornesRef.dfrom) < new Date(donnees.meta.app_premiere_commande) && (
          <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-200">
            {source === "app" ? (
              <>ℹ Les commandes du formulaire ne commencent qu&apos;au <strong>{dateCH(donnees.meta.app_premiere_commande)}</strong> :
              la comparaison avec {libelleRef} n&apos;a pas de base sur cette source.</>
            ) : (
              <>ℹ Le comparatif remonte avant le <strong>{dateCH(donnees.meta.app_premiere_commande)}</strong>, date des premières
              commandes saisies dans le formulaire. L&apos;écart affiché compare donc deux périmètres différents
              (formulaire + Shopify d&apos;un côté, Shopify seul de l&apos;autre).{" "}
              <button type="button" onClick={() => setSource("shopify")} className="underline underline-offset-2 hover:text-sky-100">
                Passer sur « Ventes Shopify »
              </button>{" "}
              pour un comparatif annuel à périmètre constant.</>
            )}
          </div>
        )}

        {erreur && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            Erreur : {erreur}
          </div>
        )}

        <div className={chargement ? "opacity-60 transition-opacity" : "transition-opacity"}>
          {donnees && ref && bornesRef && (
            <div className="space-y-5">

              {/* ─── Tuiles ─── */}
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <Tuile titre="Chiffre d'affaires" valeur={chf(donnees.totaux.courant.ca)}
                  courant={donnees.totaux.courant.ca} reference={ref.ca} libelleRef={libelleRef}
                  sous={`${bornesRef.libelle} : ${chf(ref.ca)}`} />
                <Tuile titre="Commandes" valeur={nfNb.format(donnees.totaux.courant.nb_commandes)}
                  courant={donnees.totaux.courant.nb_commandes} reference={ref.nb_commandes} libelleRef={libelleRef}
                  sous={`${bornesRef.libelle} : ${nfNb.format(ref.nb_commandes)}`} />
                <Tuile titre="Panier moyen" valeur={chf(donnees.totaux.courant.panier_moyen, true)}
                  courant={donnees.totaux.courant.panier_moyen} reference={ref.panier_moyen} libelleRef={libelleRef}
                  sous={`${bornesRef.libelle} : ${chf(ref.panier_moyen, true)}`} />
                <Tuile titre="Articles vendus" valeur={nfNb.format(donnees.totaux.courant.nb_articles)}
                  courant={donnees.totaux.courant.nb_articles} reference={ref.nb_articles} libelleRef={libelleRef}
                  sous={`${bornesRef.libelle} : ${nfNb.format(ref.nb_articles)}`} />
              </div>

              {/* ─── Courbe ─── */}
              <Carte
                titre="Évolution du chiffre d'affaires"
                sous={
                  donnees.periode === "jour"
                    ? "30 derniers jours — les tuiles ci-dessus portent sur la seule journée choisie"
                    : `${donnees.bornes.courant.libelle}${donnees.bornes.courant.partielle && prorata ? " (période en cours, comparatifs tronqués d'autant)" : ""}`
                }
                actions={<BoutonTableau actif={tabCourbe} onClick={() => setTabCourbe(v => !v)} />}
              >
                {/* Légende — toujours présente dès deux séries */}
                <div className="mb-3 flex flex-wrap items-center gap-4 text-xs">
                  <span className="inline-flex items-center gap-2 text-zinc-300">
                    <span className="inline-block h-0.5 w-5 rounded" style={{ background: C_SERIE }} />
                    {donnees.bornes.courant.libelle}
                  </span>
                  <span className="inline-flex items-center gap-2 text-zinc-400">
                    <span className="inline-block h-0.5 w-5 rounded" style={{ background: C_COMPARE }} />
                    {bornesRef.libelle}
                  </span>
                </div>

                {tabCourbe ? (
                  <div className="max-h-[420px] overflow-auto rounded-xl border border-white/10">
                    <table className="min-w-full text-sm">
                      <thead className="sticky top-0 bg-[#22252a] text-left text-xs uppercase tracking-wide text-zinc-400">
                        <tr>
                          <th className="px-3 py-2 font-medium">Date</th>
                          <th className="px-3 py-2 text-right font-medium">CA</th>
                          <th className="px-3 py-2 text-right font-medium">Commandes</th>
                          <th className="px-3 py-2 text-right font-medium">Comparatif</th>
                          <th className="px-3 py-2 text-right font-medium">Écart</th>
                        </tr>
                      </thead>
                      <tbody className="tabular-nums">
                        {donnees.serie.map(p => {
                          const c = compare === "precedent" ? p.ca_precedent : p.ca_an_dernier;
                          return (
                            <tr key={p.i} className="border-t border-white/5">
                              <td className="px-3 py-2 text-zinc-300">{dateCH(p.date)}</td>
                              <td className="px-3 py-2 text-right text-zinc-100">{chf(p.ca)}</td>
                              <td className="px-3 py-2 text-right text-zinc-400">{p.nb}</td>
                              <td className="px-3 py-2 text-right text-zinc-400">{c === null ? "—" : chf(c)}</td>
                              <td className="px-3 py-2 text-right">
                                {c === null ? "—" : <Delta courant={p.ca} ref={c} />}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <CourbeCA serie={donnees.serie} pas={donnees.granularite}
                    libelleCourant={donnees.bornes.courant.libelle}
                    libelleCompare={bornesRef.libelle} compare={compare} />
                )}
              </Carte>

              <div className="grid gap-5 xl:grid-cols-2">
                {/* ─── Conseillers ─── */}
                <Carte
                  titre="Par conseiller"
                  sous={
                    source === "shopify"
                      ? "Indisponible : les commandes Shopify ne portent pas de conseiller"
                      : `Commandes du formulaire · écart vs ${donnees.bornes.precedent.libelle}`
                  }
                  actions={source !== "shopify" ? <BoutonTableau actif={tabConseillers} onClick={() => setTabConseillers(v => !v)} /> : undefined}
                >
                  {source === "shopify" ? (
                    <div className="rounded-xl border border-white/10 bg-[#22252a] px-4 py-8 text-center text-sm text-zinc-400">
                      Les ventes Shopify n'enregistrent pas le conseiller.<br />
                      <button type="button" onClick={() => setSource("app")}
                        className="mt-3 rounded-lg border border-white/10 bg-[#34383d] px-3 py-1.5 text-xs text-zinc-200 hover:bg-[#40454b]">
                        Basculer sur les commandes formulaire
                      </button>
                    </div>
                  ) : tabConseillers ? (
                    <div className="overflow-x-auto rounded-xl border border-white/10">
                      <table className="min-w-full text-sm">
                        <thead className="bg-[#22252a] text-left text-xs uppercase tracking-wide text-zinc-400">
                          <tr>
                            <th className="px-3 py-2 font-medium">Conseiller</th>
                            <th className="px-3 py-2 text-right font-medium">CA</th>
                            <th className="px-3 py-2 text-right font-medium">Cmd</th>
                            <th className="px-3 py-2 text-right font-medium">Panier moyen</th>
                            <th className="px-3 py-2 text-right font-medium">Articles</th>
                            <th className="px-3 py-2 text-right font-medium">Écart</th>
                          </tr>
                        </thead>
                        <tbody className="tabular-nums">
                          {donnees.commerciaux.map(c => (
                            <tr key={c.commercial} className="border-t border-white/5">
                              <td className="px-3 py-2 text-zinc-200">{c.commercial}</td>
                              <td className="px-3 py-2 text-right text-zinc-100">{chf(c.ca)}</td>
                              <td className="px-3 py-2 text-right text-zinc-400">{c.nb_commandes}</td>
                              <td className="px-3 py-2 text-right text-zinc-400">{chf(c.panier_moyen, true)}</td>
                              <td className="px-3 py-2 text-right text-zinc-400">{nfNb.format(c.nb_articles)}</td>
                              <td className="px-3 py-2 text-right"><Delta courant={c.ca} ref={c.ca_precedent} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <Barres
                      max={maxCommercial}
                      formatValeur={v => chf(v)}
                      lignes={donnees.commerciaux.map(c => ({
                        cle: c.commercial,
                        libelle: c.commercial,
                        valeur: c.ca,
                        reference: c.ca_precedent,
                        detail: `${c.nb_commandes} cmd · panier ${chf(c.panier_moyen)} · ${nfNb.format(c.nb_articles)} art.`,
                      }))}
                    />
                  )}
                </Carte>

                {/* ─── Marques ─── */}
                <Carte
                  titre="Par marque"
                  sous={`Valeur des articles · écart vs ${donnees.bornes.precedent.libelle}`}
                  actions={<BoutonTableau actif={tabMarques} onClick={() => setTabMarques(v => !v)} />}
                >
                  {tabMarques ? (
                    <div className="max-h-[420px] overflow-auto rounded-xl border border-white/10">
                      <table className="min-w-full text-sm">
                        <thead className="sticky top-0 bg-[#22252a] text-left text-xs uppercase tracking-wide text-zinc-400">
                          <tr>
                            <th className="px-3 py-2 font-medium">Marque</th>
                            <th className="px-3 py-2 text-right font-medium">Valeur</th>
                            <th className="px-3 py-2 text-right font-medium">Pièces</th>
                            <th className="px-3 py-2 text-right font-medium">Écart</th>
                          </tr>
                        </thead>
                        <tbody className="tabular-nums">
                          {(donnees.marques || []).map(m => (
                            <tr key={m.marque} className="border-t border-white/5">
                              <td className="px-3 py-2 text-zinc-200">{m.marque}</td>
                              <td className="px-3 py-2 text-right text-zinc-100">{chf(m.valeur)}</td>
                              <td className="px-3 py-2 text-right text-zinc-400">{nfNb.format(m.qty)}</td>
                              <td className="px-3 py-2 text-right"><Delta courant={m.valeur} ref={m.valeur_precedent} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <Barres
                      max={maxMarque}
                      formatValeur={v => chf(v)}
                      lignes={marquesAffichees.map(m => ({
                        cle: m.marque,
                        libelle: m.marque,
                        valeur: m.valeur,
                        reference: m.valeur_precedent,
                        detail: `${nfNb.format(m.qty)} pièce(s)`,
                      }))}
                    />
                  )}
                  <p className="mt-4 text-xs text-zinc-500">
                    La marque est lue au début du libellé des articles du catalogue.
                    Les articles saisis à la volée n'ont pas de règle de nommage : ils sont
                    regroupés sous « Articles à la volée » plutôt que répartis au hasard.
                  </p>
                </Carte>
              </div>

              {/* ─── Top articles ─── */}
              <Carte
                titre="Articles les plus vendus"
                sous={`${donnees.bornes.courant.libelle} · classés par valeur`}
              >
                <div className="overflow-x-auto rounded-xl border border-white/10">
                  <table className="min-w-full text-sm">
                    <thead className="bg-[#22252a] text-left text-xs uppercase tracking-wide text-zinc-400">
                      <tr>
                        <th className="px-3 py-2 font-medium">N° article</th>
                        <th className="px-3 py-2 font-medium">Désignation</th>
                        <th className="px-3 py-2 font-medium">Marque</th>
                        <th className="px-3 py-2 text-right font-medium">Pièces</th>
                        <th className="px-3 py-2 text-right font-medium">Valeur</th>
                        <th className="px-3 py-2 text-right font-medium">Commandes</th>
                        <th className="px-3 py-2 text-right font-medium"></th>
                      </tr>
                    </thead>
                    <tbody className="tabular-nums">
                      {donnees.articles.length === 0 ? (
                        <tr><td colSpan={7} className="px-3 py-8 text-center text-zinc-500">Aucun article sur cette période.</td></tr>
                      ) : donnees.articles.map((a, i) => (
                        <tr key={`${a.sku}-${i}`} className="border-t border-white/5">
                          <td className="px-3 py-2 font-medium text-zinc-100">{a.sku}</td>
                          <td className="max-w-[420px] truncate px-3 py-2 text-zinc-300" title={a.titre}>{a.titre}</td>
                          <td className="px-3 py-2 text-zinc-400">
                            {a.marque
                              ? a.marque
                              : a.marque_presumee
                                ? <span className="italic text-zinc-500"
                                    title="Article saisi à la volée : marque déduite du libellé, non comptée dans la répartition par marque">
                                    {a.marque_presumee} ?
                                  </span>
                                : "—"}
                          </td>
                          <td className="px-3 py-2 text-right text-zinc-100">{nfNb.format(a.qty)}</td>
                          <td className="px-3 py-2 text-right text-zinc-100">{chf(a.valeur)}</td>
                          <td className="px-3 py-2 text-right text-zinc-400">{a.nb_commandes}</td>
                          <td className="px-3 py-2 text-right">
                            {a.sku && a.sku !== "—" && (
                              <Link href={`/dashboard?recherche=${encodeURIComponent(a.sku)}`}
                                className="rounded-lg border border-white/10 bg-[#34383d] px-2.5 py-1 text-xs text-zinc-200 hover:bg-[#40454b]">
                                Voir les dossiers
                              </Link>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-4 text-xs text-zinc-500">
                  « Valeur » = quantité × prix unitaire − rabais de ligne. Hors remise globale,
                  services et arrondi : la somme des articles ne retombe donc pas sur le chiffre
                  d&apos;affaires des tuiles. Côté formulaire, les prix sont TTC pour les clients
                  privés et HT pour les professionnels.
                </p>
              </Carte>

            </div>
          )}
        </div>

        {chargement && !donnees && (
          <div className="rounded-2xl border border-white/10 bg-[#2a2d31] p-8 text-zinc-400">Chargement…</div>
        )}
      </div>
    </main>
  );
}
