// app/api/echantillons/route.ts
//
// Banque d'échantillons (25.10.2026) — lecture de la base matières pour la page
// /dashboard/echantillons. Route INTERNE (protégée par proxy.ts comme toutes les
// API de gestion), LECTURE SEULE : l'app n'écrit jamais dans `matieres`
// (règle du chantier moodboard, lib/matieres-offre.ts).
//
//   GET → toutes les finitions actives (statut ≠ archive), ~2 500 lignes,
//         lues par paquets de 1 000 (limite PostgREST).

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const COLONNES =
  "cle, marque, famille, gamme, code, nom, nom_origine, alias, usages, " +
  "hex, hex_source, hex_fabricant, hex_mesure, teinte_filtre, teinte_source, teinte_validee_le, motif, clair, " +
  "qualite, maitre_cote, source_type, nom_source, code_source, liste_prix_annee, collection_annee, nouveau, " +
  "url_vignette, url_maitre, shop_url_vignette, shop_url_maitre, shop_file_id_maitre, shop_version, image_version, shop_publie_le, " +
  "shopify_nb_fiches, shopify_nb_variantes, shopify_valeurs, shopify_vu_le, image_maj_le, created_at, updated_at";

const PAQUET = 1000;

export async function GET() {
  try {
    const lignes: Record<string, unknown>[] = [];
    for (let debut = 0; debut < 20000; debut += PAQUET) {
      const { data, error } = await supabaseAdmin
        .from("matieres")
        .select(COLONNES)
        .neq("statut", "archive")
        .order("cle")
        .range(debut, debut + PAQUET - 1);
      if (error) throw error;
      const paquet = (data || []) as unknown as Record<string, unknown>[];
      lignes.push(...paquet);
      if (paquet.length < PAQUET) break;
    }
    return NextResponse.json({ rows: lignes, lu_le: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
