// app/api/offres/[slug]/wallee-facture/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// Route PUBLIQUE, LECTURE SEULE — chantier « Wallee v2 » (05.09.2026).
// Déclarée dans proxy.ts exactement comme /qr (GET seul).
//
// Sert au client, depuis sa page de confirmation, la QR-facture rendue par
// Wallee (bulletin QR suisse inclus) quand une transaction « virement QR » a été
// validée pour sa commande — à la place du PDF pdf4me. Sans transaction Wallee,
// la page garde son comportement actuel (pdf4me) : cette route répond 404 et la
// page n'y touche pas.
//
//  GET /api/offres/[slug]/wallee-facture[?tranche=acompte|solde]
//        → le PDF (inline), Cache-Control: no-store
//  GET /api/offres/[slug]/wallee-facture?format=json[&tranche=…]
//        → { disponible, tranche, wallee_transaction_id, state, montant }
//          (la page interroge ce JSON au chargement pour savoir quel bouton
//          afficher, sans télécharger le PDF)
//
// Résolution du slug : une COMMANDE (cmd-…) lit ses propres transactions ; une
// OFFRE convertie (dev-…) lit celles de la commande liée par numero_commande,
// exactement comme le GET racine /api/offres/[slug] résout pdf_url / qr_url.
//
// Exposition : identique au qr_url du Storage aujourd'hui (le slug est le
// secret, le PDF porte l'adresse du client et le montant). Aucune écriture,
// aucun état modifié chez Wallee. Le mode 'twint' n'a pas de facture : ignoré.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { DefaultConfig, HttpBearerAuth, TransactionsService } from "wallee";

// Une QR-facture existe chez Wallee dès que le client a validé le virement QR.
const ETATS_FACTURE = new Set(["AUTHORIZED", "COMPLETED", "FULFILL"]);

type Ligne = {
  wallee_transaction_id: number;
  merchant_reference: string;
  montant: number | string;
  state: string;
  mode: string;
  tranche: string;
};

function enNombre(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(String(v ?? "").trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

function serviceWallee(): { service: TransactionsService; spaceId: number } | null {
  const spaceId = enNombre(process.env.WALLEE_SPACE_ID);
  const userId = enNombre(process.env.WALLEE_USER_ID);
  const authKey = process.env.WALLEE_AUTH_KEY || "";
  if (!spaceId || !userId || !authKey) return null;
  DefaultConfig.httpBearerAuth = new HttpBearerAuth(userId, authKey);
  return { service: new TransactionsService(DefaultConfig), spaceId };
}

// Slug de la commande porteuse des transactions : lui-même pour une commande,
// la commande liée pour une offre convertie, null sinon.
async function slugCommande(slug: string): Promise<string | null> {
  const { data: doc, error } = await supabaseAdmin
    .from("offres")
    .select("slug, type_document, statut, numero_commande")
    .eq("slug", slug)
    .maybeSingle();
  if (error || !doc) return null;
  if (doc.type_document === "Commande") return doc.slug as string;
  const convertie = doc.statut === "Convertie" || doc.statut === "Acceptée";
  if (!convertie || !doc.numero_commande) return null;
  const { data: cmd } = await supabaseAdmin
    .from("offres")
    .select("slug")
    .eq("numero_commande", doc.numero_commande)
    .eq("type_document", "Commande")
    .maybeSingle();
  return (cmd?.slug as string) || null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const format = (req.nextUrl.searchParams.get("format") || "").toLowerCase();
    const trancheParam = (req.nextUrl.searchParams.get("tranche") || "acompte").toLowerCase();
    if (trancheParam !== "acompte" && trancheParam !== "solde") {
      return NextResponse.json({ error: "tranche invalide" }, { status: 400 });
    }

    const cmdSlug = await slugCommande(slug);
    if (!cmdSlug) {
      return NextResponse.json({ disponible: false, error: "Aucune commande pour ce document" }, { status: 404 });
    }

    const { data, error } = await supabaseAdmin
      .from("transactions_wallee")
      .select("wallee_transaction_id, merchant_reference, montant, state, mode, tranche")
      .eq("commande_slug", cmdSlug)
      .eq("mode", "qr")
      .eq("tranche", trancheParam)
      .order("created_at", { ascending: false });
    if (error) {
      console.error("wallee-facture select error:", error);
      return NextResponse.json({ disponible: false, error: error.message }, { status: 500 });
    }
    const ligne = ((data || []) as Ligne[]).find((t) => ETATS_FACTURE.has(t.state)) || null;

    if (format === "json") {
      return NextResponse.json(
        {
          disponible: Boolean(ligne),
          tranche: trancheParam,
          wallee_transaction_id: ligne?.wallee_transaction_id ?? null,
          state: ligne?.state ?? null,
          montant: ligne ? Number(ligne.montant) : null,
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    if (!ligne) {
      return NextResponse.json({ disponible: false, error: "Aucune QR-facture Wallee pour ce document" }, { status: 404 });
    }
    const w = serviceWallee();
    if (!w) return NextResponse.json({ error: "Configuration Wallee incomplète" }, { status: 500 });

    const doc = await w.service.getPaymentTransactionsIdInvoiceDocument({ id: ligne.wallee_transaction_id, space: w.spaceId });
    if (!doc?.data) {
      return NextResponse.json({ error: "Wallee n'a pas (encore) de facture pour cette transaction" }, { status: 404 });
    }
    const pdf = Buffer.from(doc.data, "base64");
    const nom = `QR-facture_${ligne.merchant_reference}_${trancheParam}.pdf`;
    return new NextResponse(pdf, {
      status: 200,
      headers: {
        "Content-Type": doc.mimeType || "application/pdf",
        "Content-Disposition": `inline; filename="${nom}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("wallee-facture GET error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
