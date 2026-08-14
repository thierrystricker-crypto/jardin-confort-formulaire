// app/api/dashboard/offres/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

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
    const { data, error } = await supabaseAdmin
      .from("offres_dashboard")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Dashboard offres error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data || []);
  } catch (err) {
    console.error("Dashboard error:", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
