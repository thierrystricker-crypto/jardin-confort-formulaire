// app/api/brand-logos/route.ts
// GET ?q=cane → cherche les logos correspondants (fuzzy)
// GET (sans q) → retourne tous les logos (pour menu déroulant complet)

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { normalizeSearchTerm } from "@/lib/media-line-types";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();

  // Pas de query → renvoie tous les logos triés par nom
  if (!q) {
    const { data, error } = await supabase
      .from("brand_logos")
      .select("*")
      .order("name", { ascending: true });

    if (error) {
      console.error("[brand-logos] list error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ logos: data ?? [] });
  }

  // Recherche fuzzy : on récupère tout puis on filtre côté serveur
  // (la table reste petite — < 200 marques typiquement)
  const { data: all, error } = await supabase
    .from("brand_logos")
    .select("*")
    .order("name", { ascending: true });

  if (error) {
    console.error("[brand-logos] search error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const needle = normalizeSearchTerm(q);

  const matches = (all ?? []).filter((logo) => {
    // Match sur name, slug, et chaque search_term — tous normalisés
    const haystacks = [
      normalizeSearchTerm(logo.name),
      normalizeSearchTerm(logo.slug),
      ...((logo.search_terms ?? []) as string[]).map(normalizeSearchTerm),
    ];
    return haystacks.some((h) => h.includes(needle));
  });

  return NextResponse.json({ logos: matches });
}