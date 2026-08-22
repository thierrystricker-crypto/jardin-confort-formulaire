"use client";
// components/ArrivagesBlock.tsx
// Bloc « Arrivages » de la page commande du dashboard (chantier Arrivages,
// étape 3) : ce qui est DÉJÀ arrivé, ligne par ligne, avec les dates — ce
// qu'on dit au client qui appelle. Lecture seule : la saisie se fait sur
// /dashboard/arrivages (scan de la fiche de travail). Source : GET
// /api/arrivages?boutique=…&numero=… (v_receptions_commande + mouvements).

import React, { useEffect, useState } from "react";
import Link from "next/link";
import type { CommandeArrivage } from "@/lib/arrivages";

function fmtDate(iso: string|null|undefined) {
  if (!iso) return "—";
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00Z`);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("fr-CH", { day: "2-digit", month: "2-digit", year: "numeric" });
}
function n(v: number) { return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, ""); }

export default function ArrivagesBlock({ boutique, numero }: { boutique: "magasin"|"jardin-confort.ch"; numero: string }) {
  const [commande, setCommande] = useState<CommandeArrivage|null>(null);
  const [erreur, setErreur] = useState("");
  const [chargement, setChargement] = useState(true);

  useEffect(() => {
    let actif = true;
    setChargement(true);
    fetch(`/api/arrivages?boutique=${encodeURIComponent(boutique)}&numero=${encodeURIComponent(numero)}`)
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error || `Erreur ${r.status}`); return j; })
      .then(j => { if (actif) { setCommande(j.commande || null); setErreur(""); } })
      .catch(e => { if (actif) setErreur((e as Error).message); })
      .finally(() => { if (actif) setChargement(false); });
    return () => { actif = false; };
  }, [boutique, numero]);

  const lignes = commande?.lignes || [];
  const couvertes = lignes.filter(l => l.etat === "complete" || l.etat === "excedent").length;
  const enStock = lignes.filter(l => l.mode_ligne === "en_stock").length;
  const attendues = lignes.filter(l => l.qty_restante > 0).length;
  const derniere = lignes.reduce<string|null>((acc, l) => (l.derniere_reception && (!acc || l.derniere_reception > acc) ? l.derniere_reception : acc), null);

  return (
    <section className="rounded-2xl border border-white/10 bg-[#2a2d31] p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">📦 Arrivages</h2>
          <p className="text-xs text-zinc-500">Ce qui est déjà arrivé chez nous, ligne par ligne — indépendant de la livraison au client.</p>
        </div>
        <Link href={`/dashboard/arrivages?q=${encodeURIComponent(numero)}`}
          className="rounded-xl border border-emerald-400/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/25">
          📦 Saisir une réception →
        </Link>
      </div>

      {chargement && <div className="text-sm text-zinc-500">Chargement…</div>}
      {erreur && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">{erreur}</div>}

      {commande && (
        <>
          <div className="mb-3 flex flex-wrap gap-2 text-sm">
            <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${attendues === 0 ? "bg-emerald-500/20 text-emerald-200" : couvertes > 0 ? "bg-amber-500/15 text-amber-200" : "bg-zinc-500/15 text-zinc-300"}`}>
              {attendues === 0 ? "✅ Tout est là" : `${couvertes}/${lignes.length} lignes couvertes — ${attendues} en attente`}
            </span>
            {enStock > 0 && <span className="inline-flex items-center rounded-full bg-zinc-500/15 px-3 py-1 text-xs text-zinc-300">🏬 {enStock} en stock à la commande</span>}
            {derniere && <span className="inline-flex items-center rounded-full bg-sky-500/15 px-3 py-1 text-xs text-sky-200">dernier arrivage le {fmtDate(derniere)}</span>}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-zinc-500">
                  <th className="py-2 pr-3">Article</th>
                  <th className="py-2 pr-3">Marque</th>
                  <th className="py-2 pr-3 text-right">Cmd</th>
                  <th className="py-2 pr-3 text-right">Stock</th>
                  <th className="py-2 pr-3 text-right">Reçu</th>
                  <th className="py-2 pr-3">État</th>
                  <th className="py-2">Dernier arrivage</th>
                </tr>
              </thead>
              <tbody>
                {lignes.map(l => (
                  <tr key={l.position} className="border-t border-white/5">
                    <td className="py-2 pr-3 text-zinc-200"><span className="mr-1 text-zinc-500">{l.position}.</span>{l.titre || l.sku || "—"}</td>
                    <td className="py-2 pr-3 text-zinc-400">{l.marque || <span className="text-amber-300/70">à la volée</span>}</td>
                    <td className="py-2 pr-3 text-right">{n(l.qty_commandee)}</td>
                    <td className="py-2 pr-3 text-right text-zinc-400">{l.qty_stock_cmd > 0 ? n(l.qty_stock_cmd) : l.stock_cmd === "sur_commande" ? <span className="text-xs">sur cmd</span> : "—"}</td>
                    <td className={`py-2 pr-3 text-right font-semibold ${l.qty_recue_totale > 0 ? "text-emerald-300" : "text-zinc-500"}`}>{l.qty_recue_totale !== 0 ? n(l.qty_recue_totale) : "—"}</td>
                    <td className="py-2 pr-3">
                      {l.mode_ligne === "en_stock" ? <span className="rounded-full bg-zinc-500/15 px-2 py-0.5 text-xs text-zinc-300">🏬 en stock</span>
                        : l.etat === "complete" || l.etat === "excedent" ? <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs text-emerald-200">✅ reçu{l.etat === "excedent" ? " (excédent)" : ""}</span>
                        : l.etat === "partielle" ? <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-200">partiel — reste {n(l.qty_restante)}</span>
                        : <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-xs text-sky-200">⏳ attendu</span>}
                    </td>
                    <td className="py-2 text-zinc-400">{l.derniere_reception ? fmtDate(l.derniere_reception) : "—"}</td>
                  </tr>
                ))}
                {!lignes.length && <tr><td colSpan={7} className="py-4 text-center text-sm text-zinc-500">Aucune ligne d&apos;article.</td></tr>}
              </tbody>
            </table>
          </div>

          {commande.mouvements.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-zinc-500">Historique des réceptions ({commande.mouvements.length})</summary>
              <div className="mt-2 space-y-1 text-xs">
                {commande.mouvements.map(m => (
                  <div key={m.id} className="flex flex-wrap gap-x-3 text-zinc-400">
                    <span className="w-20 text-zinc-500">{fmtDate(m.date_reception)}</span>
                    <span className={`font-semibold ${m.qty_recue < 0 ? "text-rose-300" : "text-emerald-300"}`}>{m.qty_recue > 0 ? "+" : ""}{n(m.qty_recue)}</span>
                    <span className="text-zinc-300">{m.titre || m.sku || `ligne ${m.position}`}</span>
                    <span className="text-zinc-500">{m.saisi_par}{m.commentaire ? ` · ${m.commentaire}` : ""}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </>
      )}
    </section>
  );
}
