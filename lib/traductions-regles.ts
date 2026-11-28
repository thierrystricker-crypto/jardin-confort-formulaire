// lib/traductions-regles.ts
// ─────────────────────────────────────────────────────────────────────────────
// Sentinelle traductions DE / EN du webshop (28.11.2026) — RÈGLES FIXES.
//
// Fonctions pures, sans accès réseau : on leur donne le texte français (qui
// fait foi) et la traduction écrite par l'app T Lab, elles renvoient les
// anomalies trouvées. Chaque règle vient d'un défaut réellement observé dans
// l'audit de novembre 2026 (doc « audit-traductions-de-en » du Projet SEO).
//
// Pour ajouter une règle : un nouveau bloc dans `appliquerRegles`, avec un nom
// de règle court et stable (il sert de clé de dédoublonnage en base).
//
// `auto_corrigeable` = la correction est mécanique et sûre (ß → ss, Sthul →
// Stuhl…). Phase 1 = rapport seul : rien n'est écrit dans Shopify.
// ─────────────────────────────────────────────────────────────────────────────

export type Langue = "de" | "en";
export type Champ = "title" | "body_html" | "meta_title" | "meta_description";
export const CHAMPS: Champ[] = ["title", "body_html", "meta_title", "meta_description"];

export type Anomalie = {
  langue: Langue;
  champ: Champ;
  regle: string;
  source: "regle" | "claude";
  extrait: string;
  correction_proposee: string | null;
  auto_corrigeable: boolean;
};

export type EntreeRegles = {
  langue: Langue;
  champ: Champ;
  fr: string;       // valeur française brute (HTML pour body_html)
  traduit: string;  // valeur traduite brute
  marque: string | null;
};

/** HTML → texte simple (pour les recherches et les extraits). */
export function texteBrut(html: string): string {
  return (html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extraitAutour(texte: string, index: number, longueur: number): string {
  const debut = Math.max(0, index - 40);
  const fin = Math.min(texte.length, index + longueur + 40);
  return (debut > 0 ? "…" : "") + texte.slice(debut, fin) + (fin < texte.length ? "…" : "");
}

// ── Remplacements sûrs (mot faux connu → mot juste) ──
const REMPLACEMENTS_SURS: Array<{ langue: Langue; re: RegExp; par: string; regle: string }> = [
  { langue: "de", re: /\bSthul/g, par: "Stuhl", regle: "sthul" },
  { langue: "de", re: /Bodenhülsel/g, par: "Bodenhülse", regle: "bodenhuelsel" },
  { langue: "en", re: /\bKeramik\b/g, par: "ceramic", regle: "keramik_en" },
];

// ── Mots français courants que T Lab a recopiés tels quels ──
// (protégés par erreur dans la liste « ne pas traduire »)
const MOTS_FRANCAIS: Array<{ re: RegExp; de: string; en: string }> = [
  { re: /\blien\b/, de: "Verbindung", en: "link" },
  { re: /\b[Cc]hiné/, de: "meliert", en: "melange" },
  { re: /\bNaturel\b/, de: "natur", en: "natural" },
  { re: /\bLin\b/, de: "Leinen", en: "linen" },
  { re: /\bRotin\b/, de: "Rattan", en: "rattan" },
  { re: /\bplein air\b/, de: "im Freien", en: "outdoors" },
];

// Mots-outils français : leur présence répétée dans une traduction = phrase
// restée en français. « des » et « les » exclus (génitif allemand, Les Jardins).
const MOTS_OUTILS_FR = /\b(avec|pour|dans|votre|vous|cette|sont|une|aussi|très|grâce|également)\b/g;

// Mots collés légitimes (noms déposés en CamelCase).
const CAMEL_LEGITIMES = new Set([
  "AirTouch", "HighLine", "LightBoxes", "AeroCovers", "MiniGarages", "BeComfort",
  "QuickDry", "StoreMax", "SmartBase", "StyleBox", "AvantGarde", "BikeMax",
  "BikeHolder", "FloraBoard", "FreizeitBox", "LotusGrill", "PowerFlame",
  "PoweFlame", "LaSiesta", "TreeMount", "ReClips", "AirComfort", "DeLuxe",
  "YouTube", "WhatsApp", "PayPal", "TWINT", "FatBoy",
]);

// Doublons légitimes (pronoms allemands, vrais noms).
const DOUBLONS_LEGITIMES = new Set(["sie", "die", "das", "der", "hori", "tam"]);

// Mots qui trahissent un titre resté en français.
const TITRE_FRANCAIS = /\b(chaise|fauteuil|coussin|housse|tabouret|lampe|pied|toile|plateau|rallonge|transat|desserte|jardinière|banc|guéridon|lanterne)\b/i;

export function appliquerRegles(e: EntreeRegles): Anomalie[] {
  const out: Anomalie[] = [];
  const { langue, champ, marque } = e;
  const brut = e.traduit || "";
  const texte = champ === "body_html" ? texteBrut(brut) : brut.trim();
  const fr = champ === "body_html" ? texteBrut(e.fr || "") : (e.fr || "").trim();
  if (!texte) return out;

  const ajouter = (regle: string, idx: number, len: number, correction: string | null, auto: boolean) =>
    out.push({
      langue, champ, regle, source: "regle",
      extrait: extraitAutour(texte, Math.max(0, idx), len),
      correction_proposee: correction, auto_corrigeable: auto,
    });

  // 1. ß interdit (allemand de Suisse : toujours ss)
  if (langue === "de") {
    const n = (texte.match(/ß/g) || []).length;
    if (n > 0) ajouter("eszett", texte.indexOf("ß"), 1, `Remplacer ß par ss (${n} fois)`, true);
  }

  // 2. Remplacements sûrs
  for (const r of REMPLACEMENTS_SURS) {
    if (r.langue !== langue) continue;
    r.re.lastIndex = 0;
    const m = r.re.exec(texte);
    if (m) ajouter(r.regle, m.index, m[0].length, `« ${m[0]} » → « ${r.par} »`, true);
  }

  // 3. Pouf traduit en sac (seuls les poufs-sacs Fatboy en sont)
  const estFatboy = (marque || "").toLowerCase() === "fatboy";
  const frParleDeSac = /\bsac\b|pouf[- ]sac|bean ?bag|lamzac|sitzsack/i.test(fr);
  if (!estFatboy && !frParleDeSac) {
    const re = langue === "de" ? /Sitzs[äa]ck\w*/ : /\bbean ?bags?\b/i;
    const m = re.exec(texte);
    if (m) ajouter("pouf_sitzsack", m.index, m[0].length,
      langue === "de" ? `« ${m[0]} » → « Pouf »` : `« ${m[0]} » → « pouf »`, false);
  }

  // 4. Mots français recopiés tels quels
  for (const mot of MOTS_FRANCAIS) {
    const m = mot.re.exec(texte);
    if (m) ajouter("mot_francais", m.index, m[0].length,
      `« ${m[0]} » → « ${langue === "de" ? mot.de : mot.en} » (si ce n'est pas un nom de modèle)`, false);
  }

  // 5. Phrase entière restée en français
  if (champ === "body_html" || champ === "meta_description") {
    const sansMarque = texte.replace(/Les Jardins/g, "");
    const occ = Array.from(sansMarque.matchAll(MOTS_OUTILS_FR));
    if (occ.length >= 3) {
      const premier = texte.search(MOTS_OUTILS_FR);
      ajouter("texte_francais", premier, occ[0][0].length, "Passage resté en français : à retraduire", false);
    }
  }

  // 6. Mots collés (« SunbrellaHauptmaterial ») absents du français
  {
    const colles: string[] = [];
    let premierIdx = -1;
    for (const m of texte.matchAll(/[A-ZÄÖÜ]?[a-zäöüß]{2,}[A-ZÄÖÜ][a-zäöüß]{2,}\w*/g)) {
      const mot = m[0];
      if (CAMEL_LEGITIMES.has(mot) || fr.includes(mot) || /^Mc[A-Z]/.test(mot)) continue;
      if (premierIdx < 0) premierIdx = m.index ?? 0;
      if (colles.length < 3) colles.push(mot);
    }
    if (colles.length) ajouter("mots_colles", premierIdx, colles[0].length,
      `Séparer : ${colles.join(", ")}`, false);
  }

  // 7. Mots doublés (« Set Set », « Lounge Lounge ») absents du français
  {
    const doubles: string[] = [];
    let premierIdx = -1;
    for (const m of texte.matchAll(/(^|[^A-Za-zÀ-ÖØ-öø-ÿ])([A-Za-zÀ-ÖØ-öø-ÿ]{3,})\s+\2(?![A-Za-zÀ-ÖØ-öø-ÿ])/gi)) {
      const doublon = m[0].slice(m[1].length);
      if (DOUBLONS_LEGITIMES.has(m[2].toLowerCase())) continue;
      if (fr.toLowerCase().includes(doublon.toLowerCase())) continue;
      if (premierIdx < 0) premierIdx = (m.index ?? 0) + m[1].length;
      if (doubles.length < 3) doubles.push(doublon);
    }
    if (doubles.length) ajouter("mots_doubles", premierIdx, doubles[0].length,
      `Retirer le doublon : ${doubles.join(", ")}`, false);
  }

  // 8. Titres
  if (champ === "title" || champ === "meta_title") {
    const m = marque?.trim();
    if (m && fr.toLowerCase().includes(m.toLowerCase()) && !texte.toLowerCase().includes(m.toLowerCase())) {
      ajouter("marque_perdue", 0, texte.length, `La marque « ${m} » a disparu du titre`, false);
    }
    if (/^(Kollektion von|Collection by)\b/.test(texte)) {
      ajouter("nom_collection_perdu", 0, texte.length, "Le nom de la collection a disparu (format « Kollektion <Nom> von <Marque> »)", false);
    }
    if (m && texte.toLowerCase() === m.toLowerCase() && fr.length > m.length + 2) {
      ajouter("titre_reduit_marque", 0, texte.length, `Titre réduit à la marque (FR : « ${fr} »)`, false);
    }
    // « Lampe » est aussi de l'allemand ; « Chaise Unit » / « chaise longue » de l'anglais.
    const frTeste = fr.replace(/chaise (unit|longue)/gi, "").replace(langue === "de" ? /\blampe\b/gi : /$^/, "");
    if (texte === fr && TITRE_FRANCAIS.test(frTeste)) {
      ajouter("titre_non_traduit", 0, texte.length, "Titre identique au français : à traduire", false);
    }
  }
  if (champ === "meta_title" && texte.length > 70) {
    ajouter("meta_titre_long", 60, 10, `Meta titre de ${texte.length} caractères (Google coupe vers 60–70)`, false);
  }

  // 9. Bloc CSS collé dans la description
  if (champ === "body_html" && /<style/i.test(brut)) {
    out.push({
      langue, champ, regle: "bloc_css", source: "regle",
      extrait: brut.slice(brut.search(/<style/i), brut.search(/<style/i) + 100) + "…",
      correction_proposee: "Bloc <style> dans la description : à retirer du FR (T Lab retraduit ensuite)",
      auto_corrigeable: false,
    });
  }

  return out;
}
