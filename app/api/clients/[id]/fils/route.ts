// app/api/clients/[id]/fils/route.ts
// Fils de discussion mail du client, via le connecteur jardi-mail
// (route /api/client-fils : index Supabase des mails, en-têtes References en
// composantes + sujet normalisé par client, dédup par message_id — même
// logique que le chat Jardi et client_dossier). Lecture seule, jamais IMAP.
// Chantier fiche client : claude/chantier-fils-sans-reponse.md §7 (projet).
//
// Même patron que /api/todo : bearer CLAUDE_CHAT_MCP_TOKEN (déjà en place,
// aucun secret nouveau), et une panne du connecteur rend « indisponible »
// (ambre côté page), jamais un faux « aucun échange ».

import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

const JARDI_MAIL_URL = process.env.JARDI_MAIL_URL || "https://jardi-mail-mcp.vercel.app"
const JARDI_MAIL_TOKEN = process.env.CLAUDE_CHAT_MCP_TOKEN

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const { data: client, error } = await supabaseAdmin
      .from("clients")
      .select("email")
      .eq("id", id)
      .single()
    if (error || !client) {
      return NextResponse.json({ erreur: "Client introuvable" }, { status: 404 })
    }
    if (!client.email) {
      return NextResponse.json({
        fils: [],
        total_mails: 0,
        total_fils: 0,
        perimetre: "Aucune adresse email sur la fiche : pas de fils reconstruits.",
      })
    }
    if (!JARDI_MAIL_TOKEN) {
      return NextResponse.json({ erreur: "jeton CLAUDE_CHAT_MCP_TOKEN absent de l'environnement" }, { status: 500 })
    }

    const res = await fetch(
      `${JARDI_MAIL_URL}/api/client-fils?email=${encodeURIComponent(client.email)}&max_fils=25&max_messages=30`,
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
