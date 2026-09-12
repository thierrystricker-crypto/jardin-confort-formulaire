"use client";
// components/ListeAchatLignes.tsx
// Tableau ÉDITABLE des lignes d'une liste d'achat — partagé par le panneau de
// la Stock list et par la page /dashboard/listes-achat.
//   - quantités ± / saisie, retrait
//   - réordonner : flèches ▲▼ et glisser-déposer à la souris
//   - « article à la volée » : titre, SKU libre, prix TTC, quantité (fournisseur
//     « Libre », variant_id null → ligne custom du brouillon)
// Les prix Shopify ne sont jamais stockés : `prix` (facultatif) n'est utilisé
// que pour l'affichage indicatif des variantes déjà vues dans le tableau.

import React, { useState } from "react";
import { cleLigne, nouvelleLigneLibre, FOURNISSEUR_LIBRE, type LigneListe } from "@/lib/listes-achat";

type Props = {
  lignes: LigneListe[];
  onChange: (lignes: LigneListe[]) => void;
  prix?: Record<string, number | null>;
  hauteur?: string; // classe Tailwind de hauteur du tableau, ex. "h-[46vh]"
};

export function fmtCHF(n: number) {
  return `CHF ${n.toLocaleString("fr-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function ListeAchatLignes({ lignes, onChange, prix = {}, hauteur = "max-h-[60vh]" }: Props) {
  const [drag, setDrag] = useState<number | null>(null);
  const [survol, setSurvol] = useState<number | null>(null);
  const [libre, setLibre] = useState({ titre: "", sku: "", prix: "", qty: "1" });
  const [libreOuvert, setLibreOuvert] = useState(false);

  function maj(i: number, patch: Partial<LigneListe>) {
    onChange(lignes.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }
  function qty(i: number, valeur: number) {
    const n = Math.max(0, Math.min(999, Math.round(valeur)));
    if (n === 0) onChange(lignes.filter((_, j) => j !== i));
    else maj(i, { qty: n });
  }
  function deplacer(de: number, vers: number) {
    if (de === vers || vers < 0 || vers >= lignes.length) return;
    const copie = [...lignes];
    const [x] = copie.splice(de, 1);
    copie.splice(vers, 0, x);
    onChange(copie);
  }
  function ajouterLibre() {
    if (!libre.titre.trim()) return;
    const p = libre.prix.trim() === "" ? null : Math.max(0, Number(libre.prix.replace(",", ".")) || 0);
    onChange([...lignes, nouvelleLigneLibre(libre.titre, libre.sku, parseInt(libre.qty || "1", 10) || 1, p)]);
    setLibre({ titre: "", sku: "", prix: "", qty: "1" });
  }

  return (
    <div>
      {lignes.length === 0 ? (
        <div className="flex h-32 items-center justify-center rounded-xl border border-dashed border-white/10 text-sm text-zinc-500">
          Liste vide — ajoute des articles avec le bouton « + » de la Stock list, ou un article à la volée ci-dessous.
        </div>
      ) : (
        <div className={`${hauteur} overflow-y-auto rounded-xl border border-white/10 bg-[#25282c]`}>
          <table className="w-full text-sm">
            <tbody>
              {lignes.map((l, i) => {
                const cle = cleLigne(l);
                const libre = l.fournisseur === FOURNISSEUR_LIBRE;
                const p = libre ? (typeof l.prix === "number" ? l.prix : null) : prix[cle];
                return (
                  <tr
                    key={cle}
                    draggable
                    onDragStart={() => setDrag(i)}
                    onDragOver={(e) => { e.preventDefault(); setSurvol(i); }}
                    onDragLeave={() => setSurvol((s) => (s === i ? null : s))}
                    onDrop={(e) => { e.preventDefault(); if (drag !== null) deplacer(drag, i); setDrag(null); setSurvol(null); }}
                    onDragEnd={() => { setDrag(null); setSurvol(null); }}
                    className={`border-b border-white/5 ${drag === i ? "opacity-40" : ""} ${survol === i && drag !== null && drag !== i ? "bg-sky-500/10" : ""}`}
                  >
                    <td className="w-8 cursor-grab px-1 py-1.5 text-center text-zinc-600 active:cursor-grabbing" title="Glisser pour déplacer">⋮⋮</td>
                    <td className="w-9 px-0 py-1.5">
                      <div className="flex flex-col items-center gap-0.5">
                        <button type="button" onClick={() => deplacer(i, i - 1)} disabled={i === 0} className="h-4 w-6 rounded text-[10px] leading-none text-zinc-400 hover:bg-white/10 disabled:opacity-20" title="Monter">▲</button>
                        <button type="button" onClick={() => deplacer(i, i + 1)} disabled={i === lignes.length - 1} className="h-4 w-6 rounded text-[10px] leading-none text-zinc-400 hover:bg-white/10 disabled:opacity-20" title="Descendre">▼</button>
                      </div>
                    </td>
                    <td className="w-12 px-2 py-1.5">
                      <div className="h-9 w-9 overflow-hidden rounded-md bg-white">
                        {l.image_url
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={l.image_url} alt="" className="h-full w-full object-contain" />
                          : <div className="flex h-full w-full items-center justify-center bg-white/5 text-zinc-600">{libre ? "✎" : "×"}</div>}
                      </div>
                    </td>
                    <td className="w-40 px-2 py-1.5 text-[13px] tracking-wide text-zinc-300">{l.sku}</td>
                    <td className="px-2 py-1.5">
                      {libre ? (
                        <input
                          value={l.titre || ""}
                          onChange={(e) => maj(i, { titre: e.target.value })}
                          className="w-full rounded border border-white/10 bg-[#1f2125] px-2 py-0.5 text-zinc-100 outline-none focus:border-sky-500/50"
                        />
                      ) : (
                        <div className="text-zinc-100">
                          {l.titre || <span className="italic text-zinc-500">Hors Shopify — {l.fournisseur} {l.sku}</span>}
                          {l.variante_titre && <span className="ml-2 text-sky-200/80">{l.variante_titre}</span>}
                        </div>
                      )}
                      <div className="text-[11px] text-zinc-500">
                        {libre ? "Article à la volée · ligne libre du brouillon" : l.fournisseur}
                        {!libre && !l.variant_id ? " · sera une ligne libre du brouillon" : ""}
                        {l.statut_fiche === "DRAFT" ? " · fiche brouillon" : ""}
                      </div>
                    </td>
                    <td className="w-32 px-2 py-1.5 text-right tabular-nums text-zinc-300">
                      {libre ? (
                        <input
                          value={typeof l.prix === "number" ? String(l.prix) : ""}
                          onChange={(e) => maj(i, { prix: e.target.value.trim() === "" ? null : Math.max(0, Number(e.target.value.replace(",", ".")) || 0) })}
                          placeholder="prix TTC"
                          className="w-24 rounded border border-white/10 bg-[#1f2125] px-2 py-0.5 text-right text-zinc-100 outline-none focus:border-sky-500/50"
                        />
                      ) : typeof p === "number" ? fmtCHF(p) : <span className="text-zinc-600">—</span>}
                    </td>
                    <td className="w-32 px-2 py-1.5">
                      <div className="flex items-center justify-end gap-1">
                        <button type="button" onClick={() => qty(i, l.qty - 1)} className="h-6 w-6 rounded border border-white/10 text-zinc-300 hover:bg-white/10">−</button>
                        <input value={l.qty} onChange={(e) => qty(i, Number(e.target.value) || 0)} className="w-10 rounded border border-white/10 bg-[#1f2125] px-1 py-0.5 text-center text-xs text-zinc-100" />
                        <button type="button" onClick={() => qty(i, l.qty + 1)} className="h-6 w-6 rounded border border-white/10 text-zinc-300 hover:bg-white/10">+</button>
                      </div>
                    </td>
                    <td className="w-8 px-1 py-1.5 text-right">
                      <button type="button" onClick={() => qty(i, 0)} className="text-zinc-500 hover:text-rose-300" title="Retirer">✕</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Article à la volée */}
      <div className="mt-2">
        {!libreOuvert ? (
          <button type="button" onClick={() => setLibreOuvert(true)} className="text-xs text-sky-300 hover:underline">✎ Ajouter un article à la volée</button>
        ) : (
          <div className="flex flex-wrap items-end gap-2 rounded-xl border border-white/10 bg-[#25282c] p-2">
            <label className="flex min-w-[240px] flex-1 flex-col text-[11px] text-zinc-500">Désignation *
              <input value={libre.titre} onChange={(e) => setLibre({ ...libre, titre: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") ajouterLibre(); }} placeholder="Ex : Housse sur mesure 300x300" className="rounded border border-white/10 bg-[#1f2125] px-2 py-1 text-sm text-zinc-100 outline-none focus:border-sky-500/50" />
            </label>
            <label className="flex w-36 flex-col text-[11px] text-zinc-500">SKU libre
              <input value={libre.sku} onChange={(e) => setLibre({ ...libre, sku: e.target.value })} placeholder="auto" className="rounded border border-white/10 bg-[#1f2125] px-2 py-1 text-sm text-zinc-100 outline-none focus:border-sky-500/50" />
            </label>
            <label className="flex w-28 flex-col text-[11px] text-zinc-500">Prix TTC
              <input value={libre.prix} onChange={(e) => setLibre({ ...libre, prix: e.target.value })} placeholder="0.00" className="rounded border border-white/10 bg-[#1f2125] px-2 py-1 text-right text-sm text-zinc-100 outline-none focus:border-sky-500/50" />
            </label>
            <label className="flex w-16 flex-col text-[11px] text-zinc-500">Qté
              <input value={libre.qty} onChange={(e) => setLibre({ ...libre, qty: e.target.value })} className="rounded border border-white/10 bg-[#1f2125] px-2 py-1 text-center text-sm text-zinc-100 outline-none focus:border-sky-500/50" />
            </label>
            <button type="button" onClick={ajouterLibre} disabled={!libre.titre.trim()} className="rounded-lg border border-sky-500/40 bg-sky-500/15 px-3 py-1.5 text-sm text-sky-200 hover:bg-sky-500/30 disabled:opacity-40">+ Ajouter</button>
            <button type="button" onClick={() => setLibreOuvert(false)} className="text-xs text-zinc-500 hover:text-zinc-300">fermer</button>
          </div>
        )}
      </div>
    </div>
  );
}
