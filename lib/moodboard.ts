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
  motif: boolean;        // rayures / imprimés : la palette montre la vignette, pas le hex
  url_vignette: string;  // CDN Shopify de préférence (stable pour le PDF)
  url_maitre: string | null;
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
