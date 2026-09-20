// lib/modeles-3d-lookup.ts  (serveur)
// Retrouver le modèle 3D d'une ligne d'offre / de brouillon / de commande.
// Clé fiable = gid de variante Shopify (shopifyVariantId) ; repli = SKU.
// Cascade identique au thème et au planner : fichier de la variante
// (variantes_3d) → défaut de la fiche (url_glb).

import { supabaseAdmin } from "@/lib/supabase";
import type { Variante3d } from "@/lib/planner-types";

export type LigneCle = { id: string; sku?: string | null; shopifyVariantId?: string | null; title?: string; qty?: number };

export type Resolution3d = {
  has_3d: boolean;
  product_id: number | null;
  titre: string | null;
  marque: string | null;
  image_url: string | null;
  url: string | null;              // GLB à charger (variante si dispo, sinon fiche)
  source: "model3d" | "url" | null;
  variant_id: string | null;       // variante réellement retenue (gid) si connue
  sku: string | null;
  prix: number | null;
  prix_exact: boolean;
  size_warn: boolean;
  color_warn: boolean;
  par: "variante" | "sku" | null;  // comment la ligne a été retrouvée
};

type Row = {
  product_id: number; titre: string; marque: string | null; image_url: string | null;
  source: "model3d" | "url" | null; url_glb: string | null; has_3d: boolean;
  size_mismatch_possible: boolean; color_mismatch_possible: boolean; has_size_option: boolean;
  prix_min: number | null; skus: string[]; variant_ids: string[]; variantes_3d: Variante3d[];
  sku_1: string | null; variant_id_1: string | null; variant_count: number;
};

const COLONNES = "product_id, titre, marque, image_url, source, url_glb, has_3d, size_mismatch_possible, color_mismatch_possible, has_size_option, prix_min, skus, variant_ids, variantes_3d, sku_1, variant_id_1, variant_count";

function vide(): Resolution3d {
  return { has_3d: false, product_id: null, titre: null, marque: null, image_url: null, url: null, source: null, variant_id: null, sku: null, prix: null, prix_exact: false, size_warn: false, color_warn: false, par: null };
}

function resoudre(row: Row, gid: string | null, sku: string | null, par: "variante" | "sku"): Resolution3d {
  const v = gid ? (row.variantes_3d || []).find((x) => x.variant_id === gid) : null;
  const url = v?.url || row.url_glb;
  return {
    has_3d: Boolean(url),
    product_id: row.product_id,
    titre: row.titre,
    marque: row.marque,
    image_url: row.image_url,
    url,
    source: v ? "url" : row.source,
    variant_id: gid,
    sku: sku || v?.sku || row.sku_1,
    prix: v?.prix ?? row.prix_min,
    prix_exact: v?.prix != null || row.variant_count <= 1,
    // la taille est garantie si la variante a son propre fichier, ou si la fiche n'a pas d'option de taille
    size_warn: Boolean(url) && !v && row.has_size_option,
    color_warn: Boolean(url) && row.color_mismatch_possible,
    par,
  };
}

export async function resoudreLignes3d(lignes: LigneCle[]): Promise<Map<string, Resolution3d>> {
  const out = new Map<string, Resolution3d>();
  const gids = [...new Set(lignes.map((l) => (l.shopifyVariantId || "").trim()).filter(Boolean))];
  const skus = [...new Set(lignes.map((l) => (l.sku || "").trim()).filter(Boolean))];
  const parGid = new Map<string, Row>();
  const parSku = new Map<string, Row[]>();

  if (gids.length) {
    const { data } = await supabaseAdmin.from("modeles_3d").select(COLONNES).overlaps("variant_ids", gids);
    for (const r of (data || []) as Row[]) for (const g of r.variant_ids || []) if (gids.includes(g)) parGid.set(g, r);
  }
  const skusRestants = skus.filter((s) => !lignes.some((l) => l.sku === s && l.shopifyVariantId && parGid.has(l.shopifyVariantId)));
  if (skusRestants.length) {
    const { data } = await supabaseAdmin.from("modeles_3d").select(COLONNES).overlaps("skus", skusRestants);
    for (const r of (data || []) as Row[]) for (const s of r.skus || []) if (skusRestants.includes(s)) parSku.set(s, [...(parSku.get(s) || []), r]);
  }

  for (const l of lignes) {
    const gid = (l.shopifyVariantId || "").trim() || null;
    const sku = (l.sku || "").trim() || null;
    const rg = gid ? parGid.get(gid) : undefined;
    if (rg) { out.set(l.id, resoudre(rg, gid, sku, "variante")); continue; }
    const rs = sku ? parSku.get(sku) : undefined;
    if (rs && rs.length === 1) { out.set(l.id, resoudre(rs[0], null, sku, "sku")); continue; }
    if (rs && rs.length > 1) {
      // SKU partagé entre marques : on prend une fiche avec 3D si une seule l'a
      const avec = rs.filter((r) => r.has_3d);
      if (avec.length === 1) { out.set(l.id, resoudre(avec[0], null, sku, "sku")); continue; }
    }
    out.set(l.id, vide());
  }
  return out;
}
