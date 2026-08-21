// app/api/delais/promesse/route.ts
// Déclencheur du remplissage de la promesse client des commandes WEB
// (métachamp fournisseur.delai_semaines, sinon tags Nweeks — voir
// lib/promesse-shopify.ts). Appelé par le tableau de bord des délais à
// chaque ouverture : il traite jusqu'à 40 lignes sans promesse par appel,
// ne réécrit jamais une promesse existante, et rend le bilan.
import { NextResponse } from "next/server"
import { remplirPromessesShopify } from "@/lib/promesse-shopify"

export const maxDuration = 60

export async function POST() {
  try {
    const bilan = await remplirPromessesShopify()
    return NextResponse.json(bilan)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
