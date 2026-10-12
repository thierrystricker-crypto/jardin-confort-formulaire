// app/api/offres/[slug]/matieres/route.ts
// GET — palette des couleurs et matières d'une offre (moodboard, 12.10.2026).
//
// PUBLIC en lecture (voir proxy.ts) : pdf.co rend /print/offre/[slug] depuis
// ses serveurs, sans cookie. Protégée, cette route renverrait 401 et le PDF
// sortirait sans moodboard, en silence — même cas que /signature.
// N'expose que des noms de finitions, des vignettes publiques et deux nombres
// de couverture : aucune donnée client, aucun prix, aucun stock. La liste des
// articles non reliés reste INTERNE (aperçu du formulaire, route protégée).
//
// Offre : palette calculée en direct (comme le stock).
// Commande : si une palette a été figée dans data.moodboard.palette (étape
// suivante du chantier : figée à la conversion, recalculée à chaque révision),
// on la renvoie telle quelle ; sinon calcul en direct.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase";
import { matieresPourLignes } from "@/lib/matieres-offre";
import type { ResultatMoodboard } from "@/lib/moodboard";

const SANS_CACHE = { headers: { "Cache-Control": "no-store" } };

function publique(r: ResultatMoodboard, source: string) {
  return {
    matieres: r.matieres,
    couverture: { articles: r.couverture.articles, representes: r.couverture.representes },
    source,
  };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;

    const { data: offre, error } = await supabase
      .from("offres")
      .select("data")
      .eq("slug", slug)
      .single();

    if (error || !offre) {
      return NextResponse.json({ error: "Offre non trouvée" }, { status: 404 });
    }

    const data = (offre.data ?? {}) as {
      lines?: unknown[];
      moodboard?: { palette?: ResultatMoodboard };
    };

    const figee = data.moodboard?.palette;
    if (figee && Array.isArray(figee.matieres) && figee.couverture) {
      return NextResponse.json(publique(figee, "figee"), SANS_CACHE);
    }

    const r = await matieresPourLignes((data.lines ?? []) as Parameters<typeof matieresPourLignes>[0]);
    return NextResponse.json(publique(r, "direct"), SANS_CACHE);
  } catch (e) {
    console.error("GET /api/offres/[slug]/matieres:", e);
    // Le moodboard ne doit jamais faire échouer un document : liste vide.
    return NextResponse.json(
      { matieres: [], couverture: { articles: 0, representes: 0 }, source: "erreur" },
      { status: 200 }
    );
  }
}
