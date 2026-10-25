"use client";
// app/dashboard/echantillons/nuancier/page.tsx
// « Nuancier des fiches » (26.10.2026) — pour chaque article actif des marques
// déjà activées, état du bloc « Nuancier des coloris » sur la fiche produit :
//   complet  : toutes les couleurs ont leur vignette
//   partiel  : affiché, mais quelques couleurs manquent (règle : ≤ 2 ou ≤ 10 %)
//   masque   : couleurs reconnues mais trop de manques → bloc caché
//   aucune   : aucune option couleur reconnue (pièces, accessoires…) → coloris
//              imposés possibles via le champ méta « Nuancier – coloris imposés »
// Liens vers l'admin Shopify, la boutique et l'aperçu de la copie du thème.
// 100 % LECTURE SEULE.

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import RetourDashboard from "@/components/RetourDashboard";

type Manque = { v: string; r: string };
type Groupe = { o: string; n: number; ok: number; a: boolean; m: Manque[] };
type Ligne = {
  product_id: number; handle: string; titre: string; marque: string; statut: string;
  image_url: string | null; categorie: Categorie; groupes: Groupe[];
};
type Categorie = "complet" | "partiel" | "masque" | "aucune";

const CATS: { v: Categorie; l: string; d: string; cl: string }[] = [
  { v: "complet", l: "✅ Complètes", d: "Toutes les couleurs ont leur vignette", cl: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200" },
  { v: "partiel", l: "🟡 Affichées, il manque des couleurs", d: "1 ou 2 couleurs (ou ≤ 10 %) sans vignette, ou un groupe masqué", cl: "border-amber-500/40 bg-amber-500/10 text-amber-200" },
  { v: "masque", l: "🟠 Masquées (trop de manques)", d: "Couleurs reconnues mais bloc caché", cl: "border-orange-500/40 bg-orange-500/10 text-orange-200" },
  { v: "aucune", l: "⚪ Aucune vignette", d: "Pas d'option couleur reconnue — coloris imposés possibles", cl: "border-white/15 bg-white/5 text-zinc-300" },
];
const CAT = Object.fromEntries(CATS.map((c) => [c.v, c])) as Record<Categorie, (typeof CATS)[number]>;

const ADMIN = "https://admin.shopify.com/store/le-meuble/products/";
const BOUTIQUE = "https://www.jardin-confort.ch/products/";
const THEME_NUANCIER = "182581854587"; // copie du thème « bloc couleurs base matières »

function vignette(url: string | null): string | null {
  if (!url) return null;
  return url.includes("cdn.shopify.com") ? url + (url.includes("?") ? "&" : "?") + "width=160" : url;
}

export default function NuancierFiches() {
  const pathname = usePathname() || "";
  const base = pathname.startsWith("/v2") ? "/v2/echantillons" : "/dashboard/echantillons";
  const [rows, setRows] = useState<Ligne[]>([]);
  const [luLe, setLuLe] = useState<string | null>(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [marque, setMarque] = useState<string>("");
  const [cat, setCat] = useState<Categorie | "">("partiel");
  const [q, setQ] = useState("");
  const [ouverts, setOuverts] = useState<Record<number, boolean>>({});

  async function charger() {
    setChargement(true); setErreur(null);
    try {
      const r = await fetch("/api/echantillons/nuancier", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Erreur " + r.status);
      setRows(j.rows || []); setLuLe(j.lu_le || null);
    } catch (e) { setErreur((e as Error).message); }
    finally { setChargement(false); }
  }
  useEffect(() => { charger(); }, []);

  const marques = useMemo(() => Array.from(new Set(rows.map((r) => r.marque))).sort(), [rows]);
  const dansMarque = useMemo(() => rows.filter((r) => !marque || r.marque === marque), [rows, marque]);
  const compte = (c: Categorie) => dansMarque.filter((r) => r.categorie === c).length;
  const visibles = useMemo(() => {
    const t = q.trim().toLowerCase();
    return dansMarque
      .filter((r) => !cat || r.categorie === cat)
      .filter((r) => !t || (r.titre + " " + r.handle + " " + r.groupes.flatMap((g) => g.m.map((m) => m.v)).join(" ")).toLowerCase().includes(t))
      .sort((a, b) => a.marque.localeCompare(b.marque) || a.titre.localeCompare(b.titre));
  }, [dansMarque, cat, q]);

  const parMarque = useMemo(() => {
    const m = new Map<string, Ligne[]>();
    visibles.forEach((r) => { if (!m.has(r.marque)) m.set(r.marque, []); m.get(r.marque)!.push(r); });
    return Array.from(m.entries());
  }, [visibles]);

  // Valeurs manquantes les plus fréquentes (pour corriger en priorité)
  const topManques = useMemo(() => {
    const m = new Map<string, { v: string; r: string; marque: string; n: number }>();
    dansMarque.forEach((l) => l.groupes.forEach((g) => g.m.forEach((x) => {
      const k = l.marque + "|" + x.v;
      const e = m.get(k) || { v: x.v, r: x.r, marque: l.marque, n: 0 };
      e.n += 1; m.set(k, e);
    })));
    return Array.from(m.values()).sort((a, b) => b.n - a.n).slice(0, 15);
  }, [dansMarque]);

  const champ = "rounded-xl border border-white/10 bg-[#2a2d31] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-sky-500/50";

  return (
    <main className="min-h-screen bg-[#1f2125]">
      <div className="mx-auto max-w-[1400px] px-4 pb-28 pt-8 text-zinc-100 lg:px-6">
        <RetourDashboard />
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">🧩 Nuancier des fiches</h1>
            <p className="mt-1 max-w-3xl text-sm text-zinc-400">
              État du bloc « Nuancier des coloris » sur chaque article actif des marques déjà activées
              ({marques.join(", ") || "…"}). Lecture seule.{" "}
              <Link href={base} className="text-sky-300 hover:underline">← Banque d&apos;échantillons</Link>
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs text-zinc-400">
            <span>Lu le {luLe ? new Date(luLe).toLocaleString("fr-CH") : "…"}</span>
            <button type="button" onClick={charger} disabled={chargement} className="rounded-2xl border border-white/10 bg-[#2a2d31] px-4 py-2 text-sm text-zinc-300 transition hover:bg-[#34383d] disabled:opacity-60">
              {chargement ? "⏳ Chargement…" : "🔄 Actualiser"}
            </button>
          </div>
        </div>

        {erreur && <div className="mb-4 rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{erreur}</div>}

        <div className="mb-4 flex flex-wrap gap-2">
          {["", ...marques].map((m) => (
            <button key={m || "toutes"} type="button" onClick={() => setMarque(m)}
              className={`rounded-full border px-4 py-1.5 text-sm ${marque === m ? "border-sky-400/60 bg-sky-500/15 text-sky-200" : "border-white/10 bg-[#2a2d31] text-zinc-300 hover:bg-[#34383d]"}`}>
              {m || "Toutes les marques"} <span className="opacity-60">({m ? rows.filter((r) => r.marque === m).length : rows.length})</span>
            </button>
          ))}
        </div>

        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {CATS.map((c) => (
            <button key={c.v} type="button" onClick={() => setCat(cat === c.v ? "" : c.v)} title={c.d}
              className={`rounded-2xl border px-4 py-3 text-left transition ${cat === c.v ? c.cl : "border-white/10 bg-[#2a2d31] hover:bg-white/5"}`}>
              <div className="text-2xl font-semibold">{compte(c.v)}</div>
              <div className="text-sm">{c.l}</div>
              <div className="mt-0.5 text-xs text-zinc-400">{c.d}</div>
            </button>
          ))}
        </div>

        {topManques.length > 0 && (
          <details className="mb-6 rounded-2xl border border-white/10 bg-[#2a2d31]">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium">Couleurs manquantes les plus fréquentes ({marque || "toutes marques"})</summary>
            <div className="grid gap-1 px-4 pb-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
              {topManques.map((t) => (
                <button key={t.marque + t.v} type="button" onClick={() => { setQ(t.v); setCat(""); }}
                  className="flex items-center justify-between gap-3 rounded-lg px-2 py-1 text-left hover:bg-white/5">
                  <span className="truncate"><span className="text-zinc-500">{t.marque} · </span>{t.v}</span>
                  <span className="shrink-0 text-xs text-zinc-400">{t.r} · {t.n} fiche{t.n > 1 ? "s" : ""}</span>
                </button>
              ))}
            </div>
          </details>
        )}

        <div className="sticky top-0 z-20 -mx-4 mb-4 flex flex-wrap items-center gap-3 border-b border-white/10 bg-[#1f2125]/95 px-4 py-3 backdrop-blur lg:-mx-6 lg:px-6">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Chercher un article ou une couleur…" className={champ + " w-72"} />
          <select value={cat} onChange={(e) => setCat(e.target.value as Categorie | "")} className={champ}>
            <option value="">Tous les états</option>
            {CATS.map((c) => <option key={c.v} value={c.v}>{c.l}</option>)}
          </select>
          <span className="text-sm text-zinc-400">{visibles.length} article{visibles.length > 1 ? "s" : ""}</span>
        </div>

        {parMarque.map(([m, lignes]) => (
          <section key={m} className="mb-8">
            <h2 className="mb-3 text-lg font-semibold">{m} <span className="text-sm font-normal text-zinc-400">· {lignes.length}</span></h2>
            <div className="grid gap-2">
              {lignes.map((l) => {
                const img = vignette(l.image_url);
                const ouvert = !!ouverts[l.product_id];
                const nbManques = l.groupes.reduce((s, g) => s + g.m.length, 0);
                return (
                  <div key={l.product_id} className="rounded-2xl border border-white/10 bg-[#2a2d31] p-3">
                    <div className="flex items-center gap-3">
                      {img ? <img src={img} alt="" loading="lazy" className="h-16 w-16 shrink-0 rounded-xl bg-white object-contain" /> : <div className="h-16 w-16 shrink-0 rounded-xl bg-white/5" />}
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{l.titre}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                          <span className={`rounded-full border px-2 py-0.5 ${CAT[l.categorie].cl}`}>{CAT[l.categorie].l}</span>
                          {l.groupes.map((g) => (
                            <span key={g.o} className={`rounded-full border px-2 py-0.5 ${g.a ? "border-white/10 text-zinc-300" : "border-orange-500/40 text-orange-200"}`} title={g.a ? "Groupe affiché" : "Groupe masqué (trop de manques)"}>
                              {g.o} {g.ok}/{g.n}{g.a ? "" : " · masqué"}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-wrap justify-end gap-2 text-xs">
                        <a href={ADMIN + l.product_id} target="_blank" rel="noopener noreferrer" className="rounded-xl border border-white/10 px-3 py-1.5 text-zinc-300 hover:bg-white/5">Shopify</a>
                        <a href={BOUTIQUE + l.handle} target="_blank" rel="noopener noreferrer" className="rounded-xl border border-white/10 px-3 py-1.5 text-zinc-300 hover:bg-white/5">Boutique</a>
                        <a href={BOUTIQUE + l.handle + "?preview_theme_id=" + THEME_NUANCIER} target="_blank" rel="noopener noreferrer" className="rounded-xl border border-white/10 px-3 py-1.5 text-zinc-300 hover:bg-white/5" title="Aperçu avec la copie du thème qui contient le nuancier">Aperçu nuancier</a>
                        {nbManques > 0 && (
                          <button type="button" onClick={() => setOuverts({ ...ouverts, [l.product_id]: !ouvert })} className="rounded-xl border border-white/10 px-3 py-1.5 text-zinc-300 hover:bg-white/5">
                            {ouvert ? "Masquer" : `${nbManques} manque${nbManques > 1 ? "s" : ""}`}
                          </button>
                        )}
                      </div>
                    </div>
                    {ouvert && (
                      <div className="mt-3 grid gap-2 border-t border-white/10 pt-3 text-sm">
                        {l.groupes.filter((g) => g.m.length).map((g) => (
                          <div key={g.o}>
                            <div className="mb-1 text-xs text-zinc-400">{g.o}</div>
                            <div className="flex flex-wrap gap-1.5">
                              {g.m.map((x) => (
                                <span key={x.v} className="rounded-lg border border-white/10 bg-black/20 px-2 py-1 text-xs">
                                  {x.v} <span className="text-zinc-500">· {x.r}</span>
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
        {!chargement && visibles.length === 0 && <p className="py-10 text-center text-zinc-400">Aucun article dans cette sélection.</p>}
      </div>
    </main>
  );
}
