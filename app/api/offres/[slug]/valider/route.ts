// app/api/offres/[slug]/valider/route.ts
// POST /api/offres/[slug]/valider
// Valide une offre, crée une commande CMD, envoie webhook Make
// + Auto-génère le PDF commande, le QR paiement
// + Auto-génère la fiche de travail INITIALE (figée, stock du moment) + COURANTE

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { createNotification } from "@/lib/notifications";

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
      const existingCmdSlug = offre.numero_commande
        ? offre.numero_commande.toLowerCase().replace(/[^a-z0-9-]/g, "-")
        : null;
      return NextResponse.json({
        error: "Cette offre a déjà été validée",
        alreadyValidated: true,
        cmdSlug: existingCmdSlug,
      }, { status: 409 });
    }

    // Verrouillage immédiat avant toute opération
    const { error: lockError } = await supabaseAdmin
      .from("offres")
      .update({ statut: "Convertie" })
      .eq("slug", slug)
      .eq("statut", offre.statut);

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

    // 3. Mise à jour de l'offre originale
    await supabaseAdmin
      .from("offres")
      .update({
        data: {
          ...(offre.data as Record<string, unknown>),
          signataire,
          date_signature,
          signature_base64,
          date_validation: new Date().toISOString(),
        },
      })
      .eq("slug", slug);

    // 4. Créer la nouvelle ligne commande
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

    // ─── Créer une notification interne (Couche 1) ───
    // Non bloquant — si erreur, le flow continue
    await createNotification({
      type: "commande_validee",
      offre_slug: cmdSlug,
      numero_affiche: numeroCommande,
      type_document: "Commande",
      client_nom: offre.client_nom,
      client_prenom: offre.client_prenom,
      client_societe: offre.client_societe,
      commercial: offre.commercial,
      total_ttc: offre.total_ttc,
      payment_mode: offre.payment_mode,
      titre: `🎉 Commande ${numeroCommande} validée online`,
    });

    // 5. Webhook Make
    const offreData = offre.data as Record<string, unknown>
    const webhookPayload = {
      source: "jardin_confort_formulaire",
      event: "offre_validee",

      numero_offre: offre.numero_affiche,
      numero_commande: numeroCommande,
      offre_slug: slug,
      commande_slug: cmdSlug,

      societe: offre.client_societe || "",
      nom: offre.client_nom || "",
      prenom: offre.client_prenom || "",
      nom_complet: `${offre.client_prenom || ""} ${offre.client_nom || ""}`.trim(),
      email: offre.client_email || "",
      telephone: offre.client_tel1 || "",
      rue: offre.client_rue || "",
      npa: offre.client_npa || "",
      localite: offre.client_ville || "",

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

      signataire,
      date_signature,

      url_offre: `${BASE_URL}/offre/${slug}`,
      url_commande: `${BASE_URL}/offre/${cmdSlug}`,
      url_confirmation: `${BASE_URL}/offre/${cmdSlug}/confirmation`,
      url_print_offre: `${BASE_URL}/print/offre/${slug}`,
      url_print_commande: `${BASE_URL}/print/offre/${cmdSlug}`,
      url_pdf_commande: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/pdfs/commandes/${cmdSlug}.pdf`,
      url_qr_paiement: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/pdfs/qr/${cmdSlug}_qr.pdf`,
      url_fiche_travail_initiale: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/pdfs/fiches-travail/${cmdSlug}_initial.pdf`,
      url_fiche_travail: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/pdfs/fiches-travail/${cmdSlug}.pdf`,

      iban: "CH72 0076 7000 K033 3796 5",
      banque: "BCV – Banque Cantonale Vaudoise",
      beneficiaire: "Jardin-Confort SA",

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

    // ─── Génération PDFs en arrière-plan ───
    // ⚠️ Sur Vercel, le pattern (async () => { sleep ... })() ne fonctionne PAS
    // de manière fiable car le serverless container peut être tué avant la fin
    // des sleeps. Solution : on lance les fetchs en parallèle SANS attendre,
    // et chaque endpoint cible se débrouille avec pdf.co.
    //
    // Pour éviter la saturation de pdf.co (3-5 jobs en parallèle = OK), on
    // n'a pas besoin de sleeps : pdf.co gère sa propre file d'attente côté serveur.
    fetch(`${BASE_URL}/api/offres/${slug}/pdf`, { method: "POST" })
      .catch(err => console.error("PDF offre err:", err))

    fetch(`${BASE_URL}/api/offres/${cmdSlug}/pdf`, { method: "POST" })
      .catch(err => console.error("PDF commande err:", err))

    fetch(`${BASE_URL}/api/offres/${cmdSlug}/qr`, { method: "POST" })
      .catch(err => console.error("QR paiement err:", err))

    fetch(`${BASE_URL}/api/offres/${cmdSlug}/fiche-travail-pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "initial" }),
    }).catch(err => console.error("Fiche initiale err:", err))

    fetch(`${BASE_URL}/api/offres/${cmdSlug}/fiche-travail-pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "current" }),
    }).catch(err => console.error("Fiche courante err:", err))

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