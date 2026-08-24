// scripts/rattrapage-documents.mjs
// ═══════════════════════════════════════════════════════════════════════════
// Rattrapage one-shot — chantier « PDF de commande toujours à jour » (24.08.2026)
//
// Régénère les documents périmés des commandes modifiées AVANT le déploiement
// du chantier (le futur est couvert automatiquement par corrections/reviser) :
//   • PDF commande       : commandes révisées ou corrigées, stock figé présent
//   • QR paiement        : commandes révisées, ou coordonnées client corrigées
//   • Fiche de travail COURANTE : si elle existait déjà (jamais l'initiale)
//
// La liste des dossiers est FERMÉE, extraite de la base le 24.08.2026 — le
// script ne fait aucune sélection lui-même. 80 dossiers, 149 appels pdf.co.
//
// SANS RISQUE : ces routes ne font que lire la page print (lignes figées J0),
// générer un PDF et l'écrire en Storage. Aucun mouvement de stock, jamais.
// La route /pdf archive d'elle-même le PDF d'origine (pdf_initial_url) avant
// le premier écrasement.
//
// Usage (depuis la racine du dépôt, Node 18+) :
//   node scripts/rattrapage-documents.mjs --dry-run   → montre ce qui serait fait
//   node scripts/rattrapage-documents.mjs             → exécute
//   node scripts/rattrapage-documents.mjs --limit 5   → seulement 5 dossiers (test)
//
// Reprise : la progression est écrite dans rattrapage-log.json — relancer le
// script saute ce qui a déjà réussi et ne refait que les échecs.
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync, existsSync } from "node:fs";

// ── Config depuis .env.local ────────────────────────────────────────────────
function lireEnvLocal() {
  const env = {};
  try {
    for (const ligne of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
      const m = ligne.match(/^([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);
      if (m) env[m[1]] = m[2];
    }
  } catch { /* pas de .env.local : on tentera process.env */ }
  return env;
}
const envLocal = lireEnvLocal();
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || envLocal.NEXT_PUBLIC_APP_URL || "https://offres.jardin-confort.ch";
const SECRET  = process.env.DASHBOARD_SESSION_SECRET || envLocal.DASHBOARD_SESSION_SECRET || "";
if (!SECRET) {
  console.error("✗ DASHBOARD_SESSION_SECRET introuvable (.env.local) — impossible d'appeler les routes protégées.");
  process.exit(1);
}
const EN_TETE = { "x-jc-interne": SECRET, "Content-Type": "application/json" };

// ── La liste fermée : [slug, pdf, qr, fiche] (1 = à régénérer) ─────────────
const DOSSIERS = [
  ["cmd-80554-dod4t",1,1,0],
  ["cmd-80555-xx9ya",1,1,0],
  ["cmd-80563-1ifmg",1,0,0],
  ["cmd-80575-cvaws",1,1,1],
  ["cmd-80579-bdakv",1,1,1],
  ["cmd-80580-3066g",1,1,1],
  ["cmd-80591-9gwar",1,0,0],
  ["cmd-80595-71yhr",1,1,0],
  ["cmd-80597-94mo4",1,0,0],
  ["cmd-80605-jpgac",1,0,0],
  ["cmd-80611-m6xfy",1,0,0],
  ["cmd-80621-vna6f",1,1,0],
  ["cmd-80624-i4bk1",1,1,0],
  ["cmd-80627-ek1gy",1,0,0],
  ["cmd-80628-7q98n",1,1,0],
  ["cmd-80629-o4ils",1,1,0],
  ["cmd-80630-nb5wg",1,1,0],
  ["cmd-80636-xezdi",1,0,0],
  ["cmd-80638-cje5z",1,0,1],
  ["cmd-80654-moh8r",1,1,0],
  ["cmd-80666-l8i6x",0,1,0],
  ["cmd-80690-40ei6",1,0,0],
  ["cmd-80694-1u7k1",1,1,0],
  ["cmd-80695-xu9vo",1,1,0],
  ["cmd-80696-grqdf",1,1,0],
  ["cmd-80710-ssm04",1,0,0],
  ["cmd-80714-0dbrc",1,1,0],
  ["cmd-80715-6h7u5",1,0,0],
  ["cmd-80727-hi3s3",1,1,0],
  ["cmd-80728-llo7k",1,1,1],
  ["cmd-80729-2iisb",1,1,0],
  ["cmd-80738-aclhj",1,0,0],
  ["cmd-80740-camv5",1,0,0],
  ["cmd-80743-lz1f9",1,0,0],
  ["cmd-80750-8r924",1,1,0],
  ["cmd-80764-y8mxr",1,1,0],
  ["cmd-80765-bgfe1",1,1,0],
  ["cmd-80770-87jxa",1,1,0],
  ["cmd-80775-wzuhx",1,1,0],
  ["cmd-80779-dtpuy",1,1,0],
  ["cmd-80780-0v5lk",1,1,0],
  ["cmd-80781-qj8sd",1,1,0],
  ["cmd-80782-6zvbt",1,1,0],
  ["cmd-80787-9ovft",1,1,0],
  ["cmd-80788-pi4gg",1,1,0],
  ["cmd-80794-31ewk",1,1,0],
  ["cmd-80797-o0i7h",1,1,0],
  ["cmd-80799-999kt",1,1,0],
  ["cmd-80802-uvxkl",1,1,0],
  ["cmd-80803-ubn3c",1,1,0],
  ["cmd-80805-f19hj",1,1,0],
  ["cmd-80808-x008x",1,1,0],
  ["cmd-80813-jhw1m",1,1,0],
  ["cmd-80818-9tl2s",1,1,0],
  ["cmd-80819-q4fkp",1,1,0],
  ["cmd-80823-elult",1,1,0],
  ["cmd-80826-4951r",1,1,0],
  ["cmd-80830-32x1l",1,1,0],
  ["cmd-80831-22edu",1,1,0],
  ["cmd-80834-k9kwe",1,1,0],
  ["cmd-80836-tbi5y",1,1,0],
  ["cmd-80841-tdx70",1,1,0],
  ["cmd-80848-ytpp1",1,1,0],
  ["cmd-80863-hvcrp",1,1,0],
  ["cmd-80865-3hyty",1,1,0],
  ["cmd-80868-get1w",1,1,0],
  ["cmd-80869-ehx4k",1,1,0],
  ["cmd-80875-74tgv",1,1,0],
  ["cmd-80877-8vzw5",1,1,0],
  ["cmd-80878-ps59z",1,1,0],
  ["cmd-80883-vz35v",1,1,0],
  ["cmd-80886-vreu2",1,1,0],
  ["cmd-80889-6u6po",1,1,0],
  ["cmd-80892-x24se",1,0,1],
  ["cmd-80893-wd9xb",1,1,0],
  ["cmd-80894-p062k",1,1,0],
  ["cmd-80895-8lfjh",1,1,0],
  ["cmd-80900-gs3eh",1,1,0],
  ["cmd-80909-069s7",1,0,0],
  ["cmd-80912-9lizo",1,1,0]
];

// ── Options ────────────────────────────────────────────────────────────────
const DRY   = process.argv.includes("--dry-run");
const limIx = process.argv.indexOf("--limit");
const LIMIT = limIx > -1 ? parseInt(process.argv[limIx + 1], 10) : Infinity;
const PAUSE_MS = 3000; // entre chaque appel pdf.co — ménage l'API et Vercel

// ── Journal de progression (reprise) ───────────────────────────────────────
const LOG = "rattrapage-log.json";
const fait = existsSync(LOG) ? JSON.parse(readFileSync(LOG, "utf8")) : {};
const sauver = () => writeFileSync(LOG, JSON.stringify(fait, null, 1));

const dodo = (ms) => new Promise((r) => setTimeout(r, ms));

async function appel(slug, tache) {
  const routes = {
    pdf:   { url: `${APP_URL}/api/offres/${slug}/pdf`,   body: undefined },
    qr:    { url: `${APP_URL}/api/offres/${slug}/qr`,    body: undefined },
    fiche: { url: `${APP_URL}/api/offres/${slug}/fiche-travail-pdf`, body: JSON.stringify({ mode: "current" }) },
  };
  const r = routes[tache];
  const res = await fetch(r.url, { method: "POST", headers: EN_TETE, body: r.body });
  const json = await res.json().catch(() => ({}));
  if (res.ok && (json.success || json.pdf_url || json.qr_url)) return { ok: true };
  return { ok: false, err: json.error || `HTTP ${res.status}` };
}

// ── Boucle principale : séquentielle, un appel à la fois ───────────────────
const dossiers = DOSSIERS.slice(0, LIMIT);
let nOk = 0, nKo = 0, nSkip = 0;
console.log(`Rattrapage ${DRY ? "(DRY-RUN) " : ""}— ${dossiers.length} dossiers, cible ${APP_URL}`);

for (let i = 0; i < dossiers.length; i++) {
  const [slug, doPdf, doQr, doFiche] = dossiers[i];
  const taches = [doPdf && "pdf", doQr && "qr", doFiche && "fiche"].filter(Boolean);
  for (const t of taches) {
    const cle = `${slug}:${t}`;
    if (fait[cle] === "ok") { nSkip++; continue; }
    if (DRY) { console.log(`  [dry] ${slug} → ${t}`); continue; }
    process.stdout.write(`[${i + 1}/${dossiers.length}] ${slug} → ${t} … `);
    try {
      const r = await appel(slug, t);
      if (r.ok) { fait[cle] = "ok"; nOk++; console.log("OK"); }
      else      { fait[cle] = "ECHEC: " + r.err; nKo++; console.log("ÉCHEC —", r.err); }
    } catch (e) {
      fait[cle] = "ECHEC: " + String(e); nKo++; console.log("ÉCHEC —", String(e));
    }
    sauver();
    await dodo(PAUSE_MS);
  }
}

console.log(`\nTerminé. OK: ${nOk} · Échecs: ${nKo} · Déjà faits (sautés): ${nSkip}`);
if (nKo > 0) console.log("Relancer le script pour ne rejouer que les échecs (voir rattrapage-log.json).");
