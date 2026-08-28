// app/api/fils-mails/route.ts
// Fils de discussion mail par ADRESSE, via le connecteur jardi-mail
// (/api/client-fils). Utilisé par la page commande (/dashboard/[slug]), qui
// connaît l'email du client mais pas forcément sa fiche. La fiche client,
// elle, passe par /api/clients/[id]/fils (résolution email par la fiche).
// Chantier fiche client : claude/chantier-fils-sans-reponse.md §7 (projet).

import { NextRequest, NextResponse } from "next/server"

const JARDI_MAIL_URL = process.env.JARDI_MAIL_URL || "https://jardi-mail-mcp.vercel.app"
const JARDI_MAIL_TOKEN = process.env.CLAUDE_CHAT_MCP_TOKEN

export async function GET(request: NextRequest) {
  try {
    const email = (request.nextUrl.searchParams.get("email") || "").toLowerCase().trim()
    if (!email || !email.includes("@")) {
      return NextResponse.json({ erreur: "Paramètre 'email' requis." }, { status: 400 })
    }
    if (!JARDI_MAIL_TOKEN) {
      return NextResponse.json({ erreur: "jeton CLAUDE_CHAT_MCP_TOKEN absent de l'environnement" }, { status: 500 })
    }

    const res = await fetch(
      `${JARDI_MAIL_URL}/api/client-fils?email=${encodeURIComponent(email)}&max_fils=25&max_messages=30`,
      {
        headers: { Authorization: `Bearer ${JARDI_MAIL_TOKEN}` },
        cache: "no-store",
        signal: AbortSignal.timeout(25000),
      }
    )
    if (!res.ok) {
      return NextResponse.json({ erreur: `connecteur jardi-mail : ${res.status}` }, { status: 502 })
    }
    return NextResponse.json(await res.json())
  } catch (err) {
    return NextResponse.json({ erreur: `connecteur jardi-mail injoignable (${String(err)})` }, { status: 502 })
  }
}
