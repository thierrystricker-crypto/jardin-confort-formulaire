// app/api/delais/chronologie/route.ts
// Chronologie complète des délais d'UNE ligne commande × marque (§7 de la
// spec) : chaque événement daté, sourcé (manuel/auto), avec l'écart par
// rapport au délai précédent — on voit la dérive, pas juste la dernière
// promesse. Lecture seule.
import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { lienPJ, nomDocument, lienThunderbird } from "@/lib/pj-lien"

export async function GET(req: NextRequest) {
  try {
    const commandeId = new URL(req.url).searchParams.get("commande_id")
    if (!commandeId) return NextResponse.json({ error: "commande_id requis" }, { status: 400 })

    const { data, error } = await supabaseAdmin
      .from("delais_evenements")
      .select("id, type, date_depart, semaine_annoncee, source, confiance, statut_validation, portee, articles_concernes, commentaire, saisi_par, mail_uid_unique, pj_chemin, ref_fournisseur, created_at")
      .eq("commande_id", commandeId)
      .order("created_at", { ascending: true })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    // Lien vers le mail d'origine (Thunderbird) : mails.thunderbird_link par
    // uid_unique, en un seul appel. Absent pour les mails sans Message-ID
    // (robot Fermob paiement@) — dans ce cas, pas de lien du tout.
    const uids = [...new Set((data || []).map((e) => e.mail_uid_unique).filter(Boolean))] as string[]
    const parUid = new Map<string, string | null>()
    if (uids.length) {
      const { data: mails } = await supabaseAdmin
        .from("mails").select("uid_unique, thunderbird_link").in("uid_unique", uids)
      for (const m of mails || []) parUid.set(m.uid_unique, m.thunderbird_link)
    }
    // Lien signé frais (4 h) vers le PDF source de chaque événement — le
    // chemin est permanent, le lien se régénère à chaque ouverture du dépli.
    const evenements = (data || []).map((e) => ({
      ...e,
      pj_url: lienPJ(e.pj_chemin),
      pj_nom: nomDocument(e.pj_chemin, e.commentaire),
      mail_url: lienThunderbird(e.mail_uid_unique ? parUid.get(e.mail_uid_unique) : null),
    }))
    return NextResponse.json({ evenements })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
