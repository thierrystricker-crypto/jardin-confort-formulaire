"use client";
// app/dashboard/winbiz-adresses/page.tsx
// Chantier « Export Winbiz » — chargement du fichier clients Winbiz, plein écran.
// Toute la logique est dans components/WinbizAdressesCard.tsx (partagée avec
// la page /dashboard/comptabilite).

import React from "react";
import Link from "next/link";
import WinbizAdressesCard from "@/components/WinbizAdressesCard";
import RetourDashboard from "@/components/RetourDashboard";

export default function WinbizAdressesPage() {
  return (
    <main className="min-h-screen bg-[#1f2125]">
      <div className="mx-auto max-w-4xl px-4 py-8 text-zinc-100">
        <RetourDashboard>
          <Link href="/dashboard/comptabilite" className="text-sm text-zinc-400 hover:text-zinc-200">🧾 Comptabilité</Link>
        </RetourDashboard>
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">🏦 Fichier clients Winbiz</h1>
            <p className="mt-1 text-sm text-zinc-400">
              Alimente l&apos;attribution des exports Winbiz. À recharger avant une séance
              d&apos;import : les codes adresse changent par exercice.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
          </div>
        </div>
        <WinbizAdressesCard />
      </div>
    </main>
  );
}
