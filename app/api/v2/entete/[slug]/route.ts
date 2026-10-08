// app/api/v2/entete/[slug]/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// Dashboard 2.0 — en-tête d'une fiche (nom du client + numéro en grand).
// LECTURE SEULE, une ligne de la vue offres_dashboard (≈ 10 ms) : pas de
// relecture Shopify, pas d'écriture. Protégée par proxy.ts comme toute /api.
// Fait partie du plan B : supprimable avec app/v2.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const COLONNES = [
  "slug", "type_document", "numero_affiche", "numero_commande", "offre_origine",
  "statut", "date_document", "reference", "commercial",
  "client_societe", "client_nom", "client_prenom", "client_ville",
  "total_ttc", "statut_livraison", "date_livraison",
].join(",");

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  if (!/^[a-z0-9-]{3,100}$/i.test(slug)) {
    return NextResponse.json({ error: "Identifiant invalide" }, { status: 400 });
  }
  const { data, error } = await supabaseAdmin
    .from("offres_dashboard")
    .select(COLONNES)
    .eq("slug", slug)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("v2 entete:", error);
    return NextResponse.json({ error: "Lecture impossible" }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Document introuvable" }, { status: 404 });
  return NextResponse.json({ entete: data });
}
