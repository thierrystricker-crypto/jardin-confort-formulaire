// app/api/delais/chronologie/route.ts
// Chronologie complète des délais d'UNE ligne commande × marque (§7 de la
// spec) : chaque événement daté, sourcé (manuel/auto), avec l'écart par
// rapport au délai précédent — on voit la dérive, pas juste la dernière
// promesse. Lecture seule.
import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

export async function GET(req: NextRequest) {
  try {
    const commandeId = new URL(req.url).searchParams.get("commande_id")
    if (!commandeId) return NextResponse.json({ error: "commande_id requis" }, { status: 400 })

    const { data, error } = await supabaseAdmin
      .from("delais_evenements")
      .select("id, type, date_depart, semaine_annoncee, source, confiance, statut_validation, portee, articles_concernes, commentaire, saisi_par, mail_uid_unique, created_at")
      .eq("commande_id", commandeId)
      .order("created_at", { ascending: true })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ evenements: data || [] })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
