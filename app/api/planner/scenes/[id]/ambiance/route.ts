// app/api/planner/scenes/[id]/ambiance/route.ts  (interne)
// POST {prompt, capture, dims} → image d'ambiance générée par IA à partir de
// la capture 3D de la version figée : les MEUBLES restent tels quels (modèles,
// positions, proportions, couleurs), seuls le sol, le décor, la végétation,
// le ciel et la lumière sont réinventés d'après la description du conseiller.
//
// Route PARALLÈLE et indépendante : n'utilise ni Jardi (chat) ni le serveur
// MCP jardi-mail — seulement la clé OpenAI déjà en place pour la voix
// (OPENAI_API_KEY), modèle d'image gpt-image-1 en mode édition.
// Résultat stocké sur la version (ambiance_url) dans le bucket « pdfs ».
// Une image existe déjà pour cette version et le prompt est identique →
// renvoyée telle quelle (regenerer: true pour forcer).

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { BUCKET, figerVersion, urlPublique } from "@/lib/planner-versions";
import { MENTION_IA } from "@/lib/planner-types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MODELE = process.env.OPENAI_IMAGE_MODELE || "gpt-image-1";

// Consignes fixes : le côté commercial des meubles prime, on ne touche qu'au décor.
function construirePrompt(description: string, sol: string, nbArticles: number): string {
  return [
    "This image is a 3D rendering of a real outdoor furniture arrangement sold by Jardin-Confort (Switzerland).",
    `It contains ${nbArticles} piece(s) of furniture. Keep EVERY piece of furniture EXACTLY as shown: same models, shapes, proportions, colours, materials, count, positions, orientations and spacing. Do not add, remove, move, resize, restyle or recolour any furniture. Do not add cushions, tableware, plants on tables, people or animals.`,
    "Keep the camera angle, perspective and framing unchanged.",
    `Replace ONLY the environment: the ground / terrace surface (currently ${sol}), the surroundings, vegetation, sky, horizon and lighting, according to this description: "${description}".`,
    "Photorealistic, natural daylight, high-end garden-magazine editorial photograph, soft realistic shadows consistent with the lighting, no text, no logo, no watermark.",
  ].join(" ");
}

const SOLS: Record<string, string> = { bois: "wooden decking", pierre: "light natural stone slabs", beton: "smooth concrete", gravier: "fine gravel", gazon: "lawn grass", blanc: "white tiles" };

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const cle = process.env.OPENAI_API_KEY;
  if (!cle) return NextResponse.json({ error: "OPENAI_API_KEY non configurée" }, { status: 500 });

  let body: { prompt?: string; capture?: string | null; dims?: Record<string, { l: number; p: number; h: number }>; regenerer?: boolean } = {};
  try { body = await req.json(); } catch { /* corps vide */ }
  const description = String(body.prompt || "").trim().slice(0, 400);
  if (!description) return NextResponse.json({ error: "Décris l'ambiance souhaitée" }, { status: 400 });

  const v = await figerVersion(id, "ambiance", { capture: body.capture, dims: body.dims });
  if ("error" in v) return NextResponse.json({ error: v.error }, { status: v.status });
  if (!v.capture_url) return NextResponse.json({ error: "Aucune capture 3D pour cette version" }, { status: 400 });

  const { data: vv } = await supabaseAdmin
    .from("planner_scenes_versions")
    .select("ambiance_url, ambiance_prompt, sol, items")
    .eq("id", v.id)
    .maybeSingle();
  if (vv?.ambiance_url && vv.ambiance_prompt === description && !body.regenerer) {
    return NextResponse.json({ ambiance_url: vv.ambiance_url, numero: v.numero, token: v.token, reutilisee: true, mention: MENTION_IA });
  }

  // Image de départ : la capture figée (PNG) — on la récupère depuis le bucket
  const src = await fetch(v.capture_url);
  if (!src.ok) return NextResponse.json({ error: "Capture 3D illisible" }, { status: 500 });
  const png = await src.blob();
  const nbArticles = Array.isArray(vv?.items) ? (vv!.items as unknown[]).length : 0;

  const form = new FormData();
  form.append("model", MODELE);
  form.append("image", png, "capture.png");
  form.append("prompt", construirePrompt(description, SOLS[String(vv?.sol || "bois")] || "wooden decking", nbArticles));
  form.append("size", "1536x1024");
  form.append("quality", process.env.OPENAI_IMAGE_QUALITE || "medium");
  form.append("n", "1");

  const r = await fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: { Authorization: `Bearer ${cle}` }, body: form });
  const j = await r.json();
  if (!r.ok || !j.data?.[0]?.b64_json) {
    console.error("[planner ambiance] OpenAI:", j);
    return NextResponse.json({ error: "Génération impossible", details: j.error?.message || r.statusText }, { status: 502 });
  }
  const buf = Buffer.from(j.data[0].b64_json, "base64");
  const chemin = `planner/${v.token}-ambiance.png`;
  const { error: up } = await supabaseAdmin.storage.from(BUCKET).upload(chemin, buf, { contentType: "image/png", upsert: true });
  if (up) return NextResponse.json({ error: `Stockage : ${up.message}` }, { status: 500 });
  const url = `${urlPublique(chemin)}?v=${Date.now()}`;
  await supabaseAdmin.from("planner_scenes_versions").update({ ambiance_url: url, ambiance_prompt: description, ambiance_cree_le: new Date().toISOString() }).eq("id", v.id);

  return NextResponse.json({ ambiance_url: url, numero: v.numero, token: v.token, reutilisee: false, mention: MENTION_IA });
}
