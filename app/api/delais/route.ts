// app/api/delais/route.ts
// Dashboard « Commandes & délais » (étape 5 du chantier suivi des délais
// fournisseurs) — lecture seule : lignes de la vue v_suivi_delais (une par
// commande client × marque), file des extractions orphelines du job auto,
// calibrage des règles de transit et fiches fournisseurs.
// Les écritures passent par /api/delais/evenement.
import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { lienPJ, nomDocument } from "@/lib/pj-lien"

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
        .select("id, commande_id, type, date_depart, semaine_annoncee, confiance, portee, articles_concernes, commentaire, pj_chemin, created_at, suivi_commandes(numero_commande, marque, client_nom, client_prenom)")
        .eq("statut_validation", "a_valider")
        .order("created_at", { ascending: false })
        .limit(100),
    ])

    const erreur = lignes.error || orphelines.error || calibrage.error || fournisseurs.error || aValider.error
    if (erreur) return NextResponse.json({ error: erreur.message }, { status: 500 })

    // Enrichissement : lien vers la commande client (page dashboard pour le
    // magasin, admin Shopify pour le web) + société du client (magasin).
    const lignesBrutes = (lignes.data || []) as {boutique: string; numero_commande: string}[]
    const numsMagasin = lignesBrutes.filter(l => l.boutique === "magasin").map(l => l.numero_commande)
    const numsShopify = lignesBrutes.filter(l => l.boutique === "jardin-confort.ch").map(l => l.numero_commande)
    const [offresInfo, shopifyInfo] = await Promise.all([
      numsMagasin.length
        ? supabaseAdmin.from("offres").select("numero_affiche, slug, client_societe").eq("type_document", "Commande").in("numero_affiche", numsMagasin)
        : Promise.resolve({ data: [] as {numero_affiche: string; slug: string; client_societe: string|null}[], error: null }),
      numsShopify.length
        ? supabaseAdmin.from("commandes_shopify").select("shopify_order_name, shopify_order_legacy_id").in("shopify_order_name", numsShopify)
        : Promise.resolve({ data: [] as {shopify_order_name: string; shopify_order_legacy_id: number|null}[], error: null }),
    ])
    const parNumMag = new Map((offresInfo.data || []).map(o => [o.numero_affiche, o]))
    const parNumShop = new Map((shopifyInfo.data || []).map(o => [o.shopify_order_name, o]))
    const lignesEnrichies = lignesBrutes.map(l => {
      const mag = l.boutique === "magasin" ? parNumMag.get(l.numero_commande) : null
      const shp = l.boutique === "jardin-confort.ch" ? parNumShop.get(l.numero_commande) : null
      return {
        ...l,
        client_societe: mag?.client_societe || null,
        commande_url: mag?.slug
          ? `/dashboard/${mag.slug}`
          : shp?.shopify_order_legacy_id
            ? `https://www.jardin-confort.ch/admin/orders/${shp.shopify_order_legacy_id}`
            : null,
      }
    })

    return NextResponse.json({
      lignes: lignesEnrichies,
      orphelines: orphelines.data || [],
      calibrage: calibrage.data || [],
      fournisseurs: fournisseurs.data || [],
      a_valider: (aValider.data || []).map((e) => {
        const brut = e as {pj_chemin?: string|null; commentaire?: string|null}
        return { ...e, pj_url: lienPJ(brut.pj_chemin), pj_nom: nomDocument(brut.pj_chemin, brut.commentaire) }
      }),
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
