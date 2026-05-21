// app/api/clients/review-emails/route.ts
// GET — liste les clients par email_status (avec compteurs)
//
// Query params :
//   ?status=auto_thunderbird   (obligatoire, parmi les 4 statuts valides)
//   ?q=texte                   (optionnel, recherche dans nom/prenom/email/npa/ville/societe)
//   ?limit=100                 (optionnel, défaut 100, max 500)

import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

type EmailStatus =
  | "verified"
  | "auto_thunderbird"
  | "auto_low_confidence"
  | "manual_unverified"

const VALID_STATUSES: EmailStatus[] = [
  "verified",
  "auto_thunderbird",
  "auto_low_confidence",
  "manual_unverified",
]

export async function GET(request: NextRequest) {
  try {
    const url = request.nextUrl
    const status = url.searchParams.get("status") as EmailStatus | null
    const q = url.searchParams.get("q")?.trim() || ""
    const limit = Math.min(
      parseInt(url.searchParams.get("limit") || "100", 10),
      500
    )

    if (!status || !VALID_STATUSES.includes(status)) {
      return NextResponse.json(
        { error: `status doit être l'une de : ${VALID_STATUSES.join(", ")}` },
        { status: 400 }
      )
    }

    // Stats par statut (toutes les valeurs en parallèle)
    const statsPromises = VALID_STATUSES.map(s =>
      supabaseAdmin
        .from("clients")
        .select("id", { count: "exact", head: true })
        .eq("email_status", s)
        .then(r => ({ status: s, count: r.count || 0 }))
    )
    const statsResults = await Promise.all(statsPromises)
    const stats: Record<EmailStatus, number> = {
      verified: 0,
      auto_thunderbird: 0,
      auto_low_confidence: 0,
      manual_unverified: 0,
    }
    for (const r of statsResults) stats[r.status] = r.count

    // Total pour le statut courant
    const total = stats[status]

    // Query principale
    let query = supabaseAdmin
      .from("clients")
      .select(`
        id,
        numero_client,
        nom,
        prenom,
        societe,
        email,
        email_status,
        email_source,
        email_verified_at,
        npa,
        ville,
        tel1
      `)
      .eq("email_status", status)
      .not("email", "is", null)

    // Filtre recherche
    if (q) {
      query = query.or(
        `nom.ilike.%${q}%,prenom.ilike.%${q}%,email.ilike.%${q}%,npa.ilike.%${q}%,ville.ilike.%${q}%,societe.ilike.%${q}%`
      )
    }

    query = query.order("nom", { ascending: true }).limit(limit)

    const { data, error } = await query
    if (error) {
      console.error("[review-emails] Query error:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      clients: data || [],
      total,
      stats,
    })
  } catch (err) {
    console.error("[review-emails] Exception:", err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}