// app/api/acomptes-wallee/route.ts
// GET ?numero=CMD-80923 : les acomptes réconciliés par Wallee pour ce document,
// lus dans acomptes_wallee par merchant_reference (= numero_affiche).
// Alimente le badge « ✅ Acompte reçu » de la fiche commande. Lecture seule ;
// n'écrit jamais, ne touche pas offres.
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

    return NextResponse.json({ acomptes: data || [] });
  } catch (err) {
    console.error("acomptes-wallee GET error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
