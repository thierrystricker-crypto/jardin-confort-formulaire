// lib/moodboard.ts
// Types et textes du moodboard des matières, SANS dépendance serveur :
// importable depuis les composants client (print, page web, formulaire).
// La logique de calcul (Shopify + RPC) est dans lib/matieres-offre.ts.

export type MatiereMoodboard = {
  cle: string;
  nom: string;
  code: string | null;
  marque: string;        // vendor Shopify, tel quel (« Manutti », « Fermob »)
  famille: string;       // tissu, bois, peinture, ceramique, tressage…
  hex: string | null;
  motif: boolean;        // rayures / imprimés (info de la base, non utilisée par la palette)
  url_vignette: string;  // CDN Shopify de préférence (stable pour le PDF)
  url_maitre: string | null;
  cote?: number | null;  // taille en px de l'image maître (SQL 032) ; absente = inconnue
  lignes: string[];      // id des lignes de l'offre qui portent cette finition
  poids: number;         // montant CHF des lignes concernées → taille du bloc
};

// Couverture de la planche : combien d'articles de l'offre y sont représentés.
// Sur le document client, seuls les deux nombres sont affichés (formulation
// neutre). La liste des titres non reliés ne sert qu'à l'aperçu du formulaire.
export type CouvertureMoodboard = {
  articles: number;          // lignes d'articles Shopify de l'offre
  representes: number;       // lignes qui ont au moins une finition dans la planche
  nonRelies: string[];       // titres des lignes sans finition (usage interne)
};

export type ResultatMoodboard = {
  matieres: MatiereMoodboard[];
  couverture: CouvertureMoodboard;
};

// Texte de bas de planche pour le DOCUMENT CLIENT : neutre, sans liste.
// null = pas de page (aucun article représenté).
export function texteCouverture(c: { articles: number; representes: number }): string | null {
  if (!c || c.representes === 0) return null;
  if (c.representes >= c.articles) return "Finitions de l'ensemble des articles de votre offre.";
  return `Finitions présentées pour ${c.representes} article${c.representes > 1 ? "s" : ""} sur ${c.articles} de votre offre.`;
}

// ─── Réglages stockés dans l'offre : data.moodboard ─────────────────────────
// actif   : la planche est ajoutée en fin d'offre (décochée par défaut)
// mode    : "poids"   → mosaïque, taille des blocs = valeur CHF des articles
//           "degrade" → bandes horizontales triées par clarté
// sens    : pour le dégradé, du clair au foncé ou l'inverse
// palette : réservé aux COMMANDES (figée à la conversion / à la révision)
export type ModeMoodboard = "poids" | "degrade";
export type SensMoodboard = "clair-fonce" | "fonce-clair";

export type ReglagesMoodboard = {
  actif: boolean;
  mode: ModeMoodboard;
  sens: SensMoodboard;
  palette?: ResultatMoodboard;
};

export const REGLAGES_MOODBOARD_DEFAUT: ReglagesMoodboard = {
  actif: false,
  mode: "poids",
  sens: "clair-fonce",
};

export function lireReglagesMoodboard(v: unknown): ReglagesMoodboard {
  const r = (v && typeof v === "object" ? v : {}) as Partial<ReglagesMoodboard>;
  return {
    actif: r.actif === true,
    mode: r.mode === "degrade" ? "degrade" : "poids",
    sens: r.sens === "fonce-clair" ? "fonce-clair" : "clair-fonce",
    ...(r.palette ? { palette: r.palette } : {}),
  };
}

// ─── Familles : ordre et libellés de la colonne de gauche ───────────────────
const FAMILLES: [string, string][] = [
  ["bois", "Bois"], ["tressage", "Tressage"], ["corde", "Corde"],
  ["peinture", "Peinture"], ["ceramique", "Céramique"], ["pierre", "Pierre"],
  ["hpl", "HPL"], ["verre", "Verre"], ["tissu", "Tissu"], ["toile", "Toile"],
  ["maille", "Maille"], ["cuir", "Cuir"], ["plastique", "Plastique"],
];

export function grouperParFamille(matieres: MatiereMoodboard[]): { famille: string; libelle: string; matieres: MatiereMoodboard[] }[] {
  const groupes = new Map<string, MatiereMoodboard[]>();
  for (const m of matieres) {
    const f = (m.famille || "autre").toLowerCase();
    if (!groupes.has(f)) groupes.set(f, []);
    groupes.get(f)!.push(m);
  }
  const ordre = new Map(FAMILLES.map(([f], i) => [f, i]));
  return Array.from(groupes.entries())
    .sort(([a], [b]) => (ordre.get(a) ?? 99) - (ordre.get(b) ?? 99) || a.localeCompare(b))
    .map(([f, ms]) => ({
      famille: f,
      libelle: FAMILLES.find(([k]) => k === f)?.[1] ?? f.charAt(0).toUpperCase() + f.slice(1),
      matieres: [...ms].sort((a, b) => b.poids - a.poids),
    }));
}

// ─── Clarté perçue (L* CIELAB, 0 = noir, 100 = blanc) ──────────────────────
// Sert au tri du dégradé : trier sur le hex brut rangerait mal un vert et un
// gris de même clarté.
export function clarte(hex: string | null | undefined): number | null {
  if (!hex || !/^#?[0-9a-f]{6}$/i.test(hex.trim())) return null;
  const n = parseInt(hex.trim().replace("#", ""), 16);
  const lin = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  const y = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  return y > 0.008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y;
}

// ─── Disposition de la palette de droite ────────────────────────────────────
// Rectangles en POURCENTAGES du panneau : aucun calcul de taille d'écran, donc
// rendu identique dans le PDF (pdf.co), sur la page web et dans l'aperçu.
export type BlocPalette = { matiere: MatiereMoodboard; x: number; y: number; w: number; h: number };

// Part minimale d'un bloc : une petite finition reste visible.
const PART_MIN_POIDS = 0.03;
const PART_MIN_BANDE = 0.06;
// Part maximale : la finition dominante ne mange pas toute la palette.
const PART_MAX = 0.35;

// Surfaces calculées sur la RACINE CARRÉE de la valeur : l'ordre des tailles
// est conservé, mais l'écart est adouci (un article à 14 000 CHF ne fait plus
// 40 % de la planche face à des finitions à 1 000 CHF). Puis plancher et
// plafond, renormalisés jusqu'à stabilité.
function parts(matieres: MatiereMoodboard[], min: number): number[] {
  let p = matieres.map((m) => Math.sqrt(Math.max(m.poids, 0)) || 1);
  const somme0 = p.reduce((s, v) => s + v, 0) || 1;
  p = p.map((v) => v / somme0);
  if (matieres.length * min >= 1) return matieres.map(() => 1 / matieres.length);
  const max = Math.max(PART_MAX, 1 / matieres.length);
  for (let i = 0; i < 10; i++) {
    p = p.map((v) => Math.min(Math.max(v, min), max));
    const somme = p.reduce((s, v) => s + v, 0);
    p = p.map((v) => v / somme);
  }
  return p;
}

// Treemap « squarified » (Bruls et al.) : blocs aussi carrés que possible.
// ratio = largeur / hauteur du panneau.
export function disposerParPoids(matieres: MatiereMoodboard[], ratio: number): BlocPalette[] {
  const tries = [...matieres].sort((a, b) => b.poids - a.poids);
  const p = parts(tries, PART_MIN_POIDS);
  const W = ratio, H = 1;
  const items = tries.map((m, i) => ({ m, a: p[i] * W * H }));
  const out: { m: MatiereMoodboard; x: number; y: number; w: number; h: number }[] = [];

  const pire = (ligne: typeof items, cote: number) => {
    const s = ligne.reduce((t, r) => t + r.a, 0);
    const max = Math.max(...ligne.map((r) => r.a));
    const min = Math.min(...ligne.map((r) => r.a));
    return Math.max((cote * cote * max) / (s * s), (s * s) / (cote * cote * min));
  };

  let reste = items, x = 0, y = 0, w = W, h = H;
  while (reste.length) {
    const cote = Math.min(w, h);
    let ligne = [reste[0]], i = 1;
    while (i < reste.length && pire([...ligne, reste[i]], cote) <= pire(ligne, cote)) {
      ligne.push(reste[i]);
      i++;
    }
    const s = ligne.reduce((t, r) => t + r.a, 0);
    if (w >= h) {
      const lw = s / h;
      let cy = y;
      for (const r of ligne) { const rh = r.a / lw; out.push({ m: r.m, x, y: cy, w: lw, h: rh }); cy += rh; }
      x += lw; w -= lw;
    } else {
      const lh = s / w;
      let cx = x;
      for (const r of ligne) { const rw = r.a / lh; out.push({ m: r.m, x: cx, y, w: rw, h: lh }); cx += rw; }
      y += lh; h -= lh;
    }
    reste = reste.slice(i);
  }
  return out.map((b) => ({
    matiere: b.m,
    x: (b.x / W) * 100, y: (b.y / H) * 100,
    w: (b.w / W) * 100, h: (b.h / H) * 100,
  }));
}

// Bandes horizontales triées par clarté ; hauteur = valeur (avec un minimum).
// Une finition sans hex valide part en bout de dégradé.
export function disposerEnDegrade(matieres: MatiereMoodboard[], sens: SensMoodboard): BlocPalette[] {
  const tries = [...matieres].sort((a, b) => {
    const la = clarte(a.hex), lb = clarte(b.hex);
    if (la === null && lb === null) return 0;
    if (la === null) return 1;
    if (lb === null) return -1;
    return sens === "clair-fonce" ? lb - la : la - lb;
  });
  const p = parts(tries, PART_MIN_BANDE);
  let y = 0;
  return tries.map((m, i) => {
    const b = { matiere: m, x: 0, y: y * 100, w: 100, h: p[i] * 100 };
    y += p[i];
    return b;
  });
}

// ─── Images ─────────────────────────────────────────────────────────────────
// Le CDN Shopify sert une version à la largeur demandée (?width=) : les fichiers
// stockés ne sont pas modifiés, seul l'affichage est allégé.
// 🔴 format=pjpg est INDISPENSABLE pour le PDF : sans lui, le CDN envoie du
// WebP au navigateur ; le PDF ne sait pas l'intégrer, Chrome le décompresse
// en image brute — 5,4 Mo au lieu de 650 Ko pour une seule image (mesuré le
// 13.10.2026 : planche de 7 finitions à 12,7 Mo). En JPEG, l'image passe telle
// quelle et une même URL n'est intégrée qu'une fois.
export function urlCdn(url: string | null | undefined, largeur: number): string | null {
  if (!url) return null;
  if (!/^https:\/\/cdn\.shopify\.com\//.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}width=${largeur}&format=pjpg`;
}

// En dessous de cette taille, l'image maître est répétée en motif dans la
// palette au lieu d'être étirée (un 154 px étiré sur 11 cm serait flou).
export const COTE_MIN_ETIREE = 500;

// La VIGNETTE est le recadrage du centre de l'image maître, au tiers, à
// l'échelle réelle (comme les pastilles du webshop) — et non l'image entière
// réduite. C'est donc elle qui donne le « vrai » rendu de la matière.
// Gros plan ×2 : la vignette doit faire au moins 300 px (maître ≥ 900 px),
// sinon l'agrandissement serait flou.
export const COTE_MIN_GROS_PLAN = 900;
