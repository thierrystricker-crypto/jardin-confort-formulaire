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
// Résultat stocké sur la version (ambiance_url) dans le bucket « pdfs ».
// Une image existe déjà pour cette version et le prompt est identique →
// renvoyée telle quelle (regenerer: true pour forcer).

import { NextRequest, NextResponse } from "next/server";
import { PNG } from "pngjs";
import { supabaseAdmin } from "@/lib/supabase";
import { BUCKET, figerVersion, urlPublique } from "@/lib/planner-versions";
import { MENTION_IA } from "@/lib/planner-types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MODELE = process.env.OPENAI_IMAGE_MODELE || "gpt-image-1.5";
const MODELE_REPLI = "gpt-image-1";
const MODE = process.env.AMBIANCE_MODE === "calque" ? "calque" : "prompt";
const LARG = 1536, HAUT = 1024;          // format paysage 3:2

// Prompt maître (le bloc « AMBIANCE À CRÉER » est le seul qui varie). Rédigé
// avec ChatGPT le 22.09.2026 à partir du résultat validé ; les meubles sont
// présentés comme une couche produit verrouillée, pas comme une référence.
function construirePrompt(description: string, sol: string, nbArticles: number): string {
  return `MODIFICATION DE L'IMAGE FOURNIE — NE PAS RÉINTERPRÉTER LES PRODUITS.
Utilise l'image jointe comme image source et crée une image d'ambiance photoréaliste autour des meubles 3D présents dans l'image (${nbArticles} article${nbArticles > 1 ? "s" : ""} de mobilier d'extérieur vendus par Jardin-Confort, Suisse).

CONTRAINTE ABSOLUE ET PRIORITAIRE : les meubles visibles dans l'image sont les produits réellement vendus et leur rendu est contractuel. Les meubles doivent donc rester strictement identiques au rendu 3D fourni. Ne jamais modifier, redessiner, réinterpréter ou compléter les meubles. Conserver exactement : leur nombre ; leur forme et leurs proportions ; leur position relative et leur espacement ; leur angle de vue et leur perspective ; leurs dimensions relatives ; leurs pieds et structures ; leurs coussins ; leur capitonnage ; leurs coutures ; leur tressage ; leurs matériaux ; leurs couleurs et nuances ; tous les petits détails visibles du modèle 3D.
Ne jamais inventer une partie non visible du meuble. Ne jamais ajouter, supprimer ou déplacer un pied, coussin, accoudoir, élément de structure ou détail. Ne pas remplacer le mobilier par un meuble similaire. Ne pas « améliorer » le design du produit. Ne pas changer son style. Considère les meubles comme une couche visuelle verrouillée et intangible : le travail créatif porte uniquement sur le décor qui les entoure.
L'angle de caméra et la taille des meubles peuvent varier d'une image source à l'autre : respecter systématiquement la perspective et l'échelle de l'export fourni, sans essayer de reproduire une composition précédente.
Le sol provisoire du planner (${sol}), l'arrière-plan blanc et les lignes techniques peuvent être supprimés et remplacés par le décor. Faire en sorte que le nouveau sol passe naturellement sous les meubles en conservant précisément leurs points de contact avec le sol. Créer des ombres réalistes et cohérentes avec le nouvel environnement, sans modifier les meubles eux-mêmes.

AMBIANCE À CRÉER :
${description}
Décoration très sobre afin que les produits restent le sujet principal. Image photoréaliste de qualité catalogue / publicité de mobilier outdoor premium. Lumière naturelle réaliste, profondeur photographique subtile, matériaux crédibles. Ne pas ajouter d'autres meubles pouvant être confondus avec les produits vendus ; les accessoires décoratifs éventuels restent secondaires et clairement distincts. Aucun texte, logo ni filigrane.

PRIORITÉ N°1 : fidélité absolue aux meubles de l'image source. PRIORITÉ N°2 : réalisme du décor et intégration naturelle des produits. En cas de conflit entre esthétique et fidélité produit, toujours privilégier la fidélité produit.`;
}

const SOLS: Record<string, string> = { bois: "lames de bois", pierre: "dalles de pierre claire", beton: "béton lisse", gravier: "gravier fin", gazon: "gazon", blanc: "carrelage blanc" };

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
    prompt?: string; capture?: string | null; calque?: string | null;
    ambiance?: { capture?: string | null; calque?: string | null } | null;   // paire cadrée « photo » (caméra dédiée)
    dims?: Record<string, { l: number; p: number; h: number }>; regenerer?: boolean;
  } = {};
  try { body = await req.json(); } catch { /* corps vide */ }
  const description = String(body.prompt || "").trim().slice(0, 800);
  if (!description) return NextResponse.json({ error: "Décris l'ambiance souhaitée" }, { status: 400 });

  const v = await figerVersion(id, "ambiance", { capture: body.capture, dims: body.dims });
  if ("error" in v) return NextResponse.json({ error: v.error }, { status: v.status });

  const { data: vv } = await supabaseAdmin
    .from("planner_scenes_versions")
    .select("ambiance_url, ambiance_prompt, sol, items")
    .eq("id", v.id)
    .maybeSingle();
  if (vv?.ambiance_url && vv.ambiance_prompt === description && !body.regenerer) {
    return NextResponse.json({ ambiance_url: vv.ambiance_url, numero: v.numero, token: v.token, reutilisee: true, mention: MENTION_IA });
  }

  // Image de départ : la paire « photo » si le client l'a envoyée (caméra à
  // hauteur d'œil, bord avant hors champ), sinon la capture normale + son
  // calque, sinon la capture figée de la version (sans calque possible).
  let capture = depuisDataUrl(body.ambiance?.capture || body.capture);
  let calque = depuisDataUrl(body.ambiance?.calque || body.calque);
  if (!capture) {
    if (!v.capture_url) return NextResponse.json({ error: "Aucune capture 3D pour cette version" }, { status: 400 });
    const src = await fetch(v.capture_url);
    if (!src.ok) return NextResponse.json({ error: "Capture 3D illisible" }, { status: 500 });
    capture = Buffer.from(await src.arrayBuffer());
    calque = null;
  }
  const nbArticles = Array.isArray(vv?.items) ? (vv!.items as unknown[]).length : 0;

  const prep = MODE === "calque" ? preparer(capture, calque) : { image: capture, masque: null as Buffer | null, calque: null as PNG | null };

  const prompt = construirePrompt(description, SOLS[String(vv?.sol || "bois")] || "lames de bois", nbArticles);
  const appeler = async (modele: string) => {
    const form = new FormData();
    form.append("model", modele);
    form.append("image", new Blob([new Uint8Array(prep.image)], { type: "image/png" }), "capture.png");
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

  const chemin = `planner/${v.token}-ambiance.png`;
  const { error: up } = await supabaseAdmin.storage.from(BUCKET).upload(chemin, buf, { contentType: "image/png", upsert: true });
  if (up) return NextResponse.json({ error: `Stockage : ${up.message}` }, { status: 500 });
  const url = `${urlPublique(chemin)}?v=${Date.now()}`;
  await supabaseAdmin.from("planner_scenes_versions").update({ ambiance_url: url, ambiance_prompt: description, ambiance_cree_le: new Date().toISOString() }).eq("id", v.id);

  return NextResponse.json({ ambiance_url: url, numero: v.numero, token: v.token, reutilisee: false, mention: MENTION_IA, masque: Boolean(prep.masque), modele });
}
