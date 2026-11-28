// lib/traductions-sentinelle.ts
// ─────────────────────────────────────────────────────────────────────────────
// Sentinelle traductions DE / EN du webshop jardin-confort.ch (28.11.2026).
//
// Contexte : les traductions DE / EN sont écrites par l'app Shopify T Lab
// (moteur DeepL), qui retraduit une fiche ~2 min après chaque changement du
// français. DeepL n'a pas d'allemand de Suisse : il écrit toujours « ß ».
// La sentinelle relit chaque nuit ce que T Lab a réécrit et range les
// anomalies en base.
//
// Déroulé d'un passage :
//   1. produits actifs + collections modifiés depuis `depuis` (Admin GraphQL) ;
//   2. leurs traductions DE / EN ; on ne garde que les champs réécrits depuis ;
//   3. règles fixes (lib/traductions-regles.ts) sur tout ;
//   4. relecture Claude FR ↔ DE / EN, plafonnée par passage ;
//   5. CORRECTION AUTOMATIQUE des règles sûres (ß → ss, Sthul, Bodenhülsel,
//      Keramik, available to order, pouf hors Fatboy) — SEULEMENT si la
//      variable d'environnement TRADUCTIONS_AUTO_CORRECTION vaut « 1 ».
//      Les propositions de Claude ne sont JAMAIS appliquées automatiquement :
//      elles s'appliquent une à une depuis la page (bouton « Appliquer ») ;
//   6. anomalies nouvelles → seo_traductions_controles (dédoublonnées ; les
//      « faux positif » / « ignoré » ne reviennent pas) ; bilan →
//      seo_traductions_runs ; notification si nouvelles anomalies à traiter.
//
// Base app uniquement (supabaseAdmin). Jamais la base webshop.
// ─────────────────────────────────────────────────────────────────────────────

import { supabaseAdmin } from "@/lib/supabase";
import { createNotificationUnique } from "@/lib/notifications";
import {
  appliquerRegles, appliquerCorrectionsSures, texteBrut, CHAMPS,
  type Anomalie, type Champ, type Langue,
} from "@/lib/traductions-regles";
import {
  gql, lireRessources, ecrireTraductions, messageErreur,
  type TraductionAEcrire,
} from "@/lib/traductions-shopify";

const MODELE = process.env.CLAUDE_TRADUCTIONS_MODEL ?? "claude-sonnet-5-5";
const MAX_CLAUDE_DEFAUT = Number(process.env.TRADUCTIONS_MAX_CLAUDE ?? "30");
const AUTO_CORRECTION = process.env.TRADUCTIONS_AUTO_CORRECTION === "1";
const CONCURRENCE_CLAUDE = 4;
const MAX_RESSOURCES = 3000; // garde-fou : au-delà, on s'arrête (journalisé)
const LANGUES: Langue[] = ["de", "en"];

/**
 * Marques suivies de près (demande de Thierry, 28.11.2026) : leurs fiches
 * retraduites sont TOUJOURS relues par Claude, hors plafond. Les collections
 * n'ont pas de marque : on regarde si l'adresse (handle) contient le nom.
 */
export const MARQUES_PRIORITAIRES = ["fermob", "glatz", "suncomfort", "fatboy", "schaffner"];

export function estPrioritaire(marque: string | null, handle: string): boolean {
  const m = (marque || "").toLowerCase();
  const h = handle.toLowerCase();
  return MARQUES_PRIORITAIRES.some((p) => m.includes(p) || h.includes(p));
}

/** Préfixe des notes des lots de rattrapage (exclus du calcul de `depuis`). */
export const PREFIXE_RATTRAPAGE = "Rattrapage";

type Ressource = {
  id: string;                      // gid
  type: "produit" | "collection";
  handle: string;
  marque: string | null;
};

async function listerModifiees(depuis: string): Promise<{ ressources: Ressource[]; tronque: boolean }> {
  const out: Ressource[] = [];
  let tronque = false;

  const listes: Array<{ type: Ressource["type"]; racine: "products" | "collections"; filtre: string; champs: string }> = [
    { type: "produit", racine: "products", filtre: `updated_at:>'${depuis}' AND status:active`, champs: "id handle vendor" },
    { type: "collection", racine: "collections", filtre: `updated_at:>'${depuis}'`, champs: "id handle" },
  ];

  for (const l of listes) {
    let apres: string | null = null;
    for (;;) {
      const q = `query($q: String!, $apres: String) {
        ${l.racine}(first: 250, after: $apres, query: $q) {
          pageInfo { hasNextPage endCursor }
          nodes { ${l.champs} }
        }
      }`;
      type Page = { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: Array<{ id: string; handle: string; vendor?: string }> };
      const data: Record<string, Page> = await gql<Record<string, Page>>(q, { q: l.filtre, apres });
      const page: Page = data[l.racine];
      for (const n of page.nodes) {
        out.push({ id: n.id, type: l.type, handle: n.handle, marque: n.vendor ?? null });
      }
      if (out.length >= MAX_RESSOURCES) { tronque = true; break; }
      if (!page.pageInfo.hasNextPage) break;
      apres = page.pageInfo.endCursor;
    }
    if (tronque) break;
  }
  return { ressources: out.slice(0, MAX_RESSOURCES), tronque };
}

type ChampTraduit = { langue: Langue; champ: Champ; fr: string; digest: string; traduit: string; majAt: string };

/** Champs DE / EN réécrits depuis `depuis`, avec le français et son digest. */
async function lireTraductionsRecentes(ids: string[], depuis: string): Promise<Map<string, ChampTraduit[]>> {
  const out = new Map<string, ChampTraduit[]>();
  const seuil = new Date(depuis).getTime();
  for (const r of await lireRessources(ids)) {
    const champs: ChampTraduit[] = [];
    for (const langue of LANGUES) {
      for (const [key, t] of r.traductions[langue]) {
        if (!CHAMPS.includes(key as Champ) || !t.updatedAt) continue;
        if (new Date(t.updatedAt).getTime() <= seuil) continue;
        const fr = r.contenu.get(key);
        if (!fr) continue;
        champs.push({ langue, champ: key as Champ, fr: fr.value, digest: fr.digest, traduit: t.value, majAt: t.updatedAt });
      }
    }
    if (champs.length) out.set(r.resourceId, champs);
  }
  return out;
}

// ── Relecture Claude ────────────────────────────────────────────────────────

function consigneClaude(r: Ressource, champs: ChampTraduit[]): string {
  const blocs: string[] = [];
  const parCle = new Map<Champ, ChampTraduit[]>();
  for (const c of champs) parCle.set(c.champ, [...(parCle.get(c.champ) ?? []), c]);
  const couper = (s: string) => (s.length > 6000 ? s.slice(0, 6000) + " […]" : s);
  for (const [champ, liste] of parCle) {
    const net = (v: string) => couper(champ === "body_html" ? texteBrut(v) : v);
    blocs.push(`### Champ ${champ}\nFR (fait foi) : ${net(liste[0].fr)}`);
    for (const c of liste) blocs.push(`${c.langue.toUpperCase()} : ${net(c.traduit)}`);
  }

  const noteCollection = r.type === "collection"
    ? `\nATTENTION, c'est une page COLLECTION : son titre, son meta titre et sa meta description ont souvent été rédigés exprès pour un mot-clé de recherche (ex. « Gartentische », « Fermob Gartenmöbel »). Ne signale PAS un synonyme ou une formulation différente du français dans ces champs : seulement une vraie faute, un nom perdu ou une phrase restée en français.`
    : "";

  return `Tu es relecteur-traducteur professionnel FR > DE / EN pour un webshop suisse de mobilier de jardin haut de gamme (jardin-confort.ch). Une app de traduction automatique (DeepL + glossaire) a écrit les versions DE et EN ci-dessous. Signale UNIQUEMENT les vraies erreurs qui nuisent au sens ou au référencement :
- contresens, terme technique faux, mot du glossaire appliqué hors contexte (ex. un pouf traduit « Sitzsack » / « bean bag » alors que ce n'est pas un pouf-sac ; toile de parasol traduite « Leinwand » au lieu de « Bespannung » ; « allée » traduite « Einfahrt » au lieu de « Gartenweg » ; teck qui « grisonne » traduit « nachdunkelt » au lieu de « vergraut ») ;
- nom de marque, de collection ou de modèle perdu, déplacé, doublé, collé ou traduit (les noms propres ne se traduisent jamais ; le numéro ou suffixe d'un modèle reste collé à son nom) ;
- passage resté en français, ou en allemand dans la version anglaise ;
- mot ou groupe de mots répété inutilement, mots collés, phrase incompréhensible, faute de frappe ;
- chiffre, dimension, référence ou code coloris différent du français.
N'en signale PAS : choix de style acceptables, ß (corrigé automatiquement ailleurs), « available to order » (corrigé ailleurs), listes de coloris qui répètent un mot, tournures simplement perfectibles.${noteCollection}
Repères : allemand de Suisse (ss, jamais ß), vouvoiement (Sie). Pouf (non Fatboy) = DE « Pouf », EN « pouf ». Fauteuil repas = DE « Gartensessel » / EN « dining armchair ». Chaise repas = EN « dining chair ». Toile = « Bespannung » ou « Stoff ». Résine tressée = « Polyrattan-Geflecht » / « synthetic wicker ». Chiné = « meliert » / « melange ». Borne solaire = « Solar-Pollerleuchte » / « solar bollard light ». Sur commande = « auf Bestellung » / « made to order ».

Marque : ${r.marque ?? "(collection)"} — ${r.type} « ${r.handle} »

${blocs.join("\n\n")}

Réponds UNIQUEMENT avec un objet JSON, sans texte autour :
{"anomalies":[{"langue":"de|en","champ":"title|body_html|meta_title|meta_description","type":"contresens|nom_perdu|terme_faux|non_traduit|redondance|faute|chiffre|autre","extrait":"passage fautif","correction":"ce même passage corrigé"}]}
RÈGLES POUR « extrait » ET « correction » (elles servent à corriger automatiquement par recherche-remplacement) :
- « extrait » doit être copié EXACTEMENT, caractère pour caractère, depuis la version DE ou EN ci-dessus (même casse, même ponctuation, mêmes espaces) ;
- le plus court possible (quelques mots, jamais plus d'une phrase), sans saut de ligne ;
- « correction » remplace exactement « extrait » et rien d'autre.
Si tout est correct : {"anomalies":[]}`;
}

/** Appel simple à l'API Anthropic (un message, réponse texte). */
export async function appelerClaude(consigne: string, maxTokens = 2000): Promise<string> {
  const cle = process.env.ANTHROPIC_API_KEY;
  if (!cle) throw new Error("ANTHROPIC_API_KEY absente");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": cle, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: MODELE,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: consigne }],
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Anthropic ${res.status} : ${detail.slice(0, 300)}`);
  }
  const json = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  return (json.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
}

async function relireAvecClaude(r: Ressource, champs: ChampTraduit[]): Promise<Anomalie[]> {
  const texte = await appelerClaude(consigneClaude(r, champs));
  const debut = texte.indexOf("{");
  const fin = texte.lastIndexOf("}");
  if (debut < 0 || fin <= debut) return [];
  let brut: { anomalies?: Array<Record<string, unknown>> };
  try { brut = JSON.parse(texte.slice(debut, fin + 1)); } catch { return []; }

  const champsRelus = new Set(champs.map((c) => `${c.langue}|${c.champ}`));
  const out: Anomalie[] = [];
  for (const a of brut.anomalies ?? []) {
    const langue = a.langue as Langue;
    const champ = a.champ as Champ;
    if (!LANGUES.includes(langue) || !CHAMPS.includes(champ)) continue;
    if (!champsRelus.has(`${langue}|${champ}`)) continue;
    const extrait = String(a.extrait ?? "").slice(0, 500);
    if (!extrait) continue;
    out.push({
      langue, champ,
      regle: `claude_${String(a.type ?? "autre").replace(/[^a-z_]/g, "") || "autre"}`,
      source: "claude",
      extrait,
      correction_proposee: a.correction ? String(a.correction).slice(0, 1000) : null,
      // Jamais automatique : une proposition de Claude se valide à la main
      // (bouton « Appliquer » de la page).
      auto_corrigeable: false,
    });
  }
  return out;
}

async function enParallele<T>(elements: T[], n: number, fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  const travailleurs = Array.from({ length: Math.min(n, elements.length) }, async () => {
    while (i < elements.length) {
      const x = elements[i++];
      await fn(x);
    }
  });
  await Promise.all(travailleurs);
}

// ── Passage complet ─────────────────────────────────────────────────────────

export type ResultatSentinelle = {
  run_id: string | null;
  depuis: string;
  ressources_modifiees: number;
  ressources_retraduites: number;
  relues_claude: number;
  non_relues_claude: number;
  anomalies_trouvees: number;
  anomalies_nouvelles: number;
  auto_correction: boolean;
  champs_corriges: number;
  erreurs: string[];
};

type LigneControle = {
  run_id: string | null;
  ressource_type: Ressource["type"];
  ressource_id: string;
  handle: string;
  marque: string | null;
  langue: Langue;
  champ: Champ;
  regle: string;
  source: "regle" | "claude";
  extrait: string;
  correction_proposee: string | null;
  auto_corrigeable: boolean;
  traduction_maj_at: string | null;
  statut?: "nouveau" | "corrige";
  traite_at?: string | null;
};

const cleDedup = (l: { ressource_id: string; langue: string; champ: string; regle: string; extrait: string | null }) =>
  [l.ressource_id, l.langue, l.champ, l.regle, (l.extrait ?? "").replace(/\s+/g, " ").trim()].join("|");

/**
 * Fin du dernier passage nocturne / manuel terminé sans erreur (les lots de
 * rattrapage sont exclus), sinon il y a 26 h. On part de la FIN du passage :
 * les corrections écrites par la sentinelle elle-même ne sont pas relues.
 */
async function depuisDernierPassage(): Promise<string> {
  const { data } = await supabaseAdmin
    .from("seo_traductions_runs")
    .select("finished_at, notes")
    .not("finished_at", "is", null)
    .is("erreur", null)
    .order("finished_at", { ascending: false })
    .limit(20);
  const lignes = (data as Array<{ finished_at: string; notes: string | null }> | null) ?? [];
  const dernier = lignes.find((l) => !(l.notes ?? "").startsWith(PREFIXE_RATTRAPAGE))?.finished_at;
  return dernier ?? new Date(Date.now() - 26 * 3600 * 1000).toISOString();
}

export async function lancerSentinelle(opts: { depuis?: string; maxClaude?: number } = {}): Promise<ResultatSentinelle> {
  const depuis = opts.depuis ?? (await depuisDernierPassage());
  const maxClaude = opts.maxClaude ?? MAX_CLAUDE_DEFAUT;
  const erreurs: string[] = [];
  const res: ResultatSentinelle = {
    run_id: null, depuis, ressources_modifiees: 0, ressources_retraduites: 0,
    relues_claude: 0, non_relues_claude: 0, anomalies_trouvees: 0, anomalies_nouvelles: 0,
    auto_correction: AUTO_CORRECTION, champs_corriges: 0, erreurs,
  };

  const { data: run, error: errRun } = await supabaseAdmin
    .from("seo_traductions_runs")
    .insert({ notes: `depuis ${depuis}` })
    .select("id")
    .single();
  if (errRun) throw new Error(`seo_traductions_runs : ${errRun.message}`);
  res.run_id = (run as { id: string }).id;

  let erreurFatale: string | null = null;
  try {
    // 1-2. Ce que T Lab a réécrit
    const { ressources, tronque } = await listerModifiees(depuis);
    res.ressources_modifiees = ressources.length;
    if (tronque) erreurs.push(`Plus de ${MAX_RESSOURCES} fiches modifiées : liste tronquée`);
    const traductions = await lireTraductionsRecentes(ressources.map((r) => r.id), depuis);
    const aControler = ressources.filter((r) => traductions.has(r.id));
    res.ressources_retraduites = aControler.length;

    // 3. Règles fixes
    const lignes: LigneControle[] = [];
    const versLigne = (r: Ressource, a: Anomalie, majAt: string | null): LigneControle => ({
      run_id: res.run_id, ressource_type: r.type, ressource_id: r.id, handle: r.handle, marque: r.marque,
      langue: a.langue, champ: a.champ, regle: a.regle, source: a.source, extrait: a.extrait,
      correction_proposee: a.correction_proposee, auto_corrigeable: a.auto_corrigeable, traduction_maj_at: majAt,
    });
    for (const r of aControler) {
      for (const c of traductions.get(r.id)!) {
        for (const a of appliquerRegles({ langue: c.langue, champ: c.champ, fr: c.fr, traduit: c.traduit, marque: r.marque, collection: r.type === "collection" })) {
          lignes.push(versLigne(r, a, c.majAt));
        }
      }
    }

    // 4. Relecture Claude — marques suivies de près : toujours, hors plafond ;
    //    les autres : titres réécrits d'abord, dans la limite du plafond.
    const prioritaires = aControler.filter((r) => estPrioritaire(r.marque, r.handle));
    const autres = aControler
      .filter((r) => !estPrioritaire(r.marque, r.handle))
      .sort((a, b) => {
        const t = (r: Ressource) => (traductions.get(r.id)!.some((c) => c.champ === "title") ? 0 : 1);
        return t(a) - t(b);
      });
    const relues = [...prioritaires, ...autres.slice(0, Math.max(0, maxClaude))];
    res.non_relues_claude = aControler.length - relues.length;
    await enParallele(relues, CONCURRENCE_CLAUDE, async (r) => {
      const champs = traductions.get(r.id)!;
      try {
        const trouvees = await relireAvecClaude(r, champs);
        const majAt = champs[0]?.majAt ?? null;
        for (const a of trouvees) lignes.push(versLigne(r, a, majAt));
        res.relues_claude++;
      } catch (e) {
        if (erreurs.length < 10) erreurs.push(`Claude ${r.handle} : ${messageErreur(e).slice(0, 200)}`);
      }
    });
    res.anomalies_trouvees = lignes.length;

    // 5. Correction automatique des règles sûres (si activée)
    if (AUTO_CORRECTION) {
      const maintenant = new Date().toISOString();
      for (const r of aControler) {
        const items: TraductionAEcrire[] = [];
        const corrigees = new Set<string>(); // langue|champ|regle
        for (const c of traductions.get(r.id)!) {
          const aCorriger = lignes.some((l) => l.ressource_id === r.id && l.langue === c.langue && l.champ === c.champ && l.auto_corrigeable);
          if (!aCorriger) continue;
          const { valeur, regles } = appliquerCorrectionsSures(c.traduit, c.langue, { marque: r.marque, fr: c.fr, collection: r.type === "collection" });
          if (valeur === c.traduit) continue;
          items.push({ locale: c.langue, key: c.champ, value: valeur, digest: c.digest });
          for (const rg of regles) corrigees.add(`${c.langue}|${c.champ}|${rg}`);
        }
        if (!items.length) continue;
        try {
          await ecrireTraductions(r.id, items);
          res.champs_corriges += items.length;
          for (const l of lignes) {
            if (l.ressource_id === r.id && l.auto_corrigeable && corrigees.has(`${l.langue}|${l.champ}|${l.regle}`)) {
              l.statut = "corrige";
              l.traite_at = maintenant;
            }
          }
        } catch (e) {
          if (erreurs.length < 10) erreurs.push(`Correction ${r.handle} : ${messageErreur(e).slice(0, 200)}`);
        }
      }
    }

    // 6. Dédoublonnage contre la base puis insertion
    const dejaVues = new Set<string>();
    const idsTouches = Array.from(new Set(lignes.map((l) => l.ressource_id)));
    for (let i = 0; i < idsTouches.length; i += 50) {
      const { data, error } = await supabaseAdmin
        .from("seo_traductions_controles")
        .select("ressource_id, langue, champ, regle, extrait, statut")
        .in("ressource_id", idsTouches.slice(i, i + 50));
      if (error) throw new Error(`lecture seo_traductions_controles : ${error.message}`);
      for (const l of (data ?? []) as Array<{ ressource_id: string; langue: string; champ: string; regle: string; extrait: string | null; statut: string }>) {
        // Une anomalie marquée « corrigé » qui réapparaît = régression → on la reprend.
        if (l.statut !== "corrige") dejaVues.add(cleDedup(l));
      }
    }
    const nouvelles: LigneControle[] = [];
    for (const l of lignes) {
      const k = cleDedup(l);
      if (dejaVues.has(k)) continue;
      dejaVues.add(k);
      nouvelles.push(l);
    }
    for (let i = 0; i < nouvelles.length; i += 200) {
      const { error } = await supabaseAdmin.from("seo_traductions_controles").insert(nouvelles.slice(i, i + 200));
      if (error) throw new Error(`écriture seo_traductions_controles : ${error.message}`);
    }
    res.anomalies_nouvelles = nouvelles.length;

    const aTraiter = nouvelles.filter((l) => l.statut !== "corrige").length;
    if (aTraiter > 0) {
      await createNotificationUnique({
        type: "traductions_anomalies",
        titre: `🌐 ${aTraiter} anomalie(s) de traduction DE / EN à traiter`,
        message: "Relevées par la sentinelle de cette nuit : à relire et valider sur la page Traductions DE / EN.",
      }, 20);
    }
  } catch (e) {
    erreurFatale = messageErreur(e).slice(0, 1000);
  }

  const notes = [
    `depuis ${depuis}`,
    `${res.ressources_modifiees} fiches modifiées, ${res.ressources_retraduites} retraduites`,
    `Claude : ${res.relues_claude} relues, ${res.non_relues_claude} hors plafond`,
    AUTO_CORRECTION ? `correction auto : ${res.champs_corriges} champ(s) corrigé(s)` : "correction auto désactivée",
    ...erreurs,
  ].join(" · ");
  await supabaseAdmin
    .from("seo_traductions_runs")
    .update({
      finished_at: new Date().toISOString(),
      nb_ressources: res.ressources_retraduites,
      nb_anomalies: res.anomalies_nouvelles,
      nb_relues_claude: res.relues_claude,
      notes,
      erreur: erreurFatale,
    })
    .eq("id", res.run_id);

  if (erreurFatale) throw new Error(erreurFatale);
  return res;
}
