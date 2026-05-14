// app/api/drafts/[slug]/route.ts
// GET    — récupérer un brouillon complet (avec data JSONB)
// PUT    — mettre à jour un brouillon (étape E, à venir)
// DELETE — supprimer un brouillon (étape F, à venir)

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

// ─────────────────────────────────────────────────────────────
// GET /api/drafts/[slug] — récupérer un brouillon complet
// ─────────────────────────────────────────────────────────────
// Renvoie : { draft: { id, slug, ... toutes colonnes, data } }
// 404 si slug introuvable.

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;

    const { data, error } = await supabaseAdmin
      .from("drafts")
      .select("*")
      .eq("slug", slug)
      .maybeSingle();

    if (error) {
      console.error("Get draft error:", error);
      return NextResponse.json(
        { error: "Erreur base de données : " + error.message },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json(
        { error: "Brouillon introuvable" },
        { status: 404 }
      );
    }

    return NextResponse.json({ draft: data });
  } catch (err) {
    console.error("Get draft error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}