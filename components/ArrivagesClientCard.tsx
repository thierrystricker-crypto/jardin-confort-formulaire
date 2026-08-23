"use client";
// components/ArrivagesClientCard.tsx
// Carte « Arrivages » de la FICHE CLIENT (chantier Arrivages, 23.08) : pour
// les commandes récentes encore ouvertes du client, ce qui est déjà arrivé —
// la réponse à « où en est ma commande ? » quand le client appelle, sans
// ouvrir chaque commande. Une requête filtrée par commande (8 au plus).

import React, { useEffect, useState } from "react";
import Link from "next/link";

type Cible = { boutique: "magasin"|"jardin-confort.ch"; numero: string; url?: string };
type Resume = {
  cible: Cible
  couvertes: number; total: number; attendues: number
  dernier: string|null
};

function fmtDate(iso: string|null|undefined) {
  if (!iso) return null;
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00Z`);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString("fr-CH", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function ArrivagesClientCard({ cibles }: { cibles: Cible[] }) {
  const [resumes, setResumes] = useState<Resume[]|null>(null);

  useEffect(() => {
    let actif = true;
    const aCharger = cibles.slice(0, 8);
    if (!aCharger.length) { setResumes([]); return; }
    Promise.all(aCharger.map(async (c): Promise<Resume|null> => {
      try {
        const r = await fetch(`/api/arrivages?boutique=${encodeURIComponent(c.boutique)}&numero=${encodeURIComponent(c.numero)}`);
        if (!r.ok) return null;
        const j = await r.json();
        const lignes: {etat: string; mode_ligne: string; qty_restante: number; derniere_reception: string|null}[] = j.commande?.lignes || [];
        if (!lignes.length) return null;
        return {
          cible: c,
          total: lignes.length,
          couvertes: lignes.filter(l => l.etat === "complete" || l.etat === "excedent").length,
          attendues: lignes.filter(l => Number(l.qty_restante) > 0).length,
          dernier: lignes.map(l => l.derniere_reception).filter(Boolean).sort().pop() || null,
        };
      } catch { return null; }
    })).then(rs => { if (actif) setResumes(rs.filter(Boolean) as Resume[]); });
    return () => { actif = false; };
  }, [cibles]);

  if (resumes && resumes.length === 0) return null;

  return (
    <section className="rounded-2xl border border-emerald-500/20 bg-[#2a2d31] p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">📦 Arrivages — commandes en cours</h2>
          <p className="text-xs text-zinc-500">Ce qui est déjà arrivé chez nous, par commande — distinct de la livraison au client.</p>
        </div>
        <Link href="/dashboard/arrivages"
          className="rounded-xl border border-emerald-400/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/25">
          📦 Page Arrivages →
        </Link>
      </div>

      {!resumes && <div className="text-sm text-zinc-500">Chargement…</div>}

      <div className="space-y-2">
        {(resumes || []).map(r => {
          const tout = r.attendues === 0;
          const rien = r.couvertes === 0;
          return (
            <div key={`${r.cible.boutique}|${r.cible.numero}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-white/5 bg-[#1f2125] px-4 py-2.5 text-sm">
              {r.cible.url
                ? <Link href={r.cible.url} className="font-semibold text-zinc-100 hover:text-sky-300">{r.cible.numero}</Link>
                : <span className="font-semibold text-zinc-100">{r.cible.numero}</span>}
              <span className="text-xs text-zinc-500">{r.cible.boutique === "magasin" ? "Mag" : "web"}</span>
              <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${tout ? "bg-emerald-500/20 text-emerald-200" : rien ? "bg-sky-500/15 text-sky-200" : "bg-amber-500/15 text-amber-200"}`}>
                {tout ? "✅ Tout est là" : rien ? "⏳ Rien d'arrivé" : `${r.couvertes}/${r.total} lignes là`}
              </span>
              {!tout && r.attendues > 0 && <span className="text-xs text-zinc-400">{r.attendues} ligne{r.attendues > 1 ? "s" : ""} attendue{r.attendues > 1 ? "s" : ""}</span>}
              {r.dernier && <span className="text-xs text-zinc-500">dernier arrivage le {fmtDate(r.dernier)}</span>}
              <Link href={`/dashboard/arrivages?q=${encodeURIComponent(r.cible.numero)}`}
                className="ml-auto rounded-lg border border-white/10 bg-[#2a2d31] px-2 py-0.5 text-xs text-zinc-300 hover:bg-[#34383d]">détail →</Link>
            </div>
          );
        })}
      </div>
    </section>
  );
}
