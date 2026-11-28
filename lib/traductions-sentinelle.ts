// lib/traductions-sentinelle.ts
// ─────────────────────────────────────────────────────────────────────────────
// Sentinelle traductions DE / EN du webshop jardin-confort.ch (28.11.2026).
//
// Contexte : les traductions DE / EN sont écrites par l'app Shopify T Lab, qui
// retraduit une fiche ~2 min après chaque changement du français. Un lot de
// décembre 2025 a laissé des centaines d'erreurs pénalisantes pour le SEO
// (noms de modèles perdus, « Sthul », mots collés…). La sentinelle relit
// chaque nuit ce que T Lab a réécrit et range les anomalies en base.
//
// Déroulé d'un passage :
//   1. produits actifs + collections modifiés depuis `depuis` (Admin GraphQL) ;
//   2. leurs traductions DE / EN ; on ne garde que les champs que T Lab a
//      réécrits depuis `depuis` ;
//   3. règles fixes (lib/traductions-regles.ts) sur tout ;
//   4. relecture Claude FR ↔ DE / EN, plafonnée par passage ;
//   5. anomalies nouvelles → seo_traductions_controles (dédoublonnées,
//      les « faux positif » / « ignoré » ne reviennent pas) ; bilan →
//      seo_traductions_runs ; notification si nouvelles anomalies.
//
// PHASE 1 = RAPPORT SEUL : AUCUNE écriture dans Shopify. La correction
// automatique (via le scénario Make 8645741, qui a l'accès en écriture aux
// traductions) viendra dans un second temps, règle par règle.
//
// Base app uniquement (supabaseAdmin). Jamais la base webshop.
// ─────────────────────────────────────────────────────────────────────────────

import { supabaseAdmin } from "@/lib/supabase";
import { createNotificationUnique } from "@/lib/notifications";
import {
  appliquerRegles, texteBrut, CHAMPS,
  type Anomalie, type Champ, type Langue,
} from "@/lib/traductions-regles";

const SHOP = process.env.SHOPIFY_STORE_DOMAIN;
const ADMIN_CLIENT_ID = process.env.SHOPIFY_ADMIN_CLIENT_ID;
const ADMIN_CLIENT_SECRET = process.env.SHOPIFY_ADMIN_CLIENT_SECRET;
const API = "2026-04";

const MODELE = process.env.CLAUDE_TRADUCTIONS_MODEL ?? "claude-sonnet-5-5";
const MAX_CLAUDE_DEFAUT = Number(process.env.TRADUCTIONS_MAX_CLAUDE ?? "30");
const CONCURRENCE_CLAUDE = 4;
const MAX_RESSOURCES = 3000; // garde-fou : au-delà, on s'arrête (journalisé)
const LANGUES: Langue[] = ["de", "en"];

// ── Shopify Admin ──────────────────────────────────────────────────────────

let jetonCache: string | null = null;
let jetonExpire = 0;

async function jetonAdmin(): Promise<string> {
  if (jetonCache && Date.now() < jetonExpire) return jetonCache;
  if (!SHOP || !ADMIN_CLIENT_ID || !ADMIN_CLIENT_SECRET) {
    throw new Error("Accès Shopify Admin non configuré (SHOPIFY_STORE_DOMAIN / SHOPIFY_ADMIN_CLIENT_ID / SHOPIFY_ADMIN_CLIENT_SECRET)");
  }
  const res = await fetch(`https://${SHOP}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: ADMIN_CLIENT_ID, client_secret: ADMIN_CLIENT_SECRET, grant_type: "client_credentials" }),
    cache: "no-store",
  });
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error(`Jeton Shopify Admin refusé (${res.status})`);
  jetonCache = json.access_token;
  jetonExpire = Date.now() + (json.expires_in || 3600) * 1000 - 60000;
  return jetonCache;
}

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  for (let essai = 1; essai <= 3; essai++) {
    const jeton = await jetonAdmin();
    const res = await fetch(`https://${SHOP}/admin/api/${API}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": jeton },
      body: JSON.stringify({ query, variables }),
      cache: "no-store",
    });
    const json = (await res.json().catch(() => ({}))) as { data?: T; errors?: unknown };
    const erreurs = JSON.stringify(json.errors ?? "");
    if (json.errors && erreurs.includes("THROTTLED") && essai < 3) {
      await new Promise((r) => setTimeout(r, 2000 * essai));
      continue;
    }
    if (!res.ok || json.errors || !json.data) {
      // Ex. « Access denied for translatableResourcesByIds field. Required
      // access: `read_translations` » → ajouter le droit à l'app Shopify.
      throw new Error(`Shopify ${res.status} : ${(erreurs || JSON.stringify(json)).slice(0, 500)}`);
    }
    return json.data;
  }
  throw new Error("Shopify : limite de débit dépassée (3 essais)");
}

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

type ChampTraduit = { langue: Langue; champ: Champ; fr: string; traduit: string; majAt: string };

type NoeudTraduction = {
  resourceId: string;
  translatableContent: Array<{ key: string; value: string | null }>;
  de: Array<{ key: string; value: string | null; updatedAt: string | null }>;
  en: Array<{ key: string; value: string | null; updatedAt: string | null }>;
};

/** Champs DE / EN réécrits depuis `depuis`, avec le français correspondant. */
async function lireTraductionsRecentes(ids: string[], depuis: string): Promise<Map<string, ChampTraduit[]>> {
  const out = new Map<string, ChampTraduit[]>();
  const q = `query($ids: [ID!]!) {
    translatableResourcesByIds(first: 50, resourceIds: $ids) {
      nodes {
        resourceId
        translatableContent { key value }
        de: translations(locale: "de") { key value updatedAt }
        en: translations(locale: "en") { key value updatedAt }
      }
    }
  }`;
  const seuil = new Date(depuis).getTime();
  for (let i = 0; i < ids.length; i += 50) {
    const lot = ids.slice(i, i + 50);
    const data = await gql<{ translatableResourcesByIds: { nodes: NoeudTraduction[] } }>(q, { ids: lot });
    for (const n of data.translatableResourcesByIds.nodes) {
      const fr = new Map(n.translatableContent.map((c) => [c.key, c.value ?? ""]));
      const champs: ChampTraduit[] = [];
      for (const langue of LANGUES) {
        for (const t of n[langue]) {
          if (!CHAMPS.includes(t.key as Champ) || !t.value || !t.updatedAt) continue;
          if (new Date(t.updatedAt).getTime() <= seuil) continue;
          champs.push({ langue, champ: t.key as Champ, fr: fr.get(t.key) ?? "", traduit: t.value, majAt: t.updatedAt });
        }
      }
      if (champs.length) out.set(n.resourceId, champs);
    }
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

  return `Tu es relecteur-traducteur professionnel FR > DE / EN pour un webshop suisse de mobilier de jardin haut de gamme (jardin-confort.ch). Une app de traduction automatique avec glossaire a écrit les versions DE et EN ci-dessous. Signale UNIQUEMENT les vraies erreurs qui nuisent au sens ou au référencement :
- contresens, terme technique faux, mot du glossaire appliqué hors contexte (ex. un pouf traduit « Sitzsack » / « bean bag » alors que ce n'est pas un pouf-sac ; toile de parasol traduite « Leinwand » au lieu de « Bespannung » ; « fibre de carbone » traduite « Anthrazit ») ;
- nom de marque, de collection ou de modèle perdu, déplacé, doublé, collé ou traduit (les noms propres ne se traduisent jamais ; le numéro ou suffixe d'un modèle reste collé à son nom) ;
- passage resté en français, ou en allemand dans la version anglaise ;
- mot ou groupe de mots répété inutilement, phrase incompréhensible, faute de frappe ;
- chiffre, dimension, référence ou code coloris différent du français.
N'en signale PAS : choix de style acceptables, ß (traité ailleurs), listes de coloris qui répètent un mot, tournures simplement perfectibles.
Repères : allemand de Suisse (ss, jamais ß), vouvoiement (Sie). Pouf (non Fatboy) = DE « Pouf », EN « pouf ». Fauteuil repas = DE « Gartensessel » / EN « dining armchair ». Chaise repas = EN « dining chair ». Toile = « Bespannung » ou « Stoff ». Résine tressée = « Polyrattan-Geflecht » / « synthetic wicker ». Chiné = « meliert » / « melange ».

Marque : ${r.marque ?? "(collection)"} — ${r.type} « ${r.handle} »

${blocs.join("\n\n")}

Réponds UNIQUEMENT avec un objet JSON, sans texte autour :
{"anomalies":[{"langue":"de|en","champ":"title|body_html|meta_title|meta_description","type":"contresens|nom_perdu|terme_faux|non_traduit|redondance|faute|chiffre|autre","extrait":"passage fautif tel qu'il apparaît","correction":"texte corrigé de ce passage","sure":true|false}]}
« sure » = true seulement si la correction est mécanique et sans aucun doute. Si tout est correct : {"anomalies":[]}`;
}

async function relireAvecClaude(r: Ressource, champs: ChampTraduit[]): Promise<Anomalie[]> {
  const cle = process.env.ANTHROPIC_API_KEY;
  if (!cle) throw new Error("ANTHROPIC_API_KEY absente");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": cle, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: MODELE,
      max_tokens: 2000,
      messages: [{ role: "user", content: consigneClaude(r, champs) }],
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Anthropic ${res.status} : ${detail.slice(0, 300)}`);
  }
  const json = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  const texte = (json.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
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
      auto_corrigeable: a.sure === true,
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
};

const cleDedup = (l: { ressource_id: string; langue: string; champ: string; regle: string; extrait: string | null }) =>
  [l.ressource_id, l.langue, l.champ, l.regle, (l.extrait ?? "").replace(/\s+/g, " ").trim()].join("|");

/** Début du dernier passage terminé sans erreur, sinon il y a 26 h. */
async function depuisDernierPassage(): Promise<string> {
  const { data } = await supabaseAdmin
    .from("seo_traductions_runs")
    .select("started_at")
    .not("finished_at", "is", null)
    .is("erreur", null)
    .order("started_at", { ascending: false })
    .limit(1);
  const dernier = (data as Array<{ started_at: string }> | null)?.[0]?.started_at;
  return dernier ?? new Date(Date.now() - 26 * 3600 * 1000).toISOString();
}

export async function lancerSentinelle(opts: { depuis?: string; maxClaude?: number } = {}): Promise<ResultatSentinelle> {
  const depuis = opts.depuis ?? (await depuisDernierPassage());
  const maxClaude = opts.maxClaude ?? MAX_CLAUDE_DEFAUT;
  const erreurs: string[] = [];
  const res: ResultatSentinelle = {
    run_id: null, depuis, ressources_modifiees: 0, ressources_retraduites: 0,
    relues_claude: 0, non_relues_claude: 0, anomalies_trouvees: 0, anomalies_nouvelles: 0, erreurs,
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
        for (const a of appliquerRegles({ langue: c.langue, champ: c.champ, fr: c.fr, traduit: c.traduit, marque: r.marque })) {
          lignes.push(versLigne(r, a, c.majAt));
        }
      }
    }

    // 4. Relecture Claude — titres réécrits d'abord, puis le reste
    const ordre = [...aControler].sort((a, b) => {
      const t = (r: Ressource) => (traductions.get(r.id)!.some((c) => c.champ === "title") ? 0 : 1);
      return t(a) - t(b);
    });
    const relues = ordre.slice(0, Math.max(0, maxClaude));
    res.non_relues_claude = ordre.length - relues.length;
    await enParallele(relues, CONCURRENCE_CLAUDE, async (r) => {
      const champs = traductions.get(r.id)!;
      try {
        const trouvees = await relireAvecClaude(r, champs);
        const majAt = champs[0]?.majAt ?? null;
        for (const a of trouvees) lignes.push(versLigne(r, a, majAt));
        res.relues_claude++;
      } catch (e) {
        if (erreurs.length < 10) erreurs.push(`Claude ${r.handle} : ${String(e).slice(0, 200)}`);
      }
    });
    res.anomalies_trouvees = lignes.length;

    // 5. Dédoublonnage contre la base puis insertion
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

    if (nouvelles.length > 0) {
      await createNotificationUnique({
        type: "traductions_anomalies",
        titre: `🌐 ${nouvelles.length} anomalie(s) de traduction DE / EN`,
        message: "Sentinelle traductions : voir /dashboard/traductions",
      }, 20);
    }
  } catch (e) {
    erreurFatale = String(e).slice(0, 1000);
  }

  const notes = [
    `depuis ${depuis}`,
    `${res.ressources_modifiees} fiches modifiées, ${res.ressources_retraduites} retraduites`,
    `Claude : ${res.relues_claude} relues, ${res.non_relues_claude} hors plafond`,
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
