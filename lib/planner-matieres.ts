// lib/planner-matieres.ts
// Bibliothèque TEXTE de matières et de couleurs pour l'ambiance IA du planner
// (22.09.2026). Remplace l'envoi de photos catalogue : les photos d'ambiance
// Shopify montrent souvent d'autres produits (repose-pieds, table basse…) et
// gpt-image les « empruntait ». Ici on décrit chaque article du plan en mots
// — marque → matière, coloris → nom + hex + finition — et l'IA ne voit que la
// capture 3D. Nuancier Fermob : charte métal 2025-26 (couleurs-fermob-2025-26.md).

export type Couleur = { code: string; nom: string; hex: string; finition: string };

// Nuancier métal Fermob 2025-26 — la clé est le code à 2 caractères en fin de
// valeur d'option (« Cactus 82 », « Stéréo Carbone 47ST », « Tressage Cactus 82PE »).
export const COULEURS_FERMOB: Couleur[] = [
  { code: "01", nom: "Blanc coton", hex: "#FFFEF6", finition: "texturé mat" },
  { code: "A5", nom: "Gris argile", hex: "#D1CCBE", finition: "texturé mat" },
  { code: "26", nom: "Gris orage", hex: "#657271", finition: "texturé pailleté" },
  { code: "47", nom: "Carbone", hex: "#3F4241", finition: "texturé pailleté" },
  { code: "42", nom: "Réglisse", hex: "#2B2B2C", finition: "texturé mat" },
  { code: "48", nom: "Romarin", hex: "#61635B", finition: "texturé mat" },
  { code: "82", nom: "Cactus", hex: "#778565", finition: "texturé mat" },
  { code: "65", nom: "Vert tilleul", hex: "#A4A57E", finition: "texturé pailleté" },
  { code: "D3", nom: "Pesto", hex: "#5E5E31", finition: "texturé mat" },
  { code: "02", nom: "Vert cèdre", hex: "#2A5644", finition: "texturé mat" },
  { code: "92", nom: "Bleu abysse", hex: "#0C1B31", finition: "texturé mat" },
  { code: "21", nom: "Bleu acapulco", hex: "#174955", finition: "texturé mat" },
  { code: "E1", nom: "Bleu maya", hex: "#88B6D1", finition: "texturé mat" },
  { code: "D1", nom: "Guimauve", hex: "#CECAE6", finition: "texturé mat" },
  { code: "A7", nom: "Menthe glaciale", hex: "#E3F1E8", finition: "texturé mat" },
  { code: "A6", nom: "Citron givré", hex: "#FFF7AD", finition: "texturé mat" },
  { code: "C6", nom: "Miel", hex: "#E8AF03", finition: "texturé mat" },
  { code: "73", nom: "Miel", hex: "#E8AF03", finition: "lisse" },
  { code: "D2", nom: "Pain d'épices", hex: "#986F31", finition: "texturé mat" },
  { code: "14", nom: "Muscade", hex: "#B4A28F", finition: "texturé pailleté" },
  { code: "E8", nom: "Beige latte", hex: "#F0E3CC", finition: "texturé mat" },
  { code: "E3", nom: "Tonka", hex: "#4B443D", finition: "texturé mat" },
  { code: "B9", nom: "Cerise noire", hex: "#541827", finition: "texturé mat" },
  { code: "43", nom: "Piment", hex: "#932426", finition: "texturé mat" },
  { code: "20", nom: "Ocre rouge", hex: "#7F3D31", finition: "texturé mat" },
  { code: "E2", nom: "Orange confite", hex: "#9C4B1C", finition: "texturé mat" },
];
// Coloris de coussins Fermob (option combinée « Cactus 82 / Perle D4 ») : à
// ignorer pour la structure.
const COUSSINS_FERMOB = new Set(["D4", "81", "79", "A3", "B8"]);

// Matière type par marque : ce que l'IA doit rendre, en mots simples.
const MATIERES_MARQUE: { test: RegExp; matiere: string }[] = [
  { test: /fermob/i, matiere: "acier ou aluminium laqué, structure tubulaire fine, assise et dossier en lattes ou en tôle ajourée, aucun coussin ni accessoire sauf s'ils sont visibles dans l'image" },
  { test: /dedon/i, matiere: "fibre synthétique tressée Dedon (tressage fin et régulier), piètement teck ou aluminium, coussins tissu épais capitonnés tels que visibles" },
  { test: /gloster|barlow|tyrie|manutti|royal botania|tribu/i, matiere: "teck massif huilé ou aluminium thermolaqué, lignes épurées, coussins tissu outdoor tels que visibles" },
  { test: /cane-?line/i, matiere: "aluminium thermolaqué ou fibre tressée Cane-line, coussins tissu tels que visibles" },
  { test: /fatboy/i, matiere: "textile technique souple, forme molle et arrondie" },
  { test: /glatz|umbrosa/i, matiere: "parasol : toile tendue unie, mât et baleines aluminium" },
  { test: /vincent sheppard/i, matiere: "rotin Lloyd Loom tressé ou cordage, piètement aluminium" },
  { test: /schaffner|les jardins|lafuma/i, matiere: "acier ou aluminium laqué, textile tendu ou lattes" },
];

function couleurFermob(valeurs: string[]): Couleur | null {
  for (const v of valeurs) {
    const m = /([0-9A-Z]{2})(?:ST|EA|EB|EC|EE|PA|PB|PE|HA|HD|HE)?\s*$/i.exec(String(v).trim());
    if (!m) continue;
    const code = m[1].toUpperCase();
    if (COUSSINS_FERMOB.has(code)) continue;
    const c = COULEURS_FERMOB.find((x) => x.code === code);
    if (c) return c;
  }
  return null;
}

// Coloris du nuancier cité dans la description d'ambiance du conseiller
// (« meubles en romarin », « tout en Bleu acapulco ») → coloris IMPOSÉ pour les
// structures Fermob. Comparaison sans accents ni casse, nom complet.
const sansAccents = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
export function couleurDemandee(description: string): Couleur | null {
  const d = sansAccents(description);
  // les noms les plus longs d'abord (« vert cedre » avant « cedre »…)
  const tri = [...COULEURS_FERMOB].filter((c) => c.code !== "73").sort((a, b) => b.nom.length - a.nom.length);
  return tri.find((c) => new RegExp(`\\b${sansAccents(c.nom).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(d)) || null;
}

// Description d'un article pour le prompt : « Fermob Luxembourg banc 2 places
// — acier laqué…, coloris Cactus 82 (#778565, texturé mat) ».
export function decrireArticle(a: { titre: string; marque?: string | null; options?: Record<string, string> | null; sku?: string | null }, imposee?: Couleur | null, dejaApplique = false): string {
  const marque = a.marque || "";
  const mat = MATIERES_MARQUE.find((m) => m.test.test(marque))?.matiere;
  const valeurs = Object.values(a.options || {});
  const parts: string[] = [];
  if (mat) parts.push(mat);
  if (/fermob/i.test(marque) && imposee && dejaApplique) {
    parts.push(`coloris ${imposee.nom} ${imposee.code} (${imposee.hex}, finition ${imposee.finition}), déjà visible dans l'image — à conserver tel quel`);
  } else if (/fermob/i.test(marque) && imposee) {
    parts.push(`coloris IMPOSÉ par le conseiller : ${imposee.nom} ${imposee.code} (${imposee.hex}, finition ${imposee.finition}) — repeindre toute la structure dans cette teinte, forme et détails inchangés`);
  } else if (/fermob/i.test(marque)) {
    const c = couleurFermob([...valeurs, a.sku || ""]);
    if (c) parts.push(`coloris ${c.nom} ${c.code} (${c.hex}, finition ${c.finition}) sur toute la structure`);
    else parts.push("coloris uni tel que visible dans l'image, finition texturée mate");
  } else if (/dedon/i.test(marque) && valeurs.length) {
    parts.push(`coloris ${valeurs.join(" / ")} (voir l'échantillon de fibre s'il est fourni)`);
  } else if (valeurs.length) {
    parts.push(`variante : ${valeurs.join(" / ")}`);
  }
  return `${a.titre}${parts.length ? ` — ${parts.join(", ")}` : ""}`;
}
