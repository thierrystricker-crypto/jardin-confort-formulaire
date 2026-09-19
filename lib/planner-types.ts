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
};

export type CatalogueItem = {
  product_id: number;
  handle: string;
  titre: string;
  marque: string | null;
  collection: string | null;
  categories: string[];
  image_url: string | null;
  prix_min: number | null;
  source: "model3d" | "url" | null;
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
  has_size_option: boolean;
  model_level: "fiche" | "variante";
  variantes_3d: Variante3d[];
};

// Options qui ne changent pas la géométrie : ignorées pour libeller une taille
const OPTIONS_SANS_GEOMETRIE = /couleur|colou?r|farbe|coloris|tissu|finition|toile|structure|matière|material/i;

// Choix proposés pour un article : une entrée par fichier distinct (les
// variantes de couleur partagent le fichier de leur taille). Le défaut de la
// fiche est ajouté s'il diffère de tous les fichiers de variante.
export type ChoixModele = { label: string; url: string; variant_id: string | null; sku: string | null; size_warn: boolean };
export function choixModeles(c: CatalogueItem): ChoixModele[] {
  const vus = new Set<string>();
  const out: ChoixModele[] = [];
  for (const v of c.variantes_3d || []) {
    if (vus.has(v.url)) continue;
    vus.add(v.url);
    const parts = Object.entries(v.options || {})
      .filter(([n]) => !OPTIONS_SANS_GEOMETRIE.test(n))
      .map(([, val]) => val);
    out.push({ label: parts.join(" / ") || v.titre || "Variante", url: v.url, variant_id: v.variant_id, sku: v.sku, size_warn: false });
  }
  if (c.url_glb && !vus.has(c.url_glb)) {
    out.push({ label: out.length ? "Modèle par défaut de la fiche" : "", url: c.url_glb, variant_id: c.variant_id_1, sku: c.sku_1, size_warn: c.has_size_option });
  }
  return out;
}

export type SceneItem = {
  uid: string;              // identifiant local de l'instance (un produit peut être posé plusieurs fois)
  product_id: number;
  titre: string;
  marque: string | null;
  url: string;              // URL du GLB (Model3d ou .bin)
  source: "model3d" | "url";
  x: number;                // m, centre de la terrasse = 0
  z: number;                // m
  rot: number;              // degrés, autour de Y
  size_warn: boolean;       // taille non garantie (option de taille sur la fiche)
  color_warn: boolean;      // couleur non garantie (option de couleur sur la fiche)
  image_url?: string | null;
  prix?: number | null;
  sku?: string | null;
  variant_id?: string | null;
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

export type Scene = {
  id: string | null;
  nom: string;
  terrasse: Terrasse;
  sol?: SolId;
  items: SceneItem[];
  mode: "couleurs" | "maquette";
  vue: "plan" | "3d";
  offre_slug?: string | null;
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

export const MENTION_LEGALE = "Rendu à titre informatif, non contractuel";

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
