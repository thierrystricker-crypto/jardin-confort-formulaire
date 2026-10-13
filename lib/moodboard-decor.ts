// lib/moodboard-decor.ts
// Décor d'inspiration de la planche couleurs (chantier « réglages et décor »,
// 13.10.2026). SANS dépendance serveur : importable par les composants client.
//
// Le décor : 2 ou 3 objets naturels (galets, sable, lin, olivier…), posés en
// léger chevauchement dans le coin bas gauche de la planche, sous les
// pastilles, quand il reste de la place. Choisis automatiquement d'après les
// couleurs de l'offre, et de façon DÉTERMINISTE : banque fixe, aucune IA à la
// volée (décision D61, doc 06). Les mêmes articles donnent toujours le même
// décor — la graine est la liste des finitions, pas le slug, pour que le
// brouillon, l'offre et la commande qui en naissent montrent les mêmes objets.
//
// DONNÉE DISTINCTE DE LA TABLE `matieres` : cette banque vit ici, en
// constantes, et la base matières reste en lecture seule.
//
// 🔴 Les images sont des PNG DÉTOURÉS : toujours demandées par urlDecor()
// (format=png), JAMAIS par urlCdn() de lib/moodboard.ts, qui force du JPEG
// (pas de transparence → fond blanc carré autour de chaque objet).
//
// Table générée le 13.10.2026 depuis Téléchargements\deco-inspiration\
// shopify-600\index-etiquettes.csv et les URL du CDN lues par l'API Admin
// (files, filtre jc-deco-). 60 images, 49 sujets. Pour régénérer : même CSV,
// même requête, et recopier l'URL avec son ?v= (il change à chaque dépôt).
// RETIRÉ de la banque (choix de Thierry, 13.10.2026) : BO-05 châtaignes (a et
// b). Les fichiers restent dans Shopify mais ne sont plus jamais tirés.

import type { MatiereMoodboard } from "@/lib/moodboard";

export type AmbianceDecor = "CL" | "GR" | "SO" | "BO" | "TE" | "VE" | "BL";
export type NatureDecor = "mineral" | "vegetal" | "bois" | "textile" | "metal" | "ceramique";

export type ObjetDecor = {
  fichier: string;
  code: string;          // un sujet ; a / b = deux images du même sujet
  variante: string;
  ambiance: AmbianceDecor;
  nature: NatureDecor;
  teintes: string[];     // vocabulaire de matieres.teinte_filtre
  sujet: string;
  url: string;           // CDN Shopify, avec son ?v=
  l: number;             // largeur du PNG source (px)
  h: number;             // hauteur du PNG source (px)
};

export const BANQUE_DECOR: ObjetDecor[] = [
  { fichier: "jc-deco-cl-01-a.png", code: "CL-01", variante: "a", ambiance: "CL", nature: "mineral", teintes: ["blanc"], sujet: "galets blancs", url: "https://cdn.shopify.com/s/files/1/0360/3251/2135/files/jc-deco-cl-01-a.png?v=1791894769", l: 600, h: 561 },
  { fichier: "jc-deco-cl-01-b.png", code: "CL-01", variante: "b", ambiance: "CL", nature: "mineral", teintes: ["blanc"], sujet: "galets blancs", url: "https://cdn.shopify.com/s/files/1/0360/3251/2135/files/jc-deco-cl-01-b.png?v=1791894768", l: 600, h: 561 },
  { fichier: "jc-deco-cl-02-a.png", code: "CL-02", variante: "a", ambiance: "CL", nature: "mineral", teintes: ["beige-sable"], sujet: "tas de sable", url: "https://cdn.shopify.com/s/files/1/0360/3251/2135/files/jc-deco-cl-02-a.png?v=1791894769", l: 600, h: 550 },
  { fichier: "jc-deco-cl-02-b.png", code: "CL-02", variante: "b", ambiance: "CL", nature: "mineral", teintes: ["beige-sable"], sujet: "tas de sable", url: "https://cdn.shopify.com/s/files/1/0360/3251/2135/files/jc-deco-cl-02-b.png?v=1791894769", l: 600, h: 598 },
  { fichier: "jc-deco-cl-03-a.png", code: "CL-03", variante: "a", ambiance: "CL", nature: "textile", teintes: ["beige-sable", "blanc"], sujet: "lin effiloché", url: "https://cdn.shopify.com/s/files/1/0360/3251/2135/files/jc-deco-cl-03-a.png?v=1791894769", l: 600, h: 565 },
  { fichier: "jc-deco-cl-03-b.png", code: "CL-03", variante: "b", ambiance: "CL", nature: "textile", teintes: ["beige-sable", "blanc"], sujet: "lin effiloché", url: "https://cdn.shopify.com/s/files/1/0360/3251/2135/files/jc-deco-cl-03-b.png?v=1791894769", l: 600, h: 574 },
  { fichier: "jc-deco-cl-04-a.png", code: "CL-04", variante: "a", ambiance: "CL", nature: "bois", teintes: ["beige-sable"], sujet: "bois flotté", url: "https://cdn.shopify.com/s/files/1/0360/3251/2135/files/jc-deco-cl-04-a.png?v=1791894768", l: 600, h: 535 },
  { fichier: "jc-deco-cl-04-b.png", code: "CL-04", variante: "b", ambiance: "CL", nature: "bois", teintes: ["beige-sable"], sujet: "bois flotté", url: "https://cdn.shopify.com/s/files/1/0360/3251/2135/files/jc-deco-cl-04-b.png?v=1791894768", l: 600, h: 518 },
  { fichier: "jc-deco-cl-05-a.png", code: "CL-05", variante: "a", ambiance: "CL", nature: "vegetal", teintes: ["beige-sable"], sujet: "pampa", url: "https://cdn.shopify.com/s/files/1/0360/3251/2135/files/jc-deco-cl-05-a.png?v=1791894768", l: 416, h: 600 },
  { fichier: "jc-deco-cl-05-b.png", code: "CL-05", variante: "b", ambiance: "CL", nature: "vegetal", teintes: ["beige-sable"], sujet: "pampa", url: "https://cdn.shopify.com/s/files/1/0360/3251/2135/files/jc-deco-cl-05-b.png?v=1791894768", l: 470, h: 600 },
  { fichier: "jc-deco-cl-06-a.png", code: "CL-06", variante: "a", ambiance: "CL", nature: "mineral", teintes: ["blanc", "beige-sable"], sujet: "travertin", url: "https://cdn.shopify.com/s/files/1/0360/3251/2135/files/jc-deco-cl-06-a.png?v=1791894769", l: 600, h: 545 },
  { fichier: "jc-deco-cl-06-b.png", code: "CL-06", variante: "b", ambiance: "CL", nature: "mineral", teintes: ["blanc", "beige-sable"], sujet: "travertin", url: "https://cdn.shopify.com/s/files/1/0360/3251/2135/files/jc-deco-cl-06-b.png?v=1791894769", l: 600, h: 581 },
  { fichier: "jc-deco-gr-01-a.png", code: "GR-01", variante: "a", ambiance: "GR", nature: "mineral", teintes: ["beton-pierre"], sujet: "béton", url: "https://cdn.shopify.com/s/files/1/0360/3251/2135/files/jc-deco-gr-01-a.png?v=1791894769", l: 600, h: 590 },
  { fichier: "jc-deco-gr-02-a.png", code: "GR-02", variante: "a", ambiance: "GR", nature: "mineral", teintes: ["gris"], sujet: "galets gris", url: "https://cdn.shopify.com/s/files/1/0360/3251/2135/files/jc-deco-gr-02-a.png?v=1791894769", l: 600, h: 590 },
  { fichier: "jc-deco-gr-03-a.png", code: "GR-03", variante: "a", ambiance: "GR", nature: "vegetal", teintes: ["gris", "vert"], sujet: "olivier", url: "https://cdn.shopify.com/s/files/1/0360/3251/2135/files/jc-deco-gr-03-a.png?v=1791894768", l: 521, h: 600 },
  { fichier: "jc-deco-gr-04-a.png", code: "GR-04", variante: "a", ambiance: "GR", nature: "mineral", teintes: ["gris", "beton-pierre"], sujet: "molasse", url: "https://cdn.shopify.com/s/files/1/0360/3251/2135/files/jc-deco-gr-04-a.png?v=1791894769", l: 600, h: 552 },
  { fichier: "jc-deco-gr-05-a.png", code: "GR-05", variante: "a", ambiance: "GR", nature: "metal", teintes: ["inox-argent"], sujet: "inox brossé", url: "https://cdn.shopify.com/s/files/1/0360/3251/2135/files/jc-deco-gr-05-a.png?v=1791894769", l: 600, h: 581 },
  { fichier: "jc-deco-gr-06-a.png", code: "GR-06", variante: "a", ambiance: "GR", nature: "textile", teintes: ["gris"], sujet: "corde grise", url: "https://cdn.shopify.com/s/files/1/0360/3251/2135/files/jc-deco-gr-06-a.png?v=1791894769", l: 600, h: 498 },
  { fichier: "jc-deco-so-01-a.png", code: "SO-01", variante: "a", ambiance: "SO", nature: "mineral", teintes: ["anthracite"], sujet: "ardoise", url: "https://cdn.shopify.com/s/files/1/0360/3251/2135/files/jc-deco-so-01-a.png?v=1791894769", l: 600, h: 571 },
  { fichier: "jc-deco-so-02-a.png", code: "SO-02", variante: "a", ambiance: "SO", nature: "mineral", teintes: ["noir"], sujet: "galets basalte", url: "https://cdn.shopify.com/s/files/1/0360/3251/2135/files/jc-deco-so-02-a.png?v=1791894768", l: 600, h: 543 },
  { fichier: "jc-deco-so-03-a.png", code: "SO-03", variante: "a", ambiance: "SO", nature: "bois", teintes: ["noir"], sujet: "bois brûlé", url: "https://cdn.shopify.com/s/files/1/0360/3251/2135/files/jc-deco-so-03-a.png?v=1791894769", l: 600, h: 589 },
  { fichier: "jc-deco-so-04-a.png", code: "SO-04", variante: "a", ambiance: "SO", nature: "metal", teintes: ["anthracite"], sujet: "fer forgé", url: "https://cdn.shopify.com/s/files/1/0360/3251/2135/files/jc-deco-so-04-a.png?v=1791894768", l: 600, h: 563 },
  { fichier: "jc-deco-so-05-a.png", code: "SO-05", variante: "a", ambiance: "SO", nature: "mineral", teintes: ["anthracite"], sujet: "pierre de lave", url: "https://cdn.shopify.com/s/files/1/0360/3251/2135/files/jc-deco-so-05-a.png?v=1791894769", l: 577, h: 600 },
  { fichier: "jc-deco-so-06-a.png", code: "SO-06", variante: "a", ambiance: "SO", nature: "vegetal", teintes: ["anthracite", "brun"], sujet: "allium séché", url: "https://cdn.shopify.com/s/files/1/0360/3251/2135/files/jc-deco-so-06-a.png?v=1791894769", l: 555, h: 600 },
  { fichier: "jc-deco-bo-01-a.png", code: "BO-01", variante: "a", ambiance: "BO", nature: "bois", teintes: ["bois-naturel"], sujet: "teck huilé", url: "https://cdn.shopify.com/s/files/1/0360/3251/2135/files/jc-deco-bo-01-a.png?v=1791894769", l: 599, h: 600 },
  { fichier: "jc-deco-bo-02-a.png", code: "BO-02", variante: "a", ambiance: "BO", nature: "bois", teintes: ["brun"], sujet: "écorce de chêne", url: "https://cdn.shopify.com/s/files/1/0360/3251/2135/files/jc-deco-bo-02-a.png?v=1791894768", l: 600, h: 506 },
  { fichier: "jc-deco-bo-03-a.png", code: "BO-03", variante: "a", ambiance: "BO", nature: "bois", teintes: ["brun"], sujet: "cep de vigne", url: "https://cdn.shopify.com/s/files/1/0360/3251/2135/files/jc-deco-bo-03-a.png?v=1791894768", l: 600, h: 591 },
  { fichier: "jc-deco-bo-04-a.png", code: "BO-04", variante: "a", ambiance: "BO", nature: "textile", teintes: ["bois-naturel", "beige-sable"], sujet: "corde de jute", url: "https://cdn.shopify.com/s/files/1/0360/3251/2135/files/jc-deco-bo-04-a.png?v=1791894769", l: 596, h: 600 },
  { fichier: "jc-deco-bo-06-a.png", code: "BO-06", variante: "a", ambiance: "BO", nature: "bois", teintes: ["brun", "bois-naturel"], sujet: "liège", url: "https://cdn.shopify.com/s/files/1/0360/3251/2135/files/jc-deco-bo-06-a.png?v=1791894769", l: 600, h: 558 },
  { fichier: "jc-deco-bo-07-a.png", code: "BO-07", variante: "a", ambiance: "BO", nature: "mineral", teintes: ["brun"], sujet: "terre", url: "https://cdn.shopify.com/s/files/1/0360/3251/2135/files/jc-deco-bo-07-a.png?v=1791894769", l: 600, h: 590 },
  { fichier: "jc-deco-te-01-a.png", code: "TE-01", variante: "a", ambiance: "TE", nature: "mineral", teintes: ["orange"], sujet: "tessons terre cuite", url: "https://cdn.shopify.com/s/files/1/0360/3251/2135/files/jc-deco-te-01-a.png?v=1791894768", l: 582, h: 600 },
  { fichier: "jc-deco-te-02-a.png", code: "TE-02", variante: "a", ambiance: "TE", nature: "mineral", teintes: ["rouge", "brun"], sujet: "brique", url: "https://cdn.shopify.com/s/files/1/0360/3251/2135/files/jc-deco-te-02-a.png?v=1791894769", l: 600, h: 521 },
  { fichier: "jc-deco-te-02-b.png", code: "TE-02", variante: "b", ambiance: "TE", nature: "mineral", teintes: ["rouge", "brun"], sujet: "brique", url: "https://cdn.shopify.com/s/files/1/0360/3251/2135/files/jc-deco-te-02-b.png?v=1791894768", l: 411, h: 600 },
  { fichier: "jc-deco-te-03-a.png", code: "TE-03", variante: "a", ambiance: "TE", nature: "vegetal", teintes: ["rouge", "orange"], sujet: "feuilles de vigne d'automne", url: "https://cdn.shopify.com/s/files/1/0360/3251/2135/files/jc-deco-te-03-a.png?v=1791894768", l: 600, h: 578 },
  { fichier: "jc-deco-te-04-a.png", code: "TE-04", variante: "a", ambiance: "TE", nature: "mineral", teintes: ["jaune", "orange"], sujet: "ocre en poudre", url: "https://cdn.shopify.com/s/files/1/0360/3251/2135/files/jc-deco-te-04-a.png?v=1791894769", l: 600, h: 579 },
  { fichier: "jc-deco-te-05-a.png", code: "TE-05", variante: "a", ambiance: "TE", nature: "vegetal", teintes: ["jaune"], sujet: "mimosa", url: "https://cdn.shopify.com/s/files/1/0360/3251/2135/files/jc-deco-te-05-a.png?v=1791894770", l: 576, h: 600 },
  { fichier: "jc-deco-te-06-a.png", code: "TE-06", variante: "a", ambiance: "TE", nature: "mineral", teintes: ["rose"], sujet: "grès rose", url: "https://cdn.shopify.com/s/files/1/0360/3251/2135/files/jc-deco-te-06-a.png?v=1791894769", l: 582, h: 600 },
  { fichier: "jc-deco-te-06-b.png", code: "TE-06", variante: "b", ambiance: "TE", nature: "mineral", teintes: ["rose"], sujet: "grès rose", url: "https://cdn.shopify.com/s/files/1/0360/3251/2135/files/jc-deco-te-06-b.png?v=1791894769", l: 600, h: 588 },
  { fichier: "jc-deco-te-07-a.png", code: "TE-07", variante: "a", ambiance: "TE", nature: "vegetal", teintes: ["rose"], sujet: "pétales de rose", url: "https://cdn.shopify.com/s/files/1/0360/3251/2135/files/jc-deco-te-07-a.png?v=1791894768", l: 600, h: 593 },
  { fichier: "jc-deco-ve-01-a.png", code: "VE-01", variante: "a", ambiance: "VE", nature: "vegetal", teintes: ["vert"], sujet: "romarin", url: "https://cdn.shopify.com/s/files/1/0360/3251/2135/files/jc-deco-ve-01-a.png?v=1791894768", l: 600, h: 598 },
  { fichier: "jc-deco-ve-01-b.png", code: "VE-01", variante: "b", ambiance: "VE", nature: "vegetal", teintes: ["vert"], sujet: "romarin", url: "https://cdn.shopify.com/s/files/1/0360/3251/2135/files/jc-deco-ve-01-b.png?v=1791894767", l: 544, h: 600 },
  { fichier: "jc-deco-ve-02-a.png", code: "VE-02", variante: "a", ambiance: "VE", nature: "vegetal", teintes: ["vert"], sujet: "feuille de figuier", url: "https://cdn.shopify.com/s/files/1/0360/3251/2135/files/jc-deco-ve-02-a.png?v=1791894769", l: 597, h: 600 },
  { fichier: "jc-deco-ve-03-a.png", code: "VE-03", variante: "a", ambiance: "VE", nature: "vegetal", teintes: ["vert"], sujet: "buis", url: "https://cdn.shopify.com/s/files/1/0360/3251/2135/files/jc-deco-ve-03-a.png?v=1791894768", l: 564, h: 600 },
  { fichier: "jc-deco-ve-04-a.png", code: "VE-04", variante: "a", ambiance: "VE", nature: "mineral", teintes: ["vert", "gris"], sujet: "pierre moussue", url: "https://cdn.shopify.com/s/files/1/0360/3251/2135/files/jc-deco-ve-04-a.png?v=1791894769", l: 600, h: 527 },
  { fichier: "jc-deco-ve-05-a.png", code: "VE-05", variante: "a", ambiance: "VE", nature: "vegetal", teintes: ["vert"], sujet: "fougère", url: "https://cdn.shopify.com/s/files/1/0360/3251/2135/files/jc-deco-ve-05-a.png?v=1791894769", l: 590, h: 600 },
  { fichier: "jc-deco-ve-05-b.png", code: "VE-05", variante: "b", ambiance: "VE", nature: "vegetal", teintes: ["vert"], sujet: "fougère", url: "https://cdn.shopify.com/s/files/1/0360/3251/2135/files/jc-deco-ve-05-b.png?v=1791894769", l: 371, h: 600 },
  { fichier: "jc-deco-ve-06-a.png", code: "VE-06", variante: "a", ambiance: "VE", nature: "vegetal", teintes: ["vert", "bleu"], sujet: "eucalyptus", url: "https://cdn.shopify.com/s/files/1/0360/3251/2135/files/jc-deco-ve-06-a.png?v=1791894768", l: 600, h: 563 },
  { fichier: "jc-deco-ve-07-a.png", code: "VE-07", variante: "a", ambiance: "VE", nature: "vegetal", teintes: ["vert"], sujet: "tilleul en fleur", url: "https://cdn.shopify.com/s/files/1/0360/3251/2135/files/jc-deco-ve-07-a.png?v=1791894768", l: 593, h: 600 },
  { fichier: "jc-deco-ve-08-a.png", code: "VE-08", variante: "a", ambiance: "VE", nature: "vegetal", teintes: ["vert"], sujet: "cactus", url: "https://cdn.shopify.com/s/files/1/0360/3251/2135/files/jc-deco-ve-08-a.png?v=1791894767", l: 351, h: 600 },
  { fichier: "jc-deco-ve-09-a.png", code: "VE-09", variante: "a", ambiance: "VE", nature: "vegetal", teintes: ["vert", "gris"], sujet: "agave", url: "https://cdn.shopify.com/s/files/1/0360/3251/2135/files/jc-deco-ve-09-a.png?v=1791894768", l: 600, h: 600 },
  { fichier: "jc-deco-ve-10-a.png", code: "VE-10", variante: "a", ambiance: "VE", nature: "vegetal", teintes: ["vert"], sujet: "sapin", url: "https://cdn.shopify.com/s/files/1/0360/3251/2135/files/jc-deco-ve-10-a.png?v=1791894770", l: 595, h: 600 },
  { fichier: "jc-deco-ve-11-a.png", code: "VE-11", variante: "a", ambiance: "VE", nature: "vegetal", teintes: ["vert", "brun"], sujet: "bourgeon", url: "https://cdn.shopify.com/s/files/1/0360/3251/2135/files/jc-deco-ve-11-a.png?v=1791894767", l: 588, h: 600 },
  { fichier: "jc-deco-bl-01-a.png", code: "BL-01", variante: "a", ambiance: "BL", nature: "vegetal", teintes: ["violet"], sujet: "lavande", url: "https://cdn.shopify.com/s/files/1/0360/3251/2135/files/jc-deco-bl-01-a.png?v=1791894770", l: 592, h: 600 },
  { fichier: "jc-deco-bl-02-a.png", code: "BL-02", variante: "a", ambiance: "BL", nature: "vegetal", teintes: ["bleu"], sujet: "hortensia", url: "https://cdn.shopify.com/s/files/1/0360/3251/2135/files/jc-deco-bl-02-a.png?v=1791894770", l: 600, h: 553 },
  { fichier: "jc-deco-bl-03-a.png", code: "BL-03", variante: "a", ambiance: "BL", nature: "mineral", teintes: ["bleu"], sujet: "verre de mer", url: "https://cdn.shopify.com/s/files/1/0360/3251/2135/files/jc-deco-bl-03-a.png?v=1791894768", l: 600, h: 585 },
  { fichier: "jc-deco-bl-04-a.png", code: "BL-04", variante: "a", ambiance: "BL", nature: "ceramique", teintes: ["bleu"], sujet: "tesson céramique bleue", url: "https://cdn.shopify.com/s/files/1/0360/3251/2135/files/jc-deco-bl-04-a.png?v=1791894769", l: 590, h: 600 },
  { fichier: "jc-deco-bl-05-a.png", code: "BL-05", variante: "a", ambiance: "BL", nature: "vegetal", teintes: ["bleu", "violet"], sujet: "agapanthe", url: "https://cdn.shopify.com/s/files/1/0360/3251/2135/files/jc-deco-bl-05-a.png?v=1791894769", l: 600, h: 588 },
  { fichier: "jc-deco-bl-06-a.png", code: "BL-06", variante: "a", ambiance: "BL", nature: "mineral", teintes: ["bleu", "gris"], sujet: "galet ardoise bleu", url: "https://cdn.shopify.com/s/files/1/0360/3251/2135/files/jc-deco-bl-06-a.png?v=1791894769", l: 600, h: 596 },
];

// ─── Teinte → ambiance ──────────────────────────────────────────────────────
// Les 17 teintes de matieres.teinte_filtre, rangées dans les 7 ambiances de la
// banque. « multicolore-motif » n'a pas d'ambiance : elle est ignorée.
export const AMBIANCE_DE_TEINTE: Record<string, AmbianceDecor> = {
  "blanc": "CL", "beige-sable": "CL",
  "gris": "GR", "beton-pierre": "GR", "inox-argent": "GR",
  "anthracite": "SO", "noir": "SO",
  "brun": "BO", "bois-naturel": "BO",
  "orange": "TE", "rouge": "TE", "jaune": "TE", "rose": "TE",
  "vert": "VE",
  "bleu": "BL", "violet": "BL",
};

// Teintes « colorées », seules candidates à l'accent.
const TEINTES_COLOREES = new Set(["vert", "bleu", "rouge", "orange", "jaune", "rose", "violet"]);

const PART_SECONDE = 0.15;
const PART_ACCENT = 0.10;

// ─── « Ne jamais reprendre la matière déjà sur la planche » ────────────────
// Sans rapprochement par nom (règle du chantier) : par FAMILLE de la planche.
// Volontairement large — une offre en teck perd tous les objets en bois, pas
// seulement le teck.
const EXCLUSIONS_PAR_FAMILLE: Record<string, { natures?: NatureDecor[]; codes?: string[] }> = {
  bois: { natures: ["bois"] },
  corde: { codes: ["GR-06", "BO-04"] },                    // corde grise, jute
  tissu: { codes: ["CL-03"] },                             // lin
  toile: { codes: ["CL-03"] },
  ceramique: { codes: ["BL-04"] },                         // tesson céramique
  pierre: { codes: ["GR-01", "GR-04", "CL-06", "SO-01"] }, // béton, molasse, travertin, ardoise
};

export type CouleurOffre = {
  scores: { teinte: string; part: number }[];   // trié, part de 0 à 1
  dominante: string | null;
  seconde: string | null;
  accent: string | null;
};

// Couleur de l'offre : le poids CHF de chaque finition se répartit entre ses
// teintes — 2 parts pour la principale (la première), 1 pour chacune des
// autres. multicolore-motif est ignorée (si elle est en tête, la suivante
// devient la principale).
export function couleurOffre(matieres: MatiereMoodboard[]): CouleurOffre {
  const s = new Map<string, number>();
  for (const m of matieres) {
    const teintes = (m.teinte_filtre ?? []).filter((t) => t in AMBIANCE_DE_TEINTE);
    if (teintes.length === 0 || !(m.poids > 0)) continue;
    const parts = teintes.map((_, i) => (i === 0 ? 2 : 1));
    const total = parts.reduce((a, b) => a + b, 0);
    teintes.forEach((t, i) => s.set(t, (s.get(t) ?? 0) + (m.poids * parts[i]) / total));
  }
  const somme = Array.from(s.values()).reduce((a, b) => a + b, 0);
  const scores = Array.from(s.entries())
    .map(([teinte, v]) => ({ teinte, part: somme > 0 ? v / somme : 0 }))
    .sort((a, b) => b.part - a.part || a.teinte.localeCompare(b.teinte));
  const dominante = scores[0]?.teinte ?? null;
  const ambDom = dominante ? AMBIANCE_DE_TEINTE[dominante] : null;
  const seconde = scores.find((x) => AMBIANCE_DE_TEINTE[x.teinte] !== ambDom && x.part >= PART_SECONDE)?.teinte ?? null;
  const ambSec = seconde ? AMBIANCE_DE_TEINTE[seconde] : null;
  const accent = scores.find((x) =>
    TEINTES_COLOREES.has(x.teinte) && x.part >= PART_ACCENT &&
    AMBIANCE_DE_TEINTE[x.teinte] !== ambDom && AMBIANCE_DE_TEINTE[x.teinte] !== ambSec
  )?.teinte ?? null;
  return { scores, dominante, seconde, accent };
}

// Hash FNV-1a 32 bits : stable entre navigateur et serveur, sans dépendance.
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

// Parmi les candidats : d'abord ceux dont la teinte visée est la PRINCIPALE
// (une brique « rouge, brun » ne doit pas passer avant une terre « brun »),
// puis ceux qui la portent, puis les autres. Tirage déterministe par la graine
// (et un sel par place, pour que les trois places ne tirent pas le même rang).
function tirer(candidats: ObjetDecor[], teinte: string | null, graine: string, sel: string): ObjetDecor | null {
  if (candidats.length === 0) return null;
  const principaux = teinte ? candidats.filter((o) => o.teintes[0] === teinte) : [];
  const porteurs = teinte ? candidats.filter((o) => o.teintes.includes(teinte)) : [];
  const choix = principaux.length > 0 ? principaux : porteurs.length > 0 ? porteurs : candidats;
  const pool = choix.slice().sort((a, b) => a.fichier.localeCompare(b.fichier));
  return pool[hash(`${graine}|${sel}`) % pool.length];
}

// Choix du décor : 0, 2 ou 3 objets.
//   1. un MINÉRAL de l'ambiance dominante, ou portant la teinte dominante ;
//   2. un VÉGÉTAL de l'ambiance dominante, ou portant la teinte dominante
//      (les bruns n'ont aucun végétal dans leur ambiance : l'allium séché et
//      le bourgeon, classés ailleurs, portent du brun) ;
//   3. une image de la seconde, sinon de l'accent, sinon de la teinte suivante
//      d'une autre ambiance (même sous 15 %), d'une nature différente des deux
//      premières quand l'ambiance le permet.
// Si l'ambiance dominante n'a pas de minéral (ou de végétal) disponible, on
// prend une autre nature de la même ambiance.
export function choisirDecor(matieres: MatiereMoodboard[]): ObjetDecor[] {
  const c = couleurOffre(matieres);
  if (!c.dominante) return [];
  const ambDom = AMBIANCE_DE_TEINTE[c.dominante];

  // Exclusions par famille présente sur la planche
  const familles = new Set(matieres.map((m) => (m.famille || "").toLowerCase()));
  const natExclues = new Set<string>();
  const codesExclus = new Set<string>();
  for (const f of familles) {
    const e = EXCLUSIONS_PAR_FAMILLE[f];
    e?.natures?.forEach((n) => natExclues.add(n));
    e?.codes?.forEach((k) => codesExclus.add(k));
  }
  const dispo = BANQUE_DECOR.filter((o) => !natExclues.has(o.nature) && !codesExclus.has(o.code));

  // Graine : les finitions de la planche, triées — pas le slug (voir en-tête).
  const graine = matieres.map((m) => m.cle).sort().join(",");

  const choisis: ObjetDecor[] = [];
  const libre = (o: ObjetDecor) => !choisis.some((x) => x.code === o.code);

  const dom = c.dominante;
  const deDom = dispo.filter((o) => o.ambiance === ambDom || o.teintes.includes(dom));
  const p1 = tirer(deDom.filter((o) => o.nature === "mineral"), dom, graine, "1")
    ?? tirer(deDom.filter((o) => o.nature !== "vegetal"), dom, graine, "1");
  if (p1) choisis.push(p1);
  const p2 = tirer(deDom.filter((o) => o.nature === "vegetal" && libre(o)), dom, graine, "2")
    ?? tirer(deDom.filter((o) => libre(o) && o.nature !== p1?.nature), dom, graine, "2");
  if (p2) choisis.push(p2);
  if (choisis.length < 2) return [];

  // Sans autre teinte (planche d'une seule couleur), le 3e objet reprend la
  // dominante : trois objets valent mieux que deux, même ton sur ton.
  const troisieme = c.seconde ?? c.accent
    ?? c.scores.find((x) => AMBIANCE_DE_TEINTE[x.teinte] !== ambDom)?.teinte ?? dom;
  if (troisieme) {
    const amb = troisieme === dom ? ambDom : AMBIANCE_DE_TEINTE[troisieme];
    const natures = new Set(choisis.map((o) => o.nature));
    // D'une autre nature que les deux premiers si l'ambiance en a une ; sinon
    // (ex. les verts : que du végétal et un minéral), la même nature plutôt
    // que rien — la couleur de la seconde compte plus que la nature.
    const pool = dispo.filter((o) => o.ambiance === amb && libre(o));
    const p3 = tirer(pool.filter((o) => !natures.has(o.nature)), troisieme, graine, "3")
      ?? tirer(pool, troisieme, graine, "3");
    if (p3) choisis.push(p3);
  }
  return choisis;
}

// Image du décor : PNG transparent, à la largeur demandée. JAMAIS urlCdn().
export function urlDecor(o: ObjetDecor, largeur = 300): string {
  return `${o.url}${o.url.includes("?") ? "&" : "?"}width=${largeur}&format=png`;
}
