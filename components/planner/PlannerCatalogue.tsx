"use client";
// components/planner/PlannerCatalogue.tsx
// Panneau de gauche du planner : recherche, marque, collection, vignettes.
//
// Règle du picker (19.09) : quand on trouve un article, on montre TOUTE sa
// collection — on mixe très souvent les articles d'une même collection. Les
// articles sans modèle 3D restent visibles mais grisés, pour voir ce qui
// manque. Source : table modeles_3d via /api/planner/catalogue.

import React, { useEffect, useRef, useState } from "react";
import type { CatalogueItem } from "@/lib/planner-types";

type Marque = { marque: string; avec_3d: number };
type Collection = { collection: string; avec_3d: number; total: number };

export default function PlannerCatalogue({ onAjouter }: { onAjouter: (item: CatalogueItem) => void }) {
  const [marques, setMarques] = useState<Marque[]>([]);
  const [marque, setMarque] = useState("");
  const [collections, setCollections] = useState<Collection[]>([]);
  const [collection, setCollection] = useState("");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<CatalogueItem[]>([]);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState("");
  const requete = useRef(0);

  useEffect(() => {
    fetch("/api/planner/catalogue").then((r) => r.json()).then((j) => setMarques(j.marques || [])).catch(() => {});
  }, []);

  useEffect(() => {
    setCollections([]);
    setCollection("");
    if (!marque) return;
    fetch(`/api/planner/catalogue?marque=${encodeURIComponent(marque)}`)
      .then((r) => r.json())
      .then((j) => setCollections(j.collections || []))
      .catch(() => {});
  }, [marque]);

  // Résultats : recherche texte (≥ 2 caractères) ou collection choisie
  useEffect(() => {
    const id = ++requete.current;
    const sp = new URLSearchParams();
    if (q.trim().length >= 2) {
      sp.set("q", q.trim());
      if (marque) sp.set("marque", marque);
    } else if (marque && collection) {
      sp.set("marque", marque);
      sp.set("collection", collection);
    } else {
      setRows([]);
      return;
    }
    setChargement(true);
    const t = setTimeout(() => {
      fetch(`/api/planner/catalogue?${sp.toString()}`)
        .then((r) => r.json())
        .then((j) => {
          if (id !== requete.current) return;
          if (j.error) throw new Error(j.error);
          setRows(j.rows || []);
          setErreur("");
        })
        .catch((e) => { if (id === requete.current) setErreur((e as Error).message); })
        .finally(() => { if (id === requete.current) setChargement(false); });
    }, 250);
    return () => clearTimeout(t);
  }, [q, marque, collection]);

  // Clic sur un résultat de recherche → ouvre sa collection (règle du picker)
  function ouvrirCollection(r: CatalogueItem) {
    if (!r.marque || !r.collection) return;
    setQ("");
    setMarque(r.marque);
    // la liste des collections se recharge via l'effet ; on pose la valeur après
    setTimeout(() => setCollection(r.collection || ""), 0);
  }

  const avec3d = rows.filter((r) => r.has_3d).length;

  return (
    <aside className="flex h-full w-[340px] shrink-0 flex-col border-r border-white/10 bg-[#25282c]">
      <div className="space-y-2 border-b border-white/10 p-3">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Chercher un article, une collection…"
          className="w-full rounded-xl border border-white/10 bg-[#1f2125] px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none focus:border-sky-500/50"
        />
        <select
          value={marque}
          onChange={(e) => setMarque(e.target.value)}
          className="w-full rounded-xl border border-white/10 bg-[#1f2125] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-sky-500/50"
        >
          <option value="">Toutes les marques</option>
          {marques.map((m) => (
            <option key={m.marque} value={m.marque}>{m.marque} ({m.avec_3d})</option>
          ))}
        </select>
        {marque && collections.length > 0 && q.trim().length < 2 && (
          <div className="max-h-44 overflow-y-auto rounded-xl border border-white/10 bg-[#1f2125]">
            {collections.map((c) => (
              <button
                key={c.collection}
                type="button"
                onClick={() => setCollection(c.collection === collection ? "" : c.collection)}
                className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-xs transition hover:bg-white/5 ${c.collection === collection ? "bg-sky-500/15 text-sky-200" : c.avec_3d === 0 ? "text-zinc-600" : "text-zinc-300"}`}
              >
                <span className="truncate">{c.collection}</span>
                <span className="ml-2 shrink-0 text-[10px] text-zinc-500">{c.avec_3d}/{c.total}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {erreur && <div className="mb-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-xs text-rose-200">{erreur}</div>}
        {rows.length === 0 && !chargement && (
          <p className="px-1 text-xs text-zinc-500">
            Choisis une marque puis une collection, ou tape un mot. Un clic sur une vignette pose l&apos;article au centre de la terrasse.
          </p>
        )}
        {rows.length > 0 && (
          <div className="mb-2 flex items-center justify-between text-[11px] text-zinc-500">
            <span>{collection ? `Collection ${collection}` : "Résultats"}</span>
            <span>{avec3d} modèle{avec3d > 1 ? "s" : ""} 3D / {rows.length}</span>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          {rows.map((r) => (
            <div key={r.product_id} className={`group relative rounded-xl border p-1.5 ${r.has_3d ? "border-white/10 bg-[#1f2125]" : "border-white/5 bg-[#1f2125]/50 opacity-45"}`}>
              <button
                type="button"
                disabled={!r.has_3d}
                onClick={() => onAjouter(r)}
                title={r.has_3d ? "Poser dans la scène" : "Pas de modèle 3D pour cet article"}
                className="block w-full text-left disabled:cursor-not-allowed"
              >
                <div className="aspect-square w-full overflow-hidden rounded-lg bg-white">
                  {r.image_url ? <img src={r.image_url} alt="" className="h-full w-full object-contain" loading="lazy" /> : null}
                </div>
                <div className="mt-1 line-clamp-2 text-[11px] leading-tight text-zinc-200">{r.titre}</div>
                <div className="mt-0.5 flex flex-wrap gap-1">
                  {r.has_3d && <span className="rounded bg-emerald-500/20 px-1 text-[9px] text-emerald-300">3D</span>}
                  {r.size_mismatch_possible && <span className="rounded bg-amber-500/20 px-1 text-[9px] text-amber-300" title="Option de taille sur la fiche : rendu indicatif">taille ?</span>}
                  {r.color_mismatch_possible && <span className="rounded bg-amber-500/20 px-1 text-[9px] text-amber-300" title="Option de couleur sur la fiche : rendu indicatif">couleur ?</span>}
                </div>
              </button>
              {q.trim().length >= 2 && r.collection && (
                <button
                  type="button"
                  onClick={() => ouvrirCollection(r)}
                  className="absolute right-1 top-1 hidden rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-sky-200 group-hover:block"
                  title={`Voir toute la collection ${r.collection}`}
                >
                  collection ›
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
