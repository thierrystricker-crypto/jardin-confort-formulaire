// app/api/dashboard/articles/route.ts
// GET /api/dashboard/articles?q=tucson
//
// Recherche par article : « quelles offres / commandes contiennent tel
// article ? ». S'appuie sur la table offres_articles (lignes extraites de
// offres.data->'lines', maintenue par trigger) et sur la fonction SQL
// offres_par_article(q).
//
// Tous les mots doivent se trouver dans la MÊME ligne d'article (n° d'article
// ou libellé), dans n'importe quel ordre, accents et casse ignorés.
//
// Renvoie : { hits: { [offreId]: "SKU · libellé | SKU · libellé" }, count }

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const q = (new URL(request.url).searchParams.get("q") || "").trim();

    // Moins de 2 caractères : on ne cherche pas (trop de bruit)
    if (q.length < 2) {
      return NextResponse.json({ hits: {}, count: 0 });
    }

    const { data, error } = await supabaseAdmin.rpc("offres_par_article", { q });

    if (error) {
      console.error("Recherche article error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows = (data || []) as { offre_id: number; articles: string | null }[];
    const hits: Record<number, string> = {};
    for (const row of rows) {
      hits[row.offre_id] = (row.articles || "").trim();
    }

    return NextResponse.json({ hits, count: rows.length });
  } catch (err) {
    console.error("Recherche article error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
