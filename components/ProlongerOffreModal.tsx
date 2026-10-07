"use client";

// Prolonger une offre (08.10.2026).
//
// Passe par /api/corrections : la prolongation est une correction tracée
// (auteur, motif, ancienne et nouvelle date) et apparaît dans l'historique
// des corrections. La date de l'offre ne change pas, seule la date de fin
// de validité (data.validiteJusquau) est posée. Voir lib/validite-offre.ts.

import React, { useEffect, useMemo, useState } from "react";
import {
  CHAMP_PROLONGATION,
  dateExpirationOffre,
  formatJourCH,
  versIsoJour,
} from "@/lib/validite-offre";

// Même clé que CorrectionConfirmModal : le nom saisi une fois est repris.
const LOCALSTORAGE_AUTHOR_KEY = "corrections-author";
const PALIERS = [15, 30, 60, 90];

type Props = {
  open: boolean;
  slug: string;
  numero: string;
  dateDocument: string | null;
  validiteDuree: string | null | undefined;
  validiteJusquau: unknown;
  onClose: () => void;
  onSuccess: () => void;
};

export default function ProlongerOffreModal({
  open, slug, numero, dateDocument, validiteDuree, validiteJusquau, onClose, onSuccess,
}: Props) {
  const expirationActuelle = useMemo(
    () => dateExpirationOffre(dateDocument, validiteDuree, validiteJusquau),
    [dateDocument, validiteDuree, validiteJusquau]
  );
  const expiree = expirationActuelle ? expirationActuelle.getTime() < Date.now() : true;

  // Base du calcul : la fin de validité actuelle si l'offre court encore,
  // sinon aujourd'hui (une offre expirée repart d'aujourd'hui).
  const base = useMemo(() => {
    const auj = new Date();
    auj.setHours(0, 0, 0, 0);
    if (!expirationActuelle || expiree) return auj;
    const b = new Date(expirationActuelle);
    b.setHours(0, 0, 0, 0);
    return b;
  }, [expirationActuelle, expiree]);

  const [jours, setJours] = useState(30);
  const [dateLibre, setDateLibre] = useState("");
  const [auteur, setAuteur] = useState("");
  const [motif, setMotif] = useState("Prolongation demandée par le client");
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState("");

  useEffect(() => {
    if (!open) return;
    setErreur(""); setEnvoi(false); setDateLibre(""); setJours(30);
    try { const s = localStorage.getItem(LOCALSTORAGE_AUTHOR_KEY); if (s) setAuteur(s); } catch { /* */ }
  }, [open]);

  const nouvelleIso = useMemo(() => {
    if (dateLibre) return dateLibre;
    const d = new Date(base);
    d.setDate(d.getDate() + jours);
    return versIsoJour(d);
  }, [base, jours, dateLibre]);

  const aujIso = versIsoJour(new Date());
  const dateOk = nouvelleIso >= aujIso;
  const peutValider = dateOk && auteur.trim().length >= 2 && motif.trim().length >= 5 && !envoi;

  async function valider() {
    if (!peutValider) return;
    setEnvoi(true); setErreur("");
    try {
      try { localStorage.setItem(LOCALSTORAGE_AUTHOR_KEY, auteur.trim()); } catch { /* */ }
      const ancienne = expirationActuelle ? versIsoJour(expirationActuelle) : null;
      const res = await fetch("/api/corrections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity_type: "offre",
          entity_slug: slug,
          corrected_by: auteur.trim(),
          reason: motif.trim(),
          fields_changed: { [CHAMP_PROLONGATION]: { old: ancienne, new: nouvelleIso } },
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setErreur(json.error || `Erreur ${res.status}`); setEnvoi(false); return; }
      onSuccess();
    } catch (e) {
      setErreur("Erreur réseau : " + (e as Error).message);
      setEnvoi(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#2a2d31] p-6 text-zinc-100 shadow-2xl">
        <h2 className="text-lg font-semibold">Prolonger l&apos;offre {numero}</h2>
        <p className="mt-1 text-sm text-zinc-400">
          La date de l&apos;offre ne change pas. Seule la date de fin de validité est repoussée, et la
          prolongation est tracée dans l&apos;historique des corrections.
        </p>

        <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-zinc-400">Validité actuelle</span>
            <span className={expiree ? "font-semibold text-rose-300" : "font-semibold"}>
              {expirationActuelle ? formatJourCH(versIsoJour(expirationActuelle)) : "inconnue"}
              {expiree ? " (expirée)" : ""}
            </span>
          </div>
          <div className="mt-1 flex justify-between">
            <span className="text-zinc-400">Nouvelle validité</span>
            <span className={dateOk ? "font-semibold text-emerald-300" : "font-semibold text-rose-300"}>
              {formatJourCH(nouvelleIso)}
            </span>
          </div>
        </div>

        <div className="mt-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
            Ajouter {expiree ? "à partir d'aujourd'hui" : "à la validité actuelle"}
          </div>
          <div className="flex flex-wrap gap-2">
            {PALIERS.map((n) => (
              <button key={n} type="button"
                onClick={() => { setJours(n); setDateLibre(""); }}
                className={`rounded-full border px-3 py-1 text-sm ${!dateLibre && jours === n
                  ? "border-sky-400 bg-sky-500/25 text-sky-200" : "border-white/15 text-zinc-300 hover:bg-white/5"}`}>
                + {n} jours
              </button>
            ))}
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm text-zinc-300">
            ou jusqu&apos;au
            <input type="date" min={aujIso} value={dateLibre}
              onChange={(e) => setDateLibre(e.target.value)}
              className="rounded-lg border border-white/15 bg-black/30 px-2 py-1 text-sm text-zinc-100" />
          </label>
        </div>

        <div className="mt-4 grid gap-3">
          <label className="text-sm text-zinc-300">
            Votre nom
            <input value={auteur} onChange={(e) => setAuteur(e.target.value)}
              className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-zinc-100" />
          </label>
          <label className="text-sm text-zinc-300">
            Motif
            <input value={motif} onChange={(e) => setMotif(e.target.value)}
              className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-zinc-100" />
          </label>
        </div>

        {erreur && <div className="mt-3 rounded-lg bg-rose-500/15 p-2 text-sm text-rose-300">{erreur}</div>}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose}
            className="rounded-xl border border-white/15 px-4 py-2 text-sm text-zinc-300 hover:bg-white/5">Annuler</button>
          <button type="button" onClick={valider} disabled={!peutValider}
            className="rounded-xl border border-emerald-500/40 bg-emerald-500/20 px-4 py-2 text-sm font-semibold text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-40">
            {envoi ? "Enregistrement…" : `Prolonger jusqu'au ${formatJourCH(nouvelleIso)}`}
          </button>
        </div>
      </div>
    </div>
  );
}
