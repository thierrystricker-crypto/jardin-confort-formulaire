// app/api/dashboard/offres/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// PostgREST plafonne silencieusement chaque requête à 1000 lignes (max-rows).
// Dès que la table a dépassé 1000 dossiers (sept. 2026), le dashboard ne
// chargeait plus que les 1000 plus récents : les anciens dossiers (ex.
// CMD-80542 GIRAUD, mai 2026) devenaient introuvables à la recherche.
// On pagine donc par tranches de PAGE lignes jusqu'à épuisement.
const PAGE = 1000;

export async function GET() {
  try {
    // La vue offres_dashboard expose désormais la colonne `reference`
    // directement, ainsi que les seules colonnes réellement affichées
    // par le dashboard.
    //
    // Avant : un second passage extrayait data->>'reference' de la table
    // offres. Comme le JSONB `data` est stocké hors-ligne (TOAST), Postgres
    // devait décompresser l'intégralité des offres (~29 Mo) pour n'en tirer
    // qu'une chaîne de caractères → ~3 secondes, et ça empirait à chaque
    // nouvelle commande. La colonne offres.reference existait déjà : elle
    // est maintenant maintenue par trigger et lue directement (~10 ms).
    const rows: unknown[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabaseAdmin
        .from("offres_dashboard")
        .select("*")
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, from + PAGE - 1);

      if (error) {
        console.error("Dashboard offres error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      if (data && data.length > 0) rows.push(...data);
      if (!data || data.length < PAGE) break;
    }

    return NextResponse.json(rows);
  } catch (err) {
    console.error("Dashboard error:", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
