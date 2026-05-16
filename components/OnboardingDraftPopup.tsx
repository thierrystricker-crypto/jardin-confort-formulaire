"use client";
// components/OnboardingDraftPopup.tsx
// Popup d'onboarding affiché à chaque ouverture de /drafts/nouveau
// pour expliquer à l'équipe le nouveau parcours brouillon → offre.
//
// Disparaît automatiquement après le 2026-05-21 (5 jours d'onboarding).
// Pas de localStorage : volontairement simple, affiché à chaque visite
// jusqu'à la date butoir.

import React, { useEffect, useState } from "react";

const SHOW_UNTIL = new Date("2026-05-22T00:00:00Z"); // exclusif : popup actif jusqu'au 21 mai inclus

export default function OnboardingDraftPopup() {
  const [open, setOpen] = useState(false);

  // Vérification de la date à l'ouverture
  useEffect(() => {
    if (new Date() < SHOW_UNTIL) {
      setOpen(true);
    }
  }, []);

  // Fermeture par Escape
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={() => setOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
    >
      <div
        className="relative w-full max-w-lg rounded-2xl border border-white/10 bg-[#2a2d31] p-8 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Bouton fermer en haut-droite */}
        <button
          onClick={() => setOpen(false)}
          className="absolute top-4 right-4 flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 transition hover:bg-white/10 hover:text-zinc-100"
          aria-label="Fermer"
        >
          ✕
        </button>

        {/* Titre */}
        <h2
          id="onboarding-title"
          className="mb-4 text-2xl font-semibold text-zinc-100"
        >
          🎉 Bienvenue dans le nouveau système de création d'offres
        </h2>

        {/* Corps */}
        <div className="space-y-4 text-sm leading-relaxed text-zinc-300">
          <p>
            À partir de maintenant, vous rédigez d'abord un{" "}
            <strong className="text-[#2B8AD1]">brouillon</strong> (DRA-XXX)
            que vous pouvez modifier et dupliquer à volonté.
          </p>

          <p>
            Quand votre brouillon est prêt, vous le{" "}
            <strong className="text-[#2B8AD1]">transformez en offre</strong>{" "}
            définitive (DEV-XXXX) — l'offre est non modifiable et peut être
            partagée au client comme d'habitude.
          </p>

          <p>
            <strong className="text-emerald-300">Bonus :</strong> n'importe
            quelle offre, commande ou autre brouillon peut être{" "}
            <strong className="text-emerald-300">
              dupliquée en nouveau brouillon
            </strong>{" "}
            depuis son dashboard.
          </p>
        </div>

        {/* Bouton OK */}
        <div className="mt-6 flex justify-end">
          <button
            onClick={() => setOpen(false)}
            className="rounded-xl bg-[#2B8AD1] px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-[#2478b8]"
          >
            Compris
          </button>
        </div>
      </div>
    </div>
  );
}