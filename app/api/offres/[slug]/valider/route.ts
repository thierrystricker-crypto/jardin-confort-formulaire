// app/api/offres/[slug]/valider/route.ts
// POST /api/offres/[slug]/valider
// Valide une offre, crée une commande CMD, envoie webhook Make

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

const MAKE_WEBHOOK = process.env.MAKE_WEBHOOK_VALIDATION_URL ||
  "https://hook.eu1.make.com/tqqhnrzkcwfhybguktd75drtmqv9ah49";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ||
  "https://offres.jardin-confort.ch";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const body = await request.json();
    const { signataire, signature_base64, date_signature } = body;

    if (!signataire) {
      return NextResponse.json({ error: "Signataire requis" }, { status: 400 });
    }

    // 1. Lire l'offre originale
    const { data: offre, error: readError } = await supabaseAdmin
      .from("offres")
      .select("*")
      .eq("slug", slug)
      .single();

    if (readError || !offre) {
      return NextResponse.json({ error: "Offre non trouvée" }, { status: 404 });
    }

    // Protection anti-doublon : vérifier TOUS les statuts finaux
    if (["Acceptée", "Convertie", "Commande"].includes(offre.statut) || offre.numero_commande) {
      // Récupérer le slug de la commande existante pour rediriger
      const existingCmdSlug = offre.numero_commande
        ? offre.numero_commande.toLowerCase().replace(/[^a-z0-9-]/g, "-")
        : null;
      return NextResponse.json({
        error: "Cette offre a déjà été validée",
        alreadyValidated: true,
        cmdSlug: existingCmdSlug,
      }, { status: 409 });
    }

    // Verrouillage immédiat avant toute opération — évite les doubles clics simultanés
    const { error: lockError } = await supabaseAdmin
      .from("offres")
      .update({ statut: "Convertie" })
      .eq("slug", slug)
      .eq("statut", offre.statut); // condition atomique : échoue si déjà modifié

    if (lockError) {
      return NextResponse.json({ error: "Offre déjà en cours de validation" }, { status: 409 });
    }

    // 2. Générer le numéro de commande CMD-XXXXX
    const { data: cmdNum, error: cmdError } = await supabaseAdmin
      .rpc("next_cmd_numero");

    if (cmdError || !cmdNum) {
      return NextResponse.json({ error: "Erreur génération numéro commande" }, { status: 500 });
    }

    const numeroCommande = cmdNum as string;
    const token = Math.random().toString(36).slice(2, 7);
const cmdSlug = numeroCommande.toLowerCase().replace(/[^a-z0-9-]/g, "-") + "-" + token;

    // 3. Compléter la mise à jour de l'offre avec numéro commande + signature
    // On ne modifie PAS numero_affiche — l'offre garde son numéro DEV-XXXX
    await supabaseAdmin
      .from("offres")
      .update({
        // Ne pas mettre numero_commande sur l'offre originale
        // car numero_affiche est généré et prendrait le numéro CMD
        // L'offre garde son numéro DEV grâce à offre_origine sur la commande
        data: {
          ...(offre.data as Record<string, unknown>),
          signataire,
          date_signature,
          signature_base64,
          date_validation: new Date().toISOString(),
        },
      })
      .eq("slug", slug);

    // 4. Créer la nouvelle ligne commande dans Supabase
    // offre_origine = numéro d'offre original (DEV-XXXX), pas le CMD
    const offreNumero = offre.numero_offre || offre.numero_affiche
    const cmdRow = {
      slug: cmdSlug,
      type_document: "Commande",
      numero_offre: offre.numero_offre,
      numero_commande: numeroCommande,
      offre_origine: offreNumero,
      statut: "Acceptée",
      date_document: new Date().toISOString().split("T")[0],
      reference: offre.reference,
      commercial: offre.commercial,
      client_type: offre.client_type,
      payment_mode: offre.payment_mode,
      delivery_mode: offre.delivery_mode,
      lead_time: offre.lead_time,
      client_societe: offre.client_societe,
      client_nom: offre.client_nom,
      client_prenom: offre.client_prenom,
      client_email: offre.client_email,
      client_tel1: offre.client_tel1,
      client_tel2: offre.client_tel2,
      client_rue: offre.client_rue,
      client_numero: offre.client_numero,
      client_npa: offre.client_npa,
      client_ville: offre.client_ville,
      livr_diff: offre.livr_diff,
      livr_societe: offre.livr_societe,
      livr_nom: offre.livr_nom,
      livr_prenom: offre.livr_prenom,
      livr_tel: offre.livr_tel,
      livr_rue: offre.livr_rue,
      livr_numero: offre.livr_numero,
      livr_npa: offre.livr_npa,
      livr_ville: offre.livr_ville,
      sous_total: offre.sous_total,
      remise_chf: offre.remise_chf,
      services_total: offre.services_total,
      arrondi: offre.arrondi,
      tva_montant: offre.tva_montant,
      total_ttc: offre.total_ttc,
      nb_articles: offre.nb_articles,
      remarques: offre.remarques,
      data: {
        ...(offre.data as Record<string, unknown>),
        formType: "Commande",
        offerNumber: numeroCommande,
        signataire,
        date_signature,
        date_validation: new Date().toISOString(),
      },
    };

    const { error: insertError } = await supabaseAdmin
      .from("offres")
      .insert(cmdRow);

    if (insertError) {
      console.error("Insert CMD error:", insertError);
      return NextResponse.json({ error: "Erreur création commande: " + insertError.message }, { status: 500 });
    }

    // 5. Envoyer webhook Make
    const offreData = offre.data as Record<string, unknown>
    const webhookPayload = {
      source: "jardin_confort_formulaire",
      event: "offre_validee",

      // Numéros
      numero_offre: offre.numero_affiche,
      numero_commande: numeroCommande,
      offre_slug: slug,
      commande_slug: cmdSlug,

      // Client
      societe: offre.client_societe || "",
      nom: offre.client_nom || "",
      prenom: offre.client_prenom || "",
      nom_complet: `${offre.client_prenom || ""} ${offre.client_nom || ""}`.trim(),
      email: offre.client_email || "",
      telephone: offre.client_tel1 || "",
      rue: offre.client_rue || "",
      npa: offre.client_npa || "",
      localite: offre.client_ville || "",

      // Offre
      date_offre: offre.date_document || "",
      date_validation: new Date().toLocaleDateString("fr-CH"),
      conseiller: offre.commercial || "",
      mode_paiement: offre.payment_mode || "",
      montant_total: offre.total_ttc,
      montant_total_affiche: "CHF " + new Intl.NumberFormat("de-CH", { minimumFractionDigits: 2 }).format(offre.total_ttc),
      montant_acompte: offre.payment_mode?.includes("50%")
        ? "CHF " + new Intl.NumberFormat("de-CH", { minimumFractionDigits: 2 }).format(Math.round(offre.total_ttc * 0.5 * 100) / 100)
        : "CHF " + new Intl.NumberFormat("de-CH", { minimumFractionDigits: 2 }).format(offre.total_ttc),
      is_acompte: offre.payment_mode?.includes("50%") || false,
      remarques: offre.remarques || "",
      lead_time: offre.lead_time || (offreData.leadTime as string) || "",
      reference: offre.reference || (offreData.reference as string) || "",

      // Signature
      signataire,
      date_signature,

      // URLs
      url_offre: `${BASE_URL}/offre/${slug}`,
      url_commande: `${BASE_URL}/offre/${cmdSlug}`,
      url_confirmation: `${BASE_URL}/offre/${cmdSlug}/confirmation`,
      url_print_offre: `${BASE_URL}/print/offre/${slug}`,
      url_print_commande: `${BASE_URL}/print/offre/${cmdSlug}`,
      url_pdf_commande: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/pdfs/commandes/${cmdSlug}.pdf`,
      url_qr_paiement: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/pdfs/qr/${cmdSlug}_qr.pdf`,

      // Infos bancaires pour email client
      iban: "CH72 0076 7000 K033 3796 5",
      banque: "BCV – Banque Cantonale Vaudoise",
      beneficiaire: "Jardin-Confort SA",

      // Pour l'email équipe
      nb_articles: offre.nb_articles,
      sous_total: offre.sous_total,
      remise_chf: offre.remise_chf,
      tva_montant: offre.tva_montant,
      total_ttc: offre.total_ttc,
    };

    try {
      await fetch(MAKE_WEBHOOK, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-make-apikey": "jc_validation_2026_K9mP4xT7qL2vN8aR5wF1",
        },
        body: JSON.stringify(webhookPayload),
      });
    } catch (webhookErr) {
      console.error("Webhook error:", webhookErr);
    }

    // Générer les PDFs et QR en arrière-plan
    Promise.all([
      fetch(`${BASE_URL}/api/offres/${slug}/pdf`, { method: "POST" }),
      fetch(`${BASE_URL}/api/offres/${cmdSlug}/pdf`, { method: "POST" }),
      fetch(`${BASE_URL}/api/offres/${cmdSlug}/qr`, { method: "POST" }),
    ]).catch(err => console.error("PDF/QR generation error:", err));

    return NextResponse.json({
      success: true,
      numeroCommande,
      cmdSlug,
      confirmationUrl: `${BASE_URL}/offre/${cmdSlug}/confirmation`,
    });

  } catch (err) {
    console.error("Valider offre error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}