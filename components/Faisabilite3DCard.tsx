"use client";
// components/Faisabilite3DCard.tsx
// Card « Faisabilité 3D » sur les pages brouillon / offre / commande (étape 3
// du planner, 21.09.2026). Lecture seule : elle interroge
// /api/planner/faisabilite (qui relit les lignes en base à chaque affichage,
// donc suit les révisions) et propose d'ouvrir le planner pré-rempli. Elle ne
// modifie jamais le document.
//
//   « 5/8 articles de cette offre sont disponibles pour un plan-rendu en 3D.
//     Ouvrir le planner avec les articles de cette commande. »

import React, { useEffect, useState } from "react";

type Ligne = {
  id: string; title: string; sku_ligne: string; qty: number; image: string | null;
  has_3d: boolean; size_warn: boolean; color_warn: boolean; marque: string | null; par: "variante" | "sku" | null;
};
type Reponse = { total: number; avec_3d: number; lignes: Ligne[]; numero: string | null; type_document: string; error?: string };
type SceneLiee = { id: string; nom: string; updated_at: string; nb_items: number };

export default function Faisabilite3DCard({ type, slug }: { type: "offre" | "brouillon"; slug: string }) {
  const [rep, setRep] = useState<Reponse | null>(null);
  const [scenes, setScenes] = useState<SceneLiee[]>([]);
  const [ouvert, setOuvert] = useState(false);
  const [erreur, setErreur] = useState("");

  useEffect(() => {
    let vivant = true;
    fetch(`/api/planner/faisabilite?type=${type}&slug=${encodeURIComponent(slug)}`)
      .then((r) => r.json())
      .then((j) => { if (!vivant) return; if (j.error) setErreur(j.error); else setRep(j); })
      .catch((e) => vivant && setErreur((e as Error).message));
    fetch(`/api/planner/scenes?offre_slug=${encodeURIComponent(slug)}`)
      .then((r) => r.json())
      .then((j) => { if (vivant && Array.isArray(j.scenes)) setScenes(j.scenes); })
      .catch(() => {});
    return () => { vivant = false; };
  }, [type, slug]);

  if (erreur) return null;                       // la card ne doit jamais gêner la page
  if (!rep || rep.total === 0) return null;      // rien à dire sans ligne produit

  const manquants = rep.lignes.filter((l) => !l.has_3d);
  const avert = rep.lignes.filter((l) => l.has_3d && (l.size_warn || l.color_warn)).length;
  const ratio = rep.avec_3d / rep.total;
  const couleur = rep.avec_3d === 0 ? "border-white/10 bg-[#2a2d31]" : ratio === 1 ? "border-emerald-500/30 bg-emerald-500/5" : "border-sky-500/30 bg-sky-500/5";
  const nomDoc = rep.type_document === "Commande" ? "cette commande" : type === "brouillon" ? "ce brouillon" : "cette offre";
  const hrefPlanner = `/planner?depuis=${type}:${encodeURIComponent(slug)}`;

  return (
    <section className={`rounded-2xl border p-6 ${couleur}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">🧊 Faisabilité 3D</h2>
          <p className="mt-1 text-sm text-zinc-300">
            <strong className="text-white">{rep.avec_3d}/{rep.total}</strong> article{rep.total > 1 ? "s" : ""} de {nomDoc} {rep.avec_3d > 1 ? "sont disponibles" : "est disponible"} pour un plan-rendu en 3D.
            {avert > 0 && <span className="text-amber-300"> {avert} avec taille ou couleur indicative.</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {rep.avec_3d > 0 && (
            <a href={hrefPlanner} className="rounded-xl border border-sky-500/40 bg-sky-500/20 px-3 py-1.5 text-sm text-sky-200 hover:bg-sky-500/30">
              🪑 Ouvrir le planner avec {rep.avec_3d > 1 ? "ces articles" : "cet article"}
            </a>
          )}
          <button type="button" onClick={() => setOuvert((v) => !v)} className="rounded-xl border border-white/10 bg-[#2a2d31] px-3 py-1.5 text-xs text-zinc-300 hover:bg-[#34383d]">
            {ouvert ? "Masquer le détail" : "Détail"}
          </button>
        </div>
      </div>

      {scenes.length > 0 && (
        <div className="mt-3 text-sm text-zinc-300">
          <span className="text-zinc-400">Plan{scenes.length > 1 ? "s" : ""} déjà lié{scenes.length > 1 ? "s" : ""} : </span>
          {scenes.map((s, i) => (
            <span key={s.id}>
              {i > 0 && " · "}
              <a href={`/planner?scene=${s.id}`} className="text-sky-300 underline">{s.nom}</a>
              <span className="text-zinc-500"> ({s.nb_items} art.)</span>
            </span>
          ))}
        </div>
      )}

      {ouvert && (
        <div className="mt-4 space-y-1 text-sm">
          {rep.lignes.map((l) => (
            <div key={l.id} className="flex items-center gap-2 rounded-lg bg-black/20 px-2 py-1">
              <span className={`w-8 shrink-0 rounded px-1 text-center text-[10px] ${l.has_3d ? "bg-emerald-500/20 text-emerald-300" : "bg-white/10 text-zinc-500"}`}>{l.has_3d ? "3D" : "—"}</span>
              <span className="w-8 shrink-0 text-right text-zinc-400">× {l.qty}</span>
              <span className="min-w-0 flex-1 truncate">{l.title}</span>
              <span className="shrink-0 text-xs text-zinc-500">{l.sku_ligne}</span>
              {l.has_3d && l.size_warn && <span className="shrink-0 rounded bg-amber-500/20 px-1 text-[10px] text-amber-300">taille ?</span>}
              {l.has_3d && l.color_warn && <span className="shrink-0 rounded bg-amber-500/20 px-1 text-[10px] text-amber-300">couleur ?</span>}
            </div>
          ))}
          {manquants.length > 0 && (
            <p className="pt-2 text-xs text-zinc-500">
              Sans modèle 3D : {[...new Set(manquants.map((l) => l.marque).filter(Boolean))].join(", ") || "marques non indexées"} — à compléter dans la bibliothèque.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
