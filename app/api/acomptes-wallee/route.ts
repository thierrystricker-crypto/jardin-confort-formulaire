// app/api/acomptes-wallee/route.ts
// GET ?numero=CMD-80923 : les acomptes réconciliés par Wallee pour ce document,
// lus dans acomptes_wallee par merchant_reference (= numero_affiche).
// Alimente le badge « ✅ Acompte reçu » de la fiche commande. Lecture seule ;
// n'écrit jamais, ne touche pas offres.
//
// v2 (05.09.2026) : chaque ligne est enrichie de `mode` et `tranche` relus dans
// transactions_wallee (table sœur, jointure par wallee_transaction_id) pour que
// le badge distingue « Acompte reçu » et « Solde reçu ». Un paiement dont la
// transaction n'est pas connue de l'app (commande webshop passée par le même
// space) garde mode/tranche = null : le badge reste « Paiement reçu ».
//
// Route INTERNE : protégée par le verrou proxy.ts (cookie jc_acces). Le
// navigateur ne parle jamais à Supabase directement (RLS sans policy sur la
// table : seul le service_role y accède).
// Chantier « Acompte payé visible » (Wallee), 03.09.2026.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  try {
    const numero = (req.nextUrl.searchParams.get("numero") || "").trim();
    if (!numero) {
      return NextResponse.json({ error: "Paramètre numero requis" }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("acomptes_wallee")
      .select("id, wallee_transaction_id, merchant_reference, montant, devise, state, commande_slug, paid_at, created_at")
      .ilike("merchant_reference", numero)
      .eq("state", "FULFILL")
      .order("paid_at", { ascending: false });

    if (error) {
      console.error("acomptes_wallee select error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const acomptes = (data || []) as Array<Record<string, unknown> & { wallee_transaction_id: number }>;
    const ids = acomptes.map((a) => a.wallee_transaction_id).filter((n) => Number.isFinite(n));
    const qualif = new Map<number, { mode: string; tranche: string }>();
    if (ids.length > 0) {
      const { data: txs, error: txError } = await supabaseAdmin
        .from("transactions_wallee")
        .select("wallee_transaction_id, mode, tranche")
        .in("wallee_transaction_id", ids);
      if (txError) {
        // Non bloquant : le badge s'affiche sans distinction acompte/solde.
        console.error("transactions_wallee select error:", txError);
      } else {
        for (const t of (txs || []) as Array<{ wallee_transaction_id: number; mode: string; tranche: string }>) {
          qualif.set(t.wallee_transaction_id, { mode: t.mode, tranche: t.tranche });
        }
      }
    }

    return NextResponse.json({
      acomptes: acomptes.map((a) => ({
        ...a,
        mode: qualif.get(a.wallee_transaction_id)?.mode ?? null,
        tranche: qualif.get(a.wallee_transaction_id)?.tranche ?? null,
      })),
    });
  } catch (err) {
    console.error("acomptes-wallee GET error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
