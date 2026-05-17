// components/CorrectionDrawer.tsx
// Drawer latéral pour corriger les champs cosmétiques d'une offre/commande (v1)
//
// Usage :
//   <CorrectionDrawer
//     open={open}
//     entityType="offre"
//     entitySlug={slug}
//     currentData={offre.data}
//     onClose={() => setOpen(false)}
//     onSuccess={() => router.refresh()}
//   />
//
// Le drawer affiche un formulaire pré-rempli avec les valeurs actuelles de
// l'entité, structuré en 4 sections repliables (Document / Facturation /
// Livraison / Notes). Au-dessus du formulaire, une zone "Modifications en
// attente" affiche en temps réel les champs modifiés.
//
// Quand l'utilisateur clique sur "Continuer →", le drawer ouvre une modal
// de confirmation (CorrectionConfirmModal) où il saisit son nom + la raison.
// La modal effectue le POST /api/corrections et déclenche onSuccess() au retour.

"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { CORRECTIBLE_FIELDS_V1, type CorrectibleFieldV1 } from "@/lib/corrections-config";
import CorrectionConfirmModal from "./CorrectionConfirmModal";

// ============================================================================
// Types
// ============================================================================

export type CorrectionEntityType = "offre" | "commande";

interface Props {
  open: boolean;
  entityType: CorrectionEntityType;
  entitySlug: string;
  entityNumero: string; // ex: "DEV-2026-074" ou "CMD-80541"
  currentData: Record<string, unknown>;
  onClose: () => void;
  onSuccess: () => void;
}

type FieldChange = { old: unknown; new: unknown };

// ============================================================================
// Définition des sections et libellés UI
// ============================================================================

interface FieldDef {
  key: CorrectibleFieldV1;
  label: string;
  type?: "text" | "email" | "tel" | "textarea" | "checkbox" | "select";
  options?: string[]; // pour select
  placeholder?: string;
}

const SECTIONS: { id: string; title: string; icon: string; fields: FieldDef[] }[] = [
  {
    id: "doc",
    title: "Document",
    icon: "📄",
    fields: [
      {
        key: "paymentMode",
        label: "Mode de paiement",
        type: "select",
        options: [
          "",
          "Paiement d'avance à la commande",
          "Paiement à la livraison",
          "Paiement à 30 jours",
          "Paiement comptant",
        ],
      },
      {
        key: "deliveryMode",
        label: "Mode de livraison",
        type: "select",
        options: [
          "",
          "Livraison à domicile",
          "À l'emporter",
          "Livraison sur rendez-vous",
        ],
      },
      { key: "leadTime", label: "Délai de livraison", placeholder: "Ex: 25-30 jours" },
    ],
  },
  {
    id: "facturation",
    title: "Adresse de facturation",
    icon: "💳",
    fields: [
      { key: "societe", label: "Société" },
      { key: "nom", label: "Nom" },
      { key: "prenom", label: "Prénom" },
      { key: "complement_nom", label: "Complément nom" },
      { key: "rue", label: "Rue" },
      { key: "numero", label: "N°" },
      { key: "rue2", label: "Complément d'adresse" },
      { key: "npa", label: "NPA" },
      { key: "ville", label: "Ville" },
      { key: "telephone1", label: "Téléphone 1", type: "tel" },
      { key: "telephone2", label: "Téléphone 2", type: "tel" },
      { key: "email", label: "Email", type: "email" },
    ],
  },
  {
    id: "livraison",
    title: "Adresse de livraison",
    icon: "🚚",
    fields: [
      { key: "livrDiff", label: "Adresse de livraison différente", type: "checkbox" },
      { key: "livrSociete", label: "Société livraison" },
      { key: "livrNom", label: "Nom livraison" },
      { key: "livrPrenom", label: "Prénom livraison" },
      { key: "livr_complement_nom", label: "Complément nom livraison" },
      { key: "livrRue", label: "Rue livraison" },
      { key: "livrNumero", label: "N° livraison" },
      { key: "livrRue2", label: "Complément d'adresse livraison" },
      { key: "livrNpa", label: "NPA livraison" },
      { key: "livrVille", label: "Ville livraison" },
      { key: "livrTel", label: "Téléphone livraison", type: "tel" },
      { key: "accesLivraison", label: "Accès livraison / étage", type: "textarea" },
    ],
  },
  {
    id: "notes",
    title: "Informations complémentaires",
    icon: "📝",
    fields: [
      { key: "remarks", label: "Remarques (visibles sur le document)", type: "textarea" },
      { key: "notesInternes", label: "Notes internes (non visibles client)", type: "textarea" },
    ],
  },
];

// ============================================================================
// Helpers
// ============================================================================

function getFieldValue(data: Record<string, unknown>, key: string): unknown {
  const v = data[key];
  if (v === null || v === undefined) return "";
  return v;
}

function normalizeForComparison(v: unknown): string | boolean {
  if (typeof v === "boolean") return v;
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function hasChanged(oldVal: unknown, newVal: unknown): boolean {
  return normalizeForComparison(oldVal) !== normalizeForComparison(newVal);
}

function fieldLabel(key: string): string {
  for (const section of SECTIONS) {
    const f = section.fields.find((f) => f.key === key);
    if (f) return f.label;
  }
  return key;
}

// ============================================================================
// Composant
// ============================================================================

export default function CorrectionDrawer({
  open,
  entityType,
  entitySlug,
  entityNumero,
  currentData,
  onClose,
  onSuccess,
}: Props) {
  const [editedValues, setEditedValues] = useState<Record<string, unknown>>({});
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    doc: true,
    facturation: true,
    livraison: false,
    notes: true,
  });
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);

  // Reset des valeurs éditées à chaque ouverture du drawer
  useEffect(() => {
    if (open) {
      const initial: Record<string, unknown> = {};
      for (const key of CORRECTIBLE_FIELDS_V1) {
        initial[key] = getFieldValue(currentData, key);
      }
      setEditedValues(initial);
      setConfirmModalOpen(false);
    }
  }, [open, currentData]);

  // Bloquer scroll body quand drawer ouvert
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [open]);

  // Calculer les changements
  const fieldsChanged = useMemo(() => {
    const changes: Record<string, FieldChange> = {};
    for (const key of CORRECTIBLE_FIELDS_V1) {
      const oldVal = getFieldValue(currentData, key);
      const newVal = editedValues[key];
      if (hasChanged(oldVal, newVal)) {
        changes[key] = { old: oldVal, new: newVal };
      }
    }
    return changes;
  }, [editedValues, currentData]);

  const hasChanges = Object.keys(fieldsChanged).length > 0;

  if (!open) return null;

  function handleFieldChange(key: string, value: unknown) {
    setEditedValues((prev) => ({ ...prev, [key]: value }));
  }

  function toggleSection(id: string) {
    setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function handleContinue() {
    if (!hasChanges) return;
    setConfirmModalOpen(true);
  }

  function handleConfirmSuccess() {
    setConfirmModalOpen(false);
    onClose();
    onSuccess();
  }

  // Rendu d'un champ selon son type
  function renderField(field: FieldDef) {
    const value = editedValues[field.key];
    const oldValue = getFieldValue(currentData, field.key);
    const isModified = hasChanged(oldValue, value);

    const commonClasses = `w-full rounded-lg border px-3 py-2 text-sm text-zinc-100 outline-none transition ${
      isModified
        ? "border-amber-500/50 bg-amber-500/5 focus:border-amber-500/70"
        : "border-white/10 bg-[#1f2125] focus:border-sky-500/30"
    }`;

    if (field.type === "checkbox") {
      return (
        <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => handleFieldChange(field.key, e.target.checked)}
            className="h-4 w-4 rounded border-white/20 bg-[#1f2125]"
          />
          <span>{field.label}</span>
          {isModified && <span className="ml-1 text-xs text-amber-400">●</span>}
        </label>
      );
    }

    if (field.type === "textarea") {
      return (
        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-400">
            {field.label}
            {isModified && <span className="ml-1 text-amber-400">●</span>}
          </label>
          <textarea
            value={String(value || "")}
            onChange={(e) => handleFieldChange(field.key, e.target.value)}
            rows={3}
            className={commonClasses}
            placeholder={field.placeholder}
            autoComplete="new-password"
          />
        </div>
      );
    }

    if (field.type === "select") {
      return (
        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-400">
            {field.label}
            {isModified && <span className="ml-1 text-amber-400">●</span>}
          </label>
          <select
            value={String(value || "")}
            onChange={(e) => handleFieldChange(field.key, e.target.value)}
            className={commonClasses}
            autoComplete="new-password"
          >
            {(field.options || []).map((opt) => (
              <option key={opt} value={opt}>
                {opt || "—"}
              </option>
            ))}
          </select>
        </div>
      );
    }

    return (
      <div>
        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-400">
          {field.label}
          {isModified && <span className="ml-1 text-amber-400">●</span>}
        </label>
        <input
          type={field.type || "text"}
          value={String(value || "")}
          onChange={(e) => handleFieldChange(field.key, e.target.value)}
          className={commonClasses}
          placeholder={field.placeholder}
          autoComplete="new-password"
        />
      </div>
    );
  }

  const drawerContent = (
    <>
      {/* Overlay sombre */}
      <div
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        role="presentation"
      />

      {/* Drawer panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="correction-drawer-title"
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col bg-[#2a2d31] shadow-2xl border-l border-white/10"
      >
        {/* Header */}
        <div className="border-b border-white/10 px-6 py-4 flex items-center justify-between">
          <div>
            <h2 id="correction-drawer-title" className="text-lg font-semibold text-zinc-100">
              ✏️ Corriger {entityType === "offre" ? "l'offre" : "la commande"}
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500">{entityNumero}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg border border-white/10 bg-[#34383d] px-3 py-1.5 text-sm text-zinc-300 hover:bg-[#40454b]"
            aria-label="Fermer le drawer"
          >
            ✕
          </button>
        </div>

        {/* Banner d'info v1 */}
        <div className="border-b border-white/10 bg-sky-500/5 px-6 py-3">
          <p className="text-xs text-sky-200/90 leading-relaxed">
            ℹ️ Seuls les champs <strong>cosmétiques</strong> (adresses, téléphones, notes) sont
            modifiables. Pour corriger un prix, une quantité ou un autre champ sensible,
            contactez la direction.
          </p>
        </div>

        {/* Modifications en attente */}
        {hasChanges && (
          <div className="border-b border-amber-500/30 bg-amber-500/10 px-6 py-3">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-300">
              Modifications en attente ({Object.keys(fieldsChanged).length})
            </h3>
            <ul className="space-y-1 text-xs text-zinc-300">
              {Object.entries(fieldsChanged).map(([key, change]) => (
                <li key={key} className="flex gap-2 items-start">
                  <span className="text-amber-400 mt-0.5">●</span>
                  <div className="flex-1 min-w-0">
                    <span className="font-medium text-amber-200">{fieldLabel(key)}</span>
                    <div className="text-zinc-400 truncate">
                      <span className="line-through opacity-60">
                        {String(change.old) || "(vide)"}
                      </span>
                      <span className="mx-2 text-amber-400">→</span>
                      <span className="text-zinc-200">
                        {typeof change.new === "boolean"
                          ? change.new
                            ? "Oui"
                            : "Non"
                          : String(change.new) || "(vide)"}
                      </span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Formulaire */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {SECTIONS.map((section) => {
            const isOpen = openSections[section.id];
            const sectionChangeCount = section.fields.filter((f) =>
              hasChanged(getFieldValue(currentData, f.key), editedValues[f.key])
            ).length;

            return (
              <div
                key={section.id}
                className="rounded-xl border border-white/10 bg-[#1f2125]"
              >
                <button
                  onClick={() => toggleSection(section.id)}
                  className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-white/5 transition rounded-xl"
                >
                  <span className="text-sm font-medium text-zinc-200 flex items-center gap-2">
                    <span>{section.icon}</span>
                    {section.title}
                    {sectionChangeCount > 0 && (
                      <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs text-amber-300">
                        {sectionChangeCount} modif{sectionChangeCount > 1 ? "s" : ""}
                      </span>
                    )}
                  </span>
                  <span className="text-zinc-500 text-xs">{isOpen ? "▼" : "▶"}</span>
                </button>
                {isOpen && (
                  <div className="border-t border-white/10 p-4 space-y-3">
                    {section.fields.map((field) => (
                      <div key={field.key}>{renderField(field)}</div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer actions */}
        <div className="border-t border-white/10 bg-[#1f2125] px-6 py-4 flex items-center justify-between gap-3">
          <button
            onClick={onClose}
            className="rounded-xl border border-white/10 bg-[#34383d] px-4 py-2 text-sm text-zinc-300 hover:bg-[#40454b]"
          >
            Annuler
          </button>
          <button
            onClick={handleContinue}
            disabled={!hasChanges}
            className="rounded-xl border border-sky-500/40 bg-sky-500/20 px-4 py-2 text-sm font-medium text-sky-200 transition hover:bg-sky-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Continuer ({Object.keys(fieldsChanged).length}{" "}
            {Object.keys(fieldsChanged).length > 1 ? "modifs" : "modif"}) →
          </button>
        </div>
      </div>

      {/* Modal de confirmation */}
      {confirmModalOpen && (
        <CorrectionConfirmModal
          entityType={entityType}
          entitySlug={entitySlug}
          entityNumero={entityNumero}
          fieldsChanged={fieldsChanged}
          onCancel={() => setConfirmModalOpen(false)}
          onSuccess={handleConfirmSuccess}
        />
      )}
    </>
  );

  // Portal pour éviter les conflits de stacking context (cf. PR #6 brouillons)
  if (typeof window === "undefined") return null;
  return createPortal(drawerContent, document.body);
}