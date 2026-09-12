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
import type { RechercheDelaiRow, StockListShopifyInfo, DispoFournisseur } from "@/lib/supabase-webshop";
import ListeAchatPanneau from "@/components/ListeAchatPanneau";
import { CLE_PANIER, PANIER_VIDE, cleLigne, type LigneListe, type PanierLocal } from "@/lib/listes-achat";

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

// Disponibilité fournisseur UNIFORMISÉE (calculée par la vue à partir du
// vocabulaire de chaque fournisseur). Libellé + couleur uniques pour les
// vendeurs ; le statut brut reste dans l'info-bulle.
const DISPO: Record<DispoFournisseur, { libelle: string; cls: string; ordre: number }> = {
  EN_STOCK:     { libelle: "En stock",     cls: "text-emerald-300", ordre: 0 },
  REASSORT:     { libelle: "Réassort",     cls: "text-amber-300",   ordre: 1 },
  SUR_COMMANDE: { libelle: "Sur commande", cls: "text-amber-300",   ordre: 2 },
  NON_LIVRABLE: { libelle: "Non livrable", cls: "text-rose-400",    ordre: 3 },
  INCONNU:      { libelle: "Inconnu",      cls: "text-zinc-500",    ordre: 4 },
};

// Statuts « fermés à la commande » qui, avec une quantité relevée, veulent
// dire : livrable jusqu'à épuisement du stock fournisseur (Les Jardins
// NON_COMMANDABLE = allow_out_of_stock_order false, fin de série…).
const STATUTS_JUSQU_EPUISEMENT = new Set(["NON_COMMANDABLE", "SOLD_OUT", "SORTIE", "EPUISE", "PHASEOUT", "PHASE_OUT", "OUT_OF_STOCK"]);

function libelleDispo(l: Ligne): string {
  if (!l.dispo_fournisseur) return "";
  const base = `${DISPO[l.dispo_fournisseur].libelle} chez ${l.fournisseur}`;
  if (l.dispo_fournisseur === "EN_STOCK" && STATUTS_JUSQU_EPUISEMENT.has((l.statut_fournisseur || "").toUpperCase())) {
    return `${base} · jusqu'à épuisement`;
  }
  return base;
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

// ─── Tri et filtres rapides (côté client, sur les lignes chargées) ───
type CleTri = "sku" | "titre" | "prix" | "fiche" | "stock_jc" | "stock_fournisseur" | "statut_fournisseur" | "dispo" | "transport" | "delai";

// "2-3" → 2 (borne basse) ; "25-26" → 25 ; vide → Infinity (tout en bas)
function delaiMin(plage: string | null): number {
  const m = (plage || "").match(/\d+/);
  return m ? Number(m[0]) : Infinity;
}
function delaiMax(plage: string | null): number {
  const m = (plage || "").match(/\d+/g);
  return m && m.length ? Number(m[m.length - 1]) : Infinity;
}

function estNonLivrable(l: Ligne): boolean {
  if (l.dispo_fournisseur === "NON_LIVRABLE") return true;
  // Rien chez nous, rien d'annonçable chez le fournisseur
  return (l.stock_jc ?? 0) <= 0 && !l.delai_client_semaines && l.dispo_fournisseur !== "EN_STOCK";
}

type FiltresRapides = {
  stockJC: boolean;          // stock Jardin Confort > 0
  stockFourn: boolean;       // stock fournisseur > 0
  delaiCourt: boolean;       // délai client max ≤ 4 semaines
  masquerNonLivrables: boolean;
  actives: boolean;          // fiche ACTIVE seulement
  horsShopify: boolean;      // SKU relevé mais absent de la boutique
};
const FILTRES_DEFAUT: FiltresRapides = { stockJC: false, stockFourn: false, delaiCourt: false, masquerNonLivrables: false, actives: false, horsShopify: false };

// Côté client il ne reste que « délai court » (plage texte) et le volet
// « rien nulle part » des non livrables ; le reste est filtré par l'API,
// avant la limite de 300 lignes.
function passeFiltres(l: Ligne, f: FiltresRapides): boolean {
  if (f.delaiCourt && delaiMax(l.delai_client_semaines) > 4) return false;
  if (f.masquerNonLivrables && estNonLivrable(l)) return false;
  return true;
}

function valeurTri(l: Ligne, cle: CleTri): string | number {
  switch (cle) {
    case "sku": return l.sku || "";
    case "titre": return (l.titre || "\uffff").toLowerCase();
    case "prix": return typeof l.shopify?.prixTTC === "number" ? l.shopify.prixTTC : Infinity;
    case "fiche": return l.statut_fiche === "ACTIVE" ? 0 : l.statut_fiche === "DRAFT" ? 1 : l.statut_fiche === "ARCHIVED" ? 2 : 3;
    case "stock_jc": return l.stock_jc ?? -1;
    case "stock_fournisseur": return l.stock_fournisseur ?? -1;
    case "statut_fournisseur": return l.dispo_fournisseur ? DISPO[l.dispo_fournisseur].ordre : 9;
    case "dispo": return l.date_dispo_fournisseur || "9999-99-99";
    case "transport": return l.transport_semaines ?? Infinity;
    case "delai": return delaiMin(l.delai_client_semaines);
  }
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

const ICONE_PLUS = (
  <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M8 3v10M3 8h10" />
  </svg>
);

const ICONE_PLUS_GRAND = (
  <svg viewBox="0 0 16 16" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M8 3v10M3 8h10" />
  </svg>
);

function fmtCHF(n: number) {
  return n.toLocaleString("fr-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function BoutonAction({ titre, onClick, actif, enfant, href, grand }: {
  titre: string; onClick?: () => void; actif?: boolean; enfant: React.ReactNode; href?: string; grand?: boolean;
}) {
  const cls = `inline-flex ${grand ? "h-9 w-9 rounded-lg" : "h-6 w-6 rounded-md"} items-center justify-center border transition ${
    actif
      ? "border-emerald-500/50 bg-emerald-500/25 text-emerald-200"
      : grand
        ? "border-sky-500/40 bg-sky-500/15 text-sky-200 hover:bg-sky-500/30"
        : "border-white/10 bg-white/5 text-zinc-400 hover:border-sky-500/40 hover:bg-sky-500/15 hover:text-sky-300"
  }`;
  if (href) {
    return <a href={href} target="_blank" rel="noopener noreferrer" title={titre} className={cls}>{enfant}</a>;
  }
  return <button type="button" title={titre} onClick={onClick} className={cls}>{enfant}</button>;
}

function EnTete({ cle, tri, onClick, droite, surligne, aide, children }: {
  cle: CleTri; tri: { cle: CleTri; desc: boolean } | null; onClick: (c: CleTri) => void;
  droite?: boolean; surligne?: boolean; aide?: string; children: React.ReactNode;
}) {
  const actif = tri?.cle === cle;
  return (
    <th
      className={`px-2 py-3 align-bottom select-none cursor-pointer leading-tight ${droite ? "text-right" : ""} ${surligne ? "bg-sky-500/10 text-sky-300" : ""} ${actif && !surligne ? "text-zinc-200" : ""} hover:text-zinc-200`}
      title={aide ? `${aide} — cliquer pour trier` : "Cliquer pour trier"}
      onClick={() => onClick(cle)}
    >
      {children}
      <span className={`ml-1 text-[10px] ${actif ? "opacity-100" : "opacity-25"}`}>{actif && tri?.desc ? "▼" : "▲"}</span>
    </th>
  );
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
  const [filtres, setFiltres] = useState<FiltresRapides>(FILTRES_DEFAUT);
  const [panier, setPanier] = useState<PanierLocal>(PANIER_VIDE);
  const [panierPret, setPanierPret] = useState(false);
  const [prixConnus, setPrixConnus] = useState<Record<string, number | null>>({});
  const [tri, setTri] = useState<{ cle: CleTri; desc: boolean } | null>(null);
  const requeteEnCours = useRef(0);

  useFiltresMemorises("stock-list-filtres", { q, marque, filtres, tri }, (v) => {
    if (typeof v.q === "string") setQ(v.q);
    if (typeof v.marque === "string") setMarque(v.marque);
    if (v.filtres && typeof v.filtres === "object") setFiltres({ ...FILTRES_DEFAUT, ...(v.filtres as Partial<FiltresRapides>) });
    if (v.tri && typeof v.tri === "object") setTri(v.tri as { cle: CleTri; desc: boolean });
  });

  function basculerFiltre(cle: keyof FiltresRapides) {
    setFiltres((f) => ({ ...f, [cle]: !f[cle] }));
  }

  // Clic sur un en-tête : tri croissant, re-clic : décroissant, 3e clic : tri d'origine.
  function trierPar(cle: CleTri) {
    setTri((t) => (!t || t.cle !== cle ? { cle, desc: false } : !t.desc ? { cle, desc: true } : null));
  }

  const lignesFiltrees = rows.filter((l) => passeFiltres(l, filtres));
  const lignesAffichees = tri
    ? [...lignesFiltrees].sort((a, b) => {
        const va = valeurTri(a, tri.cle), vb = valeurTri(b, tri.cle);
        const c = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), "fr");
        return tri.desc ? -c : c;
      })
    : lignesFiltrees;
  const nbFiltresActifs = Object.values(filtres).filter(Boolean).length;

  // Panier : restauré depuis le navigateur, ou chargé depuis ?liste=<id>
  // (lien « Ouvrir dans Stock list » de la page Listes d'achat).
  useEffect(() => {
    const idListe = new URLSearchParams(window.location.search).get("liste");
    if (idListe) {
      fetch(`/api/listes-achat/${idListe}`)
        .then((r) => r.json())
        .then((j) => {
          if (j.liste) {
            setPanier({ id: j.liste.est_modele ? null : j.liste.id, nom: j.liste.nom, est_modele: false, lignes: j.liste.lignes || [] });
          }
        })
        .catch(() => { /* on garde le panier local */ })
        .finally(() => setPanierPret(true));
      return;
    }
    try {
      const brut = window.localStorage.getItem(CLE_PANIER);
      if (brut) {
        const lu = JSON.parse(brut) as PanierLocal;
        if (lu && Array.isArray(lu.lignes)) setPanier({ ...PANIER_VIDE, ...lu });
      }
    } catch { /* localStorage indisponible */ }
    setPanierPret(true);
  }, []);
  useEffect(() => {
    if (!panierPret) return;
    try { window.localStorage.setItem(CLE_PANIER, JSON.stringify(panier)); } catch { /* ignore */ }
  }, [panier, panierPret]);

  function ajouterAuPanier(l: Ligne) {
    const cle = cleLigne(l);
    setPanier((p) => {
      const existe = p.lignes.find((x) => cleLigne(x) === cle);
      if (existe) {
        return { ...p, lignes: p.lignes.map((x) => (cleLigne(x) === cle ? { ...x, qty: Math.min(999, x.qty + 1) } : x)) };
      }
      const ligne: LigneListe = {
        fournisseur: l.fournisseur,
        sku: l.sku,
        titre: l.titre,
        variante_titre: l.shopify?.varianteTitre ?? null,
        variant_id: l.variant_id ? String(l.variant_id) : null,
        product_id: l.product_id ? String(l.product_id) : null,
        statut_fiche: l.statut_fiche,
        qty: 1,
        image_url: l.shopify?.imageUrl ?? null,
      };
      return { ...p, lignes: [...p.lignes, ligne] };
    });
  }
  const qtyPanier = (l: Ligne) => panier.lignes.find((x) => cleLigne(x) === cleLigne(l))?.qty ?? 0;

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
        for (const cle of ["stockJC", "stockFourn", "masquerNonLivrables", "actives", "horsShopify"] as const) {
          if (filtres[cle]) params.set(cle, "1");
        }
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
        setPrixConnus((prev) => {
          const suite = { ...prev };
          for (const l of lignes) {
            const info = infos[cleVariante(l.variant_id)];
            if (info) suite[cleLigne(l)] = info.prixTTC;
          }
          return suite;
        });
      } catch (e) {
        if (id !== requeteEnCours.current) return;
        setError(String(e)); setLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, marque, filtres.stockJC, filtres.stockFourn, filtres.masquerNonLivrables, filtres.actives, filtres.horsShopify]);

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
      {/* Pleine largeur (plafond 1 900 px) : la page est un outil de tableau, elle doit
          profiter des grands écrans du magasin. */}
      <div className="mx-auto max-w-[1900px] px-4 pb-28 pt-8 text-zinc-100 lg:px-6">
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
                // Cartes sur fond blanc : les logos sont dessinés pour ça.
                const cadre = choisi
                  ? "border-sky-500 bg-sky-100 ring-4 ring-sky-500 ring-offset-2 ring-offset-[#1f2125] shadow-lg shadow-sky-500/30"
                  : echec
                    ? "border-rose-400 bg-white hover:bg-rose-50"
                    : frais ? "border-white/60 bg-white hover:bg-zinc-100" : "border-amber-400 bg-white hover:bg-amber-50";
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
                    <div className="flex h-6 items-center gap-1.5">
                      {f.logoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={f.logoUrl} alt={f.nom} className="h-6 max-w-[96px] object-contain" loading="lazy" />
                      ) : (
                        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-800">{f.nom}</span>
                      )}
                      {echec && <span className="rounded bg-rose-100 px-1 text-[9px] text-rose-700">{f.verdict}</span>}
                      {!echec && observation && <span className="rounded bg-zinc-200 px-1 text-[9px] text-zinc-600">observation</span>}
                    </div>
                    <div className={`mt-1 text-[11px] ${echec ? "text-rose-600" : frais ? "text-emerald-700" : "text-amber-700"}`}>
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
            <span>Boutons de ligne : + ajouter à la liste d&apos;achat, copier le SKU, copier le titre, ouvrir la variante (boutique, ou admin Shopify si brouillon).</span>
            {cherche && !loading && (
              <span>
                {lignesAffichees.length !== rows.length ? `${lignesAffichees.length} sur ` : ""}{rows.length} résultat{rows.length > 1 ? "s" : ""}
                {tronque ? " — chargement limité à 300, précise la recherche" : ""}
              </span>
            )}
          </div>
        </div>

        {/* Filtres rapides — appliqués par l'API avant la limite de 300 (sauf délai court) */}
        {rechercheActive && (
          <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-zinc-500">Filtres :</span>
            {([
              ["stockJC", "En stock Jardin Confort", "stock_jc > 0"],
              ["stockFourn", "En stock chez le fournisseur", "disponibilité fournisseur = en stock (quantité ou statut)"],
              ["delaiCourt", "Délai ≤ 4 sem.", "borne haute du délai client ≤ 4 semaines"],
              ["masquerNonLivrables", "Masquer les non livrables", "sold out / sortie / rupture / non commandable, ou rien nulle part et aucun délai"],
              ["actives", "Fiches actives", "statut de fiche ACTIVE seulement"],
              ["horsShopify", "Hors Shopify", "relevé fournisseur sans fiche dans la boutique — à créer"],
            ] as [keyof FiltresRapides, string, string][]).map(([cle, libelle, aide]) => {
              const actif = filtres[cle];
              return (
                <button
                  key={cle}
                  type="button"
                  title={aide}
                  onClick={() => basculerFiltre(cle)}
                  className={`rounded-full border px-3 py-1 transition ${
                    actif
                      ? "border-sky-400 bg-sky-500/20 text-sky-200"
                      : "border-white/10 bg-white/5 text-zinc-400 hover:border-white/25 hover:text-zinc-200"
                  }`}
                >
                  {libelle}
                </button>
              );
            })}
            {nbFiltresActifs > 0 && (
              <button type="button" onClick={() => setFiltres(FILTRES_DEFAUT)} className="text-sky-300 hover:underline">✕ tout enlever</button>
            )}
            {tri && (
              <button type="button" onClick={() => setTri(null)} className="ml-auto text-zinc-500 hover:text-zinc-300">tri d&apos;origine</button>
            )}
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>
        )}

        {!rechercheActive ? (
          <div className="rounded-2xl border border-white/10 bg-[#2a2d31] p-8 text-center text-zinc-400">Tape une référence ou un titre, ou clique une marque ci-dessus.</div>
        ) : loading && rows.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-[#2a2d31] p-8 text-center text-zinc-400">Recherche…</div>
        ) : cherche && rows.length > 0 && lignesAffichees.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-[#2a2d31] p-8 text-center text-zinc-400">
            Les {rows.length} résultats sont masqués par les filtres.{" "}
            <button type="button" onClick={() => setFiltres(FILTRES_DEFAUT)} className="text-sky-300 hover:underline">Tout enlever</button>
          </div>
        ) : cherche && rows.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-[#2a2d31] p-8 text-center text-zinc-400">
            Aucun article ne correspond{q.trim() ? ` à « ${q.trim()} »` : ""}{marque ? ` chez ${marque}` : ""}.
          </div>
        ) : (
          <div className={`overflow-x-auto rounded-2xl border border-white/10 bg-[#2a2d31] transition ${loading ? "opacity-60" : ""}`}>
            {/* table-fixed + colgroup : largeurs stables, la colonne Article prend tout
                le reste ; sans ça les titres se cassaient sur 5 lignes et la vignette
                se faisait écraser à quelques pixels. */}
            <table className="w-full min-w-[1170px] table-fixed text-sm">
              <colgroup>
                <col className="w-[60px]" />
                <col className="w-[160px]" />
                <col />
                <col className="w-[92px]" />
                <col className="w-[86px]" />
                <col className="w-[66px]" />
                <col className="w-[88px]" />
                <col className="w-[168px]" />
                <col className="w-[86px]" />
                <col className="w-[74px]" />
                <col className="w-[104px]" />
              </colgroup>
              <thead>
                <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wide text-zinc-500">
                  <th className="px-3 py-3"></th>
                  <EnTete cle="sku" tri={tri} onClick={trierPar}>SKU</EnTete>
                  <EnTete cle="titre" tri={tri} onClick={trierPar}>Article</EnTete>
                  <EnTete cle="prix" tri={tri} onClick={trierPar} droite aide="Prix de vente Shopify TTC, lu à l'instant">Prix<br />TTC</EnTete>
                  <EnTete cle="fiche" tri={tri} onClick={trierPar}>Fiche</EnTete>
                  <EnTete cle="stock_jc" tri={tri} onClick={trierPar} droite aide="Stock Jardin Confort (miroir Shopify)">Stock<br />JC</EnTete>
                  <EnTete cle="stock_fournisseur" tri={tri} onClick={trierPar} droite aide="Stock chez le fournisseur (dernier relevé)">Stock<br />fourn.</EnTete>
                  <EnTete cle="statut_fournisseur" tri={tri} onClick={trierPar}>Chez le<br />fournisseur</EnTete>
                  <EnTete cle="dispo" tri={tri} onClick={trierPar}>Dispo<br />dès</EnTete>
                  <EnTete cle="transport" tri={tri} onClick={trierPar} droite aide="Acheminement fournisseur → Lutry, en semaines">Trans-<br />port</EnTete>
                  <EnTete cle="delai" tri={tri} onClick={trierPar} droite surligne aide="Délai à annoncer au client, en semaines (transport compris)">Délai<br />client</EnTete>
                </tr>
              </thead>
              <tbody>
                {lignesAffichees.map((l) => {
                  const url = urlLigne(l);
                  const cle = `${l.fournisseur}|${l.sku}`;
                  const titreComplet = [l.titre, l.shopify?.varianteTitre].filter(Boolean).join(" — ");
                  return (
                    <tr key={cle} className="group border-b border-white/5 hover:bg-white/[0.03]">
                      <td className="px-2 py-2">
                        <div className="h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-white">
                          {l.shopify?.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={l.shopify.imageUrl} alt="" className="h-full w-full object-contain" loading="lazy" />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center bg-white/5 text-lg text-zinc-600" title="Pas d'image (article absent de Shopify ou sans photo)">×</div>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span className="select-all text-[15px] tracking-wide text-zinc-100">{l.sku}</span>
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
                            <div className="font-medium leading-snug text-zinc-100">
                              {l.titre || <span className="italic text-zinc-500">Titre inconnu (relevé fournisseur)</span>}
                            </div>
                            {l.shopify?.varianteTitre && (
                              <div className="leading-snug text-sky-200/85">
                                {(l.shopify.options.length > 0 ? l.shopify.options : l.shopify.varianteTitre.split(" / ")).map((o, i) => (
                                  <div key={i}>{o}</div>
                                ))}
                              </div>
                            )}
                            <div className="text-xs text-zinc-500">{l.fournisseur}</div>
                          </div>
                          <div className="ml-auto flex shrink-0 items-center gap-1.5">
                            <BoutonAction
                              grand
                              titre={qtyPanier(l) > 0 ? `Dans la liste (${qtyPanier(l)}) — cliquer pour +1` : "Ajouter à la liste d'achat"}
                              actif={qtyPanier(l) > 0}
                              onClick={() => ajouterAuPanier(l)}
                              enfant={qtyPanier(l) > 0 ? <span className="text-sm font-bold">{qtyPanier(l)}</span> : ICONE_PLUS_GRAND}
                            />
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
                      <td className="px-2 py-2 text-right tabular-nums text-zinc-200">
                        {typeof l.shopify?.prixTTC === "number" ? fmtCHF(l.shopify.prixTTC) : <span className="text-zinc-600">—</span>}
                      </td>
                      <td className="px-3 py-2"><BadgeFiche statut={l.statut_fiche} /></td>
                      <td className="px-2 py-2 text-right tabular-nums"><Stock n={l.stock_jc} /></td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        <Stock n={l.stock_fournisseur} />
                        {l.releve_fournisseur_le && (
                          <div className="text-[10px] leading-tight text-zinc-600" title="Date et heure du dernier relevé fournisseur">{fmtDateHeure(l.releve_fournisseur_le)}</div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {l.dispo_fournisseur
                          ? <span className={DISPO[l.dispo_fournisseur].cls} title={l.statut_fournisseur ? `Statut ${l.fournisseur} : ${l.statut_fournisseur}` : "Déduit de la quantité relevée"}>{libelleDispo(l)}</span>
                          : <span className="text-zinc-600">—</span>}
                      </td>
                      <td className="px-2 py-2 tabular-nums text-zinc-300">{fmtDate(l.date_dispo_fournisseur) || <span className="text-zinc-600">—</span>}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-zinc-300">{l.transport_semaines !== null ? `${l.transport_semaines} sem.` : <span className="text-zinc-600">—</span>}</td>
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
      <ListeAchatPanneau panier={panier} setPanier={setPanier} prix={prixConnus} />
    </main>
  );
}
