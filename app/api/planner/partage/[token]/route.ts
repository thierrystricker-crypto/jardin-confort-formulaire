// app/api/planner/partage/[token]/route.ts  (PUBLIC, GET seul — voir proxy.ts)
// Renvoie la scène en lecture seule pour la page client /planner/partage/<token>.
// Aucune donnée interne : ni cree_par, ni id de scène, ni identifiants de
// variante. Les prix restent (ce sont ceux du webshop) avec le drapeau « dès ».

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import type { Scene, SceneItem } from "@/lib/planner-types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { token } = await ctx.params;
  if (!/^[0-9a-f]{32}$/.test(token)) return NextResponse.json({ error: "Lien invalide" }, { status: 404 });
  const { data, error } = await supabaseAdmin
    .from("planner_scenes")
    .select("nom, terrasse, sol, items, mode, vue, updated_at")
    .eq("partage_token", token)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Ce lien n'est plus valable" }, { status: 404 });
  const items = ((data.items as SceneItem[]) || []).map((it) => ({
    uid: it.uid, product_id: it.product_id, titre: it.titre, marque: it.marque,
    url: it.url, source: it.source, x: it.x, z: it.z, rot: it.rot, rot_fix: it.rot_fix,
    size_warn: it.size_warn, color_warn: it.color_warn,
    image_url: it.image_url, prix: it.prix, prix_exact: it.prix_exact, sku: it.sku,
  }));
  const scene: Scene = {
    id: null, nom: data.nom, terrasse: data.terrasse, sol: data.sol || "bois",
    items, mode: data.mode, vue: data.vue,
  };
  return NextResponse.json({ scene, updated_at: data.updated_at }, { headers: { "Cache-Control": "no-store" } });
}
