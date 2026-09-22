// app/api/planner/scenes/[id]/ambiances/route.ts  (interne)
// Gestion des images d'ambiance IA d'une scène (table planner_ambiances,
// SQL 027). Une version figée peut avoir plusieurs images ; UNE au plus est
// « retenue » pour les documents (ambiance_url de la version), ou aucune.
//
//   GET    → { numero, token, retenue, ambiances[] } : TOUTES les images de la
//          scène (toutes versions, badge numero), retenue = celle de la
//          dernière version (la version courante des documents)
//   PATCH  { id, action: "retenir" | "exclure" }
//          retenir : cette image va sur la fiche, le PDF et la page client
//          exclure : aucune image d'ambiance sur les documents
//   DELETE { id }             → supprime la ligne ET le fichier du bucket ;
//          si c'était l'image retenue, les documents n'en ont plus.
// Changer l'image retenue invalide les PDF déjà générés (pdf_url à null) :
// le prochain « PDF » les refait.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { BUCKET } from "@/lib/planner-versions";
import { listerScene } from "@/lib/planner-ambiances";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function derniereVersion(sceneId: string, token?: string | null) {
  let q = supabaseAdmin.from("planner_scenes_versions").select("id, numero, token, ambiance_url").eq("scene_id", sceneId);
  q = token ? q.eq("token", token) : q.order("numero", { ascending: false }).limit(1);
  const { data } = await q.maybeSingle();
  return data as { id: string; numero: number; token: string; ambiance_url: string | null } | null;
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const v = await derniereVersion(id, req.nextUrl.searchParams.get("version"));
  if (!v) return NextResponse.json({ numero: null, token: null, retenue: null, ambiances: [] });
  return NextResponse.json({ numero: v.numero, token: v.token, retenue: v.ambiance_url, ambiances: await listerScene(id) });
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  let body: { id?: string; action?: string } = {};
  try { body = await req.json(); } catch { /* vide */ }
  if (!body.id || !["retenir", "exclure"].includes(String(body.action))) return NextResponse.json({ error: "Paramètres invalides" }, { status: 400 });

  const { data: a } = await supabaseAdmin.from("planner_ambiances").select("id, version_id, url, prompt, cree_le").eq("id", body.id).eq("scene_id", id).maybeSingle();
  if (!a) return NextResponse.json({ error: "Image introuvable" }, { status: 404 });
  // L'image retenue s'applique à la VERSION COURANTE (la dernière), même si
  // elle a été générée sur une version antérieure du plan.
  const v = await derniereVersion(id);
  if (!v) return NextResponse.json({ error: "Aucune version" }, { status: 404 });

  const maj = body.action === "retenir"
    ? { ambiance_url: a.url, ambiance_prompt: a.prompt, ambiance_cree_le: a.cree_le, pdf_url: null, pdf_sans_prix_url: null }
    : { ambiance_url: null, ambiance_prompt: null, ambiance_cree_le: null, pdf_url: null, pdf_sans_prix_url: null };
  const { error } = await supabaseAdmin.from("planner_scenes_versions").update(maj).eq("id", v.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, retenue: maj.ambiance_url, ambiances: await listerScene(id) });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  let body: { id?: string } = {};
  try { body = await req.json(); } catch { /* vide */ }
  if (!body.id) return NextResponse.json({ error: "id manquant" }, { status: 400 });

  const { data: a } = await supabaseAdmin.from("planner_ambiances").select("id, version_id, url, chemin").eq("id", body.id).eq("scene_id", id).maybeSingle();
  if (!a) return NextResponse.json({ error: "Image introuvable" }, { status: 404 });

  // Toute version qui la retenait n'a plus d'image sur ses documents (pas de
  // remplacement automatique : c'est au conseiller d'en retenir une autre).
  await supabaseAdmin.from("planner_scenes_versions")
    .update({ ambiance_url: null, ambiance_prompt: null, ambiance_cree_le: null, pdf_url: null, pdf_sans_prix_url: null })
    .eq("scene_id", id).eq("ambiance_url", a.url);
  await supabaseAdmin.from("planner_ambiances").delete().eq("id", a.id);
  if (a.chemin) await supabaseAdmin.storage.from(BUCKET).remove([a.chemin as string]);
  const v = await derniereVersion(id);
  return NextResponse.json({ ok: true, retenue: v?.ambiance_url || null, ambiances: await listerScene(id) });
}
