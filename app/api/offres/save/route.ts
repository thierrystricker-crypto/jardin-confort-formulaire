// app/api/offres/save/route.ts
// Sauvegarde ou met à jour une offre dans Supabase
// POST /api/offres/save

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { computeTotals, serviceOptions } from "@/lib/jc-print-types";

// Génère un slug URL depuis le numéro d'offre
// "OFFRE 2504-12345-V1" → "offre-2504-12345-v1"
function makeSlug(numero: string): string {
  return numero
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { data } = body; // data = PrintData complet du formulaire

    if (!data || !data.offerNumber) {
      return NextResponse.json(
        { error: "Données manquantes (offerNumber requis)" },
        { status: 400 }
      );
    }

    // Générer le slug
    const slug = makeSlug(data.offerNumber);

    // Calculer les totaux pour dénormalisation
    const totals = computeTotals(data);
    const nbArticles = (data.lines || []).filter(
      (l: { type: string }) => l.type !== "comment"
    ).length;

    // Préparer la ligne à insérer/mettre à jour
    const row = {
      slug,
      type_document: data.formType || "Offre",
      numero: data.offerNumber,
      reference: data.reference || null,
      statut: data.offerStatus || "En cours",
      date_document: data.date || null,
      commercial: data.commercial || null,
      client_societe: data.societe || null,
      client_nom: data.nom || null,
      client_prenom: data.prenom || null,
      client_email: data.email || null,
      client_tel1: data.telephone1 || null,
      client_npa: data.npa || null,
      client_ville: data.ville || null,
      total_ttc: Math.round(totals.finalTotal * 100) / 100,
      nb_articles: nbArticles,
      data: data, // JSON complet
    };

    // Upsert : crée ou met à jour selon le slug
    const { data: result, error } = await supabaseAdmin
      .from("offres")
      .upsert(row, { onConflict: "slug" })
      .select("id, slug, created_at, updated_at")
      .single();

    if (error) {
      console.error("Supabase error:", error);
      return NextResponse.json(
        { error: "Erreur base de données : " + error.message },
        { status: 500 }
      );
    }

    // URL publique de l'offre
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://jardin-confort-formulaire.vercel.app";
    const publicUrl = `${baseUrl}/offre/${slug}`;
    const printUrl  = `${baseUrl}/print/offre/${slug}`;

    return NextResponse.json({
      success: true,
      id: result.id,
      slug,
      publicUrl,
      printUrl,
      isNew: result.created_at === result.updated_at,
    });

  } catch (err) {
    console.error("Save offre error:", err);
    return NextResponse.json(
      { error: "Erreur serveur" },
      { status: 500 }
    );
  }
}