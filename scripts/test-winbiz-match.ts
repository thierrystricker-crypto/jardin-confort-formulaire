// scripts/test-winbiz-match.ts
// Tests du matcher pur lib/winbiz-match.ts — chantier « Export Winbiz ».
// Lancement :  npx tsx scripts/test-winbiz-match.ts
//
// Les cas viennent du relevé du fichier clients réel du 29.08.2026 :
// noms avec espace de tête, doublons nom+prénom+NPA (67 clés), fiches sans
// code (1 823), codes portés par deux fiches (35, 1000), NPA étrangers,
// fiches société sans personne (694).

import { strict as assert } from "node:assert";
import {
  matchClient, preparerAdresses, normCle, normNpa,
  type AdresseWinbiz, type ClientCommande,
} from "../lib/winbiz-match";

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

const A = (code: string, partiel: Partial<AdresseWinbiz> = {}): AdresseWinbiz => ({
  code, societe: "", nom: "", prenom: "", rue: "", npa: "1095", ville: "Lutry", ...partiel,
});
const C = (partiel: Partial<ClientCommande> = {}): ClientCommande => ({
  societe: "", nom: "", prenom: "", rue: "", npa: "1095", ...partiel,
});

console.log("── Normalisations ──");
ok("normCle : accents, casse, espaces, tirets, apostrophes", () => {
  assert.equal(normCle("  MÜLLER-Dupont "), "muller dupont");
  assert.equal(normCle("D'Onofrio"), "d onofrio");
  assert.equal(normCle(" BUCHMANN"), "buchmann"); // espace de tête du fichier réel
  assert.equal(normCle("Jean–Pierre"), "jean–pierre".replace("–", "–")); // le tiret demi-cadratin n'est PAS un tiret simple
  assert.equal(normCle(null), "");
});
ok("normNpa : espaces écrasés, formats étrangers conservés", () => {
  assert.equal(normNpa(" 1095 "), "1095");
  assert.equal(normNpa("243 72"), "24372"); // NPA étranger du fichier réel
  assert.equal(normNpa(null), "");
});

console.log("── preparerAdresses (l'import) ──");
ok("les fiches sans code sont écartées et comptées", () => {
  const r = preparerAdresses([
    { code: "1003", nom: " BUCHMANN", prenom: "André", npa: "1008" },
    { code: "", nom: "SANS", prenom: "Code", npa: "1000" },
    { code: "   ", nom: "ESPACES", prenom: "Seuls", npa: "1000" },
  ]);
  assert.equal(r.adresses.length, 1);
  assert.equal(r.sansCode, 2);
  assert.equal(r.adresses[0]!.nom, "BUCHMANN"); // trimé
});
ok("un code porté par deux fiches écarte LES DEUX (jamais attribuable)", () => {
  const r = preparerAdresses([
    { code: "35", nom: "PREMIER", npa: "1000" },
    { code: "35", nom: "SECOND", npa: "2000" },
    { code: "1000", nom: "TIERS", npa: "1003" },
    { code: "1000", nom: "QUART", npa: "1004" },
    { code: "77", nom: "SAIN", npa: "1005" },
  ]);
  assert.deepEqual(r.codesDupliques, ["1000", "35"]);
  assert.equal(r.adresses.length, 1);
  assert.equal(r.adresses[0]!.code, "77");
});

console.log("── matchClient : le match fort nom+prénom+NPA ──");
ok("un seul candidat → attribué, libellé restituable à l'écran", () => {
  const r = matchClient(
    C({ nom: "Buchmann", prenom: "André", npa: "1008" }),
    [A("1003", { nom: " BUCHMANN", prenom: "André", npa: "1008", rue: "Chemin de la Cure 65" })]
  );
  assert(r.type === "code");
  assert.equal(r.code, "1003");
  assert.equal(r.source, "nom_prenom_npa");
  assert(r.libelle.includes("1003"));
});
ok("zéro candidat → repli_aucun, raison consignée", () => {
  const r = matchClient(C({ nom: "Inconnu", prenom: "Total", npa: "1008" }), []);
  assert(r.type === "repli" && r.matchType === "repli_aucun");
});
ok("prénom différent = pas un match (jamais le nom seul)", () => {
  const r = matchClient(
    C({ nom: "Graz", prenom: "Isabelle", npa: "1009" }),
    [A("501", { nom: "GRAZ", prenom: "Bernard", npa: "1009" })]
  );
  assert(r.type === "repli" && r.matchType === "repli_aucun");
});
ok("accents/casse/espaces ne bloquent pas le match", () => {
  const r = matchClient(
    C({ nom: "gedeon", prenom: "MICHEL", npa: "1095" }),
    [A("42", { nom: " GÉDÉON", prenom: "Michel", npa: "1095" })]
  );
  assert(r.type === "code" && r.code === "42");
});

console.log("── Homonymes : la rue départage, sinon repli — JAMAIS de choix silencieux ──");
const homonymes = [
  A("501", { nom: "GRAZ", prenom: "Isabelle", npa: "1009", rue: "Avenue du Léman 3" }),
  A("502", { nom: "Graz", prenom: "isabelle", npa: "1009", rue: "Chemin des Vignes 12" }),
];
ok("deux homonymes + rue départageante → attribué par la rue", () => {
  const r = matchClient(C({ nom: "Graz", prenom: "Isabelle", npa: "1009", rue: "Chemin des Vignes 12" }), homonymes);
  assert(r.type === "code");
  assert.equal(r.code, "502");
  assert.equal(r.source, "nom_prenom_npa_rue");
});
ok("deux homonymes + rue absente ou différente → repli_ambigu avec les codes en cause", () => {
  const r1 = matchClient(C({ nom: "Graz", prenom: "Isabelle", npa: "1009" }), homonymes);
  assert(r1.type === "repli" && r1.matchType === "repli_ambigu");
  assert(r1.raison.includes("501") && r1.raison.includes("502"));
  const r2 = matchClient(C({ nom: "Graz", prenom: "Isabelle", npa: "1009", rue: "Route Neuve 1" }), homonymes);
  assert(r2.type === "repli" && r2.matchType === "repli_ambigu");
});
ok("deux homonymes DONT LES DEUX rues matchent → repli (égalité non départageante)", () => {
  const memesRues = [
    A("601", { nom: "FREI", prenom: "Stewe", npa: "1807", rue: "Chemin des Cuarroz 40B" }),
    A("602", { nom: "FREI", prenom: "Stewe", npa: "1807", rue: "chemin des cuarroz 40b" }),
  ];
  const r = matchClient(C({ nom: "Frei", prenom: "Stewe", npa: "1807", rue: "Chemin des Cuarroz 40B" }), memesRues);
  assert(r.type === "repli" && r.matchType === "repli_ambigu");
});

console.log("── NPA : le périmètre du match ──");
ok("NPA différent = pas un candidat, même nom+prénom identiques", () => {
  const r = matchClient(
    C({ nom: "Buchmann", prenom: "André", npa: "1008" }),
    [A("1003", { nom: "BUCHMANN", prenom: "André", npa: "1009" })]
  );
  assert(r.type === "repli" && r.matchType === "repli_aucun");
});
ok("commande sans NPA → repli, jamais un match toutes-communes", () => {
  const r = matchClient(C({ nom: "Buchmann", prenom: "André", npa: "" }), [A("1003", { nom: "BUCHMANN", prenom: "André" })]);
  assert(r.type === "repli" && r.raison.includes("NPA"));
});
ok("NPA étranger à espaces : normalisé des deux côtés", () => {
  const r = matchClient(
    C({ nom: "Schmidt", prenom: "Anna", npa: "243 72" }),
    [A("801", { nom: "SCHMIDT", prenom: "Anna", npa: "24372" })]
  );
  assert(r.type === "code" && r.code === "801");
});

console.log("── Sociétés sans personne (694 fiches du fichier réel) ──");
ok("commande sans nom + société unique au NPA → societe_npa", () => {
  const r = matchClient(
    C({ societe: "Brasserie de Montbenon Sàrl", npa: "1003" }),
    [A("701", { societe: "BRASSERIE DE MONTBENON SARL", npa: "1003" })]
  );
  assert(r.type === "code" && r.source === "societe_npa");
});
ok("commande AVEC nom de personne : jamais de rattrapage silencieux par la société", () => {
  const r = matchClient(
    C({ nom: "Dupont", prenom: "Marc", societe: "Brasserie de Montbenon Sàrl", npa: "1003" }),
    [A("701", { societe: "BRASSERIE DE MONTBENON SARL", npa: "1003" })]
  );
  assert(r.type === "repli" && r.matchType === "repli_aucun");
});
ok("deux sociétés homonymes au même NPA → repli_ambigu", () => {
  const r = matchClient(
    C({ societe: "LO Immeubles SA", npa: "1003" }),
    [A("702", { societe: "LO IMMEUBLES SA", npa: "1003" }), A("703", { societe: "Lo Immeubles SA", npa: "1003" })]
  );
  assert(r.type === "repli" && r.matchType === "repli_ambigu");
});

console.log("── Défense en profondeur ──");
ok("un candidat sans code fourni par erreur est ignoré", () => {
  const r = matchClient(
    C({ nom: "Buchmann", prenom: "André", npa: "1008" }),
    [A("", { nom: "BUCHMANN", prenom: "André", npa: "1008" })]
  );
  assert(r.type === "repli");
});
ok("un candidat au mauvais NPA fourni par erreur est refiltré", () => {
  const r = matchClient(
    C({ nom: "Buchmann", prenom: "André", npa: "1008" }),
    [A("1003", { nom: "BUCHMANN", prenom: "André", npa: "9999" })]
  );
  assert(r.type === "repli");
});

console.log(`\n✅ ${nOk} tests verts — matcher conforme au cadrage §6.2 et au fichier réel du 29.08.`);
