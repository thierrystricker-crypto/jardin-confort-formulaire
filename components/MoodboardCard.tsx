"use client";
// components/MoodboardCard.tsx
// Carte « Planche couleurs » du dashboard d'un document (offre ET commande) —
// chantier moodboard, 13.10.2026. Même style que Faisabilite3DCard.
//
// Elle montre la planche (calculée EN DIRECT depuis les articles actuels du
// document), son réglage d'affichage, un aperçu interactif et le lien vers la
// page publique /planche/[slug].
//
// Réglage après coup (chantier « réglages et décor », 13.10.2026) :
//   • offre non signée et commande : choix à trois positions — sans planche,
//     planche seule, planche + décor d'inspiration — plus le rendu. Chaque
//     changement passe par POST /api/offres/[slug]/planche (RPC regler_planche)
//     et devient une CORRECTION TRACÉE (auteur, motif). Rien n'est régénéré :
//     le PDF reprend le réglage à sa prochaine ouverture depuis le dashboard.
//   • offre SIGNÉE : lecture seule. C'est la preuve contractuelle ; la planche
//     se règle sur la commande née de la signature.

import React, { useEffect, useState } from "react";
import MoodboardPlanche from "@/components/MoodboardPlanche";
import {
  AFFICHAGES_MOODBOARD,
  lireReglagesMoodboard,
  type AffichageMoodboard,
  type MatiereMoodboard,
  type ModeMoodboard,
  type SensMoodboard,
} from "@/lib/moodboard";

// Même clé que CorrectionConfirmModal et ProlongerOffreModal : le nom saisi
// une fois est repris.
const LOCALSTORAGE_AUTHOR_KEY = "corrections-author";

type Reponse = {
  matieres: MatiereMoodboard[];
  couverture: { articles: number; representes: number };
  numero?: string | null;
  reglages?: unknown;
};

type Props = {
  slug: string;
  estCommande?: boolean;
  offreSignee?: boolean;
  commandeIssue?: { slug: string; numero: string } | null;
};

function libelle(a: AffichageMoodboard): string {
  return AFFICHAGES_MOODBOARD.find((x) => x.valeur === a)?.libelle ?? a;
}

export default function MoodboardCard({ slug, estCommande = false, offreSignee = false, commandeIssue = null }: Props) {
  const [rep, setRep] = useState<Reponse | null>(null);
  const [ouvert, setOuvert] = useState(false);
  const [copie, setCopie] = useState(false);

  // Réglage choisi à l'écran (pas encore enregistré)
  const [affichage, setAffichage] = useState<AffichageMoodboard>("aucune");
  const [mode, setMode] = useState<ModeMoodboard>("poids");
  const [sens, setSens] = useState<SensMoodboard>("clair-fonce");
  const [auteur, setAuteur] = useState("");
  const [motif, setMotif] = useState("");
  const [motifTouche, setMotifTouche] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState("");

  useEffect(() => {
    let vivant = true;
    fetch(`/api/offres/${encodeURIComponent(slug)}/matieres`)
      .then((r) => r.json())
      .then((j: Reponse) => {
        if (!vivant) return;
        setRep(j);
        const r = lireReglagesMoodboard(j.reglages);
        setAffichage(r.affichage);
        setMode(r.mode);
        setSens(r.sens);
      })
      .catch(() => { if (vivant) setRep({ matieres: [], couverture: { articles: 0, representes: 0 } }); });
    try { const s = localStorage.getItem(LOCALSTORAGE_AUTHOR_KEY); if (s) setAuteur(s); } catch { /* */ }
    return () => { vivant = false; };
  }, [slug]);

  const enregistre = lireReglagesMoodboard(rep?.reglages);
  const modifie = affichage !== enregistre.affichage || mode !== enregistre.mode || sens !== enregistre.sens;

  // Motif proposé : pré-rempli sur une offre, à saisir sur une commande.
  useEffect(() => {
    if (motifTouche) return;
    if (!modifie || estCommande) { setMotif(""); return; }
    setMotif(`Planche couleurs : ${libelle(enregistre.affichage)} → ${libelle(affichage)}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [affichage, mode, sens, modifie, estCommande, motifTouche]);

  if (!rep) return null;

  const nb = rep.matieres.length;
  const visible = enregistre.affichage !== "aucune";
  const lien = typeof window !== "undefined" ? `${window.location.origin}/planche/${slug}` : `/planche/${slug}`;
  const peutEnregistrer = modifie && auteur.trim().length >= 2 && motif.trim().length >= 5 && !envoi;

  async function copierLien() {
    try { await navigator.clipboard.writeText(lien); setCopie(true); setTimeout(() => setCopie(false), 2500); }
    catch { window.prompt("Copie manuelle du lien :", lien); }
  }

  function annuler() {
    setAffichage(enregistre.affichage);
    setMode(enregistre.mode);
    setSens(enregistre.sens);
    setMotifTouche(false);
    setErreur("");
  }

  async function enregistrer() {
    if (!peutEnregistrer) return;
    setEnvoi(true); setErreur("");
    try {
      try { localStorage.setItem(LOCALSTORAGE_AUTHOR_KEY, auteur.trim()); } catch { /* */ }
      const res = await fetch(`/api/offres/${encodeURIComponent(slug)}/planche`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ affichage, mode, sens, corrected_by: auteur.trim(), reason: motif.trim() }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setErreur(json.error || `Erreur ${res.status}`); setEnvoi(false); return; }
      // Recharger : la carte, l'historique des corrections et le reste de la
      // fiche reprennent l'état enregistré.
      window.location.reload();
    } catch (e) {
      setErreur("Erreur réseau : " + (e as Error).message);
      setEnvoi(false);
    }
  }

  const couleur = nb === 0
    ? "border-white/10 bg-[#1f2125]"
    : visible ? "border-emerald-500/30 bg-emerald-500/5" : "border-white/10 bg-[#1f2125]";

  return (
    <section className={`rounded-2xl border p-6 ${couleur}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">🎨 Planche couleurs et matières</h2>
          <p className="mt-1 text-sm text-zinc-300">
            {nb === 0 ? (
              <>Aucune finition reconnue pour les articles de ce document.</>
            ) : (
              <>
                <strong className="text-white">{nb}</strong> finition{nb > 1 ? "s" : ""} ·{" "}
                {rep.couverture.representes}/{rep.couverture.articles} article{rep.couverture.articles > 1 ? "s" : ""} représenté{rep.couverture.representes > 1 ? "s" : ""}
                {" · "}
                {visible ? (
                  <span className="text-emerald-300">{libelle(enregistre.affichage)} sur le document</span>
                ) : (
                  <span className="text-zinc-400">non ajoutée au document (aperçu seulement)</span>
                )}
              </>
            )}
          </p>
        </div>
        {nb > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <a href={`/planche/${slug}`} target="_blank" rel="noopener noreferrer" className="rounded-xl border border-sky-500/40 bg-sky-500/20 px-3 py-1.5 text-sm text-sky-200 hover:bg-sky-500/30">
              Ouvrir la page planche ↗
            </a>
            <button type="button" onClick={copierLien} className="rounded-xl border border-white/10 bg-[#2a2d31] px-3 py-1.5 text-xs text-zinc-300 hover:bg-[#34383d]">
              {copie ? "Lien copié ✓" : "Copier le lien client"}
            </button>
            <button type="button" onClick={() => setOuvert((v) => !v)} className="rounded-xl border border-white/10 bg-[#2a2d31] px-3 py-1.5 text-xs text-zinc-300 hover:bg-[#34383d]">
              {ouvert ? "Masquer l'aperçu" : "Voir l'aperçu"}
            </button>
          </div>
        )}
      </div>

      {nb > 0 && offreSignee && (
        <p className="mt-4 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-300">
          Offre signée : c&apos;est la preuve du contrat, son réglage ne se modifie pas.
          {commandeIssue ? (
            <> La planche se règle sur la commande{" "}
              <a href={`/dashboard/${commandeIssue.slug}`} className="text-sky-300 underline hover:text-sky-200">{commandeIssue.numero}</a>.
            </>
          ) : (
            <> La planche se règle sur la commande née de la signature.</>
          )}
        </p>
      )}

      {nb > 0 && !offreSignee && (
        <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Sur le document</div>
          <div className="flex flex-wrap gap-2">
            {AFFICHAGES_MOODBOARD.map((a) => (
              <button
                key={a.valeur}
                type="button"
                onClick={() => setAffichage(a.valeur)}
                className={`rounded-full border px-3 py-1 text-sm ${affichage === a.valeur
                  ? "border-sky-400 bg-sky-500/25 text-sky-200"
                  : "border-white/15 text-zinc-300 hover:bg-white/5"}`}
              >
                {a.libelle}
              </button>
            ))}
          </div>

          {affichage !== "aucune" && (
            <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-zinc-300">
              <label className="flex items-center gap-2">
                Rendu
                <select value={mode} onChange={(e) => setMode(e.target.value === "degrade" ? "degrade" : "poids")}
                  className="rounded-lg border border-white/15 bg-black/30 px-2 py-1 text-sm text-zinc-100">
                  <option value="poids">Par valeur</option>
                  <option value="degrade">Dégradé</option>
                </select>
              </label>
              {mode === "degrade" && (
                <label className="flex items-center gap-2">
                  Sens
                  <select value={sens} onChange={(e) => setSens(e.target.value === "fonce-clair" ? "fonce-clair" : "clair-fonce")}
                    className="rounded-lg border border-white/15 bg-black/30 px-2 py-1 text-sm text-zinc-100">
                    <option value="clair-fonce">Clair → foncé</option>
                    <option value="fonce-clair">Foncé → clair</option>
                  </select>
                </label>
              )}
            </div>
          )}

          {modifie && (
            <div className="mt-3 grid gap-2 border-t border-white/10 pt-3">
              <p className="text-xs text-zinc-400">
                Ce changement sera tracé dans l&apos;historique des corrections. Le PDF le reprendra à sa
                prochaine ouverture depuis cette fiche.
                {estCommande ? " Le PDF initial archivé de la commande ne change pas." : ""}
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="text-sm text-zinc-300">
                  Votre nom
                  <input value={auteur} onChange={(e) => setAuteur(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-1.5 text-sm text-zinc-100" />
                </label>
                <label className="text-sm text-zinc-300">
                  Motif
                  <input value={motif} placeholder={estCommande ? "Pourquoi ce changement ? (5 caractères au moins)" : ""}
                    onChange={(e) => { setMotif(e.target.value); setMotifTouche(true); }}
                    className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-1.5 text-sm text-zinc-100" />
                </label>
              </div>
              {erreur && <div className="rounded-lg bg-rose-500/15 p-2 text-sm text-rose-300">{erreur}</div>}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={annuler}
                  className="rounded-xl border border-white/15 px-3 py-1.5 text-sm text-zinc-300 hover:bg-white/5">Annuler</button>
                <button type="button" onClick={enregistrer} disabled={!peutEnregistrer}
                  className="rounded-xl border border-emerald-500/40 bg-emerald-500/20 px-3 py-1.5 text-sm font-semibold text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-40">
                  {envoi ? "Enregistrement…" : "Enregistrer le réglage"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {ouvert && nb > 0 && (
        <div className="mt-4 max-w-[560px] rounded-xl bg-white p-3">
          <MoodboardPlanche
            matieres={rep.matieres}
            couverture={rep.couverture}
            mode={mode}
            sens={sens}
            decor={affichage === "planche-decor"}
            interactif
            compact
            mention={false}
          />
        </div>
      )}
    </section>
  );
}
