// app/api/modeles-3d/stats/route.ts
//
// Lecture de l'index 3D pour le dashboard (route interne, lecture seule).
//
//   GET                       → synthèse par marque (vue v_modeles_3d_marques) + totaux
//   GET ?anomalies=1[&marque=] → produits avec modèle ET anomalies (200 max)
//   GET ?q=texte[&marque=]     → recherche titre / handle / fichier (100 max)
//   GET ?collection=X&marque=Y → tous les produits d'une collection (base du
//                                futur picker du planner), 3D en premier

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Handle admin : SHOPIFY_STORE_DOMAIN = xxx.myshopify.com → https://admin.shopify.com/store/xxx
function adminBase(): string | null {
  const handle = (process.env.SHOPIFY_STORE_DOMAIN || "").replace(/\.myshopify\.com$/i, "").trim();
  return handle ? `https://admin.shopify.com/store/${handle}` : null;
}

const COLONNES =
  "product_id, handle, titre, marque, statut, publie, collection, categories, image_url, prix_min, " +
  "variant_count, variant_mode, option_names, has_size_option, has_color_option, source, url_glb, url_usdz, " +
  "nom_fichier, taille_octets, fichier_partage_n, tag_no3dfile, has_3d, size_mismatch_possible, color_mismatch_possible, " +
  "anomalies, options_changed_at, model_attached_at, synced_at";

export async function GET(request: NextRequest) {
  const sp = new URL(request.url).searchParams;
  const marque = (sp.get("marque") || "").trim();
  const q = (sp.get("q") || "").trim();
  const collection = (sp.get("collection") || "").trim();
  const anomalies = sp.get("anomalies") === "1";

  try {
    if (collection) {
      let req = supabaseAdmin.from("modeles_3d").select(COLONNES).eq("collection", collection).order("has_3d", { ascending: false }).order("titre").limit(300);
      if (marque) req = req.eq("marque", marque);
      const { data, error } = await req;
      if (error) throw error;
      return NextResponse.json({ rows: data || [] });
    }

    if (q.length >= 2) {
      const motif = `%${q.replace(/[%_]/g, "")}%`;
      let req = supabaseAdmin
        .from("modeles_3d")
        .select(COLONNES)
        .or(`titre.ilike.${motif},handle.ilike.${motif},nom_fichier.ilike.${motif},collection.ilike.${motif},skus_txt.ilike.${motif}`)
        .order("has_3d", { ascending: false })
        .order("titre")
        .limit(100);
      if (marque) req = req.eq("marque", marque);
      const { data, error } = await req;
      if (error) throw error;
      return NextResponse.json({ rows: data || [] });
    }

    if (anomalies) {
      let req = supabaseAdmin
        .from("modeles_3d")
        .select(COLONNES)
        .eq("has_3d", true)
        .gt("anomalies", "{}")
        .order("marque")
        .order("titre")
        .limit(200);
      if (marque) req = req.eq("marque", marque);
      const { data, error } = await req;
      if (error) throw error;
      return NextResponse.json({ rows: data || [] });
    }

    const [{ data: marques, error: e1 }, { count: total, error: e2 }, { count: avec3d, error: e3 }] = await Promise.all([
      supabaseAdmin.from("v_modeles_3d_marques").select("*"),
      supabaseAdmin.from("modeles_3d").select("product_id", { count: "exact", head: true }),
      supabaseAdmin.from("modeles_3d").select("product_id", { count: "exact", head: true }).eq("has_3d", true),
    ]);
    if (e1) throw e1;
    if (e2) throw e2;
    if (e3) throw e3;

    return NextResponse.json({ total: total || 0, avec_3d: avec3d || 0, marques: marques || [], admin_base: adminBase() });
  } catch (err) {
    console.error("[modeles-3d/stats] Échec :", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
