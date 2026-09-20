// app/api/planner/faisabilite/route.ts  (interne)
// GET ?type=offre|brouillon&slug=… → faisabilité 3D d'une offre / commande /
// brouillon : pour chaque ligne produit, le modèle 3D retrouvé (ou non), et
// la synthèse « n / total ». Lecture seule : ne touche ni aux offres ni aux
// brouillons. Recalculé à chaque appel → suit les révisions V1, V2, V3.
// Sert à la card « faisabilité 3D » et au pré-remplissage du planner.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resoudreLignes3d, type Resolution3d } from "@/lib/modeles-3d-lookup";

export const dynamic = "force-dynamic";

type LigneBrute = { id?: string; type?: string; sku?: string; title?: string; qty?: number; shopifyVariantId?: string; image?: string };

export type LigneFaisabilite = Resolution3d & { id: string; title: string; sku_ligne: string; qty: number; image: string | null };

export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  const type = sp.get("type") === "brouillon" ? "brouillon" : "offre";
  const slug = (sp.get("slug") || "").trim();
  if (!slug) return NextResponse.json({ error: "slug manquant" }, { status: 400 });

  const table = type === "brouillon" ? "drafts" : "offres";
  const { data, error } = await supabaseAdmin
    .from(table)
    .select(type === "brouillon" ? "slug, numero_affiche, data, client_nom, client_prenom" : "slug, numero_affiche, type_document, commercial, data, client_nom, client_prenom")
    .eq("slug", slug)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Document introuvable" }, { status: 404 });

  const d = (data.data || {}) as { lines?: LigneBrute[]; nom?: string; prenom?: string };
  const brutes = (d.lines || []).filter((l) => (l.type || "product") === "product" && (l.sku || l.shopifyVariantId));
  const cles = brutes.map((l, i) => ({ id: l.id || `l${i}`, sku: l.sku, shopifyVariantId: l.shopifyVariantId, title: l.title, qty: l.qty }));
  const res = await resoudreLignes3d(cles);
  const lignes: LigneFaisabilite[] = brutes.map((l, i) => {
    const id = l.id || `l${i}`;
    const r = res.get(id)!;
    return { ...r, id, title: l.title || r.titre || "", sku_ligne: l.sku || "", qty: Math.max(1, Number(l.qty) || 1), image: l.image || r.image_url || null };
  });
  const avec = lignes.filter((l) => l.has_3d);
  const rec = data as Record<string, unknown>;
  const client = [rec.client_prenom, rec.client_nom].filter(Boolean).join(" ") || [d.prenom, d.nom].filter(Boolean).join(" ");
  return NextResponse.json({
    type,
    slug,
    numero: (rec.numero_affiche as string) || null,
    type_document: (rec.type_document as string) || (type === "brouillon" ? "Brouillon" : "Offre"),
    client: client || null,
    total: lignes.length,
    avec_3d: avec.length,
    lignes,
  }, { headers: { "Cache-Control": "no-store" } });
}
