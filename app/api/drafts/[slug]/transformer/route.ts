// app/api/drafts/[slug]/transformer/route.ts
//
// Session 5 — Transformation atomique brouillon → offre.
// Toujours en Offre (jamais directement en Commande).
// Le passage offre → commande reste géré par le flux existant
// /api/offres/save côté commande (décrémentation stock, PDF figé,
// fiche travail initiale dans le bon ordre).
//
// Architecture (approche C validée fin Session 4 → Session 5) :
// 1. La RPC SQL transformer_draft fait UNIQUEMENT les écritures critiques
//    (INSERT offre + UPDATE draft) en atomique via une transaction Postgres.
//    Garde-fous : FOR UPDATE sur le draft (pas de race condition),
//    refus 409 si déjà transformé, refus 404 si slug introuvable.
// 2. La route JS s'occupe du péri-création post-RPC : génération PDF
//    en arrière-plan via fire-and-forget (comportement identique à
//    /api/offres/save côté offre).
//
// Note : la création/lookup de fiche client (table clients) n'est PAS
// reproduite ici. Cf. décision Session 5 dans le journal : à ajuster
// plus tard dans un chantier dédié au raccrochage client.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { recopierAnnexes } from "@/lib/annexes-suivi";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;

    if (!slug) {
      return NextResponse.json(
        { error: "Slug manquant" },
        { status: 400 }
      );
    }

    // ─── Appel RPC atomique ───
    // La RPC fait : lock du draft (FOR UPDATE) → vérif transformed_at IS NULL
    // → génération numéro DEV-YYYY-XXX → INSERT offres + UPDATE drafts
    // → retour JSONB { offre_slug, offre_numero }
    const { data: result, error } = await supabaseAdmin.rpc(
      "transformer_draft",
      { p_slug: slug }
    );

    // ─── Gestion d'erreurs typées ───
    // La RPC utilise RAISE EXCEPTION avec ERRCODE :
    //   P0001 → DRAFT_NOT_FOUND
    //   P0002 → ALREADY_TRANSFORMED:<offre_slug>
    if (error) {
      const msg = error.message || "";
      console.error("transformer_draft RPC error:", { code: error.code, message: msg });

      // 404 — brouillon introuvable
      if (msg.includes("DRAFT_NOT_FOUND") || error.code === "P0001") {
        return NextResponse.json(
          { error: "DRAFT_NOT_FOUND", message: "Brouillon introuvable" },
          { status: 404 }
        );
      }

      // 409 — déjà transformé (extraction du slug de l'offre existante depuis le message)
      if (msg.includes("ALREADY_TRANSFORMED") || error.code === "P0002") {
        const match = msg.match(/ALREADY_TRANSFORMED:([^\s"']+)/);
        const existingOffreSlug = match?.[1] || null;
        return NextResponse.json(
          {
            error: "ALREADY_TRANSFORMED",
            message: "Ce brouillon a déjà été transformé",
            existingOffreSlug,
          },
          { status: 409 }
        );
      }

      // Autres erreurs SQL — 500 générique
      return NextResponse.json(
        { error: "Erreur transformation : " + msg },
        { status: 500 }
      );
    }

    if (!result || !(result as { offre_slug?: string }).offre_slug) {
      console.error("transformer_draft RPC returned no data:", result);
      return NextResponse.json(
        { error: "Réponse RPC invalide" },
        { status: 500 }
      );
    }

    const { offre_slug, offre_numero } = result as {
      offre_slug: string;
      offre_numero: string;
    };

    // ─── Génération PDF offre en arrière-plan (fire-and-forget) ───
    // Comportement identique à /api/offres/save côté Offre (ligne 215).
    // On n'attend PAS la fin : le PDF se génère pendant que l'utilisateur
    // arrive sur la page dashboard de l'offre.
    // Pas de timeout, pas de await — comme save/route.ts pour les offres.
    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      "https://jardin-confort-formulaire.vercel.app";

    fetch(`${baseUrl}/api/offres/${offre_slug}/pdf`, {
      method: "POST",
      // "x-jc-interne" : authentifie l'appel interne auprès du verrou proxy.ts
      headers: {
        "Content-Type": "application/json",
        "x-jc-interne": process.env.DASHBOARD_SESSION_SECRET || "",
      },
    }).catch((err) => {
      // Best-effort : on log mais on ne fait pas échouer la transformation
      console.error("PDF offre génération error (non bloquant):", err);
    });

    // ─── Suivi des annexes : DRA → DEV (chantier annexes, étape 4) ───
    // Recopie des lignes pieces_jointes du brouillon sur l'offre (mêmes
    // fichiers, jamais dupliqués). recopierAnnexes ne lève jamais : une
    // recopie manquée ne fait pas échouer la transformation.
    const annexes = await recopierAnnexes("draft", slug, "offre", offre_slug);

    // ─── Réponse au client ───
    // URLs relatives — robustes localhost / preview / prod (cf. fix 1fbbda3)
    return NextResponse.json({
      success: true,
      offreSlug: offre_slug,
      offreNumero: offre_numero,
      dashboardUrl: `/dashboard/${offre_slug}`,
      annexesCopiees: annexes.copiees,
    });
  } catch (err) {
    console.error("Transform draft error (catch):", err);
    return NextResponse.json(
      { error: String(err) },
      { status: 500 }
    );
  }
}