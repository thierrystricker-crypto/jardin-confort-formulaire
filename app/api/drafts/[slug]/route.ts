// app/api/drafts/[slug]/route.ts
// GET    — récupérer un brouillon complet (avec data JSONB)
// PUT    — mettre à jour un brouillon (étape E, à venir)
// DELETE — supprimer un brouillon (étape F, à venir)

import { NextRequest, NextResponse } from "next/server";
import { computeTotals } from "@/lib/jc-print-types";
import { supabaseAdmin } from "@/lib/supabase";

// ─────────────────────────────────────────────────────────────
// GET /api/drafts/[slug] — récupérer un brouillon complet
// ─────────────────────────────────────────────────────────────
// Renvoie : { draft: { id, slug, ... toutes colonnes, data } }
// 404 si slug introuvable.

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;

    const { data, error } = await supabaseAdmin
      .from("drafts")
      .select("*")
      .eq("slug", slug)
      .maybeSingle();

    if (error) {
      console.error("Get draft error:", error);
      return NextResponse.json(
        { error: "Erreur base de données : " + error.message },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json(
        { error: "Brouillon introuvable" },
        { status: 404 }
      );
    }

    return NextResponse.json({ draft: data });
  } catch (err) {
    console.error("Get draft error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
// ─────────────────────────────────────────────────────────────
// PUT /api/drafts/[slug] — mettre à jour un brouillon
// ─────────────────────────────────────────────────────────────
// Body attendu : { data: { ...formData } }
// Renvoie : { success, draft }
// 404 si slug introuvable.
// 409 si brouillon déjà transformé en offre (modification interdite).
//
// Colonnes immuables (ignorées même si envoyées dans le body) :
//   id, slug, numero_draft, numero_affiche, type_document,
//   created_at, updated_at, transformed_at, transformed_into_offre_slug, archived
//
// La colonne updated_at est gérée automatiquement par le trigger SQL
// drafts_updated_at_trigger.

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const body = await request.json().catch(() => ({}));
    const data = body.data || {};

    // ─── Vérifier que le brouillon existe et n'est pas transformé ───
    const { data: existing, error: fetchError } = await supabaseAdmin
      .from("drafts")
      .select("id, transformed_at")
      .eq("slug", slug)
      .maybeSingle();

    if (fetchError) {
      console.error("PUT draft fetch error:", fetchError);
      return NextResponse.json(
        { error: "Erreur base de données : " + fetchError.message },
        { status: 500 }
      );
    }

    if (!existing) {
      return NextResponse.json(
        { error: "Brouillon introuvable" },
        { status: 404 }
      );
    }

    if (existing.transformed_at) {
      return NextResponse.json(
        {
          error: "Ce brouillon a déjà été transformé en offre. Modification impossible. " +
                 "Pour repartir d'une base, copiez le brouillon pour en créer un nouveau."
        },
        { status: 409 }
      );
    }

    // ─── Calcul des totaux (même logique que POST) ───
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

    // ─── Construction de la ligne d'update ───
    // Note : on N'INCLUT PAS slug, numero_draft, numero_affiche, type_document,
    // created_at, updated_at, transformed_at, transformed_into_offre_slug, archived.
    // Ces colonnes sont immuables (numéro) ou gérées ailleurs (cycle de vie).
    const update = {
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

      // Totaux recalculés
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

      // Données complètes — on réinjecte le offerNumber pour cohérence avec POST
      data: { ...data, offerNumber: slug.toUpperCase().split("-").slice(0, 2).join("-") },
    };

    // ⚠️ La construction de offerNumber ci-dessus est un fallback : si data n'a pas
    // offerNumber, on le reconstruit depuis le slug (dra-001-x7k2m → DRA-001).
    // Mais idéalement le client renvoie data.offerNumber. On préserve ce qu'il envoie
    // si présent.
    if (data.offerNumber) {
      update.data.offerNumber = data.offerNumber;
    }

    // ─── Update ───
    const { data: result, error } = await supabaseAdmin
      .from("drafts")
      .update(update)
      .eq("slug", slug)
      .select("*")
      .single();

    if (error) {
      console.error("Update draft error:", error);
      return NextResponse.json(
        { error: "Erreur base de données : " + error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      draft: result,
    });
  } catch (err) {
    console.error("Update draft error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}