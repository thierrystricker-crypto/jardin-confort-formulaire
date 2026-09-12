// app/api/listes-achat/route.ts
// GET  /api/listes-achat?statut=ouverte|transformee|archivee|toutes  → { listes }
// POST /api/listes-achat  { nom, cree_par, lignes, notes?, est_modele? } → { liste }
//
// Listes d'achat de la page Stock list (table listes_achat, Supabase de l'app).
// Lecture/écriture via supabaseAdmin uniquement (RLS sans policy).

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { normaliserLignes, nbArticles, type ListeAchat } from "@/lib/listes-achat";
import { normaliserMembre } from "@/lib/jardi-equipe";

export const dynamic = "force-dynamic";

const COLONNES = "id, created_at, updated_at, nom, cree_par, statut, lignes, nb_articles, notes, est_modele, draft_slug, draft_numero";

export async function GET(request: NextRequest) {
  try {
    const statut = (request.nextUrl.searchParams.get("statut") || "ouverte").trim();
    let requete = supabaseAdmin.from("listes_achat").select(COLONNES);
    // « ouverte » = les listes ouvertes + TOUS les modèles non archivés : un
    // modèle reste proposé même s'il a servi (il n'est jamais consommé).
    if (statut === "ouverte") requete = requete.or("statut.eq.ouverte,and(est_modele.eq.true,statut.neq.archivee)");
    else if (statut !== "toutes") requete = requete.eq("statut", statut);
    const { data, error } = await requete
      .order("est_modele", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(300);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ listes: (data || []) as ListeAchat[] });
  } catch (err) {
    console.error("Listes d'achat GET error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const nom = String(body.nom ?? "").trim().slice(0, 120);
    const lignes = normaliserLignes(body.lignes);
    if (!nom) return NextResponse.json({ error: "Nom de liste manquant" }, { status: 400 });
    if (lignes.length === 0) return NextResponse.json({ error: "Liste vide" }, { status: 400 });

    const row = {
      nom,
      cree_par: normaliserMembre(body.cree_par) ?? (typeof body.cree_par === "string" ? body.cree_par.trim().slice(0, 40) || null : null),
      lignes,
      nb_articles: nbArticles(lignes),
      notes: typeof body.notes === "string" ? body.notes.trim().slice(0, 2000) || null : null,
      est_modele: body.est_modele === true,
    };
    const { data, error } = await supabaseAdmin.from("listes_achat").insert(row).select(COLONNES).single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ liste: data as ListeAchat });
  } catch (err) {
    console.error("Listes d'achat POST error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
