"use client";
// app/planner/page.tsx
// Planner 3D multi-marques — étape 2 du chantier (voir journal-modeles-3d.md
// et, côté projet Claude, claude/planner-3d-et-index-2026-09-19.md).
//
// Page INTERNE (derrière le verrou d'accès), isolée : aucun état partagé avec
// le formulaire d'offres. Le lien offres ↔ planner viendra en étape 3 (URL
// `?ids=` puis card de faisabilité), sans toucher à cette page.
//
// Ce qu'on valide ici : chargement des GLB/.bin du CDN Shopify (CORS), échelle
// entre marques, glisser / tourner, vue Plan (ortho) ⇄ 3D, mode maquette,
// capture PNG avec la mention légale, sauvegarde des scènes.
//
// Raccourcis : R / Maj+R tourner ±15°, F recadrer, flèches déplacer de 5 cm, Suppr
// supprimer, Ctrl+D dupliquer, Échap désélectionner.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import RetourDashboard, { CLASSE_BOUTON_NAV } from "@/components/RetourDashboard";
import PlannerCatalogue from "@/components/planner/PlannerCatalogue";
import type { Dims } from "@/components/planner/PlannerCanvas";
import { MENTION_LEGALE, SCENE_VIDE, SOLS, uid, type CatalogueItem, type ChoixModele, type Scene, type SceneItem } from "@/lib/planner-types";

// three.js n'existe que dans le navigateur : pas de rendu serveur pour le canvas.
const PlannerCanvas = dynamic(() => import("@/components/planner/PlannerCanvas"), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-sm text-zinc-500">Chargement du moteur 3D…</div>,
});

type ResumeScene = { id: string; nom: string; cree_par: string | null; nb_items: number; mode: string; updated_at: string };

function dateCH(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function chf(n: number): string {
  return `CHF ${n.toLocaleString("fr-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/\s/g, "'")}`;
}

const BTN = "rounded-xl border px-3 py-1.5 text-xs transition disabled:opacity-40";
const BTN_OFF = `${BTN} border-white/10 bg-[#2a2d31] text-zinc-300 hover:bg-[#34383d]`;
const BTN_ON = `${BTN} border-sky-500/40 bg-sky-500/20 text-sky-200`;

export default function PlannerPage() {
  const [scene, setScene] = useState<Scene>(SCENE_VIDE);
  const [selected, setSelected] = useState<string | null>(null);
  const [dims, setDims] = useState<Record<string, Dims>>({});
  const [erreurs, setErreurs] = useState<Record<string, string>>({});
  const [snap, setSnap] = useState(0.05);
  const [message, setMessage] = useState("");
  const [enregistrement, setEnregistrement] = useState(false);
  const [listeOuverte, setListeOuverte] = useState(false);
  const [scenes, setScenes] = useState<ResumeScene[]>([]);
  const [modifie, setModifie] = useState(false);
  const captureRef = useRef<(() => string | null) | null>(null);
  const recadrerRef = useRef<(() => void) | null>(null);
  const [rotationFine, setRotationFine] = useState(false);   // déverrouillage manuel, jamais par défaut

  // Historique (annuler / rétablir) : une pile d'états de scène. Les
  // déplacements à la souris sont regroupés : on empile au début du glisser
  // (pointerdown), pas à chaque mouvement.
  const passe = useRef<Scene[]>([]);
  const futur = useRef<Scene[]>([]);
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const [histoN, setHistoN] = useState(0);
  const empiler = useCallback(() => {
    passe.current.push(sceneRef.current);
    if (passe.current.length > 60) passe.current.shift();
    futur.current = [];
    setHistoN((n) => n + 1);
  }, []);
  const annuler = useCallback(() => {
    const prev = passe.current.pop();
    if (!prev) return;
    futur.current.push(sceneRef.current);
    setScene(prev);
    setModifie(true);
    setHistoN((n) => n + 1);
  }, []);
  const retablir = useCallback(() => {
    const next = futur.current.pop();
    if (!next) return;
    passe.current.push(sceneRef.current);
    setScene(next);
    setModifie(true);
    setHistoN((n) => n + 1);
  }, []);

  const patch = useCallback((p: Partial<Scene>, historiser = true) => {
    if (historiser) empiler();
    setScene((s) => ({ ...s, ...p }));
    setModifie(true);
  }, [empiler]);
  const patchItem = useCallback((u: string, p: Partial<SceneItem>, historiser = true) => {
    if (historiser) empiler();
    setScene((s) => ({ ...s, items: s.items.map((it) => (it.uid === u ? { ...it, ...p } : it)) }));
    setModifie(true);
  }, [empiler]);

  // Nom proposé pour un nouveau plan : « 20.09.2026 Thierry — » ; le
  // conseiller complète avec le client / projet au premier export.
  function nomPropose(): string {
    let conseiller = "";
    try { conseiller = window.localStorage.getItem("jardi-utilisateur") || ""; } catch { /* ignore */ }
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}${conseiller ? ` ${conseiller}` : ""} — `;
  }
  function nomIncomplet(nom: string): boolean {
    const n = (nom || "").trim();
    return !n || n === "Sans titre" || n.endsWith("—");
  }

  // Charger ?scene=<id>, sinon pré-remplir le nom
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("scene");
    if (!id) { setScene((sc) => ({ ...sc, nom: nomPropose() })); setModifie(false); return; }
    fetch(`/api/planner/scenes/${id}`)
      .then((r) => r.json())
      .then((j) => { if (j.scene) { setScene(j.scene); setModifie(false); } else setMessage(j.error || "Scène introuvable"); })
      .catch((e) => setMessage((e as Error).message));
  }, []);

  // Avertir avant de quitter avec des modifications non enregistrées
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (modifie) { e.preventDefault(); } };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [modifie]);

  const item = useMemo(() => scene.items.find((i) => i.uid === selected) || null, [scene.items, selected]);

  // Un nouvel article est posé HORS de la terrasse, sur une bande de dépôt
  // devant (z > profondeur/2), dans la première case libre : jamais sur un
  // meuble déjà placé. Le vendeur le glisse ensuite à sa place.
  function caseLibre(): { x: number; z: number } {
    const pas = 1.0;
    const z0 = scene.terrasse.profondeur / 2 + 0.9;
    const x0 = -scene.terrasse.largeur / 2 + 0.5;
    const nCol = Math.max(1, Math.floor(scene.terrasse.largeur / pas));
    for (let i = 0; i < 200; i++) {
      const x = x0 + (i % nCol) * pas;
      const z = z0 + Math.floor(i / nCol) * pas;
      const occupe = scene.items.some((it) => Math.abs(it.x - x) < 0.7 && Math.abs(it.z - z) < 0.7);
      if (!occupe) return { x: +x.toFixed(2), z: +z.toFixed(2) };
    }
    return { x: 0, z: z0 };
  }

  // Cascade (19.09) : fichier de la variante choisie → défaut de la fiche.
  // `choix` vient du sélecteur de taille du catalogue ; absent = défaut fiche.
  function ajouter(c: CatalogueItem, choix?: ChoixModele) {
    const url = choix?.url || c.url_glb;
    if (!url) return;
    const pos = caseLibre();
    const nouveau: SceneItem = {
      uid: uid(),
      product_id: c.product_id,
      titre: choix?.label && choix.variant_id ? `${c.titre} — ${choix.label}` : c.titre,
      marque: c.marque,
      url,
      source: choix?.variant_id ? "url" : (c.source || "url"),
      x: pos.x,
      z: pos.z,
      rot: 0,
      size_warn: choix ? choix.size_warn : c.size_mismatch_possible,
      color_warn: c.color_mismatch_possible,
      image_url: c.image_url,
      // Prix exact si on connaît la variante (fichier par variante, ou fiche à
      // variante unique) ; sinon prix le plus bas de la fiche → « dès ».
      prix: choix?.prix ?? c.prix_min,
      prix_exact: choix?.prix != null || c.variant_count <= 1,
      sku: choix ? choix.sku : c.sku_1,
      variant_id: choix ? choix.variant_id : c.variant_id_1,
    };
    const fix = lireRotFix()[String(c.product_id)];
    if (fix) nouveau.rot_fix = fix;
    patch({ items: [...scene.items, nouveau] });
    setSelected(nouveau.uid);
  }

  function supprimer(u: string) {
    patch({ items: scene.items.filter((i) => i.uid !== u) });
    if (selected === u) setSelected(null);
  }

  function dupliquer(u: string) {
    const src = scene.items.find((i) => i.uid === u);
    if (!src) return;
    const copie: SceneItem = { ...src, uid: uid(), x: src.x + 0.5, z: src.z + 0.5 };
    patch({ items: [...scene.items, copie] });
    setSelected(copie.uid);
  }

  // Correction fine : mémorisée par fiche dans le navigateur, pour que le
  // même modèle de travers arrive corrigé la prochaine fois. La vraie
  // correction se fera dans le pipeline (fichier retourné), ceci est le
  // pansement en attendant.
  const CLE_ROT_FIX = "planner-rot-fix";
  function lireRotFix(): Record<string, number> {
    try { return JSON.parse(localStorage.getItem(CLE_ROT_FIX) || "{}"); } catch { return {}; }
  }
  function corrigerRotation(u: string, deg: number) {
    const it = scene.items.find((i) => i.uid === u);
    if (!it) return;
    const v = Math.max(-180, Math.min(180, deg));
    patchItem(u, { rot_fix: v || undefined });
    try {
      const m = lireRotFix();
      if (v) m[String(it.product_id)] = v; else delete m[String(it.product_id)];
      localStorage.setItem(CLE_ROT_FIX, JSON.stringify(m));
    } catch { /* stockage indisponible : pas grave */ }
  }

  function tourner(u: string, delta: number) {
    const it = scene.items.find((i) => i.uid === u);
    if (it) patchItem(u, { rot: ((it.rot + delta) % 360 + 360) % 360 });
  }

  // Raccourcis clavier
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const cible = e.target as HTMLElement;
      if (cible && (cible.tagName === "INPUT" || cible.tagName === "SELECT" || cible.tagName === "TEXTAREA")) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) retablir(); else annuler(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); retablir(); return; }
      if ((e.key === "f" || e.key === "F") && !e.ctrlKey && !e.metaKey) { e.preventDefault(); recadrer(); return; }
      if (!selected) return;
      const it = scene.items.find((i) => i.uid === selected);
      if (!it) return;
      const pas = e.shiftKey ? 0.25 : 0.05;
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); supprimer(selected); }
      else if (e.key === "r") { e.preventDefault(); tourner(selected, 15); }
      else if (e.key === "R") { e.preventDefault(); tourner(selected, -15); }
      else if (e.key === "Escape") setSelected(null);
      else if (e.key === "ArrowLeft") { e.preventDefault(); patchItem(selected, { x: +(it.x - pas).toFixed(3) }); }
      else if (e.key === "ArrowRight") { e.preventDefault(); patchItem(selected, { x: +(it.x + pas).toFixed(3) }); }
      else if (e.key === "ArrowUp") { e.preventDefault(); patchItem(selected, { z: +(it.z - pas).toFixed(3) }); }
      else if (e.key === "ArrowDown") { e.preventDefault(); patchItem(selected, { z: +(it.z + pas).toFixed(3) }); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") { e.preventDefault(); dupliquer(selected); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, scene.items]);

  // Avant un export : le plan doit avoir un vrai nom (il sert de nom de liste
  // d'achat, de fichier PNG et de titre de fiche).
  // Renvoie le nom à utiliser tout de suite (l'état React n'est mis à jour
  // qu'au rendu suivant, donc les exports ne doivent pas relire scene.nom).
  function exigerNom(): string | null {
    const nom = (scene.nom || "").trim();
    if (!nomIncomplet(nom)) return nom;
    const saisi = window.prompt("Nom du plan ? (complète avec le client, le projet, la terrasse…)", nom === "Sans titre" ? nomPropose() : nom || nomPropose());
    if (saisi === null) return null;
    const propre = saisi.trim().slice(0, 120);
    if (nomIncomplet(propre)) { setMessage("Il faut un nom de plan pour exporter"); return null; }
    patch({ nom: propre });
    return propre;
  }

  // « Recadrer » : repasse en plan et cadre toute la terrasse
  function recadrer() {
    if (scene.vue !== "plan") {
      patch({ vue: "plan" }, false);
      setTimeout(() => recadrerRef.current?.(), 60);   // la caméra ortho doit être montée
    } else {
      recadrerRef.current?.();
    }
  }

  // Capture PNG avec la mention légale
  function capturer() {
    const nom = exigerNom();
    if (!nom) return;
    const data = captureRef.current?.();
    if (!data) { setMessage("Capture impossible (moteur non prêt)"); return; }
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height + 44;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0);
      ctx.fillStyle = "#1f2125";
      ctx.font = "bold 15px Arial";
      ctx.fillText(`${nom} — ${scene.terrasse.largeur} × ${scene.terrasse.profondeur} m — ${scene.items.length} article${scene.items.length > 1 ? "s" : ""}`, 14, img.height + 20);
      ctx.fillStyle = "#666";
      ctx.font = "12px Arial";
      ctx.fillText(`${MENTION_LEGALE} · Jardin-Confort SA · ${dateCH(new Date().toISOString())}${scene.mode === "maquette" ? " · rendu maquette" : ""}`, 14, img.height + 37);
      const a = document.createElement("a");
      a.href = c.toDataURL("image/png");
      a.download = `planner-${nom.replace(/[^\w\-]+/g, "_")}-${scene.vue}.png`;
      a.click();
    };
    img.src = data;
  }

  async function enregistrer() {
    setEnregistrement(true);
    setMessage("");
    try {
      let creePar: string | null = null;
      try { creePar = window.localStorage.getItem("jardi-utilisateur"); } catch { /* ignore */ }
      if (scene.id) {
        const r = await fetch(`/api/planner/scenes/${scene.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scene }) });
        const j = await r.json();
        if (j.error) throw new Error(j.error);
      } else {
        const r = await fetch("/api/planner/scenes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scene, cree_par: creePar }) });
        const j = await r.json();
        if (j.error) throw new Error(j.error);
        setScene((s) => ({ ...s, id: j.id }));
        window.history.replaceState(null, "", `/planner?scene=${j.id}`);
      }
      setModifie(false);
      setMessage("Scène enregistrée");
      setTimeout(() => setMessage(""), 2500);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setEnregistrement(false);
    }
  }

  // ── Exports ──
  // Liste d'achat : réutilise le circuit existant (table listes_achat →
  // brouillon DRA). Un article posé n fois = une ligne qty n. Le variant_id
  // est celui de la première variante (le 3D est au niveau fiche).
  async function exporterListeAchat() {
    if (scene.items.length === 0) { setMessage("Aucun article à exporter"); return; }
    const nom = exigerNom();
    if (!nom) return;
    const parProduit = new Map<number, { it: SceneItem; qty: number }>();
    for (const it of scene.items) {
      const e = parProduit.get(it.product_id);
      if (e) e.qty++; else parProduit.set(it.product_id, { it, qty: 1 });
    }
    const lignes = [...parProduit.values()].map(({ it, qty }) => ({
      fournisseur: it.marque || "",
      sku: it.sku || "",
      titre: it.titre,
      variante_titre: null,
      variant_id: it.variant_id || null,
      product_id: String(it.product_id),
      statut_fiche: "ACTIVE",
      qty,
      image_url: it.image_url || null,
    }));
    let creePar: string | null = null;
    try { creePar = window.localStorage.getItem("jardi-utilisateur"); } catch { /* ignore */ }
    try {
      const r = await fetch("/api/listes-achat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nom: `Planner — ${nom}`, cree_par: creePar, lignes, notes: `Créée depuis le planner 3D${scene.id ? ` (scène ${scene.id})` : ""}. ${MENTION_LEGALE}.` }),
      });
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      setMessage(`Liste d'achat créée (${lignes.length} article${lignes.length > 1 ? "s" : ""}) — ouvrir : /dashboard/listes-achat`);
      window.open("/dashboard/listes-achat", "_blank");
    } catch (e) {
      setMessage(`Liste d'achat : ${(e as Error).message}`);
    }
  }

  // Fiche imprimable : capture de la vue + tableau des articles avec images.
  function imprimerListe() {
    if (scene.items.length === 0) { setMessage("Aucun article à imprimer"); return; }
    const nom = exigerNom();
    if (!nom) return;
    const data = captureRef.current?.();
    const parProduit = new Map<number, { it: SceneItem; qty: number }>();
    for (const it of scene.items) {
      const e = parProduit.get(it.product_id);
      if (e) e.qty++; else parProduit.set(it.product_id, { it, qty: 1 });
    }
    const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const lignes = [...parProduit.values()].map(({ it, qty }) => {
      const d = dims[it.uid];
      return `<tr>
        <td>${it.image_url ? `<img src="${it.image_url}" alt="">` : ""}</td>
        <td><strong>${esc(it.titre)}</strong><br><span class="m">${esc(it.marque || "")}${it.sku ? ` · ${esc(it.sku)}` : ""}</span>
          ${it.size_warn ? '<br><span class="w">Taille : rendu indicatif</span>' : ""}${it.color_warn && scene.mode === "couleurs" ? '<br><span class="w">Couleur : rendu indicatif</span>' : ""}</td>
        <td class="r">${d ? `${Math.round(d.l * 100)} × ${Math.round(d.p * 100)} × H ${Math.round(d.h * 100)} cm` : ""}</td>
        <td class="r">${qty}</td>
        <td class="r">${it.prix != null ? `${it.prix_exact ? "" : "dès "}${chf(it.prix)}` : "—"}</td>
        <td class="r">${it.prix != null ? `${it.prix_exact ? "" : "dès "}${chf(it.prix * qty)}` : "—"}</td>
      </tr>`;
    }).join("");
    const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(nom)} — Planner 3D</title>
      <style>
        body{font-family:Arial,sans-serif;color:#1f2125;margin:24px}
        h1{font-size:20px;margin:0 0 4px} .sub{color:#666;font-size:12px;margin-bottom:14px}
        img.cap{max-width:100%;border:1px solid #ddd;border-radius:6px;margin-bottom:16px}
        table{width:100%;border-collapse:collapse;font-size:12px} th,td{border-bottom:1px solid #ddd;padding:6px 8px;text-align:left;vertical-align:middle}
        td img{width:56px;height:56px;object-fit:contain;background:#fff;border:1px solid #eee;border-radius:4px}
        .r{text-align:right;white-space:nowrap} .m{color:#666} .w{color:#b45309;font-size:11px}
        .foot{margin-top:14px;font-size:11px;color:#666}
        @media print{body{margin:10mm}}
      </style></head><body>
      <h1>${esc(nom)}</h1>
      <div class="sub">Terrasse ${scene.terrasse.largeur} × ${scene.terrasse.profondeur} m · ${scene.items.length} article${scene.items.length > 1 ? "s" : ""} · ${dateCH(new Date().toISOString())}${scene.mode === "maquette" ? " · rendu maquette" : ""}</div>
      ${data ? `<img class="cap" src="${data}" alt="">` : ""}
      <table><thead><tr><th></th><th>Article</th><th class="r">Cotes mesurées</th><th class="r">Qté</th><th class="r">Prix unitaire TTC</th><th class="r">Total ligne</th></tr></thead><tbody>${lignes}</tbody>
      ${total > 0 ? `<tfoot><tr><td colspan="5" class="r"><strong>Total indicatif${totalApprox ? " (dès)" : ""}</strong></td><td class="r"><strong>${totalApprox ? "dès " : ""}${chf(total)}</strong></td></tr></tfoot>` : ""}</table>
      <div class="foot">${MENTION_LEGALE}. Prix TTC indicatifs, sous réserve de l'offre${totalApprox ? " ; « dès » = prix le plus bas de la fiche, la variante exacte n'étant pas connue" : ""}. Jardin-Confort SA, Route de Lavaux 425, 1095 Lutry.</div>
      <script>window.onload=function(){setTimeout(function(){window.print()},300)}</script>
      </body></html>`;
    const w = window.open("", "_blank");
    if (!w) { setMessage("Fenêtre bloquée par le navigateur"); return; }
    w.document.write(html);
    w.document.close();
  }

  async function ouvrirListe() {
    setListeOuverte(true);
    const r = await fetch("/api/planner/scenes");
    const j = await r.json();
    setScenes(j.scenes || []);
  }

  function nouvelleScene() {
    if (modifie && !window.confirm("Abandonner les modifications non enregistrées ?")) return;
    setScene({ ...SCENE_VIDE, items: [], nom: nomPropose() });
    passe.current = [];
    futur.current = [];
    setHistoN((n) => n + 1);
    setSelected(null);
    setModifie(false);
    window.history.replaceState(null, "", "/planner");
  }

  void histoN; // force le rendu des boutons annuler/rétablir
  const total = scene.items.reduce((n, i) => n + (i.prix || 0), 0);
  const totalApprox = scene.items.some((i) => i.prix != null && !i.prix_exact);
  const nbAvert = scene.items.filter((i) => i.size_warn || i.color_warn).length;

  return (
    <main className="flex h-screen flex-col bg-[#1f2125] text-zinc-100">
      {/* Barre du haut */}
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2">
        <div className="-mb-4">
          <RetourDashboard>
            <a href="/dashboard/modeles-3d" className={CLASSE_BOUTON_NAV}>🧊 Index 3D</a>
          </RetourDashboard>
        </div>
        <input
          value={scene.nom}
          onChange={(e) => patch({ nom: e.target.value })}
          className="w-56 rounded-xl border border-white/10 bg-[#2a2d31] px-3 py-1.5 text-sm text-zinc-100 outline-none focus:border-sky-500/50"
          placeholder="Nom de la scène"
        />
        <div className="ml-2 flex items-center gap-1">
          <button type="button" onClick={() => patch({ vue: "plan" })} className={scene.vue === "plan" ? BTN_ON : BTN_OFF} title="Vue de dessus (composition)">▦ Plan</button>
          <button type="button" onClick={() => patch({ vue: "3d" })} className={scene.vue === "3d" ? BTN_ON : BTN_OFF} title="Perspective (présentation)">◈ 3D</button>
          <button type="button" onClick={recadrer} className={BTN_OFF} title="Recadrer : vue de dessus, toute la terrasse visible (touche F)">⛶ Recadrer</button>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => patch({ mode: "couleurs" })} className={scene.mode === "couleurs" ? BTN_ON : BTN_OFF}>Couleurs</button>
          <button type="button" onClick={() => patch({ mode: "maquette" })} className={scene.mode === "maquette" ? BTN_ON : BTN_OFF} title="Tout en gris : supprime les écarts de coloris entre marques">Maquette</button>
        </div>
        <div className="flex items-center gap-1 text-xs text-zinc-400">
          <span>Terrasse</span>
          <input type="number" step="0.1" min="1" max="40" value={scene.terrasse.largeur} onChange={(e) => patch({ terrasse: { ...scene.terrasse, largeur: Math.max(1, Number(e.target.value) || 1) } })} className="w-16 rounded-lg border border-white/10 bg-[#2a2d31] px-2 py-1 text-right text-zinc-100" />
          <span>×</span>
          <input type="number" step="0.1" min="1" max="40" value={scene.terrasse.profondeur} onChange={(e) => patch({ terrasse: { ...scene.terrasse, profondeur: Math.max(1, Number(e.target.value) || 1) } })} className="w-16 rounded-lg border border-white/10 bg-[#2a2d31] px-2 py-1 text-right text-zinc-100" />
          <span>m</span>
        </div>
        <select
          value={scene.sol || "bois"}
          onChange={(e) => patch({ sol: e.target.value as Scene["sol"] })}
          className="rounded-xl border border-white/10 bg-[#2a2d31] px-2 py-1.5 text-xs text-zinc-300 outline-none focus:border-sky-500/50"
          title="Revêtement de la terrasse"
        >
          {SOLS.map((x) => <option key={x.id} value={x.id}>Sol : {x.nom}</option>)}
        </select>
        <button type="button" onClick={() => setSnap(snap ? 0 : 0.05)} className={snap ? BTN_ON : BTN_OFF} title="Aimanter les déplacements sur 5 cm">🧲 5 cm</button>
        <div className="flex items-center gap-1">
          <button type="button" onClick={annuler} disabled={passe.current.length === 0} className={BTN_OFF} title="Annuler (Ctrl+Z)">↶</button>
          <button type="button" onClick={retablir} disabled={futur.current.length === 0} className={BTN_OFF} title="Rétablir (Ctrl+Y)">↷</button>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={nouvelleScene} className={BTN_OFF}>＋ Nouvelle</button>
          <button type="button" onClick={ouvrirListe} className={BTN_OFF}>📂 Ouvrir</button>
          <button type="button" onClick={enregistrer} disabled={enregistrement} className={`${BTN} border-emerald-500/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25`}>
            {enregistrement ? "…" : modifie ? "💾 Enregistrer *" : "💾 Enregistrer"}
          </button>
          <button type="button" onClick={capturer} className={BTN_OFF} title="Télécharger une image PNG de la vue actuelle, avec la mention légale">📷 Capture</button>
          <button type="button" onClick={imprimerListe} className={BTN_OFF} title="Fiche imprimable : image de la vue + liste des articles avec photos, cotes et prix indicatifs">🖨 Fiche</button>
          <button type="button" onClick={exporterListeAchat} className={`${BTN} border-cyan-500/40 bg-cyan-500/15 text-cyan-200 hover:bg-cyan-500/25`} title="Créer une liste d'achat avec les articles posés (puis brouillon d'offre depuis la page Listes d'achat)">🛒 Liste d'achat</button>
        </div>
      </div>

      {message && <div className="border-b border-white/10 bg-sky-500/10 px-4 py-1.5 text-xs text-sky-200">{message}</div>}

      <div className="flex min-h-0 flex-1">
        <PlannerCatalogue onAjouter={ajouter} />

        <div className="relative min-w-0 flex-1">
          <PlannerCanvas
            items={scene.items}
            terrasse={scene.terrasse}
            vue={scene.vue}
            mode={scene.mode}
            sol={scene.sol || "bois"}
            snap={snap}
            selectedUid={selected}
            onSelect={setSelected}
            onDragStart={empiler}
            onMove={(u, x, z) => patchItem(u, { x: +x.toFixed(3), z: +z.toFixed(3) }, false)}
            onDims={(u, d) => setDims((m) => (m[u] && Math.abs(m[u].l - d.l) < 1e-6 ? m : { ...m, [u]: d }))}
            onError={(u, m) => setErreurs((e) => ({ ...e, [u]: m }))}
            captureRef={captureRef}
            recadrerRef={recadrerRef}
          />
          {/* Outils de l'article sélectionné */}
          {item && (
            <div className="absolute left-3 top-3 flex items-center gap-1 rounded-xl border border-white/10 bg-[#1f2125]/90 p-1.5 shadow-lg backdrop-blur">
              <span className="max-w-[260px] truncate px-2 text-xs text-zinc-200" title={item.titre}>{item.titre}</span>
              <button type="button" onClick={() => tourner(item.uid, -15)} className={BTN_OFF} title="Tourner −15° (Maj+R)">⟲</button>
              <button type="button" onClick={() => tourner(item.uid, 15)} className={BTN_OFF} title="Tourner +15° (R)">⟳</button>
              <button type="button" onClick={() => tourner(item.uid, 90)} className={BTN_OFF} title="Tourner de 90°">90°</button>
              <button type="button" onClick={() => setRotationFine((v) => !v)} className={rotationFine ? BTN_ON : BTN_OFF} title="Déverrouiller la rotation fine (fichier livré de travers)">{rotationFine ? "🔓" : "🔒"}</button>
              {rotationFine && (
                <div className="flex items-center gap-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-200" title="Correction en degrés, en plus des pas de 15°. Se garde avec la scène et est proposée aux prochains exemplaires de cet article.">
                  <span>corr.</span>
                  <input
                    type="range" min="-45" max="45" step="1"
                    value={item.rot_fix || 0}
                    onChange={(e) => corrigerRotation(item.uid, Number(e.target.value))}
                    className="w-28"
                  />
                  <input
                    type="number" min="-180" max="180" step="0.5"
                    value={item.rot_fix || 0}
                    onChange={(e) => corrigerRotation(item.uid, Number(e.target.value) || 0)}
                    className="w-14 rounded bg-[#2a2d31] px-1 text-right text-zinc-100"
                  />
                  <span>°</span>
                  <button type="button" onClick={() => corrigerRotation(item.uid, 0)} className="text-zinc-400 hover:text-white" title="Remettre à 0">↺</button>
                </div>
              )}
              <button type="button" onClick={() => dupliquer(item.uid)} className={BTN_OFF} title="Dupliquer (Ctrl+D)">⧉</button>
              <button type="button" onClick={() => supprimer(item.uid)} className={`${BTN} border-rose-500/40 bg-rose-500/15 text-rose-200`} title="Supprimer (Suppr)">🗑</button>
            </div>
          )}
          <div className="pointer-events-none absolute bottom-2 left-3 rounded bg-black/50 px-2 py-1 text-[11px] text-zinc-300">
            {MENTION_LEGALE} · {scene.vue === "plan" ? "glisser = déplacer · molette = zoom · clic droit = déplacer la vue" : "glisser = tourner la vue · molette = zoom · clic droit = déplacer"}
          </div>
        </div>

        {/* Liste des articles posés */}
        <aside className="flex w-[300px] shrink-0 flex-col border-l border-white/10 bg-[#25282c]">
          <div className="flex items-center justify-between border-b border-white/10 px-3 py-2 text-xs">
            <span className="uppercase tracking-wide text-zinc-500">Articles posés · {scene.items.length}</span>
            {total > 0 && <span className="text-zinc-300" title={totalApprox ? "« dès » : au moins un article au prix le plus bas de sa fiche" : "Prix des variantes posées"}>{totalApprox ? "dès " : ""}{chf(total)}</span>}
          </div>
          <div className="flex-1 overflow-y-auto">
            {scene.items.map((i, idx) => {
              const d = dims[i.uid];
              const err = erreurs[i.uid];
              return (
                <button
                  key={i.uid}
                  type="button"
                  onClick={() => setSelected(i.uid)}
                  className={`flex w-full items-start gap-2 border-b border-white/5 px-3 py-2 text-left text-xs transition hover:bg-white/5 ${selected === i.uid ? "bg-sky-500/15" : ""}`}
                >
                  <span className="mt-0.5 w-4 shrink-0 text-zinc-500">{idx + 1}</span>
                  {i.image_url ? <img src={i.image_url} alt="" className="h-9 w-9 shrink-0 rounded bg-white object-contain" /> : <div className="h-9 w-9 shrink-0 rounded bg-white/5" />}
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 text-zinc-200">{i.titre}</span>
                    <span className="block text-[10px] text-zinc-500">
                      {i.marque}{d ? ` · ${Math.round(d.l * 100)}×${Math.round(d.p * 100)}×H${Math.round(d.h * 100)} cm` : ""}{i.rot ? ` · ${i.rot}°` : ""}
                    </span>
                    {(i.size_warn || i.color_warn || err) && (
                      <span className="mt-0.5 flex flex-wrap gap-1">
                        {i.size_warn && <span className="rounded bg-amber-500/20 px-1 text-[9px] text-amber-300">taille non garantie</span>}
                        {i.color_warn && scene.mode === "couleurs" && <span className="rounded bg-amber-500/20 px-1 text-[9px] text-amber-300">couleur non garantie</span>}
                        {err && <span className="rounded bg-rose-500/20 px-1 text-[9px] text-rose-300" title={err}>non chargé</span>}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
            {scene.items.length === 0 && <p className="px-3 py-4 text-xs text-zinc-500">Aucun article. Clique une vignette à gauche.</p>}
          </div>
          {nbAvert > 0 && (
            <div className="border-t border-white/10 px-3 py-2 text-[11px] text-amber-200/90">
              Rendu indicatif pour {nbAvert} article{nbAvert > 1 ? "s" : ""} : un seul modèle par fiche, la taille ou le coloris affiché ne correspond pas forcément à la variante retenue.
            </div>
          )}
        </aside>
      </div>

      {/* Ouvrir une scène */}
      {listeOuverte && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setListeOuverte(false)}>
          <div className="max-h-[80vh] w-[620px] overflow-y-auto rounded-2xl border border-white/10 bg-[#25282c] p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Scènes enregistrées</h2>
              <button type="button" onClick={() => setListeOuverte(false)} className={BTN_OFF}>Fermer</button>
            </div>
            {scenes.length === 0 && <p className="text-xs text-zinc-500">Aucune scène enregistrée.</p>}
            {scenes.map((s) => (
              <a key={s.id} href={`/planner?scene=${s.id}`} className="flex items-center justify-between border-b border-white/5 px-2 py-2 text-xs hover:bg-white/5">
                <span>
                  <span className="text-zinc-100">{s.nom}</span>
                  <span className="ml-2 text-zinc-500">{s.nb_items} article{s.nb_items > 1 ? "s" : ""}{s.cree_par ? ` · ${s.cree_par}` : ""}</span>
                </span>
                <span className="text-zinc-500">{dateCH(s.updated_at)}</span>
              </a>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}
