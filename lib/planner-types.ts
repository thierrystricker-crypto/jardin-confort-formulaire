// lib/planner-types.ts
// Types partagés du planner 3D (page /planner, API /api/planner/*).
//
// Une scène est une liste de lignes : produit Shopify, URL du modèle, position
// au sol (x, z en mètres, origine au centre de la terrasse), rotation autour
// de la verticale (degrés). C'est volontairement le même grain qu'une ligne
// d'offre : le jour du lien offres ↔ planner (étape 3), une ligne d'offre avec
// modèle = un item, et réciproquement.

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
};

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
};

export type Terrasse = { largeur: number; profondeur: number };

export type Scene = {
  id: string | null;
  nom: string;
  terrasse: Terrasse;
  items: SceneItem[];
  mode: "couleurs" | "maquette";
  vue: "plan" | "3d";
  offre_slug?: string | null;
};

export const SCENE_VIDE: Scene = {
  id: null,
  nom: "Sans titre",
  terrasse: { largeur: 6, profondeur: 4 },
  items: [],
  mode: "couleurs",
  vue: "plan",
};

export const MENTION_LEGALE = "Rendu à titre informatif, non contractuel";

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
