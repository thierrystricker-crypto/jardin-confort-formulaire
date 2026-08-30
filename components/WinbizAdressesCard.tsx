"use client";
// components/WinbizAdressesCard.tsx
// Chantier « Export Winbiz » — chargement du fichier clients Winbiz.
// Composant partagé : page /dashboard/winbiz-adresses (plein écran) et bloc
// repliable de la page /dashboard/comptabilite (point d'entrée de la comptable).
//
// Avant une séance d'export, Thierry télécharge depuis Winbiz la « liste
// d'adresses, étiquettes » (.xls) et la charge ici. Le fichier est parsé DANS
// LE NAVIGATEUR (SheetJS vendorisé dans public/vendor/ — l'export réel pèse
// ~15 Mo, au-dessus du plafond de corps Vercel) : seules les 7 colonnes utiles
// partent vers l'API (~1 Mo).
//
// L'exercice n'est PAS dans le fichier (relevé du 29.08.2026) : il se saisit
// ici. Rappel : les codes adresse Winbiz changent PAR EXERCICE — un fichier
// d'un autre exercice attribuerait des factures au mauvais client, sans
// erreur visible. C'est le pire des modes de panne (cadrage §6.2).

import React, { useCallback, useEffect, useState } from "react";
import { preparerAdresses, type LigneFichier } from "@/lib/winbiz-match";

// SheetJS est chargé à la demande depuis /vendor/xlsx.full.min.js (vendorisé,
// pas de CDN externe ni de dépendance npm — v0.18.5, usage borné à un fichier
// que Thierry exporte lui-même de Winbiz, sur une page derrière le verrou).
type XlsxLib = {
  read: (data: ArrayBuffer, opts: { type: string }) => {
    SheetNames: string[];
    Sheets: Record<string, unknown>;
  };
  utils: {
    sheet_to_json: (sheet: unknown, opts: { defval: string; raw: boolean }) => Array<Record<string, unknown>>;
  };
};
declare global {
  interface Window { XLSX?: XlsxLib }
}

function chargerSheetJs(): Promise<XlsxLib> {
  return new Promise((resolve, reject) => {
    if (window.XLSX) return resolve(window.XLSX);
    const s = document.createElement("script");
    s.src = "/vendor/xlsx.full.min.js";
    s.onload = () => (window.XLSX ? resolve(window.XLSX) : reject(new Error("SheetJS chargé mais introuvable")));
    s.onerror = () => reject(new Error("Impossible de charger /vendor/xlsx.full.min.js"));
    document.head.appendChild(s);
  });
}

/** Exercice comptable Jardin-Confort : 1er octobre → 30 septembre (doc 03). */
function exerciceCourant(): number {
  const now = new Date();
  return now.getMonth() >= 9 ? now.getFullYear() + 1 : now.getFullYear();
}

type EtatExercice = { exercice: number; nb_fiches: number; importe_le: string };

type Apercu = {
  nomFichier: string;
  total: number;
  exploitables: number;
  sansCode: number;
  codesDupliques: string[];
  adresses: LigneFichier[];
};

type Reponse = {
  exercice: number;
  recues: number;
  inserees: number;
  ecartees_sans_code: number;
  codes_dupliques_ecartes: string[];
  remplacees: number;
};

export default function WinbizAdressesCard() {
  const [etat, setEtat] = useState<EtatExercice[] | null>(null);
  const [exercice, setExercice] = useState<string>(String(exerciceCourant()));
  const [apercu, setApercu] = useState<Apercu | null>(null);
  const [analyse, setAnalyse] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [reponse, setReponse] = useState<Reponse | null>(null);
  const [erreur, setErreur] = useState<string>("");

  const chargerEtat = useCallback(async () => {
    try {
      const r = await fetch("/api/winbiz-adresses");
      const j = await r.json();
      if (r.ok) setEtat(j.exercices ?? []);
    } catch {
      /* l'état est informatif, l'échec se voit par la liste absente */
    }
  }, []);

  useEffect(() => { chargerEtat(); }, [chargerEtat]);

  async function surFichier(e: React.ChangeEvent<HTMLInputElement>) {
    setErreur(""); setReponse(null); setApercu(null);
    const f = e.target.files?.[0];
    if (!f) return;
    setAnalyse(true);
    try {
      const XLSX = await chargerSheetJs();
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const nomFeuille = wb.SheetNames[0];
      if (!nomFeuille) throw new Error("Classeur vide");
      // raw:false → toutes les valeurs en texte (les codes et NPA gardent leurs zéros)
      const lignes = XLSX.utils.sheet_to_json(wb.Sheets[nomFeuille], { defval: "", raw: false });
      if (lignes.length === 0) throw new Error("Aucune ligne dans la feuille");
      const premiere = lignes[0] ?? {};
      for (const col of ["ad_code", "ad_nom", "ad_npa"]) {
        if (!(col in premiere)) {
          throw new Error(
            `Colonne « ${col} » introuvable — ce fichier n'est pas l'export Winbiz « liste d'adresses, étiquettes » attendu.`
          );
        }
      }
      const brutes = lignes.map((r) => ({
        code: String(r["ad_code"] ?? ""),
        societe: String(r["ad_societe"] ?? ""),
        nom: String(r["ad_nom"] ?? ""),
        prenom: String(r["ad_prenom"] ?? ""),
        rue: [String(r["ad_rue_1"] ?? ""), String(r["ad_rue_2"] ?? "")].filter((s) => s.trim()).join(" "),
        npa: String(r["ad_npa"] ?? ""),
        ville: String(r["ad_ville"] ?? ""),
      }));
      const prep = preparerAdresses(brutes);
      setApercu({
        nomFichier: f.name,
        total: lignes.length,
        exploitables: prep.adresses.length,
        sansCode: prep.sansCode,
        codesDupliques: prep.codesDupliques,
        adresses: prep.adresses,
      });
    } catch (err) {
      setErreur(err instanceof Error ? err.message : String(err));
    } finally {
      setAnalyse(false);
    }
  }

  async function charger() {
    if (!apercu) return;
    setErreur(""); setEnvoi(true); setReponse(null);
    try {
      const r = await fetch("/api/winbiz-adresses/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exercice: Number(exercice), adresses: apercu.adresses }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Erreur ${r.status}`);
      setReponse(j as Reponse);
      setApercu(null);
      await chargerEtat();
    } catch (err) {
      setErreur(err instanceof Error ? err.message : String(err));
    } finally {
      setEnvoi(false);
    }
  }

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString("fr-CH", { day: "2-digit", month: "2-digit", year: "numeric" }) +
    " " + new Date(iso).toLocaleTimeString("fr-CH", { hour: "2-digit", minute: "2-digit" });

  return (
    <>
        {/* Chargement */}
        <div className="mb-6 rounded-2xl border border-zinc-700 bg-zinc-800/60 p-6">
          <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">
            Charger un export Winbiz (« liste d&apos;adresses, étiquettes », .xls)
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <label className="block">
              <span className="mb-1 block text-xs text-zinc-400">Exercice couvert par ce fichier</span>
              <input
                type="number"
                value={exercice}
                onChange={(e) => setExercice(e.target.value)}
                className="w-28 rounded-lg border border-zinc-600 bg-zinc-900 px-3 py-2 text-sm"
              />
            </label>
            <label className="block grow">
              <span className="mb-1 block text-xs text-zinc-400">Fichier</span>
              <input
                type="file"
                accept=".xls,.xlsx"
                onChange={surFichier}
                className="block w-full text-sm text-zinc-300 file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-600 file:px-3 file:py-2 file:text-sm file:text-zinc-100"
              />
            </label>
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            L&apos;exercice n&apos;est pas dans le fichier : vérifie qu&apos;il correspond bien à
            l&apos;exercice ouvert dans Winbiz au moment de l&apos;export. Exercice comptable = 1er octobre → 30 septembre.
          </p>

          {analyse && <div className="mt-4 text-sm text-zinc-400">Analyse du fichier…</div>}

          {apercu && (
            <div className="mt-4 rounded-xl border border-sky-500/30 bg-sky-500/10 p-4">
              <div className="text-sm font-medium">{apercu.nomFichier}</div>
              <ul className="mt-2 space-y-1 text-sm text-zinc-300">
                <li>{apercu.total} fiches lues → <strong>{apercu.exploitables} exploitables</strong></li>
                <li>{apercu.sansCode} écartées sans code adresse (jamais matchables)</li>
                {apercu.codesDupliques.length > 0 && (
                  <li className="text-amber-300">
                    ⚠️ codes portés par plusieurs fiches, écartés : {apercu.codesDupliques.join(", ")} — à
                    assainir dans Winbiz
                  </li>
                )}
              </ul>
              <button
                onClick={charger}
                disabled={envoi}
                className="mt-4 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium hover:bg-sky-500 disabled:opacity-50"
              >
                {envoi ? "Chargement…" : `Charger — remplace l'exercice ${exercice}`}
              </button>
            </div>
          )}

          {reponse && (
            <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-zinc-200">
              ✅ Exercice {reponse.exercice} chargé : <strong>{reponse.inserees} fiches</strong>
              {reponse.remplacees > 0 && <> (remplace {reponse.remplacees} fiches)</>}
              {" — "}{reponse.ecartees_sans_code} sans code écartées
              {reponse.codes_dupliques_ecartes.length > 0 && (
                <>, codes dupliqués écartés : {reponse.codes_dupliques_ecartes.join(", ")}</>
              )}
            </div>
          )}

          {erreur && (
            <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
              {erreur}
            </div>
          )}
        </div>

        {/* État */}
        <div className="rounded-2xl border border-zinc-700 bg-zinc-800/60 p-6">
          <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">Exercices chargés</div>
          {etat === null && <div className="text-sm text-zinc-500">Chargement…</div>}
          {etat !== null && etat.length === 0 && (
            <div className="text-sm text-zinc-500">
              Aucun fichier chargé — les exports partiront tous sur le client 999 tant qu&apos;un
              fichier n&apos;est pas là.
            </div>
          )}
          {etat !== null && etat.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-zinc-500">
                  <th className="pb-2">Exercice</th>
                  <th className="pb-2">Fiches</th>
                  <th className="pb-2">Dernier chargement</th>
                </tr>
              </thead>
              <tbody>
                {etat.map((e) => (
                  <tr key={e.exercice} className="border-t border-zinc-700/60">
                    <td className="py-2 font-medium">{e.exercice}</td>
                    <td className="py-2">{e.nb_fiches}</td>
                    <td className="py-2 text-zinc-400">{fmtDate(e.importe_le)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
    </>
  );
}
