// components/CorrectionConfirmModal.tsx
// Modal de confirmation finale avant POST /api/corrections.
// L'utilisateur y saisit son nom (pré-rempli depuis localStorage) et la raison
// de la correction (min 5 caractères). Au submit, l'API est appelée et
// onSuccess() est déclenché au retour.

"use client";

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CLIENT_IDENTITY_FIELDS } from "@/lib/corrections-config";

const LOCALSTORAGE_AUTHOR_KEY = "corrections-author";

type FieldChange = { old: unknown; new: unknown };

interface Props {
  entityType: "offre" | "commande";
  entitySlug: string;
  entityNumero: string;
  fieldsChanged: Record<string, FieldChange>;
  onCancel: () => void;
  onSuccess: () => void;
}

function fieldLabelShort(key: string): string {
  const labels: Record<string, string> = {
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
  return labels[key] || key;
}

function formatValue(v: unknown): string {
  if (typeof v === "boolean") return v ? "Oui" : "Non";
  if (v === null || v === undefined || v === "") return "(vide)";
  return String(v);
}

export default function CorrectionConfirmModal({
  entityType,
  entitySlug,
  entityNumero,
  fieldsChanged,
  onCancel,
  onSuccess,
}: Props) {
  const [authorName, setAuthorName] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // Pré-remplir le nom depuis localStorage
  useEffect(() => {
    const saved = localStorage.getItem(LOCALSTORAGE_AUTHOR_KEY);
    if (saved) setAuthorName(saved);
  }, []);

  // Détecter si modif sur champ d'identité client → afficher avertissement
  const modifiedIdentityFields = Object.keys(fieldsChanged).filter((k) =>
    (CLIENT_IDENTITY_FIELDS as readonly string[]).includes(k)
  );
  const hasIdentityChange = modifiedIdentityFields.length > 0;

  const authorTrimmed = authorName.trim();
  const reasonTrimmed = reason.trim();
  const canSubmit =
    authorTrimmed.length >= 2 && reasonTrimmed.length >= 5 && !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;

    setSubmitting(true);
    setErrorMsg("");

    try {
      localStorage.setItem(LOCALSTORAGE_AUTHOR_KEY, authorTrimmed);

      const res = await fetch("/api/corrections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity_type: entityType,
          entity_slug: entitySlug,
          corrected_by: authorTrimmed,
          reason: reasonTrimmed,
          fields_changed: fieldsChanged,
        }),
      });

      const json = await res.json();

      if (!res.ok) {
        setErrorMsg(json.error || `Erreur ${res.status}`);
        setSubmitting(false);
        return;
      }

      onSuccess();
    } catch (e) {
      setErrorMsg("Erreur réseau : " + (e as Error).message);
      setSubmitting(false);
    }
  }

  const modalContent = (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm"
        onClick={!submitting ? onCancel : undefined}
        role="presentation"
      />

      {/* Modal */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        className="fixed left-1/2 top-1/2 z-[60] w-full max-w-xl -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/10 bg-[#2a2d31] shadow-2xl"
      >
        <div className="border-b border-white/10 px-6 py-4">
          <h2 id="confirm-modal-title" className="text-lg font-semibold text-zinc-100">
            Confirmer la correction
          </h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            {entityType === "offre" ? "Offre" : "Commande"} {entityNumero}
          </p>
        </div>

        <div className="px-6 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Avertissement identité client */}
          {hasIdentityChange && (
            <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-xs text-sky-200/90 leading-relaxed">
              <strong className="block mb-1 text-sky-200">ℹ️ Information</strong>
              Vous modifiez des champs qui servent à associer cette{" "}
              {entityType === "offre" ? "offre" : "commande"} à une fiche client
              dans le dashboard ({modifiedIdentityFields.map(fieldLabelShort).join(", ")}).
              <br />
              <br />
              Après la correction, elle pourra apparaître sur une fiche client
              différente si une fiche existe avec les nouvelles valeurs.
              L&apos;{entityType} reste accessible directement par son numéro {entityNumero}.
            </div>
          )}

          {/* Récap des modifs */}
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
              Modifications ({Object.keys(fieldsChanged).length})
            </h3>
            <ul className="space-y-2 rounded-xl border border-white/10 bg-[#1f2125] p-3 text-sm">
              {Object.entries(fieldsChanged).map(([key, change]) => (
                <li key={key} className="text-zinc-300">
                  <div className="text-xs font-medium text-amber-300">
                    {fieldLabelShort(key)}
                  </div>
                  <div className="mt-0.5 text-xs">
                    <span className="text-zinc-500 line-through">
                      {formatValue(change.old)}
                    </span>
                    <span className="mx-2 text-amber-400">→</span>
                    <span className="text-zinc-100">{formatValue(change.new)}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* Nom auteur */}
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-400">
              Votre nom *
            </label>
            <input
              type="text"
              value={authorName}
              onChange={(e) => setAuthorName(e.target.value)}
              placeholder="Ex: Brice"
              className="w-full rounded-lg border border-white/10 bg-[#1f2125] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-sky-500/30"
              disabled={submitting}
              autoComplete="new-password"
            />
            <p className="mt-1 text-xs text-zinc-500">
              Mémorisé localement pour la prochaine correction
            </p>
          </div>

          {/* Raison */}
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-400">
              Raison de la correction *
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Ex: Correction de la faute de frappe dans le nom (le client a signalé)"
              className="w-full rounded-lg border border-white/10 bg-[#1f2125] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-sky-500/30"
              disabled={submitting}
              autoComplete="new-password"
            />
            <p className="mt-1 text-xs text-zinc-500">
              {reasonTrimmed.length}/5 caractères minimum
            </p>
          </div>

          {/* Erreur */}
          {errorMsg && (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-300">
              ❌ {errorMsg}
            </div>
          )}
        </div>

        <div className="border-t border-white/10 px-6 py-4 flex items-center justify-end gap-3">
          <button
            onClick={onCancel}
            disabled={submitting}
            className="rounded-xl border border-white/10 bg-[#34383d] px-4 py-2 text-sm text-zinc-300 hover:bg-[#40454b] disabled:opacity-50"
          >
            Annuler
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="rounded-xl border border-sky-500/40 bg-sky-500/20 px-4 py-2 text-sm font-medium text-sky-200 transition hover:bg-sky-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting ? "Enregistrement…" : "Confirmer la correction"}
          </button>
        </div>
      </div>
    </>
  );

  if (typeof window === "undefined") return null;
  return createPortal(modalContent, document.body);
}