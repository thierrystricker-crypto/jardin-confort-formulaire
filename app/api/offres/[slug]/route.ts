// app/api/offres/[slug]/route.ts
// Lit une offre depuis Supabase + re-fetche le stock Shopify en temps réel
// GET /api/offres/[slug]
// GET /api/offres/[slug]?snapshot=true  → retourne le snapshot figé

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase";
import { isShopifyLine } from "@/lib/jc-print-types";
import { refreshStock } from "@/lib/shopify-refresh-stock";



export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const useSnapshot = request.nextUrl.searchParams.get("snapshot") === "true";

    // Lire l'offre depuis Supabase
    const { data: offre, error } = await supabase
      .from("offres")
      .select("*")
      .eq("slug", slug)
      .single();

    if (error || !offre) {
      return NextResponse.json(
        { error: "Offre non trouvée" },
        { status: 404 }
      );
    }

    // Si on demande le snapshot figé (pour l'impression)
    if (useSnapshot && offre.data_snapshot) {
      let numeroClient = null
      const clientEmail = (offre.data as Record<string,unknown>)?.email as string || offre.client_email
      if (clientEmail) {
        const { data: clientData } = await supabase
          .from("clients")
          .select("numero_client")
          .eq("email", clientEmail)
          .single()
        if (clientData) numeroClient = clientData.numero_client
      }
      return NextResponse.json({
        offre: {
          ...offre,
          data: offre.data_snapshot,
          isSnapshot: true,
          snapshotAt: offre.snapshot_at,
          numero_client: numeroClient,
        },
      });
    }

    // Pour les COMMANDES, le stock est figé au moment de la conversion offre→commande.
    // Pour les OFFRES SIGNÉES (Convertie/Acceptée), on récupère le stock J0 + PDF + QR
    // de la commande liée (cohérence parfaite entre /offre/dev-XXX et /offre/cmd-XXX).
    // Pour les OFFRES EN COURS, on refresh le stock Shopify en temps réel.
    const dataLines = (offre.data as { lines?: Array<{ type: string; sku?: string; stock?: unknown }> })?.lines ?? [];
    const isCommande = offre.type_document === "Commande";
    const isOffreConvertie = !isCommande && (offre.statut === "Convertie" || offre.statut === "Acceptée");

    let freshLines: typeof dataLines;
    let stockFrozen: string | null = null;
    let frozenPdfUrl: string | null = null;
    let frozenQrUrl: string | null = null;

    if (isCommande) {
      // 🔒 Commande : stock figé J0 dans data.lines, on garde tel quel
      freshLines = dataLines;
      stockFrozen = (offre.data as Record<string, unknown>)?.stock_frozen_at as string || null;
    } else if (isOffreConvertie && offre.numero_commande) {
      // 🔒 Offre signée → on va chercher le stock J0 + PDF + QR de la commande liée
      const { data: cmd } = await supabase
        .from("offres")
        .select("data, pdf_url, qr_url")
        .eq("numero_commande", offre.numero_commande)
        .eq("type_document", "Commande")
        .single();

      if (cmd?.data) {
        const cmdLines = (cmd.data as { lines?: typeof dataLines }).lines;
        if (Array.isArray(cmdLines) && cmdLines.length > 0) {
          freshLines = cmdLines;  // ✅ Stock J0 de la commande
          stockFrozen = (cmd.data as Record<string, unknown>)?.stock_frozen_at as string || null;
          frozenPdfUrl = cmd.pdf_url || null;  // ✅ PDF de la commande
          frozenQrUrl = cmd.qr_url || null;    // ✅ QR paiement de la commande
        } else {
          freshLines = dataLines;  // Fallback : stock de l'offre
        }
      } else {
        freshLines = dataLines;  // Fallback : commande introuvable
      }
    } else {
      // 🔄 Offre en cours : stock live Shopify
      freshLines = await refreshStock(dataLines);
    }

    const isFrozen = isCommande || isOffreConvertie;

    const freshData = {
      ...(offre.data as Record<string, unknown>),
      lines: freshLines,
    };

    // Chercher le numéro client en base
    let numeroClient = null
    const clientEmail = (offre.data as Record<string,unknown>)?.email as string || offre.client_email
    if (clientEmail) {
      const { data: clientData } = await supabase
        .from("clients")
        .select("numero_client")
        .eq("email", clientEmail)
        .single()
      if (clientData) numeroClient = clientData.numero_client
    }

    return NextResponse.json({
      offre: {
        ...offre,
        data: freshData,
        // Pour une offre signée : on remplace pdf_url ET qr_url par ceux de la commande liée
        // (les boutons "Télécharger la confirmation PDF" et "Télécharger le QR paiement"
        //  pointent ainsi vers les bons documents — ceux de la CMD, pas de l'offre)
        pdf_url: frozenPdfUrl || offre.pdf_url,
        qr_url: frozenQrUrl || offre.qr_url,
        isSnapshot: false,
        stockFrozen: !!stockFrozen,
        stockFrozenAt: stockFrozen || null,
        stockRefreshedAt: isFrozen ? null : new Date().toISOString(),
        numero_client: numeroClient,
      },
    });

  } catch (err) {
    console.error("Get offre error:", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

// PATCH /api/offres/[slug] — mettre à jour le statut ou créer un snapshot
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const body = await request.json();

    // Action : mettre à jour le statut
    if (body.statut) {
      const { error } = await supabase
        .from("offres")
        .update({ statut: body.statut })
        .eq("slug", slug);

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ success: true });
    }

    // Action : créer un snapshot figé (stock à l'instant t)
    if (body.createSnapshot) {
      // Lire l'offre
      const { data: offre } = await supabase
        .from("offres")
        .select("data")
        .eq("slug", slug)
        .single();

      if (!offre) return NextResponse.json({ error: "Offre non trouvée" }, { status: 404 });

      // Rafraîchir le stock une dernière fois
      const freshLines = await refreshStock(
        (offre.data as { lines?: Array<{ type: string; sku?: string; stock?: unknown }> })?.lines ?? []
      );
      const snapshot = { ...(offre.data as Record<string, unknown>), lines: freshLines };

      // Sauvegarder le snapshot
      const { error } = await supabase
        .from("offres")
        .update({
          data_snapshot: snapshot,
          snapshot_at: new Date().toISOString(),
        })
        .eq("slug", slug);

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ success: true, snapshot });
    }

    return NextResponse.json({ error: "Action non reconnue" }, { status: 400 });

  } catch (err) {
    console.error("Patch offre error:", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}