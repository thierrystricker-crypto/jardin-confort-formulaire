// app/api/planner/scenes/[id]/versions/route.ts  (interne)
//   POST {motif} → fige la scène ENREGISTRÉE (telle qu'en base) en version
//                  Vn avec son propre jeton public → { numero, token, url, cree_le }
//   GET           → liste des versions (numero, motif, cree_le, url)
// Le lien de version est immuable : c'est celui qu'on imprime.

import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function urlPartage(req: NextRequest, token: string): string {
  const origine = process.env.NEXT_PUBLIC_BASE_URL || new URL(req.url).origin;
  return `${origine.replace(/\/$/, "")}/planner/partage/${token}`;
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const { data, error } = await supabaseAdmin
    .from("planner_scenes_versions")
    .select("numero, motif, token, cree_par, cree_le")
    .eq("scene_id", id)
    .order("numero", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ versions: (data || []).map((v) => ({ ...v, url: urlPartage(req, v.token as string) })) });
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  let motif = "fiche";
  try { motif = String(((await req.json()) as { motif?: string }).motif || "fiche").slice(0, 20); } catch { /* corps vide */ }
  const { data: s, error } = await supabaseAdmin
    .from("planner_scenes")
    .select("id, nom, terrasse, sol, items, mode, vue, cree_par")
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!s) return NextResponse.json({ error: "Scène introuvable" }, { status: 404 });

  const { data: derniere } = await supabaseAdmin
    .from("planner_scenes_versions")
    .select("numero")
    .eq("scene_id", id)
    .order("numero", { ascending: false })
    .limit(1)
    .maybeSingle();
  const numero = ((derniere?.numero as number) || 0) + 1;
  const token = randomBytes(16).toString("hex");
  const { data: v, error: e2 } = await supabaseAdmin
    .from("planner_scenes_versions")
    .insert({
      scene_id: id, numero, token, motif,
      nom: s.nom, terrasse: s.terrasse, sol: s.sol || "bois", items: s.items, mode: s.mode, vue: s.vue,
      cree_par: s.cree_par,
    })
    .select("numero, token, cree_le")
    .single();
  if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });
  return NextResponse.json({ numero: v.numero, token: v.token, cree_le: v.cree_le, url: urlPartage(req, v.token) });
}
