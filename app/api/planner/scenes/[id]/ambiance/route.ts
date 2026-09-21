// app/api/planner/scenes/[id]/ambiance/route.ts  (interne)
// POST {prompt, capture, calque, dims} → image d'ambiance générée par IA à
// partir de la capture 3D : les MEUBLES restent tels quels, seuls le sol, le
// décor, la végétation, le ciel et la lumière sont réinventés d'après la
// description du conseiller.
//
// Garantie « meubles intacts » en deux temps (l'IA seule réinterprète tout,
// jusqu'au nombre de chaises — constaté le 21.09.2026) :
//   1. MASQUE : le calque « meubles seuls » (fond transparent, rendu par le
//      canvas avec la même caméra) devient le masque d'édition OpenAI — pixels
//      meubles opaques = interdits, reste transparent = à générer.
//   2. RECOLLAGE : le calque d'origine (meubles + ombres portées) est composé
//      pixel pour pixel par-dessus l'image générée. Quoi que fasse l'IA sur
//      les bords, ce que voit le client est le rendu 3D exact.
// Sans calque (ancien client), on retombe sur l'édition sans masque.
//
// Route PARALLÈLE et indépendante : n'utilise ni Jardi (chat) ni le serveur
// MCP jardi-mail — clé dédiée OPENAI_IMAGE_API_KEY (restreinte « Images »),
// repli OPENAI_API_KEY ; modèle gpt-image-1 en mode édition, sortie 1536×1024.
// Résultat stocké sur la version (ambiance_url) dans le bucket « pdfs ».
// Une image existe déjà pour cette version et le prompt est identique →
// renvoyée telle quelle (regenerer: true pour forcer).

import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { supabaseAdmin } from "@/lib/supabase";
import { BUCKET, figerVersion, urlPublique } from "@/lib/planner-versions";
import { MENTION_IA } from "@/lib/planner-types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MODELE = process.env.OPENAI_IMAGE_MODELE || "gpt-image-1";
const LARG = 1536, HAUT = 1024;          // format paysage 3:2 de gpt-image-1
const FOND = "#dfe3e6";                  // remplace le fond transparent du canvas

// Consignes fixes : le côté commercial des meubles prime, on ne touche qu'au décor.
function construirePrompt(description: string, sol: string, nbArticles: number, masque: boolean): string {
  return [
    "This image is a 3D rendering of a real outdoor furniture arrangement sold by Jardin-Confort (Switzerland).",
    `It contains ${nbArticles} piece(s) of furniture. Keep EVERY piece of furniture EXACTLY as shown: same models, shapes, proportions, colours, materials, count, positions, orientations and spacing. Do not add, remove, move, resize, restyle or recolour any furniture. Do not add cushions, tableware, plants on tables, people or animals.`,
    masque
      ? "The opaque area of the mask is the furniture: never paint over it. Generate only the transparent area. The furniture stands on one flat, continuous ground surface: keep that surface level and coherent under and between all pieces."
      : "",
    "Keep the camera angle, perspective and framing unchanged.",
    `Replace ONLY the environment: the ground / terrace surface (currently ${sol}), the surroundings, vegetation, sky, horizon and lighting, according to this description: "${description}".`,
    "Photorealistic, natural daylight, high-end garden-magazine editorial photograph, soft realistic shadows consistent with the lighting, no text, no logo, no watermark.",
  ].filter(Boolean).join(" ");
}

const SOLS: Record<string, string> = { bois: "wooden decking", pierre: "light natural stone slabs", beton: "smooth concrete", gravier: "fine gravel", gazon: "lawn grass", blanc: "white tiles" };

function depuisDataUrl(d?: string | null): Buffer | null {
  if (!d) return null;
  const i = d.indexOf(",");
  try { return Buffer.from(i >= 0 ? d.slice(i + 1) : d, "base64"); } catch { return null; }
}

// Image de base, masque et calque, tous ramenés au même cadrage 1536×1024
// (recadrage « cover » centré, identique pour les trois → superposables).
async function preparer(capture: Buffer, calque: Buffer | null) {
  const cadrer = (b: Buffer) => sharp(b).resize(LARG, HAUT, { fit: "cover", position: "centre" });
  const image = await cadrer(capture).flatten({ background: FOND }).png().toBuffer();
  if (!calque) return { image, masque: null as Buffer | null, meubles: null as Buffer | null };

  // Le calque doit venir du même canvas que la capture (même taille), sinon
  // il ne se superpose pas : on l'ignore plutôt que de recoller de travers.
  const [mc, mq] = await Promise.all([sharp(capture).metadata(), sharp(calque).metadata()]);
  if (mc.width !== mq.width || mc.height !== mq.height) {
    console.warn("[planner ambiance] calque ignoré : taille différente de la capture", mc.width, mc.height, mq.width, mq.height);
    return { image, masque: null, meubles: null };
  }
  const meubles = await cadrer(calque).ensureAlpha().png().toBuffer();
  // Masque : alpha des meubles seuil 160/255 → les ombres (≈115) restent
  // « à générer », les meubles sont opaques (protégés). Pixels traités à la
  // main (joinChannel sur une image créée sortait un alpha vide).
  const { data, info } = await sharp(meubles).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] >= 160 ? 255 : 0;
    data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = a;
  }
  const masque = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
  return { image, masque, meubles };
}

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const cle = process.env.OPENAI_IMAGE_API_KEY || process.env.OPENAI_API_KEY;
  if (!cle) return NextResponse.json({ error: "OPENAI_IMAGE_API_KEY non configurée" }, { status: 500 });

  let body: { prompt?: string; capture?: string | null; calque?: string | null; dims?: Record<string, { l: number; p: number; h: number }>; regenerer?: boolean } = {};
  try { body = await req.json(); } catch { /* corps vide */ }
  const description = String(body.prompt || "").trim().slice(0, 400);
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

  // Image de départ : la capture envoyée (même canvas que le calque) ; sinon
  // la capture figée de la version (sans calque possible).
  let capture = depuisDataUrl(body.capture);
  let calque = depuisDataUrl(body.calque);
  if (!capture) {
    if (!v.capture_url) return NextResponse.json({ error: "Aucune capture 3D pour cette version" }, { status: 400 });
    const src = await fetch(v.capture_url);
    if (!src.ok) return NextResponse.json({ error: "Capture 3D illisible" }, { status: 500 });
    capture = Buffer.from(await src.arrayBuffer());
    calque = null;
  }
  const nbArticles = Array.isArray(vv?.items) ? (vv!.items as unknown[]).length : 0;

  let prep: Awaited<ReturnType<typeof preparer>>;
  try { prep = await preparer(capture, calque); }
  catch (e) { return NextResponse.json({ error: "Préparation de l'image impossible", details: (e as Error).message }, { status: 500 }); }

  const form = new FormData();
  form.append("model", MODELE);
  form.append("image", new Blob([new Uint8Array(prep.image)], { type: "image/png" }), "capture.png");
  if (prep.masque) form.append("mask", new Blob([new Uint8Array(prep.masque)], { type: "image/png" }), "masque.png");
  form.append("prompt", construirePrompt(description, SOLS[String(vv?.sol || "bois")] || "wooden decking", nbArticles, Boolean(prep.masque)));
  form.append("size", `${LARG}x${HAUT}`);
  form.append("quality", process.env.OPENAI_IMAGE_QUALITE || "medium");
  form.append("input_fidelity", "high");   // gpt-image-1 : garde les détails de l'image d'entrée
  form.append("n", "1");

  const r = await fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: { Authorization: `Bearer ${cle}` }, body: form });
  const j = await r.json();
  if (!r.ok || !j.data?.[0]?.b64_json) {
    console.error("[planner ambiance] OpenAI:", j);
    return NextResponse.json({ error: "Génération impossible", details: j.error?.message || r.statusText }, { status: 502 });
  }
  let buf = Buffer.from(j.data[0].b64_json, "base64");

  // Recollage des meubles d'origine (avec leurs ombres) sur le décor généré.
  if (prep.meubles) {
    try {
      const m = await sharp(buf).metadata();
      const calqueFinal = (m.width === LARG && m.height === HAUT)
        ? prep.meubles
        : await sharp(prep.meubles).resize(m.width, m.height, { fit: "fill" }).png().toBuffer();
      buf = await sharp(buf).composite([{ input: calqueFinal }]).png().toBuffer();
    } catch (e) {
      console.warn("[planner ambiance] recollage impossible, image IA brute conservée :", (e as Error).message);
    }
  }

  const chemin = `planner/${v.token}-ambiance.png`;
  const { error: up } = await supabaseAdmin.storage.from(BUCKET).upload(chemin, buf, { contentType: "image/png", upsert: true });
  if (up) return NextResponse.json({ error: `Stockage : ${up.message}` }, { status: 500 });
  const url = `${urlPublique(chemin)}?v=${Date.now()}`;
  await supabaseAdmin.from("planner_scenes_versions").update({ ambiance_url: url, ambiance_prompt: description, ambiance_cree_le: new Date().toISOString() }).eq("id", v.id);

  return NextResponse.json({ ambiance_url: url, numero: v.numero, token: v.token, reutilisee: false, mention: MENTION_IA, masque: Boolean(prep.masque) });
}
