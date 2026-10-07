// lib/planner-types.ts
// Types partagés du planner 3D (page /planner, API /api/planner/*).
//
// Une scène est une liste de lignes : produit Shopify, URL du modèle, position
// au sol (x, z en mètres, origine au centre de la terrasse), rotation autour
// de la verticale (degrés). C'est volontairement le même grain qu'une ligne
// d'offre : le jour du lien offres ↔ planner (étape 3), une ligne d'offre avec
// modèle = un item, et réciproquement.

// Modèle 3D propre à une variante (même forme que Variante3d du sync)
export type Variante3d = {
  variant_id: string;
  sku: string | null;
  titre: string | null;
  options: Record<string, string>;
  url: string;
  prix: number | null;
};

// Couleurs appliquées à l'affichage (Fermob) — voir lib/modeles-3d-zones.ts
export type { AxeCouleur, ChoixCouleur, Peinture, ValeurCouleur, VarianteZones, ZonesConfig } from "@/lib/modeles-3d-zones";

export type CatalogueItem = {
  product_id: number;
  handle: string;
  titre: string;
  marque: string | null;
  collection: string | null;
  categories: string[];
  image_url: string | null;
  prix_min: number | null;
  source: "model3d" | "url" | "zones" | null;
  url_glb: string | null;
  has_3d: boolean;
  size_mismatch_possible: boolean;
  color_mismatch_possible: boolean;
  option_names: string[];
  bbox_x: number | null;
  bbox_y: number | null;
  bbox_z: number | null;
  sku_1: string | null;
  variant_id_1: string | null;
  variant_count: number;
  has_size_option: boolean;
  model_level: "fiche" | "variante";
  variantes_3d: Variante3d[];
  // Fiche à couleurs appliquées (Fermob) : forme + zones, et les variantes
  // avec leurs options pour proposer les couleurs.
  zones?: import("@/lib/modeles-3d-zones").ZonesConfig | null;
  zones_variantes?: import("@/lib/modeles-3d-zones").VarianteZones[];
};

// Options qui ne changent pas la géométrie : ignorées pour libeller une taille
const OPTIONS_SANS_GEOMETRIE = /couleur|colou?r|farbe|coloris|tissu|finition|toile|structure|matière|material/i;

// Choix proposés pour un article : une entrée par fichier distinct (les
// variantes de couleur partagent le fichier de leur taille). Le modèle de la
// fiche n'est proposé QUE si l'article n'a aucun modèle de variante : quand les
// variantes ont leur propre fichier, le .glb de la fiche est l'ancien modèle
// générique et il n'a rien à faire dans le choix de la taille (Dedon, 07.10.2026).
export type ChoixModele = { label: string; url: string; variant_id: string | null; sku: string | null; size_warn: boolean; prix: number | null };
export function choixModeles(c: CatalogueItem): ChoixModele[] {
  const vus = new Set<string>();
  const out: ChoixModele[] = [];
  for (const v of c.variantes_3d || []) {
    if (vus.has(v.url)) continue;
    vus.add(v.url);
    const parts = Object.entries(v.options || {})
      .filter(([n]) => !OPTIONS_SANS_GEOMETRIE.test(n))
      .map(([, val]) => val);
    out.push({ label: parts.join(" / ") || v.titre || "Variante", url: v.url, variant_id: v.variant_id, sku: v.sku, size_warn: false, prix: v.prix });
  }
  if (c.url_glb && !out.length) {
    out.push({ label: "", url: c.url_glb, variant_id: c.variant_id_1, sku: c.sku_1, size_warn: c.has_size_option, prix: null });
  }
  return out;
}

// ─── Décors : murs et murets ──────────────────────────────────────────────────
// Un décor n'est pas un article du catalogue : aucun produit Shopify, aucun
// prix, et il reste hors de la liste d'achat, de la fiche et des documents
// client. C'est une boîte paramétrique que le conseiller étire à la souris,
// comme les murs des planners fabricants (07.10.2026).

export type MurTextureId = "crepi" | "pierre" | "beton" | "bois" | "thuya" | "laurier" | "buis";

// `vegetal` : la boîte devient une haie taillée — même objet, même étirement,
// mais un autre vocabulaire dans l'app et dans le prompt de l'image IA.
// `fichier` : texture photo servie depuis /public (ambientCG, CC0 — aucune
// attribution requise). `metres` = côté réel couvert par une tuile, pour que la
// texture se RÉPÈTE à la bonne échelle et ne s'étire jamais.
export const MUR_TEXTURES: { id: MurTextureId; nom: string; couleur: string; vegetal?: true; plante?: string; fichier?: string; metres?: number }[] = [
  { id: "crepi", nom: "Crépi clair", couleur: "#dcd7ce" },
  { id: "pierre", nom: "Pierre sèche", couleur: "#b5aea1" },
  { id: "beton", nom: "Béton", couleur: "#adadaa" },
  { id: "bois", nom: "Bois", couleur: "#ad8d61" },
  { id: "thuya", nom: "Haie de thuyas", couleur: "#3c5c38", vegetal: true, plante: "thuyas", fichier: "/textures/haie.jpg", metres: 1 },
  { id: "laurier", nom: "Haie de lauriers", couleur: "#2f5e33", vegetal: true, plante: "lauriers" },
  { id: "buis", nom: "Haie de buis", couleur: "#537040", vegetal: true, plante: "buis" },
];

export function estVegetal(t: MurTextureId): boolean {
  return !!MUR_TEXTURES.find((x) => x.id === t)?.vegetal;
}

// Nom affiché d'un décor selon sa matière et sa hauteur.
export function nomMur(m: MurConfig): string {
  if (estVegetal(m.texture)) return `Haie ${Math.round(m.hauteur * 100)} cm`;
  return `${m.hauteur <= 1.2 ? "Muret" : "Mur"} ${Math.round(m.hauteur * 100)} cm`;
}

export type MurConfig = {
  type: "mur";
  longueur: number;    // m, étirable par les poignées du plan
  hauteur: number;     // m
  epaisseur: number;   // m
  texture: MurTextureId;
};

// Décors proposés au clic. Les cotes de départ sont celles demandées :
// muret 100 × 20 × H 100 cm, mur 100 × 20 × H 200 cm.
export const MURS: { id: string; nom: string; sous_titre: string; mur: MurConfig }[] = [
  { id: "muret", nom: "Muret", sous_titre: "100 × 20 × H 100 cm", mur: { type: "mur", longueur: 1, hauteur: 1, epaisseur: 0.2, texture: "crepi" } },
  { id: "mur",   nom: "Mur",   sous_titre: "100 × 20 × H 200 cm", mur: { type: "mur", longueur: 1, hauteur: 2, epaisseur: 0.2, texture: "crepi" } },
  // Même boîte étirable, habillée de feuillage. Deux hauteurs comme pour la
  // maçonnerie : une haie basse de séparation et une haie brise-vue. 45 cm
  // d'épaisseur, la largeur d'une haie taillée au cordeau.
  { id: "haie-basse", nom: "Haie basse", sous_titre: "100 × 45 × H 100 cm", mur: { type: "mur", longueur: 1, hauteur: 1, epaisseur: 0.45, texture: "thuya" } },
  { id: "haie",       nom: "Haie",       sous_titre: "100 × 45 × H 180 cm", mur: { type: "mur", longueur: 1, hauteur: 1.8, epaisseur: 0.45, texture: "thuya" } },
];

// Phrase pour le prompt de l'image d'ambiance : l'IA doit rendre un vrai mur,
// pas un meuble. Sans décor, chaîne vide.
export function decrireMurs(items: SceneItem[]): string {
  const murs = items.filter((i) => i.mur);
  if (!murs.length) return "";
  const m = (v: number) => v.toFixed(2).replace(".", ",");
  const parts = murs.map((i) => {
    const d = i.mur!;
    const t = MUR_TEXTURES.find((x) => x.id === d.texture);
    const dims = `de ${m(d.longueur)} m de long, ${m(d.epaisseur)} m d'épaisseur et ${m(d.hauteur)} m de haut`;
    if (t?.vegetal) return `une haie de ${t.plante} taillée au cordeau ${dims}`;
    const quoi = d.hauteur <= 1.2 ? "muret" : "mur";
    return `un ${quoi} en ${(t?.nom || "crépi").toLowerCase()} ${dims}`;
  });
  const vegetal = murs.some((i) => estVegetal(i.mur!.texture));
  const nature = vegetal
    ? "ce sont des éléments du jardin — haies taillées et maçonnerie"
    : "ce sont des éléments de maçonnerie du jardin";
  return `La scène comporte ${parts.join(", ")} : ${nature}, à rendre comme tels, jamais comme du mobilier.`;
}

export type SceneItem = {
  uid: string;              // identifiant local de l'instance (un produit peut être posé plusieurs fois)
  product_id: number;       // 0 pour un décor (pas de produit Shopify)
  titre: string;
  marque: string | null;
  url: string;              // URL du GLB (Model3d ou .bin) — vide pour un décor
  source: "model3d" | "url" | "zones" | "decor";
  // Décor paramétrique (mur, muret) : pas de fichier 3D, une boîte étirable.
  mur?: MurConfig;
  // Consignes de peinture (fiche à zones) : matières à repeindre, couleurs
  // linéaires, textures. Appliquées au chargement et avant toute capture.
  peinture?: import("@/lib/modeles-3d-zones").Peinture[];
  couleur_code?: string | null;   // code de la couleur posée (« 47 ») — axe principal
  couleur_nom?: string | null;    // nom lisible (« Carbone »)
  // Fiches à plusieurs axes de couleur (Bellevie, Rivage : structure + tissu) :
  // la combinaison choisie, option → code. C'est elle qui désigne la variante.
  couleur_options?: Record<string, string>;
  x: number;                // m, centre de la terrasse = 0
  z: number;                // m
  rot: number;              // degrés, autour de Y (pas de 15°)
  rot_fix?: number;         // correction fine en degrés (fichier livré de travers) — verrouillée par défaut
  size_warn: boolean;       // taille non garantie (option de taille sur la fiche)
  color_warn: boolean;      // couleur non garantie (option de couleur sur la fiche)
  image_url?: string | null;
  prix?: number | null;        // prix unitaire TTC
  prix_exact?: boolean;        // vrai = prix de la variante posée ; faux = prix le plus bas de la fiche (« dès »)
  sku?: string | null;
  variant_id?: string | null;
  dims?: { l: number; p: number; h: number };   // cotes mesurées, posées sur les versions figées (fiche PDF)
};

export type Terrasse = { largeur: number; profondeur: number };

export type SolId = "bois" | "pierre" | "beton" | "gravier" | "gazon" | "blanc";

export const SOLS: { id: SolId; nom: string; couleur: string }[] = [
  { id: "bois", nom: "Bois", couleur: "#c9a678" },
  { id: "pierre", nom: "Pierre claire", couleur: "#d8d2c6" },
  { id: "beton", nom: "Béton", couleur: "#a9a9a4" },
  { id: "gravier", nom: "Gravier", couleur: "#b8b3aa" },
  { id: "gazon", nom: "Gazon", couleur: "#7fa25e" },
  { id: "blanc", nom: "Blanc", couleur: "#f2f2f0" },
];

// Point de vue mémorisé par vue (SQL 028) : position, cible OrbitControls, zoom (ortho).
export type VueCamera = { pos: [number, number, number]; target: [number, number, number]; zoom?: number };
export type CameraScene = { plan?: VueCamera; "3d"?: VueCamera };

export type Scene = {
  id: string | null;
  nom: string;
  terrasse: Terrasse;
  sol?: SolId;
  items: SceneItem[];
  mode: "couleurs" | "maquette";
  vue: "plan" | "3d";
  offre_slug?: string | null;
  // Joindre le plan (vue 3D + image d'ambiance retenue) à la page print de
  // l'offre / commande liée — SQL 029. Décoché par défaut.
  sur_documents?: boolean;
  camera?: CameraScene | null;
};

export const SCENE_VIDE: Scene = {
  id: null,
  nom: "Sans titre",
  terrasse: { largeur: 6, profondeur: 4 },
  sol: "bois",
  items: [],
  mode: "couleurs",
  vue: "plan",
};

export const MENTION_IA = "Image d'inspiration libre générée par l'IA, non contractuelle";
export const MENTION_LEGALE = "Rendu à titre informatif, non contractuel";

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
