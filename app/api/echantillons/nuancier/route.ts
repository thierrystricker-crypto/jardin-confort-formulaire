// app/api/echantillons/nuancier/route.ts
//
// Nuancier des fiches (26.10.2026) — état du bloc « Nuancier des coloris » de
// chaque article actif, pour les marques déjà activées (dictionnaire boutique
// nuancier.<marque>). Calcul côté Supabase : fonction matieres_nuancier_statut().
// Route INTERNE (protégée par proxy.ts), LECTURE SEULE.
//
//   GET → { rows: [{ product_id, handle, titre, marque, statut, image_url,
//                    categorie: complet | partiel | masque | aucune,
//                    groupes: [{ o, n, ok, a, m: [{ v, r }] }] }], lu_le }

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin.rpc("matieres_nuancier_statut");
    if (error) throw error;
    return NextResponse.json({ rows: data || [], lu_le: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
