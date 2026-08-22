// app/api/arrivages/route.ts
// Chantier « Arrivages » — réception par ligne d'article et par quantité
// (spec : claude/chantier-arrivages.md). Route interne (cookie du verrou).
//
//  GET  /api/arrivages?q=<scan ou saisie>
//       → { commande }                 : un seul candidat → la commande complète
//       → { candidats: [...] }         : plusieurs → la page propose, ne choisit pas
//       → { candidats: [] }            : rien trouvé
//  GET  /api/arrivages?boutique=…&numero=…
//       → { commande }                 : la commande par sa clé exacte
//  POST /api/arrivages
//       { boutique, numero_commande, date_reception, commentaire, saisi_par,
//         lignes: [{ position, qty_recue }] }
//       → un seul INSERT multi-lignes dans receptions_articles (append-only :
//         le trigger SQL refuse UPDATE/DELETE ; une erreur se corrige par une
//         ligne négative). Le trigger après insertion pose l'événement
//         `reception` dans delais_evenements (portée commande si tout est
//         couvert, sinon portée article).
//
// Le scan peut porter deux QR imprimés par la fiche de travail :
//   - le numéro de commande (`CMD-80877`, `JAR-13585`) — parfois mal encodé
//     par la douchette / le clavier CH (`JAR'13585`, `cmd 80877`) ;
//   - la référence client « <Société ou Nom> Mag|web|GAL ».
import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { normaliserNumero, lireReferenceClient, boutiqueDepuisNumero } from "@/lib/arrivages"

import type { LigneArrivage, Mouvement, CommandeArrivage, Candidat } from "@/lib/arrivages"

// ─── Lecture d'une commande ─────────────────────────────────────────────────
async function chargerCommande(boutique: string, numero: string): Promise<CommandeArrivage|null> {
  const [lignes, entete, mouvements] = await Promise.all([
    supabaseAdmin.from("v_receptions_commande").select("*")
      .eq("boutique", boutique).eq("numero_commande", numero).order("position"),
    supabaseAdmin.from("v_commande_lignes")
      .select("client_nom, client_prenom, client_societe, date_commande, canal")
      .eq("boutique", boutique).eq("numero_commande", numero).limit(1),
    supabaseAdmin.from("receptions_articles")
      .select("id, position, sku, titre, marque, qty_recue, date_reception, saisi_par, commentaire, created_at")
      .eq("boutique", boutique).eq("numero_commande", numero)
      .order("created_at", { ascending: false }).limit(200),
  ])
  if (lignes.error) throw new Error(lignes.error.message)
  if (!lignes.data || lignes.data.length === 0) return null
  const e = (entete.data && entete.data[0]) || null
  return {
    boutique, numero_commande: numero,
    canal: e?.canal || (boutique === "magasin" ? "Mag" : "web"),
    client_nom: e?.client_nom ?? null, client_prenom: e?.client_prenom ?? null,
    client_societe: e?.client_societe ?? null, date_commande: e?.date_commande ?? null,
    lignes: (lignes.data as LigneArrivage[]).map(l => ({
      ...l,
      qty_commandee: Number(l.qty_commandee), qty_stock_cmd: Number(l.qty_stock_cmd),
      qty_recue_totale: Number(l.qty_recue_totale), qty_couverte: Number(l.qty_couverte),
      qty_restante: Number(l.qty_restante), nb_mouvements: Number(l.nb_mouvements),
    })),
    mouvements: ((mouvements.data || []) as Mouvement[]).map(m => ({ ...m, qty_recue: Number(m.qty_recue) })),
  }
}

// ─── Recherche par référence client (commandes ouvertes) ────────────────────
async function chercherParClient(ref: string, boutique: string|null): Promise<Candidat[]> {
  if (ref.length < 2) return []
  const motif = `%${ref.replace(/[%_,()]/g, "")}%`
  let q = supabaseAdmin.from("suivi_commandes")
    .select("boutique, numero_commande, client_nom, client_prenom, client_societe, date_commande, marque")
    .eq("statut", "en_cours")
    .or(`client_societe.ilike.${motif},client_nom.ilike.${motif}`)
    .order("date_commande", { ascending: false })
    .limit(60)
  if (boutique) q = q.eq("boutique", boutique)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  const parNumero = new Map<string, Candidat>()
  for (const r of (data || []) as (Candidat & {marque: string})[]) {
    const cle = `${r.boutique}|${r.numero_commande}`
    const c = parNumero.get(cle) || { ...r, marques: [] }
    if (!c.marques.includes(r.marque)) c.marques.push(r.marque)
    parNumero.set(cle, c)
  }
  return [...parNumero.values()]
}

export async function GET(req: NextRequest) {
  try {
    const p = req.nextUrl.searchParams
    const boutique = p.get("boutique"), numero = p.get("numero")
    if (boutique && numero) {
      const commande = await chargerCommande(boutique, numero.toUpperCase())
      if (!commande) return NextResponse.json({ error: `Commande ${numero} introuvable` }, { status: 404 })
      return NextResponse.json({ commande })
    }
    const q = (p.get("q") || "").trim()
    if (!q) return NextResponse.json({ error: "q requis" }, { status: 400 })

    // Numéro de commande — ou chiffres seuls (« 13585 ») : on essaie JAR puis CMD.
    const num = normaliserNumero(q)
    const essais: { boutique: string; numero: string }[] = []
    if (num) {
      const b = boutiqueDepuisNumero(num)
      for (const bq of b ? [b] : ["magasin", "jardin-confort.ch"]) essais.push({ boutique: bq, numero: num })
    } else if (/^\d{4,6}$/.test(q)) {
      essais.push({ boutique: "jardin-confort.ch", numero: `JAR-${q}` }, { boutique: "magasin", numero: `CMD-${q}` })
    }
    if (essais.length) {
      for (const e of essais) {
        const commande = await chargerCommande(e.boutique, e.numero)
        if (commande) return NextResponse.json({ commande, scan: { type: "numero", valeur: e.numero } })
      }
      return NextResponse.json({ candidats: [], scan: { type: "numero", valeur: num || q } })
    }

    const { ref, boutique: bq } = lireReferenceClient(q)
    const candidats = await chercherParClient(ref, bq)
    if (candidats.length === 1) {
      const commande = await chargerCommande(candidats[0].boutique, candidats[0].numero_commande)
      if (commande) return NextResponse.json({ commande, scan: { type: "client", valeur: ref } })
    }
    return NextResponse.json({ candidats, scan: { type: "client", valeur: ref, boutique: bq } })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// ─── Écriture ───────────────────────────────────────────────────────────────
type CorpsPost = {
  boutique?: string; numero_commande?: string; date_reception?: string
  commentaire?: string; saisi_par?: string
  lignes?: { position?: number; qty_recue?: number; commentaire?: string }[]
}

export async function POST(req: NextRequest) {
  try {
    const corps = (await req.json()) as CorpsPost
    const boutique = String(corps.boutique || "")
    const numero = String(corps.numero_commande || "").toUpperCase()
    const date = String(corps.date_reception || "")
    if (!["magasin", "jardin-confort.ch"].includes(boutique) || !numero) {
      return NextResponse.json({ error: "boutique et numero_commande requis" }, { status: 400 })
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "date_reception (YYYY-MM-DD) requise" }, { status: 400 })
    }
    const lignes = Array.isArray(corps.lignes) ? corps.lignes : []
    if (!lignes.length) return NextResponse.json({ error: "Aucune ligne à enregistrer" }, { status: 400 })

    const commande = await chargerCommande(boutique, numero)
    if (!commande) return NextResponse.json({ error: `Commande ${numero} introuvable` }, { status: 404 })
    const parPosition = new Map(commande.lignes.map(l => [l.position, l]))

    const commentaire = String(corps.commentaire || "").trim() || null
    const saisiPar = (String(corps.saisi_par || "").trim() || "arrivages").slice(0, 60)
    const aInserer: Record<string, unknown>[] = []
    for (const l of lignes) {
      const pos = Number(l.position)
      const qty = Number(l.qty_recue)
      const ref = parPosition.get(pos)
      if (!ref) return NextResponse.json({ error: `Ligne ${pos} inconnue sur ${numero}` }, { status: 400 })
      if (!Number.isFinite(qty) || qty === 0) return NextResponse.json({ error: `Quantité invalide pour la ligne ${pos}` }, { status: 400 })
      if (qty < 0 && -qty > ref.qty_recue_totale) {
        return NextResponse.json({ error: `Ligne ${pos} : on ne peut pas annuler plus que ce qui a été reçu (${ref.qty_recue_totale})` }, { status: 400 })
      }
      const cmtLigne = String(l.commentaire || "").trim()
      aInserer.push({
        boutique, numero_commande: numero, position: pos,
        marque: ref.marque, sku: ref.sku, titre: ref.titre,
        qty_commandee: ref.qty_commandee, qty_stock_cmd: ref.qty_stock_cmd,
        qty_recue: qty, date_reception: date, saisi_par: saisiPar,
        commentaire: [cmtLigne, commentaire].filter(Boolean).join(" — ") || null,
      })
    }

    // Un seul INSERT : les triggers AFTER ROW voient toutes les lignes →
    // un seul événement « commande » quand tout est couvert.
    const { error } = await supabaseAdmin.from("receptions_articles").insert(aInserer)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const apres = await chargerCommande(boutique, numero)
    return NextResponse.json({ success: true, enregistrees: aInserer.length, commande: apres })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
