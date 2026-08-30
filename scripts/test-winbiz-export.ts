// scripts/test-winbiz-export.ts
// ─────────────────────────────────────────────────────────────────────────────
// Tests du module pur lib/winbiz-export.ts — chantier « Export Winbiz ».
// Lancement :  npx tsx scripts/test-winbiz-export.ts
// (aucune dépendance ajoutée au dépôt : tsx est tiré à la volée par npx)
//
// Référence : les fichiers réellement importés dans WinBiz le 18.04.2026,
// recopiés dans scripts/winbiz-fixtures/. Le test compare le fichier généré
// aux gabarits AU CARACTÈRE PRÈS (mêmes positions de colonnes), en n'exemptant
// que les champs de valeur (description, quantité, prix, n° de ligne) — le
// détail fidèle remplace volontairement l'équilibrage Make (cadrage §4).
// ─────────────────────────────────────────────────────────────────────────────

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildWinbizCsv, fmtMontant, fmtDateWinbiz, encodeCp1252, nomFichier,
  type WinbizCommandeInput,
} from "../lib/winbiz-export";
import type { PrintData, QuoteLine } from "../lib/jc-print-types";

const ICI = dirname(fileURLToPath(import.meta.url));
// Les fichiers de référence sont en LF ; le .replace protège le test contre
// une conversion CRLF par git/autocrlf sur un poste Windows (doc 04 §3 : les
// fins de ligne se décident par fichier — celles-ci font partie de la preuve).
const lireRef = (nom: string) =>
  readFileSync(join(ICI, "winbiz-fixtures", nom), "utf-8").replace(/\r\n/g, "\n");
const REF_54063 = lireRef("ref_54063.csv");
const REF_53990 = lireRef("ref_53990.csv");

let nOk = 0;
function ok(nom: string, fn: () => void) {
  try {
    fn();
    nOk++;
    console.log(`  ✓ ${nom}`);
  } catch (e) {
    console.error(`  ✗ ${nom}`);
    throw e;
  }
}

// ── Fabrique de PrintData minimal ──
function printData(partiel: Partial<PrintData>): PrintData {
  return {
    formType: "Commande",
    clientType: "Privé (prix TTC)",
    paymentMode: "Paiement d'avance à la commande",
    offerStatus: "Acceptée",
    date: "2026-04-18",
    commercial: "Michel Gédéon",
    offerNumber: "CMD-54063",
    reference: "",
    societe: "", nom: "", prenom: "", rue: "", numero: "", npa: "", ville: "",
    telephone1: "", telephone2: "", email: "", customerNumber: "",
    livrDiff: false, livrSociete: "", livrNom: "", livrPrenom: "", livrTel: "",
    livrRue: "", livrNumero: "", livrNpa: "", livrVille: "",
    lines: [],
    discount: "0", discountPercent: "0", manualRounding: "0",
    enabledServices: {}, servicePrices: {},
    remarks: "", leadTime: "",
    ambianceImages: [],
    ...partiel,
  } as PrintData;
}

function art(id: string, title: string, sku: string, qty: number, unitPrice: number, extra: Partial<QuoteLine> = {}): QuoteLine {
  return { id, type: "product", sku, title, unitPrice, qty, ...extra } as QuoteLine;
}

// ── Reconstitution 54063 BERTHONZOZ (détail fidèle, total 1974 comme la référence) ──
// Papier : sous-total 1950.90, rabais ≈ −97, livraison 120 → 1974.
// Détail fidèle retenu pour la fixture : rabais CHF 96.90 + livraison 120.
const CMD_54063: WinbizCommandeInput = {
  numeroCommande: "CMD-54063",
  dateDocument: "2026-04-18",
  totalTtcColonne: 1974.0,
  data: printData({
    nom: "BERTHONZOZ", prenom: "TRISTAN", rue: "Route de CLEMENTY", numero: "67",
    npa: "1260", ville: "NYON", email: "tristan.berthonzoz@me.co", telephone1: "078.753.02.22",
    lines: [
      art("shopify-1", "Luxembourg - Appui-tête fauteuil bas couleur structure: Stéréo Romarin 48ST", "4165", 1, 129),
      art("shopify-2", "Luxembourg - Fauteuil bas couleur structure: Menthe glacial A7", "4104", 1, 499),
      art("shopify-3", "Luxembourg - Fauteuil lounge couleur structure: Menthe glacial A7", "4212", 1, 445),
      art("shopify-4", "Luxembourg - petite table basse/repose/pieds, couleur structure: Menthe Glacial", "4160", 1, 245),
      art("shopify-5", "Bebop - table basse Ø 60c- couleur: bleu abysse 92", "5613", 1, 469),
      art("shopify-6", "ARCHE - tapis d'extérieur 230x162", "LFM5406.AOM", 1, 163.9),
    ],
    discount: "96.90",
    enabledServices: { etage: true },
    servicePrices: { etage: "120" },
  }),
};

// ── Reconstitution 53990 DOMS (rabais 10 %, service offert, arrondi) ──
// 2×1425 + 299 + 409 = 3558 ; −10 % = −355.80 ; livraison offerte 0 ;
// arrondi −2.20 → total 3200 (= l'en-tête de la référence).
const CMD_53990: WinbizCommandeInput = {
  numeroCommande: "CMD-53990",
  dateDocument: "2026-04-18",
  totalTtcColonne: 3200.0,
  data: printData({
    offerNumber: "CMD-53990",
    nom: "DOMS", prenom: "Jean-Pierre", rue: "Route d'ANTAGNES,", numero: "13",
    npa: "1867", ville: "OLLON", email: "jpdo64@gmail.com", telephone1: "079.761.10.04",
    lines: [
      art("shopify-1", "RIVAGE Fauteuil d'angle Structure en aluminium couleur: CACTUS Coussins d'assise et dossier: FICELLE NATTE de SUNBRELLA 9402", "82", 2, 1425),
      art("shopify-2", "PIAPOLO tabouret Structure: CACTUS 3206", "82", 1, 299),
      art("shopify-3", "MOON-lampe h. 134cm couleur: CACTUS 5310", "82", 1, 409),
    ],
    discountPercent: "10",
    enabledServices: { etage_montage: true },
    servicePrices: { etage_montage: "0" },
    manualRounding: "-2.20",
  }),
};

const REPLI = { type: "repli", raison: "aucun candidat" } as const;
const RUN_ID = "20260418_174613_7613";

// ── Outils de comparaison ──
const lignesRef54063 = REF_54063.split("\n").filter((l) => l !== "");
const lignesRef53990 = REF_53990.split("\n").filter((l) => l !== "");

function champs(l: string): string[] { return l.split(";"); }

/** Compare deux lignes champ à champ sur la longueur de la RÉFÉRENCE, en
 *  exemptant les index donnés (0-based). Depuis le 30.08, les lignes générées
 *  sont étendues à 135 champs (134 = code du commercial, 135 = votre
 *  référence) : l'extension doit être vide partout ailleurs. */
function comparerLigne(nom: string, gen: string, ref: string, exemptes: number[]) {
  const g = champs(gen), r = champs(ref);
  assert.equal(g.length, 135, `${nom} : ${g.length} champs générés au lieu de 135 (extension 134/135)`);
  for (let i = 0; i < r.length; i++) {
    if (exemptes.includes(i)) continue;
    if (i === 4 || i === 18) continue; // champs 5 (Notre réf) et 19 (Notes) : divergences voulues du 30.08, testées à part
    assert.equal(g[i], r[i], `${nom} : champ ${i + 1} — généré « ${g[i]} » vs référence « ${r[i]} »`);
  }
  for (let i = r.length; i < g.length; i++) {
    if (i === 133 || i === 134) continue; // champs 134/135
    assert.equal(g[i], "", `${nom} : champ ${i + 1} de l'extension devrait être vide`);
  }
}

// index 0-based des champs de valeur, exemptés des comparaisons de gabarit
const I_NUM_LIGNE = 47;   // champ 48
const I_DESC = 50;        // champ 51
const I_QTE = 52;         // champ 53
const I_PRIX = 53;        // champ 54
const I_TVA_INCL = 61;    // champ 62
const I_CODE_CLIENT = 19; // champ 20
const I_MAJ_ADR = 46;     // champ 47

console.log("── Sanity : les index se vérifient d'abord sur la RÉFÉRENCE validée ──");
ok("champ 20 de la référence = 999 (index localisé programmatiquement)", () => {
  for (const l of lignesRef54063) assert.equal(champs(l)[I_CODE_CLIENT], "999");
});
ok("champ 47 de la référence = 1 sur toutes les lignes après l'en-tête", () => {
  for (const l of lignesRef54063.slice(1)) assert.equal(champs(l)[I_MAJ_ADR], "1");
});
ok("champ 62 de la référence = 1 (TVA incluse) sur les lignes chiffrées", () => {
  for (const l of lignesRef54063.slice(1)) {
    const f = champs(l);
    if (f[I_TVA_INCL - 1] === "8.10") assert.equal(f[I_TVA_INCL], "1");
  }
});

console.log("── Test 1 (PREMIER test du chantier) : champs 20 et 47 du fichier généré ──");
const gen54063 = buildWinbizCsv(CMD_54063, REPLI, RUN_ID);
assert(gen54063.ok, (gen54063 as { erreur?: string }).erreur ?? "");
const lignesGen = gen54063.contentUtf8.split("\n").filter((l) => l !== "");
ok("champ 47 émis = 1 sur TOUTES les lignes après l'en-tête (le défaut 0 ÉCRASE la fiche Winbiz)", () => {
  for (const l of lignesGen.slice(1)) assert.equal(champs(l)[I_MAJ_ADR], "1");
});
ok("champ 20 émis = 999 en repli, sur toutes les lignes", () => {
  for (const l of lignesGen) assert.equal(champs(l)[I_CODE_CLIENT], "999");
});

console.log("── Test 2 (DEUXIÈME test du chantier) : repli 999 → champs 22–28 sans données client ──");
ok("les champs 22–28 portent exactement les placeholders historiques", () => {
  const f = champs(lignesGen[2]);
  assert.deepEqual(f.slice(21, 28), ['"Société SA"', '"Nom"', '"Prenom"', '"Rue"', "", '"Npa"', '"Ville"']);
});
ok("aucun fragment des données du client dans les champs 21–47 d'aucune ligne en repli", () => {
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const fragments = ["berthonzoz", "tristan", "clementy", "1260", "nyon"].map(norm);
  for (const l of lignesGen.slice(1)) {
    const zone = champs(l).slice(20, 47).map(norm).join(";");
    for (const frag of fragments) {
      assert(!zone.includes(frag), `fragment client « ${frag} » trouvé dans la zone adresse : ${zone}`);
    }
  }
});

console.log("── Test 3 : gabarits reproduits au caractère près (54063) ──");
ok("en-tête : identique à la référence hors champ 5 (Notre réf) et champ 12 (rendu à <AUTO>)", () => {
  const g = champs(lignesGen[0]), r = champs(lignesRef54063[0]);
  assert.equal(g.length, r.length);
  for (let i = 0; i < r.length; i++) {
    if (i === 4 || i === 11 || i === 18) continue;
    assert.equal(g[i], r[i], `en-tête champ ${i + 1}`);
  }
  assert.equal(g[4], "CMD-54063 du 18.04.2026");  // champ 5 : la date de COMMANDE survit au changement de date de facture
  assert.equal(g[11], "<AUTO>");    // champ 12 = Compte d'escompte, plus jamais les initiales
});
ok("ligne 1 : « CMD-54063 du 18.04.2026 », texte sans prix, tout en haut (demande du 30.08)", () => {
  const f = champs(lignesGen[1]);
  assert.equal(f[47], "1");
  assert.equal(f[48], "2"); // texte
  assert.equal(f[I_DESC], "CMD-54063 du 18.04.2026");
});
ok("ligne adresse (n=2) : préfixe 1–47 identique, suffixe identique hors coordonnées et n°", () => {
  comparerLigne("adresse", lignesGen[2], lignesRef54063[1], [I_DESC, I_NUM_LIGNE]);
});
ok("ligne Conseiller/Expédition : texte libre type 2 juste sous l'adresse (demandes du 30.08)", () => {
  const f = champs(lignesGen[3]);
  assert.equal(f[47], "3");   // n = 3, juste après la ligne adresse
  assert.equal(f[48], "2");   // type texte
  assert.equal(f[I_DESC], "Conseiller: Michel Gédéon (MG)");
  // avec un mode de livraison, l'expédition s'ajoute sur la même ligne
  const data = printData({ lines: [art("shopify-1", "Table", "333", 1, 500)] });
  (data as unknown as Record<string, unknown>).deliveryMode = "Livraison à domicile";
  const r = buildWinbizCsv({ numeroCommande: "CMD-10", dateDocument: "2026-08-30", totalTtcColonne: 500, data }, REPLI, RUN_ID);
  assert(r.ok, (r as { erreur?: string }).erreur ?? "");
  const ligne3 = r.contentUtf8.split("\n").filter((x) => x !== "")[3]!;
  assert.equal(champs(ligne3)[I_DESC], "Conseiller: Michel Gédéon (MG) | Expédition: Livraison à domicile");
});
ok("ligne article : identique à la référence hors n°, description, quantité, prix", () => {
  // notre 1er article vs le 1er article de la référence (n=4)
  const premierArticle = lignesGen.find((l) => champs(l)[48] === "1")!;
  comparerLigne("article", premierArticle, lignesRef54063[3], [I_NUM_LIGNE, I_DESC, I_QTE, I_PRIX]);
});
ok("ligne sous-total identique à la référence sur ses 129 champs (hors champ 5, extension à part)", () => {
  const genST = lignesGen.find((l) => champs(l)[I_NUM_LIGNE] === "100")!;
  comparerLigne("sous-total", genST, lignesRef54063[10]!, []);
});
ok("ligne rabais (n=200) : gabarit identique hors description et montant", () => {
  const genRab = lignesGen.find((l) => champs(l)[I_NUM_LIGNE] === "200")!;
  comparerLigne("rabais", genRab, lignesRef54063[11], [I_DESC, I_PRIX]);
});
ok("ligne service (n=202) : gabarit identique hors description et montant", () => {
  const genSvc = lignesGen.find((l) => champs(l)[I_NUM_LIGNE] === "202")!;
  comparerLigne("service", genSvc, lignesRef54063[12], [I_DESC, I_PRIX]);
});
ok("fins de ligne LF, ligne vide finale, aucun CRLF (relevé sur les fichiers importés)", () => {
  assert(!gen54063.contentUtf8.includes("\r"), "CRLF détecté");
  assert(gen54063.contentUtf8.endsWith(";\n\n"), "le fichier doit finir par la dernière ligne + une ligne vide");
});

console.log("── Test 4 : 53990 — rabais %, service offert, arrondi, titres texte ──");
const gen53990 = buildWinbizCsv(CMD_53990, REPLI, "20260418_171612_9638");
assert(gen53990.ok, (gen53990 as { erreur?: string }).erreur ?? "");
const lignes53990 = gen53990.contentUtf8.split("\n").filter((l) => l !== "");
ok("en-tête 53990 identique à la référence hors champs 5, 12 et 19", () => {
  const g = champs(lignes53990[0]), r = champs(lignesRef53990[0]);
  for (let i = 0; i < r.length; i++) {
    if (i === 4 || i === 11 || i === 18) continue;
    assert.equal(g[i], r[i], `en-tête champ ${i + 1}`);
  }
  assert.equal(g[4], "CMD-53990 du 18.04.2026");
});
ok("le rabais 10 % émet −355.8 exactement (jamais d'équilibrage −358 façon Make)", () => {
  const rab = lignes53990.find((l) => champs(l)[I_NUM_LIGNE] === "200")!;
  assert.equal(champs(rab)[I_PRIX], "-355.8");
  assert.equal(champs(rab)[I_DESC], "Rabais 10 %");
});
ok("le service offert émet un libellé « … Offert » et un prix 0", () => {
  const svc = lignes53990.find((l) => champs(l)[I_NUM_LIGNE] === "202")!;
  assert.equal(champs(svc)[I_PRIX], "0");
  assert(champs(svc)[I_DESC].includes("Offert"));
});
ok("l'arrondi émet une ligne dédiée n=210 à −2.2, jamais fondu dans un rabais", () => {
  const arr = lignes53990.find((l) => champs(l)[I_NUM_LIGNE] === "210")!;
  assert.equal(champs(arr)[I_PRIX], "-2.2");
  assert.equal(champs(arr)[I_DESC], "Arrondi");
});
ok("somme des lignes émises = 3200.00 au centime (invariant)", () => {
  let somme = 0;
  for (const l of lignes53990.slice(1)) {
    const f = champs(l);
    if (f[I_PRIX] && f[48] === "1") somme += Math.round(Number(f[I_QTE]) * Number(f[I_PRIX]) * 100);
  }
  assert.equal(somme, 320000);
});

console.log("── Test 5 : attribution à un vrai code client ──");
const genAttr = buildWinbizCsv(CMD_54063, { type: "code", code: "1234", source: "nom_prenom_npa", libelle: "test" }, RUN_ID);
assert(genAttr.ok, (genAttr as { erreur?: string }).erreur ?? "");
const lignesAttr = genAttr.contentUtf8.split("\n").filter((l) => l !== "");
ok("champ 20 = code attribué sur toutes les lignes", () => {
  for (const l of lignesAttr) assert.equal(champs(l)[I_CODE_CLIENT], "1234");
});
ok("champs 22–28 = vraies données du client, entre guillemets", () => {
  const f = champs(lignesAttr[1]);
  assert.equal(f[22], '"BERTHONZOZ"');
  assert.equal(f[23], '"TRISTAN"');
  assert.equal(f[24], '"Route de CLEMENTY 67"');
  assert.equal(f[26], '"1260"');
  assert.equal(f[27], '"NYON"');
});
ok("champ 47 = 1 MÊME avec un vrai code (ne jamais modifier une fiche existante)", () => {
  for (const l of lignesAttr.slice(1)) assert.equal(champs(l)[I_MAJ_ADR], "1");
});

console.log("── Test 6 : refus — l'export ne truque jamais un écart ──");
ok("total_ttc divergent → PAS de fichier, erreur explicite", () => {
  const r = buildWinbizCsv({ ...CMD_54063, totalTtcColonne: 1980 }, REPLI, RUN_ID);
  assert(!r.ok && /total_ttc/.test((r as { erreur: string }).erreur));
});
ok("rabais de ligne non divisible par la quantité : accepté (montant de LIGNE natif, champ 67)", () => {
  const data = printData({
    lines: [art("shopify-1", "X", "1", 3, 100, { lineDiscount: 1.0, lineDiscountPerUnit: 1 / 3 })],
  });
  const r = buildWinbizCsv({ numeroCommande: "CMD-1", dateDocument: "2026-08-29", totalTtcColonne: 299, data }, REPLI, RUN_ID);
  assert(r.ok, (r as { erreur?: string }).erreur ?? "");
  const ligne = r.contentUtf8.split("\n").filter((x) => x !== "").find((l) => champs(l)[48] === "1")!;
  assert.equal(champs(ligne)[66], "1");    // champ 67 : montant de remise
  assert.equal(champs(ligne)[56], "299");  // champ 57 : total net de la ligne
});
ok("numéro non numérique après retrait du préfixe → refus", () => {
  const r = buildWinbizCsv({ ...CMD_54063, numeroCommande: "CMD-80X95" }, REPLI, RUN_ID);
  assert(!r.ok && /chiffres uniquement/.test((r as { erreur: string }).erreur));
});
ok("une offre ne s'exporte pas", () => {
  const r = buildWinbizCsv({ ...CMD_54063, data: { ...CMD_54063.data, formType: "Offre" } }, REPLI, RUN_ID);
  assert(!r.ok);
});

console.log("── Test 7 : Pro HT → champ 62 = 2 (arbitrage Thierry 29.08), somme = total HT ──");
const proData = printData({
  clientType: "Pro (prix HT)",
  lines: [art("shopify-1", "Table pro", "111", 1, 1000)],
});
const genPro = buildWinbizCsv({ numeroCommande: "CMD-2", dateDocument: "2026-08-29", totalTtcColonne: 1081, data: proData }, REPLI, RUN_ID);
ok("document Pro accepté, flag proHt, warning T9 présent", () => {
  assert(genPro.ok, (genPro as { erreur?: string }).erreur ?? "");
  assert((genPro as { proHt: boolean }).proHt === true);
  assert(genPro.ok && genPro.warnings.some((w) => w.includes("T9")));
});
ok("champ 62 = 2 sur les lignes chiffrées, en-tête au total HT", () => {
  assert(genPro.ok);
  const ls = genPro.contentUtf8.split("\n").filter((l) => l !== "");
  assert.equal(champs(ls[0])[5], "1000"); // champ 6 : somme des lignes émises (HT) — T9 tranchera TTC vs HT
  const artLigne = ls.find((l) => champs(l)[48] === "1")!;
  assert.equal(champs(artLigne)[I_TVA_INCL], "2");
});
ok("Privé TTC garde champ 62 = 1", () => {
  const artLigne = lignesGen.find((l) => champs(l)[48] === "1")!;
  assert.equal(champs(artLigne)[I_TVA_INCL], "1");
});

console.log("── Test 8 : rabais de ligne NATIF (champ 67 montant + champ 57 total) — T2 en cours ──");
ok("prix BRUT au champ 54, rabais au champ 67, total net au champ 57, description propre", () => {
  const data = printData({
    lines: [art("shopify-1", "Fauteuil soldé", "222", 2, 549, { lineDiscount: 100, lineDiscountPerUnit: 50 })],
  });
  const r = buildWinbizCsv({ numeroCommande: "CMD-3", dateDocument: "2026-08-29", totalTtcColonne: 998, data }, REPLI, RUN_ID);
  assert(r.ok, (r as { erreur?: string }).erreur ?? "");
  const ligne = r.contentUtf8.split("\n").filter((l) => l !== "").find((l) => champs(l)[48] === "1")!;
  const f = champs(ligne);
  assert.equal(f[I_DESC], "Fauteuil soldé / Art. 222"); // titre / Art. SKU (demande du 30.08)
  assert.equal(f[I_PRIX], "549");            // prix BRUT
  assert.equal(f[66], "100");                // champ 67 : montant de remise (2 × 50)
  assert.equal(f[56], "998");                // champ 57 : montant total net de la ligne
  assert.equal(f[55], "0");                  // champ 56 : remise % jamais utilisée (les francs sont exacts)
  assert(!f[I_DESC].includes("rabais"), f[I_DESC]); // description propre, sans mention
  // l'invariant tient toujours : la somme émise reste le net
  assert(r.ok && r.montant === 998);
});
ok("ligne SANS rabais : champs 57 et 67 restent vides (gabarit de référence intact)", () => {
  const premierArticle = lignesGen.find((l) => champs(l)[48] === "1")!;
  const f = champs(premierArticle);
  assert.equal(f[56], "");
  assert.equal(f[66], "");
});

console.log("── Test 9 : commentaires → lignes texte, media exclues ──");
ok("ligne comment émise en type 2, ligne media absente du fichier", () => {
  const data = printData({
    lines: [
      { id: "c1", type: "comment", sku: "", title: "Ensemble terrasse sud", unitPrice: 0, qty: 0 } as QuoteLine,
      art("shopify-1", "Table", "333", 1, 500),
      { id: "m1", type: "media", sku: "", title: "LOGO_FERMOB_INTERNE", unitPrice: 0, qty: 0, mediaUrl: "x" } as QuoteLine,
    ],
  });
  const r = buildWinbizCsv({ numeroCommande: "CMD-4", dateDocument: "2026-08-29", totalTtcColonne: 500, data }, REPLI, RUN_ID);
  assert(r.ok, (r as { erreur?: string }).erreur ?? "");
  const ls = r.contentUtf8.split("\n").filter((l) => l !== "");
  const comment = ls.find((l) => champs(l)[I_DESC] === "Ensemble terrasse sud")!;
  assert.equal(champs(comment)[48], "2");
  assert(!r.contentUtf8.includes("LOGO_FERMOB_INTERNE"));
});

console.log("── Test 10 : service libre (custom_label), découvert en base le 29.08 ──");
ok("le service custom émet le libellé de servicePrices.custom_label", () => {
  const data = printData({
    lines: [art("shopify-1", "Parasol", "444", 1, 300)],
    enabledServices: { custom: true },
    servicePrices: { custom: "119", custom_label: "FORFAIT A/R DEPLACEMENT & INSTALATION " },
  });
  const r = buildWinbizCsv({ numeroCommande: "CMD-5", dateDocument: "2026-08-29", totalTtcColonne: 419, data }, REPLI, RUN_ID);
  assert(r.ok, (r as { erreur?: string }).erreur ?? "");
  const svc = r.contentUtf8.split("\n").filter((l) => l !== "").find((l) => champs(l)[I_NUM_LIGNE] === "202")!;
  assert(champs(svc)[I_DESC].includes("FORFAIT A/R DEPLACEMENT"));
  assert.equal(champs(svc)[I_PRIX], "119");
});

console.log("── Test 10 bis : champs Document 134/135 (relevés à l'import du 30.08) ──");
ok("champ 134 = code du commercial sur toutes les lignes de contenu (MG pour Michel Gédéon)", () => {
  for (const l of lignesGen.slice(1)) assert.equal(champs(l)[133], "MG");
});
ok("champ 135 = « Votre référence » de la commande", () => {
  const data = printData({
    reference: "REF-CLIENT-42",
    lines: [art("shopify-1", "Table", "333", 1, 500)],
  });
  const r = buildWinbizCsv({ numeroCommande: "CMD-6", dateDocument: "2026-08-30", totalTtcColonne: 500, data }, REPLI, RUN_ID);
  assert(r.ok, (r as { erreur?: string }).erreur ?? "");
  for (const l of r.contentUtf8.split("\n").filter((x) => x !== "").slice(1)) {
    assert.equal(champs(l)[134], "REF-CLIENT-42");
  }
});
ok("champ 5 (Notre référence) = « CMD du date » sur l'en-tête ET le préfixe des lignes", () => {
  for (const l of lignesGen) assert.equal(champs(l)[4], "CMD-54063 du 18.04.2026");
});
ok("vendeur inconnu → champ 134 vide + warning (jamais un code inventé)", () => {
  const data = printData({
    commercial: "Personne Inconnue",
    lines: [art("shopify-1", "Table", "333", 1, 500)],
  });
  const r = buildWinbizCsv({ numeroCommande: "CMD-7", dateDocument: "2026-08-30", totalTtcColonne: 500, data }, REPLI, RUN_ID);
  assert(r.ok, (r as { erreur?: string }).erreur ?? "");
  const artLigne = r.contentUtf8.split("\n").filter((x) => x !== "").find((l) => champs(l)[48] === "1")!;
  assert.equal(champs(artLigne)[133], "");
  assert(r.ok && r.warnings.some((w) => w.includes("commercial laissé vide")));
});

console.log("── Test 10 ter : notes en ligne texte de FIN de document (demande du 30.08) ──");
ok("remarques + notes internes → dernière ligne texte n=220, champ 19 laissé vide", () => {
  const data = printData({
    remarks: "Livraison souhaitée avant Pâques",
    lines: [art("shopify-1", "Table", "333", 1, 500)],
  });
  (data as unknown as Record<string, unknown>).notesInternes = "acompte de 200 payé cash au magasin";
  const r = buildWinbizCsv({ numeroCommande: "CMD-8", dateDocument: "2026-08-30", totalTtcColonne: 500, data }, REPLI, RUN_ID);
  assert(r.ok, (r as { erreur?: string }).erreur ?? "");
  const ls = r.contentUtf8.split("\n").filter((x) => x !== "");
  const derniere = ls[ls.length - 1]!;
  const f = champs(derniere);
  assert.equal(f[47], "220");  // après l'arrondi (210)
  assert.equal(f[48], "2");    // texte
  assert(f[I_DESC].includes("Remarques: Livraison souhaitée avant Pâques"));
  assert(f[I_DESC].includes("Interne: acompte de 200 payé cash au magasin"));
  for (const l of ls) assert.equal(champs(l)[18], "", "champ 19 doit rester vide (pied de page invisible)");
});
ok("sans notes, pas de ligne 220 ; notes trop longues → tronquées à 250 + warning", () => {
  assert(!lignesGen.some((l) => champs(l)[47] === "220"));
  const data = printData({
    remarks: "x".repeat(300),
    lines: [art("shopify-1", "Table", "333", 1, 500)],
  });
  const r = buildWinbizCsv({ numeroCommande: "CMD-9", dateDocument: "2026-08-30", totalTtcColonne: 500, data }, REPLI, RUN_ID);
  assert(r.ok, (r as { erreur?: string }).erreur ?? "");
  const ls = r.contentUtf8.split("\n").filter((x) => x !== "");
  const notes = champs(ls[ls.length - 1]!)[I_DESC]!;
  assert.equal(notes.length, 250);
  assert(r.ok && r.warnings.some((w) => w.includes("tronquées à 250")));
});

console.log("── Test 10 quater : adresse de FACTURATION, jamais celle de livraison (PS du 30.08) ──");
ok("livraison différente → le fichier porte l'adresse de facturation, rien de la livraison", () => {
  const data = printData({
    nom: "FACTURE", prenom: "Client", rue: "Rue de la Facturation", numero: "10",
    npa: "1095", ville: "Lutry",
    livrDiff: true,
    livrNom: "CHANTIER", livrPrenom: "Livraison", livrRue: "Route du Chantier",
    livrNumero: "99", livrNpa: "1400", livrVille: "Yverdon",
    lines: [art("shopify-1", "Table", "333", 1, 500)],
  });
  const r = buildWinbizCsv(
    { numeroCommande: "CMD-11", dateDocument: "2026-08-30", totalTtcColonne: 500, data },
    { type: "code", code: "777", source: "nom_prenom_npa", libelle: "test" },
    RUN_ID
  );
  assert(r.ok, (r as { erreur?: string }).erreur ?? "");
  const contenu = r.contentUtf8;
  const adr = champs(contenu.split("\n").filter((x) => x !== "")[1]!);
  assert.equal(adr[22], '"FACTURE"');
  assert.equal(adr[24], '"Rue de la Facturation 10"');
  assert.equal(adr[26], '"1095"');
  for (const frag of ["CHANTIER", "Chantier", "Yverdon", "1400"]) {
    assert(!contenu.includes(frag), `fragment de l'adresse de livraison dans le fichier : ${frag}`);
  }
});

console.log("── Test 10 quinquies : ligne récap des rabais (n=215, seuil 2 %) ──");
ok("rabais de ligne >= 2 % du total → ligne texte « Montant total des rabais » avant les notes", () => {
  const data = printData({
    remarks: "Merci",
    lines: [
      art("shopify-1", "Fauteuil", "111", 2, 549, { lineDiscount: 100, lineDiscountPerUnit: 50 }),
      art("shopify-2", "Table", "222", 1, 500, { lineDiscount: 60, lineDiscountPerUnit: 60 }),
    ],
    manualRounding: "-0.50",
  });
  // total = 1098-100 + 500-60 - 0.50 = 1437.50 ; rabais récap = 160 + 0.50 = 160.50 (11 %)
  const r = buildWinbizCsv({ numeroCommande: "CMD-12", dateDocument: "2026-08-30", totalTtcColonne: 1437.5, data }, REPLI, RUN_ID);
  assert(r.ok, (r as { erreur?: string }).erreur ?? "");
  const ls = r.contentUtf8.split("\n").filter((x) => x !== "");
  const recap = ls.find((l) => champs(l)[47] === "215")!;
  assert(recap, "ligne 215 absente");
  assert.equal(champs(recap)[48], "2");
  assert.equal(champs(recap)[50], "Montant total des rabais sur la commande: CHF 160.50");
  // ordre : 215 avant les notes (220)
  const i215 = ls.findIndex((l) => champs(l)[47] === "215");
  const i220 = ls.findIndex((l) => champs(l)[47] === "220");
  assert(i215 < i220);
});
ok("rabais < 2 % du total → pas de ligne récap (on ne s'en vante pas)", () => {
  const data = printData({
    lines: [art("shopify-1", "Fauteuil", "111", 1, 1000, { lineDiscount: 10, lineDiscountPerUnit: 10 })],
  });
  // rabais 10 sur total 990 = 1.01 % → rien
  const r = buildWinbizCsv({ numeroCommande: "CMD-13", dateDocument: "2026-08-30", totalTtcColonne: 990, data }, REPLI, RUN_ID);
  assert(r.ok, (r as { erreur?: string }).erreur ?? "");
  assert(!r.contentUtf8.includes("Montant total des rabais"));
});
ok("le rabais GLOBAL (ligne 200 visible) ne compte pas dans le récap ; l'arrondi si", () => {
  // 53990 : rabais global 10 % (ligne 200 déjà visible), arrondi -2.20 seul au récap → 0.07 % → rien
  assert(!gen53990.ok || !gen53990.contentUtf8.includes("Montant total des rabais"));
});

console.log("── Test 11 : centimes entiers, formats de montants ──");
ok("fmtMontant : 1974, 163.9, 97.55, -355.8 — jamais de 23.0999…", () => {
  assert.equal(fmtMontant(197400), "1974");
  assert.equal(fmtMontant(16390), "163.9");
  assert.equal(fmtMontant(9755), "97.55");
  assert.equal(fmtMontant(-35580), "-355.8");
  assert.equal(fmtMontant(0), "0");
  assert.throws(() => fmtMontant(1.5));
});
ok("aucun montant du fichier généré ne porte plus de 2 décimales", () => {
  for (const l of [...lignesGen, ...lignes53990]) {
    const f = champs(l);
    for (const v of [f[5], f[I_PRIX]]) {
      if (v && /^-?\d/.test(v)) assert(/^-?\d+(\.\d{1,2})?$/.test(v), `montant suspect : ${v}`);
    }
  }
});

console.log("── Test 12 : encodage cp1252 ──");
ok("é è ô ü ’ – € encodés, − transposé en -, non mappable → '?' signalé", () => {
  const { bytes, nonMappables } = encodeCp1252("étè ô ü’– €−𝄞");
  const b = Array.from(bytes);
  assert.equal(b[0], 0xe9);            // é
  assert(b.includes(0x92));            // ’
  assert(b.includes(0x96));            // –
  assert(b.includes(0x80));            // €
  assert(b.includes(0x2d));            // − → '-'
  assert(b.includes(0x3f));            // 𝄞 → '?'
  assert.deepEqual(nonMappables, ["𝄞"]);
});
ok("le contenu cp1252 du fichier 54063 se décode à l'identique", () => {
  assert(gen54063.ok);
  const decode = new TextDecoder("windows-1252").decode(gen54063.contentCp1252);
  assert.equal(decode, gen54063.contentUtf8);
});

console.log("── Test 13 : nom de fichier assaini (les espaces du modèle Make ne sont pas repris) ──");
ok("nomFichier sans espaces ni accents", () => {
  const f = nomFichier("54063", "", "BERTHONZOZ", "TRISTAN", RUN_ID);
  assert.equal(f, "bizexdoc_facture_winbiz_54063_BERTHONZOZ_TRISTAN_20260418_174613_7613.csv");
  assert(!/\s/.test(f));
  const g = nomFichier("80936", "Café de l'Étoile SA", "Müller", "Jean-Luc", RUN_ID);
  assert(!/[ éèàüö']/.test(g), g);
});
ok("dates : ISO → JJ.MM.AAAA, jamais l'inverse", () => {
  assert.equal(fmtDateWinbiz("2026-08-03"), "03.08.2026");
  assert.equal(fmtDateWinbiz("18.04.2026"), "18.04.2026");
  assert.throws(() => fmtDateWinbiz("08/03/2026"));
});

console.log(`\n✅ ${nOk} tests verts — module pur conforme aux gabarits du 18.04.2026.`);
