"use client";
// app/dashboard/stock-list/page.tsx
// « Stock list » — recherche du délai de livraison d'un article au catalogue
// pour l'équipe de vente. Interroge la vue v_recherche_delai du Supabase
// WEBSHOP (relevés fournisseurs × miroir Shopify) : couvre les fiches ACTIVE,
// DRAFT, ARCHIVED et les SKU des relevés pas encore créés dans Shopify.
//
// 100 % lecture seule. Rien à voir avec /dashboard/delais (suivi des délais
// des commandes en cours).
//
// Délai client (dernière colonne, mise en évidence) : calculé par la vue —
// plage delai_config si elle existe, sinon date de dispo + transport, sinon
// transport seul si stock fournisseur > 0, sinon vide.

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { clicLigne, clicMilieuLigne, useFiltresMemorises } from "@/lib/liste-navigation";
import type { RechercheDelaiRow, StockListShopifyInfo } from "@/lib/supabase-webshop";

type Ligne = RechercheDelaiRow & { shopify?: StockListShopifyInfo };

function fmtDate(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("fr-CH", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function fmtDateHeure(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("fr-CH", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function BadgeFiche({ statut }: { statut: Ligne["statut_fiche"] }) {
  if (!statut) {
    return <span className="rounded-md border border-zinc-500/30 bg-zinc-500/10 px-1.5 py-0.5 text-[11px] text-zinc-400">hors Shopify</span>;
  }
  const cls =
    statut === "ACTIVE" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" :
    statut === "DRAFT" ? "border-amber-500/30 bg-amber-500/10 text-amber-300" :
    "border-zinc-500/30 bg-zinc-500/10 text-zinc-400";
  const libelle = statut === "ACTIVE" ? "Active" : statut === "DRAFT" ? "Draft" : "Archivée";
  return <span className={`rounded-md border px-1.5 py-0.5 text-[11px] ${cls}`}>{libelle}</span>;
}

function Stock({ n }: { n: number | null }) {
  if (n === null || n === undefined) return <span className="text-zinc-600">—</span>;
  return <span className={n > 0 ? "text-emerald-300" : "text-zinc-400"}>{n}</span>;
}

function DelaiClient({ plage }: { plage: string | null }) {
  if (!plage) {
    return <span className="text-sm text-zinc-500" title="Aucun délai ne peut être annoncé : pas de configuration, pas de date de dispo, pas de stock fournisseur">à confirmer</span>;
  }
  return <span className="text-lg font-semibold text-sky-300">{plage} <span className="text-xs font-normal text-sky-300/70">sem.</span></span>;
}

export default function StockListPage() {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Ligne[]>([]);
  const [tronque, setTronque] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [cherche, setCherche] = useState(false); // au moins une recherche lancée
  const requeteEnCours = useRef(0);

  useFiltresMemorises("stock-list-filtres", { q }, (v) => {
    if (typeof v.q === "string") setQ(v.q);
  });

  // Recherche avec debounce 300 ms ; les réponses en retard sont ignorées.
  useEffect(() => {
    const terme = q.trim();
    if (terme.length < 2) {
      setRows([]); setTronque(false); setError(""); setLoading(false); setCherche(false);
      return;
    }
    const id = ++requeteEnCours.current;
    const timer = setTimeout(async () => {
      setLoading(true); setError("");
      try {
        const res = await fetch(`/api/stock-list?q=${encodeURIComponent(terme)}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `Erreur ${res.status}`);
        if (id !== requeteEnCours.current) return;
        const lignes = (json.rows || []) as Ligne[];
        setRows(lignes); setTronque(Boolean(json.tronque)); setCherche(true); setLoading(false);

        // Second temps : images + liens Shopify pour les variantes affichées.
        const variantIds = lignes.map((l) => l.variant_id).filter((v) => v !== null && v !== undefined);
        if (variantIds.length === 0) return;
        const resS = await fetch("/api/stock-list/shopify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ variantIds }),
        });
        const jsonS = await resS.json();
        if (!resS.ok || id !== requeteEnCours.current) return; // sans Shopify, la liste reste utilisable
        const infos = (jsonS.infos || {}) as Record<string, StockListShopifyInfo>;
        setRows((prev) => prev.map((l) => {
          const info = l.variant_id !== null && l.variant_id !== undefined ? infos[String(l.variant_id)] : undefined;
          return info ? { ...l, shopify: info } : l;
        }));
      } catch (e) {
        if (id !== requeteEnCours.current) return;
        setError(String(e)); setLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [q]);

  function urlLigne(l: Ligne): string | null {
    if (!l.shopify) return null;
    return l.shopify.onlineStoreUrl || l.shopify.adminUrl;
  }

  return (
    <main className="min-h-screen bg-[#1f2125]">
      <div className="mx-auto max-w-7xl px-4 py-8 text-zinc-100">
        <div className="mb-6 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold">🔎 Stock list</h1>
            <p className="mt-1 text-sm text-zinc-400">
              Délai de livraison d&apos;un article au catalogue — stock Jardin Confort, stock et statut fournisseur,
              y compris les fiches en brouillon et les articles pas encore créés dans Shopify.{" "}
              <Link href="/dashboard/delais" className="text-sky-300 hover:underline">→ Délais des commandes en cours</Link>
            </p>
          </div>
          <Link href="/dashboard" className="rounded-xl border border-white/10 bg-[#34383d] px-4 py-2 text-sm text-zinc-200 transition hover:bg-[#40454b]">
            ← Dashboard
          </Link>
        </div>

        <div className="mb-4">
          <input
            type="search"
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Référence, SKU ou titre de l'article (2 caractères min.)…"
            className="w-full rounded-2xl border border-white/10 bg-[#2a2d31] px-5 py-3.5 text-base text-zinc-100 placeholder:text-zinc-500 outline-none transition focus:border-sky-500/50"
          />
          <div className="mt-2 flex items-center justify-between text-xs text-zinc-500">
            <span>Un clic sur une ligne ouvre la fiche produit (boutique, ou admin Shopify si brouillon). Ctrl+clic : nouvel onglet.</span>
            {cherche && !loading && (
              <span>{rows.length} résultat{rows.length > 1 ? "s" : ""}{tronque ? " — affichage limité à 50, précise la recherche" : ""}</span>
            )}
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>
        )}

        {q.trim().length < 2 ? (
          <div className="rounded-2xl border border-white/10 bg-[#2a2d31] p-8 text-center text-zinc-400">Tape une référence ou un titre pour chercher.</div>
        ) : loading && rows.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-[#2a2d31] p-8 text-center text-zinc-400">Recherche…</div>
        ) : cherche && rows.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-[#2a2d31] p-8 text-center text-zinc-400">Aucun article ne correspond à « {q.trim()} ».</div>
        ) : (
          <div className={`overflow-x-auto rounded-2xl border border-white/10 bg-[#2a2d31] transition ${loading ? "opacity-60" : ""}`}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wide text-zinc-500">
                  <th className="px-3 py-3 w-14"></th>
                  <th className="px-3 py-3">Article</th>
                  <th className="px-3 py-3">Fiche</th>
                  <th className="px-3 py-3 text-right" title="Stock Jardin Confort (miroir Shopify)">Stock JC</th>
                  <th className="px-3 py-3 text-right" title="Stock chez le fournisseur (dernier relevé)">Stock fourn.</th>
                  <th className="px-3 py-3">Statut fourn.</th>
                  <th className="px-3 py-3">Dispo dès</th>
                  <th className="px-3 py-3 text-right" title="Acheminement fournisseur → Lutry, en semaines">Transport</th>
                  <th className="px-3 py-3 text-right bg-sky-500/10 text-sky-300" title="Délai à annoncer au client, en semaines (transport compris)">Délai client</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => {
                  const url = urlLigne(l);
                  const cliquable = Boolean(url);
                  return (
                    <tr
                      key={`${l.fournisseur}|${l.sku}`}
                      onClick={(e) => { if (url) clicLigne(url, e); }}
                      onAuxClick={(e) => { if (url) clicMilieuLigne(url, e); }}
                      title={cliquable ? (l.shopify?.onlineStoreUrl ? "Ouvrir la fiche sur la boutique" : "Fiche non publiée — ouvrir dans l'admin Shopify") : "Article absent de Shopify : pas de fiche à ouvrir"}
                      className={`border-b border-white/5 ${cliquable ? "cursor-pointer hover:bg-white/5" : "cursor-default"}`}
                    >
                      <td className="px-3 py-2">
                        {l.shopify?.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={l.shopify.imageUrl} alt="" className="h-10 w-10 rounded-lg object-cover bg-white/5" loading="lazy" />
                        ) : (
                          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/5 text-zinc-600">🪑</div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-zinc-100">{l.titre || <span className="italic text-zinc-500">Titre inconnu (relevé fournisseur)</span>}</div>
                        <div className="text-xs text-zinc-500"><span className="font-mono text-zinc-400">{l.sku}</span> · {l.fournisseur}</div>
                      </td>
                      <td className="px-3 py-2"><BadgeFiche statut={l.statut_fiche} /></td>
                      <td className="px-3 py-2 text-right tabular-nums"><Stock n={l.stock_jc} /></td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        <Stock n={l.stock_fournisseur} />
                        {l.releve_fournisseur_le && (
                          <div className="text-[10px] text-zinc-600" title="Date du dernier relevé fournisseur">relevé {fmtDateHeure(l.releve_fournisseur_le)}</div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-zinc-300">{l.statut_fournisseur || <span className="text-zinc-600">—</span>}</td>
                      <td className="px-3 py-2 tabular-nums text-zinc-300">{fmtDate(l.date_dispo_fournisseur) || <span className="text-zinc-600">—</span>}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-zinc-300">{l.transport_semaines !== null ? `${l.transport_semaines} sem.` : <span className="text-zinc-600">—</span>}</td>
                      <td className="px-3 py-2 text-right bg-sky-500/10"><DelaiClient plage={l.delai_client_semaines} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-4 text-xs text-zinc-600">
          Source : relevés fournisseurs (Make → Supabase webshop) et miroir Shopify rafraîchi chaque jour. Le délai client intègre déjà le transport ;
          « à confirmer » = aucun élément fiable (pas de stock fournisseur, pas de date, pas de règle de délai).
        </p>
      </div>
    </main>
  );
}
