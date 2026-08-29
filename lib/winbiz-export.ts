// lib/winbiz-export.ts
// ─────────────────────────────────────────────────────────────────────────────
// Chantier « Export Winbiz » — module PUR de génération du fichier bizexdoc.
// Aucune E/S, aucun appel réseau, aucun accès base : tout est paramètre.
//
// RÈGLE D'OR (cadrage §3) : ne jamais recompter les colonnes à l'œil.
// Les gabarits ci-dessous sont les LIGNES RÉELLES du fichier de référence
// bizexdoc_facture_winbiz_54063…7613.csv (18.04.2026, importé avec succès
// dans WinBiz), recopiées telles quelles ; les champs variables sont
// substitués PAR INDEX après un split(';'). Relevé du 29.08.2026 :
//   - préfixe commun = champs 1 à 47 ; champ 20 = code client,
//     champs 22–28 = adresse, champ 47 = « mise à jour adresse » (= 1 :
//     ne JAMAIS modifier une fiche existante — le défaut 0 ÉCRASE la fiche,
//     c'est le mécanisme du bug historique « fiche 999 renommée »)
//   - suffixe : champ 48 = n° de ligne, champ 49 = type (1 article, 2 texte,
//     3 sous-total), champ 51 = description, champ 52 = date, champ 53 = qté,
//     champ 54 = prix, champ 56 = remise de ligne (toujours 0, T2 non validé),
//     champ 61 = taux TVA 8.10, champ 62 = TVA incluse (1 = TTC, 2 = HT —
//     précision Thierry 29.08), champ 68 = <VAT_FIGURE=300>,
//     sous-total : champ 104 = 0
//   - fins de ligne LF, fichier terminé par une ligne vide (relevé sur pièce ;
//     le cadrage v2 supposait CRLF — les fichiers réellement importés sont LF)
//   - encodage : cp1252 visé (doc officielle) ; l'UTF-8 est aussi produit
//     pour le test T1.
//
// L'export ne modifie JAMAIS la commande, ne crée ni ne modifie JAMAIS une
// adresse Winbiz (code existant ou 999, champ 47 = 1), et n'émet JAMAIS de
// ligne d'équilibrage : si la somme des lignes ne tombe pas au centime sur
// le total recalculé, il n'y a PAS de fichier.
// ─────────────────────────────────────────────────────────────────────────────

import { computeTotals, serviceOptions, type PrintData, type QuoteLine } from "./jc-print-types";

// ── Gabarits de référence (fichier 54063 du 18.04.2026, VALIDÉ à l'import) ──
// Ne pas reformater ces chaînes : chaque point-virgule est une position.

const REF_ENTETE =
  "54063;20;18.04.2026;;;1974;CHF;;;;<AUTO>;MG;F;;;;;;;999;;";

const REF_PREFIXE =
  "54063;20;18.04.2026;;;1974;CHF;;;;<AUTO>;<AUTO>;F;;;;;;;999;;\"Société SA\";\"Nom\";\"Prenom\";\"Rue\";;\"Npa\";\"Ville\";;;F;;;;;;;;1;18.04.2026;;;;;Monsieur;;1";

const REF_SUFFIXE_ADRESSE =
  ";1;2;;COORD;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;";

const REF_SUFFIXE_TITRE =
  ";3;2;;FERMOB 2026; 18.04.2026;;;;;;;;3000;8.10;1;2200;2;;;;<VAT_FIGURE=300>;;;;;;;;;;;;;;;;;;;;;;;";

const REF_SUFFIXE_ARTICLE =
  ";4;1;;DESC;18.04.2026;1;129;Pce;0;;;;3000;8.10;1;2200;2;;;;<VAT_FIGURE=300>;;;;1;;0;Article;Article;;;;;;;100;0;;0;;;;0;0;0;;0;;;;0;";

const REF_SUFFIXE_SOUS_TOTAL =
  ";100;3;;Sous-total;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;0;;;;;;;;;;;;;;;;;;;;;;;;;";

// Index (0-based) des champs variables — DANS LE PRÉFIXE (47 champs)
const IDX_NUMERO = 0;        // champ 1
const IDX_DATE = 2;          // champ 3
const IDX_TOTAL = 5;         // champ 6
const IDX_VENDEUR = 11;      // champ 12 (ligne d'en-tête uniquement)
const IDX_CODE_CLIENT = 19;  // champ 20
const IDX_ADR_SOCIETE = 21;  // champ 22  ┐
const IDX_ADR_NOM = 22;      // champ 23  │ champs d'adresse 22–28 :
const IDX_ADR_PRENOM = 23;   // champ 24  │ données réelles UNIQUEMENT quand
const IDX_ADR_RUE = 24;      // champ 25  │ le client est attribué ; les
const IDX_ADR_VIDE = 25;     // champ 26  │ placeholders neutres en repli 999
const IDX_ADR_NPA = 26;      // champ 27  │
const IDX_ADR_VILLE = 27;    // champ 28  ┘
const IDX_DATE_2 = 39;       // champ 40 : seconde date du préfixe (champ 39 = constante "1")
const IDX_MAJ_ADRESSE = 46;  // champ 47 — TOUJOURS "1"

// Index des champs variables — DANS LES SUFFIXES (0-based, relatifs au suffixe
// qui commence par un ';' : suffixe.split(';')[0] === '')
const SFX_NUM = 1;           // champ 48
const SFX_TYPE = 2;          // champ 49
const SFX_DESC = 4;          // champ 51
const SFX_DATE = 5;          // champ 52
const SFX_QTE = 6;           // champ 53
const SFX_PRIX = 7;          // champ 54
const SFX_TVA_INCLUSE = 15;  // champ 62 : 1 = TTC incluse, 2 = HT exclue

// ── Vendeurs : nom complet → initiales Winbiz ──
// Table héritée du flux Make + arbitrage Thierry 29.08 (Brice → BC).
// Inconnu → <AUTO> + warning, jamais en silence.
const VENDEURS: Record<string, string> = {
  "michel gedeon": "MG",
  "michel": "MG",
  "thierry stricker": "TS",
  "thierry": "TS",
  "sabrina striberni": "SS",
  "sabrina": "SS",
  "fabian coquoz": "FC",
  "fabian": "FC",
  "alejandro": "AG",
  "brice chappe": "BC",
  "brice": "BC",
};

// ── Types ──

export type WinbizAttribution =
  | { type: "code"; code: string; source: string; libelle: string }
  | { type: "repli"; raison: string };

export type WinbizCommandeInput = {
  /** numero_commande de la table offres, p.ex. "CMD-80695" */
  numeroCommande: string;
  /** date du document, ISO (offres.date_document ou data.date) */
  dateDocument: string;
  /** offres.total_ttc — contrôle croisé bloquant avec le recalcul */
  totalTtcColonne: number | null;
  /** offres.data — source de vérité */
  data: PrintData;
};

export type WinbizOk = {
  ok: true;
  filename: string;
  /** contenu en UTF-8 (test T1) */
  contentUtf8: string;
  /** contenu en cp1252 (cible, doc officielle) */
  contentCp1252: Uint8Array;
  warnings: string[];
  numeroWinbiz: string;
  clientCode: string;
  /** total du document tel qu'émis au champ 6, en CHF */
  montant: number;
  /** true si document Pro HT (champ 62 = 2) — premier export réel conditionné à T9 */
  proHt: boolean;
};

export type WinbizErreur = { ok: false; erreur: string; warnings: string[] };
export type WinbizResult = WinbizOk | WinbizErreur;

// ── Helpers purs ──

/** Montant en centimes → chaîne décimale sans zéro traînant (1974, 163.9, 97.55). */
export function fmtMontant(cts: number): string {
  if (!Number.isInteger(cts)) throw new Error(`fmtMontant: centimes non entiers (${cts})`);
  const neg = cts < 0 ? "-" : "";
  const abs = Math.abs(cts);
  const fr = Math.floor(abs / 100);
  const c = abs % 100;
  if (c === 0) return `${neg}${fr}`;
  if (c % 10 === 0) return `${neg}${fr}.${c / 10}`;
  return `${neg}${fr}.${String(c).padStart(2, "0")}`;
}

/** Montant CHF (number) → centimes entiers. */
function cts(v: number): number {
  return Math.round(v * 100);
}

/** ISO "2026-04-18" (ou déjà "18.04.2026") → "18.04.2026". */
export function fmtDateWinbiz(d: string): string {
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || "");
  if (iso) return `${iso[3]}.${iso[2]}.${iso[1]}`;
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(d)) return d;
  throw new Error(`Date de document illisible : « ${d} »`);
}

/**
 * Assainit une valeur avant insertion dans un champ : le ';' casserait la
 * structure en colonnes, les fins de ligne casseraient le fichier.
 * Retourne aussi un flag si quelque chose a été remplacé.
 */
function champSain(v: string): { texte: string; modifie: boolean } {
  const texte = (v ?? "")
    .replace(/[\r\n]+/g, " ")
    .replace(/;/g, ",");
  return { texte, modifie: texte !== (v ?? "") };
}

/** Valeur d'adresse entre guillemets Winbiz : guillemets internes retirés. */
function champAdresse(v: string): string {
  return `"${champSain(v).texte.replace(/"/g, "").trim()}"`;
}

// ── Encodage cp1252 sans dépendance ──
// ASCII et latin-1 (0xA0–0xFF) passent tels quels ; les 27 caractères propres
// à cp1252 (plage 0x80–0x9F) sont mappés explicitement ; quelques caractères
// typographiques fréquents sont transposés en équivalent sûr AVANT encodage.
// Tout caractère restant non mappable devient '?' et produit un warning —
// jamais de perte silencieuse.

const CP1252_EXTRAS: Record<string, number> = {
  "€": 0x80, "‚": 0x82, "ƒ": 0x83, "„": 0x84,
  "…": 0x85, "†": 0x86, "‡": 0x87, "ˆ": 0x88,
  "‰": 0x89, "Š": 0x8A, "‹": 0x8B, "Œ": 0x8C,
  "Ž": 0x8E, "‘": 0x91, "’": 0x92, "“": 0x93,
  "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97,
  "˜": 0x98, "™": 0x99, "š": 0x9A, "›": 0x9B,
  "œ": 0x9C, "ž": 0x9E, "Ÿ": 0x9F,
};

const TRANSPOSITIONS: Record<string, string> = {
  "−": "-",   // signe moins typographique (affichage des remises, doc 03 §4)
  " ": " ",   // espace insécable
  " ": " ",   // espace fine insécable
  " ": " ",
};

export function encodeCp1252(s: string): { bytes: Uint8Array; nonMappables: string[] } {
  const out: number[] = [];
  const nonMappables: string[] = [];
  for (let ch of s) {
    if (TRANSPOSITIONS[ch] !== undefined) ch = TRANSPOSITIONS[ch];
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80 || (cp >= 0xa0 && cp <= 0xff)) {
      out.push(cp);
    } else if (CP1252_EXTRAS[ch] !== undefined) {
      out.push(CP1252_EXTRAS[ch]);
    } else {
      out.push(0x3f); // '?'
      if (!nonMappables.includes(ch)) nonMappables.push(ch);
    }
  }
  return { bytes: Uint8Array.from(out), nonMappables };
}

// ── Nom de fichier ──
// Modèle Make : bizexdoc_facture_winbiz_{numero}_{societe}_ {nom}_ {prenom}_{run_id}.csv
// — les espaces parasites du modèle Make sont assainis (cadrage §3.1).

function segmentFichier(v: string): string {
  return (v || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function nomFichier(numeroWinbiz: string, societe: string, nom: string, prenom: string, runId: string): string {
  const parts = ["bizexdoc_facture_winbiz", numeroWinbiz, segmentFichier(societe), segmentFichier(nom), segmentFichier(prenom), runId];
  return parts.filter((p) => p !== "").join("_") + ".csv";
}

/** run_id au format Make : YYYYMMDD_HHmmss_{aléa 1000–9999}. Impur — vit dans la ROUTE, pas ici. */
export function genererRunId(now: Date, alea: number): string {
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}_${alea}`;
}

// ── Construction d'une ligne à partir d'un gabarit ──

function ligneDepuisGabarit(prefixe: string[], suffixeRef: string, subst: Record<number, string>): string {
  const sfx = suffixeRef.split(";");
  for (const [i, v] of Object.entries(subst)) sfx[Number(i)] = v;
  // le suffixe commence par '' (il débute par ';') : on le greffe après le préfixe
  return [...prefixe, ...sfx.slice(1)].join(";");
}

// ── Le générateur ──

export function buildWinbizCsv(
  cmd: WinbizCommandeInput,
  attribution: WinbizAttribution,
  runId: string
): WinbizResult {
  const warnings: string[] = [];
  const d = cmd.data;

  // 0. Garde-fous d'entrée ───────────────────────────────────────────────
  if (d.formType !== "Commande") {
    return { ok: false, erreur: `Seules les commandes s'exportent (type reçu : ${d.formType}).`, warnings };
  }

  // Numéro : chiffres uniquement, préfixe CMD- retiré (WinBiz refuse les lettres)
  const numeroWinbiz = (cmd.numeroCommande || "").replace(/^CMD-/i, "");
  if (!/^\d+$/.test(numeroWinbiz)) {
    return { ok: false, erreur: `Numéro de commande inexploitable pour WinBiz : « ${cmd.numeroCommande} » (il faut des chiffres uniquement).`, warnings };
  }

  let date: string;
  try {
    date = fmtDateWinbiz(cmd.dateDocument || d.date);
  } catch (e) {
    return { ok: false, erreur: (e as Error).message, warnings };
  }

  const proHt = d.clientType === "Pro (prix HT)";
  const flagTva = proHt ? "2" : "1"; // champ 62 — valeurs officielles : 0/1 = Inclus, 2 = Exclu
  if (proHt) {
    warnings.push(
      "Document Pro (prix HT) : lignes émises en HT avec champ TVA = 2 (Exclu). " +
      "Le test d'import T9 doit être vert avant le premier export Pro en production."
    );
  }

  // 1. Totaux — recalcul via computeTotals, JAMAIS data._totals (335/400 ne l'ont pas)
  const totals = computeTotals(d);
  const totalRefCts = cts(totals.totalAfterRounding); // = finalTotal pour un Privé TTC

  // Contrôle croisé bloquant avec la colonne total_ttc (les colonnes sont des
  // recopies — doc 04 §5 bis — une divergence signifie un document incohérent)
  if (cmd.totalTtcColonne != null) {
    const ecart = cts(totals.finalTotal) - cts(cmd.totalTtcColonne);
    if (ecart !== 0) {
      return {
        ok: false,
        erreur:
          `Le total recalculé depuis le document (${fmtMontant(cts(totals.finalTotal))}) ne correspond pas à la colonne ` +
          `total_ttc (${fmtMontant(cts(cmd.totalTtcColonne))}) — écart de ${fmtMontant(ecart)} CHF. ` +
          `Pas de fichier : la commande doit d'abord être diagnostiquée (doc 04 §5 bis).`,
        warnings,
      };
    }
  }

  // 2. Attribution client → champ 20 + champs d'adresse 22–28 ─────────────
  // 🔴 Défense en profondeur (cadrage §3.2) : sur le chemin de repli, les
  // champs 22–28 ne portent JAMAIS les données du client de la commande —
  // uniquement les placeholders historiques. Les vraies coordonnées ne vivent
  // que dans la ligne texte n° 1.
  let codeClient: string;
  let adr: { societe: string; nom: string; prenom: string; rue: string; npa: string; ville: string };
  if (attribution.type === "code") {
    codeClient = attribution.code;
    adr = {
      societe: champAdresse(d.societe),
      nom: champAdresse(d.nom),
      prenom: champAdresse(d.prenom),
      rue: champAdresse([d.rue, d.numero].filter(Boolean).join(" ")),
      npa: champAdresse(d.npa),
      ville: champAdresse(d.ville),
    };
  } else {
    codeClient = "999";
    adr = {
      societe: '"Société SA"', nom: '"Nom"', prenom: '"Prenom"',
      rue: '"Rue"', npa: '"Npa"', ville: '"Ville"',
    };
  }

  // 3. Vendeur ────────────────────────────────────────────────────────────
  const cleVendeur = (d.commercial || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().trim();
  const vendeur = VENDEURS[cleVendeur] ?? "<AUTO>";
  if (vendeur === "<AUTO>" && (d.commercial || "").trim() !== "") {
    warnings.push(`Vendeur « ${d.commercial} » inconnu de la table d'initiales — émis en <AUTO>.`);
  }

  // 4. Préfixe commun (champs 1–47) ───────────────────────────────────────
  const prefixe = REF_PREFIXE.split(";");
  if (prefixe.length !== 47) throw new Error(`Gabarit préfixe corrompu : ${prefixe.length} champs au lieu de 47`);
  prefixe[IDX_NUMERO] = numeroWinbiz;
  prefixe[IDX_DATE] = date;
  prefixe[IDX_DATE_2] = date;
  prefixe[IDX_CODE_CLIENT] = codeClient;
  prefixe[IDX_ADR_SOCIETE] = adr.societe;
  prefixe[IDX_ADR_NOM] = adr.nom;
  prefixe[IDX_ADR_PRENOM] = adr.prenom;
  prefixe[IDX_ADR_RUE] = adr.rue;
  prefixe[IDX_ADR_NPA] = adr.npa;
  prefixe[IDX_ADR_VILLE] = adr.ville;
  prefixe[IDX_MAJ_ADRESSE] = "1"; // ← le verrou. Ne JAMAIS laisser vide (défaut 0 = écrasement).
  prefixe[IDX_TOTAL] = fmtMontant(cts(totals.totalAfterRounding)); // total connu dès ici

  // 5. Les lignes de contenu, en centimes entiers ─────────────────────────
  type LigneEmise = { texte: string; montantCts: number };
  const lignes: LigneEmise[] = [];
  let sommeCts = 0;

  const pousserArticle = (
    num: number, desc: string, qte: number, prixCts: number
  ) => {
    const { texte: descSaine, modifie } = champSain(desc);
    if (modifie) warnings.push(`Ligne ${num} : point-virgule ou saut de ligne remplacé dans « ${descSaine.slice(0, 40)}… ».`);
    const texte = ligneDepuisGabarit(prefixe, REF_SUFFIXE_ARTICLE, {
      [SFX_NUM]: String(num),
      [SFX_DESC]: descSaine,
      [SFX_DATE]: date,
      [SFX_QTE]: String(qte),
      [SFX_PRIX]: fmtMontant(prixCts),
      [SFX_TVA_INCLUSE]: flagTva,
    });
    lignes.push({ texte, montantCts: qte * prixCts });
    sommeCts += qte * prixCts;
  };

  const pousserTexte = (num: number, texte0: string) => {
    const { texte: sain } = champSain(texte0);
    const texte = ligneDepuisGabarit(prefixe, REF_SUFFIXE_TITRE, {
      [SFX_NUM]: String(num),
      [SFX_DESC]: sain,
      [SFX_DATE]: ` ${date}`, // l'espace de tête est dans le gabarit de référence
      [SFX_TVA_INCLUSE]: flagTva,
    });
    lignes.push({ texte, montantCts: 0 });
  };

  // 5a. Ligne adresse à plat (n = 1) — émise dans TOUS les cas : c'est la
  // vérification à l'écran de la comptable, et la trace si le match était faux.
  const coord = [
    d.societe ? `Société: ${d.societe}` : "",
    `Nom: ${d.nom}`,
    `Prénom: ${d.prenom}`,
    `Rue: ${[d.rue, d.numero].filter(Boolean).join(" ")}`,
    `Npa: ${d.npa} Localité: ${d.ville}`,
    `e-mail: ${d.email}`,
    `Tél: ${d.telephone1 || d.telephone2 || ""}`,
  ].filter(Boolean).join(" | ");
  {
    const { texte: coordSaine } = champSain(coord);
    lignes.push({
      texte: ligneDepuisGabarit(prefixe, REF_SUFFIXE_ADRESSE, {
        [SFX_NUM]: "1",
        [SFX_DESC]: coordSaine,
      }),
      montantCts: 0,
    });
  }

  // 5b. Articles et commentaires, dans l'ordre du document. Les lignes media
  // sont exclues (comme du sous-total) ; les lignes comment deviennent des
  // lignes texte type 2.
  let n = 2;
  for (const l of d.lines as QuoteLine[]) {
    if (l.type === "media") continue;
    if (n >= 100) {
      return { ok: false, erreur: `Document trop long : plus de 97 lignes de contenu (la numérotation Winbiz réserve 100+).`, warnings };
    }
    if (l.type === "comment") {
      pousserTexte(n, l.title || "");
      n++;
      continue;
    }
    const qte = l.qty || 0;
    if (qte <= 0) {
      warnings.push(`Ligne « ${(l.title || "").slice(0, 40)} » à quantité ${qte} — ignorée.`);
      continue;
    }
    const prixCts = cts(l.unitPrice || 0);
    const rabaisLigneCts = cts(l.lineDiscount || 0);
    let desc = [l.title, l.sku].filter((s) => (s || "").trim()).join(" ");
    let prixNetCts = prixCts;
    if (rabaisLigneCts !== 0) {
      // §5.3 : prix unitaire NET émis, champ remise laissé à 0 (T2 non validé),
      // mention explicite dans la description.
      if (rabaisLigneCts % qte !== 0) {
        // le rabais total ne se répartit pas en centimes entiers par pièce :
        // on refuse plutôt que d'émettre un détail qui ne retombe pas juste.
        return {
          ok: false,
          erreur:
            `Ligne « ${(l.title || "").slice(0, 40)} » : rabais de ligne ${fmtMontant(rabaisLigneCts)} CHF ` +
            `non divisible par la quantité ${qte} en centimes entiers. Pas de fichier.`,
          warnings,
        };
      }
      const rabaisParPieceCts = rabaisLigneCts / qte;
      prixNetCts = prixCts - rabaisParPieceCts;
      desc += ` (dont rabais ${fmtMontant(rabaisParPieceCts)}/pce, prix brut ${fmtMontant(prixCts)})`;
    }
    pousserArticle(n, desc, qte, prixNetCts);
    n++;
  }

  // 5c. Sous-total (n = 100) — aucun montant, WinBiz calcule
  lignes.push({
    texte: ligneDepuisGabarit(prefixe, REF_SUFFIXE_SOUS_TOTAL, {}),
    montantCts: 0,
  });

  // 5d. Rabais global (n = 200) — montant négatif exact, jamais d'équilibrage
  const rabaisCts = cts(totals.discountValue);
  if (rabaisCts !== 0) {
    const pct = Number(d.discountPercent || 0);
    const libelle = pct > 0 ? `Rabais ${pct} %` : "Rabais";
    pousserArticle(200, libelle, 1, -rabaisCts);
  }

  // 5e. Services (n = 202…) — libellé réel, prix réel, « Offert » si 0
  let numService = 202;
  const services: Array<{ code: string; label: string }> = [
    ...serviceOptions.map((s) => ({ code: s.code, label: s.label })),
    { code: "custom", label: (d.servicePrices as Record<string, string>)["custom_label"] || "Prestation" },
  ];
  for (const s of services) {
    if (!d.enabledServices[s.code]) continue;
    const prixSvcCts = cts(Number(d.servicePrices[s.code] || 0));
    const libelle = prixSvcCts === 0 ? `${s.label}: Offert` : s.label;
    pousserArticle(numService, libelle, 1, prixSvcCts);
    numService++;
  }

  // 5f. Arrondi (n = 210) — ligne dédiée, montant signé, jamais fondu dans un rabais
  const arrondiCts = cts(totals.roundingValue);
  if (arrondiCts !== 0) {
    pousserArticle(210, "Arrondi", 1, arrondiCts);
  }

  // 6. 🔴 INVARIANT BLOQUANT ──────────────────────────────────────────────
  if (sommeCts !== totalRefCts) {
    return {
      ok: false,
      erreur:
        `Invariant violé : la somme des lignes émises (${fmtMontant(sommeCts)} CHF) ne retombe pas sur le total ` +
        `du document (${fmtMontant(totalRefCts)} CHF) — écart de ${fmtMontant(sommeCts - totalRefCts)} CHF. ` +
        `Pas de fichier, jamais de ligne d'équilibrage.`,
      warnings,
    };
  }

  // 7. En-tête (22 champs — gabarit propre) puis assemblage ───────────────
  const entete = REF_ENTETE.split(";");
  entete[IDX_NUMERO] = numeroWinbiz;
  entete[IDX_DATE] = date;
  entete[IDX_TOTAL] = fmtMontant(totalRefCts);
  entete[IDX_VENDEUR] = vendeur;
  entete[IDX_CODE_CLIENT] = codeClient;

  const contenu = [entete.join(";"), ...lignes.map((l) => l.texte)].join("\n") + "\n\n";
  // ↑ LF + ligne vide finale : relevé sur les fichiers réellement importés
  // (le cadrage v2 disait CRLF — les fichiers de référence sont en LF).

  const { bytes, nonMappables } = encodeCp1252(contenu);
  if (nonMappables.length > 0) {
    warnings.push(
      `Caractères non représentables en cp1252 remplacés par '?' : ${nonMappables.map((c) => `« ${c} » (U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")})`).join(", ")}.`
    );
  }

  return {
    ok: true,
    filename: nomFichier(numeroWinbiz, d.societe, d.nom, d.prenom, runId),
    contentUtf8: contenu,
    contentCp1252: bytes,
    warnings,
    numeroWinbiz,
    clientCode: codeClient,
    montant: totalRefCts / 100,
    proHt,
  };
}
