// app/api/planner/scenes/[id]/versions/route.ts  (interne)
//   POST {motif, capture?, dims?} → fige la scène ENREGISTRÉE en version Vn
//        (ou réutilise la dernière si rien n'a bougé) → { numero, token, url, … }
//   GET → liste des versions (numero, motif, cree_le, url, pdf)
// Logique dans lib/planner-versions.ts (partagée avec la route PDF).

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { figerVersion } from "@/lib/planner-versions";

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
    .select("numero, motif, token, cree_par, cree_le, capture_url, pdf_url, pdf_sans_prix_url")
    .eq("scene_id", id)
    .order("numero", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ versions: (data || []).map((v) => ({ ...v, url: urlPartage(req, v.token as string) })) });
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  let body: { motif?: string; capture?: string | null; dims?: Record<string, { l: number; p: number; h: number }> } = {};
  try { body = await req.json(); } catch { /* corps vide */ }
  const v = await figerVersion(id, String(body.motif || "fiche"), { capture: body.capture, dims: body.dims });
  if ("error" in v) return NextResponse.json({ error: v.error }, { status: v.status });
  return NextResponse.json({ numero: v.numero, token: v.token, cree_le: v.cree_le, url: urlPartage(req, v.token), reutilisee: v.reutilisee, capture_url: v.capture_url });
}
