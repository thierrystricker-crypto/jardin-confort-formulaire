// app/api/offres/[slug]/livraison/route.ts
// Clic « Marquer livrée » des commandes MAGASIN — l'équivalent du fulfilled
// Shopify [20.08.2026]. Réservé aux type_document = 'Commande'.
// Le trigger Supabase offres_sync_suivi_livraison répercute automatiquement
// le statut sur les lignes du suivi des délais fournisseurs (boutique
// 'magasin') : livrée → la ligne sort des alarmes, rouverte → elle revient.
import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params
    const { statut_livraison } = await request.json()

    if (!["ouverte", "livree"].includes(statut_livraison)) {
      return NextResponse.json({ error: "Statut de livraison invalide (ouverte | livree)" }, { status: 400 })
    }

    const date_livraison = statut_livraison === "livree" ? new Date().toISOString() : null

    const { data, error } = await supabaseAdmin
      .from("offres")
      .update({ statut_livraison, date_livraison })
      .eq("slug", slug)
      .eq("type_document", "Commande")
      .select("id")

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data || data.length === 0) {
      return NextResponse.json({ error: "Commande introuvable (seules les commandes ont un statut de livraison)" }, { status: 404 })
    }

    return NextResponse.json({ success: true, statut_livraison, date_livraison })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
