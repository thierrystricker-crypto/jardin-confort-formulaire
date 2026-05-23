// app/api/dashboard/offres/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET() {
  try {
    // 1) Récupère les données du dashboard depuis la vue
    const { data, error } = await supabaseAdmin
      .from("offres_dashboard")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Dashboard offres error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data || data.length === 0) {
      return NextResponse.json([]);
    }

    // 2) Récupère SEULEMENT le champ "reference" depuis le JSONB data
    //    via l'opérateur Postgres ->>  qui extrait directement la string.
    //    Évite de transférer TOUT le JSONB data (adresses, lignes, ambianceImages
    //    base64, etc.) juste pour récupérer une référence client.
    //
    //    Gain mesuré : passage de plusieurs MB à quelques ko transférés
    //    depuis Supabase. Le SELECT reste batché en cas de gros volumes.
    const ids = data.map(o => o.id);
    const referencesMap = new Map<number, string>();
    for (let i = 0; i < ids.length; i += 500) {
      const batch = ids.slice(i, i + 500);
      const { data: refsData, error: refsError } = await supabaseAdmin
        .from("offres")
        .select("id, reference:data->>reference")
        .in("id", batch);
      
      if (refsError) {
        console.error("Refs batch error:", refsError);
        continue;
      }
      
      for (const row of refsData || []) {
        const ref = (row as { id: number; reference: string | null }).reference;
        if (ref && typeof ref === "string" && ref.trim()) {
          referencesMap.set(row.id, ref.trim());
        }
      }
    }

    // 3) Enrichit les données avec la référence
    const enriched = data.map(o => ({
      ...o,
      reference: referencesMap.get(o.id) || null,
    }));

    return NextResponse.json(enriched);
  } catch (err) {
    console.error("Dashboard error:", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}