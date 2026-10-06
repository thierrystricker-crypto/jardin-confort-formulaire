// app/api/planner/couleurs/route.ts  (interne)
// GET ?product_id=123 → couleurs proposables pour une fiche à zones (Fermob) :
//   { couleurs: [{ code, nom, apercu, variant_id, sku, prix, url, peinture }] }
// Une couleur = une valeur d'option vue sur les variantes de la fiche, avec le
// fichier à charger (jeu « un fichier par couleur ») et les consignes de
// peinture prêtes pour three.js. Lecture seule (modeles_3d + palette).

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { lirePalette3d } from "@/lib/modeles-3d-lookup";
import { couleursDisponibles, fichierZones, peintureZones, type VarianteZones, type ZonesConfig } from "@/lib/modeles-3d-zones";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const id = Number(new URL(req.url).searchParams.get("product_id") || 0);
  if (!id) return NextResponse.json({ error: "product_id manquant" }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from("modeles_3d")
    .select("product_id, titre, url_glb, zones, zones_variantes")
    .eq("product_id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.zones) return NextResponse.json({ couleurs: [] });

  const zones = data.zones as ZonesConfig;
  const variantes = (data.zones_variantes || []) as VarianteZones[];
  const palette = await lirePalette3d();
  const couleurs = couleursDisponibles(zones, palette, variantes).map((c) => {
    const v = variantes.find((x) => x.variant_id === c.variant_id);
    return {
      ...c,
      url: fichierZones(zones, v?.options) || data.url_glb,
      peinture: peintureZones(zones, palette, v?.options, v?.zones),
    };
  });
  return NextResponse.json({ couleurs }, { headers: { "Cache-Control": "no-store" } });
}
