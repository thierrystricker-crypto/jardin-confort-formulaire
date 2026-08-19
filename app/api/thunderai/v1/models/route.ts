// app/api/thunderai/v1/models/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// Liste des « modèles » pour la façade ThunderAI (19.08.2026).
//
// ThunderAI appelle GET {host}/v1/models pour remplir sa liste déroulante
// (bouton « rafraîchir la liste » des options). Un seul modèle est exposé :
// « jardi ». Le vrai modèle Anthropic reste choisi côté serveur
// (env CLAUDE_CHAT_MODEL) — les postes n'ont pas à le connaître.
//
// Même contrôle d'accès que la route de chat : Bearer $THUNDERAI_SECRET.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  const secret = process.env.THUNDERAI_SECRET;
  const enTete = req.headers.get("authorization");
  if (!secret || enTete !== "Bearer " + secret) {
    return NextResponse.json(
      { error: { message: "Accès non autorisé.", type: "invalid_request_error" } },
      { status: 401 }
    );
  }

  return NextResponse.json({
    object: "list",
    data: [{ id: "jardi", object: "model", created: 0, owned_by: "jardin-confort" }],
  });
}
