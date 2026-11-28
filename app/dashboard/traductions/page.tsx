"use client";
// app/dashboard/traductions/page.tsx
// Sentinelle traductions DE / EN du webshop (28.11.2026).
//
// Chaque nuit, /api/cron/traductions-sentinelle relit ce que l'app T Lab a
// retraduit et range ici les anomalies (règles fixes + relecture Claude).
// Ici : trier, ouvrir la fiche (admin Shopify / page en ligne), marquer
// corrigé / ignoré / faux positif (un faux positif ne revient plus), et lancer
// un contrôle à la main. Phase 1 = rapport seul : rien n'est écrit dans Shopify.

import React, { useCallback, useEffect, useMemo, useState } from "react";
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

const ONGLETS: Array<[Onglet, string]> = [
  ["nouveau", "À traiter"],
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

function libelleRegle(r: string) {
  if (LIBELLES_REGLES[r]) return LIBELLES_REGLES[r];
  if (r.startsWith("claude_")) return "Claude · " + r.slice(7).replace(/_/g, " ");
  return r;
}

function fmtDateHeure(iso: string) {
  return new Date(iso).toLocaleString("fr-CH", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function numeroShopify(gid: string) {
  return gid.split("/").pop() || "";
}

export default function TraductionsPage() {
  const [onglet, setOnglet] = useState<Onglet>("nouveau");
  const [langue, setLangue] = useState("");
  const [source, setSource] = useState("");
  const [regle, setRegle] = useState("");
  const [controles, setControles] = useState<Controle[]>([]);
  const [compteurs, setCompteurs] = useState<Record<string, number>>({});
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [heures, setHeures] = useState(26);
  const [lancement, setLancement] = useState("");

  const charger = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const p = new URLSearchParams({ statut: onglet });
      if (langue) p.set("langue", langue);
      if (source) p.set("source", source);
      if (regle) p.set("regle", regle);
      const res = await fetch(`/api/traductions?${p.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Erreur ${res.status}`);
      setControles(json.controles || []);
      setCompteurs(json.compteurs || {});
      setRuns(json.runs || []);
      setSelection(new Set());
    } catch (e) { setError(String(e)); } finally { setLoading(false); }
  }, [onglet, langue, source, regle]);
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
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
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
        `Terminé : ${json.ressources_retraduites} fiche(s) retraduite(s) sur ${json.ressources_modifiees} modifiée(s), ` +
        `${json.relues_claude} relue(s) par Claude, ${json.anomalies_nouvelles} nouvelle(s) anomalie(s).`
      );
      await charger();
    } catch (e) { setLancement(""); setError(String(e)); } finally { setBusy(false); }
  }

  function basculer(id: string) {
    setSelection((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  const selectionIds = Array.from(selection);
  const classeSelect = "rounded-lg border border-white/10 bg-[#2a2d31] px-2 py-1.5 text-xs text-zinc-200";
  const classeBouton = "rounded-lg border border-white/10 bg-[#34383d] px-3 py-1.5 text-xs text-zinc-200 hover:bg-[#40454b] disabled:opacity-50";

  return (
    <main className="min-h-screen bg-[#1f2125]">
      <div className="mx-auto max-w-6xl px-4 py-8 text-zinc-100">
        <RetourDashboard />

        <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold">🌐 Sentinelle traductions DE / EN</h1>
            <p className="mt-1 max-w-3xl text-sm text-zinc-400">
              Chaque nuit, ce que T Lab a retraduit sur jardin-confort.ch est relu (règles fixes + Claude).
              Rapport seul pour l&apos;instant : rien n&apos;est corrigé automatiquement dans Shopify.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <label className="text-zinc-400">
              Dernières
              <input
                type="number" min={1} max={720} value={heures}
                onChange={(e) => setHeures(Number(e.target.value) || 26)}
                className="mx-1 w-16 rounded-lg border border-white/10 bg-[#2a2d31] px-2 py-1.5 text-zinc-200"
              />
              h
            </label>
            <button type="button" disabled={busy} onClick={lancer}
              className="rounded-lg border border-sky-500/40 bg-sky-500/20 px-3 py-1.5 font-medium text-sky-200 hover:bg-sky-500/30 disabled:opacity-50">
              Lancer un contrôle
            </button>
          </div>
        </div>

        {lancement && <div className="mb-4 rounded-xl border border-sky-500/20 bg-sky-500/10 px-4 py-3 text-sm text-sky-200">{lancement}</div>}
        {error && <div className="mb-4 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>}

        {/* Derniers passages */}
        {runs.length > 0 && (
          <details className="mb-6 rounded-2xl border border-white/10 bg-[#2a2d31] px-4 py-3 text-sm">
            <summary className="cursor-pointer text-zinc-300">
              Dernier passage : {fmtDateHeure(runs[0].started_at)}
              {runs[0].erreur ? <span className="ml-2 text-rose-300">⚠️ en erreur</span>
                : runs[0].finished_at ? <span className="ml-2 text-zinc-500">· {runs[0].nb_ressources ?? 0} fiche(s) contrôlée(s) · {runs[0].nb_anomalies ?? 0} nouvelle(s) anomalie(s)</span>
                : <span className="ml-2 text-amber-300">en cours…</span>}
            </summary>
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

        {/* Actions groupées */}
        {selectionIds.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-[#2a2d31] px-4 py-2 text-xs">
            <span className="text-zinc-300">{selectionIds.length} sélectionnée(s)</span>
            <button type="button" disabled={busy} onClick={() => changerStatut(selectionIds, "corrige")} className={classeBouton}>✓ Corrigé</button>
            <button type="button" disabled={busy} onClick={() => changerStatut(selectionIds, "ignore")} className={classeBouton}>Ignorer</button>
            <button type="button" disabled={busy} onClick={() => changerStatut(selectionIds, "faux_positif")} className={classeBouton}>Faux positif</button>
            <button type="button" onClick={() => setSelection(new Set())} className="ml-auto text-zinc-400 hover:text-zinc-200">Désélectionner</button>
          </div>
        )}

        {loading ? (
          <div className="rounded-2xl border border-white/10 bg-[#2a2d31] p-8 text-center text-zinc-400">Chargement…</div>
        ) : controles.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-[#2a2d31] p-8 text-center text-zinc-400">Aucune anomalie ici.</div>
        ) : (
          <div className="space-y-2">
            {controles.length >= 500 && (
              <div className="text-xs text-amber-300">Affichage limité aux 500 plus récentes : filtre par règle ou par langue pour voir le reste.</div>
            )}
            <label className="flex items-center gap-2 px-1 text-xs text-zinc-400">
              <input type="checkbox"
                checked={selection.size === controles.length}
                onChange={(e) => setSelection(e.target.checked ? new Set(controles.map((c) => c.id)) : new Set())} />
              Tout sélectionner
            </label>
            {controles.map((c) => {
              const num = numeroShopify(c.ressource_id);
              const chemin = c.ressource_type === "produit" ? "products" : "collections";
              return (
                <div key={c.id} className="rounded-2xl border border-white/10 bg-[#2a2d31] px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <input type="checkbox" checked={selection.has(c.id)} onChange={() => basculer(c.id)} />
                    <span className={`rounded-md px-1.5 py-0.5 font-semibold ${c.langue === "de" ? "bg-amber-500/20 text-amber-200" : "bg-indigo-500/20 text-indigo-200"}`}>{c.langue.toUpperCase()}</span>
                    <span className="rounded-md bg-white/5 px-1.5 py-0.5 text-zinc-300">{LIBELLES_CHAMPS[c.champ] ?? c.champ}</span>
                    <span className={`rounded-md px-1.5 py-0.5 ${c.source === "claude" ? "bg-violet-500/20 text-violet-200" : "bg-sky-500/15 text-sky-200"}`}>{libelleRegle(c.regle)}</span>
                    {c.auto_corrigeable && <span className="rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-emerald-200" title="Correction mécanique et sûre">auto</span>}
                    <span className="text-zinc-400">{c.marque ? `${c.marque} · ` : ""}{c.handle}</span>
                    <span className="ml-auto text-zinc-500">{fmtDateHeure(c.created_at)}</span>
                  </div>
                  {c.extrait && <div className="mt-2 rounded-lg bg-black/20 px-3 py-2 text-sm text-zinc-200">{c.extrait}</div>}
                  {c.correction_proposee && <div className="mt-1 text-sm text-emerald-200">→ {c.correction_proposee}</div>}
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    <a href={`https://admin.shopify.com/store/le-meuble/${chemin}/${num}`} target="_blank" rel="noopener noreferrer" className="text-sky-300 hover:underline">Admin Shopify</a>
                    {c.handle && (
                      <a href={`https://www.jardin-confort.ch/${c.langue}/${chemin}/${c.handle}`} target="_blank" rel="noopener noreferrer" className="text-sky-300 hover:underline">Page {c.langue.toUpperCase()} en ligne</a>
                    )}
                    <div className="ml-auto flex flex-wrap gap-2">
                      {c.statut !== "nouveau" && <button type="button" disabled={busy} onClick={() => changerStatut([c.id], "nouveau")} className={classeBouton}>Rouvrir</button>}
                      {c.statut !== "corrige" && <button type="button" disabled={busy} onClick={() => changerStatut([c.id], "corrige")} className={classeBouton}>✓ Corrigé</button>}
                      {c.statut !== "ignore" && <button type="button" disabled={busy} onClick={() => changerStatut([c.id], "ignore")} className={classeBouton}>Ignorer</button>}
                      {c.statut !== "faux_positif" && <button type="button" disabled={busy} onClick={() => changerStatut([c.id], "faux_positif")} className={classeBouton}>Faux positif</button>}
                    </div>
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
