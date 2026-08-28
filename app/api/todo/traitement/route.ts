// app/api/todo/traitement/route.ts
// Marquer une ligne de la to-do comme traitée — et la remettre.
// Spec : claude/chantier-todo-digest.md §5 étape 4
//
// Pourquoi cette route existe : préparer un brouillon via Jardi fait un APPEND
// dans le dossier Brouillons et ne touche jamais le message d'origine
// (invariant lecture seule). Le mail reste non lu, donc dans la liste, alors
// que le travail est fait. Même chose pour un retard qu'on vient d'appeler.
//
// RIEN N'EST IRRÉVERSIBLE : la table est en ajout seul (garanti par trigger),
// « remettre » écrit une ligne de plus, et la boîte mail n'est jamais touchée.
import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

// Combien de temps un masquage tient avant que la ligne ne revienne.
// Un mail est un ÉVÉNEMENT unique : une fois traité, il ne revient pas.
// Un retard, une échéance, une offre sont des ÉTATS qui durent : si la
// condition tient toujours dans une semaine, elle doit se rappeler à nous —
// sinon « traité » devient un moyen d'enterrer un problème.
const JOURS_AVANT_RETOUR: Record<string, number | null> = {
  mails_non_lus: null,
  sav: null,
  formulaires: null,
  retards: 7,
  echeances_proches: 7,
  confirmations_manquantes: 7,
  offres_a_relancer: 14,
}
const JOURS_DEFAUT = 7

export async function POST(req: NextRequest) {
  try {
    const corps = await req.json().catch(() => null) as {
      cle?: string; section?: string; libelle?: string; par?: string; action?: string
    } | null

    const cle = (corps?.cle || "").trim()
    const section = (corps?.section || "").trim()
    const action = corps?.action === "remis" ? "remis" : "masque"
    if (!cle || !section) {
      return NextResponse.json({ error: "cle et section sont requises" }, { status: 400 })
    }

    let expire: string | null = null
    if (action === "masque") {
      const jours = section in JOURS_AVANT_RETOUR ? JOURS_AVANT_RETOUR[section] : JOURS_DEFAUT
      if (jours !== null) {
        const d = new Date()
        d.setDate(d.getDate() + jours)
        expire = d.toISOString()
      }
    }

    const { error } = await supabaseAdmin.from("todo_traitements").insert({
      cle,
      section,
      action,
      libelle: (corps?.libelle || "").slice(0, 300) || null,
      par: (corps?.par || "").slice(0, 40) || null,
      expire_le: expire,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Cas particulier des offres : « relancée » n'est pas qu'un masquage, c'est
    // une information commerciale. On remplit enfin `date_derniere_relance` et
    // `nb_relances`, que l'app n'écrivait jamais (mesuré le 28.08 : 0 offre
    // avec une date d'envoi, 9 avec un compteur). C'est ce qui fera descendre
    // le compteur pour de bon, au lieu de le cacher.
    let offreMaj = false
    const m = /^offre-(\d+)$/.exec(cle)
    if (m && section === "offres_a_relancer" && action === "masque") {
      const id = Number(m[1])
      const { data: avant } = await supabaseAdmin
        .from("offres").select("nb_relances").eq("id", id).maybeSingle()
      const { error: e2 } = await supabaseAdmin.from("offres").update({
        date_derniere_relance: new Date().toISOString(),
        nb_relances: (avant?.nb_relances ?? 0) + 1,
      }).eq("id", id)
      // Une offre non mise à jour ne doit pas annuler le masquage : on le dit
      // plutôt que de faire semblant.
      offreMaj = !e2
    }

    return NextResponse.json({ ok: true, action, expire_le: expire, offre_mise_a_jour: offreMaj })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
