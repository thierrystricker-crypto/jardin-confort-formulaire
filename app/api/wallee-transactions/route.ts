// app/api/wallee-transactions/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// Chantier « Lien de paiement Wallee » (04.09.2026) — l'AMONT du circuit
// « Acompte payé visible » (03.09.2026) : on crée ici la transaction Wallee
// dont le paiement (état FULFILL, relayé par Make → /api/wallee-webhook)
// allumera le badge « ✅ Acompte reçu » de la fiche commande.
//
// v2 (05.09.2026, chantier « Wallee v2 ») : une commande porte désormais
// PLUSIEURS transactions en parallèle, qualifiées par
//   - mode    : 'qr'    = virement bancaire avec QR-facture (méthode 243711)
//               'twint' = TWINT / PostFinance Pay / e-finance / Carte PostFinance /
//                         PayPal — liste EXPLICITE d'ids, jamais 255090 « Facture »
//   - tranche : 'acompte' (50 % ou 100 % selon le mode de paiement du document)
//               'solde'   (total − acompte ; n'existe que si le document est en
//                          « Acompte de 50 % » ; créé à la demande par le vendeur)
// Règle : UNE SEULE transaction vivante par (commande, mode, tranche). Les liens
// QR et TWINT d'une même tranche coexistent : le client choisit, le QR reste
// actif (arbitrage Thierry 04.09). Aucune décomptabilisation automatique : une
// QR-facture non payée qui traîne est « une facture papier dans un tiroir ».
//
// Route INTERNE (cookie jc_acces via proxy.ts — rien n'a été ouvert).
//
//  - POST { slug, mode?, tranche?, force? } : crée la transaction pour une
//        COMMANDE, l'enregistre dans transactions_wallee, renvoie l'URL de la
//        page de paiement (jamais stockée : tokenisée et temporaire).
//  - GET  ?slug=cmd-…     : toutes les lignes du document (les plus récentes en
//        premier) ; relit chez Wallee l'état de la dernière ligne de chaque
//        (mode, tranche) si elle n'est pas terminale ; joint une URL de page
//        fraîche à chaque ligne encore payable.
//  - GET  ?slug=cmd-…&document=facture[&tranche=acompte|solde] : le PDF
//        « Facture » rendu par Wallee (bulletin QR suisse inclus) pour la
//        dernière transaction QR de cette tranche ayant une facture
//        (AUTHORIZED/COMPLETED/FULFILL). Servi tel quel, jamais stocké.
//        (La version PUBLIQUE, lue par la page client, est
//        app/api/offres/[slug]/wallee-facture — lecture seule.)
//
// Règles :
//  - Montant et débiteur : REPRODUITS À L'IDENTIQUE de app/api/offres/[slug]/qr
//    (sanctuarisé, non touché) — même règle 50 % / 100 %, mêmes champs, mêmes
//    replis. Même duplication licite que qr-libre. Le QR actuel tourne comme avant.
//  - merchantReference = numero_affiche : c'est la clé que le webhook et le badge
//    relisent. ⚠️ numero_affiche n'est pas unique (doublons connus sur DEV-) :
//    on n'accepte ici que les type_document = "Commande".
//  - Moyens de paiement : par mode, listes explicites (voir constantes). Le
//    connecteur « Facture » (255090, QR-Facture PostFinance = paiement après
//    livraison, passe en FULFILL sans paiement — incident CMD-80953 du 04.09)
//    est exclu EN DUR, même si une variable d'env l'introduisait.
//    Le space 48617 est partagé avec le webshop : aucun réglage au niveau du space.
//  - Mails Wallee coupés PAR TRANSACTION (emailsDisabled = true), jamais dans le space.
//  - billingAddress structurée (obligatoire pour le QR-bill). Le SDK n'a pas de
//    champ « numéro » séparé : rue + numéro vont dans `street`, comme sur le
//    bulletin du QR. Pays : CH (aucune colonne pays dans offres).
//  - N'écrit JAMAIS dans offres ni dans acomptes_wallee. Aucun impact stock.
//  - Une transaction jamais ouverte EXPIRE (FAILED) : le GET relit l'état, et le
//    POST n'accepte une nouvelle transaction de même (mode, tranche) que si la
//    précédente est terminale en échec (FAILED / VOIDED / DECLINE) — ou avec
//    { force: true }, réservé au cas « montant du document modifié depuis ».
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

// ─── Configurations de moyens de paiement du space 48617 ───
// Relevées dans le portail Wallee le 05.09.2026 (Paramètres → Paiement →
// Options de paiement ; l'id est dans l'URL de chaque configuration).
//   243711  Virement bancaire (avec QR-facture)      → mode 'qr'
//   242531  TWINT                                    → mode 'twint'
//   243712  PayPal                                   → mode 'twint'
//   243713  Carte PostFinance                        → mode 'twint'
//   243714  PostFinance e-finance                    → mode 'twint'
//   243715  PostFinance Pay                          → mode 'twint'
//   255090  Facture (QR-Facture PostFinance)         → JAMAIS (voir en-tête)
//   242532  Carte de crédit/débit                    → contrat non actif, exclu
const METHODE_FACTURE_INTERDITE = 255090;
const METHODE_VIREMENT_QR = enNombre(process.env.WALLEE_METHODE_VIREMENT_QR) ?? 243711;
const METHODES_TWINT = listeIds(process.env.WALLEE_METHODES_TWINT, [242531, 243712, 243713, 243714, 243715]);

// Taux de TVA suisse (taux normal, 8.1 % depuis 2024) : le total_ttc des documents
// est TTC, la facture Wallee doit le dire. Surchargeable par variable Vercel.
const TAUX_TVA = enNombre(process.env.WALLEE_TAUX_TVA) ?? 8.1;

// États Wallee (cf. TransactionState du SDK) regroupés pour l'UI.
const ETATS_ECHEC = new Set(["FAILED", "VOIDED", "DECLINE"]);
const ETATS_PAYABLES = new Set(["PENDING", "CONFIRMED"]);
const ETATS_TERMINAUX = new Set(["FAILED", "VOIDED", "DECLINE", "FULFILL"]);
// Une QR-facture existe chez Wallee dès que le client a validé le virement QR.
const ETATS_FACTURE = new Set(["AUTHORIZED", "COMPLETED", "FULFILL"]);

type ModeTx = "qr" | "twint";
type TrancheTx = "acompte" | "solde";
const MODES: ModeTx[] = ["qr", "twint"];
const TRANCHES: TrancheTx[] = ["acompte", "solde"];

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
  mode: ModeTx;
  tranche: TrancheTx;
};

const COLONNES_TX =
  "id, wallee_transaction_id, commande_slug, merchant_reference, montant, devise, is_acompte, libelle, state, state_checked_at, created_at, updated_at, mode, tranche";

function enNombre(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(String(v ?? "").trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Liste CSV d'ids (env) → nombres ; la « Facture » est retirée quoi qu'il arrive.
function listeIds(csv: string | undefined, defaut: number[]): number[] {
  const source = (csv || "")
    .split(",")
    .map((s) => enNombre(s))
    .filter((n): n is number => n !== null);
  const ids = source.length > 0 ? source : defaut;
  return ids.filter((id) => id !== METHODE_FACTURE_INTERDITE);
}

function methodesPourMode(mode: ModeTx): number[] {
  return mode === "twint" ? METHODES_TWINT : [METHODE_VIREMENT_QR];
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
// tranche 'acompte' : exactement le QR figé (50 % si « 50% » dans payment_mode,
// sinon 100 %). tranche 'solde' : total_ttc − acompte, uniquement en mode 50 %.
function montantDocument(offre: OffreDoc, tranche: TrancheTx = "acompte"): { isAcompte: boolean; montant: number; libelle: string; soldeApplicable: boolean } {
  const paymentMode = (offre.payment_mode as string) || "";
  const totalTtc = Number(offre.total_ttc);
  const isAcompte = paymentMode.includes("50%");
  const acompte = isAcompte ? Math.round(totalTtc * 0.5 * 100) / 100 : totalTtc;
  if (tranche === "solde") {
    const solde = Math.round((totalTtc - acompte) * 100) / 100;
    return { isAcompte, montant: solde, libelle: "Solde à la livraison", soldeApplicable: isAcompte };
  }
  // Libellés du bulletin QR (generateQrPageHtml)
  const libelle = isAcompte ? "Acompte 50% à la commande" : "Paiement d'avance à la commande";
  return { isAcompte, montant: acompte, libelle, soldeApplicable: isAcompte };
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
    .select(COLONNES_TX)
    .eq("commande_slug", slug)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []) as LigneTx[];
}

// La ligne la plus récente de chaque (mode, tranche) — `lignes` est déjà triée
// par created_at décroissant.
function dernieresParCle(lignes: LigneTx[]): LigneTx[] {
  const vues = new Set<string>();
  const out: LigneTx[] = [];
  for (const l of lignes) {
    const cle = `${l.mode}:${l.tranche}`;
    if (vues.has(cle)) continue;
    vues.add(cle);
    out.push(l);
  }
  return out;
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

function lireMode(v: unknown): ModeTx | null {
  const s = String(v ?? "qr").trim().toLowerCase();
  return (MODES as string[]).includes(s) ? (s as ModeTx) : null;
}
function lireTranche(v: unknown): TrancheTx | null {
  const s = String(v ?? "acompte").trim().toLowerCase();
  return (TRANCHES as string[]).includes(s) ? (s as TrancheTx) : null;
}

// ─────────────────────────────────────────────────────────────
// GET ?slug=… — état courant + URL fraîche par ligne payable
// ─────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const slug = (req.nextUrl.searchParams.get("slug") || "").trim();
    if (!slug) return NextResponse.json({ error: "Paramètre slug requis" }, { status: 400 });

    const offre = await lireCommande(slug);
    if (!offre) return NextResponse.json({ error: "Document introuvable" }, { status: 404 });
    const acompteDoc = montantDocument(offre, "acompte");
    const soldeDoc = montantDocument(offre, "solde");

    // ─── Variante : le PDF « Facture » de Wallee (QR-facture) ───
    if ((req.nextUrl.searchParams.get("document") || "") === "facture") {
      const tranche = lireTranche(req.nextUrl.searchParams.get("tranche"));
      if (!tranche) return NextResponse.json({ error: "tranche invalide" }, { status: 400 });
      const w = serviceWallee();
      if (!w) return NextResponse.json({ error: "Configuration Wallee incomplète" }, { status: 500 });
      const ligne = (await lignesDuSlug(slug)).find(
        (t) => t.mode === "qr" && t.tranche === tranche && ETATS_FACTURE.has(t.state)
      );
      if (!ligne) return NextResponse.json({ error: "Aucune QR-facture Wallee pour cette tranche" }, { status: 404 });
      const doc = await w.service.getPaymentTransactionsIdInvoiceDocument({ id: ligne.wallee_transaction_id, space: w.spaceId });
      if (!doc?.data) return NextResponse.json({ error: "Wallee n'a pas (encore) de facture pour cette transaction" }, { status: 404 });
      const pdf = Buffer.from(doc.data, "base64");
      const nom = `QR-facture_${ligne.merchant_reference}_${tranche}_${ligne.wallee_transaction_id}.pdf`;
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
    const urls: Record<string, string | null> = {};

    const w = serviceWallee();
    if (w && lignes.length > 0) {
      // Relecture de l'état chez Wallee (la source fait foi) pour la dernière
      // ligne de chaque (mode, tranche) qui n'est pas terminale.
      let relu = false;
      for (const l of dernieresParCle(lignes)) {
        if (ETATS_TERMINAUX.has(l.state)) continue;
        try {
          const tx = await w.service.getPaymentTransactionsId({ id: l.wallee_transaction_id, space: w.spaceId });
          const etat = String(tx.state ?? l.state).toUpperCase();
          const { error } = await supabaseAdmin
            .from("transactions_wallee")
            .update({ state: etat, state_checked_at: new Date().toISOString(), updated_at: new Date().toISOString(), raw: extraitTx(tx) })
            .eq("id", l.id);
          if (error) console.error("transactions_wallee update error:", error);
          relu = true;
        } catch (err) {
          console.error("wallee getPaymentTransactionsId error:", err);
        }
      }
      if (relu) lignes = await lignesDuSlug(slug);
      // URL fraîche pour chaque ligne courante encore payable.
      for (const l of dernieresParCle(lignes)) {
        if (ETATS_PAYABLES.has(l.state)) {
          urls[l.id] = await urlPage(w.service, w.spaceId, l.wallee_transaction_id);
        }
      }
    }

    return NextResponse.json({
      transactions: lignes.map((l) => ({ ...l, payment_page_url: urls[l.id] ?? null })),
      count: lignes.length,
      montant_document: acompteDoc.montant,
      montant_acompte: acompteDoc.montant,
      montant_solde: soldeDoc.soldeApplicable ? soldeDoc.montant : null,
      solde_applicable: soldeDoc.soldeApplicable,
      wallee_configure: Boolean(w),
    });
  } catch (err) {
    console.error("wallee-transactions GET error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────
// POST { slug, mode?, tranche?, force? } — création de la transaction
// ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { slug?: string; mode?: string; tranche?: string; force?: boolean };
    const slug = (body.slug || "").trim();
    const force = body.force === true;
    if (!slug) return NextResponse.json({ error: "slug requis" }, { status: 400 });
    const mode = lireMode(body.mode);
    const tranche = lireTranche(body.tranche);
    if (!mode) return NextResponse.json({ error: "mode invalide (qr | twint)" }, { status: 400 });
    if (!tranche) return NextResponse.json({ error: "tranche invalide (acompte | solde)" }, { status: 400 });

    const w = serviceWallee();
    if (!w) return NextResponse.json({ error: "Configuration Wallee incomplète" }, { status: 500 });

    const offre = await lireCommande(slug);
    if (!offre) return NextResponse.json({ error: "Document introuvable" }, { status: 404 });
    if (offre.type_document !== "Commande") {
      return NextResponse.json({ error: "Un lien de paiement Wallee ne se crée que sur une commande" }, { status: 409 });
    }
    const numero = String(offre.numero_affiche || "").trim();
    if (!numero) return NextResponse.json({ error: "Numéro de commande manquant" }, { status: 409 });

    const { isAcompte, montant, libelle, soldeApplicable } = montantDocument(offre, tranche);
    if (tranche === "solde" && !soldeApplicable) {
      return NextResponse.json({ error: "Pas de solde : ce document est réglé en totalité à la commande" }, { status: 409 });
    }
    if (!Number.isFinite(montant) || montant <= 0) {
      return NextResponse.json({ error: "Montant invalide" }, { status: 400 });
    }

    // Une seule transaction vivante par (mode, tranche) : on ne recrée que sur
    // échec terminal (expirée / annulée / refusée), ou explicitement avec force.
    const existantes = await lignesDuSlug(slug);
    const vivante = existantes.find((t) => t.mode === mode && t.tranche === tranche && !ETATS_ECHEC.has(t.state));
    if (vivante && !force) {
      return NextResponse.json(
        { error: `Une transaction Wallee ${mode}/${tranche} existe déjà (${vivante.wallee_transaction_id}, état ${vivante.state})`, transaction: vivante },
        { status: 409 }
      );
    }

    const deb = debiteurDocument(offre);
    const email = typeof offre.client_email === "string" ? offre.client_email.trim() : "";
    // D17 : « sans-email.… » est une adresse GÉNÉRÉE — ne jamais y écrire, ne jamais la transmettre.
    const emailClient = email && !email.toLowerCase().startsWith("sans-email.") ? email : undefined;

    const methodes = methodesPourMode(mode);
    if (methodes.length === 0 || methodes.includes(METHODE_FACTURE_INTERDITE)) {
      return NextResponse.json({ error: "Liste de moyens de paiement invalide" }, { status: 500 });
    }

    const creation: TransactionCreate = {
      currency: "CHF",
      language: "fr-CH",
      merchantReference: numero,
      invoiceMerchantReference: numero,
      allowedPaymentMethodConfigurations: methodes,
      emailsDisabled: true,
      customerEmailAddress: emailClient,
      // Page de confirmation de commande (deux boutons : PDF + QR paiement).
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
          uniqueId: `${numero}-${tranche}`,
          name: `${libelle} — ${numero}`,
          quantity: 1,
          amountIncludingTax: montant,
          // TVA INCLUSE dans le montant (total_ttc du document) : sans cette ligne,
          // la facture Wallee affichait « 0 % » et « TOTAL HT » = TTC (vu le 04.09).
          // Wallee calcule la part de TVA à partir du taux ; le montant ne change pas.
          taxes: new Set([{ rate: TAUX_TVA, title: "TVA" }]),
          type: LineItemType.Product,
          shippingRequired: false,
        },
      ],
      metaData: { slug, numero_affiche: numero, source: "dashboard", mode, tranche },
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
        mode,
        tranche,
      })
      .select(COLONNES_TX)
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
      transaction: { ...(ligne as LigneTx), payment_page_url: paymentPageUrl },
      payment_page_url: paymentPageUrl,
      montant,
      isAcompte,
      mode,
      tranche,
    });
  } catch (err) {
    console.error("wallee-transactions POST error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
