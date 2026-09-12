"use client";
// components/ListeAchatImport.tsx
// Onglet « Liste d'achat » du formulaire de brouillon (/drafts/nouveau et
// édition). Deux temps :
//   1. la liste des listes / modèles enregistrés, compacte (nom, vendeur,
//      nombre de références, 3 premiers titres) ;
//   2. un APERÇU en fenêtre : toutes les lignes avec vignette, SKU, titre,
//      options, quantité modifiable, case à cocher par ligne → « Ajouter les
//      N lignes à l'offre ».
// Les lignes sont AJOUTÉES à la suite de celles déjà présentes, sans toucher
// au client ni au reste du document ; les prix sont relus chez Shopify par
// l'API au moment de l'ajout.

import React, { useEffect, useState } from "react";
import type { QuoteLine } from "@/lib/jc-print-types";
import type { ListeAchat, LigneListe } from "@/lib/listes-achat";

type Props = { onAjouter: (lines: QuoteLine[]) => void };

type Choix = { coche: boolean; qty: number };

export default function ListeAchatImport({ onAjouter }: Props) {
  const [listes, setListes] = useState<ListeAchat[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtre, setFiltre] = useState("");
  const [message, setMessage] = useState("");
  const [apercu, setApercu] = useState<ListeAchat | null>(null);
  const [choix, setChoix] = useState<Choix[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/listes-achat?statut=ouverte")
      .then((r) => r.json())
      .then((j) => setListes(j.listes || []))
      .catch(() => setMessage("Listes d'achat indisponibles."))
      .finally(() => setLoading(false));
  }, []);

  function ouvrir(l: ListeAchat) {
    setApercu(l);
    setChoix(l.lignes.map((x) => ({ coche: true, qty: Math.max(1, x.qty) })));
  }

  // Ferme aussi avec Échap
  useEffect(() => {
    if (!apercu) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") setApercu(null); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [apercu]);

  async function ajouter() {
    if (!apercu) return;
    const retenues = choix.map((c, i) => ({ c, i })).filter(({ c }) => c.coche && c.qty > 0);
    if (retenues.length === 0) return;
    setBusy(true); setMessage("");
    try {
      const res = await fetch(`/api/listes-achat/${apercu.id}/lignes`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Erreur ${res.status}`);
      // L'API rend les lignes dans l'ordre de la liste : on aligne par index,
      // puis on applique les cases et quantités choisies dans l'aperçu.
      const toutes = (json.lines || []) as QuoteLine[];
      const lines: QuoteLine[] = retenues
        .map(({ c, i }) => {
          const l = toutes[i];
          if (!l) return null;
          const parUnite = l.lineDiscountPerUnit ?? 0;
          return { ...l, qty: c.qty, lineDiscount: Math.round(parUnite * c.qty * 100) / 100 };
        })
        .filter((l): l is QuoteLine => l !== null);
      onAjouter(lines);
      const nbCustom = lines.filter((l) => l.type === "custom").length;
      setMessage(`${lines.length} ligne(s) de « ${apercu.nom} » ajoutée(s) à l'offre${nbCustom > 0 ? ` — ${nbCustom} article(s) libre(s) à vérifier (prix)` : ""}.`);
      setApercu(null);
    } catch (e) {
      setMessage(String(e));
    } finally { setBusy(false); }
  }

  const f = filtre.trim().toLowerCase();
  const visibles = listes.filter((l) => !f || l.nom.toLowerCase().includes(f) || (l.cree_par || "").toLowerCase().includes(f));
  const nbCoches = choix.filter((c) => c.coche && c.qty > 0).length;
  const nbPieces = choix.reduce((s, c) => (c.coche ? s + c.qty : s), 0);

  return (
    <div className="mt12">
      <div className="jc-field">
        <label>Liste ou modèle enregistré</label>
        <input value={filtre} onChange={(e) => setFiltre(e.target.value)} placeholder="Filtrer par nom ou par vendeur…" />
      </div>
      {message && <div style={{ fontSize: 12, marginTop: 6, opacity: 0.85 }}>{message}</div>}

      {loading ? (
        <div style={{ fontSize: 13, opacity: 0.7, marginTop: 8 }}>Chargement…</div>
      ) : visibles.length === 0 ? (
        <div style={{ fontSize: 13, opacity: 0.7, marginTop: 8 }}>
          Aucune liste. Prépare-les depuis la <a href="/dashboard/stock-list" target="_blank" rel="noopener noreferrer">Stock list</a>.
        </div>
      ) : (
        <div style={{ marginTop: 8, maxHeight: 420, overflowY: "auto", display: "grid", gap: 6 }}>
          {visibles.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => ouvrir(l)}
              title="Voir le contenu et choisir les lignes à ajouter"
              style={{ textAlign: "left", display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, background: "rgba(255,255,255,0.03)", cursor: "pointer" }}
            >
              <div style={{ display: "flex", gap: 3, flexShrink: 0 }}>
                {l.lignes.slice(0, 3).map((x, i) => (
                  <div key={i} style={{ width: 28, height: 28, borderRadius: 6, background: "#fff", overflow: "hidden" }}>
                    {x.image_url
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={x.image_url} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                      : <div style={{ width: "100%", height: "100%", background: "rgba(255,255,255,0.06)" }} />}
                  </div>
                ))}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, lineHeight: 1.25 }}>{l.est_modele ? "⭐ " : ""}{l.nom}</div>
                <div style={{ fontSize: 11, opacity: 0.65, marginTop: 2 }}>
                  {l.cree_par || "?"} · {l.lignes.length} réf. · {l.nb_articles} pièce{l.nb_articles > 1 ? "s" : ""} — cliquer pour l&apos;aperçu
                </div>
              </div>
              <span style={{ fontSize: 18, opacity: 0.5 }}>›</span>
            </button>
          ))}
        </div>
      )}

      {/* ── Aperçu en fenêtre ── */}
      {apercu && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70 p-4" onClick={() => setApercu(null)}>
          <div
            className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border-2 border-sky-400 bg-[#1b1d21] text-zinc-100 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 border-b border-white/10 px-5 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-base font-semibold">{apercu.est_modele ? "⭐ " : ""}{apercu.nom}</div>
                <div className="text-xs text-zinc-400">{apercu.cree_par || "?"} · {apercu.lignes.length} référence{apercu.lignes.length > 1 ? "s" : ""}{apercu.est_modele ? " · modèle réutilisable" : ""}</div>
              </div>
              <button type="button" onClick={() => setApercu(null)} className="rounded-lg px-2 py-1 text-zinc-400 hover:bg-white/10 hover:text-zinc-100" title="Fermer (Échap)">✕</button>
            </div>

            <div className="flex items-center gap-3 border-b border-white/5 px-5 py-2 text-xs text-zinc-400">
              <button type="button" onClick={() => setChoix((c) => c.map((x) => ({ ...x, coche: true })))} className="hover:text-zinc-100">Tout cocher</button>
              <button type="button" onClick={() => setChoix((c) => c.map((x) => ({ ...x, coche: false })))} className="hover:text-zinc-100">Tout décocher</button>
              <span className="ml-auto">Coche les lignes à ajouter et ajuste les quantités — la liste enregistrée n&apos;est pas modifiée.</span>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              <table className="w-full text-sm">
                <tbody>
                  {apercu.lignes.map((x: LigneListe, i) => {
                    const c = choix[i] ?? { coche: true, qty: x.qty };
                    return (
                      <tr key={`${x.fournisseur}|${x.sku}`} className={`border-b border-white/5 ${c.coche ? "" : "opacity-40"}`}>
                        <td className="w-10 px-3 py-2 text-center">
                          <input type="checkbox" checked={c.coche} onChange={(e) => setChoix((ch) => ch.map((y, j) => (j === i ? { ...y, coche: e.target.checked } : y)))} className="h-4 w-4" />
                        </td>
                        <td className="w-14 px-1 py-2">
                          <div className="h-11 w-11 overflow-hidden rounded-lg bg-white">
                            {x.image_url
                              // eslint-disable-next-line @next/next/no-img-element
                              ? <img src={x.image_url} alt="" className="h-full w-full object-contain" />
                              : <div className="flex h-full w-full items-center justify-center bg-white/5 text-zinc-600">{x.variant_id ? "×" : "✎"}</div>}
                          </div>
                        </td>
                        <td className="px-2 py-2">
                          <div className="font-medium leading-snug text-zinc-100">{x.titre || <span className="italic text-zinc-500">Article libre — {x.fournisseur}</span>}</div>
                          {x.variante_titre && <div className="leading-snug text-sky-200/85">{x.variante_titre.split(" / ").map((o, k) => <div key={k}>{o}</div>)}</div>}
                          <div className="text-[11px] text-zinc-500">
                            <span className="tracking-wide text-zinc-400">{x.sku}</span> · {x.fournisseur}
                            {!x.variant_id ? " · ligne libre (prix à vérifier)" : x.statut_fiche === "DRAFT" ? " · fiche brouillon" : ""}
                          </div>
                        </td>
                        <td className="w-32 px-2 py-2">
                          <div className="flex items-center justify-end gap-1">
                            <button type="button" onClick={() => setChoix((ch) => ch.map((y, j) => (j === i ? { ...y, qty: Math.max(1, y.qty - 1) } : y)))} className="h-7 w-7 rounded border border-white/10 text-zinc-300 hover:bg-white/10">−</button>
                            <input value={c.qty} onChange={(e) => { const n = Math.max(1, Math.min(999, Math.round(Number(e.target.value) || 1))); setChoix((ch) => ch.map((y, j) => (j === i ? { ...y, qty: n } : y))); }} className="w-11 rounded border border-white/10 bg-[#25282c] px-1 py-1 text-center text-sm text-zinc-100" />
                            <button type="button" onClick={() => setChoix((ch) => ch.map((y, j) => (j === i ? { ...y, qty: Math.min(999, y.qty + 1) } : y)))} className="h-7 w-7 rounded border border-white/10 text-zinc-300 hover:bg-white/10">+</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex items-center gap-3 border-t border-white/10 px-5 py-3">
              <span className="text-xs text-zinc-400">{nbCoches} ligne{nbCoches > 1 ? "s" : ""} · {nbPieces} pièce{nbPieces > 1 ? "s" : ""} — prix Shopify relus à l&apos;ajout</span>
              <button type="button" onClick={() => setApercu(null)} className="ml-auto rounded-lg border border-white/10 px-3 py-2 text-sm text-zinc-300 hover:bg-white/10">Annuler</button>
              <button type="button" onClick={ajouter} disabled={busy || nbCoches === 0} className="rounded-lg border border-emerald-500/40 bg-emerald-500/25 px-4 py-2 text-sm font-semibold text-emerald-100 hover:bg-emerald-500/35 disabled:opacity-40">
                {busy ? "Ajout…" : `+ Ajouter ${nbCoches} ligne${nbCoches > 1 ? "s" : ""} à l'offre`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
