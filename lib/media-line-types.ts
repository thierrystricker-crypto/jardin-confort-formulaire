// lib/media-line-types.ts
// Types partagés pour les lignes média (logos marques + images uploadées)

export type MediaSize = "small" | "medium" | "large";

export const MEDIA_SIZE_PX: Record<MediaSize, number> = {
  small: 30,
  medium: 50,
  large: 80,
};

export const MEDIA_SIZE_LABEL: Record<MediaSize, string> = {
  small: "Petite",
  medium: "Moyenne",
  large: "Grande",
};

// Une ligne d'offre peut maintenant être de type "media" en plus de "article" / "comment"
export type MediaLine = {
  kind: "media";
  // Identifiant unique pour React keys
  id: string;
  // URL de l'image (Supabase Storage public URL ou data URL temporaire)
  image_url: string;
  // Nom optionnel (pour les logos depuis la DB) — affiché en alt
  name?: string;
  // Source : "library" = depuis brand_logos | "upload" = uploadé à la volée
  source: "library" | "upload";
  // Taille d'affichage
  size: MediaSize;
};

// Type côté DB pour brand_logos
export type BrandLogo = {
  id: string;
  name: string;
  slug: string;
  search_terms: string[];
  image_url: string;
  created_at: string;
};

// Helper : normalise un terme pour le matching fuzzy
// "Cane-line" → "caneline", "Häfele" → "hafele"
export function normalizeSearchTerm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove accents
    .replace(/[-_\s]+/g, "") // remove separators
    .trim();
}