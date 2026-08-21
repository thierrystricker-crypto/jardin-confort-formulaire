// lib/promesse-shopify.ts
// Promesse client des commandes WEB (chantier suivi des délais, complément
// de l'étape 5) : reconstitue le délai affiché au client sur la boutique au
// moment de la commande, pour remplir suivi_commandes.delai_annonce_client.
//
// Sources — exactement la cascade du thème Shopify (doc Thierry 21.08.2026) :
//   1. Métachamp de VARIANTE `fournisseur.delai_semaines` (ex. "5-6") :
//      délai client FINAL en semaines, acheminement compris. Il PRIME.
//      (~8 400 variantes Fermob, alimenté chaque jour par la synchro
//      Supabase→Shopify du projet jardin-confort-webshop.)
//   2. Sinon, tag PRODUIT `Nweek` / `Nweeks` (ex. 1week, 2weeks, 8weeks) :
//      le site affiche une fourchette ; on prend comme borne haute N+1
//      semaines (N+2 au-delà de 10) — ancres connues : 1week→1-2,
//      10weeks→10-12.
//   3. Ni l'un ni l'autre → on ne sait pas → delai_annonce_client reste NULL
//      (le site ne promettait rien, on n'invente pas de promesse).
// On ne lit AUCUN autre métachamp du namespace fournisseur (internes).
//
// Règle appliquée : promesse = date_commande + (max des bornes hautes parmi
// les lignes de la marque) × 7 jours. Le max, car le client attend la
// livraison complète ("le plus long de tous" — Thierry).
//
// Limites assumées (documentées, pas cachées) :
// - On lit le métachamp/tag D'AUJOURD'HUI, pas celui du jour de la commande
//   (Shopify n'archive pas ; l'historique webshop ne remonte qu'au 12.08.26).
//   Rempli au fil de l'eau à J+0/J+1, l'écart est négligeable ; pour le
//   rattrapage des commandes anciennes c'est une approximation.
// - La règle « le stock JC prime » (pas de délai affiché si tout était en
//   stock) n'est pas reconstituable a posteriori. Approximation raisonnable :
//   si la ligne est dans le suivi, c'est qu'on a commandé au fournisseur,
//   donc le délai a bien été montré au client.
// Une promesse déjà posée n'est JAMAIS écrasée (delai_annonce_client is null
// dans le filtre ET dans l'update) : c'est un instantané, pas un calcul vivant.
import { supabaseAdmin } from "@/lib/supabase"
import { shopifyAdminGraphQL } from "@/lib/shopify-stock"

const BOUTIQUE_WEB = "jardin-confort.ch"

// "5-6" → 6 ; "12" → 12 ; sinon null. Valeurs sans mot d'unité, en semaines.
export function semainesDepuisMetafield(valeur: string | null | undefined): number | null {
  if (!valeur) return null
  const m = /^\s*(\d{1,2})(?:\s*-\s*(\d{1,2}))?\s*$/.exec(valeur)
  if (!m) return null
  const haut = m[2] ? parseInt(m[2], 10) : parseInt(m[1], 10)
  return haut >= 1 && haut <= 52 ? haut : null
}

// Tags produit "1week", "2weeks", "8weeks"… → borne haute de la fourchette
// affichée. Ancres : 1week→2, 10weeks→12 ; entre les deux, N+1.
export function semainesDepuisTags(tags: string[] | null | undefined): number | null {
  if (!tags?.length) return null
  let haut: number | null = null
  for (const tag of tags) {
    const m = /^(\d{1,2})\s*weeks?$/i.exec(tag.trim())
    if (!m) continue
    const n = parseInt(m[1], 10)
    if (n < 1 || n > 52) continue
    const borne = n >= 10 ? n + 2 : n + 1
    if (haut === null || borne > haut) haut = borne // plusieurs tags : le pire
  }
  return haut
}

type NoeudVariante = {
  sku: string | null
  metafield: { value: string | null } | null
  product: { tags: string[] } | null
}

// Interroge Shopify par paquets de SKU et rend sku → semaines (borne haute).
async function delaisParSku(skus: string[]): Promise<Map<string, number>> {
  const resultat = new Map<string, number>()
  const TAILLE = 25
  for (let i = 0; i < skus.length; i += TAILLE) {
    const paquet = skus.slice(i, i + TAILLE)
    const q = paquet.map((s) => `sku:${JSON.stringify(s)}`).join(" OR ")
    const data = await shopifyAdminGraphQL<{ productVariants: { nodes: NoeudVariante[] } }>(
      `query ($q: String!) {
        productVariants(first: 100, query: $q) {
          nodes {
            sku
            metafield(namespace: "fournisseur", key: "delai_semaines") { value }
            product { tags }
          }
        }
      }`,
      { q }
    )
    for (const n of data.productVariants?.nodes || []) {
      if (!n.sku) continue
      const semaines = semainesDepuisMetafield(n.metafield?.value) ?? semainesDepuisTags(n.product?.tags)
      // Même SKU en double dans la boutique : on garde le pire délai connu.
      if (semaines !== null && semaines > (resultat.get(n.sku) ?? 0)) resultat.set(n.sku, semaines)
    }
  }
  return resultat
}

export type BilanPromesses = {
  examinees: number
  remplies: number
  sans_delai: number
  erreurs: string[]
}

// Remplit delai_annonce_client des lignes web qui n'en ont pas encore.
// Borné (limite) pour tenir dans une invocation serverless ; les suivantes
// finiront le travail — le tableau de bord le déclenche à chaque ouverture.
export async function remplirPromessesShopify(limite = 40): Promise<BilanPromesses> {
  const bilan: BilanPromesses = { examinees: 0, remplies: 0, sans_delai: 0, erreurs: [] }

  const { data: lignes, error } = await supabaseAdmin
    .from("suivi_commandes")
    .select("id, numero_commande, marque, date_commande")
    .eq("boutique", BOUTIQUE_WEB)
    .neq("statut", "cloturee")
    .is("delai_annonce_client", null)
    .order("date_commande", { ascending: false })
    .limit(limite)
  if (error) throw new Error(`suivi_commandes: ${error.message}`)
  if (!lignes?.length) return bilan
  bilan.examinees = lignes.length

  // Articles de chaque commande (index commandes_shopify, jamais l'API
  // commandes de Shopify) — seules les lignes de la même marque comptent.
  const numeros = [...new Set(lignes.map((l) => l.numero_commande))]
  const { data: commandes, error: errCmd } = await supabaseAdmin
    .from("commandes_shopify")
    .select("id, shopify_order_name")
    .in("shopify_order_name", numeros)
  if (errCmd) throw new Error(`commandes_shopify: ${errCmd.message}`)
  const idParNumero = new Map((commandes || []).map((c) => [c.shopify_order_name, c.id]))

  const { data: articles, error: errArt } = await supabaseAdmin
    .from("commandes_shopify_articles")
    .select("commande_id, sku, marque")
    .in("commande_id", [...idParNumero.values()])
  if (errArt) throw new Error(`commandes_shopify_articles: ${errArt.message}`)

  const skusParLigne = new Map<string, string[]>()
  for (const l of lignes) {
    const cid = idParNumero.get(l.numero_commande)
    const skus = (articles || [])
      .filter((a) => a.commande_id === cid && a.sku && (a.marque || "").toLowerCase() === l.marque.toLowerCase())
      .map((a) => a.sku as string)
    skusParLigne.set(l.id, [...new Set(skus)])
  }

  const tousSkus = [...new Set([...skusParLigne.values()].flat())]
  if (!tousSkus.length) { bilan.sans_delai = lignes.length; return bilan }
  const delais = await delaisParSku(tousSkus)

  for (const l of lignes) {
    const semaines = (skusParLigne.get(l.id) || [])
      .map((s) => delais.get(s))
      .filter((n): n is number => typeof n === "number")
      .reduce((max, n) => Math.max(max, n), 0)
    if (!semaines) { bilan.sans_delai++; continue }
    const promesse = new Date(`${l.date_commande}T00:00:00Z`)
    promesse.setUTCDate(promesse.getUTCDate() + semaines * 7)
    const { error: errMaj } = await supabaseAdmin
      .from("suivi_commandes")
      .update({ delai_annonce_client: promesse.toISOString().slice(0, 10) })
      .eq("id", l.id)
      .is("delai_annonce_client", null) // jamais d'écrasement
    if (errMaj) bilan.erreurs.push(`${l.numero_commande}/${l.marque}: ${errMaj.message}`)
    else bilan.remplies++
  }
  return bilan
}
