// app/api/saferpay-transactions/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// Chantier « Lien carte Saferpay » (02.11.2026). Jumeau de
// /api/wallee-transactions, pour le prestataire CARTE.
//
// Répartition des moyens de paiement (décision du 02.11.2026) :
//   Saferpay → carte Visa/MasterCard, TWINT, Apple Pay, Google Pay (1,7 %)
//   Wallee   → QR-facture, PostFinance Pay / e-finance / Carte PostFinance, PayPal
//
// Route INTERNE (cookie jc_acces via proxy.ts — rien n'a été ouvert).
//
//   POST { slug, tranche?, force? } : crée un lien de paiement Secure PayGate
//        pour une COMMANDE, l'enregistre dans transactions_saferpay, renvoie la
//        ligne avec son `payment_link`. Le lien est STOCKÉ (stable jusqu'à son
//        expiration) : c'est celui que le vendeur copie et envoie au client.
//   GET  ?slug=cmd-… : les lignes du document, après relecture du statut chez
//        Saferpay pour celles encore `OPEN`.
//
// Règles :
//  - COMMANDES VALIDÉES UNIQUEMENT. Jamais une offre, jamais un brouillon :
//    seule une commande est en attente de paiement (règle métier, 02.11.2026).
//    Double verrou : `isCommandeReelle` côté fiche, 409 ici.
//  - Montant et débiteur REPRODUITS À L'IDENTIQUE de app/api/offres/[slug]/qr
//    (sanctuarisé, non touché) et de la route Wallee : même règle 50 % / 100 %,
//    mêmes champs, mêmes replis. Duplication licite, comme qr-libre.
//    Pas de montant à la volée en phase 1 — ce sera une page jumelle de
//    /dashboard/qr-libre, dans un second temps.
//  - `Payment.OrderId` = numero_affiche : clé de rattachement, ressortie telle
//    quelle sur la page de confirmation Saferpay (prouvé le 02.11, CMD-TEST-001).
//  - Une seule offre `OPEN` par (commande, tranche) — sinon 409, sauf `force`.
//  - `Payer.BillingAddress` est obligatoire côté Saferpay : on refuse proprement
//    avant l'appel si l'adresse est incomplète, plutôt que de laisser remonter
//    une erreur Saferpay illisible.
//  - N'écrit JAMAIS dans `offres` ni dans `acomptes_wallee`. Aucun impact stock.
//  - 🔒 Aucune donnée de carte ne transite ici : on ne fait que créer un lien.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { configSaferpay, creerLienPaiement, lireLienPaiement } from "@/lib/saferpay";
import type { StatutSaferpay } from "@/lib/saferpay";

// Validité du lien envoyé au client. Saferpay impose entre 1 h et 6 mois.
const JOURS_VALIDITE = Number(process.env.SAFERPAY_JOURS_VALIDITE || 30);
// Valeurs admises par Saferpay : 0 (illimité), 1, 3, 5, 10.
const MAX_TENTATIVES = 5 as const;

const STATUTS_TERMINAUX = new Set<StatutSaferpay>(["PAID", "EXPIRED", "DISABLED"]);

type Tranche = "acompte" | "solde";
const TRANCHES: Tranche[] = ["acompte", "solde"];

type OffreDoc = Record<string, unknown>;

type LigneSaferpay = {
  id: string;
  offer_id: string;
  commande_slug: string;
  merchant_reference: string;
  montant: number | string;
  devise: string;
  tranche: Tranche;
  libelle: string | null;
  statut: StatutSaferpay;
  transaction_id: string | null;
  payment_link: string;
  expiration_date: string | null;
  paid_at: string | null;
  statut_checked_at: string | null;
  environnement: string;
  created_at: string;
};

const COLONNES =
  "id, offer_id, commande_slug, merchant_reference, montant, devise, tranche, libelle, statut, transaction_id, payment_link, expiration_date, paid_at, statut_checked_at, environnement, created_at";

function lireTranche(v: unknown): Tranche | null {
  const s = String(v ?? "acompte").trim().toLowerCase();
  return (TRANCHES as string[]).includes(s) ? (s as Tranche) : null;
}

// ─── Montant : copie conforme de api/offres/[slug]/qr et de la route Wallee ───
function montantDocument(offre: OffreDoc, tranche: Tranche) {
  const paymentMode = (offre.payment_mode as string) || "";
  const totalTtc = Number(offre.total_ttc);
  const isAcompte = paymentMode.includes("50%");
  const acompte = isAcompte ? Math.round(totalTtc * 0.5 * 100) / 100 : totalTtc;
  if (tranche === "solde") {
    const solde = Math.round((totalTtc - acompte) * 100) / 100;
    return { isAcompte, montant: solde, libelle: "Solde à la livraison", soldeApplicable: isAcompte };
  }
  const libelle = isAcompte ? "Acompte 50% à la commande" : "Paiement d'avance à la commande";
  return { isAcompte, montant: acompte, libelle, soldeApplicable: isAcompte };
}

// ─── Débiteur : mêmes champs et mêmes replis que le QR et que Wallee ───
// Saferpay a un champ `Street` unique : rue et numéro y sont assemblés, comme
// dans le bulletin HTML du QR ([rue, numero].filter(Boolean)).
function debiteurDocument(offre: OffreDoc) {
  const d = (offre.data as Record<string, unknown>) || {};
  const societe = ((offre.client_societe as string) || "").trim();
  const prenom = typeof offre.client_prenom === "string" ? offre.client_prenom.trim() : "";
  const nom = typeof offre.client_nom === "string" ? offre.client_nom.trim() : "";
  const numero = (typeof d.numero === "string" ? d.numero.trim() : "").slice(0, 16);
  const rue = ((offre.client_rue as string) || "").trim().slice(0, 70);
  return {
    societe,
    prenom,
    nom,
    street: [rue, numero].filter(Boolean).join(" "),
    postcode: ((offre.client_npa as string) || "").trim().slice(0, 16),
    city: ((offre.client_ville as string) || "").trim().slice(0, 35),
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

async function lignesDuSlug(slug: string): Promise<LigneSaferpay[]> {
  const { data, error } = await supabaseAdmin
    .from("transactions_saferpay")
    .select(COLONNES)
    .eq("commande_slug", slug)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []) as LigneSaferpay[];
}

// La ligne la plus récente de chaque tranche (la liste est déjà triée).
function dernieresParTranche(lignes: LigneSaferpay[]): LigneSaferpay[] {
  const vues = new Set<string>();
  const out: LigneSaferpay[] = [];
  for (const l of lignes) {
    if (vues.has(l.tranche)) continue;
    vues.add(l.tranche);
    out.push(l);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// GET ?slug=… — lignes + relecture des statuts non terminaux
// ─────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const slug = (req.nextUrl.searchParams.get("slug") || "").trim();
    if (!slug) return NextResponse.json({ error: "Paramètre slug requis" }, { status: 400 });

    const offre = await lireCommande(slug);
    if (!offre) return NextResponse.json({ error: "Document introuvable" }, { status: 404 });

    const acompte = montantDocument(offre, "acompte");
    const solde = montantDocument(offre, "solde");
    const cfg = configSaferpay();

    let lignes = await lignesDuSlug(slug);

    if (cfg && lignes.length > 0) {
      let relu = false;
      for (const l of dernieresParTranche(lignes)) {
        if (STATUTS_TERMINAUX.has(l.statut)) continue;
        try {
          const o = await lireLienPaiement(cfg, l.offer_id);
          const statut = (o.Status || l.statut) as StatutSaferpay;
          const maintenant = new Date().toISOString();
          const { error } = await supabaseAdmin
            .from("transactions_saferpay")
            .update({
              statut,
              transaction_id: o.TransactionId ?? l.transaction_id,
              // paid_at n'est posé qu'une fois, au passage à PAID.
              paid_at: statut === "PAID" ? (l.paid_at ?? maintenant) : l.paid_at,
              statut_checked_at: maintenant,
              updated_at: maintenant,
              raw: o as unknown as Record<string, unknown>,
            })
            .eq("id", l.id);
          if (error) console.error("transactions_saferpay update error:", error);
          relu = true;
        } catch (err) {
          console.error("saferpay lireLienPaiement error:", err);
        }
      }
      if (relu) lignes = await lignesDuSlug(slug);
    }

    return NextResponse.json({
      transactions: lignes,
      count: lignes.length,
      montant_acompte: acompte.montant,
      montant_solde: solde.soldeApplicable ? solde.montant : null,
      solde_applicable: solde.soldeApplicable,
      est_commande: offre.type_document === "Commande",
      saferpay_configure: Boolean(cfg),
      environnement: cfg?.environnement ?? null,
    });
  } catch (err) {
    console.error("saferpay-transactions GET error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────
// POST { slug, tranche?, force? } — création du lien
// ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { slug?: string; tranche?: string; force?: boolean };
    const slug = (body.slug || "").trim();
    const force = body.force === true;
    if (!slug) return NextResponse.json({ error: "slug requis" }, { status: 400 });
    const tranche = lireTranche(body.tranche);
    if (!tranche) return NextResponse.json({ error: "tranche invalide (acompte | solde)" }, { status: 400 });

    const cfg = configSaferpay();
    if (!cfg) return NextResponse.json({ error: "Configuration Saferpay incomplète" }, { status: 500 });

    const offre = await lireCommande(slug);
    if (!offre) return NextResponse.json({ error: "Document introuvable" }, { status: 404 });
    // Seules les commandes validées sont en attente de paiement.
    if (offre.type_document !== "Commande") {
      return NextResponse.json({ error: "Un lien de paiement ne se crée que sur une commande" }, { status: 409 });
    }
    const numero = String(offre.numero_affiche || "").trim();
    if (!numero) return NextResponse.json({ error: "Numéro de commande manquant" }, { status: 409 });

    const { montant, libelle, soldeApplicable } = montantDocument(offre, tranche);
    if (tranche === "solde" && !soldeApplicable) {
      return NextResponse.json({ error: "Pas de solde : ce document est réglé en totalité à la commande" }, { status: 409 });
    }
    if (!Number.isFinite(montant) || montant <= 0) {
      return NextResponse.json({ error: "Montant invalide" }, { status: 400 });
    }

    // Une seule offre vivante par tranche.
    const existantes = await lignesDuSlug(slug);
    const vivante = existantes.find((t) => t.tranche === tranche && t.statut === "OPEN");
    if (vivante && !force) {
      return NextResponse.json(
        { error: `Un lien carte ${tranche} est déjà ouvert pour cette commande`, transaction: vivante },
        { status: 409 }
      );
    }
    const payee = existantes.find((t) => t.tranche === tranche && t.statut === "PAID");
    if (payee) {
      return NextResponse.json(
        { error: `Cette tranche a déjà été payée par carte le ${payee.paid_at ?? "?"}`, transaction: payee },
        { status: 409 }
      );
    }

    // BillingAddress obligatoire côté Saferpay : on vérifie avant l'appel pour
    // rendre un message compréhensible par le vendeur.
    const deb = debiteurDocument(offre);
    const manquants = [
      !deb.street && "rue",
      !deb.postcode && "NPA",
      !deb.city && "localité",
      !deb.societe && !deb.nom && "nom ou société",
    ].filter(Boolean);
    if (manquants.length > 0) {
      return NextResponse.json(
        { error: `Adresse de facturation incomplète (${manquants.join(", ")}) — Saferpay l'exige pour créer un lien.` },
        { status: 409 }
      );
    }

    const email = typeof offre.client_email === "string" ? offre.client_email.trim() : "";
    // D17 : « sans-email.… » est une adresse GÉNÉRÉE — ne jamais la transmettre.
    const emailClient = email && !email.toLowerCase().startsWith("sans-email.") ? email : undefined;

    const offreSaferpay = await creerLienPaiement(cfg, {
      montantChf: montant,
      devise: "CHF",
      orderId: numero,
      description: `${libelle} — ${numero}`,
      langue: "fr",
      adresse: {
        FirstName: deb.prenom || undefined,
        LastName: deb.nom || undefined,
        Company: deb.societe || undefined,
        Street: deb.street,
        Zip: deb.postcode,
        City: deb.city,
        CountryCode: "CH",
        Email: emailClient,
      },
      joursValidite: JOURS_VALIDITE,
      maxTentatives: MAX_TENTATIVES,
    });

    const maintenant = new Date().toISOString();
    const expiration = new Date(Date.now() + JOURS_VALIDITE * 86_400_000).toISOString();

    const { data: ligne, error: insertError } = await supabaseAdmin
      .from("transactions_saferpay")
      .insert({
        offer_id: offreSaferpay.OfferId,
        commande_slug: slug,
        merchant_reference: numero,
        montant,
        devise: "CHF",
        tranche,
        libelle,
        statut: "OPEN",
        payment_link: offreSaferpay.PaymentLink,
        expiration_date: expiration,
        statut_checked_at: maintenant,
        environnement: cfg.environnement,
      })
      .select(COLONNES)
      .single();

    if (insertError) {
      // Le lien existe chez Saferpay : on le rend quand même, pour qu'il ne
      // soit pas perdu, avec son OfferId pour le retrouver au Backoffice.
      console.error("transactions_saferpay insert error:", insertError);
      return NextResponse.json(
        {
          error: `Lien Saferpay créé mais non enregistré : ${insertError.message}`,
          offer_id: offreSaferpay.OfferId,
          payment_link: offreSaferpay.PaymentLink,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, transaction: ligne, montant, tranche });
  } catch (err) {
    console.error("saferpay-transactions POST error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
