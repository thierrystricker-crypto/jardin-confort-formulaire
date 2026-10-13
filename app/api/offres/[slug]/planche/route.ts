// app/api/offres/[slug]/planche/route.ts
// POST — règle la planche couleurs d'une offre ou d'une commande APRÈS COUP,
// depuis la carte « Planche couleurs » du dashboard (13.10.2026).
//
// Body : { affichage, mode, sens, corrected_by, reason }
//   affichage : "aucune" | "planche" | "planche-decor"
//
// Toute la logique vit dans la RPC regler_planche (docs/sql/034) : une seule
// transaction qui FUSIONNE les réglages dans data.moodboard (jamais data en
// bloc) et trace une ligne dans `corrections`. Elle refuse une offre signée :
// la planche se règle alors sur la commande née de la signature.
//
// Rien n'est régénéré ici : le PDF se régénère quand quelqu'un l'ouvre depuis
// le dashboard. Le PDF initial archivé d'une commande n'est jamais touché.
//
// Route INTERNE : protégée par proxy.ts (allowlist inversée), aucune entrée
// publique à ajouter.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { estAffichageMoodboard } from "@/lib/moodboard";

type Body = {
  affichage?: unknown;
  mode?: unknown;
  sens?: unknown;
  corrected_by?: unknown;
  reason?: unknown;
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const body = (await request.json().catch(() => ({}))) as Body;

    if (!estAffichageMoodboard(body.affichage)) {
      return NextResponse.json({ error: "Affichage invalide" }, { status: 400 });
    }
    const mode = body.mode === "degrade" ? "degrade" : "poids";
    const sens = body.sens === "fonce-clair" ? "fonce-clair" : "clair-fonce";
    const auteur = typeof body.corrected_by === "string" ? body.corrected_by.trim() : "";
    const raison = typeof body.reason === "string" ? body.reason.trim() : "";
    if (auteur.length < 2) {
      return NextResponse.json({ error: "Votre nom est requis (au moins 2 caractères)." }, { status: 400 });
    }
    if (raison.length < 5) {
      return NextResponse.json({ error: "Le motif est requis (au moins 5 caractères)." }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin.rpc("regler_planche", {
      p_slug: slug,
      p_affichage: body.affichage,
      p_mode: mode,
      p_sens: sens,
      p_corrected_by: auteur,
      p_reason: raison,
    });

    if (error) {
      const msg = error.message || "";
      // Les refus métier de la RPC remontent tels quels, avec un statut parlant.
      if (/offre signée/i.test(msg)) return NextResponse.json({ error: msg }, { status: 409 });
      if (/introuvable/i.test(msg)) return NextResponse.json({ error: msg }, { status: 404 });
      if (/invalide|requis|requise/i.test(msg)) return NextResponse.json({ error: msg }, { status: 400 });
      console.error("[planche] regler_planche:", msg);
      return NextResponse.json({ error: "Enregistrement impossible : " + msg }, { status: 500 });
    }

    return NextResponse.json({ success: true, ...(data as Record<string, unknown>) });
  } catch (e) {
    console.error("POST /api/offres/[slug]/planche:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
