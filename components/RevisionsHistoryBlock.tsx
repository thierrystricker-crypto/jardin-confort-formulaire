// components/RevisionsHistoryBlock.tsx
// Section "Historique des revisions" sur la page dashboard d'une COMMANDE.
// Lecture seule, immuable. Consomme /api/revisions (table commandes_revisions).
//
// Affiche un bandeau "Commande revisee N fois - version actuelle Vn+1" + le
// detail de chaque revision (ajouts, retraits, qty, prix, remise, en-tete),
// avec filtrage des faux positifs d'en-tete (avant === apres apres re-tri).
//
// Monte sur app/dashboard/[slug]/page.tsx, a cote de CorrectionsHistoryBlock,
// uniquement si type_document === "Commande".

"use client";

import React, { useEffect, useState } from "react";
import { CLES_HORS_FORMULAIRE } from "@/lib/revision-diff";

type LineChange = { sku: string; title: string; avant: number; apres: number };
type LineItem = { sku: string; title: string; qty: number };
type EnteteChange = { champ: string; avant: string; apres: string };

interface RevisionDiff {
  ajouts?: LineItem[];
  retraits?: LineItem[];
  qtyChanges?: LineChange[];
  prixChanges?: LineChange[];
  remiseChanges?: LineChange[];
  enteteChanges?: EnteteChange[];
}

interface Revision {
  version_num: number;
  commercial: string | null;
  created_at: string;
  diff: RevisionDiff;
}

interface Props {
  commandeSlug: string;
}

// Libelles humains des champs d'en-tete.
const ENTETE_LABELS: Record<string, string> = {
  commercial: "Commercial",
  discountPercent: "Remise globale (%)",
  manualRounding: "Arrondi manuel",
  servicePrices: "Prix des services",
  enabledServices: "Services actives",
  paymentMode: "Mode de paiement",
  deliveryMode: "Mode de livraison",
  leadTime: "Delai de livraison",
  remarks: "Remarques",
  notesInternes: "Notes internes",
};

// Champs d'en-tete dont la valeur est un objet JSON illisible : on signale le
// changement sans afficher avant/apres (sinon on montre du JSON brut).
const ENTETE_OPAQUE = new Set(["servicePrices", "enabledServices"]);

function enteteLabel(champ: string): string {
  return ENTETE_LABELS[champ] || champ;
}

// Re-normalise une valeur d'en-tete pour comparaison stable : si c'est une
// chaine JSON re-serialisee (cas servicePrices/enabledServices), on re-parse et
// re-trie les cles, pour neutraliser les faux positifs dus a l'ordre des cles.
function normEntete(v: string): string {
  if (typeof v !== "string") return String(v);
  const t = v.trim();
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      const parsed = JSON.parse(t);
      return JSON.stringify(parsed, (_k, val) =>
        val && typeof val === "object" && !Array.isArray(val)
          ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b)))
          : val
      );
    } catch {
      return t;
    }
  }
  return t;
}

// Retourne true si l'entree d'en-tete est un VRAI changement (apres re-norm).
// Deux filtres :
//  1. faux positifs d'ordre de cles JSON (servicePrices / enabledServices) ;
//  2. bruit des diffs archives avant le 15.08.2026 : la RPC ecrasait le data en
//     bloc, donc les cles jamais portees par le formulaire etaient enregistrees
//     comme "valeur -> (vide)". On ne filtre QUE cette forme exacte sur ces cles :
//     un vidage volontaire d'un champ du formulaire (manualRounding, numero)
//     reste affiche.
function isRealEnteteChange(c: EnteteChange): boolean {
  if (
    CLES_HORS_FORMULAIRE.has(c.champ) &&
    (c.avant || "") !== "" &&
    (c.apres || "") === ""
  ) {
    return false;
  }
  return normEntete(c.avant) !== normEntete(c.apres);
}

function fmtVal(v: string): string {
  if (v === null || v === undefined || v === "") return "(vide)";
  return String(v);
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("fr-CH", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function RevisionsHistoryBlock({ commandeSlug }: Props) {
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [versionVivante, setVersionVivante] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(
          `/api/revisions?commande_slug=${encodeURIComponent(commandeSlug)}`
        );
        if (!res.ok) throw new Error(`Erreur ${res.status}`);
        const json = await res.json();
        setRevisions(json.revisions || []);
        setVersionVivante(json.versionVivante || 1);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [commandeSlug]);

  // Jamais revisee (ou en cours de chargement) -> rien afficher.
  if (!loading && revisions.length === 0 && !error) {
    return null;
  }

  const count = revisions.length;

  // Rendu lisible du diff d'une revision -> liste de chaines.
  function renderDiff(diff: RevisionDiff): React.ReactNode[] {
    const out: React.ReactNode[] = [];

    for (const a of diff.ajouts || []) {
      out.push(
        <li key={`a-${out.length}`} className="text-emerald-300">
          + {a.qty}&times; {a.title}{a.sku ? ` (${a.sku})` : ""} ajoute
        </li>
      );
    }
    for (const r of diff.retraits || []) {
      out.push(
        <li key={`r-${out.length}`} className="text-rose-300">
          &minus; {r.qty}&times; {r.title}{r.sku ? ` (${r.sku})` : ""} retire
        </li>
      );
    }
    for (const q of diff.qtyChanges || []) {
      out.push(
        <li key={`q-${out.length}`} className="text-amber-200">
          {q.title} : quantite {q.avant} &rarr; {q.apres}
        </li>
      );
    }
    for (const p of diff.prixChanges || []) {
      out.push(
        <li key={`p-${out.length}`} className="text-amber-200">
          {p.title} : prix {p.avant}.&ndash; &rarr; {p.apres}.&ndash;
        </li>
      );
    }
    for (const rm of diff.remiseChanges || []) {
      out.push(
        <li key={`rm-${out.length}`} className="text-amber-200">
          {rm.title} : remise {rm.avant} &rarr; {rm.apres}
        </li>
      );
    }
    for (const e of diff.enteteChanges || []) {
      if (!isRealEnteteChange(e)) continue; // filtre faux positifs
      if (ENTETE_OPAQUE.has(e.champ)) {
        out.push(
          <li key={`e-${out.length}`} className="text-sky-200">
            {enteteLabel(e.champ)} modifie(s)
          </li>
        );
      } else {
        out.push(
          <li key={`e-${out.length}`} className="text-sky-200">
            {enteteLabel(e.champ)} : {fmtVal(e.avant)} &rarr; {fmtVal(e.apres)}
          </li>
        );
      }
    }

    if (out.length === 0) {
      out.push(
        <li key="none" className="text-white/40 italic">
          (aucun changement significatif)
        </li>
      );
    }
    return out;
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-[#2a2d31] p-6">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between text-left hover:opacity-90 transition"
      >
        <h2 className="text-xl font-semibold flex items-center gap-2">
          &#128260; Historique des revisions
          {!loading && count > 0 && (
            <span className="text-sm font-normal text-white/60">
              ({count} revision{count > 1 ? "s" : ""} &middot; version actuelle V{versionVivante})
            </span>
          )}
        </h2>
        <span className="text-white/50">{expanded ? "\u2212" : "+"}</span>
      </button>

      {expanded && (
        <div className="mt-4">
          {loading && <div className="text-white/50">Chargement&hellip;</div>}
          {error && <div className="text-rose-400">Erreur : {error}</div>}

          {!loading && !error && (
            <div className="flex flex-col gap-3">
              {revisions.map((rev) => (
                <div
                  key={rev.version_num}
                  className="rounded-xl border border-white/10 bg-black/20 p-4"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold">
                      V{rev.version_num} &rarr; V{rev.version_num + 1}
                    </span>
                    <span className="text-white/50 text-sm">
                      {rev.commercial || "?"} &middot; {fmtDateTime(rev.created_at)}
                    </span>
                  </div>
                  <ul className="text-sm flex flex-col gap-1 pl-1">
                    {renderDiff(rev.diff)}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}