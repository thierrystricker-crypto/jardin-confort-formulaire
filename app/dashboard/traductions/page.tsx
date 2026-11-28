"use client";
// app/dashboard/traductions/page.tsx
// Sentinelle traductions DE / EN du webshop (28.11.2026).
//
// Chaque nuit, /api/cron/traductions-sentinelle relit ce que l'app T Lab a
// retraduit, corrige elle-même les erreurs mécaniques (si
// TRADUCTIONS_AUTO_CORRECTION=1) et range ici ce qui demande une décision.
//
// La page a deux parties :
//   ① « À valider » — les anomalies que la machine ne corrige pas seule.
//      « Appliquer » écrit la correction dans Shopify ; « Proposer une
//      correction » demande à Claude le remplacement exact (aperçu avant
//      d'appliquer) ; « Marquer corrigé / Ignorer / Faux positif » ne
//      changent que le statut, PAS Shopify.
//   ② « Correction unique du catalogue » — le rattrapage des règles sûres
//      sur toutes les fiches existantes, à faire une fois par type.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import RetourDashboard from "@/components/RetourDashboard";

type Statut = "nouveau" | "corrige" | "ignore" | "faux_positif";
type Onglet = Statut | "tous";

type Controle = {
  id: string;
  created_at: string;
  ressource_type: "produit" | "collection";
  ressource_id: string;
  handle: string | null;
  marque: string | null;
  langue: "de" | "en";
  champ: string;
  regle: string;
  source: "regle" | "claude";
  extrait: string | null;
  correction_proposee: string | null;
  auto_corrigeable: boolean;
  statut: Statut;
  traduction_maj_at: string | null;
  traite_at: string | null;
};

type Run = {
  id: string;
  started_at: string;
  finished_at: string | null;
  nb_ressources: number | null;
  nb_anomalies: number | null;
  nb_relues_claude: number | null;
  notes: string | null;
  erreur: string | null;
};

type Proposition =
  | { etat: "chargement" }
  | { etat: "ok"; extrait: string; correction: string }
  | { etat: "aucune"; raison: string }
  | { etat: "erreur"; message: string };

type Rattrapage = {
  lots: number; lues: number; champs: number; ecrits: number;
  parRegle: Record<string, number>;
  exemples: Array<{ handle: string; langue: string; champ: string; regles: string[] }>;
  erreurs: string[]; enCours: boolean; termine: boolean; ecrire: boolean;
};

const ONGLETS: Array<[Onglet, string]> = [
  ["nouveau", "À valider"],
  ["corrige", "Corrigé"],
  ["ignore", "Ignoré"],
  ["faux_positif", "Faux positif"],
  ["tous", "Tous"],
];

const LIBELLES_REGLES: Record<string, string> = {
  eszett: "ß au lieu de ss",
  sthul: "Sthul",
  bodenhuelsel: "Bodenhülsel",
  keramik_en: "Keramik en anglais",
  available_to_order: "available to order",
  pouf_sitzsack: "Pouf traduit en sac",
  mot_francais: "Mot resté en français",
  texte_francais: "Passage resté en français",
  mots_colles: "Mots collés",
  mots_doubles: "Mots doublés",
  marque_perdue: "Marque perdue",
  nom_collection_perdu: "Nom de collection perdu",
  titre_reduit_marque: "Titre réduit à la marque",
  titre_non_traduit: "Titre non traduit",
  meta_titre_long: "Meta titre trop long",
  bloc_css: "Bloc CSS",
};

const LIBELLES_CHAMPS: Record<string, string> = {
  title: "Titre",
  body_html: "Description",
  meta_title: "Meta titre",
  meta_description: "Meta description",
};

const MARQUES_SUIVIES = ["Fermob", "Glatz", "Suncomfort", "Fatboy", "Schaffner"];

function libelleRegle(r: string) {
  if (LIBELLES_REGLES[r]) return LIBELLES_REGLES[r];
  if (r.startsWith("claude_")) return "Claude · " + r.slice(7).replace(/_/g, " ");
  return r;
}

function fmtDateHeure(iso: string) {
  return new Date(iso).toLocaleString("fr-CH", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function msg(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

function numeroShopify(gid: string) {
  return gid.split("/").pop() || "";
}

/** Ce que le bouton principal d'une ligne peut faire. */
function actionLigne(c: Controle): "appliquer" | "proposer" | null {
  if (c.statut !== "nouveau") return null;
  if ((c.source === "claude" && c.correction_proposee) || c.auto_corrigeable) return "appliquer";
  if (c.source === "regle" && c.regle !== "bloc_css") return "proposer";
  return null;
}

export default function TraductionsPage() {
  const [onglet, setOnglet] = useState<Onglet>("nouveau");
  const [langue, setLangue] = useState("");
  const [source, setSource] = useState("");
  const [regle, setRegle] = useState("");
  const [marque, setMarque] = useState("");
  const [controles, setControles] = useState<Controle[]>([]);
  const [compteurs, setCompteurs] = useState<Record<string, number>>({});
  const [runs, setRuns] = useState<Run[]>([]);
  const [rattrapagesFaits, setRattrapagesFaits] = useState<Record<string, { at: string; notes: string | null } | null>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [propositions, setPropositions] = useState<Record<string, Proposition>>({});
  const [heures, setHeures] = useState(26);
  const [lancement, setLancement] = useState("");
  const [typeRattrapage, setTypeRattrapage] = useState<"produit" | "collection">("produit");
  const [rattrapage, setRattrapage] = useState<Rattrapage | null>(null);
  const stopRattrapage = useRef(false);

  const charger = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const p = new URLSearchParams({ statut: onglet });
      if (langue) p.set("langue", langue);
      if (source) p.set("source", source);
      if (regle) p.set("regle", regle);
      if (marque) p.set("marque", marque);
      const res = await fetch(`/api/traductions?${p.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Erreur ${res.status}`);
      setControles(json.controles || []);
      setCompteurs(json.compteurs || {});
      setRuns(json.runs || []);
      setRattrapagesFaits(json.rattrapages || {});
      setSelection(new Set());
    } catch (e) { setError(msg(e)); } finally { setLoading(false); }
  }, [onglet, langue, source, regle, marque]);
  useEffect(() => { charger(); }, [charger]);

  const reglesPresentes = useMemo(
    () => Array.from(new Set(controles.map((c) => c.regle))).sort(),
    [controles]
  );

  async function changerStatut(ids: string[], statut: Statut) {
    if (!ids.length) return;
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/traductions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, statut }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Erreur ${res.status}`);
      await charger();
    } catch (e) { setError(msg(e)); } finally { setBusy(false); }
  }

  async function appliquer(id: string, remplacement?: { extrait: string; correction: string }) {
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/traductions/appliquer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...(remplacement ?? {}) }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Erreur ${res.status}`);
      setPropositions((p) => { const n = { ...p }; delete n[id]; return n; });
      await charger();
    } catch (e) { setError(msg(e)); } finally { setBusy(false); }
  }

  async function proposer(id: string) {
    setPropositions((p) => ({ ...p, [id]: { etat: "chargement" } }));
    try {
      const res = await fetch("/api/traductions/proposer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Erreur ${res.status}`);
      setPropositions((p) => ({
        ...p,
        [id]: json.aucune
          ? { etat: "aucune", raison: json.raison || "" }
          : { etat: "ok", extrait: json.extrait, correction: json.correction },
      }));
    } catch (e) {
      setPropositions((p) => ({ ...p, [id]: { etat: "erreur", message: msg(e) } }));
    }
  }

  async function lancer() {
    setBusy(true); setError(""); setLancement("Contrôle en cours… (jusqu'à 5 minutes)");
    try {
      const res = await fetch("/api/traductions/lancer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ heures }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Erreur ${res.status}`);
      setLancement(
        `Terminé : ${json.ressources_retraduites} fiche(s) retraduite(s) par T Lab, ` +
        `${json.relues_claude} relue(s) par Claude, ${json.champs_corriges ?? 0} champ(s) corrigé(s) automatiquement, ` +
        `${json.anomalies_nouvelles} nouvelle(s) anomalie(s).`
      );
      await charger();
    } catch (e) { setLancement(""); setError(msg(e)); } finally { setBusy(false); }
  }

  async function lancerRattrapage(ecrire: boolean) {
    const libelle = typeRattrapage === "produit" ? "TOUS les produits" : "TOUTES les collections";
    if (ecrire && !confirm(`Corriger maintenant dans Shopify ${libelle} (ß → ss, Sthul, Bodenhülsel, Keramik, available to order, pouf hors Fatboy) ?`)) return;
    stopRattrapage.current = false;
    setError("");
    let etat: Rattrapage = { lots: 0, lues: 0, champs: 0, ecrits: 0, parRegle: {}, exemples: [], erreurs: [], enCours: true, termine: false, ecrire };
    setRattrapage(etat);
    let apres: string | null = null;
    try {
      do {
        const res: Response = await fetch("/api/traductions/rattrapage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: typeRattrapage, apres, taille: 100, ecrire }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `Erreur ${res.status}`);
        const parRegle = { ...etat.parRegle };
        for (const [k, v] of Object.entries(json.par_regle as Record<string, number>)) parRegle[k] = (parRegle[k] ?? 0) + v;
        etat = {
          ...etat,
          lots: etat.lots + 1,
          lues: etat.lues + json.lues,
          champs: etat.champs + json.champs,
          ecrits: etat.ecrits + json.ecrits,
          parRegle,
          exemples: [...etat.exemples, ...json.exemples].slice(0, 12),
          erreurs: [...etat.erreurs, ...json.erreurs].slice(0, 20),
        };
        setRattrapage(etat);
        apres = json.suivant;
        if ((json.erreurs as string[]).some((x) => x.includes("write_translations"))) break;
      } while (apres && !stopRattrapage.current);
      setRattrapage({ ...etat, enCours: false, termine: !apres });
      if (ecrire) await charger();
    } catch (e) {
      setRattrapage({ ...etat, enCours: false });
      setError(msg(e));
    }
  }

  function basculer(id: string) {
    setSelection((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  const selectionIds = Array.from(selection);
  const dernier = runs[0];
  const classeSelect = "rounded-lg border border-white/10 bg-[#2a2d31] px-2 py-1.5 text-xs text-zinc-200";
  const classeBouton = "rounded-lg border border-white/10 bg-[#34383d] px-3 py-1.5 text-xs text-zinc-200 hover:bg-[#40454b] disabled:opacity-50";
  const classeVert = "rounded-lg border border-emerald-500/40 bg-emerald-500/20 px-3 py-1.5 text-xs font-medium text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-50";
  const classeViolet = "rounded-lg border border-violet-500/40 bg-violet-500/15 px-3 py-1.5 text-xs font-medium text-violet-200 hover:bg-violet-500/25 disabled:opacity-50";

  return (
    <main className="min-h-screen bg-[#1f2125]">
      <div className="mx-auto max-w-6xl px-4 py-8 text-zinc-100">
        <RetourDashboard />

        {/* En-tête */}
        <div className="mb-4">
          <h1 className="text-2xl font-semibold">🌐 Sentinelle traductions DE / EN</h1>
          <p className="mt-1 max-w-3xl text-sm text-zinc-400">
            Chaque nuit, la sentinelle relit ce que T Lab a retraduit sur jardin-confort.ch.
            Elle <strong className="text-zinc-300">corrige elle-même</strong> les erreurs mécaniques (ß → ss, available to order…)
            et te laisse ici <strong className="text-zinc-300">ce qui demande ta décision</strong>.
          </p>
        </div>

        {/* Dernier passage */}
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-[#2a2d31] px-4 py-3 text-sm">
          <div className="text-zinc-300">
            {dernier ? (
              <>
                Dernier contrôle : <strong>{fmtDateHeure(dernier.started_at)}</strong>
                {dernier.erreur ? <span className="ml-2 text-rose-300">⚠️ en erreur : {dernier.erreur}</span>
                  : dernier.finished_at ? <span className="ml-2 text-zinc-500">· {dernier.nb_ressources ?? 0} fiche(s) retraduite(s) contrôlée(s) · {dernier.nb_anomalies ?? 0} anomalie(s) relevée(s)</span>
                  : <span className="ml-2 text-amber-300">en cours…</span>}
                {dernier.notes && <div className="mt-0.5 text-xs text-zinc-500">{dernier.notes}</div>}
              </>
            ) : "Aucun contrôle encore."}
          </div>
          <div className="ml-auto flex items-center gap-2 text-xs">
            <label className="text-zinc-400">
              Contrôler les
              <input
                type="number" min={1} max={720} value={heures}
                onChange={(e) => setHeures(Number(e.target.value) || 26)}
                className="mx-1 w-16 rounded-lg border border-white/10 bg-[#1f2125] px-2 py-1.5 text-zinc-200"
              />
              dernières heures
            </label>
            <button type="button" disabled={busy} onClick={lancer}
              className="rounded-lg border border-sky-500/40 bg-sky-500/20 px-3 py-1.5 font-medium text-sky-200 hover:bg-sky-500/30 disabled:opacity-50">
              Lancer maintenant
            </button>
          </div>
        </div>

        {lancement && <div className="mb-4 rounded-xl border border-sky-500/20 bg-sky-500/10 px-4 py-3 text-sm text-sky-200">{lancement}</div>}
        {error && <div className="mb-4 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>}

        {/* ① À valider */}
        <h2 className="mb-1 text-lg font-semibold">① À valider</h2>
        <p className="mb-3 max-w-3xl text-xs text-zinc-400">
          <strong className="text-emerald-300">Appliquer</strong> écrit la correction dans Shopify.
          {" "}<strong className="text-violet-300">Proposer une correction</strong> demande à Claude le remplacement exact : tu vois l&apos;avant / après, puis tu appliques.
          {" "}<strong className="text-zinc-300">Marquer corrigé · Ignorer · Faux positif</strong> ne changent que le statut dans cette liste, pas Shopify
          (un faux positif ne revient plus).
        </p>

        {/* Onglets + filtres */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {ONGLETS.map(([cle, libelle]) => (
            <button key={cle} type="button" onClick={() => setOnglet(cle)}
              className={`rounded-full border px-3 py-1 text-sm transition ${onglet === cle ? "border-sky-400 bg-sky-500/20 text-sky-200" : "border-white/10 bg-white/5 text-zinc-400 hover:text-zinc-200"}`}>
              {libelle} {cle !== "tous" && <span className="text-xs opacity-60">{compteurs[cle] ?? 0}</span>}
            </button>
          ))}
          <div className="ml-auto flex flex-wrap gap-2">
            <select value={langue} onChange={(e) => setLangue(e.target.value)} className={classeSelect}>
              <option value="">DE + EN</option>
              <option value="de">DE</option>
              <option value="en">EN</option>
            </select>
            <select value={marque} onChange={(e) => setMarque(e.target.value)} className={classeSelect}>
              <option value="">Toutes les marques</option>
              {MARQUES_SUIVIES.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <select value={source} onChange={(e) => setSource(e.target.value)} className={classeSelect}>
              <option value="">Règles + Claude</option>
              <option value="regle">Règles fixes</option>
              <option value="claude">Claude</option>
            </select>
            <select value={regle} onChange={(e) => setRegle(e.target.value)} className={classeSelect}>
              <option value="">Toutes les règles</option>
              {(regle && !reglesPresentes.includes(regle) ? [...reglesPresentes, regle] : reglesPresentes).map((r) => (
                <option key={r} value={r}>{libelleRegle(r)}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Actions groupées : statut seulement */}
        {selectionIds.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-2 text-xs">
            <span className="text-zinc-300">{selectionIds.length} sélectionnée(s) — changer le statut <strong>(ne modifie pas Shopify)</strong> :</span>
            <button type="button" disabled={busy} onClick={() => changerStatut(selectionIds, "corrige")} className={classeBouton}>Marquer corrigé</button>
            <button type="button" disabled={busy} onClick={() => changerStatut(selectionIds, "ignore")} className={classeBouton}>Ignorer</button>
            <button type="button" disabled={busy} onClick={() => changerStatut(selectionIds, "faux_positif")} className={classeBouton}>Faux positif</button>
            <button type="button" onClick={() => setSelection(new Set())} className="ml-auto text-zinc-400 hover:text-zinc-200">Désélectionner</button>
          </div>
        )}

        {loading ? (
          <div className="rounded-2xl border border-white/10 bg-[#2a2d31] p-8 text-center text-zinc-400">Chargement…</div>
        ) : controles.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-[#2a2d31] p-8 text-center text-zinc-400">
            {onglet === "nouveau" ? "✅ Rien à valider." : "Aucune ligne ici."}
          </div>
        ) : (
          <div className="space-y-2">
            {controles.length >= 500 && (
              <div className="text-xs text-amber-300">Affichage limité aux 500 plus récentes : filtre par règle ou par langue pour voir le reste.</div>
            )}
            <label className="flex items-center gap-2 px-1 text-xs text-zinc-400">
              <input type="checkbox"
                checked={selection.size === controles.length}
                onChange={(e) => setSelection(e.target.checked ? new Set(controles.map((c) => c.id)) : new Set())} />
              Tout sélectionner (pour changer le statut)
            </label>
            {controles.map((c) => {
              const num = numeroShopify(c.ressource_id);
              const chemin = c.ressource_type === "produit" ? "products" : "collections";
              const action = actionLigne(c);
              const prop = propositions[c.id];
              return (
                <div key={c.id} className="rounded-2xl border border-white/10 bg-[#2a2d31] px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <input type="checkbox" checked={selection.has(c.id)} onChange={() => basculer(c.id)} />
                    <span className={`rounded-md px-1.5 py-0.5 font-semibold ${c.langue === "de" ? "bg-amber-500/20 text-amber-200" : "bg-indigo-500/20 text-indigo-200"}`}>{c.langue.toUpperCase()}</span>
                    <span className="rounded-md bg-white/5 px-1.5 py-0.5 text-zinc-300">{LIBELLES_CHAMPS[c.champ] ?? c.champ}</span>
                    <span className={`rounded-md px-1.5 py-0.5 ${c.source === "claude" ? "bg-violet-500/20 text-violet-200" : "bg-sky-500/15 text-sky-200"}`}>{libelleRegle(c.regle)}</span>
                    <span className="text-zinc-400">{c.marque ? `${c.marque} · ` : ""}{c.handle}</span>
                    <span className="ml-auto text-zinc-500">{fmtDateHeure(c.created_at)}</span>
                  </div>
                  {c.extrait && <div className="mt-2 rounded-lg bg-black/20 px-3 py-2 text-sm text-zinc-200">{c.extrait}</div>}
                  {c.correction_proposee && <div className="mt-1 text-sm text-emerald-200">→ {c.correction_proposee}</div>}

                  {/* Aperçu d'une correction proposée à la demande */}
                  {prop && (
                    <div className="mt-2 rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-sm">
                      {prop.etat === "chargement" && <span className="text-violet-200">Claude prépare une correction…</span>}
                      {prop.etat === "erreur" && <span className="text-rose-300">{prop.message}</span>}
                      {prop.etat === "aucune" && (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-violet-200">Pour Claude, ce n&apos;est pas une erreur{prop.raison ? ` : ${prop.raison}` : "."}</span>
                          <button type="button" disabled={busy} onClick={() => changerStatut([c.id], "faux_positif")} className={classeBouton}>Marquer faux positif</button>
                        </div>
                      )}
                      {prop.etat === "ok" && (
                        <div className="space-y-1">
                          <div><span className="text-xs text-zinc-400">Avant :</span> <span className="text-rose-200 line-through decoration-rose-400/50">{prop.extrait}</span></div>
                          <div><span className="text-xs text-zinc-400">Après :</span> <span className="text-emerald-200">{prop.correction}</span></div>
                          <div className="flex gap-2 pt-1">
                            <button type="button" disabled={busy} onClick={() => appliquer(c.id, { extrait: prop.extrait, correction: prop.correction })} className={classeVert}>Appliquer cette correction</button>
                            <button type="button" onClick={() => setPropositions((p) => { const n = { ...p }; delete n[c.id]; return n; })} className="text-xs text-zinc-400 hover:text-zinc-200">Annuler</button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    <a href={`https://admin.shopify.com/store/le-meuble/${chemin}/${num}`} target="_blank" rel="noopener noreferrer" className="text-sky-300 hover:underline">Admin Shopify</a>
                    {c.handle && (
                      <a href={`https://www.jardin-confort.ch/${c.langue}/${chemin}/${c.handle}`} target="_blank" rel="noopener noreferrer" className="text-sky-300 hover:underline">Page {c.langue.toUpperCase()} en ligne</a>
                    )}
                    <div className="ml-auto flex flex-wrap gap-2">
                      {action === "appliquer" && (
                        <button type="button" disabled={busy} onClick={() => appliquer(c.id)} title="Écrit la correction dans Shopify" className={classeVert}>Appliquer</button>
                      )}
                      {action === "proposer" && !prop && (
                        <button type="button" disabled={busy} onClick={() => proposer(c.id)} title="Claude propose le remplacement exact ; rien n'est écrit avant ton clic" className={classeViolet}>Proposer une correction</button>
                      )}
                      {c.statut !== "nouveau" && <button type="button" disabled={busy} onClick={() => changerStatut([c.id], "nouveau")} className={classeBouton}>Rouvrir</button>}
                      {c.statut !== "corrige" && <button type="button" disabled={busy} onClick={() => changerStatut([c.id], "corrige")} title="Corrigé à la main ailleurs (T Lab, admin Shopify) : ne modifie pas Shopify" className={classeBouton}>Marquer corrigé</button>}
                      {c.statut !== "ignore" && <button type="button" disabled={busy} onClick={() => changerStatut([c.id], "ignore")} className={classeBouton}>Ignorer</button>}
                      {c.statut !== "faux_positif" && <button type="button" disabled={busy} onClick={() => changerStatut([c.id], "faux_positif")} className={classeBouton}>Faux positif</button>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ② Correction unique du catalogue */}
        <details className="mt-10 rounded-2xl border border-white/10 bg-[#2a2d31] px-4 py-3 text-sm">
          <summary className="cursor-pointer">
            <span className="text-lg font-semibold text-zinc-100">② Correction unique du catalogue</span>
            <span className="ml-2 text-xs text-zinc-500">
              Produits : {rattrapagesFaits.produit ? `fait le ${fmtDateHeure(rattrapagesFaits.produit.at)}` : "pas encore fait"}
              {" · "}Collections : {rattrapagesFaits.collection ? `fait le ${fmtDateHeure(rattrapagesFaits.collection.at)}` : "pas encore fait"}
            </span>
          </summary>
          <div className="mt-3 space-y-3 text-xs">
            <p className="text-zinc-400">
              <strong className="text-zinc-300">À faire une seule fois par type.</strong> Le dico T Lab ne retraduit pas les fiches déjà en ligne :
              cette correction passe sur <strong className="text-zinc-300">toutes</strong> les fiches du type choisi et corrige directement dans Shopify,
              sans IA : ß → ss, Sthul → Stuhl, Bodenhülsel → Bodenhülse, Keramik → ceramic (EN), available to order → made to order (EN),
              Sitzsack / bean bag → Pouf / pouf (produits hors Fatboy). Elle n&apos;a rien à voir avec les cases à cocher de la liste ① :
              elle passe ensuite en « Corrigé » les lignes qu&apos;elle a réglées. Après, c&apos;est la sentinelle qui s&apos;en charge chaque nuit.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <select value={typeRattrapage} onChange={(e) => setTypeRattrapage(e.target.value as "produit" | "collection")} disabled={rattrapage?.enCours} className={classeSelect}>
                <option value="produit">Tous les produits</option>
                <option value="collection">Toutes les collections</option>
              </select>
              <button type="button" disabled={rattrapage?.enCours || busy} onClick={() => lancerRattrapage(false)} className={classeBouton}>Simuler (n&apos;écrit rien)</button>
              <button type="button" disabled={rattrapage?.enCours || busy} onClick={() => lancerRattrapage(true)} className={classeVert}>Corriger dans Shopify</button>
              {rattrapage?.enCours && (
                <button type="button" onClick={() => { stopRattrapage.current = true; }} className="text-zinc-400 hover:text-rose-300">Arrêter après ce lot</button>
              )}
            </div>
            {rattrapage && (
              <div className="rounded-lg bg-black/20 px-3 py-2 text-zinc-300">
                <div>
                  {rattrapage.enCours ? "⏳ En cours… " : rattrapage.termine ? "✅ Terminé. " : "⏸ Arrêté. "}
                  {rattrapage.lues} fiche(s) lue(s) ·{" "}
                  {rattrapage.ecrire
                    ? `${rattrapage.ecrits} champ(s) corrigé(s) dans Shopify`
                    : `${rattrapage.champs} champ(s) seraient corrigés`}
                  {rattrapage.termine && rattrapage.champs === 0 && " — tout est déjà propre sur ces règles."}
                </div>
                {Object.keys(rattrapage.parRegle).length > 0 && (
                  <div className="mt-1 text-zinc-400">
                    {Object.entries(rattrapage.parRegle).map(([k, v]) => `${libelleRegle(k)} : ${v}`).join(" · ")}
                  </div>
                )}
                {rattrapage.exemples.length > 0 && (
                  <div className="mt-1 text-zinc-500">
                    Exemples : {rattrapage.exemples.slice(0, 6).map((x) => `${x.handle} (${x.langue.toUpperCase()} ${LIBELLES_CHAMPS[x.champ] ?? x.champ})`).join(", ")}
                  </div>
                )}
                {rattrapage.erreurs.length > 0 && (
                  <div className="mt-1 text-rose-300">{rattrapage.erreurs.slice(0, 5).join(" · ")}</div>
                )}
              </div>
            )}
          </div>
        </details>

        {/* Historique des contrôles */}
        {runs.length > 1 && (
          <details className="mt-4 rounded-2xl border border-white/10 bg-[#2a2d31] px-4 py-3 text-sm">
            <summary className="cursor-pointer text-zinc-300">Historique des contrôles</summary>
            <div className="mt-3 space-y-2">
              {runs.map((r) => (
                <div key={r.id} className="border-t border-white/5 pt-2 text-xs">
                  <div className="text-zinc-300">{fmtDateHeure(r.started_at)}{r.finished_at ? "" : " · en cours"}</div>
                  {r.notes && <div className="text-zinc-500">{r.notes}</div>}
                  {r.erreur && <div className="text-rose-300">{r.erreur}</div>}
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </main>
  );
}
