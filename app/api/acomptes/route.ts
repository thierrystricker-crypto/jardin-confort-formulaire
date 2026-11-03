// app/api/acomptes/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// GET ?numero=CMD-80923 : TOUS les encaissements connus pour ce document,
// quelle que soit leur origine — chantier « Lien carte Saferpay », 02.11.2026.
//
// Deux sources aujourd'hui :
//   • acomptes_wallee        — paiements réconciliés par Wallee (état FULFILL),
//                              enrichis de mode/tranche via transactions_wallee
//   • transactions_saferpay  — liens carte au statut PAID
//
// 🔴 RÈGLE D'AFFICHAGE, valable pour tous les consommateurs de cette route :
// on n'affiche JAMAIS « non payé ». L'absence de ligne signifie « nous ne
// savons pas », pas « le client n'a pas payé » — un acompte réglé en espèces au
// magasin, par TWINT au comptoir ou par virement QR n'apparaît nulle part ici.
// Un vendeur qui annoncerait « vous n'avez pas payé » à un client qui a payé
// serait pire que pas d'information du tout. (La saisie manuelle d'un
// encaissement, qui rendra cette vue exhaustive, est le chantier suivant.)
//
// Route INTERNE : protégée par proxy.ts (cookie jc_acces). Lecture seule.
// L'ancienne route /api/acomptes-wallee reste en place et inchangée.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export type Encaissement = {
  id: string;
  source: "wallee" | "saferpay";
  moyen: string;            // libellé lisible : « virement QR », « carte »…
  tranche: string | null;   // 'acompte' | 'solde' | null si inconnu
  montant: number | string | null;
  devise: string | null;
  paid_at: string | null;
  reference: string | null;
};

function nomMoyenWallee(mode: string | null): string {
  if (mode === "qr") return "virement QR";
  if (mode === "postfinance") return "PostFinance / PayPal";
  return "moyen inconnu de l'app";
}

export async function GET(req: NextRequest) {
  try {
    const numero = (req.nextUrl.searchParams.get("numero") || "").trim();
    if (!numero) return NextResponse.json({ error: "Paramètre numero requis" }, { status: 400 });

    const encaissements: Encaissement[] = [];

    // ─── Source 1 : Wallee (FULFILL) ───
    const { data: wallee, error: errWallee } = await supabaseAdmin
      .from("acomptes_wallee")
      .select("id, wallee_transaction_id, merchant_reference, montant, devise, state, paid_at")
      .ilike("merchant_reference", numero)
      .eq("state", "FULFILL")
      .order("paid_at", { ascending: false });
    if (errWallee) console.error("acomptes_wallee select error:", errWallee);

    const lignesWallee = (wallee || []) as Array<{
      id: string; wallee_transaction_id: number; merchant_reference: string | null;
      montant: number | string | null; devise: string | null; paid_at: string | null;
    }>;

    // Qualification mode/tranche depuis la table sœur, quand la transaction
    // est connue de l'app (une ligne venue du webshop ne le sera pas).
    const ids = lignesWallee.map((a) => a.wallee_transaction_id).filter((n) => Number.isFinite(n));
    const qualif = new Map<number, { mode: string; tranche: string }>();
    if (ids.length > 0) {
      const { data: txs, error: errTx } = await supabaseAdmin
        .from("transactions_wallee")
        .select("wallee_transaction_id, mode, tranche")
        .in("wallee_transaction_id", ids);
      if (errTx) console.error("transactions_wallee select error:", errTx);
      for (const t of (txs || []) as Array<{ wallee_transaction_id: number; mode: string; tranche: string }>) {
        qualif.set(t.wallee_transaction_id, { mode: t.mode, tranche: t.tranche });
      }
    }

    for (const a of lignesWallee) {
      const q = qualif.get(a.wallee_transaction_id);
      encaissements.push({
        id: a.id,
        source: "wallee",
        moyen: nomMoyenWallee(q?.mode ?? null),
        tranche: q?.tranche ?? null,
        montant: a.montant,
        devise: a.devise,
        paid_at: a.paid_at,
        reference: String(a.wallee_transaction_id),
      });
    }

    // ─── Source 2 : Saferpay (PAID) ───
    const { data: saferpay, error: errSp } = await supabaseAdmin
      .from("transactions_saferpay")
      .select("id, merchant_reference, montant, devise, tranche, statut, paid_at, transaction_id")
      .ilike("merchant_reference", numero)
      .eq("statut", "PAID")
      .order("paid_at", { ascending: false });
    if (errSp) console.error("transactions_saferpay select error:", errSp);

    for (const s of (saferpay || []) as Array<{
      id: string; montant: number | string | null; devise: string | null;
      tranche: string | null; paid_at: string | null; transaction_id: string | null;
    }>) {
      encaissements.push({
        id: s.id,
        source: "saferpay",
        moyen: "carte",
        tranche: s.tranche,
        montant: s.montant,
        devise: s.devise,
        paid_at: s.paid_at,
        reference: s.transaction_id,
      });
    }

    encaissements.sort((a, b) => String(b.paid_at ?? "").localeCompare(String(a.paid_at ?? "")));

    return NextResponse.json({ encaissements });
  } catch (err) {
    console.error("acomptes GET error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
