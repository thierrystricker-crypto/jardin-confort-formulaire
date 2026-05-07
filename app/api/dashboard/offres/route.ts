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

    // 2) Récupère les références depuis la table offres (en JSON)
    //    On batch par 200 IDs pour éviter les limites d'URL
    const ids = data.map(o => o.id);
    const referencesMap = new Map<number, string>();

    for (let i = 0; i < ids.length; i += 200) {
      const batch = ids.slice(i, i + 200);
      const { data: refsData, error: refsError } = await supabaseAdmin
        .from("offres")
        .select("id, data")
        .in("id", batch);
      
      if (refsError) {
        console.error("Refs batch error:", refsError);
        continue;
      }
      
      for (const row of refsData || []) {
        const ref = (row.data as Record<string, unknown>)?.reference;
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