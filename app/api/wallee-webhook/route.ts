// app/api/wallee-webhook/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// Chantier « Acompte payé visible » (Wallee), 03.09.2026.
//
// POST PUBLIC (ouvert dans proxy.ts), appelé par Make — simple tuyau — qui
// relaie le webhook Wallee (Space 48617, listener « Make acomptes FULFILL »).
//
// Le payload Wallee ne porte NI la référence NI le montant : seulement
// { entityId, state, spaceId, … }. On relit donc la transaction via le SDK
// `wallee` pour obtenir merchantReference (= numero_affiche, ex. CMD-80923)
// et le montant, puis on écrit UNE ligne dans acomptes_wallee.
//
// Règles :
//  - Le badge ne s'allume QUE sur l'état FULFILL (« Livrer ») : c'est le seul
//    état où l'argent est réconcilié. AUTHORIZED / COMPLETED affichent des ✓
//    verts dans le portail mais l'argent n'est PAS arrivé → ignorés, en 200
//    pour que Make ne réessaie pas. Le filtre est appliqué deux fois : sur le
//    payload, puis sur la transaction relue (on ne fait confiance qu'à la
//    source). Troisième filtre depuis le 04.09.2026 : un FULFILL obtenu via le
//    connecteur « QR-Facture » (paiement sur facture) n'est PAS un encaissement
//    et est ignoré — voir l'étape 4 bis.
//  - Idempotence : upsert sur wallee_transaction_id (UNIQUE). Un même FULFILL
//    renvoyé deux fois n'écrit qu'une ligne.
//  - N'écrit JAMAIS dans offres. Aucune logique métier dans Make.
//  - Auth serveur→serveur : `Authorization: Bearer $WALLEE_WEBHOOK_SECRET`,
//    même convention que /api/thunderai/* et /api/cron/*.
//
// Env Vercel : WALLEE_WEBHOOK_SECRET, WALLEE_SPACE_ID (48617),
//              WALLEE_USER_ID (172773), WALLEE_AUTH_KEY (clé base64 telle que
//              rendue par Wallee — le SDK la décode lui-même).
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { DefaultConfig, HttpBearerAuth, TransactionsService } from "wallee";

type PayloadMake = {
  entityId?: number | string;
  state?: string;
  spaceId?: number | string;
  [k: string]: unknown;
};

function enNombre(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(String(v ?? "").trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Résout le slug du document depuis le numéro affiché. Un acompte porte un
// CMD-… ; s'il y avait plusieurs candidats (cas connu sur les DEV-…), on
// préfère la commande, puis le plus récent. Rend null si rien ne matche —
// la ligne s'écrit quand même : le badge lit par merchant_reference, pas par slug.
async function resoudreSlug(reference: string): Promise<string | null> {
  const ref = reference.trim();
  if (!ref) return null;
  const { data, error } = await supabaseAdmin
    .from("offres")
    .select("slug, type_document, created_at")
    .ilike("numero_affiche", ref)
    .order("created_at", { ascending: false })
    .limit(5);
  if (error || !data || data.length === 0) return null;
  const commande = data.find((d) => d.type_document === "Commande");
  return (commande ?? data[0]).slug ?? null;
}

export async function POST(req: NextRequest) {
  // ─── 1. Secret partagé ───
  const secret = process.env.WALLEE_WEBHOOK_SECRET;
  const enTete = req.headers.get("authorization");
  if (!secret || enTete !== "Bearer " + secret) {
    // Message distinct de celui du proxy : un 401 « Accès non autorisé » vient du
    // verrou (route pas ouverte), celui-ci vient de la route (secret absent/faux).
    return NextResponse.json({ error: "Secret webhook absent ou invalide" }, { status: 401 });
  }

  try {
    // ─── 2. Payload (Make peut envoyer l'objet, ou le tableau brut de Wallee) ───
    const brut = (await req.json().catch(() => null)) as PayloadMake | PayloadMake[] | null;
    const body: PayloadMake | null = Array.isArray(brut) ? (brut[0] ?? null) : brut;
    if (!body) {
      return NextResponse.json({ error: "Corps JSON attendu" }, { status: 400 });
    }

    const entityId = enNombre(body.entityId);
    const state = String(body.state ?? "").trim().toUpperCase();
    const spaceIdRecu = enNombre(body.spaceId);
    if (!entityId) {
      return NextResponse.json({ error: "entityId manquant" }, { status: 400 });
    }

    const spaceId = enNombre(process.env.WALLEE_SPACE_ID);
    const userId = enNombre(process.env.WALLEE_USER_ID);
    const authKey = process.env.WALLEE_AUTH_KEY || "";
    if (!spaceId || !userId || !authKey) {
      return NextResponse.json({ error: "Configuration Wallee incomplète" }, { status: 500 });
    }

    // Un autre space (test) : on ignore, en 200.
    if (spaceIdRecu && spaceIdRecu !== spaceId) {
      return NextResponse.json({ success: true, ignored: `space ${spaceIdRecu}` });
    }

    // ─── 3. Filtre FULFILL, premier niveau (payload) ───
    if (state !== "FULFILL") {
      return NextResponse.json({ success: true, ignored: state || "(sans state)" });
    }

    // ─── 4. Relecture de la transaction chez Wallee ───
    DefaultConfig.httpBearerAuth = new HttpBearerAuth(userId, authKey);
    const service = new TransactionsService(DefaultConfig);
    // ⚠️ L'API 5.x ne renvoie les objets liés QUE si on les demande (`expand`) :
    // sans lui, paymentConnectorConfiguration est vide et le filtre 4 bis ne voit
    // rien — c'est ce qui a laissé passer le rejeu du 04.09 au soir.
    const tx = await service.getPaymentTransactionsId({
      id: entityId,
      space: spaceId,
      expand: new Set(["paymentConnectorConfiguration"]),
    });

    // Second niveau : la source fait foi.
    const etatWallee = String(tx.state ?? "").toUpperCase();
    if (etatWallee !== "FULFILL") {
      return NextResponse.json({ success: true, ignored: `wallee:${etatWallee || "?"}` });
    }

    // ─── 4 bis. Troisième niveau : FULFILL n'atteste un encaissement QUE pour un
    // moyen de paiement réel. Le connecteur « QR-Facture (PostFinance) » (paiement
    // sur facture, après livraison) passe la transaction en FULFILL DÈS QUE le
    // client choisit « Facture » — sans qu'un centime soit arrivé. Vécu le
    // 04.09.2026 sur CMD-80953 : badge « Acompte reçu » allumé à tort.
    // Le virement QR, lui, reste en COMPLETED jusqu'au rapprochement bancaire ;
    // carte / TWINT / PayPal ne passent en FULFILL qu'après autorisation réelle.
    const connecteur = tx.paymentConnectorConfiguration;
    const nomConnecteur = String(connecteur?.name ?? "");
    const nomMethode = String(connecteur?.paymentMethodConfiguration?.name ?? "");
    const methodeId = connecteur?.paymentMethodConfiguration?.id ?? null;
    const estFactureSansPaiement =
      /QR-Facture/i.test(nomConnecteur) || /^Facture$/i.test(nomMethode.trim());
    if (estFactureSansPaiement) {
      console.warn("wallee-webhook: FULFILL sur facture sans paiement ignoré", {
        entityId, connecteur: nomConnecteur, methode: nomMethode, methodeId,
      });
      return NextResponse.json({ success: true, ignored: `facture-sans-paiement:${methodeId ?? "?"}` });
    }

    const merchantReference = (tx.merchantReference ?? "").trim();

    // ─── 4 ter. Filet de sécurité, indépendant de `expand` ───
    // Une transaction de l'APP (référence CMD-/DEV-) porte toujours une liste
    // explicite de moyens autorisés depuis le hotfix du 04.09 (virement QR seul).
    // Si le connecteur n'est pas lisible ET que la transaction est ouverte à tous
    // les moyens, on ne peut pas savoir si le FULFILL vient d'une facture : on
    // s'abstient, en 200 — mieux vaut un badge en retard qu'un badge menteur.
    const estReferenceApp = /^(CMD|DEV)-/i.test(merchantReference);
    const moyensAutorises = tx.allowedPaymentMethodConfigurations ?? [];
    if (estReferenceApp && !nomConnecteur && moyensAutorises.length === 0) {
      console.warn("wallee-webhook: FULFILL sans connecteur lisible sur transaction ouverte à tous les moyens — ignoré", { entityId, merchantReference });
      return NextResponse.json({ success: true, ignored: "connecteur-inconnu-tous-moyens" });
    }
    const montant = tx.completedAmount ?? tx.authorizationAmount ?? null;
    const devise = tx.currency ?? "CHF";
    const paidAt =
      (tx.completedOn instanceof Date ? tx.completedOn.toISOString() : null) ??
      (typeof body.timestamp === "string" ? body.timestamp : null) ??
      new Date().toISOString();

    const commandeSlug = merchantReference ? await resoudreSlug(merchantReference) : null;

    // ─── 5. Upsert idempotent ───
    const { error } = await supabaseAdmin
      .from("acomptes_wallee")
      .upsert(
        {
          wallee_transaction_id: entityId,
          merchant_reference: merchantReference || null,
          montant,
          devise,
          state: "FULFILL",
          commande_slug: commandeSlug,
          paid_at: paidAt,
          raw: {
            webhook: body,
            transaction: {
              id: tx.id ?? entityId,
              state: tx.state ?? null,
              merchantReference: tx.merchantReference ?? null,
              completedAmount: tx.completedAmount ?? null,
              authorizationAmount: tx.authorizationAmount ?? null,
              currency: tx.currency ?? null,
              completedOn: tx.completedOn ?? null,
              customerEmailAddress: tx.customerEmailAddress ?? null,
              connecteur: nomConnecteur || null,
              methode: nomMethode || null,
              methodeId,
              allowedPaymentMethodConfigurations: moyensAutorises,
            },
          },
        },
        { onConflict: "wallee_transaction_id" }
      );

    if (error) {
      console.error("acomptes_wallee upsert error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      wallee_transaction_id: entityId,
      merchant_reference: merchantReference || null,
      montant,
      commande_slug: commandeSlug,
    });
  } catch (err) {
    console.error("wallee-webhook POST error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
