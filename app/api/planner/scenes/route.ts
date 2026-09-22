// app/api/planner/scenes/route.ts
//
// Scènes du planner (route interne).
//   GET          → 50 dernières scènes (id, nom, cree_par, offre_slug, nb items, updated_at)
//   POST {scene} → crée une scène, renvoie { id }
// Voir [id]/route.ts pour GET / PUT / DELETE d'une scène.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import type { Scene } from "@/lib/planner-types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const offreSlug = (new URL(request.url).searchParams.get("offre_slug") || "").trim();
    let q = supabaseAdmin
      .from("planner_scenes")
      .select("id, nom, cree_par, offre_slug, items, mode, updated_at")
      .order("updated_at", { ascending: false })
      .limit(50);
    if (offreSlug) q = q.eq("offre_slug", offreSlug);
    const { data, error } = await q;
    if (error) throw error;
    // Pour la card « Faisabilité 3D » : aperçu léger = capture PNG de la
    // dernière version figée (+ PDF et lien client s'ils existent).
    const dernieres = new Map<string, { numero: number; token: string; capture_url: string | null; pdf_url: string | null; cree_le: string }>();
    if (offreSlug && (data || []).length) {
      const { data: vs } = await supabaseAdmin
        .from("planner_scenes_versions")
        .select("scene_id, numero, token, capture_url, pdf_url, cree_le")
        .in("scene_id", (data || []).map((s) => s.id as string))
        .order("numero", { ascending: false });
      for (const v of vs || []) if (!dernieres.has(v.scene_id as string)) dernieres.set(v.scene_id as string, v as never);
    }
    const scenes = (data || []).map((s) => ({
      id: s.id as string,
      nom: s.nom as string,
      cree_par: s.cree_par as string | null,
      offre_slug: s.offre_slug as string | null,
      nb_items: Array.isArray(s.items) ? (s.items as unknown[]).length : 0,
      mode: s.mode as string,
      updated_at: s.updated_at as string,
      derniere_version: dernieres.get(s.id as string) || null,
    }));
    return NextResponse.json({ scenes });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { scene: Scene; cree_par?: string | null };
    const s = body.scene;
    if (!s || !Array.isArray(s.items)) return NextResponse.json({ error: "Scène invalide" }, { status: 400 });
    const { data, error } = await supabaseAdmin
      .from("planner_scenes")
      .insert({
        nom: (s.nom || "Sans titre").slice(0, 120),
        cree_par: body.cree_par || null,
        offre_slug: s.offre_slug || null,
        terrasse: s.terrasse,
        items: s.items,
        mode: s.mode,
        vue: s.vue,
        sol: s.sol || "bois",
        camera: s.camera || null,
      })
      .select("id")
      .single();
    if (error) throw error;
    return NextResponse.json({ id: data.id });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
