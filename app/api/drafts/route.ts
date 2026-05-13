// app/api/drafts/route.ts
// POST — créer un brouillon (vide ou pré-rempli depuis copie d'offre)
// GET  — lister les brouillons (filtre archived=false par défaut)
//
// Pas de notification, pas de PDF, pas de fiche de travail, pas de stock.
// Un brouillon est inerte tant qu'il n'est pas transformé en offre.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { computeTotals } from "@/lib/jc-print-types";

function makeSlug(numero: string, withToken = false): string {
  const base = numero.toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (!withToken) return base;
  const token = Math.random().toString(36).slice(2, 7); // ex: "x7k2m"
  return `${base}-${token}`;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const data = body.data || {};

    // ─── Génération du numéro DRA-XXX via RPC ───
    const { data: draNum, error: rpcError } = await supabaseAdmin.rpc("next_dra_numero");
    if (rpcError) {
      console.error("RPC next_dra_numero error:", rpcError);
      return NextResponse.json(
        { error: "Erreur génération numéro brouillon : " + rpcError.message },
        { status: 500 }
      );
    }
    const numeroAffiche = draNum as string;          // "DRA-001"
    const numeroDraft = parseInt(numeroAffiche.replace("DRA-", ""), 10); // 1
    const slug = makeSlug(numeroAffiche, true);      // "dra-001-x7k2m"

    // ─── Calcul des totaux ───
    // Si le brouillon a au moins une ligne, on calcule normalement via computeTotals.
    // Sinon (brouillon vide créé depuis "Nouveau"), tous les totaux sont à 0.
    // computeTotals attend une structure data complète (lines, services, enabledServices,
    // servicePrices, etc.) qui n'existe pas sur un brouillon vierge.
    const hasLines = Array.isArray(data.lines) && data.lines.length > 0;
    const totals = hasLines
      ? computeTotals(data)
      : {
          subTotal: 0,
          discountValue: 0,
          serviceTotal: 0,
          roundingValue: 0,
          tvaAmount: 0,
          finalTotal: 0,
        };
    const nbArticles = hasLines
      ? data.lines.filter((l: { type: string }) => l.type !== "comment").length
      : 0;

    // ─── Construction de la ligne à insérer ───
    const row = {
      slug,
      numero_draft: numeroDraft,
      numero_affiche: numeroAffiche,
      // type_document hérite du DEFAULT 'Brouillon'
      reference: data.reference || null,
      date_document: data.date || null,
      commercial: data.commercial || null,
      client_type: data.clientType || null,
      payment_mode: data.paymentMode || null,
      delivery_mode: (data as Record<string, unknown>).deliveryMode as string || null,
      lead_time: data.leadTime || null,
      validite_duree: data.validiteDuree || "30 jours",

      // Client
      client_societe: data.societe || null,
      client_nom: data.nom || null,
      client_prenom: data.prenom || null,
      client_complement_nom: data.complement_nom || null,
      client_email: data.email || null,
      client_tel1: data.telephone1 || null,
      client_tel2: data.telephone2 || null,
      client_rue: data.rue || null,
      client_numero: data.numero || null,
      client_npa: data.npa || null,
      client_ville: data.ville || null,
      client_numero_client: data.numeroClient || null,

      // Livraison
      livr_diff: data.livrDiff || false,
      livr_societe: data.livrSociete || null,
      livr_nom: data.livrNom || null,
      livr_prenom: data.livrPrenom || null,
      livr_complement_nom: data.livr_complement_nom || null,
      livr_tel: data.livrTel || null,
      livr_rue: data.livrRue || null,
      livr_numero: data.livrNumero || null,
      livr_npa: data.livrNpa || null,
      livr_ville: data.livrVille || null,

      // Totaux
      sous_total: Math.round(totals.subTotal * 100) / 100,
      remise_chf: Math.round(totals.discountValue * 100) / 100,
      services_total: Math.round(totals.serviceTotal * 100) / 100,
      arrondi: Math.round(totals.roundingValue * 100) / 100,
      tva_montant: Math.round(totals.tvaAmount * 100) / 100,
      total_ttc: Math.round(totals.finalTotal * 100) / 100,
      nb_articles: nbArticles,

      // Notes
      remarques: data.remarks || null,
      notes_internes: data.notesInternes || null,
      note_commerciale: data.noteCommerciale || null,

      // Données complètes (lignes, services, ambianceImages, etc.)
      // On injecte offerNumber dans data pour cohérence avec offres
      data: { ...data, offerNumber: numeroAffiche },
    };

    // ─── Insertion ───
    const { data: result, error } = await supabaseAdmin
      .from("drafts")
      .insert(row)
      .select("id, slug, numero_affiche, created_at, updated_at")
      .single();

    if (error) {
      console.error("Supabase insert draft error:", error);
      return NextResponse.json(
        { error: "Erreur base de données : " + error.message },
        { status: 500 }
      );
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://jardin-confort-formulaire.vercel.app";

    return NextResponse.json({
      success: true,
      id: result.id,
      slug: result.slug,
      numeroAffiche: result.numero_affiche,
      dashboardUrl: `${baseUrl}/dashboard/draft/${result.slug}`,
      editUrl: `${baseUrl}/drafts/${result.slug}/editer`,
    });

  } catch (err) {
    console.error("Create draft error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
// ─────────────────────────────────────────────────────────────
// GET /api/drafts — lister les brouillons
// ─────────────────────────────────────────────────────────────
// Query params :
//   - archived : "false" (défaut) | "true" | "all"
//   - commercial : filtre exact sur le champ commercial
//   - limit : nombre max de résultats (défaut 100, max 500)
//
// Renvoie : { drafts: [...], count }
// La colonne `data` (JSONB potentiellement lourd) n'est pas renvoyée ici.
// Pour le détail complet d'un brouillon, utiliser GET /api/drafts/[slug].

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const archivedParam = searchParams.get("archived") || "false";
    const commercial = searchParams.get("commercial");
    const limitParam = parseInt(searchParams.get("limit") || "100", 10);
    const limit = Math.min(Math.max(limitParam, 1), 500); // 1..500

    let query = supabaseAdmin
      .from("drafts")
      .select(
        "id, slug, numero_draft, numero_affiche, reference, " +
        "client_societe, client_nom, client_prenom, client_email, " +
        "commercial, total_ttc, nb_articles, " +
        "created_at, updated_at, " +
        "transformed_at, transformed_into_offre_slug, archived"
      )
      .order("updated_at", { ascending: false })
      .limit(limit);

    // Filtre archived
    if (archivedParam === "false") {
      query = query.eq("archived", false);
    } else if (archivedParam === "true") {
      query = query.eq("archived", true);
    }
    // "all" → pas de filtre

    // Filtre commercial
    if (commercial) {
      query = query.eq("commercial", commercial);
    }

    const { data, error } = await query;

    if (error) {
      console.error("List drafts error:", error);
      return NextResponse.json(
        { error: "Erreur base de données : " + error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      drafts: data || [],
      count: data?.length || 0,
    });
  } catch (err) {
    console.error("List drafts error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}