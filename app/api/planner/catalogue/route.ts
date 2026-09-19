// app/api/planner/catalogue/route.ts
//
// Catalogue du planner (route interne, lecture seule sur modeles_3d).
//
//   GET                                → { marques: [{ marque, avec_3d }] }
//   GET ?marque=X                      → { collections: [{ collection, avec_3d, total }] }
//   GET ?marque=X&collection=Y         → { rows } tous les articles de la collection
//                                        (actifs), 3D en premier, sans 3D grisés côté page
//   GET ?q=texte[&marque=X]            → { rows } recherche (actifs avec 3D en premier)
//
// Périmètre : fiches ACTIVE seulement (le planner interne peut poser un
// article non publié en ligne, mais pas un brouillon ni une archive).

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const COLONNES =
  "product_id, handle, titre, marque, collection, categories, image_url, prix_min, source, url_glb, has_3d, " +
  "size_mismatch_possible, color_mismatch_possible, option_names, bbox_x, bbox_y, bbox_z";

export async function GET(request: NextRequest) {
  const sp = new URL(request.url).searchParams;
  const marque = (sp.get("marque") || "").trim();
  const collection = (sp.get("collection") || "").trim();
  const q = (sp.get("q") || "").trim();

  try {
    if (q.length >= 2) {
      const motif = `%${q.replace(/[%_]/g, "")}%`;
      let req = supabaseAdmin
        .from("modeles_3d")
        .select(COLONNES)
        .eq("statut", "ACTIVE")
        .or(`titre.ilike.${motif},handle.ilike.${motif},collection.ilike.${motif}`)
        .order("has_3d", { ascending: false })
        .order("titre")
        .limit(120);
      if (marque) req = req.eq("marque", marque);
      const { data, error } = await req;
      if (error) throw error;
      return NextResponse.json({ rows: data || [] });
    }

    if (marque && collection) {
      const { data, error } = await supabaseAdmin
        .from("modeles_3d")
        .select(COLONNES)
        .eq("statut", "ACTIVE")
        .eq("marque", marque)
        .eq("collection", collection)
        .order("has_3d", { ascending: false })
        .order("titre")
        .limit(300);
      if (error) throw error;
      return NextResponse.json({ rows: data || [] });
    }

    if (marque) {
      // Collections de la marque avec compteurs (agrégé côté serveur : la table
      // d'une marque fait au plus quelques centaines de lignes).
      const { data, error } = await supabaseAdmin
        .from("modeles_3d")
        .select("collection, has_3d")
        .eq("statut", "ACTIVE")
        .eq("marque", marque)
        .limit(5000);
      if (error) throw error;
      const agg = new Map<string, { collection: string; avec_3d: number; total: number }>();
      for (const r of (data || []) as { collection: string | null; has_3d: boolean }[]) {
        const c = r.collection || "(sans collection)";
        const e = agg.get(c) || { collection: c, avec_3d: 0, total: 0 };
        e.total++;
        if (r.has_3d) e.avec_3d++;
        agg.set(c, e);
      }
      const collections = [...agg.values()].sort((a, b) => b.avec_3d - a.avec_3d || a.collection.localeCompare(b.collection, "fr"));
      return NextResponse.json({ collections });
    }

    // Marques ayant au moins un modèle 3D actif
    const { data, error } = await supabaseAdmin.from("v_modeles_3d_marques").select("marque, actifs_avec_3d, avec_3d").gt("avec_3d", 0);
    if (error) throw error;
    const marques = ((data || []) as { marque: string; actifs_avec_3d: number; avec_3d: number }[])
      .filter((m) => m.actifs_avec_3d > 0)
      .map((m) => ({ marque: m.marque, avec_3d: m.actifs_avec_3d }))
      .sort((a, b) => a.marque.localeCompare(b.marque, "fr"));
    return NextResponse.json({ marques });
  } catch (err) {
    console.error("[planner/catalogue] Échec :", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
