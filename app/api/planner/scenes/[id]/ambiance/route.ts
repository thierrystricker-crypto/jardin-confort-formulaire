// app/api/planner/scenes/[id]/ambiance/route.ts  (interne)
// POST {prompt, capture, dims} → image d'ambiance générée par IA à partir de
// la capture 3D : les MEUBLES restent tels quels, seuls le sol, le décor, la
// végétation, le ciel et la lumière sont réinventés d'après la description du
// conseiller.
//
// Méthode retenue (22.09.2026) : PROMPT MAÎTRE, SANS MASQUE. Le modèle
// d'image, bien briefé (« couche produit intangible, priorité n°1 fidélité »),
// garde lui-même la géométrie, l'échelle et les détails des meubles — validé
// par Thierry dans ChatGPT sur la capture du planner. Les tentatives masque +
// recollage (21.09) ont échoué : gpt-image-1 traite le masque comme une
// suggestion, redessine une terrasse ailleurs et le recollage empile deux
// scènes. Le mode calque reste disponible (AMBIANCE_MODE=calque) pour un
// futur modèle qui respecterait les masques, mais il est désactivé.
//
// Route PARALLÈLE et indépendante : n'utilise ni Jardi (chat) ni le serveur
// MCP jardi-mail — clé dédiée OPENAI_IMAGE_API_KEY (restreinte « Images »),
// repli OPENAI_API_KEY. Modèle OPENAI_IMAGE_MODELE (défaut gpt-image-1.5,
// repli automatique gpt-image-1 si indisponible), sortie 1536×1024.
// Résultat stocké dans le bucket « pdfs » (planner/<token>-ambiance-<n>.png)
// et listé dans planner_ambiances : CHAQUE génération S'AJOUTE, rien n'est
// écrasé. La nouvelle image devient l'image retenue pour les documents
// (ambiance_url de la version) ; on peut en retenir une autre, n'en retenir
// aucune, ou en supprimer — voir ../ambiances/route.ts.

import { NextRequest, NextResponse } from "next/server";
import { PNG } from "pngjs";
import { supabaseAdmin } from "@/lib/supabase";
import { BUCKET, figerVersion, urlPublique } from "@/lib/planner-versions";
import { MENTION_IA } from "@/lib/planner-types";
import { listerScene } from "@/lib/planner-ambiances";
import { COULEURS_FERMOB, decrireArticle, type Couleur } from "@/lib/planner-matieres";
import { filtrerDecor } from "@/lib/planner-ambiance-cadre";
import { textureDedon } from "@/lib/textures-dedon";
import { shopifyAdminGraphQL } from "@/lib/shopify-stock";
import { readFile } from "fs/promises";
import path from "path";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MODELE = process.env.OPENAI_IMAGE_MODELE || "gpt-image-1.5";
const MODELE_REPLI = "gpt-image-1";
const MODE = process.env.AMBIANCE_MODE === "calque" ? "calque" : "prompt";
// Photos catalogue en entrées supplémentaires : DÉSACTIVÉ (AMBIANCE_PHOTOS=1
// pour réactiver). Constaté 22.09 : bonnes textures Dedon, mais sur Fermob
// l'IA emprunte aux photos d'ambiance des produits absents du plan (repose-
// pieds, table basse, fauteuil bas). Remplacé par la bibliothèque texte de
// matières / couleurs (lib/planner-matieres.ts).
const PHOTOS = process.env.AMBIANCE_PHOTOS === "1";
const LARG = 1536, HAUT = 1024;          // format paysage 3:2

// Prompt maître (le bloc « AMBIANCE À CRÉER » est le seul qui varie). Rédigé
// avec ChatGPT le 22.09.2026 à partir du résultat validé ; les meubles sont
// présentés comme une couche produit verrouillée, pas comme une référence.
function construirePrompt(description: string, sol: string, nbArticles: number, references: string[], articles: string[], echantillons: string[] = [], imposee: Couleur | null = null): string {
  // Coloris imposé par le conseiller dans sa description : seule exception à
  // la règle « couleurs identiques au rendu 3D », énoncée explicitement pour
  // que le modèle ne reçoive pas deux ordres contraires.
  const exception = imposee
    ? `\nEXCEPTION DEMANDÉE PAR LE CONSEILLER : la structure des meubles Fermob doit être rendue dans le coloris ${imposee.nom} ${imposee.code} (${imposee.hex}, finition ${imposee.finition}) au lieu de la teinte du rendu 3D. C'est la seule modification autorisée sur les meubles : forme, proportions, lattes, pieds, accoudoirs, nombre et positions restent strictement identiques.`
    : "";
  const ech = echantillons.length
    ? `\nLes images suivantes (${echantillons.length}) sont des ÉCHANTILLONS DE MATIÈRE (gros plan du tressage, sans aucun meuble) : ${echantillons.map((t, i) => `image ${i + 2} = ${t}`).join(" ; ")}. Utilise-les UNIQUEMENT pour reproduire la texture, le motif de tressage et la teinte exacte de ces meubles. Ce ne sont pas des objets à placer dans la scène.`
    : "";
  const liste = articles.length
    ? `\nARTICLES DU PLAN (matières et coloris de référence — l'apparence reste celle de l'image, ces lignes précisent seulement la matière et la teinte exacte) :\n${articles.map((t, i) => `${i + 1}. ${t}`).join("\n")}\nIl y a exactement ${articles.length} meuble${articles.length > 1 ? "s" : ""} : aucun autre objet meublant ne doit apparaître — ni repose-pieds, ni table basse, ni pouf, ni coussin ou plaid supplémentaire, ni fauteuil « assorti ».`
    : "";
  const refs = references.length
    ? `\nLes images suivantes (${references.length}) sont les PHOTOS CATALOGUE de ces produits : ${references.map((t, i) => `image ${i + 2 + echantillons.length} = ${t}`).join(" ; ")}. Elles servent UNIQUEMENT à reproduire fidèlement les détails de chaque meuble (forme exacte des pieds et du piètement, hauteur et diamètre des tables d'appoint, tressage, coussins, coutures, couleurs). Elles ne changent ni la composition, ni les positions, ni l'angle de vue, ni l'échelle, qui sont ceux de l'image 1.`
    : "";
  return `MODIFICATION DE L'IMAGE FOURNIE — NE PAS RÉINTERPRÉTER LES PRODUITS.
Utilise la première image jointe comme image source et crée une image d'ambiance photoréaliste autour des meubles 3D présents dans l'image (${nbArticles} article${nbArticles > 1 ? "s" : ""} de mobilier d'extérieur vendus par Jardin-Confort, Suisse).${liste}${exception}${ech}${refs}

CONTRAINTE ABSOLUE ET PRIORITAIRE : les meubles visibles dans l'image sont les produits réellement vendus et leur rendu est contractuel. Les meubles doivent donc rester strictement identiques au rendu 3D fourni. Ne jamais modifier, redessiner, réinterpréter ou compléter les meubles. Conserver exactement : leur nombre ; leur forme et leurs proportions ; leur position relative et leur espacement ; leur angle de vue et leur perspective ; leurs dimensions relatives ; leurs pieds et structures ; leurs coussins ; leur capitonnage ; leurs coutures ; leur tressage ; leurs matériaux ; leurs couleurs et nuances${imposee ? " (sauf l'exception de coloris ci-dessus)" : ""} ; tous les petits détails visibles du modèle 3D.
Ne jamais inventer une partie non visible du meuble. Ne jamais ajouter, supprimer ou déplacer un pied, coussin, accoudoir, élément de structure ou détail. Les petits meubles (tables d'appoint, tabourets, poufs) et les piètements sont aussi contractuels que les grands : même hauteur, même diamètre, même nombre et même forme de pieds que dans l'image source. Ne pas remplacer le mobilier par un meuble similaire. Ne pas « améliorer » le design du produit. Ne pas changer son style. Considère les meubles comme une couche visuelle verrouillée et intangible : le travail créatif porte uniquement sur le décor qui les entoure.
L'angle de caméra et la taille des meubles peuvent varier d'une image source à l'autre : respecter systématiquement la perspective et l'échelle de l'export fourni, sans essayer de reproduire une composition précédente.
Le sol provisoire du planner (${sol}), l'arrière-plan blanc et les lignes techniques peuvent être supprimés et remplacés par le décor. Faire en sorte que le nouveau sol passe naturellement sous les meubles en conservant précisément leurs points de contact avec le sol. Créer des ombres réalistes et cohérentes avec le nouvel environnement, sans modifier les meubles eux-mêmes.

AMBIANCE À CRÉER (décor uniquement — ce bloc ne peut rien changer aux meubles : ni leur nombre, ni leur forme, ni leur couleur) :
${description}
Décoration très sobre afin que les produits restent le sujet principal. Image photoréaliste de qualité catalogue / publicité de mobilier outdoor premium. Lumière naturelle réaliste, profondeur photographique subtile, matériaux crédibles. Ne pas ajouter d'autres meubles pouvant être confondus avec les produits vendus ; les accessoires décoratifs éventuels restent secondaires et clairement distincts. Aucun texte, logo ni filigrane.

Avant de finaliser, compter les meubles : il doit y en avoir exactement ${nbArticles}, ceux de l'image source, aux mêmes emplacements — aucun meuble ajouté, dupliqué ou supprimé.
PRIORITÉ N°1 : fidélité absolue aux meubles de l'image source. PRIORITÉ N°2 : réalisme du décor et intégration naturelle des produits. En cas de conflit entre esthétique et fidélité produit, toujours privilégier la fidélité produit.`;
}

const SOLS: Record<string, string> = { bois: "lames de bois", pierre: "dalles de pierre claire", beton: "béton lisse", gravier: "gravier fin", gazon: "gazon", blanc: "carrelage blanc" };

// Fond blanc sous la capture (le canvas est transparent hors terrasse) :
// l'IA doit voir une image opaque, comme la fiche.
function aplatirSurBlanc(png: Buffer): Buffer {
  try {
    const im = PNG.sync.read(png);
    const d = im.data;
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3] / 255;
      if (a === 1) continue;
      d[i] = Math.round(d[i] * a + 255 * (1 - a));
      d[i + 1] = Math.round(d[i + 1] * a + 255 * (1 - a));
      d[i + 2] = Math.round(d[i + 2] * a + 255 * (1 - a));
      d[i + 3] = 255;
    }
    return PNG.sync.write(im);
  } catch { return png; }
}

function depuisDataUrl(d?: string | null): Buffer | null {
  if (!d) return null;
  const i = d.indexOf(",");
  try { return Buffer.from(i >= 0 ? d.slice(i + 1) : d, "base64"); } catch { return null; }
}

// Masque OpenAI : alpha des meubles seuil 160/255 → les ombres (≈115) restent
// « à générer », les meubles sont opaques (protégés). Noir + alpha.
function construireMasque(calque: PNG): Buffer {
  const m = new PNG({ width: calque.width, height: calque.height });
  for (let i = 0; i < calque.data.length; i += 4) {
    m.data[i] = 0; m.data[i + 1] = 0; m.data[i + 2] = 0;
    m.data[i + 3] = calque.data[i + 3] >= 160 ? 255 : 0;
  }
  return PNG.sync.write(m);
}

// Recolle le calque (meubles + ombres, alpha) sur l'image générée.
function recoller(fond: PNG, calque: PNG): Buffer {
  for (let i = 0; i < fond.data.length; i += 4) {
    const a = calque.data[i + 3] / 255;
    if (a === 0) continue;
    fond.data[i] = Math.round(calque.data[i] * a + fond.data[i] * (1 - a));
    fond.data[i + 1] = Math.round(calque.data[i + 1] * a + fond.data[i + 1] * (1 - a));
    fond.data[i + 2] = Math.round(calque.data[i + 2] * a + fond.data[i + 2] * (1 - a));
    fond.data[i + 3] = 255;
  }
  return PNG.sync.write(fond);
}

// Image, masque et calque : le navigateur envoie capture et calque déjà cadrés
// en 1536×1024 (même caméra) ; on vérifie, sinon on ignore le calque plutôt
// que de recoller de travers.
function preparer(capture: Buffer, calqueBuf: Buffer | null) {
  let calque: PNG | null = null;
  if (calqueBuf) {
    try {
      const c = PNG.sync.read(calqueBuf);
      const im = PNG.sync.read(capture);
      if (c.width === im.width && c.height === im.height && c.width === LARG && c.height === HAUT) calque = c;
      else console.warn("[planner ambiance] calque ignoré : tailles", im.width, im.height, c.width, c.height);
    } catch (e) { console.warn("[planner ambiance] calque illisible :", (e as Error).message); }
  }
  return { image: capture, masque: calque ? construireMasque(calque) : null, calque };
}

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const cle = process.env.OPENAI_IMAGE_API_KEY || process.env.OPENAI_API_KEY;
  if (!cle) return NextResponse.json({ error: "OPENAI_IMAGE_API_KEY non configurée" }, { status: 500 });

  let body: {
    coloris?: string | null;   // code du nuancier Fermob choisi dans la liste (coloris imposé)
    prompt?: string; capture?: string | null; source?: string | null; calque?: string | null;   // capture = version ; source = même vue cadrée pour l'IA
    ambiance?: { capture?: string | null; calque?: string | null } | null;   // paire cadrée « photo » (caméra dédiée)
    dims?: Record<string, { l: number; p: number; h: number }>; regenerer?: boolean;
  } = {};
  try { body = await req.json(); } catch { /* corps vide */ }
  // Les phrases qui parlent des meubles (couleur, ajout, retrait…) sont
  // écartées : le décor ne pilote que le décor. Le coloris passe par body.coloris.
  const { decor: description, ignores } = filtrerDecor(String(body.prompt || "").slice(0, 1200));
  if (!description) return NextResponse.json({ error: "Décris l'ambiance souhaitée" }, { status: 400 });

  // La capture de la version est remplacée par la vue du moment (celle qui
  // part à l'IA), même si une ambiance précédente était retenue : plan et
  // nouveau rendu montreront le même angle.
  const v = await figerVersion(id, "ambiance", { capture: body.capture, dims: body.dims, forcerCapture: true });
  if ("error" in v) return NextResponse.json({ error: v.error }, { status: v.status });

  const { data: vv } = await supabaseAdmin
    .from("planner_scenes_versions")
    .select("sol, items, cree_par")
    .eq("id", v.id)
    .maybeSingle();

  // Image de départ : la paire « photo » si le client l'a envoyée (caméra à
  // hauteur d'œil, bord avant hors champ), sinon la capture normale + son
  // calque, sinon la capture figée de la version (sans calque possible).
  let capture = depuisDataUrl(body.source || body.ambiance?.capture || body.capture);
  if (capture && !body.source) capture = aplatirSurBlanc(capture);
  let calque = depuisDataUrl(body.ambiance?.calque || body.calque);
  if (!capture) {
    if (!v.capture_url) return NextResponse.json({ error: "Aucune capture 3D pour cette version" }, { status: 400 });
    const src = await fetch(v.capture_url);
    if (!src.ok) return NextResponse.json({ error: "Capture 3D illisible" }, { status: 500 });
    capture = Buffer.from(await src.arrayBuffer());
    calque = null;
  }
  const items = (Array.isArray(vv?.items) ? vv!.items : []) as { titre?: string; marque?: string | null; sku?: string | null; variant_id?: string | null; image_url?: string | null }[];
  const nbArticles = items.length;
  // Options de la variante posée (coloris, taille) : lecture Shopify par ID
  // de variante (lecture seule), repli sur l'index 3D. Sert à la
  // bibliothèque de matières / couleurs et aux échantillons Dedon.
  const optionsParVariante = new Map<string, Record<string, string>>();
  const gids = [...new Set(items.map((it) => it.variant_id).filter(Boolean))] as string[];
  if (gids.length) {
    try {
      const d = await shopifyAdminGraphQL<{ nodes: ({ id: string; selectedOptions?: { name: string; value: string }[] } | null)[] }>(
        `query($ids: [ID!]!) { nodes(ids: $ids) { ... on ProductVariant { id selectedOptions { name value } } } }`,
        { ids: gids },
      );
      for (const n of d.nodes || []) {
        if (n?.id && n.selectedOptions) optionsParVariante.set(n.id, Object.fromEntries(n.selectedOptions.map((o) => [o.name, o.value])));
      }
    } catch (e) { console.warn("[planner ambiance] options Shopify :", (e as Error).message); }
    if (optionsParVariante.size < gids.length) {
      const { data: m3d } = await supabaseAdmin.from("modeles_3d").select("variantes_3d").overlaps("variant_ids", gids);
      for (const row of m3d || []) {
        for (const vr of (row.variantes_3d as { variant_id: string; options?: Record<string, string> }[]) || []) {
          if (vr.variant_id && vr.options && !optionsParVariante.has(vr.variant_id)) optionsParVariante.set(vr.variant_id, vr.options);
        }
      }
    }
  }
  // Échantillons de fibre Dedon du coloris posé (4 au plus, un par coloris)
  const echantillons: { libelle: string; blob: Blob }[] = [];
  const codesVus = new Set<string>();
  for (const it of items) {
    if (!/dedon/i.test(String(it.marque || "")) || !it.variant_id || echantillons.length >= 4) continue;
    const t = textureDedon(Object.values(optionsParVariante.get(it.variant_id) || {}));
    if (!t || codesVus.has(t.code)) continue;
    codesVus.add(t.code);
    let buf: Buffer | null = null;
    try { buf = await readFile(path.join(process.cwd(), "public", "textures", "dedon", t.fichier)); }
    catch {
      try {
        const r = await fetch(`${req.nextUrl.origin}/textures/dedon/${t.fichier}`, { signal: AbortSignal.timeout(5000) });
        if (r.ok) buf = Buffer.from(await r.arrayBuffer());
      } catch { /* échantillon ignoré */ }
    }
    if (buf) echantillons.push({ libelle: `fibre Dedon ${t.nom} ${t.code} de « ${String(it.titre || "").slice(0, 60)} »`, blob: new Blob([new Uint8Array(buf)], { type: "image/jpeg" }) });
  }
  // Une ligne par article posé (les doublons comptent : « exactement N meubles »)
  // Coloris cité dans la description (« meubles en romarin ») → imposé aux
  // structures Fermob, seulement s'il y a du Fermob dans le plan.
  const imposee = body.coloris && items.some((it) => /fermob/i.test(String(it.marque || "")))
    ? COULEURS_FERMOB.find((c) => c.code === String(body.coloris).toUpperCase()) || null
    : null;
  const articles = items.map((it) => decrireArticle({ titre: String(it.titre || "article"), marque: it.marque, sku: it.sku, options: it.variant_id ? optionsParVariante.get(it.variant_id) || null : null }, imposee));
  // Photos catalogue des produits (une par fiche, 4 au plus) : entrées
  // supplémentaires pour l'IA — les détails viennent de là, la composition
  // de la capture. Une photo illisible est simplement ignorée.
  const refs: { titre: string; blob: Blob }[] = [];
  const vues = new Set<string>();
  for (const it of PHOTOS ? items : []) {
    const u = it.image_url || "";
    if (!u || vues.has(u) || refs.length >= 4) continue;
    vues.add(u);
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(6000) });
      if (!r.ok) continue;
      const type = r.headers.get("content-type") || "image/jpeg";
      if (!/^image\/(png|jpe?g|webp)/.test(type)) continue;
      const b = await r.arrayBuffer();
      if (b.byteLength > 4_000_000) continue;
      refs.push({ titre: String(it.titre || "article").slice(0, 80), blob: new Blob([b], { type }) });
    } catch { /* photo ignorée */ }
  }

  const prep = MODE === "calque" ? preparer(capture, calque) : { image: capture, masque: null as Buffer | null, calque: null as PNG | null };

  const prompt = construirePrompt(description, SOLS[String(vv?.sol || "bois")] || "lames de bois", nbArticles, refs.map((r) => r.titre), articles, echantillons.map((e) => e.libelle), imposee);
  const appeler = async (modele: string) => {
    const form = new FormData();
    form.append("model", modele);
    // Plusieurs images d'entrée : image[] — la première est la source, les
    // suivantes les photos catalogue (gpt-image-1 / 1.5 : jusqu'à 16).
    form.append("image[]", new Blob([new Uint8Array(prep.image)], { type: "image/png" }), "capture.png");
    echantillons.forEach((e, i) => form.append("image[]", e.blob, `echantillon-${i + 1}.jpg`));
    refs.forEach((r, i) => form.append("image[]", r.blob, `produit-${i + 1}.${r.blob.type.includes("png") ? "png" : "jpg"}`));
    if (prep.masque) form.append("mask", new Blob([new Uint8Array(prep.masque)], { type: "image/png" }), "masque.png");
    form.append("prompt", prompt);
    form.append("size", `${LARG}x${HAUT}`);
    form.append("quality", process.env.OPENAI_IMAGE_QUALITE || "medium");
    form.append("input_fidelity", "high");   // garde les détails de l'image d'entrée
    form.append("n", "1");
    const r = await fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: { Authorization: `Bearer ${cle}` }, body: form });
    const j = await r.json();
    return { ok: r.ok, statut: r.statusText, j };
  };
  let modele = MODELE;
  let rep = await appeler(modele);
  // Modèle inconnu / non autorisé pour cette clé → on retombe sur gpt-image-1.
  const msg = String(rep.j?.error?.message || "");
  if (!rep.ok && modele !== MODELE_REPLI && /model|not found|does not exist|unsupported|access/i.test(msg)) {
    console.warn(`[planner ambiance] ${modele} indisponible (${msg}) → repli ${MODELE_REPLI}`);
    modele = MODELE_REPLI;
    rep = await appeler(modele);
  }
  const j = rep.j;
  if (!rep.ok || !j.data?.[0]?.b64_json) {
    console.error("[planner ambiance] OpenAI:", j);
    return NextResponse.json({ error: "Génération impossible", details: j.error?.message || rep.statut }, { status: 502 });
  }
  let buf: Buffer = Buffer.from(j.data[0].b64_json, "base64");

  // Recollage des meubles d'origine (avec leurs ombres) sur le décor généré.
  if (prep.calque) {
    try {
      const fond = PNG.sync.read(buf);
      if (fond.width === prep.calque.width && fond.height === prep.calque.height) buf = recoller(fond, prep.calque);
      else console.warn("[planner ambiance] recollage impossible : l'IA a rendu", fond.width, fond.height);
    } catch (e) {
      console.warn("[planner ambiance] recollage impossible, image IA brute conservée :", (e as Error).message);
    }
  }

  // Nom unique : on n'écrase jamais une image précédente.
  const chemin = `planner/${v.token}-ambiance-${Date.now().toString(36)}.png`;
  const { error: up } = await supabaseAdmin.storage.from(BUCKET).upload(chemin, buf, { contentType: "image/png", upsert: false });
  if (up) return NextResponse.json({ error: `Stockage : ${up.message}` }, { status: 500 });
  const url = urlPublique(chemin);
  const { data: ligne, error: e3 } = await supabaseAdmin
    .from("planner_ambiances")
    .insert({ version_id: v.id, scene_id: id, url, chemin, prompt: description, modele, cree_par: vv?.cree_par || null })
    .select("id, url, prompt, modele, cree_le")
    .single();
  if (e3) return NextResponse.json({ error: `Enregistrement : ${e3.message} (SQL 027 exécuté ?)` }, { status: 500 });
  // La nouvelle image est retenue pour les documents ; les PDF déjà générés
  // sont invalidés pour être refaits avec elle.
  await supabaseAdmin.from("planner_scenes_versions")
    .update({ ambiance_url: url, ambiance_prompt: description, ambiance_cree_le: new Date().toISOString(), pdf_url: null, pdf_sans_prix_url: null })
    .eq("id", v.id);
  const toutes = await listerScene(id);

  return NextResponse.json({ ambiance_url: url, ambiance: ligne, ambiances: toutes || [ligne], retenue: url, numero: v.numero, token: v.token, mention: MENTION_IA, modele, references: refs.length, echantillons: echantillons.length, coloris: imposee ? `${imposee.nom} ${imposee.code}` : null, ignores });
}
