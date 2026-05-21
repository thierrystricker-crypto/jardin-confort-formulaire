// app/api/clients/[id]/verify-email/route.ts
// POST — confirme, supprime ou dé-confirme un email client
//
// Endpoints :
//   body: { action: "confirm" }   → passe email_status à 'verified', set email_verified_at
//   body: { action: "delete" }    → supprime email + reset des 3 colonnes
//   body: { action: "unconfirm" } → repasse à 'manual_unverified' (au cas où)
//
// Note : le trigger SQL ne pose 'verified' automatiquement QUE quand email_status
// n'est pas posé explicitement. Ici on pose explicitement, donc le trigger respecte.

import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

type Action = "confirm" | "delete" | "unconfirm"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const clientId = parseInt(id, 10)
    if (isNaN(clientId)) {
      return NextResponse.json({ error: "ID client invalide" }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const action: Action = body?.action

    if (!["confirm", "delete", "unconfirm"].includes(action)) {
      return NextResponse.json(
        { error: "action doit être 'confirm', 'delete' ou 'unconfirm'" },
        { status: 400 }
      )
    }

    // Récupère le client actuel pour vérifier qu'il existe
    const { data: current, error: fetchErr } = await supabaseAdmin
      .from("clients")
      .select("id, numero_client, email, email_status, email_source, email_verified_at")
      .eq("id", clientId)
      .single()

    if (fetchErr || !current) {
      return NextResponse.json({ error: "Client introuvable" }, { status: 404 })
    }

    // Prépare le payload de mise à jour
    let updates: Record<string, string | null> = {}
    if (action === "confirm") {
      if (!current.email) {
        return NextResponse.json(
          { error: "Pas d'email à confirmer sur ce client" },
          { status: 400 }
        )
      }
      updates = {
        email_status: "verified",
        email_verified_at: new Date().toISOString(),
        // email_source: conservé pour traçabilité (source d'origine)
      }
    } else if (action === "delete") {
      updates = {
        email: null,
        email_status: null,
        email_source: null,
        email_verified_at: null,
      }
    } else if (action === "unconfirm") {
      updates = {
        email_status: "manual_unverified",
        email_verified_at: null,
      }
    }

    const { data: updated, error: updateErr } = await supabaseAdmin
      .from("clients")
      .update(updates)
      .eq("id", clientId)
      .select("id, numero_client, email, email_status, email_source, email_verified_at")
      .single()

    if (updateErr) {
      console.error("[verify-email] UPDATE error:", updateErr)
      return NextResponse.json(
        { error: updateErr.message || "Erreur lors de la mise à jour" },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true, client: updated })
  } catch (err) {
    console.error("[verify-email] Exception:", err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}