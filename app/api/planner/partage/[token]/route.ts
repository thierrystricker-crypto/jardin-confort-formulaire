// app/api/planner/partage/[token]/route.ts  (PUBLIC, GET seul — voir proxy.ts)
// Renvoie la scène en lecture seule pour la page client /planner/partage/<token>.
// Le jeton est soit celui d'une VERSION figée (export : fiche, capture), soit
// le jeton VIVANT de la scène (bouton « Partager »). Aucune donnée interne :
// ni cree_par, ni id, ni identifiants de variante. Les prix restent (ce sont
// ceux du webshop) avec le drapeau « dès ».

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import type { Scene, SceneItem } from "@/lib/planner-types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

function epurer(items: SceneItem[]): SceneItem[] {
  return (items || []).map((it) => ({
    uid: it.uid, product_id: it.product_id, titre: it.titre, marque: it.marque,
    url: it.url, source: it.source, x: it.x, z: it.z, rot: it.rot, rot_fix: it.rot_fix,
    size_warn: it.size_warn, color_warn: it.color_warn,
    image_url: it.image_url, prix: it.prix, prix_exact: it.prix_exact, sku: it.sku,
  }));
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const { token } = await ctx.params;
  if (!/^[0-9a-f]{32}$/.test(token)) return NextResponse.json({ error: "Lien invalide" }, { status: 404 });
  const entetes = { "Cache-Control": "no-store" };
  const origine = (process.env.NEXT_PUBLIC_BASE_URL || new URL(req.url).origin).replace(/\/$/, "");

  // 1) Version figée ?
  const { data: v, error: ev } = await supabaseAdmin
    .from("planner_scenes_versions")
    .select("scene_id, numero, nom, terrasse, sol, items, mode, vue, cree_le")
    .eq("token", token)
    .maybeSingle();
  if (ev) return NextResponse.json({ error: ev.message }, { status: 500 });
  if (v) {
    // Le projet a-t-il bougé depuis ? (scène mise à jour après la version, ou
    // version plus récente) → la page client le dit et propose le lien vivant.
    const { data: s } = await supabaseAdmin
      .from("planner_scenes")
      .select("updated_at, partage_token")
      .eq("id", v.scene_id)
      .maybeSingle();
    const { data: plusRecente } = await supabaseAdmin
      .from("planner_scenes_versions")
      .select("numero")
      .eq("scene_id", v.scene_id)
      .gt("numero", v.numero)
      .limit(1);
    const scene: Scene = {
      id: null, nom: v.nom, terrasse: v.terrasse, sol: v.sol || "bois",
      items: epurer(v.items as SceneItem[]), mode: v.mode, vue: v.vue,
    };
    const modifieDepuis = Boolean(s?.updated_at && new Date(s.updated_at as string) > new Date(v.cree_le as string)) || (plusRecente?.length || 0) > 0;
    return NextResponse.json({
      scene,
      version: { numero: v.numero, cree_le: v.cree_le },
      modifie_depuis: modifieDepuis,
      url_actuelle: s?.partage_token ? `${origine}/planner/partage/${s.partage_token}` : null,
    }, { headers: entetes });
  }

  // 2) Lien vivant
  const { data, error } = await supabaseAdmin
    .from("planner_scenes")
    .select("nom, terrasse, sol, items, mode, vue, updated_at")
    .eq("partage_token", token)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Ce lien n'est plus valable" }, { status: 404 });
  const scene: Scene = {
    id: null, nom: data.nom, terrasse: data.terrasse, sol: data.sol || "bois",
    items: epurer(data.items as SceneItem[]), mode: data.mode, vue: data.vue,
  };
  return NextResponse.json({ scene, version: null, updated_at: data.updated_at }, { headers: entetes });
}
