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

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from("planner_scenes")
      .select("id, nom, cree_par, offre_slug, items, mode, updated_at")
      .order("updated_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    const scenes = (data || []).map((s) => ({
      id: s.id as string,
      nom: s.nom as string,
      cree_par: s.cree_par as string | null,
      offre_slug: s.offre_slug as string | null,
      nb_items: Array.isArray(s.items) ? (s.items as unknown[]).length : 0,
      mode: s.mode as string,
      updated_at: s.updated_at as string,
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
      })
      .select("id")
      .single();
    if (error) throw error;
    return NextResponse.json({ id: data.id });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
