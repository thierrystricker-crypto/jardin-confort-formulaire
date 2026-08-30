// app/api/winbiz-adresses/route.ts
// Chantier « Export Winbiz » — état du fichier clients chargé.
//
// GET : la liste des exercices chargés dans winbiz_adresses (nombre de fiches,
// date du dernier import). C'est ce que lit l'écran /dashboard/winbiz-adresses
// et, plus tard, le contrôle de fraîcheur du bouton d'export.
//
// Route INTERNE : protégée par le verrou proxy.ts. Lecture seule.

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET() {
  try {
    // Pas d'agrégat PostgREST (désactivé par défaut) : on lit les deux petites
    // colonnes et on réduit ici. ~7 000 lignes × 2 champs — négligeable pour
    // un écran interne ouvert avant une séance d'import.
    const { data, error } = await supabaseAdmin
      .from("winbiz_adresses")
      .select("exercice, importe_le");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const parExercice = new Map<number, { nb: number; dernier: string }>();
    for (const row of (data ?? []) as Array<{ exercice: number; importe_le: string }>) {
      const cur = parExercice.get(row.exercice);
      if (!cur) {
        parExercice.set(row.exercice, { nb: 1, dernier: row.importe_le });
      } else {
        cur.nb++;
        if (row.importe_le > cur.dernier) cur.dernier = row.importe_le;
      }
    }

    const exercices = [...parExercice.entries()]
      .map(([exercice, v]) => ({ exercice, nb_fiches: v.nb, importe_le: v.dernier }))
      .sort((a, b) => b.exercice - a.exercice);

    return NextResponse.json({ exercices });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
