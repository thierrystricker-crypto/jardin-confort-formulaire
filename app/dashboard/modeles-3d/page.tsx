"use client";
// app/dashboard/modeles-3d/page.tsx
// « Index 3D » — état de la bibliothèque de modèles 3D du catalogue (table
// modeles_3d, miroir de Shopify) : synthèse par marque, recherche, anomalies,
// et bouton « Rafraîchir l'index 3D » qui relance la synchro à la demande
// (la même que celle qui tourne chaque nuit).
//
// 100 % lecture seule côté Shopify : la synchro ne fait que LIRE la boutique
// et réécrire le miroir Supabase. Aucune écriture Shopify ici.
//
// Étape 1 du chantier planner 3D (voir journal-modeles-3d.md). Le planner
// lui-même (/planner) viendra ensuite et lira cette même table.

import React, { useCallback, useEffect, useRef, useState } from "react";
import RetourDashboard from "@/components/RetourDashboard";

type Etat = {
  bulk_operation_id: string | null;
  statut: "idle" | "running" | "importing" | "done" | "error";
  declencheur: string | null;
  demarre_le: string | null;
  termine_le: string | null;
  message: string | null;
  stats: Partial<{
    produits: number; avec_3d: number; model3d: number; url: number; anomalies: number;
    supprimes: number; options_modifiees: number; nouveaux_modeles: number; duree_ms: number;
  }>;
  updated_at: string;
};

type Marque = {
  marque: string; produits: number; actifs: number; avec_3d: number; actifs_avec_3d: number; actifs_sans_3d: number;
  via_model3d: number; via_url: number; taille_non_garantie: number; couleur_non_garantie: number;
  avec_anomalies: number; tag_no3dfile: number; collections: number;
};

type Row = {
  product_id: number; handle: string; titre: string; marque: string | null; statut: string; publie: boolean;
  collection: string | null; categories: string[]; image_url: string | null; prix_min: number | null;
  variant_count: number; variant_mode: string; option_names: string[]; has_size_option: boolean; has_color_option: boolean;
  source: "model3d" | "url" | null; url_glb: string | null; url_usdz: string | null; nom_fichier: string | null;
  taille_octets: number | null; fichier_partage_n: number; tag_no3dfile: boolean; has_3d: boolean;
  size_mismatch_possible: boolean; color_mismatch_possible: boolean; anomalies: string[];
  options_changed_at: string | null; model_attached_at: string | null; synced_at: string;
};

const SHOP_URL = "https://www.jardin-confort.ch";

function dateCH(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function mo(octets: number | null): string {
  if (!octets) return "";
  return `${(octets / 1e6).toFixed(1)} Mo`;
}

function Badge({ children, cls }: { children: React.ReactNode; cls: string }) {
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${cls}`}>{children}</span>;
}

export default function Modeles3dPage() {
  const [etat, setEtat] = useState<Etat | null>(null);
  const [total, setTotal] = useState(0);
  const [avec3d, setAvec3d] = useState(0);
  const [marques, setMarques] = useState<Marque[]>([]);
  const [adminBase, setAdminBase] = useState<string | null>(null);
  const [marque, setMarque] = useState("");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [mode, setMode] = useState<"anomalies" | "recherche">("anomalies");
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState("");
  const [enCours, setEnCours] = useState(false);
  const boucle = useRef<ReturnType<typeof setTimeout> | null>(null);

  const chargerSynthese = useCallback(async () => {
    const [r1, r2] = await Promise.all([fetch("/api/modeles-3d/stats"), fetch("/api/modeles-3d/sync")]);
    const j1 = await r1.json();
    const j2 = await r2.json();
    if (j1.error) throw new Error(j1.error);
    setTotal(j1.total || 0);
    setAvec3d(j1.avec_3d || 0);
    setMarques(j1.marques || []);
    setAdminBase(j1.admin_base || null);
    if (j2.etat) setEtat(j2.etat);
  }, []);

  const chargerLignes = useCallback(async () => {
    setChargement(true);
    try {
      const sp = new URLSearchParams();
      if (marque) sp.set("marque", marque);
      if (mode === "recherche" && q.trim().length >= 2) sp.set("q", q.trim());
      else sp.set("anomalies", "1");
      const r = await fetch(`/api/modeles-3d/stats?${sp.toString()}`);
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      setRows(j.rows || []);
    } catch (e) {
      setErreur((e as Error).message);
    } finally {
      setChargement(false);
    }
  }, [marque, mode, q]);

  useEffect(() => {
    chargerSynthese().catch((e) => setErreur((e as Error).message));
  }, [chargerSynthese]);

  useEffect(() => {
    const t = setTimeout(() => { chargerLignes(); }, 300);
    return () => clearTimeout(t);
  }, [chargerLignes]);

  // Boucle de synchro : POST un pas, puis re-POST toutes les 5 s tant que ça tourne.
  const pas = useCallback(async () => {
    try {
      const r = await fetch("/api/modeles-3d/sync", { method: "POST" });
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      const e = j.etat as Etat;
      setEtat(e);
      if (e.statut === "running" || e.statut === "importing") {
        boucle.current = setTimeout(pas, 5000);
      } else {
        setEnCours(false);
        await chargerSynthese();
        await chargerLignes();
      }
    } catch (err) {
      setErreur((err as Error).message);
      setEnCours(false);
    }
  }, [chargerLignes, chargerSynthese]);

  function rafraichir() {
    if (enCours) return;
    setErreur("");
    setEnCours(true);
    pas();
  }

  // Si une synchro tourne déjà (cron, autre poste), on suit sans relancer.
  useEffect(() => {
    if (!enCours && etat && (etat.statut === "running" || etat.statut === "importing")) {
      setEnCours(true);
      boucle.current = setTimeout(pas, 5000);
    }
    return () => { if (boucle.current) clearTimeout(boucle.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [etat?.statut]);

  const s = etat?.stats || {};
  const statutLibelle: Record<Etat["statut"], string> = {
    idle: "Jamais synchronisé",
    running: "Shopify prépare l'export…",
    importing: "Import en cours…",
    done: "À jour",
    error: "En erreur",
  };

  return (
    <main className="min-h-screen bg-[#1f2125]">
      <div className="mx-auto max-w-[1600px] px-4 pb-28 pt-8 text-zinc-100 lg:px-6">
        <RetourDashboard />
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">🧊 Index 3D</h1>
            <p className="mt-1 text-sm text-zinc-400">
              Quels articles du catalogue ont un modèle 3D (métachamp <code>custom.model_3d_glb</code> ou <code>custom.model_3d_url</code>),
              par marque et par collection, avec les anomalies à corriger. Miroir de Shopify, régénéré chaque nuit.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right text-xs text-zinc-400">
              <div>
                <span className={`font-medium ${etat?.statut === "error" ? "text-rose-300" : etat?.statut === "done" ? "text-emerald-300" : "text-amber-300"}`}>
                  {etat ? statutLibelle[etat.statut] : "…"}
                </span>
                {etat?.message && <span className="ml-2 text-zinc-500">{etat.message}</span>}
              </div>
              <div>Dernière synchro : {dateCH(etat?.termine_le)}{etat?.declencheur ? ` (${etat.declencheur})` : ""}{s.duree_ms ? ` · ${Math.round(s.duree_ms / 1000)} s` : ""}</div>
            </div>
            <button
              type="button"
              onClick={rafraichir}
              disabled={enCours}
              className="rounded-2xl border border-sky-500/40 bg-sky-500/15 px-4 py-3 text-sm text-sky-200 transition hover:bg-sky-500/30 disabled:cursor-wait disabled:opacity-60"
              title="Relance la lecture complète de Shopify (2 à 4 minutes). La même synchro tourne automatiquement chaque nuit."
            >
              {enCours ? "⏳ Synchro en cours…" : "🔄 Rafraîchir l'index 3D"}
            </button>
          </div>
        </div>

        {erreur && <div className="mb-4 rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{erreur}</div>}

        {/* KPI */}
        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
          {[
            ["Produits", total, ""],
            ["Avec modèle 3D", avec3d, "text-emerald-300"],
            ["via Model3d", s.model3d ?? marques.reduce((n, m) => n + m.via_model3d, 0), ""],
            ["via URL .bin", s.url ?? marques.reduce((n, m) => n + m.via_url, 0), ""],
            ["Avec anomalies", marques.reduce((n, m) => n + m.avec_anomalies, 0), "text-amber-300"],
            ["Nouveaux modèles (dernière synchro)", s.nouveaux_modeles ?? 0, "text-sky-300"],
          ].map(([l, v, cls]) => (
            <div key={String(l)} className="rounded-2xl border border-white/10 bg-[#2a2d31] px-4 py-3">
              <div className="text-[11px] uppercase tracking-wide text-zinc-500">{l}</div>
              <div className={`text-2xl font-semibold ${cls}`}>{typeof v === "number" ? v.toLocaleString("fr-CH") : v}</div>
            </div>
          ))}
        </div>

        {/* Synthèse par marque — chaque ligne est un filtre */}
        <div className="mb-6 overflow-x-auto rounded-2xl border border-white/10 bg-[#2a2d31]">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-3 py-2">Marque</th>
                <th className="px-3 py-2 text-right">Produits</th>
                <th className="px-3 py-2 text-right">Actifs</th>
                <th className="px-3 py-2 text-right text-emerald-300">Avec 3D</th>
                <th className="px-3 py-2 text-right">Actifs sans 3D</th>
                <th className="px-3 py-2 text-right">Model3d</th>
                <th className="px-3 py-2 text-right">URL .bin</th>
                <th className="px-3 py-2 text-right" title="Fiche avec option de taille et un seul modèle : rendu indicatif">Taille ?</th>
                <th className="px-3 py-2 text-right" title="Fiche avec option de couleur et un seul modèle : rendu indicatif">Couleur ?</th>
                <th className="px-3 py-2 text-right text-amber-300">Anomalies</th>
                <th className="px-3 py-2 text-right" title="Tag no3dfile posé (état actuel, pas une impossibilité)">no3dfile</th>
                <th className="px-3 py-2 text-right">Collections</th>
              </tr>
            </thead>
            <tbody>
              {marques.map((m) => {
                const actif = marque === m.marque;
                return (
                  <tr
                    key={m.marque}
                    onClick={() => setMarque(actif ? "" : m.marque)}
                    className={`cursor-pointer border-t border-white/5 transition hover:bg-white/5 ${actif ? "bg-sky-500/10" : ""} ${m.avec_3d === 0 ? "text-zinc-500" : ""}`}
                  >
                    <td className="px-3 py-1.5 font-medium">{m.marque}</td>
                    <td className="px-3 py-1.5 text-right">{m.produits}</td>
                    <td className="px-3 py-1.5 text-right">{m.actifs}</td>
                    <td className="px-3 py-1.5 text-right text-emerald-300">{m.avec_3d}</td>
                    <td className="px-3 py-1.5 text-right">{m.actifs_sans_3d}</td>
                    <td className="px-3 py-1.5 text-right">{m.via_model3d || ""}</td>
                    <td className="px-3 py-1.5 text-right">{m.via_url || ""}</td>
                    <td className="px-3 py-1.5 text-right">{m.taille_non_garantie || ""}</td>
                    <td className="px-3 py-1.5 text-right">{m.couleur_non_garantie || ""}</td>
                    <td className="px-3 py-1.5 text-right text-amber-300">{m.avec_anomalies || ""}</td>
                    <td className="px-3 py-1.5 text-right">{m.tag_no3dfile || ""}</td>
                    <td className="px-3 py-1.5 text-right">{m.collections || ""}</td>
                  </tr>
                );
              })}
              {marques.length === 0 && (
                <tr><td colSpan={12} className="px-3 py-6 text-center text-zinc-500">Aucune donnée : lance une première synchro.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Liste : anomalies ou recherche */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setMode("anomalies")} className={`rounded-full border px-3 py-1 text-xs ${mode === "anomalies" ? "border-amber-400 bg-amber-500/20 text-amber-200" : "border-white/10 bg-white/5 text-zinc-400"}`}>⚠️ Anomalies</button>
          <button type="button" onClick={() => setMode("recherche")} className={`rounded-full border px-3 py-1 text-xs ${mode === "recherche" ? "border-sky-400 bg-sky-500/20 text-sky-200" : "border-white/10 bg-white/5 text-zinc-400"}`}>🔎 Recherche</button>
          {marque && (
            <button type="button" onClick={() => setMarque("")} className="text-xs text-sky-300 hover:underline">✕ retirer le filtre {marque}</button>
          )}
          <span className="ml-auto text-xs text-zinc-500">{chargement ? "chargement…" : `${rows.length} ligne${rows.length > 1 ? "s" : ""}`}</span>
        </div>
        {mode === "recherche" && (
          <input
            type="search"
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Titre, handle, nom de fichier ou collection (2 caractères min.)…"
            className="mb-3 w-full rounded-2xl border border-white/10 bg-[#2a2d31] px-5 py-3 text-base text-zinc-100 placeholder:text-zinc-500 outline-none transition focus:border-sky-500/50"
          />
        )}

        <div className="overflow-x-auto rounded-2xl border border-white/10 bg-[#2a2d31]">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-3 py-2 w-12"></th>
                <th className="px-3 py-2">Article</th>
                <th className="px-3 py-2">Collection</th>
                <th className="px-3 py-2">Modèle</th>
                <th className="px-3 py-2">Variantes</th>
                <th className="px-3 py-2">Avertissements / anomalies</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.product_id} className={`border-t border-white/5 align-top ${r.statut !== "ACTIVE" ? "text-zinc-500" : ""}`}>
                  <td className="px-3 py-2">
                    {r.image_url ? <img src={r.image_url} alt="" className="h-10 w-10 rounded object-cover bg-white/5" /> : <div className="h-10 w-10 rounded bg-white/5" />}
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium text-zinc-100">{r.titre}</div>
                    <div className="text-xs text-zinc-500">{r.marque} · {r.statut}{!r.publie && r.statut === "ACTIVE" ? " · non publié" : ""}</div>
                  </td>
                  <td className="px-3 py-2 text-xs">{r.collection || <span className="text-zinc-600">—</span>}</td>
                  <td className="px-3 py-2 text-xs">
                    {r.source ? (
                      <>
                        <div>{r.source === "model3d" ? "Model3d" : "URL .bin"}{r.taille_octets ? ` · ${mo(r.taille_octets)}` : ""}</div>
                        <div className="truncate max-w-[260px] text-zinc-500" title={r.nom_fichier || ""}>{r.nom_fichier}</div>
                      </>
                    ) : <span className="text-zinc-600">aucun{r.tag_no3dfile ? " (no3dfile)" : ""}</span>}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {r.variant_mode === "avec_options" ? `${r.variant_count} · ${r.option_names.join(" / ")}` : "sans variante"}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {r.size_mismatch_possible && <Badge cls="border-amber-500/40 bg-amber-500/10 text-amber-200">taille non garantie</Badge>}
                      {r.color_mismatch_possible && <Badge cls="border-amber-500/40 bg-amber-500/10 text-amber-200">couleur non garantie</Badge>}
                      {r.anomalies.map((a) => <Badge key={a} cls="border-rose-500/40 bg-rose-500/10 text-rose-200">{a}</Badge>)}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs whitespace-nowrap">
                    <a href={`${SHOP_URL}/products/${r.handle}`} target="_blank" rel="noopener noreferrer" className="text-sky-300 hover:underline">boutique</a>
                    {adminBase && (<>{" · "}<a href={`${adminBase}/products/${r.product_id}`} target="_blank" rel="noopener noreferrer" className="text-sky-300 hover:underline">admin</a></>)}
                    {r.url_glb && (<>{" · "}<a href={r.url_glb} target="_blank" rel="noopener noreferrer" className="text-sky-300 hover:underline">fichier</a></>)}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && !chargement && (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-zinc-500">{mode === "anomalies" ? "Aucune anomalie 🎉" : "Aucun résultat"}</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <p className="mt-4 text-xs text-zinc-500">
          « Taille / couleur non garantie » : la fiche a une option de taille ou de couleur mais un seul modèle 3D (au niveau de la fiche) — le
          rendu ne correspond pas forcément à la variante retenue. Le tag <code>no3dfile</code> décrit l&apos;état actuel, pas une impossibilité.
        </p>
      </div>
    </main>
  );
}
