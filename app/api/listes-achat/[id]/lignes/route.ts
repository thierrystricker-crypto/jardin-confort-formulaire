// app/api/listes-achat/[id]/lignes/route.ts
// GET → { lines: QuoteLine[], nbProduits, nbCustom, nom }
//
// Lignes d'une liste d'achat au format du formulaire, prix Shopify relus à
// l'instant. Sert à l'onglet « Liste d'achat » du formulaire de brouillon :
// on AJOUTE ces lignes à la suite de celles déjà saisies, sans toucher au
// client ni au reste du document. La liste n'est pas marquée transformée ici
// (on peut l'appeler plusieurs fois, sur plusieurs offres).

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import type { ListeAchat } from "@/lib/listes-achat";
import { construireLignesBrouillon } from "@/lib/listes-achat-lignes";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!UUID.test(id)) return NextResponse.json({ error: "Id invalide" }, { status: 400 });
    const { data, error } = await supabaseAdmin.from("listes_achat").select("*").eq("id", id).maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Liste introuvable" }, { status: 404 });
    const l = data as ListeAchat;
    const { lines, nbProduits, nbCustom } = await construireLignesBrouillon(l.lignes || []);
    return NextResponse.json({ lines, nbProduits, nbCustom, nom: l.nom });
  } catch (err) {
    console.error("Liste d'achat → lignes error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
