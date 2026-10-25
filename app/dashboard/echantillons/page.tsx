"use client";
// app/dashboard/echantillons/page.tsx
// « Banque d'échantillons » (25.10.2026) — toutes les finitions de la base
// matières (table `matieres`, Supabase) : vignettes, filtres (marque, famille,
// gamme, teinte du filtre couleur, qualité), contrôles (non publiées dans
// Shopify Files, teinte non validée, qualité basse, non utilisées sur la
// boutique…) et fiche détaillée de chaque finition.
//
// 100 % LECTURE SEULE : la page ne modifie ni la base matières ni Shopify.
// Les corrections se font par les circuits habituels (import, page de revue
// des teintes, relevé Shopify).

import React, { useEffect, useMemo, useState } from "react";
import RetourDashboard from "@/components/RetourDashboard";

type Matiere = {
  cle: string; marque: string; famille: string; gamme: string | null; code: string; nom: string;
  nom_origine: string | null; alias: string[] | null; usages: string[] | null;
  hex: string | null; hex_source: string | null; hex_fabricant: string | null; hex_mesure: string | null;
  teinte_filtre: string[] | null; teinte_source: string | null; teinte_validee_le: string | null;
  motif: boolean | null; clair: boolean | null;
  qualite: string | null; maitre_cote: number | null;
  source_type: string | null; nom_source: string | null; code_source: string | null;
  liste_prix_annee: number | null; collection_annee: number | null; nouveau: boolean | null;
  url_vignette: string | null; url_maitre: string | null;
  shop_url_vignette: string | null; shop_url_maitre: string | null; shop_file_id_maitre: string | null;
  shop_version: string | null; image_version: string | null; shop_publie_le: string | null;
  shopify_nb_fiches: number | null; shopify_nb_variantes: number | null; shopify_valeurs: string[] | null; shopify_vu_le: string | null;
  image_maj_le: string | null; created_at: string | null; updated_at: string | null;
};

// Teintes du filtre couleur de la boutique (Search & Discovery) — mêmes slugs
// et mêmes pastilles que la page de revue des teintes.
const TEINTES: { slug: string; nom: string; hex: string }[] = [
  { slug: "blanc", nom: "Blanc", hex: "#F4F2EE" },
  { slug: "beige-sable", nom: "Beige / Sable", hex: "#D8C9AB" },
  { slug: "jaune", nom: "Jaune", hex: "#E8BC26" },
  { slug: "orange", nom: "Orange", hex: "#E2701E" },
  { slug: "rouge", nom: "Rouge", hex: "#B5232A" },
  { slug: "rose", nom: "Rose", hex: "#E099AB" },
  { slug: "violet", nom: "Violet", hex: "#6B4A8F" },
  { slug: "bleu", nom: "Bleu", hex: "#2F5FA8" },
  { slug: "vert", nom: "Vert", hex: "#4A7A3A" },
  { slug: "brun", nom: "Brun", hex: "#6F4A2E" },
  { slug: "gris", nom: "Gris", hex: "#9A9A99" },
  { slug: "anthracite", nom: "Anthracite", hex: "#525456" },
  { slug: "noir", nom: "Noir", hex: "#1A1A1A" },
  { slug: "bois-naturel", nom: "Bois naturel", hex: "#B98B52" },
  { slug: "inox-argent", nom: "Inox / Argent", hex: "#B6BCC0" },
  { slug: "beton-pierre", nom: "Béton / Pierre", hex: "#A9A49B" },
  { slug: "multicolore-motif", nom: "Multicolore / Motif", hex: "conic-gradient(#B5232A,#E8BC26,#4A7A3A,#2F5FA8,#B5232A)" },
];
const TEINTE = Object.fromEntries(TEINTES.map((t) => [t.slug, t]));

type Controle =
  | "" | "a_controler" | "non_publie" | "version_decalee" | "teinte_non_validee" | "sans_teinte"
  | "qualite_basse" | "qualite_moyenne" | "sans_image" | "non_utilisee" | "utilisee" | "nouveau";

const CONTROLES: { v: Controle; l: string }[] = [
  { v: "", l: "Toutes les finitions" },
  { v: "a_controler", l: "⚠️ À contrôler (image, Shopify, teinte)" },
  { v: "non_publie", l: "Pas dans Shopify Files" },
  { v: "version_decalee", l: "Image Shopify pas à jour" },
  { v: "teinte_non_validee", l: "Teinte non validée" },
  { v: "sans_teinte", l: "Sans teinte" },
  { v: "qualite_basse", l: "Qualité basse (< 300 px)" },
  { v: "qualite_moyenne", l: "Qualité moyenne (300–999 px)" },
  { v: "sans_image", l: "Sans image" },
  { v: "non_utilisee", l: "Pas utilisée sur la boutique" },
  { v: "utilisee", l: "Utilisée sur la boutique" },
  { v: "nouveau", l: "Nouveautés" },
];

type Tri = "catalogue" | "nom" | "teinte" | "utilisation" | "recent" | "clair";
const TRIS: { v: Tri; l: string }[] = [
  { v: "catalogue", l: "Marque › gamme › code" },
  { v: "nom", l: "Nom (A → Z)" },
  { v: "teinte", l: "Teinte du filtre" },
  { v: "clair", l: "Du clair au foncé" },
  { v: "utilisation", l: "Les plus utilisées" },
  { v: "recent", l: "Ajouts récents" },
];

const TAILLES = { s: 56, m: 84, l: 120 } as const;
type Taille = keyof typeof TAILLES;
const PAR_PAGE = 600;

function problemes(m: Matiere): string[] {
  const p: string[] = [];
  if (!m.url_maitre) p.push("sans image");
  if (!m.shop_file_id_maitre) p.push("pas dans Shopify Files");
  else if (m.shop_version && m.image_version && m.shop_version !== m.image_version) p.push("image Shopify pas à jour");
  if (!m.teinte_filtre || m.teinte_filtre.length === 0) p.push("sans teinte");
  else if (m.teinte_source !== "validee") p.push("teinte non validée");
  return p;
}

function vignette(m: Matiere, px: number): string | null {
  if (m.shop_url_vignette) return `${m.shop_url_vignette}?width=${px * 2}&v=${m.shop_version ?? ""}`;
  return m.url_vignette;
}

function luminance(hex: string | null): number {
  const h = (hex || "").replace("#", "");
  if (h.length !== 6) return 0.5;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function dateCH(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}

function sansAccent(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function Pastille({ slug, taille = 12 }: { slug: string; taille?: number }) {
  const t = TEINTE[slug];
  if (!t) return null;
  const fond = t.hex.startsWith("conic") ? { backgroundImage: t.hex } : { backgroundColor: t.hex };
  return <span title={t.nom} className="inline-block shrink-0 rounded-full border border-white/30" style={{ width: taille, height: taille, ...fond }} />;
}

function csv(rows: Matiere[]): string {
  const cols: (keyof Matiere)[] = ["cle", "marque", "famille", "gamme", "code", "nom", "hex", "teinte_filtre", "teinte_source", "qualite", "maitre_cote", "shopify_nb_fiches", "shop_url_vignette"];
  const esc = (v: unknown) => {
    const s = Array.isArray(v) ? v.join(", ") : v == null ? "" : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(";"), ...rows.map((r) => [...cols.map((c) => esc(r[c])), ""].slice(0, cols.length).join(";")), ""].join("\n");
}

export default function EchantillonsPage() {
  const [rows, setRows] = useState<Matiere[]>([]);
  const [luLe, setLuLe] = useState<string | null>(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");

  const [q, setQ] = useState("");
  const [marque, setMarque] = useState("");
  const [famille, setFamille] = useState("");
  const [gamme, setGamme] = useState("");
  const [teintes, setTeintes] = useState<string[]>([]);
  const [controle, setControle] = useState<Controle>("");
  const [tri, setTri] = useState<Tri>("catalogue");
  const [taille, setTaille] = useState<Taille>("m");
  const [noms, setNoms] = useState(true);
  const [limite, setLimite] = useState(PAR_PAGE);
  const [choisie, setChoisie] = useState<Matiere | null>(null);

  async function charger() {
    setChargement(true);
    setErreur("");
    try {
      const r = await fetch("/api/echantillons");
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      setRows(j.rows || []);
      setLuLe(j.lu_le || null);
    } catch (e) {
      setErreur((e as Error).message);
    } finally {
      setChargement(false);
    }
  }
  useEffect(() => { charger(); }, []);

  // Préférences d'affichage gardées d'une visite à l'autre (comme les filtres du dashboard)
  useEffect(() => {
    try {
      const p = JSON.parse(localStorage.getItem("jc_echantillons_aff") || "{}");
      if (p.taille && p.taille in TAILLES) setTaille(p.taille);
      if (typeof p.noms === "boolean") setNoms(p.noms);
    } catch { /* rien */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem("jc_echantillons_aff", JSON.stringify({ taille, noms })); } catch { /* rien */ }
  }, [taille, noms]);

  useEffect(() => { setLimite(PAR_PAGE); }, [q, marque, famille, gamme, teintes, controle, tri]);
  useEffect(() => { setGamme(""); }, [marque, famille]);

  // Fermer la fiche avec Échap
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setChoisie(null); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);

  const marques = useMemo(() => {
    const m = new Map<string, { marque: string; n: number; publiees: number; validees: number; utilisees: number; basses: number; aControler: number; releve: string | null }>();
    for (const r of rows) {
      const x = m.get(r.marque) || { marque: r.marque, n: 0, publiees: 0, validees: 0, utilisees: 0, basses: 0, aControler: 0, releve: null };
      x.n++;
      if (r.shop_file_id_maitre) x.publiees++;
      if (r.teinte_source === "validee") x.validees++;
      if ((r.shopify_nb_fiches || 0) > 0) x.utilisees++;
      if (r.qualite === "basse") x.basses++;
      if (problemes(r).length) x.aControler++;
      if (r.shopify_vu_le && (!x.releve || r.shopify_vu_le > x.releve)) x.releve = r.shopify_vu_le;
      m.set(r.marque, x);
    }
    return [...m.values()].sort((a, b) => a.marque.localeCompare(b.marque));
  }, [rows]);

  const familles = useMemo(() => [...new Set(rows.filter((r) => !marque || r.marque === marque).map((r) => r.famille))].sort(), [rows, marque]);
  const gammes = useMemo(
    () => [...new Set(rows.filter((r) => (!marque || r.marque === marque) && (!famille || r.famille === famille)).map((r) => r.gamme || ""))].filter(Boolean).sort(),
    [rows, marque, famille],
  );

  const filtrees = useMemo(() => {
    const mots = sansAccent(q.trim()).split(/\s+/).filter(Boolean);
    const res = rows.filter((r) => {
      if (marque && r.marque !== marque) return false;
      if (famille && r.famille !== famille) return false;
      if (gamme && (r.gamme || "") !== gamme) return false;
      if (teintes.length && !teintes.every((t) => (r.teinte_filtre || []).includes(t))) return false;
      const pb = problemes(r);
      switch (controle) {
        case "a_controler": if (!pb.length) return false; break;
        case "non_publie": if (r.shop_file_id_maitre) return false; break;
        case "version_decalee": if (!pb.includes("image Shopify pas à jour")) return false; break;
        case "teinte_non_validee": if (r.teinte_source === "validee" || !(r.teinte_filtre || []).length) return false; break;
        case "sans_teinte": if ((r.teinte_filtre || []).length) return false; break;
        case "qualite_basse": if (r.qualite !== "basse") return false; break;
        case "qualite_moyenne": if (r.qualite !== "moyenne") return false; break;
        case "sans_image": if (r.url_maitre) return false; break;
        case "non_utilisee": if ((r.shopify_nb_fiches || 0) > 0) return false; break;
        case "utilisee": if (!((r.shopify_nb_fiches || 0) > 0)) return false; break;
        case "nouveau": if (!r.nouveau) return false; break;
      }
      if (mots.length) {
        const texte = sansAccent([r.cle, r.marque, r.gamme, r.code, r.nom, r.nom_origine, ...(r.alias || []), ...(r.shopify_valeurs || [])].join(" "));
        if (!mots.every((m) => texte.includes(m))) return false;
      }
      return true;
    });
    const ordreTeinte = (r: Matiere) => {
      const i = TEINTES.findIndex((t) => t.slug === (r.teinte_filtre || [])[0]);
      return i < 0 ? 99 : i;
    };
    res.sort((a, b) => {
      switch (tri) {
        case "nom": return a.nom.localeCompare(b.nom) || a.marque.localeCompare(b.marque);
        case "teinte": return ordreTeinte(a) - ordreTeinte(b) || luminance(b.hex) - luminance(a.hex);
        case "clair": return luminance(b.hex) - luminance(a.hex);
        case "utilisation": return (b.shopify_nb_fiches || 0) - (a.shopify_nb_fiches || 0) || a.nom.localeCompare(b.nom);
        case "recent": return (b.created_at || "").localeCompare(a.created_at || "");
        default:
          return a.marque.localeCompare(b.marque) || a.famille.localeCompare(b.famille) || (a.gamme || "").localeCompare(b.gamme || "") || a.code.localeCompare(b.code, "fr", { numeric: true });
      }
    });
    return res;
  }, [rows, q, marque, famille, gamme, teintes, controle, tri]);

  const kpi = useMemo(() => ({
    total: rows.length,
    marques: marques.length,
    publiees: rows.filter((r) => r.shop_file_id_maitre).length,
    validees: rows.filter((r) => r.teinte_source === "validee").length,
    utilisees: rows.filter((r) => (r.shopify_nb_fiches || 0) > 0).length,
    aControler: rows.filter((r) => problemes(r).length).length,
  }), [rows, marques]);

  const px = TAILLES[taille];
  const visibles = filtrees.slice(0, limite);

  // Intertitres « marque › gamme » quand on trie par catalogue
  const avecTitres = tri === "catalogue";
  let dernierTitre = "";

  function exporter() {
    const blob = new Blob(["﻿" + csv(filtrees)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `echantillons_${marque || "toutes-marques"}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const champ = "rounded-xl border border-white/10 bg-[#2a2d31] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-sky-500/50";

  return (
    <main className="min-h-screen bg-[#1f2125]">
      <div className="mx-auto max-w-[1600px] px-4 pb-28 pt-8 text-zinc-100 lg:px-6">
        <RetourDashboard />
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">🎨 Banque d&apos;échantillons</h1>
            <p className="mt-1 max-w-3xl text-sm text-zinc-400">
              Toutes les couleurs, tissus et finitions de la base matières, avec leur teinte du filtre couleur de la boutique,
              leur publication dans Shopify Files et leur utilisation sur les fiches. Lecture seule — clique une vignette pour sa fiche.
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

        {/* KPI — les cartes cliquables servent de filtre rapide */}
        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          {([
            ["Finitions", kpi.total, "", ""],
            ["Marques", kpi.marques, "", ""],
            ["Dans Shopify Files", kpi.publiees, "text-emerald-300", "non_publie"],
            ["Teintes validées", kpi.validees, "text-emerald-300", "teinte_non_validee"],
            ["Utilisées sur la boutique", kpi.utilisees, "text-sky-300", "non_utilisee"],
            ["À contrôler", kpi.aControler, "text-amber-300", "a_controler"],
          ] as [string, number, string, Controle | ""][]).map(([l, v, cls, ctl]) => (
            <button
              key={l}
              type="button"
              onClick={() => ctl && setControle(controle === ctl ? "" : (ctl as Controle))}
              className={`rounded-2xl border px-4 py-3 text-left transition ${ctl && controle === ctl ? "border-amber-400/60 bg-amber-500/10" : "border-white/10 bg-[#2a2d31]"} ${ctl ? "hover:bg-white/5" : "cursor-default"}`}
              title={ctl ? "Cliquer pour filtrer (les finitions qui ne remplissent pas ce critère)" : ""}
            >
              <div className="text-[11px] uppercase tracking-wide text-zinc-500">{l}</div>
              <div className={`text-2xl font-semibold ${cls}`}>
                {v.toLocaleString("fr-CH")}
                {ctl && ctl !== "a_controler" && kpi.total > 0 && <span className="ml-2 text-xs font-normal text-zinc-500">{Math.round((100 * v) / kpi.total)} %</span>}
              </div>
            </button>
          ))}
        </div>

        {/* Synthèse par marque — chaque ligne est un filtre */}
        <details className="mb-6 rounded-2xl border border-white/10 bg-[#2a2d31]" open>
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-zinc-300">Par marque <span className="text-zinc-500">(clique une ligne pour filtrer)</span></summary>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-3 py-2">Marque</th>
                  <th className="px-3 py-2 text-right">Finitions</th>
                  <th className="px-3 py-2 text-right">Shopify Files</th>
                  <th className="px-3 py-2 text-right">Teintes validées</th>
                  <th className="px-3 py-2 text-right">Utilisées</th>
                  <th className="px-3 py-2 text-right">Qualité basse</th>
                  <th className="px-3 py-2 text-right text-amber-300">À contrôler</th>
                  <th className="px-3 py-2 text-right">Dernier relevé</th>
                </tr>
              </thead>
              <tbody>
                {marques.map((m) => {
                  const actif = marque === m.marque;
                  return (
                    <tr key={m.marque} onClick={() => setMarque(actif ? "" : m.marque)} className={`cursor-pointer border-t border-white/5 transition hover:bg-white/5 ${actif ? "bg-sky-500/10" : ""}`}>
                      <td className="px-3 py-1.5 font-medium">{m.marque}</td>
                      <td className="px-3 py-1.5 text-right">{m.n}</td>
                      <td className={`px-3 py-1.5 text-right ${m.publiees < m.n ? "text-amber-300" : "text-emerald-300"}`}>{m.publiees}</td>
                      <td className={`px-3 py-1.5 text-right ${m.validees < m.n ? "text-amber-300" : "text-emerald-300"}`}>{m.validees}</td>
                      <td className="px-3 py-1.5 text-right">{m.utilisees}</td>
                      <td className="px-3 py-1.5 text-right">{m.basses || ""}</td>
                      <td className="px-3 py-1.5 text-right text-amber-300">{m.aControler || ""}</td>
                      <td className="px-3 py-1.5 text-right text-zinc-400">{dateCH(m.releve)}</td>
                    </tr>
                  );
                })}
                {!chargement && marques.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-zinc-500">Aucune finition.</td></tr>}
              </tbody>
            </table>
          </div>
        </details>

        {/* Filtres */}
        <div className="sticky top-0 z-20 -mx-4 mb-4 border-b border-white/10 bg-[#1f2125]/95 px-4 py-3 backdrop-blur lg:-mx-6 lg:px-6">
          <div className="flex flex-wrap items-center gap-2">
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nom, code, alias, valeur de variante Shopify…" className={`${champ} min-w-[240px] flex-1`} />
            <select value={marque} onChange={(e) => setMarque(e.target.value)} className={champ}>
              <option value="">Toutes les marques</option>
              {marques.map((m) => <option key={m.marque} value={m.marque}>{m.marque} ({m.n})</option>)}
            </select>
            <select value={famille} onChange={(e) => setFamille(e.target.value)} className={champ}>
              <option value="">Toutes les familles</option>
              {familles.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
            <select value={gamme} onChange={(e) => setGamme(e.target.value)} className={champ} disabled={gammes.length === 0}>
              <option value="">Toutes les gammes</option>
              {gammes.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
            <select value={controle} onChange={(e) => setControle(e.target.value as Controle)} className={champ}>
              {CONTROLES.map((c) => <option key={c.v} value={c.v}>{c.l}</option>)}
            </select>
            <select value={tri} onChange={(e) => setTri(e.target.value as Tri)} className={champ} title="Tri">
              {TRIS.map((t) => <option key={t.v} value={t.v}>↕ {t.l}</option>)}
            </select>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs text-zinc-500">Teinte :</span>
            {TEINTES.map((t) => {
              const on = teintes.includes(t.slug);
              return (
                <button key={t.slug} type="button" onClick={() => setTeintes(on ? teintes.filter((x) => x !== t.slug) : [...teintes, t.slug])}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition ${on ? "border-sky-400 bg-sky-500/20 text-sky-100" : "border-white/10 bg-white/5 text-zinc-400 hover:bg-white/10"}`}>
                  <Pastille slug={t.slug} /> {t.nom}
                </button>
              );
            })}
            {(teintes.length > 0 || q || marque || famille || gamme || controle) && (
              <button type="button" onClick={() => { setTeintes([]); setQ(""); setMarque(""); setFamille(""); setGamme(""); setControle(""); }} className="ml-1 text-xs text-sky-300 hover:underline">✕ tout effacer</button>
            )}
            <span className="ml-auto flex items-center gap-2 text-xs text-zinc-500">
              <span>{chargement ? "chargement…" : `${filtrees.length.toLocaleString("fr-CH")} finition${filtrees.length > 1 ? "s" : ""}`}</span>
              <span className="inline-flex overflow-hidden rounded-lg border border-white/10">
                {(Object.keys(TAILLES) as Taille[]).map((t) => (
                  <button key={t} type="button" onClick={() => setTaille(t)} className={`px-2 py-1 ${taille === t ? "bg-white/15 text-zinc-100" : "text-zinc-400 hover:bg-white/5"}`}>{t.toUpperCase()}</button>
                ))}
              </span>
              <label className="flex cursor-pointer items-center gap-1"><input type="checkbox" checked={noms} onChange={(e) => setNoms(e.target.checked)} /> noms</label>
              <button type="button" onClick={exporter} disabled={!filtrees.length} className="rounded-lg border border-white/10 px-2 py-1 text-zinc-300 hover:bg-white/5 disabled:opacity-50">⬇ CSV</button>
            </span>
          </div>
        </div>

        {/* Grille de vignettes */}
        <div className="flex flex-wrap gap-x-3 gap-y-4">
          {visibles.map((m) => {
            const pb = problemes(m);
            const titre = `${m.marque} › ${m.famille}${m.gamme ? " › " + m.gamme : ""}`;
            let entete: React.ReactNode = null;
            if (avecTitres && titre !== dernierTitre) {
              dernierTitre = titre;
              entete = (
                <div key={"t-" + titre} className="mt-3 w-full border-b border-white/10 pb-1 text-sm font-semibold text-zinc-300 first:mt-0">
                  {m.marque} <span className="text-zinc-500">› {m.famille}{m.gamme ? ` › ${m.gamme}` : ""}</span>
                </div>
              );
            }
            const src = vignette(m, px);
            return (
              <React.Fragment key={m.cle}>
                {entete}
                <button type="button" onClick={() => setChoisie(m)} className="group flex flex-col items-center text-center" style={{ width: px + (noms ? 28 : 8) }} title={`${m.nom}${m.code ? " · " + m.code : ""}\n${titre}${pb.length ? "\n⚠ " + pb.join(", ") : ""}`}>
                  <span className="relative">
                    {src
                      ? <img src={src} alt={m.nom} loading="lazy" className={`rounded-full object-cover shadow-[0_0_0_1px_rgba(255,255,255,0.15)] transition group-hover:scale-105 ${choisie?.cle === m.cle ? "ring-2 ring-sky-400 ring-offset-2 ring-offset-[#1f2125]" : ""}`} style={{ width: px, height: px }} />
                      : <span className="flex items-center justify-center rounded-full border border-dashed border-white/20 text-xs text-zinc-500" style={{ width: px, height: px }}>?</span>}
                    {pb.length > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-black" title={pb.join(", ")}>!</span>}
                    {(m.shopify_nb_fiches || 0) > 0 && taille !== "s" && <span className="absolute -bottom-0.5 -right-0.5 rounded-full bg-sky-600 px-1 text-[9px] font-semibold text-white" title={`Utilisée sur ${m.shopify_nb_fiches} fiche(s)`}>{m.shopify_nb_fiches}</span>}
                  </span>
                  {noms && (
                    <>
                      <span className="mt-1 line-clamp-2 text-[11px] leading-tight text-zinc-200">{m.nom}</span>
                      {m.code && m.code.toLowerCase() !== m.nom.toLowerCase() && <span className="text-[10px] text-zinc-500">{m.code}</span>}
                      <span className="mt-0.5 flex gap-0.5">{(m.teinte_filtre || []).map((t) => <Pastille key={t} slug={t} taille={8} />)}</span>
                    </>
                  )}
                </button>
              </React.Fragment>
            );
          })}
        </div>
        {filtrees.length > limite && (
          <div className="mt-6 text-center">
            <button type="button" onClick={() => setLimite(limite + PAR_PAGE)} className="rounded-2xl border border-white/10 bg-[#2a2d31] px-5 py-2 text-sm text-zinc-300 hover:bg-[#34383d]">
              Afficher {Math.min(PAR_PAGE, filtrees.length - limite)} de plus ({(filtrees.length - limite).toLocaleString("fr-CH")} restantes)
            </button>
          </div>
        )}
        {!chargement && filtrees.length === 0 && <p className="py-10 text-center text-zinc-500">Aucune finition pour ces filtres.</p>}
      </div>

      {/* Fiche détaillée */}
      {choisie && <Fiche m={choisie} onFermer={() => setChoisie(null)} />}
    </main>
  );
}

function Ligne({ l, children }: { l: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-2 border-t border-white/5 py-1.5 text-sm">
      <div className="text-zinc-500">{l}</div>
      <div className="min-w-0 break-words text-zinc-200">{children}</div>
    </div>
  );
}

function Fiche({ m, onFermer }: { m: Matiere; onFermer: () => void }) {
  const pb = problemes(m);
  const image = m.shop_url_maitre ? `${m.shop_url_maitre}?width=900&v=${m.shop_version ?? ""}` : m.url_maitre;
  const sourceHex: Record<string, string> = { fabricant: "fourni par le fabricant", mesure: "mesuré sur l'image", manuel: "saisi à la main" };
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onFermer}>
      <aside className="h-full w-full max-w-[520px] overflow-y-auto border-l border-white/10 bg-[#25282c] p-5 text-zinc-100 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-zinc-500">{m.marque} › {m.famille}{m.gamme ? ` › ${m.gamme}` : ""}</div>
            <h2 className="text-xl font-semibold">{m.nom}</h2>
            {m.code && <div className="text-sm text-zinc-400">Code {m.code}</div>}
          </div>
          <button type="button" onClick={onFermer} className="rounded-xl border border-white/10 px-3 py-1 text-sm text-zinc-300 hover:bg-white/5" aria-label="Fermer">✕</button>
        </div>

        {image
          ? <img src={image} alt={m.nom} className="mb-2 aspect-square w-full rounded-2xl object-cover" />
          : <div className="mb-2 flex aspect-square w-full items-center justify-center rounded-2xl border border-dashed border-white/20 text-zinc-500">Pas d&apos;image</div>}
        <div className="mb-4 flex flex-wrap gap-3 text-xs">
          {m.shop_url_maitre && <a href={m.shop_url_maitre} target="_blank" rel="noopener noreferrer" className="text-sky-300 hover:underline">Image Shopify</a>}
          {m.url_maitre && <a href={m.url_maitre} target="_blank" rel="noopener noreferrer" className="text-sky-300 hover:underline">Image base (Supabase)</a>}
          {m.shop_url_vignette && <a href={m.shop_url_vignette} target="_blank" rel="noopener noreferrer" className="text-sky-300 hover:underline">Vignette</a>}
        </div>

        {pb.length > 0 && (
          <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">⚠ {pb.join(" · ")}</div>
        )}

        <Ligne l="Teinte (filtre)">
          <span className="flex flex-wrap items-center gap-2">
            {(m.teinte_filtre || []).length ? (m.teinte_filtre || []).map((t) => <span key={t} className="inline-flex items-center gap-1"><Pastille slug={t} /> {TEINTE[t]?.nom || t}</span>) : "—"}
          </span>
          <span className="text-xs text-zinc-500">{m.teinte_source === "validee" ? `validée le ${dateCH(m.teinte_validee_le)}` : m.teinte_source || ""}</span>
        </Ligne>
        <Ligne l="Couleur (hex)">
          {m.hex ? <span className="inline-flex items-center gap-2"><span className="inline-block h-4 w-8 rounded border border-white/20" style={{ background: m.hex }} /> {m.hex}</span> : "—"}
          <span className="block text-xs text-zinc-500">
            {m.hex_source ? sourceHex[m.hex_source] || m.hex_source : ""}
            {m.hex_fabricant && m.hex_source !== "fabricant" ? ` · fabricant ${m.hex_fabricant}` : ""}
            {m.hex_mesure && m.hex_source !== "mesure" ? ` · mesuré ${m.hex_mesure}` : ""}
          </span>
        </Ligne>
        <Ligne l="Qualité image">{m.qualite || "—"}{m.maitre_cote ? ` · ${m.maitre_cote} px` : ""}{m.motif ? " · motif" : ""}</Ligne>
        <Ligne l="Usages">{(m.usages || []).join(", ") || "—"}</Ligne>
        <Ligne l="Nom d'origine">{m.nom_origine || "—"}</Ligne>
        <Ligne l="Source">{[m.source_type, m.nom_source && `nom : ${m.nom_source}`, m.code_source && `code : ${m.code_source}`].filter(Boolean).join(" · ") || "—"}{m.liste_prix_annee ? ` · tarif ${m.liste_prix_annee}` : ""}</Ligne>
        <Ligne l="Alias">{(m.alias || []).length ? <ul className="list-disc pl-4">{(m.alias || []).map((a) => <li key={a}>{a}</li>)}</ul> : "—"}</Ligne>
        <Ligne l="Sur la boutique">
          {(m.shopify_nb_fiches || 0) > 0 ? `${m.shopify_nb_fiches} fiche(s) · ${m.shopify_nb_variantes || 0} utilisation(s)` : "pas utilisée"}
          <span className="block text-xs text-zinc-500">relevé du {dateCH(m.shopify_vu_le)}</span>
          {(m.shopify_valeurs || []).length > 0 && <ul className="mt-1 list-disc pl-4 text-xs text-zinc-300">{(m.shopify_valeurs || []).map((v) => <li key={v}>{v}</li>)}</ul>}
        </Ligne>
        <Ligne l="Shopify Files">
          {m.shop_file_id_maitre ? `publiée le ${dateCH(m.shop_publie_le)}` : "pas publiée"}
          {m.shop_version && m.image_version && m.shop_version !== m.image_version && <span className="block text-xs text-amber-300">l&apos;image a changé depuis la publication</span>}
        </Ligne>
        <Ligne l="Clé"><code className="text-xs">{m.cle}</code></Ligne>
        <Ligne l="Dates">créée le {dateCH(m.created_at)} · image du {dateCH(m.image_maj_le)} · modifiée le {dateCH(m.updated_at)}</Ligne>
      </aside>
    </div>
  );
}
