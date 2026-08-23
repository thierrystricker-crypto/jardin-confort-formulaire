"use client";
// app/dashboard/delais/page.tsx
// Second dashboard « Commandes & délais » — étape 5 du chantier suivi des
// délais fournisseurs (spec : claude/chantier-suivi-delais-fournisseurs.md §7).
// Une ligne par commande client × marque, tri par urgence. Les DEUX dates
// toujours ensemble : le départ fournisseur BRUT (celui qu'on cite au
// téléphone) et l'arrivage calculé, avec la règle de transit en clair.
// Alimenté par la vue v_suivi_delais + le job d'extraction automatique.
// Chantier Arrivages (étape 3, 22.08) : colonne « Reçu » x/y lignes, étapes
// partiellement_recue / en_stock / marque_non_suivie, filtre « marques suivies
// seulement », et le bouton « Reçu » renvoie vers /dashboard/arrivages (la
// réception se saisit par ligne et par quantité, jamais plus en bloc ici).

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Ligne = {
  id: string; numero_commande: string; boutique: string
  client_nom: string|null; client_prenom: string|null; marque: string
  articles: {sku?: string; titre?: string; qty?: number}[]|null
  date_commande: string|null; delai_annonce_client: string|null
  ref_fournisseur: string|null; statut: string
  date_depart_pilote: string|null; semaine_annoncee_pilote: string|null
  arrivage_calcule: string|null; regle_transit: string|null
  nb_dates: number; nb_reports: number; nb_a_valider: number
  date_reception: string|null
  jours_avant_echeance: number|null; jours_retard: number
  alarme_echeance_proche: boolean; alarme_retard: boolean; alarme_delai_manquant: boolean
  date_expedition_reelle: string|null; preuve_depart: string|null
  arrivage_estime_reel: string|null; etape: string
  client_societe: string|null; commande_url: string|null
  marque_suivie: boolean; en_stock: boolean; stock_etat: string|null
  nb_lignes: number|null; nb_lignes_couvertes: number|null; nb_lignes_recues: number|null
  reception_partielle: boolean; date_reception_partielle: string|null
}
type Orpheline = {
  id: string; marque: string|null; type_document: string|null
  sujet: string|null; date_mail: string|null; raison: string|null; created_at: string
}
type AValider = {
  id: string; commande_id: string; type: string; date_depart: string|null
  semaine_annoncee: string|null; confiance: number; portee: string
  articles_concernes: string[]|null; commentaire: string|null; created_at: string
  pj_url: string|null; pj_nom: string|null
  suivi_commandes: {numero_commande: string; marque: string; client_nom: string|null; client_prenom: string|null}|null
}
type Calibrage = {
  marque: string; nb_observations: number; ecart_median_jours: number|null
  ecart_moyen_jours: number|null; ecart_min_jours: number|null
  ecart_max_jours: number|null; regle_transit: string|null
}
type Fournisseur = {
  marque: string; transit_regle: Record<string, unknown>|null
  seuil_echeance_jours: number; seuil_delai_manquant_jours_ouvres: number; actif: boolean
}
type LigneCommande = {
  position: number; sku: string|null; titre: string|null; marque: string|null
  qty_commandee: number; qty_stock_cmd: number; qty_recue_totale: number; qty_restante: number
  etat: string; mode_ligne: string; derniere_reception: string|null
}
type Evenement = {
  id: string; type: string; date_depart: string|null; semaine_annoncee: string|null
  source: string; confiance: number; statut_validation: string; portee: string
  articles_concernes: string[]|null; commentaire: string|null; saisi_par: string|null
  created_at: string; pj_url: string|null; pj_nom: string|null
  ref_fournisseur: string|null
}

const JOURS = ["di","lu","ma","me","je","ve","sa"];
function fmtDate(iso: string|null|undefined) {
  if (!iso) return "—";
  const d = new Date(iso.length <= 10 ? `${iso}T12:00:00Z` : iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("fr-CH", { day: "2-digit", month: "2-digit", year: "numeric" });
}
function fmtDateCourte(iso: string|null|undefined) {
  if (!iso) return "—";
  const d = new Date(`${String(iso).slice(0,10)}T12:00:00Z`);
  if (isNaN(d.getTime())) return "—";
  const dd = String(d.getUTCDate()).padStart(2,"0");
  const mm = String(d.getUTCMonth()+1).padStart(2,"0");
  return `${JOURS[d.getUTCDay()]} ${dd}.${mm}.${String(d.getUTCFullYear()).slice(2)}`;
}
// Convention équipe : NOM Prénom (la société en premier quand elle existe).
function nomClient(l: {client_nom: string|null; client_prenom: string|null}) {
  return [l.client_nom, l.client_prenom].filter(Boolean).join(" ") || "—";
}
// Départ fournisseur BRUT — format Fermob proposé « S35 · dès le je 03.09.26 »
function departBrut(l: Ligne) {
  if (l.semaine_annoncee_pilote) {
    const s = l.semaine_annoncee_pilote.replace(/^\d{4}-/, "");
    return `${s} · dès le ${fmtDateCourte(l.arrivage_calcule)}`;
  }
  return l.date_depart_pilote ? fmtDateCourte(l.date_depart_pilote) : "—";
}
// Rang d'urgence (aligné sur delai_lister) : retard → délai manquant →
// échéance proche → le reste par arrivage croissant.
function rangUrgence(l: Ligne) {
  if (l.statut !== "en_cours") return 5;
  if (l.alarme_retard) return 0;
  if (l.alarme_delai_manquant) return 1;
  if (l.alarme_echeance_proche) return 2;
  if (l.etape === "facturee" || l.etape === "expediee" || l.etape === "partiellement_expediee") return 3;
  return 4;
}
const ETAPES: Record<string,{label: string; cls: string}> = {
  sans_delai:             { label: "Sans délai",      cls: "bg-zinc-500/15 text-zinc-300" },
  confirmee:              { label: "Confirmée",       cls: "bg-sky-500/15 text-sky-300" },
  partiellement_expediee: { label: "Part. expédiée",  cls: "bg-teal-500/15 text-teal-300" },
  facturee:               { label: "🚚 Facturée",     cls: "bg-emerald-500/15 text-emerald-300" },
  expediee:               { label: "🚚 Expédiée",     cls: "bg-emerald-500/15 text-emerald-300" },
  recue:                  { label: "✅ Reçue",         cls: "bg-emerald-500/25 text-emerald-200" },
  partiellement_recue:    { label: "📦 Part. reçue",    cls: "bg-lime-500/15 text-lime-200" },
  en_stock:               { label: "🏬 En stock",       cls: "bg-zinc-500/20 text-zinc-200" },
  marque_non_suivie:      { label: "Marque non suivie", cls: "bg-zinc-500/10 text-zinc-400" },
};
const TYPES_EVT: Record<string,string> = {
  confirmation_fournisseur: "Confirmation",
  report: "Report",
  expedition: "Expédition",
  facture: "Facture (départ réel)",
  reception: "Réception",
  note: "Note",
};

type FiltreRapide = "toutes"|"retard"|"echeance"|"delai_manquant"|"a_valider"|"parties"|"en_cours";

export default function DelaisPage() {
  const [lignes, setLignes] = useState<Ligne[]>([]);
  const [orphelines, setOrphelines] = useState<Orpheline[]>([]);
  const [aValider, setAValider] = useState<AValider[]>([]);
  const [calibrage, setCalibrage] = useState<Calibrage[]>([]);
  const [fournisseurs, setFournisseurs] = useState<Fournisseur[]>([]);
  const [loading, setLoading] = useState(true);
  const [erreur, setErreur] = useState("");
  const [marque, setMarque] = useState("toutes");
  const [boutique, setBoutique] = useState("toutes");
  const [filtre, setFiltre] = useState<FiltreRapide>("en_cours");
  const [recherche, setRecherche] = useState("");
  const [suiviesSeules, setSuiviesSeules] = useState(false);
  const [ouverte, setOuverte] = useState<string|null>(null);
  const [chrono, setChrono] = useState<Record<string, Evenement[]>>({});
  // Articles de TOUTE la commande (toutes marques), chargés au dépli — le
  // tableau est par commande × marque, mais quand on ouvre une ligne on veut
  // voir la commande entière (constat Thierry 22.08, JAR-12814).
  const [lignesCommande, setLignesCommande] = useState<Record<string, LigneCommande[]>>({});
  const [enCours, setEnCours] = useState(false);
  const [voletBas, setVoletBas] = useState<"a_valider"|"orphelines"|"fournisseurs"|null>(null);

  async function charger() {
    setLoading(true);
    try {
      const res = await fetch("/api/delais");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Erreur ${res.status}`);
      setLignes(json.lignes || []);
      setOrphelines(json.orphelines || []);
      setAValider(json.a_valider || []);
      setCalibrage(json.calibrage || []);
      setFournisseurs(json.fournisseurs || []);
      setErreur("");
    } catch (e) { setErreur((e as Error).message); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    charger();
    // En arrière-plan : remplir la promesse client des commandes web qui
    // n'en ont pas encore (métachamp/tags Shopify), puis rafraîchir si des
    // lignes ont été complétées. Silencieux en cas d'échec — le tableau
    // reste utilisable, la prochaine ouverture retentera.
    fetch("/api/delais/promesse", { method: "POST" })
      .then((r) => r.json())
      .then((b) => { if (b?.remplies > 0) charger(); })
      .catch(() => {});
  }, []);

  async function ouvrirChrono(l: Ligne) {
    if (ouverte === l.id) { setOuverte(null); return; }
    setOuverte(l.id);
    if (!chrono[l.id]) {
      try {
        const res = await fetch(`/api/delais/chronologie?commande_id=${l.id}`);
        const json = await res.json();
        setChrono(prev => ({ ...prev, [l.id]: json.evenements || [] }));
      } catch { /* silencieux, le dépli montrera "chargement" */ }
    }
    const cle = `${l.boutique}|${l.numero_commande}`;
    if (!lignesCommande[cle]) {
      try {
        const res = await fetch(`/api/arrivages?boutique=${encodeURIComponent(l.boutique)}&numero=${encodeURIComponent(l.numero_commande)}`);
        const json = await res.json();
        if (res.ok && json.commande?.lignes) setLignesCommande(prev => ({ ...prev, [cle]: json.commande.lignes }));
      } catch { /* le dépli retombera sur le snapshot de la marque */ }
    }
  }

  async function action(corps: Record<string, unknown>) {
    setEnCours(true);
    try {
      const res = await fetch("/api/delais/evenement", {
        method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify(corps),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { alert("Erreur : " + (json.error || res.status)); return; }
      setChrono({});
      await charger();
    } catch (e) { alert("Erreur réseau : " + (e as Error).message); }
    finally { setEnCours(false); }
  }

  function rechercheApprofondie(l: Ligne) {
    const phrase = `Recherche approfondie du délai pour ${l.numero_commande} (${l.marque}) — delai_rechercher`;
    navigator.clipboard?.writeText(phrase).catch(() => {});
    window.open("/dashboard/jardi", "_blank", "noopener");
  }

  const marques = useMemo(() => [...new Set(lignes.map(l => l.marque))].sort(), [lignes]);
  const boutiques = useMemo(() => [...new Set(lignes.map(l => l.boutique))].sort(), [lignes]);

  // Une ligne « correspond » aux filtres ; mais l'affichage est SOLIDAIRE par
  // commande (Thierry 22.08) : si une seule marque d'une commande correspond,
  // TOUTES les lignes de la commande sortent ensemble — le vendeur voit la
  // commande d'un coup d'œil, jamais une marque orpheline. Les lignes qui ne
  // correspondent pas elles-mêmes sont affichées atténuées.
  const visibles = useMemo(() => {
    const correspond = (l: Ligne) => {
      if (marque !== "toutes" && l.marque !== marque) return false;
      if (boutique !== "toutes" && l.boutique !== boutique) return false;
      if (suiviesSeules && !l.marque_suivie) return false;
      if (filtre === "en_cours" && l.statut !== "en_cours") return false;
      else if (filtre === "retard" && !l.alarme_retard) return false;
      else if (filtre === "echeance" && !l.alarme_echeance_proche) return false;
      else if (filtre === "delai_manquant" && !l.alarme_delai_manquant) return false;
      else if (filtre === "a_valider" && !(l.nb_a_valider > 0)) return false;
      else if (filtre === "parties" && !(["facturee","expediee","partiellement_expediee"].includes(l.etape) && l.statut === "en_cours")) return false;
      if (recherche.trim()) {
        const q = recherche.trim().toLowerCase();
        if (!(l.numero_commande.toLowerCase().includes(q) ||
              nomClient(l).toLowerCase().includes(q) ||
              (l.ref_fournisseur || "").toLowerCase().includes(q))) return false;
      }
      return true;
    };
    // Groupes = commande (boutique + numéro), gardés si une ligne correspond.
    const parCommande = new Map<string, Ligne[]>();
    for (const l of lignes) {
      const cle = `${l.boutique}|${l.numero_commande}`;
      const g = parCommande.get(cle) || [];
      g.push(l); parCommande.set(cle, g);
    }
    const tri = (a: Ligne, b: Ligne) => {
      const ra = rangUrgence(a), rb = rangUrgence(b);
      if (ra !== rb) return ra - rb;
      if (ra === 0) return b.jours_retard - a.jours_retard;
      const aa = a.arrivage_calcule || "9999", ab = b.arrivage_calcule || "9999";
      return aa < ab ? -1 : aa > ab ? 1 : 0;
    };
    const groupes = [...parCommande.values()]
      .map(g => ({ g: g.sort(tri), ok: g.some(correspond) }))
      .filter(x => x.ok);
    // Les commandes se classent par leur ligne la plus urgente QUI CORRESPOND
    // (une commande ne remonte pas en tête grâce à une marque hors filtre).
    groupes.sort((A, B) => tri(A.g.find(correspond) || A.g[0], B.g.find(correspond) || B.g[0]));
    return groupes.flatMap(({ g }) =>
      g.map((l, i) => ({ ...l, _premiere: i === 0, _taille: g.length, _correspond: correspond(l) }))
    );
  }, [lignes, marque, boutique, filtre, recherche, suiviesSeules]);

  const stats = useMemo(() => {
    const ec = lignes.filter(l => l.statut === "en_cours");
    return {
      total: ec.length,
      retard: ec.filter(l => l.alarme_retard).length,
      echeance: ec.filter(l => l.alarme_echeance_proche).length,
      manquant: ec.filter(l => l.alarme_delai_manquant).length,
      aValider: aValider.length,
      orphelines: orphelines.length,
    };
  }, [lignes, aValider, orphelines]);

  if (loading && !lignes.length) return (
    <main className="min-h-screen bg-[#1f2125] px-6 py-8 text-zinc-100">
      <div className="mx-auto max-w-[1700px] rounded-2xl border border-white/10 bg-[#2a2d31] p-8 text-zinc-400">Chargement…</div>
    </main>
  );

  return (
    <main className="min-h-screen bg-[#1f2125] px-6 py-8 text-zinc-100">
      <div className="mx-auto max-w-[1700px] space-y-6">

        {/* En-tête */}
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex items-start gap-4">
            <img src="https://cdn.shopify.com/s/files/1/0360/3251/2135/files/picto_jardin_confort_apple_low.png?v=1775944940" alt="" className="h-16 w-16 rounded-xl object-contain"/>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Commandes &amp; délais fournisseurs</h1>
              <p className="mt-1 text-sm text-zinc-400">Une ligne par commande × marque — triées par urgence. Départ fournisseur brut ET arrivage calculé, toujours ensemble.</p>
              <p className="mt-1 text-xs text-zinc-500">Alimenté automatiquement par les mails fournisseurs (toutes les 3 h) · POC Fermob, Glatz, Fatboy</p>
            </div>
          </div>
          <div className="flex gap-3 flex-wrap">
            <Link href="/dashboard" className="inline-flex items-center rounded-2xl border border-white/10 bg-[#2a2d31] px-4 py-3 text-sm text-zinc-300 transition hover:bg-[#34383d]">← Dashboard</Link>
            <button onClick={charger} className="inline-flex items-center rounded-2xl border border-white/10 bg-[#2a2d31] px-4 py-3 text-sm text-zinc-300 transition hover:bg-[#34383d]">🔄 Actualiser</button>
          </div>
        </div>

        {/* Compteurs — cliquables = filtres */}
        <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
          {([
            {cle: "en_cours" as FiltreRapide, label: "En cours", valeur: stats.total, cls: "text-zinc-100"},
            {cle: "retard" as FiltreRapide, label: "⚠️ En retard", valeur: stats.retard, cls: stats.retard ? "text-rose-300" : "text-zinc-500"},
            {cle: "echeance" as FiltreRapide, label: "🔔 Échéance proche", valeur: stats.echeance, cls: stats.echeance ? "text-amber-300" : "text-zinc-500"},
            {cle: "delai_manquant" as FiltreRapide, label: "❓ Délai manquant", valeur: stats.manquant, cls: stats.manquant ? "text-amber-300" : "text-zinc-500"},
            {cle: "a_valider" as FiltreRapide, label: "👁 À valider", valeur: stats.aValider, cls: stats.aValider ? "text-sky-300" : "text-zinc-500"},
            {cle: "parties" as FiltreRapide, label: "🚚 En route", valeur: lignes.filter(l => ["facturee","expediee","partiellement_expediee"].includes(l.etape) && l.statut === "en_cours").length, cls: "text-emerald-300"},
          ]).map(c => (
            <button key={c.label} onClick={() => setFiltre(filtre === c.cle ? "toutes" : c.cle)}
              className={`rounded-2xl border p-4 text-left transition ${filtre === c.cle ? "border-sky-400/50 bg-[#31353b]" : "border-white/10 bg-[#2a2d31] hover:bg-[#31353b]"}`}>
              <div className="text-xs text-zinc-400">{c.label}</div>
              <div className={`mt-1 text-2xl font-bold ${c.cls}`}>{c.valeur}</div>
            </button>
          ))}
        </div>

        {/* Filtres */}
        <div className="grid gap-3 xl:grid-cols-[200px_200px_minmax(0,1fr)_140px]">
          <select value={marque} onChange={e => setMarque(e.target.value)} className="w-full rounded-xl border border-white/10 bg-[#2a2d31] px-4 py-2.5 text-sm text-zinc-100 outline-none">
            <option value="toutes">Toutes les marques</option>
            {marques.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <select value={boutique} onChange={e => setBoutique(e.target.value)} className="w-full rounded-xl border border-white/10 bg-[#2a2d31] px-4 py-2.5 text-sm text-zinc-100 outline-none">
            <option value="toutes">Tous les canaux</option>
            {boutiques.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
          <input value={recherche} onChange={e => setRecherche(e.target.value)} placeholder="Recherche : numéro (JAR-x, CMD-x), client, réf fournisseur (Vx, BTBx)…"
            className="w-full rounded-xl border border-white/10 bg-[#2a2d31] px-4 py-2.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-500"/>
          <button onClick={() => {setMarque("toutes");setBoutique("toutes");setFiltre("en_cours");setRecherche("");setSuiviesSeules(false)}} className="rounded-xl border border-white/10 bg-[#34383d] px-4 py-2.5 text-sm text-zinc-100 transition hover:bg-[#40454b]">Reset</button>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="inline-flex cursor-pointer items-center gap-2 text-zinc-300">
            <input type="checkbox" checked={suiviesSeules} onChange={e => setSuiviesSeules(e.target.checked)} className="h-4 w-4 accent-sky-400"/>
            Marques suivies seulement <span className="text-xs text-zinc-500">(extraction automatique des délais)</span>
          </label>
          <Link href="/dashboard/arrivages" className="inline-flex items-center rounded-xl border border-emerald-400/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/25" title="Réception par article et par quantité — scan de la fiche de travail">📦 Arrivages</Link>
        </div>

        {erreur && <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300">{erreur}</div>}

        {/* Tableau principal */}
        <div className="overflow-x-auto rounded-2xl border border-white/10 bg-[#2a2d31]">
          <div className="px-4 pt-3 text-xs text-zinc-500">{visibles.length} ligne(s) — filtre : {filtre}{marque !== "toutes" ? ` · ${marque}` : ""}{boutique !== "toutes" ? ` · ${boutique}` : ""}</div>
          <table className="w-full min-w-[1400px] text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-zinc-500">
                <th className="px-4 py-3">Réf.</th>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">Marque</th>
                <th className="px-4 py-3">Commande</th>
                <th className="px-4 py-3">Départ fournisseur</th>
                <th className="px-4 py-3">Arrivage</th>
                <th className="px-4 py-3" title="De la commande client à l'arrivage prévu">Durée</th>
                <th className="px-4 py-3" title="Délai annoncé au client à la vente — la question finale : tient-on notre promesse ?">Promesse client</th>
                <th className="px-4 py-3">Étape</th>
                <th className="px-4 py-3" title="Lignes d'articles couvertes (en stock à la commande + reçues) sur le total de la marque">Reçu</th>
                <th className="px-4 py-3">Alarme</th>
                <th className="px-4 py-3"></th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map(l => {
                const etape = ETAPES[l.etape] || ETAPES.sans_delai;
                const groupe = l as Ligne & { _premiere: boolean; _taille: number; _correspond: boolean };
                const evts = chrono[l.id];
                // Arrivage de référence : le réel (preuve de départ) s'il existe,
                // sinon le calculé depuis la promesse fournisseur.
                const prevu = l.arrivage_estime_reel || l.arrivage_calcule;
                const duree = prevu && l.date_commande
                  ? Math.round((new Date(prevu).getTime() - new Date(l.date_commande).getTime()) / 86400000) : null;
                const ecartPromesse = prevu && l.delai_annonce_client
                  ? Math.round((new Date(prevu).getTime() - new Date(l.delai_annonce_client).getTime()) / 86400000) : null;
                return (
                <React.Fragment key={l.id}>
                  <tr onClick={() => ouvrirChrono(l)}
                    className={`cursor-pointer transition hover:bg-[#31353b] ${groupe._premiere ? "border-t-2 border-white/15" : "border-t border-white/5"} ${l.alarme_retard ? "bg-rose-500/5" : ""} ${groupe._correspond ? "" : "opacity-50"}`}>
                    <td className="px-4 py-3 font-medium">
                      {groupe._premiere ? (
                        <>
                          {l.numero_commande}
                          {groupe._taille > 1 && <span className="ml-1.5 rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] text-zinc-400" title="Cette commande est suivie sur plusieurs marques — les lignes restent toujours groupées">{groupe._taille} marques</span>}
                        </>
                      ) : (
                        <span className="pl-3 text-zinc-500" title={`Même commande ${l.numero_commande}`}>↳</span>
                      )}
                      {l.ref_fournisseur && <div className={groupe._premiere ? "text-xs text-zinc-500" : "pl-3 text-xs text-zinc-500"}>{l.ref_fournisseur}</div>}
                    </td>
                    <td className="px-4 py-3">
                      {groupe._premiere ? (l.client_societe ? (
                        <>
                          <div>{l.client_societe}</div>
                          <div className="text-xs text-zinc-400">{nomClient(l)}</div>
                        </>
                      ) : nomClient(l)) : <span className="text-zinc-600">〃</span>}
                    </td>
                    <td className="px-4 py-3 text-zinc-300">{l.marque}</td>
                    <td className="px-4 py-3 text-zinc-400">{fmtDate(l.date_commande)}</td>
                    <td className="px-4 py-3">
                      <span title={l.regle_transit || ""}>{departBrut(l)}</span>
                      {l.nb_dates > 1 && <span className="ml-2 inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-300" title="Des articles de cette commande ont des dates différentes — déplier pour le détail">{l.nb_dates} dates</span>}
                      {l.nb_reports > 0 && <span className="ml-1 inline-flex items-center rounded-full bg-rose-500/15 px-2 py-0.5 text-xs text-rose-300" title="Nombre de reports fournisseur">{l.nb_reports} report{l.nb_reports > 1 ? "s" : ""}</span>}
                    </td>
                    <td className="px-4 py-3">
                      {l.preuve_depart ? (
                        <span title={`Parti le ${fmtDate(l.date_expedition_reelle)} (${l.preuve_depart}) — ${l.regle_transit || ""}`} className="text-emerald-300">
                          {fmtDateCourte(l.arrivage_estime_reel)} <span className="text-xs text-emerald-400/70">réel</span>
                        </span>
                      ) : (
                        <span title={l.regle_transit || ""}>{l.arrivage_calcule ? fmtDateCourte(l.arrivage_calcule) : "—"}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-zinc-300" title="De la commande client à l'arrivage prévu">
                      {duree !== null ? `${duree} j` : <span className="text-zinc-600">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      {l.delai_annonce_client ? (
                        <>
                          <div title="Délai annoncé au client à la vente">{fmtDateCourte(l.delai_annonce_client)}</div>
                          {ecartPromesse !== null && (
                            ecartPromesse > 0
                              ? <span className="inline-flex items-center rounded-full bg-rose-500/20 px-2 py-0.5 text-xs font-semibold text-rose-300" title="L'arrivage prévu dépasse la promesse faite au client">⚠️ +{ecartPromesse} j vs promis</span>
                              : <span className="inline-flex items-center rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-300" title="L'arrivage prévu tient dans la promesse faite au client">✓ raccord</span>
                          )}
                        </>
                      ) : <span className="text-zinc-600">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${etape.cls}`}>{etape.label}</span>
                    </td>
                    <td className="px-4 py-3">
                      {l.nb_lignes ? (
                        <span title={`${l.nb_lignes_couvertes}/${l.nb_lignes} lignes couvertes${l.nb_lignes_recues ? ` · ${l.nb_lignes_recues} reçue(s)` : ""}${l.date_reception_partielle ? ` · dernier arrivage ${fmtDate(l.date_reception_partielle)}` : ""}`}
                          className={`font-medium ${Number(l.nb_lignes_couvertes) >= Number(l.nb_lignes) ? "text-emerald-300" : l.reception_partielle ? "text-lime-300" : "text-zinc-500"}`}>
                          {l.nb_lignes_couvertes}/{l.nb_lignes}
                          {l.reception_partielle && Number(l.nb_lignes_couvertes) < Number(l.nb_lignes) && <span className="ml-1 rounded-full bg-lime-500/15 px-1.5 py-0.5 text-[10px] text-lime-200">partiel</span>}
                        </span>
                      ) : <span className="text-zinc-600">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      {l.alarme_retard && <span className="inline-flex items-center rounded-full bg-rose-500/20 px-2.5 py-1 text-xs font-semibold text-rose-300">⚠️ {l.jours_retard} j de retard</span>}
                      {!l.alarme_retard && l.alarme_echeance_proche && <span className="inline-flex items-center rounded-full bg-amber-500/15 px-2.5 py-1 text-xs text-amber-300">🔔 dans {l.jours_avant_echeance} j</span>}
                      {!l.alarme_retard && !l.alarme_echeance_proche && l.alarme_delai_manquant && <span className="inline-flex items-center rounded-full bg-amber-500/15 px-2.5 py-1 text-xs text-amber-300">❓ délai manquant</span>}
                      {l.nb_a_valider > 0 && <span className="ml-1 inline-flex items-center rounded-full bg-sky-500/15 px-2 py-0.5 text-xs text-sky-300">{l.nb_a_valider} à valider</span>}
                    </td>
                    <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                      {l.commande_url && (
                        <a href={l.commande_url} target="_blank" rel="noopener noreferrer"
                          title="Ouvrir la commande client dans un nouvel onglet"
                          className="inline-flex items-center rounded-lg border border-sky-500/30 bg-sky-500/10 px-2.5 py-1 text-xs text-sky-300 hover:bg-sky-500/20">↗ Commande</a>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                      {l.statut === "en_cours" && !l.date_reception && (
                        <Link href={`/dashboard/arrivages?q=${encodeURIComponent(l.numero_commande)}`}
                          title="Saisir la réception article par article (page Arrivages) — nourrit le calibrage des règles de transit quand toute la marque est couverte"
                          className="inline-flex items-center rounded-lg border border-emerald-400/40 bg-emerald-500/15 px-2.5 py-1 text-xs text-emerald-300 hover:bg-emerald-500/25">📦 Reçu</Link>
                      )}
                    </td>
                  </tr>

                  {/* Dépli : chronologie + articles + recherche approfondie */}
                  {ouverte === l.id && (
                    <tr className="border-t border-white/5 bg-[#26292d]">
                      <td colSpan={13} className="px-6 py-4">
                        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
                          <div>
                            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Chronologie des délais — rien n'est jamais écrasé</div>
                            {!evts && <div className="text-sm text-zinc-500">Chargement…</div>}
                            {evts && evts.length === 0 && <div className="text-sm text-zinc-500">Aucun événement — délai fournisseur jamais relevé. Lancer la recherche approfondie ci-contre.</div>}
                            {evts && evts.length > 0 && (
                              <div className="space-y-2">
                                {evts.map((e, i) => {
                                  // L'écart se mesure au sein de la MÊME commande fournisseur
                                  // (même n° V/BTB) : deux commandes fournisseur séparées pour
                                  // la même commande client ne sont pas des reports entre elles.
                                  const prec = evts.slice(0, i).reverse().find(p =>
                                    ["confirmation_fournisseur","report"].includes(p.type) && p.date_depart && p.statut_validation === "valide"
                                    && (!e.ref_fournisseur || !p.ref_fournisseur || p.ref_fournisseur === e.ref_fournisseur));
                                  const ecart = (e.type === "report" && e.date_depart && prec?.date_depart)
                                    ? Math.round((new Date(e.date_depart).getTime() - new Date(prec.date_depart).getTime()) / 86400000)
                                    : null;
                                  return (
                                  <div key={e.id} className={`flex flex-wrap items-center gap-2 rounded-xl border border-white/5 px-3 py-2 text-sm ${e.statut_validation === "rejete" ? "opacity-40 line-through" : ""}`}>
                                    <span className="text-xs text-zinc-500 w-20">{fmtDate(e.created_at)}</span>
                                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${e.type === "report" ? "bg-rose-500/15 text-rose-300" : e.type === "reception" ? "bg-emerald-500/25 text-emerald-200" : ["facture","expedition"].includes(e.type) ? "bg-emerald-500/15 text-emerald-300" : "bg-sky-500/15 text-sky-300"}`}>{TYPES_EVT[e.type] || e.type}</span>
                                    {e.ref_fournisseur && <span className="text-xs text-zinc-500" title="N° de commande fournisseur — une commande client peut en porter plusieurs">{e.ref_fournisseur}</span>}
                                    <span className="font-medium">{e.semaine_annoncee ? `${e.semaine_annoncee.replace(/^\d{4}-/, "")} · ` : ""}{fmtDateCourte(e.date_depart)}</span>
                                    {ecart !== null && <span className={`text-xs ${ecart > 0 ? "text-rose-300" : "text-emerald-300"}`}>({ecart > 0 ? "+" : ""}{ecart} j vs promesse précédente)</span>}
                                    {e.portee === "article" && e.articles_concernes && <span className="text-xs text-amber-300" title={e.articles_concernes.join(", ")}>· {e.articles_concernes.length} article(s)</span>}
                                    <span className="text-xs text-zinc-500">· {e.source === "auto" ? `auto (${Math.round(e.confiance * 100)} %)` : e.saisi_par || "manuel"}</span>
                                    {e.pj_url && (
                                      <a href={e.pj_url} target="_blank" rel="noopener noreferrer" onClick={ev => ev.stopPropagation()}
                                        title={`Ouvrir le document fournisseur d'origine${e.pj_nom ? ` : ${e.pj_nom}` : ""} (lien signé, valable 4 h — régénéré à chaque ouverture)`}
                                        className="inline-flex max-w-[280px] items-center gap-1 truncate rounded-lg border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-xs text-sky-300 hover:bg-sky-500/20">📄 <span className="truncate">{e.pj_nom || "PDF"}</span></a>
                                    )}
                                    {e.statut_validation === "a_valider" && (
                                      <span className="ml-auto inline-flex gap-1.5">
                                        <button disabled={enCours} onClick={() => action({action: "valider", evenement_id: e.id})} className="rounded-lg border border-emerald-400/40 bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-300 hover:bg-emerald-500/25">✓ Valider</button>
                                        <button disabled={enCours} onClick={() => action({action: "rejeter", evenement_id: e.id})} className="rounded-lg border border-rose-400/40 bg-rose-500/15 px-2 py-0.5 text-xs text-rose-300 hover:bg-rose-500/25">✕ Rejeter</button>
                                      </span>
                                    )}
                                  </div>
                                )})}
                              </div>
                            )}
                          </div>
                          <div className="space-y-3">
                            {(() => {
                              // Toute la commande, groupée par marque — la marque de la
                              // ligne d'abord. Repli : snapshot des articles de la marque.
                              const toutes = lignesCommande[`${l.boutique}|${l.numero_commande}`];
                              if (!toutes) return (
                                <div>
                                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">Articles {l.marque} ({(l.articles || []).length})</div>
                                  <div className="max-h-40 space-y-1 overflow-y-auto text-xs text-zinc-400">
                                    {(l.articles || []).map((a, i) => <div key={i}>{a.qty ?? "?"}× {a.titre || a.sku}</div>)}
                                  </div>
                                </div>
                              );
                              const marques = [l.marque, ...[...new Set(toutes.map(a => a.marque || "à la volée"))].filter(m => m !== l.marque)];
                              return (
                                <div>
                                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">Toute la commande ({toutes.length} article{toutes.length > 1 ? "s" : ""})</div>
                                  <div className="max-h-56 space-y-2 overflow-y-auto text-xs">
                                    {marques.map(m => {
                                      const arts = toutes.filter(a => (a.marque || "à la volée") === m);
                                      if (!arts.length) return null;
                                      return (
                                        <div key={m}>
                                          <div className={`font-semibold ${m === l.marque ? "text-zinc-200" : "text-zinc-500"}`}>{m}{m === l.marque ? " (cette ligne)" : ""}</div>
                                          {arts.map(a => (
                                            <div key={a.position} className="flex flex-wrap items-baseline gap-x-2 text-zinc-400">
                                              <span>{a.qty_commandee}× {a.titre || a.sku}</span>
                                              {a.mode_ligne === "en_stock" ? <span className="text-zinc-500">🏬 en stock</span>
                                                : a.etat === "complete" || a.etat === "excedent" ? <span className="text-emerald-300">✅ reçu{a.derniere_reception ? ` ${fmtDate(a.derniere_reception)}` : ""}</span>
                                                : a.etat === "partielle" ? <span className="text-amber-300">{Number(a.qty_stock_cmd) + Number(a.qty_recue_totale)}/{a.qty_commandee}, reste {a.qty_restante}</span>
                                                : <span className="text-sky-300">⏳ attendu</span>}
                                            </div>
                                          ))}
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            })()}
                            {l.delai_annonce_client && <div className="text-xs text-zinc-400">Délai annoncé au client : <span className="text-zinc-200">{fmtDate(l.delai_annonce_client)}</span></div>}
                            {l.date_reception && <div className="text-xs text-emerald-300">Reçue le {fmtDate(l.date_reception)}</div>}
                            {!l.date_reception && l.date_reception_partielle && <div className="text-xs text-lime-300">Partiellement reçue — dernier arrivage le {fmtDate(l.date_reception_partielle)}</div>}
                            <button onClick={() => rechercheApprofondie(l)}
                              title="Copie la demande dans le presse-papier et ouvre le chat Jardi : colle et envoie."
                              className="w-full rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-sm text-sky-300 transition hover:bg-sky-500/20">
                              🔍 Recherche approfondie (via Jardi)
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              )})}
              {!visibles.length && (
                <tr><td colSpan={13} className="px-4 py-8 text-center text-sm text-zinc-500">Aucune ligne pour ce filtre.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Volets bas : à valider / orphelines / fournisseurs */}
        <div className="flex gap-3 flex-wrap">
          <button onClick={() => setVoletBas(voletBas === "a_valider" ? null : "a_valider")}
            className={`rounded-2xl border px-4 py-2.5 text-sm transition ${voletBas === "a_valider" ? "border-sky-400/50 bg-sky-500/15 text-sky-300" : "border-white/10 bg-[#2a2d31] text-zinc-300 hover:bg-[#34383d]"}`}>
            👁 File à valider ({aValider.length})
          </button>
          <button onClick={() => setVoletBas(voletBas === "orphelines" ? null : "orphelines")}
            className={`rounded-2xl border px-4 py-2.5 text-sm transition ${voletBas === "orphelines" ? "border-purple-400/50 bg-purple-500/15 text-purple-300" : "border-white/10 bg-[#2a2d31] text-zinc-300 hover:bg-[#34383d]"}`}>
            📥 Extractions orphelines ({orphelines.length})
          </button>
          <button onClick={() => setVoletBas(voletBas === "fournisseurs" ? null : "fournisseurs")}
            className={`rounded-2xl border px-4 py-2.5 text-sm transition ${voletBas === "fournisseurs" ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-300" : "border-white/10 bg-[#2a2d31] text-zinc-300 hover:bg-[#34383d]"}`}>
            🏭 Fiches fournisseurs &amp; calibrage
          </button>
        </div>

        {voletBas === "a_valider" && (
          <div className="rounded-2xl border border-white/10 bg-[#2a2d31] p-4">
            <div className="mb-3 text-sm text-zinc-400">Événements posés automatiquement avec une confiance sous le seuil — rien ne modifie le calcul tant que ce n'est pas validé.</div>
            {!aValider.length && <div className="text-sm text-zinc-500">File vide — tout est validé.</div>}
            <div className="space-y-2">
              {aValider.map(e => (
                <div key={e.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-white/5 px-3 py-2 text-sm">
                  <span className="font-medium">{e.suivi_commandes?.numero_commande}</span>
                  <span className="text-zinc-400">{[e.suivi_commandes?.client_nom, e.suivi_commandes?.client_prenom].filter(Boolean).join(" ")}</span>
                  <span className="text-zinc-500">· {e.suivi_commandes?.marque}</span>
                  <span className="inline-flex items-center rounded-full bg-sky-500/15 px-2 py-0.5 text-xs text-sky-300">{TYPES_EVT[e.type] || e.type}</span>
                  <span>{e.semaine_annoncee ? `${e.semaine_annoncee.replace(/^\d{4}-/, "")} · ` : ""}{fmtDateCourte(e.date_depart)}</span>
                  <span className="text-xs text-zinc-500">confiance {Math.round(e.confiance * 100)} %</span>
                  {e.commentaire && <span className="text-xs text-zinc-500 truncate max-w-[300px]" title={e.commentaire}>{e.commentaire}</span>}
                  {e.pj_url && (
                    <a href={e.pj_url} target="_blank" rel="noopener noreferrer"
                      title={`Ouvrir le document fournisseur d'origine${e.pj_nom ? ` : ${e.pj_nom}` : ""} (lien signé, valable 4 h)`}
                      className="inline-flex max-w-[240px] items-center gap-1 truncate rounded-lg border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-xs text-sky-300 hover:bg-sky-500/20">📄 <span className="truncate">{e.pj_nom || "PDF"}</span></a>
                  )}
                  <span className="ml-auto inline-flex gap-1.5">
                    <button disabled={enCours} onClick={() => action({action: "valider", evenement_id: e.id})} className="rounded-lg border border-emerald-400/40 bg-emerald-500/15 px-2.5 py-1 text-xs text-emerald-300 hover:bg-emerald-500/25">✓ Valider</button>
                    <button disabled={enCours} onClick={() => action({action: "rejeter", evenement_id: e.id})} className="rounded-lg border border-rose-400/40 bg-rose-500/15 px-2.5 py-1 text-xs text-rose-300 hover:bg-rose-500/25">✕ Rejeter</button>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {voletBas === "orphelines" && (
          <div className="rounded-2xl border border-white/10 bg-[#2a2d31] p-4">
            <div className="mb-3 text-sm text-zinc-400">Documents fournisseurs extraits mais non rapprochés à une commande suivie (clients hors suivi, ambiguïtés) — rien n'est jamais jeté en silence. « Traitée » = pris en charge à la main ; « Ignorer » = sans objet (commande déjà livrée, canal non suivi…).</div>
            {!orphelines.length && <div className="text-sm text-zinc-500">Aucune orpheline à traiter.</div>}
            <div className="space-y-2">
              {orphelines.map(o => (
                <div key={o.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-white/5 px-3 py-2 text-sm">
                  <span className="text-xs text-zinc-500 w-20">{fmtDate(o.date_mail)}</span>
                  <span className="text-zinc-500 text-xs">{o.marque || "?"} · {o.type_document || "?"}</span>
                  <span className="truncate max-w-[420px]" title={o.sujet || ""}>{o.sujet}</span>
                  {o.raison && <span className="text-xs text-amber-300/80 truncate max-w-[300px]" title={o.raison}>{o.raison}</span>}
                  <span className="ml-auto inline-flex gap-1.5">
                    <button disabled={enCours} onClick={() => action({action: "orpheline_traitee", orpheline_id: o.id})} className="rounded-lg border border-emerald-400/40 bg-emerald-500/15 px-2.5 py-1 text-xs text-emerald-300 hover:bg-emerald-500/25">✓ Traitée</button>
                    <button disabled={enCours} onClick={() => action({action: "orpheline_ignoree", orpheline_id: o.id})} className="rounded-lg border border-white/10 px-2.5 py-1 text-xs text-zinc-400 hover:bg-[#34383d]">Ignorer</button>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {voletBas === "fournisseurs" && (
          <div className="grid gap-3 md:grid-cols-3">
            {fournisseurs.map(f => {
              const cal = calibrage.find(c => c.marque === f.marque);
              return (
                <div key={f.marque} className="rounded-2xl border border-white/10 bg-[#2a2d31] p-4">
                  <div className="text-lg font-semibold">{f.marque}</div>
                  <div className="mt-1 text-sm text-zinc-400">
                    {f.transit_regle && (f.transit_regle as {arrivage?: string}).arrivage === "jeudi_semaine_suivante"
                      ? "Départ le vendredi de la semaine annoncée → arrivage le jeudi suivant"
                      : `Arrivage = départ + ${(f.transit_regle as {jours_ouvres?: number})?.jours_ouvres ?? "?"} jours ouvrés`}
                  </div>
                  <div className="mt-2 text-xs text-zinc-500">Seuils : échéance {f.seuil_echeance_jours} j · délai manquant {f.seuil_delai_manquant_jours_ouvres} j ouvrés</div>
                  <div className="mt-3 border-t border-white/5 pt-3 text-sm">
                    {cal && cal.nb_observations > 0 ? (
                      <>
                        <div className="text-zinc-300">Calibrage réel : écart médian <span className={`font-semibold ${Number(cal.ecart_median_jours) > 0 ? "text-rose-300" : "text-emerald-300"}`}>{Number(cal.ecart_median_jours) > 0 ? "+" : ""}{cal.ecart_median_jours} j</span> sur {cal.nb_observations} réception(s)</div>
                        <div className="mt-1 text-xs text-zinc-500">moyenne {cal.ecart_moyen_jours} j · min {cal.ecart_min_jours} · max {cal.ecart_max_jours} — positif = règle optimiste, négatif = règle large. La règle ne s'ajuste jamais toute seule.</div>
                      </>
                    ) : (
                      <div className="text-xs text-zinc-500">Pas encore de calibrage — il se construit à chaque réception complète saisie sur la page Arrivages.</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

      </div>
    </main>
  );
}
