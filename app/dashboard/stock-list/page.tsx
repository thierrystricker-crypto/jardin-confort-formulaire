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
//
// Les lignes ne sont PAS cliquables (le texte doit rester sélectionnable) :
// trois petits boutons par ligne — copier le SKU, copier le titre, ouvrir la
// variante dans un nouvel onglet.

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useFiltresMemorises } from "@/lib/liste-navigation";
import type { RechercheDelaiRow, StockListShopifyInfo } from "@/lib/supabase-webshop";

type Ligne = RechercheDelaiRow & { shopify?: StockListShopifyInfo };

type FournisseurSync = {
  nom: string;
  logoUrl: string | null;
  actif: boolean;            // false = observation : relevé quotidien, rien poussé vers Shopify
  dernierReleve: string | null;
  nbSku: number;
  verdict: string | null;    // ok · observation · echec…
  motif: string | null;
};

// Le miroir stocke "gid://shopify/ProductVariant/40918274244743" ; la route
// Shopify indexe par l'id numérique. On ramène tout au numérique.
function cleVariante(id: string | number | null | undefined): string {
  if (id === null || id === undefined) return "";
  return String(id).split("/").pop() || "";
}

// Statut fournisseur lisible : "EN_STOCK" → "En stock chez Glatz". Sans ça,
// un vendeur lit "EN STOCK" et croit que l'article est en rayon à Lutry.
function libelleStatutFournisseur(statut: string | null, fournisseur: string): string {
  if (!statut) return "";
  const s = statut.replace(/_/g, " ").toLowerCase();
  const libelle = s.charAt(0).toUpperCase() + s.slice(1);
  return `${libelle} chez ${fournisseur}`;
}

// Couleur du statut fournisseur : vert = dispo, orange = à produire / en
// commande, rouge = épuisé / sorti. Le reste en neutre.
function couleurStatutFournisseur(statut: string): string {
  const s = statut.toUpperCase();
  if (s === "EN_STOCK" || s === "STOCK" || s === "DELAI COURT") return "text-emerald-300";
  if (s === "SOLD_OUT" || s === "SORTIE" || s === "RUPTURE" || s === "EPUISE") return "text-rose-400";
  if (s === "A_PRODUIRE" || s === "COMMANDE" || s === "PRODUCTION") return "text-amber-300";
  return "text-zinc-300";
}

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

// ─── Petits boutons d'action (icônes SVG, pas de dépendance) ───
const ICONE_COPIER = (
  <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
    <path d="M10.5 5.5V3.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
  </svg>
);
const ICONE_OUVRIR = (
  <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M9 3h4v4M13 3 7.5 8.5" />
    <path d="M11 9.5V12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h2.5" />
  </svg>
);

function BoutonAction({ titre, onClick, actif, enfant, href }: {
  titre: string; onClick?: () => void; actif?: boolean; enfant: React.ReactNode; href?: string;
}) {
  const cls = `inline-flex h-6 w-6 items-center justify-center rounded-md border transition ${
    actif
      ? "border-emerald-500/40 bg-emerald-500/20 text-emerald-300"
      : "border-white/10 bg-white/5 text-zinc-400 hover:border-sky-500/40 hover:bg-sky-500/15 hover:text-sky-300"
  }`;
  if (href) {
    return <a href={href} target="_blank" rel="noopener noreferrer" title={titre} className={cls}>{enfant}</a>;
  }
  return <button type="button" title={titre} onClick={onClick} className={cls}>{enfant}</button>;
}

export default function StockListPage() {
  const [q, setQ] = useState("");
  const [marque, setMarque] = useState<string>(""); // filtre fournisseur (carte du bandeau)
  const [rows, setRows] = useState<Ligne[]>([]);
  const [tronque, setTronque] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [cherche, setCherche] = useState(false); // au moins une recherche lancée
  const [fournisseurs, setFournisseurs] = useState<FournisseurSync[]>([]);
  const [copie, setCopie] = useState<string>(""); // clé du dernier élément copié (feedback 1,5 s)
  const requeteEnCours = useRef(0);

  useFiltresMemorises("stock-list-filtres", { q, marque }, (v) => {
    if (typeof v.q === "string") setQ(v.q);
    if (typeof v.marque === "string") setMarque(v.marque);
  });

  // Bandeau : quels fournisseurs sont couverts par la synchro.
  useEffect(() => {
    fetch("/api/stock-list?fournisseurs=1")
      .then((r) => r.json())
      .then((j) => setFournisseurs(j.fournisseurs || []))
      .catch(() => { /* bandeau facultatif */ });
  }, []);

  // Recherche avec debounce 300 ms ; les réponses en retard sont ignorées.
  const rechercheActive = q.trim().length >= 2 || marque !== "";
  useEffect(() => {
    const terme = q.trim();
    if (terme.length < 2 && !marque) {
      setRows([]); setTronque(false); setError(""); setLoading(false); setCherche(false);
      return;
    }
    const id = ++requeteEnCours.current;
    const timer = setTimeout(async () => {
      setLoading(true); setError("");
      try {
        const params = new URLSearchParams();
        if (terme.length >= 2) params.set("q", terme);
        if (marque) params.set("fournisseur", marque);
        const res = await fetch(`/api/stock-list?${params.toString()}`);
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
          const info = infos[cleVariante(l.variant_id)];
          return info ? { ...l, shopify: info } : l;
        }));
      } catch (e) {
        if (id !== requeteEnCours.current) return;
        setError(String(e)); setLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [q, marque]);

  async function copier(cle: string, texte: string) {
    try {
      await navigator.clipboard.writeText(texte);
      setCopie(cle);
      setTimeout(() => setCopie((c) => (c === cle ? "" : c)), 1500);
    } catch {
      /* presse-papiers indisponible (http, permissions) : on ne bloque pas */
    }
  }

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

        {/* Bandeau des fournisseurs synchronisés — chaque carte est un filtre */}
        {fournisseurs.length > 0 && (
          <div className="mb-5">
            <div className="mb-2 flex items-center gap-3 text-xs uppercase tracking-wide text-zinc-500">
              <span>Stocks fournisseurs synchronisés</span>
              {marque && (
                <button type="button" onClick={() => setMarque("")} className="normal-case tracking-normal text-sky-300 hover:underline">
                  ✕ retirer le filtre {marque}
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {fournisseurs.map((f) => {
                const age = f.dernierReleve ? (Date.now() - new Date(f.dernierReleve).getTime()) / 86400000 : Infinity;
                const verdict = (f.verdict || "").toLowerCase();
                const echec = Boolean(verdict) && verdict !== "ok" && verdict !== "observation";
                const observation = verdict === "observation" || !f.actif;
                const frais = age <= 2 && !echec;
                const choisi = marque === f.nom;
                const cadre = choisi
                  ? "border-sky-400 bg-sky-500/20 ring-2 ring-sky-400/40"
                  : echec
                    ? "border-rose-500/40 bg-rose-500/10 hover:bg-rose-500/15"
                    : frais ? "border-emerald-500/25 bg-emerald-500/5 hover:bg-emerald-500/10" : "border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/15";
                const infobulle = [
                  f.nom,
                  `${f.nbSku} références relevées`,
                  f.motif || (observation ? "Mode observation : stock relevé chaque jour, mais aucune modification poussée vers Shopify" : ""),
                  choisi ? "Cliquer pour retirer le filtre" : "Cliquer pour ne voir que cette marque",
                ].filter(Boolean).join(" — ");
                return (
                  <button
                    key={f.nom}
                    type="button"
                    title={infobulle}
                    onClick={() => setMarque(choisi ? "" : f.nom)}
                    className={`rounded-xl border px-3 py-2 text-left leading-tight transition ${cadre}`}
                  >
                    <div className="flex items-center gap-1.5">
                      {f.logoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={f.logoUrl} alt={f.nom} className="h-5 max-w-[88px] rounded bg-white object-contain px-1 py-0.5" loading="lazy" />
                      ) : (
                        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-200">{f.nom}</span>
                      )}
                      {echec && <span className="rounded bg-rose-500/20 px-1 text-[9px] text-rose-300">{f.verdict}</span>}
                      {!echec && observation && <span className="rounded bg-zinc-500/20 px-1 text-[9px] text-zinc-400">observation</span>}
                    </div>
                    <div className={`mt-1 text-[11px] ${echec ? "text-rose-300" : frais ? "text-emerald-300/80" : "text-amber-300"}`}>
                      {f.dernierReleve ? `sync ${fmtDate(f.dernierReleve)}` : "jamais relevé"}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="mb-4">
          <input
            type="search"
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={marque ? `Chercher dans ${marque} (ou laisser vide pour tout voir)…` : "Référence, SKU ou titre de l'article (2 caractères min.)…"}
            className="w-full rounded-2xl border border-white/10 bg-[#2a2d31] px-5 py-3.5 text-base text-zinc-100 placeholder:text-zinc-500 outline-none transition focus:border-sky-500/50"
          />
          <div className="mt-2 flex items-center justify-between text-xs text-zinc-500">
            <span>Boutons de ligne : copier le SKU, copier le titre, ouvrir la variante dans un nouvel onglet (boutique, ou admin Shopify si brouillon).</span>
            {cherche && !loading && (
              <span>{rows.length} résultat{rows.length > 1 ? "s" : ""}{tronque ? " — affichage limité à 300, précise la recherche" : ""}</span>
            )}
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>
        )}

        {!rechercheActive ? (
          <div className="rounded-2xl border border-white/10 bg-[#2a2d31] p-8 text-center text-zinc-400">Tape une référence ou un titre, ou clique une marque ci-dessus.</div>
        ) : loading && rows.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-[#2a2d31] p-8 text-center text-zinc-400">Recherche…</div>
        ) : cherche && rows.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-[#2a2d31] p-8 text-center text-zinc-400">
            Aucun article ne correspond{q.trim() ? ` à « ${q.trim()} »` : ""}{marque ? ` chez ${marque}` : ""}.
          </div>
        ) : (
          <div className={`overflow-x-auto rounded-2xl border border-white/10 bg-[#2a2d31] transition ${loading ? "opacity-60" : ""}`}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wide text-zinc-500">
                  <th className="px-3 py-3 w-14"></th>
                  <th className="px-3 py-3">SKU</th>
                  <th className="px-3 py-3">Article</th>
                  <th className="px-3 py-3">Fiche</th>
                  <th className="px-3 py-3 text-right" title="Stock Jardin Confort (miroir Shopify)">Stock JC</th>
                  <th className="px-3 py-3 text-right" title="Stock chez le fournisseur (dernier relevé)">Stock fourn.</th>
                  <th className="px-3 py-3">Chez le fournisseur</th>
                  <th className="px-3 py-3">Dispo dès</th>
                  <th className="px-3 py-3 text-right" title="Acheminement fournisseur → Lutry, en semaines">Transport</th>
                  <th className="px-3 py-3 text-right bg-sky-500/10 text-sky-300" title="Délai à annoncer au client, en semaines (transport compris)">Délai client</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => {
                  const url = urlLigne(l);
                  const cle = `${l.fournisseur}|${l.sku}`;
                  const titreComplet = [l.titre, l.shopify?.varianteTitre].filter(Boolean).join(" — ");
                  return (
                    <tr key={cle} className="group border-b border-white/5 hover:bg-white/[0.03]">
                      <td className="px-3 py-2">
                        {l.shopify?.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={l.shopify.imageUrl} alt="" className="h-10 w-10 rounded-lg object-contain bg-white" loading="lazy" />
                        ) : (
                          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/5 text-zinc-600">🪑</div>
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-zinc-200 select-all">{l.sku}</span>
                          <BoutonAction
                            titre={copie === `sku:${cle}` ? "Copié !" : "Copier le SKU"}
                            actif={copie === `sku:${cle}`}
                            onClick={() => copier(`sku:${cle}`, l.sku)}
                            enfant={ICONE_COPIER}
                          />
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-start gap-1.5">
                          <div className="min-w-0">
                            <div className="font-medium text-zinc-100">
                              {l.titre || <span className="italic text-zinc-500">Titre inconnu (relevé fournisseur)</span>}
                              {l.shopify?.varianteTitre && <span className="ml-2 font-normal text-sky-200/80">{l.shopify.varianteTitre}</span>}
                            </div>
                            <div className="text-xs text-zinc-500">{l.fournisseur}</div>
                          </div>
                          <div className="ml-auto flex shrink-0 items-center gap-1 opacity-40 transition group-hover:opacity-100">
                            {titreComplet && (
                              <BoutonAction
                                titre={copie === `titre:${cle}` ? "Copié !" : "Copier le titre"}
                                actif={copie === `titre:${cle}`}
                                onClick={() => copier(`titre:${cle}`, titreComplet)}
                                enfant={ICONE_COPIER}
                              />
                            )}
                            {url && (
                              <BoutonAction
                                titre={l.shopify?.onlineStoreUrl ? "Ouvrir la variante sur la boutique" : "Fiche non publiée — ouvrir dans l'admin Shopify"}
                                href={url}
                                enfant={ICONE_OUVRIR}
                              />
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2"><BadgeFiche statut={l.statut_fiche} /></td>
                      <td className="px-3 py-2 text-right tabular-nums"><Stock n={l.stock_jc} /></td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        <Stock n={l.stock_fournisseur} />
                        {l.releve_fournisseur_le && (
                          <div className="text-[10px] text-zinc-600" title="Date du dernier relevé fournisseur">relevé {fmtDateHeure(l.releve_fournisseur_le)}</div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {l.statut_fournisseur
                          ? <span className={couleurStatutFournisseur(l.statut_fournisseur)}>{libelleStatutFournisseur(l.statut_fournisseur, l.fournisseur)}</span>
                          : <span className="text-zinc-600">—</span>}
                      </td>
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
