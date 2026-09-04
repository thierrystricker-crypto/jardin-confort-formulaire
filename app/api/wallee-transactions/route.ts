// app/api/wallee-transactions/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// Chantier « Lien de paiement Wallee » (04.09.2026) — l'AMONT du circuit
// « Acompte payé visible » (03.09.2026) : on crée ici la transaction Wallee
// dont le paiement (état FULFILL, relayé par Make → /api/wallee-webhook)
// allumera le badge « ✅ Acompte reçu » de la fiche commande.
//
// Route INTERNE (cookie jc_acces via proxy.ts — rien n'a été ouvert).
//
//  - POST { slug }        : crée la transaction pour une COMMANDE, l'enregistre
//                           dans transactions_wallee, renvoie l'URL de la page de
//                           paiement (jamais stockée : tokenisée et temporaire).
//  - GET  ?slug=cmd-…     : liste les transactions du document ; relit l'état
//                           de la plus récente chez Wallee si elle n'est pas
//                           terminale ; régénère l'URL de page si elle est encore
//                           payable.
//  - GET  ?slug=cmd-…&document=facture : le PDF « Facture » rendu par Wallee
//                           (bulletin QR suisse inclus) pour la transaction la
//                           plus récente. Existe dès que le client a validé le
//                           virement QR (AUTHORIZED/COMPLETED) — c'est le seul
//                           canal par lequel il peut recevoir le bulletin, les
//                           mails Wallee étant coupés. Servi tel quel, jamais stocké.
//
// Règles :
//  - Montant et débiteur : REPRODUITS À L'IDENTIQUE de app/api/offres/[slug]/qr
//    (sanctuarisé, non touché) — même règle 50 % / 100 %, mêmes champs, mêmes
//    replis. Même duplication licite que qr-libre. Le QR actuel tourne comme avant.
//  - merchantReference = numero_affiche : c'est la clé que le webhook et le badge
//    relisent. ⚠️ numero_affiche n'est pas unique (doublons connus sur DEV-) :
//    on n'accepte ici que les type_document = "Commande".
//  - Moyens de paiement : VIREMENT QR SEUL (allowedPaymentMethodConfigurations =
//    [243711]). Décidé le 04.09.2026 après un incident : en laissant tous les
//    moyens du space, le client pouvait choisir « Facture » (connecteur QR-Facture,
//    paiement après livraison), que Wallee passe en FULFILL immédiatement → badge
//    « Acompte reçu » allumé sans un centime encaissé (CMD-80953). Les autres
//    moyens (TWINT, PostFinance, PayPal) viendront par un second bouton, avec une
//    liste explicite qui n'inclura jamais la facture. Le space 48617 est partagé
//    avec le webshop : aucun réglage au niveau du space.
//  - Mails Wallee coupés PAR TRANSACTION (emailsDisabled = true), jamais dans le space.
//  - billingAddress structurée (obligatoire pour le QR-bill). Le SDK n'a pas de
//    champ « numéro » séparé : rue + numéro vont dans `street`, comme sur le
//    bulletin du QR. Pays : CH (aucune colonne pays dans offres).
//  - N'écrit JAMAIS dans offres ni dans acomptes_wallee. Aucun impact stock.
//  - Une transaction jamais ouverte EXPIRE (FAILED) : le GET relit l'état, et le
//    POST n'accepte une nouvelle transaction que si la précédente est terminale
//    en échec (FAILED / VOIDED / DECLINE) — ou avec { force: true }, réservé au
//    cas « montant du document modifié depuis » (révision / correction).
//
// Env Vercel (déjà en place) : WALLEE_SPACE_ID (48617), WALLEE_USER_ID (172773),
//                              WALLEE_AUTH_KEY. Même auth que /api/wallee-webhook.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import {
  DefaultConfig,
  HttpBearerAuth,
  LineItemType,
  TransactionsService,
} from "wallee";
import type { Transaction, TransactionCreate } from "wallee";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://offres.jardin-confort.ch";

// Configuration de moyen de paiement « Virement bancaire avec facture QR »
// (PostFinance) du space 48617 — relevée dans le portail Wallee. Seul moyen
// autorisé sur les transactions créées ici. Surchargeable par variable Vercel
// si l'id venait à changer.
const METHODE_VIREMENT_QR = enNombre(process.env.WALLEE_METHODE_VIREMENT_QR) ?? 243711;

// États Wallee (cf. TransactionState du SDK) regroupés pour l'UI.
const ETATS_ECHEC = new Set(["FAILED", "VOIDED", "DECLINE"]);
const ETATS_PAYABLES = new Set(["PENDING", "CONFIRMED"]);
const ETATS_TERMINAUX = new Set(["FAILED", "VOIDED", "DECLINE", "FULFILL"]);

type OffreDoc = Record<string, unknown>;

type LigneTx = {
  id: string;
  wallee_transaction_id: number;
  commande_slug: string;
  merchant_reference: string;
  montant: number | string;
  devise: string;
  is_acompte: boolean;
  libelle: string | null;
  state: string;
  state_checked_at: string | null;
  created_at: string;
  updated_at: string;
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

// ─── Montant : copie conforme de api/offres/[slug]/qr (POST, l. 270-273) ───
function montantDocument(offre: OffreDoc): { isAcompte: boolean; montant: number; libelle: string } {
  const paymentMode = (offre.payment_mode as string) || "";
  const totalTtc = Number(offre.total_ttc);
  const isAcompte = paymentMode.includes("50%");
  const montant = isAcompte ? Math.round(totalTtc * 0.5 * 100) / 100 : totalTtc;
  // Libellés du bulletin QR (generateQrPageHtml)
  const libelle = isAcompte ? "Acompte 50% à la commande" : "Paiement d'avance à la commande";
  return { isAcompte, montant, libelle };
}

// ─── Débiteur : copie conforme de api/offres/[slug]/qr (addSwissQrBill) ───
// Priorité société pour les B2B (un seul champ « nom » côté débiteur ISO 20022),
// sinon prénom + nom ; mêmes troncatures et mêmes replis que le QR.
function debiteurDocument(offre: OffreDoc) {
  const d = (offre.data as Record<string, unknown>) || {};
  const personneNom = [offre.client_prenom, offre.client_nom]
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean)
    .join(" ");
  const societe = ((offre.client_societe as string) || "").trim();
  const udName = (societe || personneNom || "Client").toString().slice(0, 70);
  const udStreet = ((offre.client_rue as string) || "Rue inconnue").slice(0, 70);
  // ⚠️ Pas le repli « 1 » du QR ici : chez pdf4me il va dans un champ « numéro »
  // séparé, alors que Wallee n'a qu'un champ `street` — le « 1 » s'imprimait
  // collé à la rue (« Chemin des Viards 2 1 », vu sur la facture du 04.09).
  // Même assemblage que le bulletin HTML du QR : [rue, numero].filter(Boolean).
  const udNumber = (typeof d.numero === "string" ? d.numero.trim() : "").slice(0, 16);
  const udPostalCode = ((offre.client_npa as string) || "0000").slice(0, 16);
  const udCity = ((offre.client_ville as string) || "Suisse").slice(0, 35);
  return {
    societe,
    prenom: typeof offre.client_prenom === "string" ? offre.client_prenom.trim() : "",
    nom: typeof offre.client_nom === "string" ? offre.client_nom.trim() : "",
    udName,
    street: [udStreet, udNumber].filter(Boolean).join(" "),
    postcode: udPostalCode,
    city: udCity,
  };
}

// Extrait STABLE de la transaction Wallee pour la colonne raw (jamais l'URL).
function extraitTx(tx: Transaction) {
  return {
    id: tx.id ?? null,
    state: tx.state ?? null,
    merchantReference: tx.merchantReference ?? null,
    authorizationAmount: tx.authorizationAmount ?? null,
    completedAmount: tx.completedAmount ?? null,
    currency: tx.currency ?? null,
    language: tx.language ?? null,
    emailsDisabled: tx.emailsDisabled ?? null,
    createdOn: tx.createdOn ?? null,
    failedOn: tx.failedOn ?? null,
    userFailureMessage: tx.userFailureMessage ?? null,
    endOfLife: tx.endOfLife ?? null,
  };
}

async function lireCommande(slug: string): Promise<OffreDoc | null> {
  const { data, error } = await supabaseAdmin
    .from("offres")
    .select("slug, type_document, statut, numero_affiche, payment_mode, total_ttc, client_societe, client_nom, client_prenom, client_email, client_rue, client_npa, client_ville, data")
    .eq("slug", slug)
    .maybeSingle();
  if (error || !data) return null;
  return data as OffreDoc;
}

async function lignesDuSlug(slug: string): Promise<LigneTx[]> {
  const { data, error } = await supabaseAdmin
    .from("transactions_wallee")
    .select("id, wallee_transaction_id, commande_slug, merchant_reference, montant, devise, is_acompte, libelle, state, state_checked_at, created_at, updated_at")
    .eq("commande_slug", slug)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []) as LigneTx[];
}

// URL de page de paiement : régénérée à chaque demande, jamais persistée.
async function urlPage(service: TransactionsService, spaceId: number, id: number): Promise<string | null> {
  try {
    const url = await service.getPaymentTransactionsIdPaymentPageUrl({ id, space: spaceId });
    return typeof url === "string" && url.startsWith("http") ? url : null;
  } catch (err) {
    console.error("wallee paymentPageUrl error:", err);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// GET ?slug=… — état courant + URL fraîche
// ─────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const slug = (req.nextUrl.searchParams.get("slug") || "").trim();
    if (!slug) return NextResponse.json({ error: "Paramètre slug requis" }, { status: 400 });

    const offre = await lireCommande(slug);
    if (!offre) return NextResponse.json({ error: "Document introuvable" }, { status: 404 });
    const { montant: montantDoc } = montantDocument(offre);

    // ─── Variante : le PDF « Facture » de Wallee (QR-facture) ───
    if ((req.nextUrl.searchParams.get("document") || "") === "facture") {
      const w = serviceWallee();
      if (!w) return NextResponse.json({ error: "Configuration Wallee incomplète" }, { status: 500 });
      const derniere = (await lignesDuSlug(slug))[0];
      if (!derniere) return NextResponse.json({ error: "Aucune transaction Wallee pour ce document" }, { status: 404 });
      const doc = await w.service.getPaymentTransactionsIdInvoiceDocument({ id: derniere.wallee_transaction_id, space: w.spaceId });
      if (!doc?.data) return NextResponse.json({ error: "Wallee n'a pas (encore) de facture pour cette transaction" }, { status: 404 });
      const pdf = Buffer.from(doc.data, "base64");
      const nom = `QR-facture_${derniere.merchant_reference}_${derniere.wallee_transaction_id}.pdf`;
      return new NextResponse(pdf, {
        status: 200,
        headers: {
          "Content-Type": doc.mimeType || "application/pdf",
          "Content-Disposition": `inline; filename="${nom}"`,
          "Cache-Control": "no-store",
        },
      });
    }

    let lignes = await lignesDuSlug(slug);
    let paymentPageUrl: string | null = null;

    const w = serviceWallee();
    const derniere = lignes[0];
    if (w && derniere) {
      // Relecture de l'état chez Wallee (la source fait foi) tant qu'il n'est pas terminal.
      if (!ETATS_TERMINAUX.has(derniere.state)) {
        try {
          const tx = await w.service.getPaymentTransactionsId({ id: derniere.wallee_transaction_id, space: w.spaceId });
          const etat = String(tx.state ?? derniere.state).toUpperCase();
          const { error } = await supabaseAdmin
            .from("transactions_wallee")
            .update({ state: etat, state_checked_at: new Date().toISOString(), updated_at: new Date().toISOString(), raw: extraitTx(tx) })
            .eq("id", derniere.id);
          if (error) console.error("transactions_wallee update error:", error);
          lignes = await lignesDuSlug(slug);
        } catch (err) {
          console.error("wallee getPaymentTransactionsId error:", err);
        }
      }
      const courante = lignes[0];
      if (courante && ETATS_PAYABLES.has(courante.state)) {
        paymentPageUrl = await urlPage(w.service, w.spaceId, courante.wallee_transaction_id);
      }
    }

    return NextResponse.json({
      transactions: lignes,
      count: lignes.length,
      payment_page_url: paymentPageUrl,
      montant_document: montantDoc,
      wallee_configure: Boolean(w),
    });
  } catch (err) {
    console.error("wallee-transactions GET error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────
// POST { slug, force? } — création de la transaction
// ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { slug?: string; force?: boolean };
    const slug = (body.slug || "").trim();
    const force = body.force === true;
    if (!slug) return NextResponse.json({ error: "slug requis" }, { status: 400 });

    const w = serviceWallee();
    if (!w) return NextResponse.json({ error: "Configuration Wallee incomplète" }, { status: 500 });

    const offre = await lireCommande(slug);
    if (!offre) return NextResponse.json({ error: "Document introuvable" }, { status: 404 });
    if (offre.type_document !== "Commande") {
      return NextResponse.json({ error: "Un lien de paiement Wallee ne se crée que sur une commande" }, { status: 409 });
    }
    const numero = String(offre.numero_affiche || "").trim();
    if (!numero) return NextResponse.json({ error: "Numéro de commande manquant" }, { status: 409 });

    const { isAcompte, montant, libelle } = montantDocument(offre);
    if (!Number.isFinite(montant) || montant <= 0) {
      return NextResponse.json({ error: "Montant invalide" }, { status: 400 });
    }

    // Une seule transaction vivante à la fois : on ne recrée que sur échec
    // terminal (expirée / annulée / refusée), ou explicitement avec force.
    const existantes = await lignesDuSlug(slug);
    const vivante = existantes.find((t) => !ETATS_ECHEC.has(t.state));
    if (vivante && !force) {
      return NextResponse.json(
        { error: `Une transaction Wallee existe déjà (${vivante.wallee_transaction_id}, état ${vivante.state})`, transaction: vivante },
        { status: 409 }
      );
    }

    const deb = debiteurDocument(offre);
    const email = typeof offre.client_email === "string" ? offre.client_email.trim() : "";
    // D17 : « sans-email.… » est une adresse GÉNÉRÉE — ne jamais y écrire, ne jamais la transmettre.
    const emailClient = email && !email.toLowerCase().startsWith("sans-email.") ? email : undefined;

    const creation: TransactionCreate = {
      currency: "CHF",
      language: "fr-CH",
      merchantReference: numero,
      invoiceMerchantReference: numero,
      allowedPaymentMethodConfigurations: [METHODE_VIREMENT_QR],
      emailsDisabled: true,
      customerEmailAddress: emailClient,
      successUrl: `${APP_URL}/offre/${slug}`,
      failedUrl: `${APP_URL}/offre/${slug}`,
      billingAddress: {
        organizationName: deb.societe || undefined,
        givenName: deb.prenom || undefined,
        familyName: deb.nom || (deb.societe ? undefined : deb.udName),
        street: deb.street,
        postcode: deb.postcode,
        city: deb.city,
        country: "CH",
        emailAddress: emailClient,
      },
      lineItems: [
        {
          uniqueId: `${numero}-${isAcompte ? "acompte" : "paiement"}`,
          name: `${libelle} — ${numero}`,
          quantity: 1,
          amountIncludingTax: montant,
          type: LineItemType.Product,
          shippingRequired: false,
        },
      ],
      metaData: { slug, numero_affiche: numero, source: "dashboard" },
    };

    const tx = await w.service.postPaymentTransactions({ space: w.spaceId, transactionCreate: creation });
    const txId = enNombre(tx.id);
    if (!txId) return NextResponse.json({ error: "Wallee n'a pas rendu d'identifiant de transaction" }, { status: 502 });
    const etat = String(tx.state ?? "PENDING").toUpperCase();

    // Trace D'ABORD (on préfère une ligne sans URL à une URL sans ligne).
    const { data: ligne, error: insertError } = await supabaseAdmin
      .from("transactions_wallee")
      .insert({
        wallee_transaction_id: txId,
        commande_slug: slug,
        merchant_reference: numero,
        montant,
        devise: "CHF",
        is_acompte: isAcompte,
        libelle,
        state: etat,
        state_checked_at: new Date().toISOString(),
        raw: extraitTx(tx),
      })
      .select("id, wallee_transaction_id, commande_slug, merchant_reference, montant, devise, is_acompte, libelle, state, state_checked_at, created_at, updated_at")
      .single();
    if (insertError) {
      // La transaction existe chez Wallee : on le dit, avec son id, pour qu'elle soit retrouvable.
      console.error("transactions_wallee insert error:", insertError);
      return NextResponse.json(
        { error: `Transaction Wallee ${txId} créée mais non enregistrée : ${insertError.message}`, wallee_transaction_id: txId },
        { status: 500 }
      );
    }

    const paymentPageUrl = await urlPage(w.service, w.spaceId, txId);

    return NextResponse.json({
      success: true,
      transaction: ligne,
      payment_page_url: paymentPageUrl,
      montant,
      isAcompte,
    });
  } catch (err) {
    console.error("wallee-transactions POST error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
