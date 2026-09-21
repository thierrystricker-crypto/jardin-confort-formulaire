// app/api/planner/scenes/[id]/ambiance/route.ts  (interne)
// POST {prompt, capture, calque, dims} → image d'ambiance générée par IA à
// partir de la capture 3D : les MEUBLES restent tels quels, seuls le sol, le
// décor, la végétation, le ciel et la lumière sont réinventés d'après la
// description du conseiller.
//
// Garantie « meubles intacts » en deux temps (l'IA seule réinterprète tout,
// jusqu'au nombre de chaises — constaté le 21.09.2026) :
//   1. MASQUE : le calque « terrasse + meubles » (fond transparent, rendu par
//      le canvas avec la même caméra) devient le masque d'édition OpenAI —
//      pixels opaques = interdits, reste transparent = à générer. Le masque
//      seul ne suffit pas : gpt-image-1 le traite comme une indication et
//      redessine volontiers une terrasse ailleurs (constaté 21.09), d'où :
//   2. RECOLLAGE : le calque d'origine (terrasse texturée + meubles + ombres)
//      est composé pixel pour pixel par-dessus l'image générée. Sol et
//      meubles restent solidaires, la géométrie est celle du rendu 3D.
// Sans calque (ancien client), on retombe sur l'édition sans masque.
// Traitement d'image en JS pur (pngjs) : le recadrage 1536×1024 est fait par le
// navigateur, le serveur ne fait que le masque et le recollage — pas de binaire
// natif (sharp ne chargeait pas ses libvips Linux sur Vercel/Turbopack).
//
// Route PARALLÈLE et indépendante : n'utilise ni Jardi (chat) ni le serveur
// MCP jardi-mail — clé dédiée OPENAI_IMAGE_API_KEY (restreinte « Images »),
// repli OPENAI_API_KEY ; modèle gpt-image-1 en mode édition, sortie 1536×1024.
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

const MODELE = process.env.OPENAI_IMAGE_MODELE || "gpt-image-1";
const LARG = 1536, HAUT = 1024;          // format paysage 3:2 de gpt-image-1

// Consignes fixes : le côté commercial des meubles prime, on ne touche qu'au décor.
function construirePrompt(description: string, sol: string, nbArticles: number, masque: boolean): string {
  return [
    "This image is a 3D rendering of a real outdoor furniture arrangement sold by Jardin-Confort (Switzerland).",
    `It contains ${nbArticles} piece(s) of furniture. Keep EVERY piece of furniture EXACTLY as shown: same models, shapes, proportions, colours, materials, count, positions, orientations and spacing. Do not add, remove, move, resize, restyle or recolour any furniture. Do not add cushions, tableware, plants on tables, people or animals.`,
    masque
      ? `The photo is taken at standing eye level from the front edge of a ${sol} terrace; the terrace fills the bottom of the frame and its far edge is visible. The opaque area of the mask is this terrace with the furniture on it: never paint over it, never move or resize it. Generate ONLY the transparent area: the landscape beyond the far edge and beside the terrace, the horizon, the sky and the lighting, seen from the same eye height so it connects naturally to the terrace edges. Do NOT draw any other deck, platform, floor, steps, wall or furniture anywhere.`
      : `Replace ONLY the environment: the ground / terrace surface (currently ${sol}), the surroundings, vegetation, sky, horizon and lighting.`,
    "Keep the camera angle, perspective and framing unchanged.",
    `Description of the wanted setting: "${description}".`,
    "Photorealistic, natural daylight, high-end garden-magazine editorial photograph, soft realistic shadows consistent with the lighting, no text, no logo, no watermark.",
  ].filter(Boolean).join(" ");
}

const SOLS: Record<string, string> = { bois: "wooden decking", pierre: "light natural stone slabs", beton: "smooth concrete", gravier: "fine gravel", gazon: "lawn grass", blanc: "white tiles" };

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

  const prep = preparer(capture, calque);

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

  return NextResponse.json({ ambiance_url: url, numero: v.numero, token: v.token, reutilisee: false, mention: MENTION_IA, masque: Boolean(prep.masque) });
}
