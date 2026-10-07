// app/api/planner/couleurs/route.ts  (interne)
// GET ?product_id=123 → couleurs proposables pour une fiche à zones (Fermob) :
//   { axes: [{ option, zone, valeurs: [{code, nom, apercu}] }],
//     variantes: [{ variant_id, sku, prix, codes, url, peinture }] }
// Un AXE = une option de couleur de la fiche. Les canapés Bellevie et Rivage
// en ont deux (structure + tissu / coussin) : le planner affiche un menu par
// axe et retrouve la variante par la combinaison (07.10.2026).
// `couleurs` reste renvoyé pour l'ancien format (axe principal seul).
// Lecture seule (modeles_3d + palette).

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { lirePalette3d } from "@/lib/modeles-3d-lookup";
import { axesCouleurs, codeCouleur, couleursDisponibles, fichierZones, peintureZones, type VarianteZones, type ZonesConfig } from "@/lib/modeles-3d-zones";

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
  if (!data?.zones) return NextResponse.json({ axes: [], variantes: [], couleurs: [] });

  const zones = data.zones as ZonesConfig;
  const variantes = (data.zones_variantes || []) as VarianteZones[];
  const palette = await lirePalette3d();
  const axes = axesCouleurs(zones, palette, variantes);

  // Toutes les variantes, avec leur combinaison de codes, leur fichier et leurs
  // consignes de peinture : le planner compose les menus et retrouve la bonne
  // ligne sans nouvel aller-retour (125 variantes au plus, Bellevie Fauteuil).
  const lignes = variantes.map((v) => {
    const codes: Record<string, string> = {};
    for (const a of axes) {
      const brut = Object.entries(v.options || {}).find(([k]) => k.trim().toLowerCase() === a.option.trim().toLowerCase());
      const c = codeCouleur(brut?.[1]);
      if (c) codes[a.option] = c;
    }
    return {
      variant_id: v.variant_id,
      sku: v.sku,
      prix: v.prix,
      codes,
      url: fichierZones(zones, v.options) || data.url_glb,
      peinture: peintureZones(zones, palette, v.options, v.zones),
    };
  });

  // Ancien format : un seul axe, pour ne rien casser si un appelant traîne.
  const couleurs = couleursDisponibles(zones, palette, variantes).map((c) => {
    const v = variantes.find((x) => x.variant_id === c.variant_id);
    return {
      ...c,
      url: fichierZones(zones, v?.options) || data.url_glb,
      peinture: peintureZones(zones, palette, v?.options, v?.zones),
    };
  });

  return NextResponse.json({ axes, variantes: lignes, couleurs }, { headers: { "Cache-Control": "no-store" } });
}
