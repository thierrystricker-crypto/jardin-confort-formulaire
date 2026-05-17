// components/CorrectionsHistoryBlock.tsx
// Section collapsible "Historique des corrections" sur la page dashboard.
// Masquée par défaut, lecture seule, immuable.
//
// Affiche pour chaque correction : date, auteur, raison, et les champs modifiés
// (libellé + ancienne valeur → nouvelle valeur).
//
// Utilisé sur app/dashboard/[slug]/page.tsx, juste après la section
// "Suivi commercial".

"use client";

import React, { useEffect, useState } from "react";

interface Correction {
  id: string;
  entity_type: "offre" | "commande";
  entity_numero: string;
  corrected_by: string;
  corrected_at: string;
  fields_changed: Record<string, { old: unknown; new: unknown }>;
  reason: string;
  pdf_regenerated_at: string | null;
}

interface Props {
  entityType: "offre" | "commande";
  entitySlug: string;
}

// Libellés humains pour les champs (cohérent avec CorrectionConfirmModal)
const FIELD_LABELS: Record<string, string> = {
  paymentMode: "Mode de paiement",
  deliveryMode: "Mode de livraison",
  leadTime: "Délai de livraison",
  societe: "Société",
  nom: "Nom",
  prenom: "Prénom",
  complement_nom: "Complément nom",
  rue: "Rue",
  numero: "N°",
  rue2: "Complément d'adresse",
  npa: "NPA",
  ville: "Ville",
  telephone1: "Téléphone 1",
  telephone2: "Téléphone 2",
  email: "Email",
  livrDiff: "Adresse livraison différente",
  livrSociete: "Société livraison",
  livrNom: "Nom livraison",
  livrPrenom: "Prénom livraison",
  livr_complement_nom: "Complément nom livraison",
  livrRue: "Rue livraison",
  livrNumero: "N° livraison",
  livrRue2: "Complément d'adresse livraison",
  livrNpa: "NPA livraison",
  livrVille: "Ville livraison",
  livrTel: "Téléphone livraison",
  accesLivraison: "Accès livraison",
  remarks: "Remarques",
  notesInternes: "Notes internes",
};

function fieldLabel(key: string): string {
  return FIELD_LABELS[key] || key;
}

function formatValue(v: unknown): string {
  if (typeof v === "boolean") return v ? "Oui" : "Non";
  if (v === null || v === undefined || v === "") return "(vide)";
  return String(v);
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("fr-CH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function CorrectionsHistoryBlock({ entityType, entitySlug }: Props) {
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(
          `/api/corrections?entity_type=${entityType}&entity_slug=${encodeURIComponent(entitySlug)}`
        );
        if (!res.ok) throw new Error(`Erreur ${res.status}`);
        const json = await res.json();
        setCorrections(json.corrections || []);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [entityType, entitySlug]);

  // Si pas de corrections et pas de chargement en cours → ne rien afficher
  // (évite de polluer la page pour les offres jamais corrigées)
  if (!loading && corrections.length === 0 && !error) {
    return null;
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-[#2a2d31] p-6">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between text-left hover:opacity-90 transition"
      >
        <h2 className="text-xl font-semibold flex items-center gap-2">
          📝 Historique des corrections
          {!loading && corrections.length > 0 && (
            <span className="rounded-full bg-sky-500/15 px-2.5 py-0.5 text-xs font-medium text-sky-300">
              {corrections.length}
            </span>
          )}
        </h2>
        <span className="text-zinc-500 text-sm">{expanded ? "▼" : "▶"}</span>
      </button>

      {expanded && (
        <div className="mt-4">
          {loading && (
            <p className="text-sm text-zinc-500">Chargement…</p>
          )}

          {error && (
            <p className="text-sm text-rose-300">Erreur : {error}</p>
          )}

          {!loading && !error && corrections.length > 0 && (
            <ul className="space-y-3">
              {corrections.map((c, idx) => {
                const version = corrections.length - idx + 1; // version N+1 (doc initial = version 1)
                return (
                  <li
                    key={c.id}
                    className="rounded-xl border border-white/10 bg-[#1f2125] p-4"
                  >
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="rounded-full bg-sky-500/15 px-2.5 py-0.5 text-xs font-medium text-sky-300">
                          Version {version}
                        </span>
                        <span className="text-sm font-medium text-zinc-200">
                          {c.corrected_by}
                        </span>
                        <span className="text-xs text-zinc-500">
                          {fmtDateTime(c.corrected_at)}
                        </span>
                      </div>
                    </div>

                    <p className="mt-2 text-sm text-zinc-300 italic">
                      « {c.reason} »
                    </p>

                    <div className="mt-3 space-y-1.5">
                      {Object.entries(c.fields_changed).map(([key, change]) => (
                        <div key={key} className="text-xs">
                          <span className="font-medium text-amber-300">
                            {fieldLabel(key)} :
                          </span>{" "}
                          <span className="text-zinc-500 line-through">
                            {formatValue(change.old)}
                          </span>
                          <span className="mx-2 text-amber-400">→</span>
                          <span className="text-zinc-200">
                            {formatValue(change.new)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}