// app/api/acces/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// Verrou d'accès provisoire (couche 1) — vérification du code partagé.
//
// POST   : vérifie le code et pose le cookie de session (HttpOnly, 30 jours).
// DELETE : déconnexion (efface le cookie).
//
// Variables d'environnement attendues :
//   DASHBOARD_ACCESS_CODE     → le code que l'équipe saisit
//   DASHBOARD_SESSION_SECRET  → secret aléatoire, valeur du cookie de session
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { timingSafeEqual } from "crypto";

export const runtime = "nodejs";

const COOKIE_SESSION = "jc_acces";
const TRENTE_JOURS = 60 * 60 * 24 * 30;

// Comparaison à temps constant (évite les attaques temporelles sur le code)
function comparaisonConstante(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export async function POST(req: NextRequest) {
  const codeAttendu = process.env.DASHBOARD_ACCESS_CODE;
  const secret = process.env.DASHBOARD_SESSION_SECRET;

  if (!codeAttendu || !secret) {
    return NextResponse.json(
      { error: "Verrou non configuré (variables d'environnement manquantes)." },
      { status: 500 }
    );
  }

  let code = "";
  try {
    const body = await req.json();
    code = typeof body?.code === "string" ? body.code : "";
  } catch {
    code = "";
  }

  if (!comparaisonConstante(code, codeAttendu)) {
    return NextResponse.json({ error: "Code incorrect." }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_SESSION, secret, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: TRENTE_JOURS,
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_SESSION, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
