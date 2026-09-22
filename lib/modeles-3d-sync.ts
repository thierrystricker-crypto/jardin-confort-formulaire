// lib/modeles-3d-sync.ts
// Synchronisation de l'index des modèles 3D (table modeles_3d) depuis Shopify.
//
// Principe : Shopify est la seule source de vérité (métachamps
// custom.model_3d_glb → Model3d, custom.model_3d_url → .bin), la table
// Supabase n'est qu'un miroir régénérable. On passe par une BULK OPERATION
// Admin GraphQL (≈ 3 min pour 14 000 produits) plutôt que par une pagination
// de 280 pages : Shopify prépare un fichier JSONL, on le télécharge et on le
// charge en une passe.
//
// Déroulé (résumable) :
//   1. demarrerBulk()      → bulkOperationRunQuery, id mémorisé dans modeles_3d_sync_etat
//   2. statutBulk(id)      → RUNNING… COMPLETED (url du JSONL)
//   3. importerDepuisUrl() → parse, classification, upsert par lots, ménage
// executerSynchro() enchaîne les trois en attendant la fin (cron, ≤ 4 min) ;
// etapeSynchro() ne fait qu'un pas (bouton du dashboard, qui interroge en boucle).
//
// Colonnes géométrie (bbox_*, top_view_*, footprint_*) : jamais touchées ici,
// elles appartiennent à la passe géométrie (étape 1b).

import { createHash } from "crypto";
import { shopifyAdminGraphQL } from "@/lib/shopify-stock";
import { supabaseAdmin } from "@/lib/supabase";

// ─── Requête bulk ─────────────────────────────────────────────────────────────
// Pas de `first` sur les connexions : en bulk, Shopify renvoie tout.
// Les objets imbriqués non-connexion (options, featuredMedia, reference du
// métachamp) arrivent inline dans la ligne du produit ; les variantes arrivent
// en lignes séparées avec __parentId.
const BULK_QUERY = `
{
  products {
    edges {
      node {
        id
        title
        handle
        vendor
        status
        productType
        publishedAt
        tags
        featuredMedia { preview { image { url } } }
        options { name optionValues { name } }
        m3d: metafield(namespace: "custom", key: "model_3d_url") { value }
        glb: metafield(namespace: "custom", key: "model_3d_glb") {
          value
          reference {
            ... on Model3d {
              id
              filename
              fileStatus
              originalSource { filesize format url }
              sources { filesize format url }
            }
          }
        }
        variants {
          edges {
            node {
              id sku title price
              selectedOptions { name value }
              m3d: metafield(namespace: "custom", key: "model_3d_url") { value }
            }
          }
        }
      }
    }
  }
}`;

export type EtatSynchro = {
  id: number;
  bulk_operation_id: string | null;
  statut: "idle" | "running" | "importing" | "done" | "error";
  declencheur: string | null;
  demarre_le: string | null;
  termine_le: string | null;
  message: string | null;
  stats: Record<string, unknown>;
  updated_at: string;
};

export type StatsImport = {
  produits: number;
  avec_3d: number;
  model3d: number;
  url: number;
  par_variante: number;
  anomalies: number;
  supprimes: number;
  options_modifiees: number;
  nouveaux_modeles: number;
  duree_ms: number;
  taille_jsonl: number;
};

// ─── État ─────────────────────────────────────────────────────────────────────

export async function lireEtatSynchro(): Promise<EtatSynchro> {
  const { data, error } = await supabaseAdmin
    .from("modeles_3d_sync_etat")
    .select("*")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw new Error(`modeles_3d_sync_etat : ${error.message}`);
  if (!data) {
    await supabaseAdmin.from("modeles_3d_sync_etat").insert({ id: 1 });
    return { id: 1, bulk_operation_id: null, statut: "idle", declencheur: null, demarre_le: null, termine_le: null, message: null, stats: {}, updated_at: new Date().toISOString() };
  }
  return data as EtatSynchro;
}

async function ecrireEtat(patch: Partial<EtatSynchro>) {
  const { error } = await supabaseAdmin
    .from("modeles_3d_sync_etat")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", 1);
  if (error) throw new Error(`modeles_3d_sync_etat (update) : ${error.message}`);
}

// ─── Bulk operation ───────────────────────────────────────────────────────────

type BulkOp = {
  id: string;
  status: "CREATED" | "RUNNING" | "COMPLETED" | "CANCELED" | "CANCELING" | "FAILED" | "EXPIRED";
  url: string | null;
  partialDataUrl: string | null;
  objectCount: string;
  fileSize: string | null;
  errorCode: string | null;
};

export async function demarrerBulk(declencheur: "cron" | "manuel"): Promise<string> {
  type Resp = {
    bulkOperationRunQuery: {
      bulkOperation: { id: string; status: string } | null;
      userErrors: { field: string[] | null; message: string }[];
    };
  };
  const data = await shopifyAdminGraphQL<Resp>(
    `mutation($q: String!) { bulkOperationRunQuery(query: $q) { bulkOperation { id status } userErrors { field message } } }`,
    { q: BULK_QUERY }
  );
  const r = data.bulkOperationRunQuery;
  if (r.userErrors.length > 0 || !r.bulkOperation) {
    // Cas classique : une opération tourne déjà sur la boutique (une seule
    // bulk query à la fois par shop). On se raccroche à celle en cours.
    const msg = r.userErrors.map((e) => e.message).join(" · ");
    const courante = await bulkCourante();
    if (courante && (courante.status === "RUNNING" || courante.status === "CREATED")) {
      await ecrireEtat({ bulk_operation_id: courante.id, statut: "running", declencheur, demarre_le: new Date().toISOString(), termine_le: null, message: `Raccroché à l'opération déjà en cours (${msg})` });
      return courante.id;
    }
    throw new Error(`bulkOperationRunQuery : ${msg || "réponse vide"}`);
  }
  await ecrireEtat({ bulk_operation_id: r.bulkOperation.id, statut: "running", declencheur, demarre_le: new Date().toISOString(), termine_le: null, message: null, stats: {} });
  return r.bulkOperation.id;
}

async function bulkCourante(): Promise<BulkOp | null> {
  const data = await shopifyAdminGraphQL<{ currentBulkOperation: BulkOp | null }>(
    `{ currentBulkOperation { id status url partialDataUrl objectCount fileSize errorCode } }`
  );
  return data.currentBulkOperation;
}

export async function statutBulk(id: string): Promise<BulkOp> {
  const data = await shopifyAdminGraphQL<{ node: BulkOp | null }>(
    `query($id: ID!) { node(id: $id) { ... on BulkOperation { id status url partialDataUrl objectCount fileSize errorCode } } }`,
    { id }
  );
  if (!data.node) throw new Error(`Bulk operation introuvable : ${id}`);
  return data.node;
}

// ─── Classification ───────────────────────────────────────────────────────────

const OPTIONS_TAILLE = /^(taille|dimension|dimensions|format|diam[èe]tre|longueur|largeur|grandeur|size)\b/i;
const OPTIONS_COULEUR = /^(couleur|coloris|finition|teinte|tissu|toile|structure|colou?r|farbe|mat[ée]riau)\b/i;
const VALEUR_TAILLE = /(\d+\s*(x|×)\s*\d+|\d+\s*cm\b|ø\s*\d+|\bl\s*\d+|\d+\s*mm\b)/i;
const NOM_GENERIQUE = /^(projet_sans_nom|projet sans nom|sans_titre|sans titre|untitled|nouveau|new|robotexpressive|scene|export)/i;

function nomTag(tags: string[], prefixe: string): string[] {
  const out: string[] = [];
  for (const t of tags) {
    if (t.toLowerCase().startsWith(prefixe.toLowerCase())) {
      const v = t.slice(prefixe.length).trim();
      if (v) out.push(v);
    }
  }
  return out;
}

function nomFichierDepuisUrl(url: string): string {
  try {
    const u = new URL(url);
    return decodeURIComponent(u.pathname.split("/").pop() || "");
  } catch {
    return url.split("?")[0].split("/").pop() || "";
  }
}

type LigneProduit = {
  id: string;
  title: string;
  handle: string;
  vendor: string | null;
  status: string;
  productType: string | null;
  publishedAt: string | null;
  tags: string[];
  featuredMedia: { preview: { image: { url: string } | null } | null } | null;
  options: { name: string; optionValues: { name: string }[] }[];
  m3d: { value: string } | null;
  glb: {
    value: string;
    reference: {
      id: string;
      filename: string;
      fileStatus: string;
      originalSource: { filesize: number; format: string; url: string } | null;
      sources: { filesize: number; format: string; url: string }[];
    } | null;
  } | null;
};

type LigneVariante = {
  id: string; sku: string | null; title: string | null; price: string | null;
  selectedOptions?: { name: string; value: string }[];
  m3d?: { value: string } | null;
  __parentId: string;
};

// Modèle 3D propre à une variante (convention du 19.09 : métachamp
// custom.model_3d_url au niveau variante, rempli seulement quand la variante
// change la géométrie — taille, longueur, nombre de places).
export type Variante3d = {
  variant_id: string;
  sku: string | null;
  titre: string | null;
  options: Record<string, string>;
  url: string;
  prix: number | null;
};

export type RowModele3d = {
  product_id: number;
  handle: string;
  titre: string;
  marque: string | null;
  statut: string;
  publie: boolean;
  type_produit: string | null;
  tags: string[];
  collection: string | null;
  categories: string[];
  tag_no3dfile: boolean;
  image_url: string | null;
  prix_min: number | null;
  sku_1: string | null;
  variant_id_1: string | null;
  skus: string[];
  skus_txt: string;
  variant_ids: string[];
  variant_count: number;
  variant_mode: "sans_variante" | "avec_options";
  option_names: string[];
  option_values: Record<string, string[]>;
  has_size_option: boolean;
  has_color_option: boolean;
  options_signature: string;
  options_changed_at: string | null;
  model_level: "fiche" | "variante";
  variantes_3d: Variante3d[];
  variantes_3d_n: number;
  source: "model3d" | "url" | null;
  url_glb: string | null;
  url_usdz: string | null;
  gid_model3d: string | null;
  nom_fichier: string | null;
  taille_octets: number | null;
  fichier_partage_n: number;
  model_attached_at: string | null;
  anomalies: string[];
  synced_at: string;
};

function construireRow(p: LigneProduit, variantes: LigneVariante[], maintenant: string): RowModele3d {
  const tags = p.tags || [];
  const collections = nomTag(tags, "Collection_");
  const categories = nomTag(tags, "Catégorie_").concat(nomTag(tags, "Categorie_"));

  // Options : Shopify renvoie une option "Title" / ["Default Title"] pour les
  // fiches sans variante.
  const options = (p.options || [])
    .map((o) => ({ name: o.name, values: (o.optionValues || []).map((v) => v.name) }))
    .filter((o) => !(o.name === "Title" && o.values.length === 1 && o.values[0] === "Default Title"));
  const optionNames = options.map((o) => o.name);
  const optionValues: Record<string, string[]> = {};
  for (const o of options) optionValues[o.name] = o.values;
  const variantMode: RowModele3d["variant_mode"] = options.length > 0 && variantes.length > 1 ? "avec_options" : "sans_variante";

  const hasSize = options.some((o) => OPTIONS_TAILLE.test(o.name.trim()) || o.values.filter((v) => VALEUR_TAILLE.test(v)).length >= Math.max(2, Math.ceil(o.values.length / 2)));
  const hasColor = options.some((o) => OPTIONS_COULEUR.test(o.name.trim()));

  const signature = createHash("sha1")
    .update(options.map((o) => `${o.name}=${[...o.values].sort().join("|")}`).sort().join("\n"))
    .digest("hex");

  // Modèle 3D : Model3d (métachamp file_reference) prioritaire, sinon URL .bin.
  let source: RowModele3d["source"] = null;
  let urlGlb: string | null = null, urlUsdz: string | null = null, gid: string | null = null, nomFichier: string | null = null, taille: number | null = null;
  const ref = p.glb?.reference;
  if (ref) {
    const g = ref.sources.find((s) => s.format === "glb") || ref.originalSource;
    const u = ref.sources.find((s) => s.format === "usdz");
    source = "model3d";
    urlGlb = g?.url ?? null;
    urlUsdz = u?.url ?? null;
    gid = ref.id;
    nomFichier = ref.filename;
    taille = g?.filesize ?? null;
  } else if (p.m3d?.value) {
    source = "url";
    urlGlb = p.m3d.value;
    nomFichier = nomFichierDepuisUrl(p.m3d.value);
  }

  // Cascade (thème et planner) : variante → Model3d fiche → URL fiche.
  // La fiche garde son modèle par défaut ; les variantes qui ont leur propre
  // fichier sont listées à part. Si la fiche n'a aucun défaut mais qu'une
  // variante a un fichier, on prend celui-ci comme défaut (has_3d vrai).
  const variantes3d: Variante3d[] = variantes
    .filter((v) => v.m3d?.value)
    .map((v) => ({
      variant_id: v.id,
      sku: v.sku?.trim() || null,
      titre: v.title || null,
      options: Object.fromEntries((v.selectedOptions || []).map((o) => [o.name, o.value])),
      url: v.m3d!.value,
      prix: v.price && Number.isFinite(Number(v.price)) ? Number(v.price) : null,
    }));
  const anomaliesInitiales: string[] = [];
  if (!source && variantes3d.length > 0) {
    source = "url";
    urlGlb = variantes3d[0].url;
    nomFichier = nomFichierDepuisUrl(variantes3d[0].url);
    anomaliesInitiales.push("modèles par variante sans défaut fiche");
  }

  const prix = variantes
    .map((v) => (v.price ? Number(v.price) : NaN))
    .filter((n) => Number.isFinite(n));

  return {
    product_id: Number(p.id.split("/").pop()),
    handle: p.handle,
    titre: p.title,
    marque: p.vendor || null,
    statut: p.status,
    publie: Boolean(p.publishedAt),
    type_produit: p.productType || null,
    tags,
    collection: collections[0] ?? null,
    categories,
    tag_no3dfile: tags.some((t) => t.toLowerCase() === "no3dfile"),
    image_url: p.featuredMedia?.preview?.image?.url ?? null,
    prix_min: prix.length ? Math.min(...prix) : null,
    sku_1: variantes[0]?.sku?.trim() || null,
    variant_id_1: variantes[0]?.id || null,
    skus: variantes.map((v) => (v.sku || "").trim()).filter(Boolean),
    skus_txt: variantes.map((v) => (v.sku || "").trim()).filter(Boolean).join(" "),
    variant_ids: variantes.map((v) => v.id).filter(Boolean),
    variant_count: variantes.length,
    variant_mode: variantMode,
    option_names: optionNames,
    option_values: optionValues,
    has_size_option: variantMode === "avec_options" && hasSize,
    has_color_option: variantMode === "avec_options" && hasColor,
    options_signature: signature,
    options_changed_at: null,     // posé au croisement avec l'existant
    model_level: variantes3d.length > 0 ? "variante" : "fiche",
    variantes_3d: variantes3d,
    variantes_3d_n: variantes3d.length,
    source,
    url_glb: urlGlb,
    url_usdz: urlUsdz,
    gid_model3d: gid,
    nom_fichier: nomFichier,
    taille_octets: taille,
    fichier_partage_n: 0,         // posé après comptage
    model_attached_at: null,      // posé au croisement avec l'existant
    anomalies: anomaliesInitiales, // complétées à la fin
    synced_at: maintenant,
  };
}

// ─── Import du JSONL ──────────────────────────────────────────────────────────

type Existant = {
  product_id: number;
  options_signature: string | null;
  options_changed_at: string | null;
  model_attached_at: string | null;
  url_glb: string | null;
};

async function lireExistants(): Promise<Map<number, Existant>> {
  const map = new Map<number, Existant>();
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await supabaseAdmin
      .from("modeles_3d")
      .select("product_id, options_signature, options_changed_at, model_attached_at, url_glb")
      .range(from, from + page - 1);
    if (error) throw new Error(`modeles_3d (lecture) : ${error.message}`);
    for (const r of (data || []) as Existant[]) map.set(r.product_id, r);
    if (!data || data.length < page) break;
  }
  return map;
}

export async function importerDepuisUrl(url: string): Promise<StatsImport> {
  const t0 = Date.now();
  const maintenant = new Date().toISOString();

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Téléchargement du JSONL : HTTP ${res.status}`);
  const texte = await res.text();

  // Parse : les produits portent "vendor", les variantes "__parentId".
  const produits = new Map<string, LigneProduit>();
  const variantes = new Map<string, LigneVariante[]>();
  for (const ligne of texte.split("\n")) {
    if (!ligne) continue;
    const o = JSON.parse(ligne) as Record<string, unknown>;
    if (typeof o.__parentId === "string") {
      const v = o as unknown as LigneVariante;
      const arr = variantes.get(v.__parentId) || [];
      arr.push(v);
      variantes.set(v.__parentId, arr);
    } else if (typeof o.id === "string" && (o.id as string).includes("/Product/")) {
      produits.set(o.id as string, o as unknown as LigneProduit);
    }
  }

  const rows: RowModele3d[] = [];
  for (const [gid, p] of produits) rows.push(construireRow(p, variantes.get(gid) || [], maintenant));

  // Fichiers partagés entre plusieurs fiches
  const parUrl = new Map<string, number>();
  for (const r of rows) if (r.url_glb) parUrl.set(r.url_glb, (parUrl.get(r.url_glb) || 0) + 1);

  // Croisement avec l'existant : rattachement daté, changements d'options
  const existants = await lireExistants();
  let optionsModifiees = 0, nouveauxModeles = 0;
  for (const r of rows) {
    const ex = existants.get(r.product_id);
    if (r.url_glb) r.fichier_partage_n = parUrl.get(r.url_glb) || 1;
    if (r.source) {
      if (ex?.model_attached_at) r.model_attached_at = ex.model_attached_at;
      else { r.model_attached_at = maintenant; if (!ex?.url_glb) nouveauxModeles++; }
    }
    if (ex && ex.options_signature && ex.options_signature !== r.options_signature) {
      r.options_changed_at = maintenant;
      optionsModifiees++;
    } else if (ex?.options_changed_at) {
      r.options_changed_at = ex.options_changed_at;
    }

    const a: string[] = [...r.anomalies];   // anomalies déjà posées par construireRow
    if (r.source) {
      if (r.taille_octets && r.taille_octets > 5_000_000) a.push("> 5 Mo");
      else if (r.taille_octets && r.taille_octets > 3_000_000) a.push("> 3 Mo");
      if (r.nom_fichier && NOM_GENERIQUE.test(r.nom_fichier)) a.push("nom de fichier générique");
      if (r.fichier_partage_n > 1) a.push(`fichier partagé par ${r.fichier_partage_n} produits`);
      if (r.tag_no3dfile) a.push("tag no3dfile obsolète");
      if (r.options_changed_at && r.model_attached_at && r.options_changed_at > r.model_attached_at) a.push("options modifiées depuis le rattachement du modèle");
      if (!r.collection) a.push("sans collection");
    }
    r.anomalies = a;
  }

  // Upsert par lots
  const LOT = 500;
  for (let i = 0; i < rows.length; i += LOT) {
    const { error } = await supabaseAdmin.from("modeles_3d").upsert(rows.slice(i, i + LOT), { onConflict: "product_id" });
    if (error) throw new Error(`modeles_3d (upsert lot ${i / LOT + 1}) : ${error.message}`);
  }

  // Ménage : fiches disparues de Shopify
  const { count: supprimes, error: errDel } = await supabaseAdmin
    .from("modeles_3d")
    .delete({ count: "exact" })
    .lt("synced_at", maintenant);
  if (errDel) throw new Error(`modeles_3d (ménage) : ${errDel.message}`);

  const stats: StatsImport = {
    produits: rows.length,
    avec_3d: rows.filter((r) => r.source).length,
    model3d: rows.filter((r) => r.source === "model3d").length,
    url: rows.filter((r) => r.source === "url").length,
    par_variante: rows.filter((r) => r.variantes_3d_n > 0).length,
    anomalies: rows.filter((r) => r.anomalies.length > 0).length,
    supprimes: supprimes || 0,
    options_modifiees: optionsModifiees,
    nouveaux_modeles: nouveauxModeles,
    duree_ms: Date.now() - t0,
    taille_jsonl: texte.length,
  };
  return stats;
}

// ─── Orchestration ────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Un pas de synchro (bouton du dashboard, appelé en boucle) :
 *  - idle/done/error → démarre une bulk operation
 *  - running         → lit le statut ; si COMPLETED, importe
 * Renvoie l'état après le pas.
 */
export async function etapeSynchro(declencheur: "cron" | "manuel"): Promise<EtatSynchro> {
  const etat = await lireEtatSynchro();

  if (etat.statut === "importing") {
    // Un import est en cours dans une autre invocation ; si elle est morte
    // (> 10 min), on considère l'état périmé et on repart.
    const depuis = Date.now() - new Date(etat.updated_at).getTime();
    if (depuis < 10 * 60 * 1000) return etat;
    await ecrireEtat({ statut: "error", message: "Import interrompu (délai dépassé), relancer." });
    return lireEtatSynchro();
  }

  if (etat.statut !== "running" || !etat.bulk_operation_id) {
    await demarrerBulk(declencheur);
    return lireEtatSynchro();
  }

  const op = await statutBulk(etat.bulk_operation_id);
  if (op.status === "CREATED" || op.status === "RUNNING") {
    await ecrireEtat({ message: `Shopify prépare l'export… ${op.objectCount} objets` });
    return lireEtatSynchro();
  }
  if (op.status !== "COMPLETED" || !op.url) {
    await ecrireEtat({ statut: "error", termine_le: new Date().toISOString(), message: `Bulk operation ${op.status}${op.errorCode ? ` (${op.errorCode})` : ""}` });
    return lireEtatSynchro();
  }

  await ecrireEtat({ statut: "importing", message: `Import du fichier (${op.fileSize ? Math.round(Number(op.fileSize) / 1e6) : "?"} Mo)…` });
  try {
    const stats = await importerDepuisUrl(op.url);
    await ecrireEtat({ statut: "done", termine_le: new Date().toISOString(), message: null, stats: stats as unknown as Record<string, unknown> });
  } catch (err) {
    await ecrireEtat({ statut: "error", termine_le: new Date().toISOString(), message: (err as Error).message.slice(0, 500) });
  }
  return lireEtatSynchro();
}

/**
 * Synchro complète en une invocation (cron) : démarre, attend la fin de la
 * bulk operation (au plus maxWaitMs), importe. Si Shopify n'a pas fini à
 * temps, l'état reste `running` et le prochain passage (cron ou bouton)
 * reprend là où on en est.
 */
export async function executerSynchro(declencheur: "cron" | "manuel", maxWaitMs = 230_000): Promise<EtatSynchro> {
  const t0 = Date.now();
  let etat = await etapeSynchro(declencheur);
  while (etat.statut === "running" && Date.now() - t0 < maxWaitMs) {
    await sleep(5000);
    etat = await etapeSynchro(declencheur);
  }
  return etat;
}
