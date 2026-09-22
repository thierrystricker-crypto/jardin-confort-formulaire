// app/api/planner/scenes/[id]/route.ts
//   GET    → la scène complète
//   PUT    → remplace nom / terrasse / items / mode / vue / sol / camera
//   PATCH  { camera } → mémorise le point de vue seul (sans toucher updated_at :
//          bouger la caméra ne modifie pas le plan)
//   DELETE → supprime

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import type { Scene } from "@/lib/planner-types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const { data, error } = await supabaseAdmin.from("planner_scenes").select("*").eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Scène introuvable" }, { status: 404 });
  const scene: Scene = {
    id: data.id,
    nom: data.nom,
    terrasse: data.terrasse,
    items: data.items,
    mode: data.mode,
    vue: data.vue,
    sol: data.sol || "bois",
    offre_slug: data.offre_slug,
    sur_documents: data.sur_documents === true,
    camera: data.camera || null,
  };
  return NextResponse.json({ scene, cree_par: data.cree_par, updated_at: data.updated_at });
}

export async function PUT(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    const body = (await request.json()) as { scene: Scene };
    const s = body.scene;
    if (!s || !Array.isArray(s.items)) return NextResponse.json({ error: "Scène invalide" }, { status: 400 });
    const { error } = await supabaseAdmin
      .from("planner_scenes")
      .update({
        nom: (s.nom || "Sans titre").slice(0, 120),
        terrasse: s.terrasse,
        items: s.items,
        mode: s.mode,
        vue: s.vue,
        sol: s.sol || "bois",
        sur_documents: s.sur_documents === true,
        ...(s.camera ? { camera: s.camera } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  let body: { camera?: unknown } = {};
  try { body = await request.json(); } catch { /* vide */ }
  if (!body.camera || typeof body.camera !== "object") return NextResponse.json({ error: "camera manquante" }, { status: 400 });
  const { error } = await supabaseAdmin.from("planner_scenes").update({ camera: body.camera }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const { error } = await supabaseAdmin.from("planner_scenes").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
