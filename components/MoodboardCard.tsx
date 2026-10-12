"use client";
// components/MoodboardCard.tsx
// Carte « Planche couleurs » du dashboard d'un document (offre ET commande) —
// chantier moodboard, 13.10.2026. Même style que Faisabilite3DCard.
//
// Lecture seule : elle ne modifie jamais le document. Elle montre si la planche
// est ajoutée au document, un aperçu interactif, et le lien vers la page
// publique /planche/[slug] (à copier pour un mail, à réutiliser plus tard).

import React, { useEffect, useState } from "react";
import MoodboardPlanche from "@/components/MoodboardPlanche";
import type { MatiereMoodboard, ModeMoodboard, SensMoodboard } from "@/lib/moodboard";

type Reponse = {
  matieres: MatiereMoodboard[];
  couverture: { articles: number; representes: number };
  numero?: string | null;
  reglages?: { actif: boolean; mode: ModeMoodboard; sens: SensMoodboard };
};

export default function MoodboardCard({ slug, estCommande = false }: { slug: string; estCommande?: boolean }) {
  const [rep, setRep] = useState<Reponse | null>(null);
  const [ouvert, setOuvert] = useState(false);
  const [copie, setCopie] = useState(false);

  useEffect(() => {
    let vivant = true;
    fetch(`/api/offres/${encodeURIComponent(slug)}/matieres`)
      .then((r) => r.json())
      .then((j: Reponse) => { if (vivant) setRep(j); })
      .catch(() => { if (vivant) setRep({ matieres: [], couverture: { articles: 0, representes: 0 } }); });
    return () => { vivant = false; };
  }, [slug]);

  if (!rep) return null;

  const nb = rep.matieres.length;
  const actif = rep.reglages?.actif === true;
  const lien = typeof window !== "undefined" ? `${window.location.origin}/planche/${slug}` : `/planche/${slug}`;

  async function copierLien() {
    try { await navigator.clipboard.writeText(lien); setCopie(true); setTimeout(() => setCopie(false), 2500); }
    catch { window.prompt("Copie manuelle du lien :", lien); }
  }

  const couleur = nb === 0
    ? "border-white/10 bg-[#1f2125]"
    : actif ? "border-emerald-500/30 bg-emerald-500/5" : "border-white/10 bg-[#1f2125]";

  return (
    <section className={`rounded-2xl border p-6 ${couleur}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">🎨 Planche couleurs et matières</h2>
          <p className="mt-1 text-sm text-zinc-300">
            {nb === 0 ? (
              <>Aucune finition reconnue pour les articles de ce document.</>
            ) : (
              <>
                <strong className="text-white">{nb}</strong> finition{nb > 1 ? "s" : ""} ·{" "}
                {rep.couverture.representes}/{rep.couverture.articles} article{rep.couverture.articles > 1 ? "s" : ""} représenté{rep.couverture.representes > 1 ? "s" : ""}
                {" · "}
                {actif ? (
                  <span className="text-emerald-300">{estCommande ? "cochée sur ce document" : "ajoutée en dernière page de l'offre"}</span>
                ) : (
                  <span className="text-zinc-400">non ajoutée au document (aperçu seulement)</span>
                )}
              </>
            )}
          </p>
        </div>
        {nb > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <a href={`/planche/${slug}`} target="_blank" rel="noopener noreferrer" className="rounded-xl border border-sky-500/40 bg-sky-500/20 px-3 py-1.5 text-sm text-sky-200 hover:bg-sky-500/30">
              Ouvrir la page planche ↗
            </a>
            <button type="button" onClick={copierLien} className="rounded-xl border border-white/10 bg-[#2a2d31] px-3 py-1.5 text-xs text-zinc-300 hover:bg-[#34383d]">
              {copie ? "Lien copié ✓" : "Copier le lien client"}
            </button>
            <button type="button" onClick={() => setOuvert((v) => !v)} className="rounded-xl border border-white/10 bg-[#2a2d31] px-3 py-1.5 text-xs text-zinc-300 hover:bg-[#34383d]">
              {ouvert ? "Masquer l'aperçu" : "Voir l'aperçu"}
            </button>
          </div>
        )}
      </div>

      {ouvert && nb > 0 && (
        <div className="mt-4 max-w-[560px] rounded-xl bg-white p-3">
          <MoodboardPlanche
            matieres={rep.matieres}
            couverture={rep.couverture}
            mode={rep.reglages?.mode ?? "poids"}
            sens={rep.reglages?.sens ?? "clair-fonce"}
            interactif
            compact
            mention={false}
          />
        </div>
      )}
    </section>
  );
}
