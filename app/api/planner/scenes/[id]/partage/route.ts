// app/api/planner/scenes/[id]/partage/route.ts  (interne)
//   POST   → crée (ou renvoie) le jeton de partage de la scène → { token, url }
//   DELETE → révoque le jeton (le lien client cesse de fonctionner)
// Le lien public est /planner/partage/<token> (voir proxy.ts : route publique).

import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function urlPartage(req: NextRequest, token: string): string {
  const origine = process.env.NEXT_PUBLIC_BASE_URL || new URL(req.url).origin;
  return `${origine.replace(/\/$/, "")}/planner/partage/${token}`;
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const { data, error } = await supabaseAdmin.from("planner_scenes").select("id, partage_token").eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Scène introuvable" }, { status: 404 });
  let token = data.partage_token as string | null;
  if (!token) {
    token = randomBytes(16).toString("hex");
    const { error: e2 } = await supabaseAdmin
      .from("planner_scenes")
      .update({ partage_token: token, partage_cree_le: new Date().toISOString() })
      .eq("id", id);
    if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });
  }
  return NextResponse.json({ token, url: urlPartage(req, token) });
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const { error } = await supabaseAdmin.from("planner_scenes").update({ partage_token: null, partage_cree_le: null }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
