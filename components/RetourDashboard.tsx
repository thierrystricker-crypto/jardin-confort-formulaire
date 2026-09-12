// components/RetourDashboard.tsx
// Bouton de retour au dashboard — UN seul endroit et UN seul style pour toutes
// les pages : première ligne de la page, à gauche (13.09.2026, les vendeurs le
// cherchaient tantôt à droite, tantôt à gauche, tantôt en lien texte).
// `children` : liens contextuels à garder à côté (← Fichier clients, ⏱ Délais…).

import React from "react";
import Link from "next/link";

export const CLASSE_BOUTON_NAV =
  "inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-[#34383d] px-4 py-2 text-sm text-zinc-100 transition hover:bg-[#40454b]";

export default function RetourDashboard({ children }: { children?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <Link href="/dashboard" className={CLASSE_BOUTON_NAV}>← Dashboard</Link>
      {children}
    </div>
  );
}
