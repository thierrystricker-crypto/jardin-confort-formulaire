// app/api/drafts/[slug]/route.ts
// GET    — récupérer un brouillon complet (avec data JSONB)
// PUT    — mettre à jour un brouillon (étape E, à venir)
// DELETE — supprimer un brouillon (étape F, à venir)

import { NextRequest, NextResponse } from "next/server";
import { computeTotals } from "@/lib/jc-print-types";
import { supabaseAdmin } from "@/lib/supabase";
import { refreshStock } from "@/lib/shopify-refresh-stock";

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

    // Stock dynamique : un brouillon est toujours "en cours" (jamais figé).
    // On rafraîchit le stock Shopify live à chaque lecture pour ne pas afficher
    // le stock gelé au moment de la copie depuis une offre/commande source.
    const draftData = data.data as { lines?: Array<{ type: string; sku?: string; stock?: unknown; shopifyVariantId?: string }> } | null;
    if (draftData && Array.isArray(draftData.lines) && draftData.lines.length > 0) {
      const freshLines = await refreshStock(draftData.lines);
      data.data = { ...draftData, lines: freshLines };
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
      .select("id, transformed_at, data")
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

    // ─── Préserver les clés de traçabilité Session 8 ───
    // Le formulaire ne mappe pas ces clés sur des inputs (elles n'ont pas
    // de champ React state correspondant), donc elles disparaissent à la
    // sérialisation côté client. On les re-merge depuis la base si elles
    // existaient pour préserver la provenance du brouillon.
    const tracingKeys = [
      "copiedFromOffreSlug",
      "copiedFromOffreNumero",
      "copiedFromDraftSlug",
      "copiedFromDraftNumero",
    ];
    const existingData = (existing.data as Record<string, unknown>) || {};
    for (const key of tracingKeys) {
      if (existingData[key] !== undefined && data[key] === undefined) {
        data[key] = existingData[key];
      }
    }

    // ─── Calcul des totaux (même logique que POST) ───
    // TOUJOURS calculer via computeTotals, même sans ligne d'article : un
    // document « services uniquement » a un total réel alors que lines est
    // vide (fix CMD-80923). Champs normalisés pour un brouillon incomplet.
    const safeLines = Array.isArray(data.lines) ? data.lines : [];
    const totals = computeTotals({
      ...data,
      lines: safeLines,
      enabledServices: data.enabledServices || {},
      servicePrices: data.servicePrices || {},
      clientType: data.clientType || "Privé (prix TTC)",
      discount: data.discount || "0",
      discountPercent: data.discountPercent || "0",
      manualRounding: data.manualRounding || "",
    });
    const nbArticles = safeLines.filter(
      (l: { type: string }) => l.type !== "comment"
    ).length;

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
      client_email: data.email?.trim().toLowerCase() || null,
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
// ─────────────────────────────────────────────────────────────
// DELETE /api/drafts/[slug] — supprimer un brouillon
// ─────────────────────────────────────────────────────────────
// Hard delete : la ligne disparaît physiquement de la base.
// 404 si slug introuvable.
// 409 si brouillon déjà transformé en offre (suppression interdite).
//
// Note : les brouillons transformés sont archivés (archived=true) puis
// purgés automatiquement après 30 jours via un mécanisme séparé
// (cf. Session 5/9). On ne les supprime jamais manuellement.

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;

    // ─── Vérifier que le brouillon existe et n'est pas transformé ───
    const { data: existing, error: fetchError } = await supabaseAdmin
      .from("drafts")
      .select("id, slug, numero_affiche, transformed_at")
      .eq("slug", slug)
      .maybeSingle();

    if (fetchError) {
      console.error("DELETE draft fetch error:", fetchError);
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
          error: "Ce brouillon a déjà été transformé en offre. Suppression impossible. " +
                 "Il sera purgé automatiquement 30 jours après la transformation."
        },
        { status: 409 }
      );
    }

    // ─── Hard delete ───
    const { error } = await supabaseAdmin
      .from("drafts")
      .delete()
      .eq("slug", slug);

    if (error) {
      console.error("Delete draft error:", error);
      return NextResponse.json(
        { error: "Erreur base de données : " + error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      deleted: {
        slug: existing.slug,
        numero_affiche: existing.numero_affiche,
      },
    });
  } catch (err) {
    console.error("Delete draft error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}