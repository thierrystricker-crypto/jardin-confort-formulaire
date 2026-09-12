// app/api/listes-achat/[id]/route.ts
// GET    → { liste }
// PATCH  { nom?, lignes?, notes?, est_modele?, statut? } → { liste }
// DELETE → archive (statut 'archivee'), jamais de suppression physique

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { normaliserLignes, nbArticles, type ListeAchat } from "@/lib/listes-achat";

export const dynamic = "force-dynamic";

const COLONNES = "id, created_at, updated_at, nom, cree_par, statut, lignes, nb_articles, notes, est_modele, draft_slug, draft_numero";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Id invalide" }, { status: 400 });
  const { data, error } = await supabaseAdmin.from("listes_achat").select(COLONNES).eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Liste introuvable" }, { status: 404 });
  return NextResponse.json({ liste: data as ListeAchat });
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    if (!UUID.test(id)) return NextResponse.json({ error: "Id invalide" }, { status: 400 });
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const maj: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (typeof body.nom === "string") {
      const nom = body.nom.trim().slice(0, 120);
      if (!nom) return NextResponse.json({ error: "Nom de liste manquant" }, { status: 400 });
      maj.nom = nom;
    }
    if (body.lignes !== undefined) {
      const lignes = normaliserLignes(body.lignes);
      if (lignes.length === 0) return NextResponse.json({ error: "Liste vide" }, { status: 400 });
      maj.lignes = lignes;
      maj.nb_articles = nbArticles(lignes);
    }
    if (body.notes !== undefined) maj.notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 2000) || null : null;
    if (typeof body.est_modele === "boolean") {
      maj.est_modele = body.est_modele;
      // Devenir modèle rouvre la liste : un modèle n'est jamais « transformé »
      if (body.est_modele) maj.statut = "ouverte";
    }
    if (body.statut === "ouverte" || body.statut === "archivee") maj.statut = body.statut; // 'transformee' passe par /brouillon

    const { data, error } = await supabaseAdmin.from("listes_achat").update(maj).eq("id", id).select(COLONNES).single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ liste: data as ListeAchat });
  } catch (err) {
    console.error("Listes d'achat PATCH error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Id invalide" }, { status: 400 });
  const { error } = await supabaseAdmin
    .from("listes_achat")
    .update({ statut: "archivee", updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
