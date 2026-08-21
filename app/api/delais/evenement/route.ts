// app/api/delais/evenement/route.ts
// Actions d'écriture du dashboard « Commandes & délais » :
//  - { action: "reception", commande_id, date }        → événement reception
//    (nourrit le calibrage §3bis — la seule source du calibrage, jamais les
//    triggers de livraison client)
//  - { action: "valider" | "rejeter", evenement_id }   → file a_valider
//  - { action: "orpheline_traitee" | "orpheline_ignoree", orpheline_id }
// Invariant : on n'écrase ni ne supprime JAMAIS un événement — la validation
// change seulement statut_validation.
import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

export async function POST(req: NextRequest) {
  try {
    const corps = await req.json()
    const action = String(corps.action || "")

    if (action === "reception") {
      const { commande_id, date } = corps
      if (!commande_id || !/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) {
        return NextResponse.json({ error: "commande_id et date (YYYY-MM-DD) requis" }, { status: 400 })
      }
      const { error } = await supabaseAdmin.from("delais_evenements").insert({
        commande_id,
        type: "reception",
        date_depart: date,
        source: "manuel",
        statut_validation: "valide",
        portee: "commande",
        commentaire: "Marchandise reçue — saisie dashboard délais",
        saisi_par: "dashboard",
      })
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ success: true })
    }

    if (action === "valider" || action === "rejeter") {
      const { evenement_id } = corps
      if (!evenement_id) return NextResponse.json({ error: "evenement_id requis" }, { status: 400 })
      const { error } = await supabaseAdmin
        .from("delais_evenements")
        .update({ statut_validation: action === "valider" ? "valide" : "rejete" })
        .eq("id", evenement_id)
        .eq("statut_validation", "a_valider")
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ success: true })
    }

    if (action === "orpheline_traitee" || action === "orpheline_ignoree") {
      const { orpheline_id } = corps
      if (!orpheline_id) return NextResponse.json({ error: "orpheline_id requis" }, { status: 400 })
      const { error } = await supabaseAdmin
        .from("delais_extractions_orphelines")
        .update({ statut: action === "orpheline_traitee" ? "traitee" : "ignoree" })
        .eq("id", orpheline_id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: `Action inconnue : ${action}` }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
