"use client";
// components/AnnonceStockPopup.tsx
// Popup d'annonce temporaire pour l'équipe : bug de sortie de stock Shopify
// (30.07 → 07.08.2026) découvert et corrigé. Affiché sur le dashboard principal.
//
// Basé sur le template OnboardingDraftPopup (PR #5) : date butoir codée en dur,
// affiché à chaque visite, pas de localStorage.
// Disparaît automatiquement après le lundi 10.08.2026 (inclus).

import React, { useEffect, useState } from "react";

const SHOW_UNTIL = new Date("2026-08-11T00:00:00Z"); // exclusif : popup actif jusqu'au lundi 10 août inclus

export default function AnnonceStockPopup() {
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
      aria-labelledby="annonce-stock-title"
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
          id="annonce-stock-title"
          className="mb-4 text-2xl font-semibold text-zinc-100"
        >
          📦 Information — sorties de stock Shopify
        </h2>

        {/* Corps */}
        <div className="space-y-4 text-sm leading-relaxed text-zinc-300">
          <p>
            Une erreur de fonctionnement a été découverte dans le système :
            depuis la mise en place du{" "}
            <strong className="text-[#2B8AD1]">code d&apos;accès de
            l&apos;application</strong> (30 juillet), les sorties de stock
            automatiques vers Shopify ne se faisaient plus.
          </p>

          <p>
            Les commandes créées{" "}
            <strong className="text-amber-300">
              entre le 30 juillet et le 7 août
            </strong>{" "}
            (CMD-80852 à CMD-80883) n&apos;avaient donc pas été déduites de
            l&apos;inventaire.
          </p>

          <p>
            <strong className="text-emerald-300">
              Tout a été corrigé le 7 août :
            </strong>{" "}
            le bug est réparé et l&apos;inventaire Shopify a été entièrement
            mis à jour. Aucune action n&apos;est nécessaire de votre part.
          </p>

          <p className="text-zinc-400">
            Si un stock vous semble étrange sur une commande de cette période,
            signalez-le à Thierry.
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
