// app/api/offres/save/route.ts
// Sauvegarde une offre/commande — génère DEV-2026-XXX ou CMD-XXXXX automatiquement
// + Génère le PDF en arrière-plan
// + Si commande (directe ou édition) : génère AUSSI la fiche de travail initiale + courante

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { computeTotals } from "@/lib/jc-print-types";
import { createNotification } from "@/lib/notifications";

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
    const body = await request.json();
    const { data } = body;

    if (!data) {
      return NextResponse.json({ error: "Données manquantes" }, { status: 400 });
    }

    const totals = computeTotals(data);
    const nbArticles = (data.lines || []).filter(
      (l: { type: string }) => l.type !== "comment"
    ).length;

    const isCommande = data.formType === "Commande";
    let numeroOffre: string | null = null;
    let numeroCommande: string | null = null;
    let slug: string;
    let numeroAffiche: string;
    let isNewDocument = false;

    // Si le numéro existe déjà (édition)
    if (data.offerNumber && (data.offerNumber.startsWith("DEV-") || data.offerNumber.startsWith("CMD-"))) {
      if (data.offerNumber.startsWith("CMD-")) {
        numeroCommande = data.offerNumber;
      } else {
        numeroOffre = data.offerNumber;
      }
      numeroAffiche = data.offerNumber;
      slug = makeSlug(data.offerNumber);
    } else {
      // Nouveau document — générer le numéro via Supabase
      isNewDocument = true;
      if (isCommande) {
        const { data: cmdNum, error } = await supabaseAdmin.rpc("next_cmd_numero");
        if (error) throw new Error("Erreur génération CMD: " + error.message);
        numeroCommande = cmdNum as string;
        numeroAffiche = numeroCommande;
        slug = makeSlug(numeroCommande, true);
      } else {
        const annee = new Date().getFullYear();
        const { data: devNum, error } = await supabaseAdmin.rpc("next_dev_numero", { annee });
        if (error) throw new Error("Erreur génération DEV: " + error.message);
        numeroOffre = devNum as string;
        numeroAffiche = numeroOffre;
        slug = makeSlug(numeroOffre, true);
      }
    }

    const row = {
      slug,
      type_document: data.formType || "Offre",
      numero_offre: numeroOffre,
      numero_commande: numeroCommande,
      reference: data.reference || null,
      statut: data.offerStatus || "En cours",
      date_document: data.date || null,
      commercial: data.commercial || null,
      client_type: data.clientType || null,
      payment_mode: data.paymentMode || null,
      delivery_mode: (data as Record<string, unknown>).deliveryMode as string || null,
      lead_time: data.leadTime || null,
      validite_duree: data.validiteDuree || "30 jours",
      client_societe: data.societe || null,
      client_nom: data.nom || null,
      client_prenom: data.prenom || null,
      client_email: data.email || null,
      client_tel1: data.telephone1 || null,
      client_tel2: data.telephone2 || null,
      client_rue: data.rue || null,
      client_numero: data.numero || null,
      client_npa: data.npa || null,
      client_ville: data.ville || null,
      livr_diff: data.livrDiff || false,
      livr_societe: data.livrSociete || null,
      livr_nom: data.livrNom || null,
      livr_prenom: data.livrPrenom || null,
      livr_tel: data.livrTel || null,
      livr_rue: data.livrRue || null,
      livr_numero: data.livrNumero || null,
      livr_npa: data.livrNpa || null,
      livr_ville: data.livrVille || null,
      sous_total: Math.round(totals.subTotal * 100) / 100,
      remise_chf: Math.round(totals.discountValue * 100) / 100,
      services_total: Math.round(totals.serviceTotal * 100) / 100,
      arrondi: Math.round(totals.roundingValue * 100) / 100,
      tva_montant: Math.round(totals.tvaAmount * 100) / 100,
      total_ttc: Math.round(totals.finalTotal * 100) / 100,
      nb_articles: nbArticles,
      remarques: data.remarks || null,
      notes_internes: data.notesInternes || null,
      data: { ...data, offerNumber: numeroAffiche },
    };

    const { data: result, error } = await supabaseAdmin
      .from("offres")
      .upsert(row, { onConflict: "slug" })
      .select("id, slug, created_at, updated_at")
      .single();

    if (error) {
      console.error("Supabase error:", error);
      return NextResponse.json({ error: "Erreur base de données : " + error.message }, { status: 500 });
    }

    // ─── Créer une notification si nouvelle commande directe ───
    // (Pas de notif pour les offres ni pour les éditions)
    if (isCommande && isNewDocument) {
      await createNotification({
        type: "commande_directe",
        offre_slug: slug,
        numero_affiche: numeroAffiche,
        type_document: "Commande",
        client_nom: data.nom || null,
        client_prenom: data.prenom || null,
        client_societe: data.societe || null,
        commercial: data.commercial || null,
        total_ttc: row.total_ttc,
        payment_mode: data.paymentMode || null,
        titre: `📋 Nouvelle commande directe ${numeroAffiche}`,
      });
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://jardin-confort-formulaire.vercel.app";

    // ─── Génération PDFs en arrière-plan ───
    // ─── Génération PDFs en arrière-plan ───
    // ⚠️ Sur Vercel, le pattern (async () => { sleep ... })() ne fonctionne PAS
    // de manière fiable car le serverless container peut être tué avant la fin
    // des sleeps. Solution : fire-and-forget direct, pdf.co gère sa file d'attente.

    // 1. PDF du document principal (offre ou commande)
    fetch(`${baseUrl}/api/offres/${slug}/pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }).catch(err => console.error("PDF generation error:", err))

    // 2. Si c'est une commande nouvellement créée → fiches de travail (initiale + courante)
    if (isCommande && isNewDocument) {
      fetch(`${baseUrl}/api/offres/${slug}/fiche-travail-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "initial" }),
      }).catch(err => console.error("Fiche travail initiale error:", err))

      fetch(`${baseUrl}/api/offres/${slug}/fiche-travail-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "current" }),
      }).catch(err => console.error("Fiche travail courante error:", err))
    }

    return NextResponse.json({
      success: true,
      id: result.id,
      slug,
      numeroAffiche,
      numeroOffre,
      numeroCommande,
      publicUrl: `${baseUrl}/offre/${slug}`,
      printUrl: `${baseUrl}/print/offre/${slug}`,
      dashboardUrl: `${baseUrl}/dashboard/${slug}`,
      pdfUrl: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/pdfs/${slug.startsWith("cmd") ? "commandes" : "offres"}/${slug}.pdf`,
    });

  } catch (err) {
    console.error("Save offre error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}