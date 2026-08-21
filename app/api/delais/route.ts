// app/api/delais/route.ts
// Dashboard « Commandes & délais » (étape 5 du chantier suivi des délais
// fournisseurs) — lecture seule : lignes de la vue v_suivi_delais (une par
// commande client × marque), file des extractions orphelines du job auto,
// calibrage des règles de transit et fiches fournisseurs.
// Les écritures passent par /api/delais/evenement.
import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

export async function GET() {
  try {
    const [lignes, orphelines, calibrage, fournisseurs, aValider] = await Promise.all([
      supabaseAdmin
        .from("v_suivi_delais")
        .select("*")
        .neq("statut", "cloturee"),
      supabaseAdmin
        .from("delais_extractions_orphelines")
        .select("id, marque, type_document, sujet, date_mail, raison, statut, created_at")
        .eq("statut", "a_traiter")
        .order("date_mail", { ascending: false })
        .limit(200),
      supabaseAdmin.from("v_transit_calibrage").select("*"),
      supabaseAdmin
        .from("fournisseurs_surveilles")
        .select("marque, transit_regle, seuil_echeance_jours, seuil_delai_manquant_jours_ouvres, actif"),
      // File de validation : événements auto sous le seuil de confiance,
      // avec la commande porteuse (jointure implicite PostgREST).
      supabaseAdmin
        .from("delais_evenements")
        .select("id, commande_id, type, date_depart, semaine_annoncee, confiance, portee, articles_concernes, commentaire, created_at, suivi_commandes(numero_commande, marque, client_nom, client_prenom)")
        .eq("statut_validation", "a_valider")
        .order("created_at", { ascending: false })
        .limit(100),
    ])

    const erreur = lignes.error || orphelines.error || calibrage.error || fournisseurs.error || aValider.error
    if (erreur) return NextResponse.json({ error: erreur.message }, { status: 500 })

    return NextResponse.json({
      lignes: lignes.data || [],
      orphelines: orphelines.data || [],
      calibrage: calibrage.data || [],
      fournisseurs: fournisseurs.data || [],
      a_valider: aValider.data || [],
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
