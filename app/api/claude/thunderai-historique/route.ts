// app/api/claude/thunderai-historique/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// Consultation de l'historique des échanges ThunderAI (19.08.2026).
// Table `thunderai_echanges` — alimentée par la façade
// (app/api/thunderai/v1/chat/completions/route.ts), purge auto 60 jours.
//
// Route INTERNE : volontairement placée sous /api/claude/ (protégée par
// proxy.ts + cookie de session), et PAS sous /api/thunderai/ qui est la zone
// sans cookie réservée à l'extension.
//
// GET /api/claude/thunderai-historique          → les 100 derniers échanges
// GET /api/claude/thunderai-historique?q=fermob → filtre plein texte simple
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

function sessionValide(req: NextRequest): boolean {
  const secret = process.env.DASHBOARD_SESSION_SECRET;
  const cookie = req.cookies.get("jc_acces")?.value;
  return Boolean(secret && cookie === secret);
}

export async function GET(req: NextRequest) {
  if (!sessionValide(req)) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 401 });
  }

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 200);

  let requete = supabaseAdmin
    .from("thunderai_echanges")
    .select("id, cree_le, question, reponse")
    .order("cree_le", { ascending: false })
    .limit(100);

  if (q) {
    // Filtre simple : la question OU la réponse contient le terme.
    // (Échappement des jokers PostgREST : % et _ sont neutralisés.)
    const motif = "%" + q.replace(/[%_]/g, "\\$&") + "%";
    requete = requete.or(`question.ilike.${motif},reponse.ilike.${motif}`);
  }

  const { data, error } = await requete;
  if (error) {
    console.error("thunderai_echanges GET :", error);
    return NextResponse.json({ error: "Erreur base de données" }, { status: 500 });
  }
  return NextResponse.json({ echanges: data ?? [] });
}
