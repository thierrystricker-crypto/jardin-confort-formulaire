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
  const [partage, setPartage] = useState<{ url: string; copie: boolean } | null>(null);   // lien client affiché
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

  // Regroupement pour les exports : une ligne par fiche ET par variante
  // (deux Marina de longueurs différentes = deux lignes, pas une qty 2).
  function regrouper(items: SceneItem[]): Map<string, { it: SceneItem; qty: number }> {
    const m = new Map<string, { it: SceneItem; qty: number }>();
    for (const it of items) {
      const cle = `${it.product_id}|${it.variant_id || ""}`;
      const e = m.get(cle);
      if (e) e.qty++; else m.set(cle, { it, qty: 1 });
    }
    return m;
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
    const propre = saisi.trim().replace(/—(?=\S)/, "— ").slice(0, 120);   // « —dedon » → « — dedon »
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

  // Capture PNG : bandeau blanc en bas avec nom, mention légale, logo et,
  // si le plan est enregistré, le QR code du plan 3D client (coin bas droit).
  async function capturer() {
    const nom = exigerNom();
    if (!nom) return;
    if (!captureRef.current) { setMessage("Capture impossible (moteur non prêt)"); return; }
    const version = await lienPartagePourExport("capture");
    const lien = version?.url || null;
    const data2 = await capturerSansSelection();
    if (!data2) { setMessage("Capture impossible"); return; }
    const [img, qr] = await Promise.all([
      chargerImage(data2),
      lien ? chargerImage(`/api/planner/qr?size=220&data=${encodeURIComponent(lien)}`) : Promise.resolve(null),
    ]);
    if (!img) { setMessage("Capture impossible"); return; }
    const bandeau = qr ? 120 : 44;
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height + bandeau;
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
    if (qr && lien) {
      const taille = 100;
      const x = c.width - taille - 12, y = img.height + 10;
      ctx.drawImage(qr, x, y, taille, taille);
      ctx.fillStyle = "#2b8ad1";
      ctx.font = "bold 12px Arial";
      ctx.textAlign = "right";
      ctx.fillText(`Votre plan en 3D (V${version?.numero})`, x - 12, img.height + 62);
      ctx.fillStyle = "#666";
      ctx.font = "11px Arial";
      ctx.fillText("Scannez pour tourner autour de votre projet", x - 12, img.height + 78);
      ctx.textAlign = "left";
    }
    {
      const a = document.createElement("a");
      a.href = c.toDataURL("image/png");
      a.download = `planner-${nom.replace(/[^\w\-]+/g, "_")}-${scene.vue}.png`;
      a.click();
    }
  }

  async function enregistrer(): Promise<string | null> {
    setEnregistrement(true);
    setMessage("");
    let idScene: string | null = scene.id;
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
        idScene = j.id;
      }
      setModifie(false);
      setMessage("Scène enregistrée");
      setTimeout(() => setMessage(""), 2500);
    } catch (e) {
      setMessage((e as Error).message);
      return null;
    } finally {
      setEnregistrement(false);
    }
    return idScene;
  }

  // Lien client pour la fiche et la capture : ENREGISTRE le plan (sans
  // demander — un document exporté correspond toujours à un plan enregistré,
  // et une boîte de dialogue serait de toute façon avalée par Chrome quand la
  // fenêtre d'impression a pris le focus), puis FIGE une version (V1, V2…)
  // avec son propre jeton — le QR imprimé montre exactement ce que le
  // document montrait, même si le plan évolue ensuite (le bouton « Partager »
  // donne, lui, le lien vivant). Null seulement en cas d'erreur : l'export se
  // fait alors sans lien 3D.
  async function lienPartagePourExport(motif: "fiche" | "capture"): Promise<{ url: string; numero: number } | null> {
    let id = scene.id;
    if (!id || modifie) {
      id = await enregistrer();
      if (!id) return null;
    }
    try {
      const r = await fetch(`/api/planner/scenes/${id}/versions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ motif }) });
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      setMessage(j.reutilisee ? `Plan inchangé : version V${j.numero} réutilisée` : `Version V${j.numero} figée pour ce document`);
      setTimeout(() => setMessage(""), 3000);
      return { url: j.url as string, numero: j.numero as number };
    } catch (e) {
      setMessage(`Lien 3D non joint : ${(e as Error).message}`);
      return null;
    }
  }
  // Capture propre : on désélectionne (le halo bleu sous le meuble est un
  // objet de la scène 3D, il partirait dans l'image) et on attend deux
  // rendus avant de lire le canvas.
  // (setTimeout et pas requestAnimationFrame : rAF ne tourne plus dès que
  // l'onglet perd le focus, par ex. quand la fenêtre d'impression s'ouvre.)
  async function capturerSansSelection(): Promise<string | null> {
    setSelected(null);
    await new Promise<void>((r) => setTimeout(r, 80));
    return captureRef.current?.() || null;
  }
  function chargerImage(src: string): Promise<HTMLImageElement | null> {
    return new Promise((res) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => res(null);
      im.src = src;
    });
  }

  // ── Exports ──
  // Liste d'achat : réutilise le circuit existant (table listes_achat →
  // brouillon DRA). Un article posé n fois = une ligne qty n. Le variant_id
  // est celui de la première variante (le 3D est au niveau fiche).
  async function exporterListeAchat() {
    if (scene.items.length === 0) { setMessage("Aucun article à exporter"); return; }
    const nom = exigerNom();
    if (!nom) return;
    const parProduit = regrouper(scene.items);
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
  // Fiche imprimable, calquée sur le document /print/offre/[slug] (Raleway,
  // en-tête logo + tableau méta, filets bleus, totaux à droite, pied de
  // page). On reprend les classes et les réglages de ce document pour que
  // le plan 3D ressorte comme une page de plus du même dossier.
  async function imprimerListe() {
    const nom = exigerNom();
    if (!nom) return;
    // 1) capture d'abord, onglet encore au premier plan ; 2) fenêtre ouverte
    // dans la foulée du clic (sinon bloquée) ; 3) lien de partage ; 4) contenu.
    const data = await capturerSansSelection();
    const w = window.open("", "_blank");
    if (!w) { setMessage("Fenêtre bloquée par le navigateur"); return; }
    w.document.write("<p style='font-family:sans-serif;padding:24px;color:#666'>Préparation de la fiche…</p>");
    const version = await lienPartagePourExport("fiche");
    const lien = version?.url || null;
    const parProduit = regrouper(scene.items);
    const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const fmt = (v: number) => `CHF ${new Intl.NumberFormat("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)}`;
    const des = (it: SceneItem) => (it.prix_exact ? "" : "dès ");
    const TVA = 0.081;
    const tva = total - total / (1 + TVA);
    const conseiller = (() => { try { return window.localStorage.getItem("jardi-utilisateur") || ""; } catch { return ""; } })();
    const dateDoc = new Date().toLocaleDateString("fr-CH", { day: "2-digit", month: "2-digit", year: "numeric" });
    const THEME = "#2b8ad1", BLACK = "#000", GREY = "#333", LIGHT = "#f9f9f9";
    const lignes = [...parProduit.values()].map(({ it, qty }) => {
      const d = dims[it.uid];
      return `<tr>
        <td class="td-img">${it.image_url ? `<img src="${it.image_url}" alt="">` : ""}</td>
        <td class="td-desc">
          <div class="item-title">${esc(it.titre)}</div>
          ${it.sku ? `<div class="item-sku">Réf. ${esc(it.sku)}</div>` : ""}
          ${d ? `<div class="item-sku">Cotes 3D ${Math.round(d.l * 100)} × ${Math.round(d.p * 100)} × H ${Math.round(d.h * 100)} cm</div>` : ""}
          ${it.size_warn ? '<div class="item-warn">Taille : rendu 3D indicatif</div>' : ""}${it.color_warn && scene.mode === "couleurs" ? '<div class="item-warn">Couleur : rendu 3D indicatif</div>' : ""}
        </td>
        <td class="td-center">× ${qty}</td>
        <td class="td-right">${it.prix != null ? des(it) + fmt(it.prix) : "—"}</td>
        <td class="td-total">${it.prix != null ? des(it) + fmt(it.prix * qty) : "—"}</td>
      </tr>`;
    }).join("");
    const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(nom)} — Plan 3D</title>
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Raleway:wght@300;400;700;900&display=swap" rel="stylesheet">
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Raleway', 'Helvetica Neue', Arial, sans-serif; font-size: 13px; line-height: 1.5; color: ${GREY}; background: white; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
        @page { size: A4 portrait; margin: 14mm 16mm 14mm 14mm; }
        @media screen {
          .doc-wrap { max-width: 794px; margin: 0 auto; padding: 20px 28px; box-shadow: 0 0 20px rgba(0,0,0,0.08); }
          .print-btn { position: fixed; top: 16px; right: 16px; z-index: 100; background: ${THEME}; color: white; border: 0; padding: 10px 20px; border-radius: 6px; font-size: 14px; font-weight: 700; cursor: pointer; }
        }
        @media print { .print-btn { display: none !important; } }
        .doc-header { display: flex; justify-content: space-between; gap: 20px; margin-bottom: 6mm; width: 100%; }
        .doc-header-left { flex: 0 0 46%; }
        .doc-header-right { flex: 0 0 50%; }
        .doc-logo { max-width: 175px; max-height: 65px; object-fit: contain; display: block; margin-bottom: 10px; }
        .doc-type { font-size: 26px; font-weight: 400; color: ${THEME}; margin-bottom: 8px; line-height: 1.1; }
        .doc-meta-table { border-collapse: collapse; width: 100%; }
        .doc-meta-table td { padding: 1px 6px 1px 0; vertical-align: top; font-size: 12px; line-height: 1.35; }
        .doc-meta-label { font-weight: 700; color: ${BLACK}; white-space: nowrap; width: 44%; }
        .doc-plan-name { font-size: 19px; font-weight: 700; color: ${BLACK}; line-height: 1.3; margin: 6px 0 4px; }
        .doc-plan-sub { font-size: 12px; color: #666; }
        .doc-hr { border: 0; border-top: 2px solid ${THEME}; margin: 4mm 0; width: 100%; }
        .doc-capture { width: 100%; margin-bottom: 6mm; page-break-inside: avoid; break-inside: avoid; }
        .doc-capture img { display: block; width: 100%; border: 1px solid #e5e7eb; border-radius: 4px; }
        .doc-capture-caption { font-size: 10px; color: #777; font-style: italic; margin-top: 5px; text-align: center; }
        .doc-table { width: 100%; border-collapse: collapse; margin-bottom: 6mm; }
        .doc-table thead th { padding: 7px 4px; border-top: 2px solid ${THEME}; border-bottom: 2px solid ${THEME}; font-weight: 700; font-size: 12px; color: ${BLACK}; }
        .th-left { text-align: left; } .th-center { text-align: center; } .th-right { text-align: right; }
        .doc-table tbody tr td { padding: 8px 4px; border-bottom: 1px solid #efefef; vertical-align: top; font-size: 12px; }
        .doc-table tbody tr:nth-child(odd) td { background: ${LIGHT}; }
        .td-img { width: 56px; vertical-align: middle; text-align: center; }
        .td-img img { max-width: 52px; max-height: 52px; object-fit: contain; }
        .td-desc { padding-left: 8px !important; }
        .td-center { text-align: center; vertical-align: middle; white-space: nowrap; }
        .td-right { text-align: right; vertical-align: middle; white-space: nowrap; }
        .td-total { text-align: right; vertical-align: middle; white-space: nowrap; font-weight: 700; color: ${BLACK}; }
        .item-title { font-weight: 700; color: ${BLACK}; line-height: 1.35; }
        .item-sku { font-size: 11px; color: #777; margin-top: 2px; font-weight: 400; }
        .item-warn { font-size: 11px; font-weight: 600; color: #E67E22; margin-top: 3px; }
        .doc-bottom-wrap { display: flex; gap: 20px; margin-bottom: 8mm; align-items: flex-end; page-break-inside: avoid; break-inside: avoid; }
        .doc-notes-col { flex: 1; font-size: 11px; color: #666; line-height: 1.55; }
        .doc-totals-col { flex: 0 0 44%; }
        .doc-pricing { width: 100%; border-collapse: collapse; }
        .doc-pricing td { padding: 5px 4px; font-size: 12px; }
        .doc-pricing tr:nth-child(even) td { background: ${LIGHT}; }
        .doc-pricing .pt-label { font-weight: 600; color: ${BLACK}; }
        .doc-pricing .pt-value { text-align: right; white-space: nowrap; color: ${BLACK}; }
        .doc-pricing .pt-tva td { color: #666; font-size: 11px; }
        .doc-pricing .pt-total td { border-top: 2px solid ${THEME} !important; border-bottom: 2px solid ${THEME} !important; padding: 8px 4px !important; }
        .pt-total-label { font-weight: 900 !important; font-size: 15px !important; color: ${BLACK} !important; }
        .pt-total-value { font-weight: 900 !important; font-size: 15px !important; color: ${BLACK} !important; text-align: right; white-space: nowrap; }
        .doc-3d { margin: 0 0 6mm 0; background: linear-gradient(135deg, #EEF6FF 0%, #E8F4FF 100%); border: 1.5px solid ${THEME}; border-radius: 12px; padding: 14px 20px; display: flex; align-items: center; gap: 20px; page-break-inside: avoid; break-inside: avoid; }
        .doc-3d-title { font-size: 13px; font-weight: 700; color: #0a1551; margin-bottom: 4px; }
        .doc-3d-text { font-size: 11px; color: #5e678f; line-height: 1.6; margin-bottom: 10px; }
        .doc-3d-btn { display: inline-block; background: ${THEME}; color: white; border-radius: 20px; padding: 8px 18px; font-size: 12px; font-weight: 700; letter-spacing: 0.02em; text-decoration: none; }
        .doc-3d-url { margin-top: 6px; font-size: 10px; color: #5e678f; word-break: break-all; }
        .doc-3d-qr { flex-shrink: 0; text-align: center; }
        .doc-3d-qr img { width: 110px; height: 110px; border-radius: 8px; border: 1px solid #c7dff5; }
        .doc-3d-qr div { font-size: 9px; color: #5e678f; margin-top: 4px; }
        .doc-thanks { text-align: center; font-weight: 700; color: ${THEME}; margin: 6mm 0 3px; font-size: 13px; }
        .doc-terms { text-align: center; font-size: 10px; color: #888; line-height: 1.5; margin-bottom: 6mm; }
        .doc-footer { border-top: 1px solid #ddd; padding-top: 6px; text-align: center; font-size: 11px; color: #666; line-height: 1.7; }
        .doc-footer strong { color: ${BLACK}; }
        .doc-footer-url { font-weight: 700; color: ${THEME}; }
      </style></head><body>
      <button class="print-btn" onclick="window.print()">🖨 Imprimer</button>
      <div class="doc-wrap">
        <div class="doc-header">
          <div class="doc-header-left">
            <img class="doc-logo" src="https://cdn.shopify.com/s/files/1/0360/3251/2135/files/logo_JARDIN_CONFORT_shopify.jpg?v=1614107698" alt="Jardin-Confort">
            <div class="doc-type">Plan 3D</div>
            <table class="doc-meta-table"><tbody>
              <tr><td class="doc-meta-label">Date</td><td>${dateDoc}</td></tr>
              ${conseiller ? `<tr><td class="doc-meta-label">Conseiller</td><td>${esc(conseiller)}</td></tr>` : ""}
              <tr><td class="doc-meta-label">Terrasse</td><td>${scene.terrasse.largeur} × ${scene.terrasse.profondeur} m</td></tr>
              <tr><td class="doc-meta-label">Articles</td><td>${scene.items.length}</td></tr>
              ${scene.id ? `<tr><td class="doc-meta-label">N° de plan</td><td>${esc(scene.id.slice(0, 8))}${version ? ` · V${version.numero}` : ""}</td></tr>` : ""}
              ${scene.mode === "maquette" ? `<tr><td class="doc-meta-label">Rendu</td><td>maquette (sans couleurs)</td></tr>` : ""}
            </tbody></table>
          </div>
          <div class="doc-header-right">
            <div class="doc-plan-name">${esc(nom)}</div>
            <div class="doc-plan-sub">Composition à l'échelle réalisée avec le planner 3D Jardin-Confort.</div>
          </div>
        </div>
        <hr class="doc-hr">
        ${data ? `<div class="doc-capture"><img src="${data}" alt=""><div class="doc-capture-caption">Vue ${scene.vue === "plan" ? "de dessus" : "en perspective"} — ${MENTION_LEGALE}</div></div>` : ""}
        <table class="doc-table">
          <thead><tr>
            <th style="width:56px"></th>
            <th class="th-left">Description de l'article</th>
            <th class="th-center" style="width:62px">Qté</th>
            <th class="th-right" style="width:90px">Prix/pce</th>
            <th class="th-right" style="width:100px">Total</th>
          </tr></thead>
          <tbody>${lignes || `<tr><td colspan="5" style="text-align:center;padding:20px;color:#aaa;font-style:italic">Aucun article</td></tr>`}</tbody>
        </table>
        <div class="doc-bottom-wrap">
          <div class="doc-notes-col">${totalApprox ? "« dès » : prix le plus bas de la fiche, la variante exacte (taille, coloris) n'étant pas encore choisie." : ""}</div>
          <div class="doc-totals-col"><table class="doc-pricing"><tbody>
            <tr><td class="pt-label">Sous-total articles</td><td class="pt-value">${totalApprox ? "dès " : ""}${fmt(total)}</td></tr>
            <tr class="pt-tva"><td class="pt-label">TVA 8.1% (incluse)</td><td class="pt-value">${fmt(tva)}</td></tr>
            <tr class="pt-total"><td class="pt-total-label">TOTAL TTC${totalApprox ? " (dès)" : ""}</td><td class="pt-total-value">${fmt(total)}</td></tr>
          </tbody></table></div>
        </div>
        ${lien ? `<div class="doc-3d">
          <div style="flex:1">
            <div class="doc-3d-title">🧊 Votre plan en 3D</div>
            <div class="doc-3d-text">Tournez autour de votre projet, en vue de dessus ou en perspective, depuis votre smartphone ou votre ordinateur : cliquez sur le bouton ci-dessous, ou scannez le QR code si vous lisez ce document sur papier. Ce lien montre la version V${version?.numero} du plan, telle qu'imprimée ici ; si votre conseiller retravaille le projet, la page vous le signalera et vous proposera la version la plus récente.</div>
            <a href="${esc(lien)}" target="_blank" rel="noopener noreferrer" class="doc-3d-btn">Ouvrir mon plan en 3D →</a>
            <div class="doc-3d-url">${esc(lien)}</div>
          </div>
          <div class="doc-3d-qr">
            <img src="https://api.qrserver.com/v1/create-qr-code/?size=110x110&data=${encodeURIComponent(lien)}" alt="QR code plan 3D">
            <div>Scanner pour ouvrir le plan 3D</div>
          </div>
        </div>` : ""}
        <p class="doc-thanks">Nous nous réjouissons de vous accompagner dans votre projet. Merci pour votre confiance !</p>
        <p class="doc-terms">${MENTION_LEGALE}. Prix TTC indicatifs au jour de l'impression, sous réserve d'une offre.<br>Les articles, quantités et prix mentionnés peuvent différer de l'offre finale. Seule l'offre signée ou la confirmation de commande fait foi.</p>
        <div class="doc-footer">
          <div><strong>Jardin-Confort SA</strong></div>
          <div>Route de Lavaux 425 · 1095 Lutry · Suisse</div>
          <div>contact@jardinconfort.ch · +41 21 791 36 71</div>
          <div>TVA : CHE-100.142.327</div>
          <div class="doc-footer-url">www.jardin-confort.ch</div>
        </div>
      </div>
      <script>
        (function(){
          var imgs=[].slice.call(document.images).map(function(i){return i.complete?Promise.resolve():new Promise(function(r){i.onload=i.onerror=r;});});
          var fonts=document.fonts?document.fonts.ready:Promise.resolve();
          Promise.all(imgs.concat([fonts])).then(function(){setTimeout(function(){window.print()},150);});
        })();
      </script>
      </body></html>`;
    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  // Partage client : lien public en lecture seule (/planner/partage/<token>).
  // La scène doit être enregistrée (le jeton vit sur la ligne planner_scenes).
  async function partager() {
    if (!scene.id || modifie) {
      setMessage("Enregistre d'abord le plan pour le partager");
      return;
    }
    try {
      const r = await fetch(`/api/planner/scenes/${scene.id}/partage`, { method: "POST" });
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      setPartage({ url: j.url, copie: false });
    } catch (e) {
      setMessage(`Partage impossible : ${(e as Error).message}`);
    }
  }
  async function copierPartage() {
    if (!partage) return;
    try { await navigator.clipboard.writeText(partage.url); setPartage({ ...partage, copie: true }); } catch { /* pas de presse-papiers */ }
  }
  async function revoquerPartage() {
    if (!scene.id || !window.confirm("Révoquer le lien ? Le client ne pourra plus ouvrir le plan avec ce lien.")) return;
    const r = await fetch(`/api/planner/scenes/${scene.id}/partage`, { method: "DELETE" });
    const j = await r.json();
    if (j.error) { setMessage(j.error); return; }
    setPartage(null);
    setMessage("Lien de partage révoqué");
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
          onBlur={(e) => { const v = e.target.value.replace(/—(?=\S)/, "— "); if (v !== e.target.value) patch({ nom: v }, false); }}
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
          <button type="button" onClick={partager} className={BTN_OFF} title="Lien client en lecture seule : il tourne la vue, zoome, bascule Plan/3D — sans rien modifier">🔗 Partager</button>
          <button type="button" onClick={capturer} className={BTN_OFF} title="Télécharger une image PNG de la vue actuelle, avec la mention légale">📷 Capture</button>
          <button type="button" onClick={imprimerListe} className={BTN_OFF} title="Fiche imprimable : image de la vue + liste des articles avec photos, cotes et prix indicatifs">🖨 Fiche</button>
          <button type="button" onClick={exporterListeAchat} className={`${BTN} border-cyan-500/40 bg-cyan-500/15 text-cyan-200 hover:bg-cyan-500/25`} title="Créer une liste d'achat avec les articles posés (puis brouillon d'offre depuis la page Listes d'achat)">🛒 Liste d'achat</button>
        </div>
      </div>

      {message && <div className="border-b border-white/10 bg-sky-500/10 px-4 py-1.5 text-xs text-sky-200">{message}</div>}
      {partage && (
        <div className="flex flex-wrap items-center gap-2 border-b border-white/10 bg-emerald-500/10 px-4 py-1.5 text-xs text-emerald-100">
          <span>Lien client (lecture seule) :</span>
          <input readOnly value={partage.url} onFocus={(e) => e.currentTarget.select()} className="min-w-[280px] flex-1 rounded-lg border border-white/10 bg-[#1f2125] px-2 py-1 font-mono text-[11px] text-zinc-200" />
          <button type="button" onClick={copierPartage} className={BTN_OFF}>{partage.copie ? "✓ Copié" : "Copier"}</button>
          <a href={partage.url} target="_blank" rel="noopener noreferrer" className={BTN_OFF}>Ouvrir ↗</a>
          <button type="button" onClick={revoquerPartage} className={`${BTN} border-rose-500/40 bg-rose-500/15 text-rose-200`}>Révoquer</button>
          <button type="button" onClick={() => setPartage(null)} className="ml-auto text-zinc-400 hover:text-white" title="Masquer">✕</button>
        </div>
      )}

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
