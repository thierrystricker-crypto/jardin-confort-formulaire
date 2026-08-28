// app/api/todo/route.ts
// Page « To-do / Digest du jour » — étape 2 : les sections qui viennent de la
// base. Lecture seule, aucune écriture, aucun accès IMAP ici.
// Spec : claude/chantier-todo-digest.md
//
// Quatre sections livrées : retards fournisseurs, échéances proches,
// confirmations de commandes manquantes, offres à relancer. Les trois
// sections mail (non lus, SAV, formulaires) viendront ensuite et passeront
// par le connecteur jardi-mail, pas par la base.
//
// Invariant de la spec : chaque section annonce son PÉRIMÈTRE (règle,
// fenêtre, total réel avant bornage). Une section bornée le dit.
// Une section vide s'affiche « à jour », elle n'est jamais masquée.
import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

// Les sections mail viennent du connecteur jardi-mail : ni le non-lu ni le
// « répondu » ne sont dans l'index Supabase — ce sont des flags IMAP, et seul
// ce projet-là a les mots de passe des boîtes.
export const maxDuration = 60
const JARDI_MAIL_URL = process.env.JARDI_MAIL_URL || "https://jardi-mail-mcp.vercel.app"
const JARDI_MAIL_TOKEN = process.env.CLAUDE_CHAT_MCP_TOKEN
const TIMEOUT_MAIL_MS = 30000

// Règle de relance : reprise TELLE QUELLE du dashboard principal
// (app/dashboard/page.tsx, computeStats) — offre active de 7 jours ou plus.
const RELANCE_JOURS = 7
// Statuts « morts » écartés (chaînés en .neq plutôt qu'un NOT IN : pas
// d'échappement de chaîne PostgREST à rater sur des valeurs accentuées).
// Abandonnée · Convertie · Refusée
// Bornage décidé le 28.08 : les 10 plus gros montants. La règle à 7 jours
// sélectionne ~95 % du stock d'offres ouvertes ; une liste de 158 lignes
// n'est pas une to-do. On relance d'abord ce qui rapporte.
const RELANCE_LIMITE = 10

type Masque = {
  cle: string
  section: string
  libelle: string | null
  par: string | null
  expire_le: string | null
  created_at: string
}

type Section = {
  cle: string
  titre: string
  compteur: number
  total: number
  borne: boolean
  perimetre: string
  lignes: Ligne[]
  // Renseigné quand la section n'a PAS pu être calculée. Sans ce champ, une
  // section mail en échec s'afficherait « à jour » en vert — un mensonge.
  indisponible?: string | null
}
type Ligne = {
  id: string
  titre: string
  detail: string
  url: string | null
  badge: string | null
  // Renseignés seulement pour les lignes MAIL (rendues par le connecteur) :
  // les premières lignes du message, et de quoi demander un brouillon à Jardi.
  apercu?: string | null
  mail?: { boite: string; dossier: string; uid: number }
  pour?: string[]
}

type LigneSuivi = {
  id: number
  numero_commande: string
  boutique: string
  client_nom: string | null
  client_prenom: string | null
  marque: string | null
  jours_retard: number | null
  jours_avant_echeance: number | null
  date_commande: string | null
  arrivage_calcule: string | null
  ref_fournisseur: string | null
  etape: string | null
}

type LigneOffre = {
  id: number
  slug: string | null
  numero_offre: string | null
  numero_affiche: string | null
  date_document: string | null
  client_societe: string | null
  client_nom: string | null
  client_prenom: string | null
  total_ttc: number | string | null
  commercial: string | null
  date_derniere_relance: string | null
  nb_relances: number | null
}

const COLONNES_SUIVI =
  "id, numero_commande, boutique, client_nom, client_prenom, marque, jours_retard, jours_avant_echeance, date_commande, arrivage_calcule, ref_fournisseur, etape"

// --- Formatage (suisse) -----------------------------------------------------
function dateCH(v: string | null): string {
  if (!v) return "—"
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return "—"
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`
}
function chf(v: number | string | null): string {
  // PostgREST peut rendre un `numeric` en chaîne : on coerce avant de formater,
  // sinon le montant sort tel quel (« 85875.00 » au lieu de « CHF 85'875.00 »).
  if (v === null || v === undefined) return "—"
  const n = typeof v === "string" ? Number(v) : v
  if (!Number.isFinite(n)) return "—"
  return `CHF ${new Intl.NumberFormat("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`
}
function client(l: { client_societe?: string | null; client_nom: string | null; client_prenom: string | null }): string {
  const societe = (l as { client_societe?: string | null }).client_societe
  if (societe) return societe
  return [l.client_nom, l.client_prenom].filter(Boolean).join(" ") || "client inconnu"
}
function jours(n: number | null): string {
  if (n === null || n === undefined) return ""
  const abs = Math.abs(n)
  return `${abs} jour${abs > 1 ? "s" : ""}`
}
function isoIlYa(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

// --- Construction d'une ligne de suivi --------------------------------------
function ligneSuivi(l: LigneSuivi, badge: string | null): Ligne {
  return {
    id: `suivi-${l.id}`,
    titre: `${l.numero_commande} · ${client(l)}${l.marque ? ` · ${l.marque}` : ""}`,
    detail: [
      l.arrivage_calcule ? `arrivage prévu le ${dateCH(l.arrivage_calcule)}` : "aucune date d'arrivage",
      l.ref_fournisseur ? `réf. ${l.ref_fournisseur}` : null,
      l.date_commande ? `commandée le ${dateCH(l.date_commande)}` : null,
    ].filter(Boolean).join(" · "),
    url: `/dashboard/delais?q=${encodeURIComponent(l.numero_commande)}`,
    badge,
  }
}

// Sections mail. Ne fait jamais échouer la page : en cas de panne du
// connecteur (IMAP lent, jeton absent, déploiement en cours), on rend une
// section explicitement INDISPONIBLE plutôt qu'une section vide.
async function sectionsMail(): Promise<Section[]> {
  const enPanne = (raison: string): Section[] => [{
    cle: "mails_non_lus",
    titre: "Mails à traiter",
    compteur: 0, total: 0, borne: false,
    perimetre: "Boîtes contact@ et info@, via le connecteur jardi-mail.",
    lignes: [],
    indisponible: raison,
  }]

  if (!JARDI_MAIL_TOKEN) return enPanne("jeton CLAUDE_CHAT_MCP_TOKEN absent de l'environnement")
  try {
    const res = await fetch(`${JARDI_MAIL_URL}/api/todo-mails`, {
      headers: { Authorization: `Bearer ${JARDI_MAIL_TOKEN}` },
      signal: AbortSignal.timeout(TIMEOUT_MAIL_MS),
      cache: "no-store",
    })
    if (!res.ok) return enPanne(`connecteur jardi-mail : ${res.status}`)
    const json = await res.json()
    const recues = (json?.sections || []) as Section[]
    return recues.length ? recues : enPanne("réponse vide du connecteur")
  } catch (e) {
    return enPanne(`connecteur jardi-mail injoignable (${String(e)})`)
  }
}

export async function GET() {
  try {
    const depuis = isoIlYa(RELANCE_JOURS)

    const [mails, retards, echeances, manquantes, offres, offresTotal] = await Promise.all([
      sectionsMail(),
      supabaseAdmin.from("v_suivi_delais").select(COLONNES_SUIVI)
        .eq("statut", "en_cours").eq("alarme_retard", true)
        .order("jours_retard", { ascending: false }),
      supabaseAdmin.from("v_suivi_delais").select(COLONNES_SUIVI)
        .eq("statut", "en_cours").eq("alarme_echeance_proche", true)
        .order("jours_avant_echeance", { ascending: true }),
      supabaseAdmin.from("v_suivi_delais").select(COLONNES_SUIVI)
        .eq("statut", "en_cours").eq("alarme_delai_manquant", true)
        .order("date_commande", { ascending: true }),
      supabaseAdmin.from("offres")
        .select("id, slug, numero_offre, numero_affiche, date_document, client_societe, client_nom, client_prenom, total_ttc, commercial, date_derniere_relance, nb_relances")
        .eq("type_document", "Offre")
        .neq("statut", "Abandonnée").neq("statut", "Convertie").neq("statut", "Refusée")
        .lte("date_document", depuis)
        .order("total_ttc", { ascending: false, nullsFirst: false })
        .limit(RELANCE_LIMITE),
      // Total réel avant bornage : sans lui, « 10 offres à relancer » se lit
      // comme un inventaire (leçon du 17.08 : tout comptage porte son périmètre).
      supabaseAdmin.from("offres")
        .select("id", { count: "exact", head: true })
        .eq("type_document", "Offre")
        .neq("statut", "Abandonnée").neq("statut", "Convertie").neq("statut", "Refusée")
        .lte("date_document", depuis),
    ])

    const erreur = retards.error || echeances.error || manquantes.error || offres.error || offresTotal.error
    if (erreur) return NextResponse.json({ error: erreur.message }, { status: 500 })

    // Lignes marquées « traité » et encore masquées. Un masquage daté qui a
    // expiré ne filtre plus : la ligne revient d'elle-même si la condition
    // dure. C'est voulu — « traité » ne doit pas pouvoir enterrer un problème.
    const { data: masquesBruts } = await supabaseAdmin
      .from("v_todo_masques")
      .select("cle, section, libelle, par, expire_le, created_at")
      .eq("action", "masque")
      .order("created_at", { ascending: false })
    const maintenant = Date.now()
    const masques = ((masquesBruts || []) as Masque[])
      .filter(m => !m.expire_le || new Date(m.expire_le).getTime() > maintenant)
    const cachees = new Set(masques.map(m => m.cle))

    const lignesRetard = (retards.data || []) as unknown as LigneSuivi[]
    const lignesEcheance = (echeances.data || []) as unknown as LigneSuivi[]
    const lignesManquantes = (manquantes.data || []) as unknown as LigneSuivi[]
    const lignesOffres = (offres.data || []) as unknown as LigneOffre[]
    const totalOffres = offresTotal.count ?? lignesOffres.length

    // Ordre voulu par Thierry (28.08) : le mail d'abord, c'est le gros du
    // travail quotidien. Le reste suit par urgence.
    const sections: Section[] = [
      ...mails,
      {
        cle: "retards",
        titre: "Retards fournisseurs",
        compteur: lignesRetard.length,
        total: lignesRetard.length,
        borne: false,
        perimetre: "Lignes de suivi en cours dont l'arrivage prévu est dépassé, sans preuve de départ ni réception. Source : v_suivi_delais (alarme_retard).",
        lignes: lignesRetard.map(l => ligneSuivi(l, l.jours_retard ? `${jours(l.jours_retard)} de retard` : "en retard")),
      },
      {
        cle: "echeances_proches",
        titre: "Échéances proches",
        compteur: lignesEcheance.length,
        total: lignesEcheance.length,
        borne: false,
        perimetre: "Arrivage prévu dans moins de 7 jours — de quoi prévenir le client avant qu'il appelle. Source : v_suivi_delais (alarme_echeance_proche).",
        lignes: lignesEcheance.map(l => ligneSuivi(l, l.jours_avant_echeance !== null ? `dans ${jours(l.jours_avant_echeance)}` : null)),
      },
      {
        cle: "confirmations_manquantes",
        titre: "Confirmations de commande manquantes",
        compteur: lignesManquantes.length,
        total: lignesManquantes.length,
        borne: false,
        perimetre: "Aucune confirmation ni preuve de départ reçue du fournisseur après 5 jours ouvrés. L'alarme n'arme qu'après ce délai : d'autres lignes sont à l'étape « sans_delai » sans être encore alarmées.",
        lignes: lignesManquantes.map(l => ligneSuivi(l, "aucun délai")),
      },
      {
        cle: "offres_a_relancer",
        titre: "Offres à relancer",
        compteur: lignesOffres.length,
        total: totalOffres,
        borne: totalOffres > lignesOffres.length,
        perimetre: `Offres ouvertes de ${RELANCE_JOURS} jours ou plus (règle du dashboard). Affichage borné aux ${RELANCE_LIMITE} plus gros montants sur ${totalOffres} — on relance d'abord ce qui rapporte.`,
        lignes: lignesOffres.map(o => ({
          id: `offre-${o.id}`,
          titre: `${o.numero_affiche || o.numero_offre || "offre"} · ${client(o)}`,
          detail: [
            chf(o.total_ttc),
            o.date_document ? `du ${dateCH(o.date_document)}` : null,
            o.commercial || null,
            o.nb_relances ? `${o.nb_relances} relance${o.nb_relances > 1 ? "s" : ""} · dernière le ${dateCH(o.date_derniere_relance)}` : "jamais relancée",
          ].filter(Boolean).join(" · "),
          url: o.slug ? `/dashboard/${o.slug}` : null,
          badge: o.date_document
            ? jours(Math.floor((Date.now() - new Date(o.date_document).getTime()) / 86400000))
            : null,
        })),
      },
    ]

    // Filtrage APRÈS construction : chaque section garde son `total` réel et
    // annonce combien de lignes sont masquées, plutôt que de faire comme si
    // elles n'avaient jamais existé.
    const sectionsVisibles: Section[] = sections.map(s => {
      const gardees = s.lignes.filter(l => !cachees.has(l.id))
      const masquees = s.lignes.length - gardees.length
      return {
        ...s,
        lignes: gardees,
        compteur: s.borne ? gardees.length : gardees.length,
        perimetre: masquees > 0
          ? `${s.perimetre} ${masquees} ligne${masquees > 1 ? "s" : ""} marquée${masquees > 1 ? "s" : ""} « traité » et masquée${masquees > 1 ? "s" : ""}.`
          : s.perimetre,
      }
    })

    return NextResponse.json({
      genere_le: new Date().toISOString(),
      // Le compteur du bandeau compte ce qui est RÉELLEMENT AFFICHÉ, pas les
      // totaux : additionner les 158 offres ouvertes donnait « 228 à traiter »,
      // un chiffre qui effraie sans rien dire de la journée. Le vrai arriéré
      // reste lisible section par section (`total`) et ci-dessous.
      total_a_traiter: sectionsVisibles.reduce((s, x) => s + x.compteur, 0),
      total_arriere: sections.reduce((s, x) => s + x.total, 0),
      sections: sectionsVisibles,
      masques,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
