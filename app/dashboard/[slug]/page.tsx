"use client";
// app/dashboard/[slug]/page.tsx

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import CorrectionDrawer from "@/components/CorrectionDrawer";
import CorrectionsHistoryBlock from "@/components/CorrectionsHistoryBlock";
import RevisionsHistoryBlock from "@/components/RevisionsHistoryBlock";
import StockMovementsBlock from "@/components/StockMovementsBlock";
import AnnexesBlock from "@/components/AnnexesBlock";
import ArrivagesBlock from "@/components/ArrivagesBlock";
import SuiviDelaisBlock from "@/components/SuiviDelaisBlock";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://offres.jardin-confort.ch"

type OffreStatut = "En cours"|"Envoyée"|"Convertie"|"Acceptée"|"Abandonnée"|"Refusée"
type TypeDocument = "Offre"|"Commande"
type OffreRecord = {
  id: number; slug: string; type_document: TypeDocument
  numero_offre: string|null; numero_commande: string|null; offre_origine: string|null
  numero_affiche: string; statut: OffreStatut; date_document: string|null
  commercial: string|null; payment_mode: string|null; delivery_mode: string|null
  lead_time: string|null; client_societe: string|null; client_nom: string|null
  client_prenom: string|null; client_email: string|null; client_tel1: string|null
  client_rue: string|null; client_npa: string|null; client_ville: string|null
  sous_total: number; remise_chf: number; services_total: number
  tva_montant: number; total_ttc: number; nb_articles: number
  remarques: string|null; notes_internes: string|null; note_commerciale: string|null
  date_abandon: string|null
  statut_livraison: "ouverte"|"livree"|null; date_livraison: string|null
  data: Record<string,unknown>; created_at: string; updated_at: string|null
}

function fmtDate(iso: string|null) {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("fr-CH", { day:"2-digit", month:"2-digit", year:"numeric" })
}
function fmtMoney(v: number|null|undefined) {
  if (!v) return "—"
  return "CHF\u00a0" + new Intl.NumberFormat("de-CH", { minimumFractionDigits:2, maximumFractionDigits:2 }).format(v)
}

function nomClient(o: OffreRecord) {
  return [o.client_prenom, o.client_nom].filter(Boolean).join(" ") || "—"
}
function getDaysOpen(o: OffreRecord): number|null {
  if (["Acceptée","Convertie","Abandonnée"].includes(o.statut)) return null
  const ref = (o as unknown as Record<string,unknown>).date_derniere_relance as string|null
  const baseDate = ref || o.date_document
  if (!baseDate) return null
  return Math.floor((Date.now()-new Date(baseDate).getTime())/86400000)
}
function getStatusColor(statut: string, type: string) {
  if (type==="Commande"||statut==="Acceptée"||statut==="Convertie") return "bg-emerald-500/15 text-emerald-300"
  if (statut==="Abandonnée"||statut==="Refusée") return "bg-rose-500/15 text-rose-300"
  if (statut==="Envoyée") return "bg-sky-500/15 text-sky-300"
  return "bg-amber-500/15 text-amber-300"
}
function getDaysBadgeColor(days: number|null) {
  if (days===null) return "bg-white/5 text-zinc-400"
  if (days>=14) return "bg-rose-500/15 text-rose-300"
  if (days>=7) return "bg-amber-500/15 text-amber-300"
  return "bg-white/5 text-zinc-300"
}

function ts() {
  return new Intl.DateTimeFormat("fr-CH",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}).format(new Date()).replace(",","")
}
function appendTs(cur: string, prev: string) {
  const c=cur.replace(/\r\n/g,"\n"), p=prev.replace(/\r\n/g,"\n")
  if(c.trim()===p.trim()) return c
  const lines=c.split("\n")
  for(let i=lines.length-1;i>=0;i--) {
    if(lines[i].trim()){lines[i]=`${lines[i].trimEnd()} — ${ts()}`;return lines.join("\n")}
  }
  return c
}

// ─── Composant Aperçu fiche de travail (initiale OU actuelle) ───
function FicheTravailPreview({
  initialUrl, currentUrl, initialAt,
}: {
  initialUrl: string | null
  currentUrl: string | null
  initialAt: string | null
}) {
  // L'ACTUELLE est l'outil de travail : onglet par défaut dès qu'elle existe.
  // L'initiale (la preuve) reste accessible d'un clic. Corrigé le 23.08.2026.
  const defaultMode: "initial" | "current" =
    currentUrl ? "current" : "initial"
  const [mode, setMode] = React.useState<"initial" | "current">(defaultMode)

  // Quand la fiche actuelle vient d'être (re)générée, basculer dessus sans
  // recharger la page.
  React.useEffect(() => {
    if (currentUrl) setMode("current")
  }, [currentUrl])

  const url = mode === "initial" ? initialUrl : currentUrl

  return (
    <section className="rounded-2xl border border-amber-500/20 bg-[#2a2d31] p-6">
      <div className="mb-4 flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          📋 Fiche de travail
          <span className="text-xs font-normal text-amber-300/70 bg-amber-500/10 border border-amber-500/20 rounded px-2 py-0.5">Interne</span>
        </h2>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-xl border border-white/10 bg-[#34383d] p-1 text-xs">
            <button
              onClick={() => setMode("initial")}
              disabled={!initialUrl}
              className={`rounded-lg px-3 py-1 font-medium transition ${
                mode === "initial"
                  ? "bg-blue-500/25 text-blue-200"
                  : "text-zinc-400 hover:text-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed"
              }`}
              title={initialAt ? `Figée le ${new Date(initialAt).toLocaleString("fr-CH")}` : ""}>
              Initiale
            </button>
            <button
              onClick={() => setMode("current")}
              disabled={!currentUrl}
              className={`rounded-lg px-3 py-1 font-medium transition ${
                mode === "current"
                  ? "bg-amber-500/25 text-amber-200"
                  : "text-zinc-400 hover:text-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed"
              }`}>
              Actuelle
            </button>
          </div>
          {url && (
            <a href={url} target="_blank" rel="noopener noreferrer" download
              className="rounded-xl border border-amber-500/30 bg-amber-500/15 px-3 py-1.5 text-xs text-amber-300 hover:bg-amber-500/20">
              Télécharger ↓
            </a>
          )}
        </div>
      </div>
      {mode === "initial" && initialAt && (
        <div className="mb-3 text-xs text-blue-300/80 bg-blue-500/5 border border-blue-500/20 rounded-lg px-3 py-2">
          🔵 Stock figé à la commande · {new Date(initialAt).toLocaleString("fr-CH")}
        </div>
      )}
      {mode === "current" && (
        <div className="mb-3 text-xs text-amber-300/80 bg-amber-500/5 border border-amber-500/20 rounded-lg px-3 py-2">
          🟡 Version actuelle de la commande (révisions et corrections comprises) — stocks figés ligne par ligne, chacune à sa date
        </div>
      )}
      {url ? (
        <div className="overflow-hidden rounded-2xl border border-amber-500/20 bg-black/20">
          <iframe src={url} title="Aperçu fiche de travail" className="h-[600px] w-full border-0"/>
        </div>
      ) : (
        <div className="rounded-2xl border border-white/10 bg-black/10 p-8 text-center text-sm text-zinc-500">
          Cette version n&apos;a pas encore été générée
        </div>
      )}
    </section>
  )
}
// ──────────────────────────────────────────────────────────────────

export default function DashboardDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const [offre,setOffre]=useState<OffreRecord|null>(null)
  const [loading,setLoading]=useState(true)
  const [slug,setSlug]=useState("")
  const [error,setError]=useState("")
  const [noteCommerciale,setNoteCommerciale]=useState("")
  const [notesInternes,setNotesInternes]=useState("")
  const [saving,setSaving]=useState(false)
  const [saveStatus,setSaveStatus]=useState("")
  const [saveKind,setSaveKind]=useState<"success"|"error"|"info">("info")
  const [pdfUrl,setPdfUrl]=useState<string|null>(null)
  const [pdfGenerating,setPdfGenerating]=useState(false)
  // Chantier « PDF de commande toujours à jour » (23.08.2026)
  const [pdfSnapshotAt,setPdfSnapshotAt]=useState<string|null>(null)
  const [pdfInitialUrl,setPdfInitialUrl]=useState<string|null>(null)
  const [pdfOpening,setPdfOpening]=useState(false)
  const [qrUrl,setQrUrl]=useState<string|null>(null)
  const [qrGenerating,setQrGenerating]=useState(false)
  const [ficheTravailUrl, setFicheTravailUrl] = useState<string|null>(null)
  const [ficheTravailGenerating, setFicheTravailGenerating] = useState(false)
  const [ficheTravailInitialUrl, setFicheTravailInitialUrl] = useState<string|null>(null)
  const [ficheTravailInitialAt, setFicheTravailInitialAt] = useState<string|null>(null)
  const [relancing,setRelancing]=useState(false)
  const [relanceStatus,setRelanceStatus]=useState("")
  const [emailCopied,setEmailCopied]=useState(false)
  const [addrCopied,setAddrCopied]=useState<"fact"|"livr"|null>(null)
  const [mailType, setMailType] = useState<"envoi" | "relance">("envoi")
  const [mailCopied, setMailCopied] = useState(false)
  const [clientId,setClientId]=useState<number|null>(null)
  const [offreOrigineSlug, setOffreOrigineSlug] = useState<string|null>(null)
  const [commandeIssue, setCommandeIssue] = useState<{slug: string; numero: string}|null>(null)
  const [probabilite,setProbabilite]=useState<string>("neutre")
  const [probSaving,setProbSaving]=useState(false)
  const [livraisonSaving,setLivraisonSaving]=useState(false)
  const [converting,setConverting]=useState(false)
  const [correctionDrawerOpen, setCorrectionDrawerOpen] = useState(false)

  // Contourne le cache d'une heure du Storage Supabase : le fichier est
  // remplacé au même chemin à chaque régénération, mais l'URL nue peut servir
  // l'ancienne version jusqu'à 1 h. Un paramètre unique force la version
  // courante. (Chantier « PDF de commande toujours à jour », 23.08.2026.)
  function frais(u: string|null|undefined): string|null {
    if (!u) return null
    return `${u}${u.includes("?") ? "&" : "?"}v=${Date.now()}`
  }

  async function pollPdf(slugToCheck: string) {
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 3000))
      try {
        const res = await fetch(`/api/offres/${slugToCheck}`)
        if (res.ok) {
          const json = await res.json()
          const url = (json.offre as Record<string,unknown>)?.pdf_url as string|null
          if (url) { setPdfUrl(frais(url)); setPdfGenerating(false); return }
        }
      } catch { /* ignore */ }
    }
    setPdfGenerating(false)
  }

  useEffect(()=>{
    async function load() {
      const {slug:s}=await params
      setSlug(s)
      try {
        const res=await fetch(`/api/offres/${s}`)
        if(!res.ok) throw new Error(`Erreur ${res.status}`)
        const json=await res.json()
        const o=json.offre as OffreRecord
        setOffre(o)
        setNoteCommerciale(o.note_commerciale||"")
        setNotesInternes(o.notes_internes||"")
        const existingPdfUrl = (o as unknown as Record<string,unknown>).pdf_url as string|null
        if (existingPdfUrl) {
          setPdfUrl(frais(existingPdfUrl))
        } else {
          setPdfGenerating(true)
          pollPdf(s)
        }
        setPdfSnapshotAt(((o as unknown as Record<string,unknown>).pdf_snapshot_at as string|null) || null)
        setPdfInitialUrl(((o as unknown as Record<string,unknown>).pdf_initial_url as string|null) || null)
        if ((o as unknown as Record<string,unknown>).qr_url) {
          setQrUrl(frais((o as unknown as Record<string,unknown>).qr_url as string))
        }
        if ((o as unknown as Record<string,unknown>).fiche_travail_pdf_url) {
          setFicheTravailUrl(frais((o as unknown as Record<string,unknown>).fiche_travail_pdf_url as string))
        }
        if ((o as unknown as Record<string,unknown>).fiche_travail_initial_url) {
          setFicheTravailInitialUrl(frais((o as unknown as Record<string,unknown>).fiche_travail_initial_url as string))
        }
        if ((o as unknown as Record<string,unknown>).fiche_travail_initial_at) {
          setFicheTravailInitialAt((o as unknown as Record<string,unknown>).fiche_travail_initial_at as string)
        }
        if ((o as unknown as Record<string,unknown>).probabilite) {
          setProbabilite((o as unknown as Record<string,unknown>).probabilite as string)
        }
        if (o.offre_origine && o.type_document === "Commande") {
          try {
            const oRes = await fetch(`/api/dashboard/offres?q=${encodeURIComponent(o.offre_origine)}&limit=1`)
            if (oRes.ok) {
              const oJson = await oRes.json()
              const found = (oJson.offres || []).find((x: {numero_affiche?: string; slug?: string}) =>
                x.numero_affiche === o.offre_origine
              )
              if (found?.slug) setOffreOrigineSlug(found.slug)
            }
          } catch { /* ignore */ }
        }
// Si on est sur une offre convertie, chercher la commande qui en est issue
        if (o.type_document === "Offre" && ["Convertie","Acceptée"].includes(o.statut)) {
          try {
            const cRes = await fetch(`/api/dashboard/offres`)
            if (cRes.ok) {
              const allDocs = await cRes.json()
              const list = Array.isArray(allDocs) ? allDocs : []
              const found = list.find((x: {type_document?: string; offre_origine?: string; slug?: string; numero_affiche?: string}) =>
                x.type_document === "Commande" && x.offre_origine === o.numero_affiche
              )
              if (found?.slug && found?.numero_affiche) {
                setCommandeIssue({ slug: found.slug, numero: found.numero_affiche })
              }
            }
          } catch { /* ignore */ }
        }

        if (o.client_email || o.client_tel1) {
          try {
            const q = o.client_email || o.client_tel1 || ""
            let searchQ = q
            if (!o.client_email && o.client_tel1) {
              let digits = o.client_tel1.replace(/[^\d]/g, "")
              if (digits.startsWith("0041")) digits = digits.slice(4)
              else if (digits.startsWith("41")) digits = digits.slice(2)
              else if (digits.startsWith("0")) digits = digits.slice(1)
              searchQ = digits
            }
            const cRes = await fetch(`/api/clients?q=${encodeURIComponent(searchQ)}&limit=1`)
            const cJson = await cRes.json()
            if (cJson.clients?.length > 0) setClientId(cJson.clients[0].id)
          } catch { /* ignore */ }
        }
      } catch(e) { setError((e as Error).message) }
      finally { setLoading(false) }
    }
    load()
  },[params])

  async function generatePdf() {
    if(!slug) return
    setPdfGenerating(true)
    try {
      const res=await fetch(`/api/offres/${slug}/pdf`,{method:"POST"})
      const json=await res.json()
      if(res.ok && json.pdf_url) setPdfUrl(json.pdf_url)
    } catch { /* ignore */ }
    finally { setPdfGenerating(false) }
  }

  // ─── Ouvrir le PDF de commande en le régénérant d'abord ───────────────
  // Chantier « PDF de commande toujours à jour » (23.08.2026).
  // Le PDF Storage n'est plus considéré comme frais : on le régénère à
  // l'instant où quelqu'un veut l'envoyer, puis on ouvre le fichier obtenu.
  // Aucun risque sur le stock : /api/offres/[slug] renvoie pour une commande
  // les lignes figées J0 de data, jamais Shopify en direct.
  // L'onglet est ouvert AVANT l'await (sinon le navigateur le bloque).
  async function ouvrirPdfAJour() {
    if(!slug || pdfOpening) return
    const onglet = window.open("", "_blank")
    if (onglet) {
      onglet.document.write(
        `<!doctype html><meta charset="utf-8"><title>PDF en cours…</title>` +
        `<body style="margin:0;display:flex;align-items:center;justify-content:center;` +
        `height:100vh;font-family:system-ui,sans-serif;color:#334;background:#f6f7f9">` +
        `<div style="text-align:center"><div style="font-size:15px">Génération du PDF à jour…</div>` +
        `<div style="margin-top:8px;font-size:13px;color:#889">10 à 20 secondes</div></div>`
      )
    }
    setPdfOpening(true)
    try {
      const res=await fetch(`/api/offres/${slug}/pdf`,{method:"POST"})
      const json=await res.json()
      if(res.ok && json.pdf_url){
        setPdfUrl(json.pdf_url)
        setPdfSnapshotAt(new Date().toISOString())
        const fraisUrl=`${json.pdf_url}?t=${Date.now()}`
        if (onglet) onglet.location.replace(fraisUrl)
        else window.open(fraisUrl,"_blank")
      } else {
        if (onglet) onglet.close()
        setSaveKind("error")
        setSaveStatus("Génération du PDF impossible. Le PDF précédent reste dans « Documents PDF ».")
      }
    } catch {
      if (onglet) onglet.close()
      setSaveKind("error")
      setSaveStatus("Génération du PDF impossible. Le PDF précédent reste dans « Documents PDF ».")
    }
    finally { setPdfOpening(false) }
  }

  // ─── Ouvrir le QR de paiement en le régénérant d'abord ────────────────
  // Même logique : le POST /qr relit total_ttc et les coordonnées client à
  // l'instant — après une révision ou une correction, le QR régénéré est juste.
  // Le fichier sanctuarisé qr/route.ts n'est pas modifié, seulement appelé.
  async function ouvrirQrAJour() {
    if(!slug || qrGenerating) return
    const onglet = window.open("", "_blank")
    if (onglet) {
      onglet.document.write(
        `<!doctype html><meta charset="utf-8"><title>QR en cours…</title>` +
        `<body style="margin:0;display:flex;align-items:center;justify-content:center;` +
        `height:100vh;font-family:system-ui,sans-serif;color:#334;background:#f6f7f9">` +
        `<div style="text-align:center"><div style="font-size:15px">Génération du QR de paiement au montant courant…</div>` +
        `<div style="margin-top:8px;font-size:13px;color:#889">10 à 20 secondes</div></div>`
      )
    }
    setQrGenerating(true)
    try {
      const res=await fetch(`/api/offres/${slug}/qr`,{method:"POST"})
      const json=await res.json()
      if(res.ok && json.qr_url){
        setQrUrl(json.qr_url)
        const fraisUrl=`${json.qr_url}?t=${Date.now()}`
        if (onglet) onglet.location.replace(fraisUrl)
        else window.open(fraisUrl,"_blank")
      } else {
        if (onglet) onglet.close()
        setSaveKind("error")
        setSaveStatus("Génération du QR impossible.")
      }
    } catch {
      if (onglet) onglet.close()
      setSaveKind("error")
      setSaveStatus("Génération du QR impossible.")
    }
    finally { setQrGenerating(false) }
  }

  async function generateQr() {
    if(!slug) return
    setQrGenerating(true)
    try {
      const res=await fetch(`/api/offres/${slug}/qr`,{method:"POST"})
      const json=await res.json()
      if(res.ok && json.qr_url) setQrUrl(json.qr_url)
    } catch { /* ignore */ }
    finally { setQrGenerating(false) }
  }

  async function generateFicheTravail(mode: "initial" | "current" = "current", force = false) {
    if(!slug) return

    // ⚠️ Confirmation avant régénération de la fiche "actuelle" : le stock affiché
    // sera celui du jour, potentiellement DIFFÉRENT de celui vu par le client à
    // la commande. La fiche initiale, elle, reste figée pour preuve juridique.
    if (mode === "current") {
      // Texte corrigé le 23.08.2026 : l'ancien avertissement annonçait le
      // « stock du jour », ce qui est faux pour une commande — la page fiche
      // de travail lit les lignes figées de data, jamais Shopify en direct.
      const confirmed = confirm(
        "Fiche de travail ACTUELLE\n\n" +
        "Le document régénéré reflète la commande dans son état courant (corrections et révisions comprises).\n\n" +
        "🔵 Les niveaux de stock affichés restent FIGÉS : ceux du jour de la validation pour les articles d'origine, ceux du jour de l'ajout pour les articles ajoutés en révision. Rien n'est recalculé.\n\n" +
        "La fiche INITIALE (preuve du stock vendu) reste intacte.\n\n" +
        "Régénérer la fiche de travail actuelle ?"
      )
      if (!confirmed) return
    }

    setFicheTravailGenerating(true)
    try {
      const res = await fetch(`/api/offres/${slug}/fiche-travail-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, force }),
      })
      const json = await res.json()
      if (res.ok && json.pdf_url) {
        const freshUrl = `${json.pdf_url}?t=${Date.now()}`
        if (mode === "initial") {
          setFicheTravailInitialUrl(freshUrl)
          if (!json.already_exists) {
            setFicheTravailInitialAt(new Date().toISOString())
          }
        } else {
          setFicheTravailUrl(freshUrl)
        }
        window.open(freshUrl, "_blank")
      } else {
        alert("Erreur génération fiche de travail : " + (json.error || res.status))
      }
    } catch (e) {
      alert("Erreur réseau : " + (e as Error).message)
    } finally {
      setFicheTravailGenerating(false)
    }
  }

  async function saveProbabilite(val: string) {
    setProbSaving(true)
    try {
      await fetch(`/api/offres/${slug}/probabilite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ probabilite: val })
      })
      setProbabilite(val)
    } catch { /* ignore */ }
    finally { setProbSaving(false) }
  }

  async function enregistrerRelance() {
    if(!slug) return
    setRelancing(true); setRelanceStatus("")
    try {
      const res=await fetch(`/api/offres/${slug}/relance`,{method:"POST"})
      const json=await res.json()
      if(res.ok) {
        setNoteCommerciale(json.note_commerciale||"")
        setOffre(prev=>prev?{...prev, statut:"Envoyée", note_commerciale:json.note_commerciale}:prev)
        setRelanceStatus(`✅ Relance #${json.nb_relances} enregistrée`)
        setTimeout(()=>setRelanceStatus(""),4000)
      } else { setRelanceStatus("Erreur: "+(json.error||res.status)) }
    } catch { setRelanceStatus("Erreur réseau") }
    finally { setRelancing(false) }
  }

// Copie l'offre courante en nouveau brouillon (Session 8 — Option A).
  //
  // Workflow :
  //   1. Construit un payload `data` au format DraftSnapshot attendu par POST /api/drafts
  //   2. POST direct → le brouillon est créé en base avec son numéro DRA-XXX
  //   3. Redirection vers /drafts/[slug]/editer (nouvel onglet) en mode édition
  //
  // Avantages vs ancien mécanisme localStorage + ?from_copy=1 :
  //   - Comportement uniforme avec la duplication brouillon→brouillon
  //   - Numéro DRA-XXX attribué immédiatement (commercial sait où il en est)
  //   - Pas de bug "ambianceImages trop lourdes pour localStorage"
  //   - Traçabilité copiedFromOffreSlug persistée directement en base
  //
  // Trace : data.copiedFromOffreSlug + data.copiedFromOffreNumero permettent
  // de retrouver l'offre source après création.
  async function copierEnBrouillon(avecClient: boolean) {
    if(!offre) return
    const offreData = offre.data as Record<string,unknown>

    // ─── Spread complet du JSONB data source ───
    // On part de TOUT ce qui est dans offreData (incluant notes, adresse de
    // livraison, validité, accès livraison, status local du formulaire, etc.)
    // puis on écrase uniquement les champs qui doivent changer sur le nouveau
    // brouillon. Avantage : si on ajoute demain un nouveau champ au formulaire,
    // il sera automatiquement copié sans modifier cette fonction.
    const data: Record<string,unknown> = {
      ...offreData,

      // ─── Forçage type document (cas source = Commande) ───
      formType: "Offre",

      // ─── Notes (colonnes plates de la table offres, prioritaires) ───
      // Elles existent en colonnes plates, donc on les réinjecte au cas où
      // elles auraient été modifiées via le bloc "Notes" du dashboard après
      // la création de l'offre.
      remarks: offre.remarques || offreData.remarks || "",
      noteCommerciale: offre.note_commerciale || offreData.noteCommerciale || "",
      notesInternes: offre.notes_internes || offreData.notesInternes || "",

      // ─── Commercial (priorité colonne plate) ───
      commercial: offre.commercial || offreData.commercial || "",

      // ─── Traçabilité de la source (Session 8) ───
      copiedFromOffreSlug: offre.slug,
      copiedFromOffreNumero: offre.numero_affiche,

      // ─── Nettoyage : marqueurs du document source à NE PAS hériter ───
      // Le nouveau brouillon doit avoir sa propre identité.
      date: undefined,                  // ← date = aujourd'hui (gérée par DraftFormulaire)
      offerNumber: undefined,           // ← DRA-XXX attribué par /api/drafts
      offerStatus: undefined,           // ← redémarre neutre (pas "Envoyée"/"Acceptée")
      fromDraftSlug: undefined,         // ← marqueur transformation Session 5
      copiedFromDraftSlug: undefined,   // ← marqueur copie brouillon→brouillon
      signedAt: undefined,
      signedBy: undefined,
    }

    if(avecClient) {
      // On privilégie les colonnes plates client_* (à jour si la fiche client
      // a été modifiée après la création de l'offre source), avec fallback
      // sur le JSONB offreData.
      Object.assign(data, {
        nom: offre.client_nom || offreData.nom || "",
        prenom: offre.client_prenom || offreData.prenom || "",
        societe: offre.client_societe || offreData.societe || "",
        complement_nom: (offreData.complement_nom as string) || "",
        email: offre.client_email || offreData.email || "",
        telephone1: offre.client_tel1 || offreData.telephone1 || "",
        telephone2: (offreData.telephone2 as string) || "",
        rue: offre.client_rue || offreData.rue || "",
        numero: (offreData.numero as string) || "",
        rue2: (offreData.rue2 as string) || "",
        npa: offre.client_npa || offreData.npa || "",
        ville: offre.client_ville || offreData.ville || "",
      })
    } else {
      // ─── Copie SANS client : on vide explicitement les champs client ET
      //     livraison (sinon le spread laisserait passer les livr_* fantômes)
      Object.assign(data, {
        nom: "", prenom: "", societe: "", complement_nom: "",
        email: "", telephone1: "", telephone2: "",
        rue: "", numero: "", rue2: "", npa: "", ville: "",
        livrDiff: false,
        livrSociete: "", livrNom: "", livrPrenom: "", livr_complement_nom: "",
        livrRue: "", livrNumero: "", livrRue2: "",
        livrNpa: "", livrVille: "", livrTel: "",
      })
    }

    try {
      const res = await fetch("/api/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data }),
      })
      const json = await res.json()
      if (!res.ok || !json.editUrl) {
        alert("Erreur création brouillon : " + (json.error || res.status))
        return
      }
      window.open(json.editUrl, "_blank")
    } catch (e) {
      alert("Erreur réseau : " + (e as Error).message)
    }
  }

  async function saveNotes() {
    if(!offre) return
    setSaving(true);setSaveStatus("Enregistrement…");setSaveKind("info")
    try {
      const sc=appendTs(noteCommerciale,offre.note_commerciale||"")
      const si=appendTs(notesInternes,offre.notes_internes||"")
      const res=await fetch(`/api/offres/${slug}/notes`,{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({note_commerciale:sc,notes_internes:si})
      })
      if(!res.ok) throw new Error("Erreur sauvegarde")
      setNoteCommerciale(sc);setNotesInternes(si)
      setOffre(prev=>prev?{...prev,note_commerciale:sc,notes_internes:si}:prev)
      setSaveStatus(`Enregistré à ${ts()}`);setSaveKind("success")
      setTimeout(()=>setSaveStatus(""),3000)
    } catch { setSaveStatus("Erreur lors de la sauvegarde");setSaveKind("error") }
    finally { setSaving(false) }
  }

  async function changeStatut(statut: string) {
    if(!offre) return
    try {
      const res=await fetch(`/api/offres/${slug}/statut`,{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({statut})
      })
      const json = await res.json().catch(()=>({}))
      if(res.ok) {
        setOffre(prev=>prev?{
          ...prev,
          statut:statut as OffreStatut,
          date_abandon: json.date_abandon ?? (statut==="Abandonnée" ? new Date().toISOString() : null)
        }:prev)
      } else {
        alert("Erreur: " + (json.error || res.status))
      }
    } catch(e) {
      alert("Erreur réseau: " + (e as Error).message)
    }
  }

  // Livraison des commandes magasin — l'équivalent du fulfilled Shopify
  // [20.08.2026]. Le trigger Supabase répercute le statut sur le suivi des
  // délais fournisseurs (boutique 'magasin').
  async function changeLivraison(next: "ouverte"|"livree") {
    if(!offre) return
    setLivraisonSaving(true)
    try {
      const res=await fetch(`/api/offres/${slug}/livraison`,{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({statut_livraison:next})
      })
      const json = await res.json().catch(()=>({}))
      if(res.ok) {
        setOffre(prev=>prev?{...prev,statut_livraison:next,date_livraison:json.date_livraison??null}:prev)
      } else {
        alert("Erreur: " + (json.error || res.status))
      }
    } catch(e) {
      alert("Erreur réseau: " + (e as Error).message)
    } finally {
      setLivraisonSaving(false)
    }
  }

  // Copie l'adresse facturation ou livraison du client dans le presse-papier.
  // Format identique à celui de la fiche client (voir Phase 7 du 13.05.2026) :
  //   Société (si présente)
  //   Nom Prénom
  //   Complément nom (si présent)
  //   Rue Numéro
  //   Complément d'adresse (rue2, si présent)
  //   NPA Ville
  function copyAddress(kind: "fact" | "livr") {
    if (!offre) return
    const data = offre.data as Record<string,unknown>

    const lines: (string|null|undefined)[] = kind === "fact"
      ? [
          offre.client_societe,
          [offre.client_prenom, offre.client_nom].filter(Boolean).join(" ") || null,
          (data.complement_nom as string) || null,
          [offre.client_rue, (data.numero as string) || ""].filter(Boolean).join(" ") || null,
          (data.rue2 as string) || null,
          [offre.client_npa, offre.client_ville].filter(Boolean).join(" ") || null,
        ]
      : [
          (data.livrSociete as string) || null,
          [(data.livrPrenom as string) || "", (data.livrNom as string) || ""].filter(Boolean).join(" ") || null,
          (data.livr_complement_nom as string) || null,
          [(data.livrRue as string) || "", (data.livrNumero as string) || ""].filter(Boolean).join(" ") || null,
          (data.livrRue2 as string) || null,
          [(data.livrNpa as string) || "", (data.livrVille as string) || ""].filter(Boolean).join(" ") || null,
        ]

    const text = lines.filter((l): l is string => !!l && l.trim().length > 0).join("\n")
    if (!text) return

    navigator.clipboard.writeText(text)
    setAddrCopied(kind)
    setTimeout(() => setAddrCopied(null), 2000)
  }

  async function convertirEnCommande() {
    if (!offre || !confirm("Confirmer la conversion de cette offre en commande ?")) return
    setConverting(true)
    try {
      const res = await fetch(`/api/offres/${slug}/valider`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signataire: offre.commercial || "Conversion manuelle",
          signature_base64: "",
          date_signature: new Date().toLocaleDateString("fr-CH"),
          internal: true,
        }),
      })
      const json = await res.json()
      if (res.ok && json.cmdSlug) {
        window.location.href = `/dashboard/${json.cmdSlug}`
      } else {
        alert("Erreur: " + (json.error || res.status))
      }
    } catch (e) {
      alert("Erreur: " + (e as Error).message)
    } finally {
      setConverting(false)
    }
  }

  const mailRelance=useMemo(()=>{
    if(!offre) return ""
    const nomComplet=[offre.client_prenom, offre.client_nom].filter(Boolean).join(" ")
    const pdfUrl=`${APP_URL}/print/offre/${offre.slug}`
    const validationUrl=`${APP_URL}/offre/${offre.slug}`
    const total=new Intl.NumberFormat("fr-CH",{minimumFractionDigits:2,maximumFractionDigits:2}).format(offre.total_ttc||0)
    return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#F3F5F6;font-family:Verdana,Arial,Helvetica,sans-serif;">
<table border="0" width="100%" cellspacing="0" cellpadding="0" bgcolor="#F3F5F6"><tbody><tr><td align="center" style="padding:28px 16px;">

<table style="border-radius:16px;border:1px solid #E8EAF3;max-width:600px;width:100%;" border="0" cellspacing="0" cellpadding="0" bgcolor="#FFFFFF"><tbody>

<tr><td style="padding:28px 28px 18px 28px;">
  <div style="font-size:14px;color:#0a1551;line-height:1.7;">
    Bonjour ${nomComplet},
  </div>
  <div style="margin-top:14px;font-size:14px;color:#0a1551;line-height:1.7;">
    Je me permets de reprendre contact avec vous suite à nos différents échanges et à notre offre concernant l&rsquo;acquisition de mobilier d&rsquo;extérieur.
  </div>
  <div style="margin-top:14px;font-size:14px;color:#0a1551;line-height:1.7;">
    Est-ce que vous avez eu l&rsquo;occasion de consulter notre offre ? Vous trouverez ci-dessous les liens pour la consulter et la valider en ligne.
  </div>
  <div style="margin-top:18px;font-size:14px;color:#0a1551;line-height:1.7;">
    Avec mes meilleures salutations,<br>
    <strong>${offre.commercial || ""}</strong>
  </div>
</td></tr>

<tr><td style="padding:6px 28px 6px 28px;text-align:center;">
  <img style="display:block;width:260px;max-width:100%;height:auto;margin:0 auto 18px auto;"
    src="https://www.jotform.com/uploads/Lutry/form_files/logo%20jardin%20confort%202025%20bleu%20comme%20instagram.698a4ad6553317.03187337.png"
    alt="Jardin-Confort"/>
  <div style="font-size:20px;font-weight:bold;color:#0a1551;">${offre.type_document} ${offre.numero_affiche}</div>
</td></tr>

<tr><td style="padding:4px 28px 18px 28px;text-align:center;font-size:13px;color:#5e678f;line-height:1.6;">
  ${nomComplet}${offre.client_societe?`<br>${offre.client_societe}`:""}<br>
  CHF ${total} &middot; ${offre.payment_mode||""}
</td></tr>

<tr><td style="padding:0 28px 12px 28px;" align="center">
  <table border="0" cellspacing="0" cellpadding="0"><tbody><tr>
    <td style="border-radius:26px;" align="center" bgcolor="#2B8AD1">
      <a style="display:inline-block;padding:14px 24px;font-family:Verdana,Arial,sans-serif;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:26px;"
        href="${pdfUrl}" target="_blank">
        🖨 Voir / Imprimer le PDF
      </a>
    </td>
  </tr></tbody></table>
</td></tr>

<tr><td style="padding:0 28px 22px 28px;" align="center">
  <table border="0" cellspacing="0" cellpadding="0"><tbody><tr>
    <td style="border-radius:26px;border:1px solid #D1D5DB;" align="center" bgcolor="#FFFFFF">
      <a style="display:inline-block;padding:14px 24px;font-family:Verdana,Arial,sans-serif;font-size:15px;font-weight:bold;color:#2a2b2a;text-decoration:none;border-radius:26px;"
        href="${validationUrl}" target="_blank">
        ✅ Valider votre ${offre.type_document.toLowerCase()} en ligne
      </a>
    </td>
  </tr></tbody></table>
</td></tr>

<tr><td style="padding:0 28px 32px 28px;">
  <table style="border-collapse:collapse;" border="0" width="100%" cellspacing="0" cellpadding="0"><tbody>
    ${[
      ["Client", nomComplet],
      ["Conseiller·ère", offre.commercial||"—"],
      ["Date", offre.date_document ? new Date(offre.date_document).toLocaleDateString("fr-CH",{day:"2-digit",month:"2-digit",year:"numeric"}) : "—"],
      ["Montant total", `CHF ${total}`],
      ["Mode de paiement", offre.payment_mode||"—"],
      ["Lien validation", `<a style="color:#4573e3;text-decoration:underline;" href="${validationUrl}">${validationUrl}</a>`],
    ].map(([k,v])=>`
    <tr>
      <td style="padding:10px 0;border-top:1px solid #ecedf2;font-size:13px;color:#6f76a7;width:38%;">${k}</td>
      <td style="padding:10px 0;border-top:1px solid #ecedf2;font-size:13px;font-weight:bold;color:#0a1551;">${v}</td>
    </tr>`).join("")}
  </tbody></table>
</td></tr>

<tr><td style="padding:16px 28px;background:#F8FAFC;border-top:1px solid #E8EAF3;border-radius:0 0 16px 16px;text-align:center;font-size:11px;color:#9ca3af;line-height:1.7;">
  <strong style="color:#0a1551;">Jardin-Confort SA</strong><br>
  Route de Lavaux 425 · 1095 Lutry · Suisse<br>
  +41 21 791 36 71 · <a href="https://www.jardin-confort.ch" style="color:#2B8AD1;">www.jardin-confort.ch</a>
</td></tr>

</tbody></table>
</td></tr></tbody></table>
</body></html>`
  },[offre])

  // Mail d'envoi initial de l'offre — design identique au mail de relance
  const mailEnvoi=useMemo(()=>{
    if(!offre) return ""
    const nomComplet=[offre.client_prenom, offre.client_nom].filter(Boolean).join(" ")
    const pdfUrl=`${APP_URL}/print/offre/${offre.slug}`
    const validationUrl=`${APP_URL}/offre/${offre.slug}`
    const total=new Intl.NumberFormat("fr-CH",{minimumFractionDigits:2,maximumFractionDigits:2}).format(offre.total_ttc||0)
    return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#F3F5F6;font-family:Verdana,Arial,Helvetica,sans-serif;">
<table border="0" width="100%" cellspacing="0" cellpadding="0" bgcolor="#F3F5F6"><tbody><tr><td align="center" style="padding:28px 16px;">

<table style="border-radius:16px;border:1px solid #E8EAF3;max-width:600px;width:100%;" border="0" cellspacing="0" cellpadding="0" bgcolor="#FFFFFF"><tbody>

<tr><td style="padding:28px 28px 18px 28px;">
  <div style="font-size:14px;color:#0a1551;line-height:1.7;">
    Bonjour ${nomComplet},
  </div>
  <div style="margin-top:14px;font-size:14px;color:#0a1551;line-height:1.7;">
    Suite à votre aimable demande, j'ai le plaisir de vous présenter notre offre pour les articles souhaités.
  </div>
  <div style="margin-top:14px;font-size:14px;color:#0a1551;line-height:1.7;">
    Vous pouvez consulter le détail de votre offre en cliquant sur le bouton ci-dessous. Si cette proposition vous convient, vous pouvez la valider directement en ligne — c'est rapide et sécurisé.
  </div>
  <div style="margin-top:14px;font-size:14px;color:#0a1551;line-height:1.7;">
    Je reste bien entendu à votre disposition pour toute question ou ajustement.
  </div>
  <div style="margin-top:18px;font-size:14px;color:#0a1551;line-height:1.7;">
    Avec mes meilleures salutations,<br>
    <strong>${offre.commercial || ""}</strong>
  </div>
</td></tr>

<tr><td style="padding:6px 28px 6px 28px;text-align:center;">
  <img style="display:block;width:260px;max-width:100%;height:auto;margin:0 auto 18px auto;"
    src="https://www.jotform.com/uploads/Lutry/form_files/logo%20jardin%20confort%202025%20bleu%20comme%20instagram.698a4ad6553317.03187337.png"
    alt="Jardin-Confort"/>
  <div style="font-size:20px;font-weight:bold;color:#0a1551;">${offre.type_document} ${offre.numero_affiche}</div>
</td></tr>

<tr><td style="padding:4px 28px 18px 28px;text-align:center;font-size:13px;color:#5e678f;line-height:1.6;">
  ${nomComplet}${offre.client_societe?`<br>${offre.client_societe}`:""}<br>
  CHF ${total} &middot; ${offre.payment_mode||""}
</td></tr>

<tr><td style="padding:0 28px 12px 28px;" align="center">
  <table border="0" cellspacing="0" cellpadding="0"><tbody><tr>
    <td style="border-radius:26px;" align="center" bgcolor="#2B8AD1">
      <a style="display:inline-block;padding:14px 24px;font-family:Verdana,Arial,sans-serif;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:26px;"
        href="${validationUrl}" target="_blank">
        ✅ Valider votre ${offre.type_document.toLowerCase()} en ligne
      </a>
    </td>
  </tr></tbody></table>
</td></tr>

<tr><td style="padding:0 28px 22px 28px;" align="center">
  <table border="0" cellspacing="0" cellpadding="0"><tbody><tr>
    <td style="border-radius:26px;border:1px solid #D1D5DB;" align="center" bgcolor="#FFFFFF">
      <a style="display:inline-block;padding:14px 24px;font-family:Verdana,Arial,sans-serif;font-size:15px;font-weight:bold;color:#2a2b2a;text-decoration:none;border-radius:26px;"
        href="${pdfUrl}" target="_blank">
        👁 Consulter votre ${offre.type_document.toLowerCase()}
      </a>
    </td>
  </tr></tbody></table>
</td></tr>

<tr><td style="padding:0 28px 32px 28px;">
  <table style="border-collapse:collapse;" border="0" width="100%" cellspacing="0" cellpadding="0"><tbody>
    ${[
      ["Client", nomComplet],
      ["Conseiller·ère", offre.commercial||"—"],
      ["Date", offre.date_document ? new Date(offre.date_document).toLocaleDateString("fr-CH",{day:"2-digit",month:"2-digit",year:"numeric"}) : "—"],
      ["Montant total", `CHF ${total}`],
      ["Mode de paiement", offre.payment_mode||"—"],
      ["Lien validation", `<a style="color:#4573e3;text-decoration:underline;" href="${validationUrl}">${validationUrl}</a>`],
    ].map(([k,v])=>`
    <tr>
      <td style="padding:10px 0;border-top:1px solid #ecedf2;font-size:13px;color:#6f76a7;width:38%;">${k}</td>
      <td style="padding:10px 0;border-top:1px solid #ecedf2;font-size:13px;font-weight:bold;color:#0a1551;">${v}</td>
    </tr>`).join("")}
  </tbody></table>
</td></tr>

<tr><td style="padding:16px 28px;background:#F8FAFC;border-top:1px solid #E8EAF3;border-radius:0 0 16px 16px;text-align:center;font-size:11px;color:#9ca3af;line-height:1.7;">
  <strong style="color:#0a1551;">Jardin-Confort SA</strong><br>
  Route de Lavaux 425 · 1095 Lutry · Suisse<br>
  +41 21 791 36 71 · <a href="https://www.jardin-confort.ch" style="color:#2B8AD1;">www.jardin-confort.ch</a>
</td></tr>

</tbody></table>
</td></tr></tbody></table>
</body></html>`
  },[offre])

  // Mail d'envoi initial d'une COMMANDE (créée manuellement au backoffice).
  // Le client n'a pas validé en ligne → c'est son 1er contact avec la commande.
  // Reprend le design du mail Make "Nouvelle commande validée online" en
  // l'adaptant : on s'adresse au client (pas au commercial interne).
  const mailEnvoiCommande=useMemo(()=>{
    if(!offre) return ""
    const nomComplet=[offre.client_prenom, offre.client_nom].filter(Boolean).join(" ")
    const commandeUrl=`${APP_URL}/print/offre/${offre.slug}`
    const total=new Intl.NumberFormat("fr-CH",{minimumFractionDigits:2,maximumFractionDigits:2}).format(offre.total_ttc||0)
    const adresseLignes=[
      offre.client_rue && `${offre.client_rue}${(offre.data as Record<string,unknown>)?.numero ? " " + ((offre.data as Record<string,unknown>).numero as string) : ""}`,
      [offre.client_npa, offre.client_ville].filter(Boolean).join(" "),
    ].filter(Boolean).join("<br>")
    return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#F3F5F6;font-family:Verdana,Arial,Helvetica,sans-serif;">
<table border="0" width="100%" cellspacing="0" cellpadding="0" bgcolor="#F3F5F6"><tbody><tr><td align="center" style="padding:28px 16px;">

<table style="border-radius:16px;border:1px solid #E8EAF3;max-width:600px;width:100%;" border="0" cellspacing="0" cellpadding="0" bgcolor="#FFFFFF"><tbody>

<tr><td style="padding:28px 28px 18px 28px;">
  <div style="font-size:14px;color:#0a1551;line-height:1.7;">
    Bonjour ${nomComplet},
  </div>
  <div style="margin-top:14px;font-size:14px;color:#0a1551;line-height:1.7;">
    J'ai le plaisir de vous confirmer l'enregistrement de votre commande chez Jardin-Confort.
  </div>
  <div style="margin-top:14px;font-size:14px;color:#0a1551;line-height:1.7;">
    Vous trouverez ci-dessous le récapitulatif de votre commande ainsi que les liens pour la consulter et procéder au règlement.
  </div>
  <div style="margin-top:14px;font-size:14px;color:#0a1551;line-height:1.7;">
    Je reste à votre disposition pour toute question ou information complémentaire.
  </div>
  <div style="margin-top:18px;font-size:14px;color:#0a1551;line-height:1.7;">
    Avec mes meilleures salutations,<br>
    <strong>${offre.commercial || ""}</strong>
  </div>
</td></tr>

<tr><td style="padding:6px 28px 6px 28px;text-align:center;">
  <img style="display:block;width:260px;max-width:100%;height:auto;margin:0 auto 18px auto;"
    src="https://www.jotform.com/uploads/Lutry/form_files/logo%20jardin%20confort%202025%20bleu%20comme%20instagram.698a4ad6553317.03187337.png"
    alt="Jardin-Confort"/>
  <div style="font-size:20px;font-weight:bold;color:#0a1551;">Commande ${offre.numero_affiche}</div>
</td></tr>

<tr><td style="padding:4px 28px 18px 28px;text-align:center;font-size:13px;color:#5e678f;line-height:1.6;">
  ${nomComplet}${offre.client_societe?`<br>${offre.client_societe}`:""}<br>
  CHF ${total} &middot; ${offre.payment_mode||""}
</td></tr>

<tr><td style="padding:0 28px 12px 28px;" align="center">
  <table border="0" cellspacing="0" cellpadding="0"><tbody><tr>
    <td style="border-radius:26px;" align="center" bgcolor="#2B8AD1">
      <a style="display:inline-block;padding:14px 24px;font-family:Verdana,Arial,sans-serif;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:26px;"
        href="${commandeUrl}" target="_blank">
        👁 Voir ma commande
      </a>
    </td>
  </tr></tbody></table>
</td></tr>

${qrUrl ? `<tr><td style="padding:0 28px 22px 28px;" align="center">
  <table border="0" cellspacing="0" cellpadding="0"><tbody><tr>
    <td style="border-radius:26px;border:1px solid #D1D5DB;" align="center" bgcolor="#FFFFFF">
      <a style="display:inline-block;padding:14px 24px;font-family:Verdana,Arial,sans-serif;font-size:15px;font-weight:bold;color:#2a2b2a;text-decoration:none;border-radius:26px;"
        href="${qrUrl}" target="_blank">
        🧾 QR de paiement
      </a>
    </td>
  </tr></tbody></table>
</td></tr>` : `<tr><td style="padding:0 28px 22px 28px;"></td></tr>`}

<tr><td style="padding:0 28px 32px 28px;">
  <table style="border-collapse:collapse;" border="0" width="100%" cellspacing="0" cellpadding="0"><tbody>
    ${[
      ["Commande", offre.numero_affiche],
      ["Client", nomComplet],
      ...(offre.client_societe ? [["Société", offre.client_societe]] : []),
      ...(adresseLignes ? [["Adresse", adresseLignes]] : []),
      ["Conseiller·ère", offre.commercial||"—"],
      ["Date", offre.date_document ? new Date(offre.date_document).toLocaleDateString("fr-CH",{day:"2-digit",month:"2-digit",year:"numeric"}) : "—"],
      ["Montant total", `CHF ${total}`],
      ["Mode de paiement", offre.payment_mode||"—"],
      ["Lien commande", `<a style="color:#4573e3;text-decoration:underline;" href="${commandeUrl}">${commandeUrl}</a>`],
      ...(qrUrl ? [["Lien QR paiement", `<a style="color:#4573e3;text-decoration:underline;" href="${qrUrl}">${qrUrl}</a>`]] : []),
    ].map(([k,v])=>`
    <tr>
      <td style="padding:10px 0;border-top:1px solid #ecedf2;font-size:13px;color:#6f76a7;width:38%;">${k}</td>
      <td style="padding:10px 0;border-top:1px solid #ecedf2;font-size:13px;font-weight:bold;color:#0a1551;">${v}</td>
    </tr>`).join("")}
  </tbody></table>
</td></tr>

<tr><td style="padding:16px 28px;background:#F8FAFC;border-top:1px solid #E8EAF3;border-radius:0 0 16px 16px;text-align:center;font-size:11px;color:#9ca3af;line-height:1.7;">
  <strong style="color:#0a1551;">Jardin-Confort SA</strong><br>
  Route de Lavaux 425 · 1095 Lutry · Suisse<br>
  +41 21 791 36 71 · <a href="https://www.jardin-confort.ch" style="color:#2B8AD1;">www.jardin-confort.ch</a>
</td></tr>

</tbody></table>
</td></tr></tbody></table>
</body></html>`
  },[offre, qrUrl])

  // Mail de RELANCE d'une COMMANDE = rappel de paiement de l'acompte.
  // Ton chaleureux : remerciements + question polie sur le règlement +
  // liens utiles (commande + QR de paiement).
  const mailRelanceCommande=useMemo(()=>{
    if(!offre) return ""
    const nomComplet=[offre.client_prenom, offre.client_nom].filter(Boolean).join(" ")
    const commandeUrl=`${APP_URL}/print/offre/${offre.slug}`
    const total=new Intl.NumberFormat("fr-CH",{minimumFractionDigits:2,maximumFractionDigits:2}).format(offre.total_ttc||0)
    return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#F3F5F6;font-family:Verdana,Arial,Helvetica,sans-serif;">
<table border="0" width="100%" cellspacing="0" cellpadding="0" bgcolor="#F3F5F6"><tbody><tr><td align="center" style="padding:28px 16px;">

<table style="border-radius:16px;border:1px solid #E8EAF3;max-width:600px;width:100%;" border="0" cellspacing="0" cellpadding="0" bgcolor="#FFFFFF"><tbody>

<tr><td style="padding:28px 28px 18px 28px;">
  <div style="font-size:14px;color:#0a1551;line-height:1.7;">
    Bonjour ${nomComplet},
  </div>
  <div style="margin-top:14px;font-size:14px;color:#0a1551;line-height:1.7;">
    Tout d'abord, nous tenons à vous remercier encore une fois pour votre commande chez Jardin-Confort.
  </div>
  <div style="margin-top:14px;font-size:14px;color:#0a1551;line-height:1.7;">
    Nous nous permettons de faire le point avec vous afin de savoir si le paiement de <strong>CHF ${total}</strong> à verser à la commande a pu être effectué, afin que nous puissions poursuivre le traitement de votre commande.
  </div>
  <div style="margin-top:14px;font-size:14px;color:#0a1551;line-height:1.7;">
    À toutes fins utiles, vous trouverez ci-dessous les liens vers les documents nécessaires.
  </div>
  <div style="margin-top:18px;font-size:14px;color:#0a1551;line-height:1.7;">
    Avec mes meilleures salutations,<br>
    <strong>${offre.commercial || ""}</strong>
  </div>
</td></tr>

<tr><td style="padding:6px 28px 6px 28px;text-align:center;">
  <img style="display:block;width:260px;max-width:100%;height:auto;margin:0 auto 18px auto;"
    src="https://www.jotform.com/uploads/Lutry/form_files/logo%20jardin%20confort%202025%20bleu%20comme%20instagram.698a4ad6553317.03187337.png"
    alt="Jardin-Confort"/>
  <div style="font-size:20px;font-weight:bold;color:#0a1551;">Commande ${offre.numero_affiche}</div>
</td></tr>

<tr><td style="padding:4px 28px 18px 28px;text-align:center;font-size:13px;color:#5e678f;line-height:1.6;">
  ${nomComplet}${offre.client_societe?`<br>${offre.client_societe}`:""}<br>
  CHF ${total} &middot; ${offre.payment_mode||""}
</td></tr>

<tr><td style="padding:0 28px 12px 28px;" align="center">
  <table border="0" cellspacing="0" cellpadding="0"><tbody><tr>
    <td style="border-radius:26px;" align="center" bgcolor="#2B8AD1">
      <a style="display:inline-block;padding:14px 24px;font-family:Verdana,Arial,sans-serif;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:26px;"
        href="${commandeUrl}" target="_blank">
        👁 Voir ma commande
      </a>
    </td>
  </tr></tbody></table>
</td></tr>

${qrUrl ? `<tr><td style="padding:0 28px 22px 28px;" align="center">
  <table border="0" cellspacing="0" cellpadding="0"><tbody><tr>
    <td style="border-radius:26px;border:1px solid #D1D5DB;" align="center" bgcolor="#FFFFFF">
      <a style="display:inline-block;padding:14px 24px;font-family:Verdana,Arial,sans-serif;font-size:15px;font-weight:bold;color:#2a2b2a;text-decoration:none;border-radius:26px;"
        href="${qrUrl}" target="_blank">
        🧾 QR de paiement
      </a>
    </td>
  </tr></tbody></table>
</td></tr>` : `<tr><td style="padding:0 28px 22px 28px;"></td></tr>`}

<tr><td style="padding:0 28px 32px 28px;">
  <table style="border-collapse:collapse;" border="0" width="100%" cellspacing="0" cellpadding="0"><tbody>
    ${[
      ["Commande", offre.numero_affiche],
      ["Client", nomComplet],
      ["Conseiller·ère", offre.commercial||"—"],
      ["Date", offre.date_document ? new Date(offre.date_document).toLocaleDateString("fr-CH",{day:"2-digit",month:"2-digit",year:"numeric"}) : "—"],
      ["Montant à verser", `CHF ${total}`],
      ["Mode de paiement", offre.payment_mode||"—"],
      ["Lien commande", `<a style="color:#4573e3;text-decoration:underline;" href="${commandeUrl}">${commandeUrl}</a>`],
      ...(qrUrl ? [["Lien QR paiement", `<a style="color:#4573e3;text-decoration:underline;" href="${qrUrl}">${qrUrl}</a>`]] : []),
    ].map(([k,v])=>`
    <tr>
      <td style="padding:10px 0;border-top:1px solid #ecedf2;font-size:13px;color:#6f76a7;width:38%;">${k}</td>
      <td style="padding:10px 0;border-top:1px solid #ecedf2;font-size:13px;font-weight:bold;color:#0a1551;">${v}</td>
    </tr>`).join("")}
  </tbody></table>
</td></tr>

<tr><td style="padding:16px 28px;background:#F8FAFC;border-top:1px solid #E8EAF3;border-radius:0 0 16px 16px;text-align:center;font-size:11px;color:#9ca3af;line-height:1.7;">
  <strong style="color:#0a1551;">Jardin-Confort SA</strong><br>
  Route de Lavaux 425 · 1095 Lutry · Suisse<br>
  +41 21 791 36 71 · <a href="https://www.jardin-confort.ch" style="color:#2B8AD1;">www.jardin-confort.ch</a>
</td></tr>

</tbody></table>
</td></tr></tbody></table>
</body></html>`
  },[offre, qrUrl])

  // Mail actuellement sélectionné (envoi par défaut, ou relance)
  const isCommandeMail = offre?.type_document === "Commande"
  const mailBody = mailType === "envoi"
    ? (isCommandeMail ? mailEnvoiCommande : mailEnvoi)
    : (isCommandeMail ? mailRelanceCommande : mailRelance)
  const mailSubject = mailType === "envoi"
    ? (isCommandeMail
        ? `Confirmation de votre commande Jardin-Confort ${offre?.numero_affiche || ""}`
        : `Votre offre Jardin-Confort ${offre?.numero_affiche || ""}`)
    : (isCommandeMail
        ? `Rappel acompte — Commande Jardin-Confort ${offre?.numero_affiche || ""}`
        : `Suivi de votre offre Jardin-Confort ${offre?.numero_affiche || ""}`)

  if(loading) return (
    <main className="min-h-screen bg-[#1f2125] px-6 py-8 text-zinc-100">
      <div className="mx-auto max-w-[1800px] rounded-2xl border border-white/10 bg-[#2a2d31] p-8 text-zinc-400">Chargement…</div>
    </main>
  )
  if(error||!offre) return (
    <main className="min-h-screen bg-[#1f2125] px-6 py-8 text-zinc-100">
      <div className="mx-auto max-w-[1800px] rounded-2xl border border-red-500/20 bg-[#2a2d31] p-8 text-red-300">Impossible de charger le dossier. {error}</div>
    </main>
  )

  const days=getDaysOpen(offre)
  const d=offre.data as Record<string,unknown>
  const urlPublique=`${APP_URL}/offre/${offre.slug}`
  const urlPrint=`${APP_URL}/print/offre/${offre.slug}`
  const isAbandonne=offre.statut==="Abandonnée"
  // isOffre = vraie offre encore "ouverte" (utilisée pour afficher les boutons Convertir / Abandonner)
    const isOffre=offre.type_document==="Offre"&&!["Convertie","Acceptée"].includes(offre.statut)
    // isTypeOffre = simplement le type du document (utilisé pour les libellés des boutons Pages web / Documents PDF)
    const isTypeOffre = offre.type_document === "Offre"
const isCommande = offre.type_document === "Commande" || ["Acceptée", "Convertie"].includes(offre.statut)
    // isCommandeReelle = true uniquement pour les CMD-XXXXX (pas pour les offres converties)
    // → utilisée pour décider si on affiche les boutons fiche de travail / bulletin / page de garde / Print All
    const isCommandeReelle = offre.type_document === "Commande"
    const isCommandeDirecte = offre.type_document === "Commande" && !offre.offre_origine

  return (
    <main className="min-h-screen bg-[#1f2125] px-6 py-8 text-zinc-100">
      <div className="mx-auto max-w-[1800px] space-y-6">

        {/* TOP */}
        <div className="rounded-2xl border border-white/10 bg-[#2a2d31] p-6">
          <div className="grid gap-6 lg:grid-cols-2">

            {/* ═══ COLONNE GAUCHE : NAVIGATION + OUTILS + DOSSIER ═══ */}
            <div className="space-y-4">

              {/* Groupe 1 — Navigation & contact */}
              <div>
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Navigation & contact
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Link href="/dashboard"
                    className="inline-flex items-center rounded-xl border border-white/10 bg-[#34383d] px-4 py-2 text-sm text-zinc-100 transition hover:bg-[#40454b]">
                    ← Retour au dashboard
                  </Link>
                  {offre.client_email && (
                    <button type="button" disabled={relancing}
                      onClick={async () => {
                        await enregistrerRelance()
                        window.location.href = `mailto:${offre.client_email}?subject=${encodeURIComponent(`Suivi offre ${offre.numero_affiche}`)}&body=${encodeURIComponent(mailRelance)}`
                      }}
                      className="inline-flex items-center rounded-xl border border-white/10 bg-[#34383d] px-4 py-2 text-sm text-zinc-100 transition hover:bg-[#40454b] disabled:opacity-50">
                      ✉ Email relance
                    </button>
                  )}
                </div>
              </div>

              {/* Groupe 4 — Outils internes */}
              {isCommandeReelle && (
                <div>
                  <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    Outils internes
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href="/dashboard/stock-movements"
                      className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-[#34383d] px-4 py-2 text-sm text-zinc-300 transition hover:bg-[#40454b]"
                      title="Voir tous les mouvements de stock Shopify">
                      📦 Stock Shopify
                    </Link>
                  </div>
                </div>
              )}

              {/* Bloc dossier (logo + numéro + statut + badges + montant) */}
              <div className="pt-2 flex flex-wrap items-start justify-between gap-4">
                <div className="flex items-start gap-4">
                  <img src="https://cdn.shopify.com/s/files/1/0360/3251/2135/files/picto_jardin_confort_apple_low.png?v=1775944940" alt="" className="h-16 w-16 rounded-xl object-contain"/>
                  <div>
                    <div className="text-sm text-zinc-400">Dossier</div>
                    <h1 className="mt-1 text-3xl font-semibold">{offre.numero_affiche}</h1>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${getStatusColor(offre.statut,offre.type_document)}`}>{offre.statut}</span>
                      <span className="text-sm text-zinc-400">{offre.type_document}</span>
                      {days!==null&&(
                        <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${getDaysBadgeColor(days)}`}>{days} jour{days>1?"s":""} ouvert</span>
                      )}
                      {probabilite!=="neutre"&&(
                        <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${probabilite==="forte"?"bg-emerald-500/15 text-emerald-300":probabilite==="moyenne"?"bg-amber-500/15 text-amber-300":"bg-rose-500/15 text-rose-300"}`}>
                          {probabilite==="forte"?"🟢 Forte":probabilite==="moyenne"?"🟡 Moyenne":"🔴 Faible"}
                        </span>
                      )}
                      {/* Livraison (commandes magasin) — équivalent du fulfilled Shopify */}
                      {offre.type_document==="Commande"&&(
                        offre.statut_livraison==="livree" ? (
                          <span className="inline-flex items-center rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-medium text-emerald-300">
                            🚚 Livrée{offre.date_livraison?` le ${fmtDate(offre.date_livraison)}`:""}
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-amber-500/15 px-3 py-1 text-xs font-medium text-amber-300">
                            ⏳ À livrer
                          </span>
                        )
                      )}
                    </div>
                    {/* Bouton livraison : un clic une fois la marchandise remise/livrée.
                        Le suivi des délais fournisseurs suit automatiquement (trigger). */}
                    {offre.type_document==="Commande"&&(
                      <div className="mt-2">
                        {offre.statut_livraison==="livree" ? (
                          <button type="button" onClick={()=>changeLivraison("ouverte")} disabled={livraisonSaving}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-[#34383d] px-3 py-1.5 text-xs text-zinc-300 transition hover:bg-[#40454b] disabled:opacity-50"
                            title="Rouvrir la commande (clic par erreur) — la ligne revient dans le suivi des délais">
                            ↩ Rouvrir la livraison
                          </button>
                        ) : (
                          <button type="button" onClick={()=>changeLivraison("livree")} disabled={livraisonSaving}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-400/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/25 hover:border-emerald-400/60 disabled:opacity-50"
                            title="Marquer la commande comme livrée au client — équivalent du fulfilled Shopify. La ligne sort du suivi des délais fournisseurs.">
                            {livraisonSaving?"…":"✅ Marquer livrée"}
                          </button>
                        )}
                      </div>
                    )}
                    {/* Badge inverse : sur une offre convertie, lien vers la commande générée */}
                    {commandeIssue && (
                      <div className="mt-2">
                        <a href={`/dashboard/${commandeIssue.slug}`}
                          title={`Voir la commande générée ${commandeIssue.numero}`}
                          className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/40 bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/25 hover:border-emerald-400/60">
                          <span>✅ Convertie en commande</span>
                          <span className="font-bold">{commandeIssue.numero}</span>
                          <span className="text-emerald-400/70">→</span>
                        </a>
                      </div>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-3xl font-bold text-zinc-100">{fmtMoney(offre.total_ttc)}</div>
                  <div className="mt-1 text-sm text-zinc-400">{offre.payment_mode||"—"}</div>
                  <div className="mt-1 text-sm text-zinc-500">{offre.nb_articles} article{offre.nb_articles!==1?"s":""}</div>
                </div>
              </div>

            </div>
            {/* ═══ FIN COLONNE GAUCHE ═══ */}

            {/* ═══ COLONNE DROITE : PAGES WEB + DOCUMENTS PDF ═══ */}
            <div className="space-y-4">

              {/* Groupe 2 — Pages web (bleu) */}
              <div>
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-sky-400/70">
                  Pages web <span className="ml-1 text-[10px] font-normal normal-case text-zinc-500">à consulter / partager</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {!isCommandeDirecte && (
                    <a href={urlPublique} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-2 text-sm text-sky-300 transition hover:bg-sky-500/20">
                      👁 {isTypeOffre ? "Page validation offre" : "Page confirmation client"}
                    </a>
                  )}
                  <a href={urlPrint} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-2 text-sm text-sky-300 transition hover:bg-sky-500/20">
                    🖨 {isTypeOffre ? "Page de l\u0027offre" : "Page commande client"}
                  </a>
                  {isCommandeReelle && (
                    <>
                      <a href={`${APP_URL}/print/bulletin-livraison/${offre.slug}`} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-2 text-sm text-sky-300 transition hover:bg-sky-500/20"
                        title="Bulletin de livraison sans prix (à joindre au colis)">
                        🚚 Bulletin livraison
                      </a>
                      <a href={`${APP_URL}/print/page-garde-colis/${offre.slug}`} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-2 text-sm text-sky-300 transition hover:bg-sky-500/20"
                        title="Page de garde A4 pour envoi de colis">
                        📦 Page de garde colis
                      </a>
                      <a href={`${APP_URL}/print/fiche-bleue/${offre.slug}`} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center rounded-xl border border-blue-400/40 bg-blue-500/15 px-4 py-2 text-sm text-blue-200 transition hover:bg-blue-500/25"
                        title="Fiche bleue archive — 1 page A4 condensée pour le classeur papier">
                        🗂 Fiche bleue archive
                      </a>
                      <a href={`${APP_URL}/print/all/${offre.slug}`} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center rounded-xl border-2 border-sky-500/60 bg-sky-500/20 px-4 py-2 text-sm font-bold text-sky-200 transition hover:bg-sky-500/30"
                        title="Imprime les 5 documents en un seul jeu : Fiche de travail → Commande → Page de garde → Bulletin → Fiche bleue archive">
                        🖨 Imprimer le jeu complet
                      </a>
                    </>
                  )}
                </div>
              </div>

              {/* Groupe 3 — Documents PDF (vert) */}
              <div>
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-400/70">
                  Documents PDF <span className="ml-1 text-[10px] font-normal normal-case text-zinc-500">à télécharger / archiver</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {/* Chantier « PDF de commande toujours à jour » (23.08.2026) :
                      pour une COMMANDE, ce bouton régénère puis ouvre — jamais
                      le fichier Storage périmé. Une offre garde le lien direct. */}
                  {!isTypeOffre ? (
                    <button onClick={ouvrirPdfAJour} disabled={pdfOpening}
                      title="Régénère le PDF depuis la page commande client, puis l'ouvre — toujours la version courante"
                      className="inline-flex items-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-50">
                      {pdfOpening ? "📄 Génération…" : "📄 Commande PDF"}
                    </button>
                  ) : pdfUrl ? (
                    <a href={pdfUrl} target="_blank" rel="noopener noreferrer" download
                      className="inline-flex items-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300 transition hover:bg-emerald-500/20">
                      📄 Offre PDF
                    </a>
                  ) : (
                    <button onClick={generatePdf} disabled={pdfGenerating}
                      className="relative inline-flex items-center overflow-hidden rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-2 text-sm text-emerald-300/70 transition hover:bg-emerald-500/15 disabled:opacity-80">
                      {pdfGenerating && (
                        <span className="absolute inset-0 overflow-hidden rounded-xl">
                          <span className="absolute inset-y-0 left-0 animate-[progress_8s_ease-in-out_forwards] bg-emerald-500/30" />
                        </span>
                      )}
                      <span className="relative">{pdfGenerating ? "📄 Génération…" : "📄 Générer offre PDF"}</span>
                    </button>
                  )}
                  {/* Pour une COMMANDE : le montant et le débiteur peuvent avoir
                      changé (révision, correction) — on régénère avant d'ouvrir. */}
                  {!isTypeOffre ? (
                    <button onClick={ouvrirQrAJour} disabled={qrGenerating}
                      title="Régénère le QR au montant courant de la commande, puis l'ouvre"
                      className="inline-flex items-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-50">
                      {qrGenerating ? "⏳ Génération QR…" : "🧾 QR paiement"}
                    </button>
                  ) : qrUrl ? (
                    <a href={qrUrl} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300 transition hover:bg-emerald-500/20">
                      🧾 QR paiement
                    </a>
                  ) : (
                    <button onClick={generateQr} disabled={qrGenerating}
                      className="relative inline-flex items-center overflow-hidden rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-2 text-sm text-emerald-300/70 transition hover:bg-emerald-500/15 disabled:opacity-80">
                      {qrGenerating && (
                        <span className="absolute inset-0 overflow-hidden rounded-xl">
                          <span className="absolute inset-y-0 left-0 animate-[progress_12s_ease-in-out_forwards] bg-emerald-500/30" />
                        </span>
                      )}
                      <span className="relative">{qrGenerating ? "⏳ Génération QR…" : "🧾 Générer QR paiement"}</span>
                    </button>
                  )}
                  {isCommandeReelle && (
                    <>
                      {/* Fiche INITIALE : pièce d'archive, pas un document de
                          travail — bouton retiré d'ici le 23.08.2026 (risque :
                          préparer une livraison sur la V1 après une révision).
                          Reste accessible dans la carte « Fiche de travail »,
                          onglet Initiale. Ne subsiste que le RATTRAPAGE pour
                          les anciennes commandes sans fiche initiale. */}
                      {!ficheTravailInitialUrl && (
                        <button onClick={() => generateFicheTravail("initial")} disabled={ficheTravailGenerating}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-2 text-sm text-emerald-300/70 transition hover:bg-emerald-500/15 disabled:opacity-80"
                          title="Cette commande n'a pas de fiche initiale archivée — la générer une fois (stock du jour de la commande, figé ensuite)">
                          {ficheTravailGenerating ? "📋 Génération…" : "📋 Générer fiche de travail initiale PDF"}
                        </button>
                      )}
                      <button onClick={() => generateFicheTravail("current")} disabled={ficheTravailGenerating}
                        className="relative inline-flex items-center gap-1.5 overflow-hidden rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-300 transition hover:bg-amber-500/20 disabled:opacity-80"
                        title="Régénère la fiche au contenu actuel de la commande (révisions et corrections comprises). Les stocks affichés restent figés ligne par ligne, chacun à sa date — jamais le stock du jour. Pour la prépa/livraison.">
                        {ficheTravailGenerating && (
                          <span className="absolute inset-0 overflow-hidden rounded-xl">
                            <span className="absolute inset-y-0 left-0 animate-[progress_8s_ease-in-out_forwards] bg-emerald-500/30" />
                          </span>
                        )}
                        <span className="relative">
                          {ficheTravailGenerating
                            ? "🔄 Génération…"
                            : ficheTravailUrl
                              ? "🔄 Régénérer fiche de travail — commande actuelle PDF"
                              : "🔄 Générer fiche de travail — commande actuelle PDF"}
                        </span>
                      </button>
                    </>
                  )}
                </div>
              </div>

            </div>
            {/* ═══ FIN COLONNE DROITE ═══ */}

          </div>
        </div>

        {/* GRILLE */}
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_660px]">

          {/* Gauche */}
          <div className="space-y-6">

            <div className="grid gap-6 lg:grid-cols-2">
              <section className="rounded-2xl border border-white/10 bg-[#2a2d31] p-6">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-xl font-semibold">Client</h2>
                  {clientId ? (
                    <a href={`/dashboard/clients/${clientId}`} target="_blank" rel="noopener noreferrer"
                      className="rounded-xl border border-[#2B8AD1]/30 bg-[#2B8AD1]/10 px-3 py-1.5 text-xs text-sky-300 hover:bg-[#2B8AD1]/20">
                      👤 Voir la fiche →
                    </a>
                  ) : (
                    <a href={`/dashboard/clients?q=${encodeURIComponent(offre.client_email||offre.client_nom||"")}`}
                      target="_blank" rel="noopener noreferrer"
                      className="rounded-xl border border-white/10 bg-[#34383d] px-3 py-1.5 text-xs text-zinc-400 hover:bg-[#40454b]"
                      title="Aucune fiche client trouvée">
                      👤 Pas de fiche
                    </a>
                  )}
                </div>
                <div className="mb-4 flex flex-wrap gap-2">
                  <button type="button" onClick={()=>copyAddress("fact")}
                    className="rounded-lg border border-white/10 bg-[#34383d] px-3 py-1.5 text-xs text-zinc-300 hover:bg-[#40454b] transition"
                    title="Copier l'adresse de facturation au presse-papier">
                    {addrCopied==="fact" ? "✓ Copiée" : "📋 Copier adresse"}
                  </button>
                  {((d.livrDiff as boolean) || (d.livrRue as string)) ? (
                    <button type="button" onClick={()=>copyAddress("livr")}
                      className="rounded-lg border border-white/10 bg-[#34383d] px-3 py-1.5 text-xs text-zinc-300 hover:bg-[#40454b] transition"
                      title="Copier l'adresse de livraison au presse-papier">
                      {addrCopied==="livr" ? "✓ Copiée" : "📦 Copier livraison"}
                    </button>
                  ) : null}
                </div>
                <div className="space-y-2 text-sm">
                  {([["Nom",nomClient(offre)],["Société",offre.client_societe],["Tél.",offre.client_tel1],
                    ["Rue",[offre.client_rue,(d.numero as string)||""].filter(Boolean).join(" ")],
                    ["NPA / Ville",[offre.client_npa,offre.client_ville].filter(Boolean).join(" ")],
                  ] as [string,string|null][]).map(([k,v])=>(
                    <div key={k} className="flex gap-2">
                      <span className="w-24 shrink-0 text-zinc-400">{k} :</span>
                      <span>{v||"—"}</span>
                    </div>
                  ))}
                  <div className="flex gap-2 items-center">
                    <span className="w-24 shrink-0 text-zinc-400">Email :</span>
                    <span className="flex-1">{offre.client_email||"—"}</span>
                    {offre.client_email&&(
                      <button
                        onClick={()=>{
                          navigator.clipboard.writeText(offre.client_email!)
                          setEmailCopied(true)
                          setTimeout(()=>setEmailCopied(false),2000)
                        }}
                        className="rounded-lg border border-white/10 bg-[#34383d] px-2 py-0.5 text-xs text-zinc-400 hover:bg-[#40454b] hover:text-zinc-100 transition"
                        title="Copier l'email">
                        {emailCopied ? "✓ Copié" : "📋"}
                      </button>
                    )}
                  </div>
                </div>
              </section>

              <section className="rounded-2xl border border-white/10 bg-[#2a2d31] p-6">
                <h2 className="mb-4 text-xl font-semibold">Offre</h2>
                <div className="space-y-2 text-sm">
                  {([["Conseiller",offre.commercial],["Date",fmtDate(offre.date_document)],
                    ["Paiement",offre.payment_mode],["Livraison",offre.delivery_mode||(d.deliveryMode as string)],
                    ["Délai",offre.lead_time||(d.leadTime as string)],["Référence",(d.reference as string)],
                    ["Articles",String(offre.nb_articles||0)],
                  ] as [string,string|null|undefined][]).map(([k,v])=>(
                    <div key={k} className="flex gap-2">
                      <span className="w-24 shrink-0 text-zinc-400">{k} :</span>
                      <span>{v||"—"}</span>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            {isCommandeReelle && <StockMovementsBlock slug={slug} />}

            {/* PROBABILITÉ DE CLOSING */}
            <section className="rounded-2xl border border-white/10 bg-[#2a2d31] p-6">
              <h2 className="mb-4 text-xl font-semibold">Probabilité de closing</h2>
              <div className="flex gap-3">
                {[
                  { val: "forte",   label: "🟢 Forte",   bg: "bg-emerald-500/15 border-emerald-500/40 text-emerald-300" },
                  { val: "moyenne", label: "🟡 Moyenne", bg: "bg-amber-500/15 border-amber-500/40 text-amber-300" },
                  { val: "faible",  label: "🔴 Faible",  bg: "bg-rose-500/15 border-rose-500/40 text-rose-300" },
                  { val: "neutre",  label: "⚪ Neutre",  bg: "bg-white/5 border-white/20 text-zinc-400" },
                ].map(({ val, label, bg }) => (
                  <button key={val} onClick={() => saveProbabilite(val)} disabled={probSaving}
                    className={`flex-1 rounded-xl border px-4 py-3 text-sm font-semibold transition ${probabilite === val ? bg + " ring-2 ring-offset-1 ring-offset-[#2a2d31] ring-white/20 scale-105" : "border-white/10 bg-[#34383d] text-zinc-400 hover:bg-[#40454b]"}`}>
                    {label}
                  </button>
                ))}
              </div>
            </section>

            <section className="rounded-2xl border border-white/10 bg-[#2a2d31] p-6">
              <h2 className="mb-4 text-xl font-semibold">Montants</h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {([["Sous-total",fmtMoney(offre.sous_total)],["Remise",offre.remise_chf>0?`− ${fmtMoney(offre.remise_chf)}`:"—"],
                  ["Services",offre.services_total>0?fmtMoney(offre.services_total):"—"],["TVA 8.1%",fmtMoney(offre.tva_montant)],
                ] as [string,string][]).map(([k,v])=>(
                  <div key={k} className="rounded-xl border border-white/10 bg-black/10 p-4">
                    <div className="text-xs text-zinc-400">{k}</div>
                    <div className="mt-2 text-lg font-semibold text-zinc-100">{v}</div>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex items-center justify-between rounded-xl border border-white/10 bg-[#2B8AD1]/10 px-6 py-4">
                <span className="text-lg font-semibold text-zinc-100">TOTAL TTC</span>
                <span className="text-2xl font-bold text-white">{fmtMoney(offre.total_ttc)}</span>
              </div>
            </section>

            {offre.remarques&&(
              <section className="rounded-2xl border border-white/10 bg-[#2a2d31] p-6">
                <h2 className="mb-3 text-xl font-semibold">Remarques client</h2>
                <p className="whitespace-pre-wrap text-sm text-zinc-300">{offre.remarques}</p>
              </section>
            )}

            <section className="rounded-2xl border border-white/10 bg-[#2a2d31] p-6">
              <div className="mb-4">
                <h2 className="text-xl font-semibold">Suivi commercial</h2>
              </div>

              <div className="mb-4 flex flex-wrap gap-2 rounded-xl border border-white/10 bg-black/10 p-4">
                <button
                  type="button"
                  onClick={() => setCorrectionDrawerOpen(true)}
                  className="rounded-xl border border-sky-500/30 bg-sky-500/15 px-4 py-2 text-sm text-sky-300 transition hover:bg-sky-500/20"
                  title="Corriger les champs cosmétiques (adresses, téléphones, notes)"
                >
                  ✏️ Corriger
                </button>
                {offre.type_document === "Commande" && (
                  <a
                  href={`/dashboard/${offre.slug}/reviser`}
                    className="rounded-xl border border-amber-500/30 bg-amber-500/15 px-4 py-2 text-sm text-amber-300 transition hover:bg-amber-500/20"
                    title="Réviser la commande (prix, quantité, articles) avec piste d'audit"
                  >
                    🔄 Réviser
                  </a>
                )}
                {isOffre&&(
                  <>
                    <button type="button" onClick={convertirEnCommande} disabled={converting}
                      className="rounded-xl border border-emerald-500/30 bg-emerald-500/15 px-4 py-2 text-sm text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-50">
                      {converting ? "Conversion…" : "✅ Convertir en commande"}
                    </button>
                    <button type="button" onClick={()=>{if(confirm("Confirmer l'abandon ?")) changeStatut("Abandonnée")}}
                      className="rounded-xl border border-rose-500/30 bg-rose-500/15 px-4 py-2 text-sm text-rose-300 transition hover:bg-rose-500/20">
                      Abandonner l&apos;offre
                    </button>
                  </>
                )}
                {isAbandonne&&(
                  <>
                    <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-2 text-sm text-rose-300">
                      Abandonnée le {fmtDate(offre.date_abandon)}
                    </div>
                    <button type="button" onClick={()=>{if(confirm("Confirmer la réactivation ?")) changeStatut("En cours")}}
                      className="rounded-xl border border-emerald-500/30 bg-emerald-500/15 px-4 py-2 text-sm text-emerald-300 transition hover:bg-emerald-500/20">
                      Réactiver l&apos;offre
                    </button>
                  </>
                )}
                {offre.client_email&&(
                  <button type="button" disabled={relancing}
                    onClick={async()=>{
                      await enregistrerRelance()
                      window.location.href=`mailto:${offre.client_email}?subject=${encodeURIComponent(`Suivi offre ${offre.numero_affiche}`)}&body=${encodeURIComponent(mailRelance)}`
                    }}
                    className="rounded-xl border border-sky-500/30 bg-sky-500/15 px-4 py-2 text-sm text-sky-300 transition hover:bg-sky-500/20 disabled:opacity-50">
                    ✉ Mail de relance
                  </button>
                )}
                {isOffre&&(
                  <button type="button" onClick={enregistrerRelance} disabled={relancing}
                    className="rounded-xl border border-amber-500/30 bg-amber-500/15 px-4 py-2 text-sm text-amber-300 transition hover:bg-amber-500/20 disabled:opacity-50">
                    {relancing ? "Enregistrement…" : "📧 Enregistrer relance"}
                  </button>
                )}
                {relanceStatus&&(
                  <div className={`w-full rounded-xl px-4 py-2 text-sm ${relanceStatus.startsWith("✅") ? "border border-emerald-500/20 bg-emerald-500/10 text-emerald-300" : "border border-rose-500/20 bg-rose-500/10 text-rose-300"}`}>{relanceStatus}</div>
                )}
              </div>

              {saveStatus&&(
                <div className={`mb-4 rounded-xl px-4 py-3 text-sm ${saveKind==="success"?"border border-emerald-500/20 bg-emerald-500/10 text-emerald-300":saveKind==="error"?"border border-rose-500/20 bg-rose-500/10 text-rose-300":"border border-white/10 bg-black/10 text-zinc-300"}`}>
                  {saveStatus}
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label className="mb-2 block text-sm text-zinc-400">Note commerciale</label>
                  <textarea value={noteCommerciale} onChange={e=>setNoteCommerciale(e.target.value)} rows={4}
                    className="w-full rounded-xl border border-white/10 bg-[#1f2125] px-4 py-3 text-sm text-zinc-100 outline-none"/>
                  <button type="button" onClick={saveNotes} disabled={saving}
                    className="mt-2 rounded-xl border border-white/10 bg-[#34383d] px-4 py-2 text-sm text-zinc-100 transition hover:bg-[#40454b] disabled:opacity-50">
                    {saving ? "Enregistrement…" : "💾 Enregistrer"}
                  </button>
                </div>
                <div>
                  <label className="mb-2 flex items-center gap-2 text-sm">
                    <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30">🔒 Interne</span>
                    <span className="text-zinc-400">Notes internes <span className="text-zinc-600 text-xs">(non visibles par le client)</span></span>
                  </label>
                  <textarea value={notesInternes} onChange={e=>setNotesInternes(e.target.value)} rows={4}
                    className="w-full rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-3 text-sm text-zinc-100 outline-none focus:border-amber-500/50 focus:ring-2 focus:ring-amber-500/10"/>
                  <button type="button" onClick={saveNotes} disabled={saving}
                    className="mt-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-300 transition hover:bg-amber-500/20 disabled:opacity-50">
                    {saving ? "Enregistrement…" : "💾 Enregistrer"}
                  </button>
                </div>
              </div>
            </section>

<CorrectionsHistoryBlock entityType={offre.type_document === "Commande" ? "commande" : "offre"} entitySlug={slug} />
{offre.type_document === "Commande" && <RevisionsHistoryBlock commandeSlug={slug} />}

            <section className="rounded-2xl border border-white/10 bg-[#2a2d31] p-6">
              <div className="mb-3 flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <h2 className="text-xl font-semibold">Modèle d&apos;email</h2>
                  <p className="mt-1 text-xs text-zinc-500">Sélectionne le modèle, puis copie ou ouvre directement dans ton client mail</p>
                </div>
                <div className="inline-flex rounded-xl border border-white/10 bg-[#34383d] p-1 text-xs">
                  <button
                    onClick={() => setMailType("envoi")}
                    className={`rounded-lg px-3 py-1.5 font-medium transition ${
                      mailType === "envoi"
                        ? "bg-sky-500/25 text-sky-200"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}>
                    {isCommandeMail ? "📧 Envoi de la commande" : "📧 Envoi de l'offre"}
                  </button>
                  <button
                    onClick={() => setMailType("relance")}
                    className={`rounded-lg px-3 py-1.5 font-medium transition ${
                      mailType === "relance"
                        ? "bg-amber-500/25 text-amber-200"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}>
                    {isCommandeMail ? "🔔 Rappel acompte" : "🔔 Relance"}
                  </button>
                </div>
              </div>

              <div className="mb-3 flex flex-wrap items-center gap-2">
                <button
                  onClick={async () => {
                    try {
                      // Copie le HTML formaté + une version texte de fallback
                      // pour que Thunderbird/Outlook/Gmail le collent en HTML rendu
                      const blobHtml = new Blob([mailBody], { type: "text/html" })
                      const blobText = new Blob([mailBody], { type: "text/plain" })
                      await navigator.clipboard.write([
                        new ClipboardItem({
                          "text/html": blobHtml,
                          "text/plain": blobText,
                        }),
                      ])
                      setMailCopied(true)
                      setTimeout(() => setMailCopied(false), 2500)
                    } catch (err) {
                      // Fallback (vieux navigateurs ou contexte non sécurisé)
                      console.error("Clipboard HTML failed, fallback to text:", err)
                      navigator.clipboard.writeText(mailBody)
                      setMailCopied(true)
                      setTimeout(() => setMailCopied(false), 2500)
                    }
                  }}
                  className="rounded-xl border border-white/10 bg-[#34383d] px-4 py-2 text-sm text-zinc-300 hover:bg-[#40454b]">
                  {mailCopied ? "✓ HTML copié" : "📋 Copier le mail HTML"}
                </button>
                {offre.client_email && (
                  <a
                    href={`mailto:${offre.client_email}?subject=${encodeURIComponent(mailSubject)}`}
                    title="Ouvre ton client mail avec destinataire + sujet pré-remplis. Colle ensuite le HTML copié dans le corps."
                    className="rounded-xl border border-sky-500/30 bg-sky-500/15 px-4 py-2 text-sm text-sky-300 hover:bg-sky-500/25">
                    ✉ Ouvrir mailto vers {offre.client_email}
                  </a>
                )}

                <span className="text-xs text-zinc-500">
                  Sujet : <span className="text-zinc-400">{mailSubject}</span>
                </span>
              </div>

              <div className="mb-3 rounded-lg border border-sky-500/20 bg-sky-500/5 px-3 py-2 text-xs text-sky-300/90">
                💡 <strong>Workflow conseillé :</strong> 1) Clique sur <strong>📋 Copier le mail HTML</strong> · 2) Clique sur <strong>✉ Ouvrir mailto</strong> pour ouvrir Thunderbird avec destinataire + sujet · 3) Dans le corps du mail, fais <kbd className="rounded bg-white/10 px-1.5 py-0.5 font-mono">Ctrl+V</kbd> — le mail s&apos;affichera avec son design complet.
              </div>

              {/* Aperçu : conteneur sombre, contenu HTML en clair (comme l'email réel) */}
              <div className="rounded-xl border border-white/10 bg-[#1a1c1f] p-3">
                <div className="rounded-lg border border-white/5 bg-white overflow-hidden" style={{minHeight:200}}>
                  <iframe srcDoc={mailBody} title="Aperçu email" className="w-full border-0" style={{height:560}}/>
                </div>
              </div>
            </section>
          </div>

          {/* Droite — aperçus */}
          <div className="space-y-6 xl:sticky xl:top-6 xl:self-start">

            {/* Pour les OFFRES : aperçu page dynamique avec stock live (utile au commercial)
                Pour les COMMANDES : aperçu PDF figé (preuve juridique du stock vu par le client) */}
            {isTypeOffre ? (
              <section className="rounded-2xl border border-white/10 bg-[#2a2d31] p-6">
                <div className="mb-4 flex items-center justify-between gap-2 flex-wrap">
                  <h2 className="text-xl font-semibold flex items-center gap-2">
                    Aperçu offre
                    <span className="text-xs font-normal text-emerald-300/70 bg-emerald-500/10 border border-emerald-500/20 rounded px-2 py-0.5" title="Le stock est rechargé à chaque ouverture, contrairement au PDF figé">
                      🔄 Stock dynamique
                    </span>
                  </h2>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(urlPrint)
                        const btn = document.activeElement as HTMLButtonElement
                        if (btn) {
                          const original = btn.innerText
                          btn.innerText = "✓ Copié"
                          setTimeout(() => { btn.innerText = original }, 2000)
                        }
                      }}
                      className="rounded-xl border border-white/10 bg-[#34383d] px-3 py-1.5 text-xs text-zinc-100 hover:bg-[#40454b]"
                      title="Copier l'URL d'aperçu">
                      🔗 Copier l&apos;URL
                    </button>
                    <a href={urlPrint} target="_blank" rel="noopener noreferrer"
                      className="rounded-xl border border-sky-500/30 bg-sky-500/15 px-3 py-1.5 text-xs text-sky-300 hover:bg-sky-500/25"
                      title="Ouvrir la page en plein écran">
                      ⛶ Plein écran
                    </a>
                    {pdfUrl && (
                      <a href={pdfUrl} target="_blank" rel="noopener noreferrer" download
                        className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-300 hover:bg-emerald-500/20"
                        title="Télécharger le PDF figé">
                        📄 PDF
                      </a>
                    )}
                  </div>
                </div>
                <div className="overflow-hidden rounded-2xl border border-white/10 bg-white">
                  <iframe src={urlPrint} title="Aperçu offre" className="h-[900px] w-full border-0"/>
                </div>
              </section>
            ) : (
              /* Chantier « PDF de commande toujours à jour » (23.08.2026).
                 La carte affiche la page commande client (contenu à jour,
                 corrections et révisions comprises) — les stocks affichés
                 restent figés J0 : /api/offres/[slug] renvoie pour une
                 commande les lignes figées de data, jamais Shopify. */
              <section className="rounded-2xl border border-white/10 bg-[#2a2d31] p-6">
                <div className="mb-4 flex items-center justify-between gap-2 flex-wrap">
                  <h2 className="text-xl font-semibold flex items-center gap-2">
                    Aperçu commande
                    <span className="text-xs font-normal text-blue-300/70 bg-blue-500/10 border border-blue-500/20 rounded px-2 py-0.5" title="C'est la page commande client, relue à chaque ouverture : elle intègre les corrections et les révisions. Les niveaux de stock affichés restent ceux du jour de la commande.">
                      🔄 Page à jour · stock figé J0
                    </span>
                  </h2>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(urlPrint)
                        const btn = document.activeElement as HTMLButtonElement
                        if (btn) {
                          const original = btn.innerText
                          btn.innerText = "✓ Copié"
                          setTimeout(() => { btn.innerText = original }, 2000)
                        }
                      }}
                      className="rounded-xl border border-white/10 bg-[#34383d] px-3 py-1.5 text-xs text-zinc-100 hover:bg-[#40454b]"
                      title="Copier l'URL de la page commande client">
                      🔗 Copier l&apos;URL
                    </button>
                    <a href={urlPrint} target="_blank" rel="noopener noreferrer"
                      className="rounded-xl border border-sky-500/30 bg-sky-500/15 px-3 py-1.5 text-xs text-sky-300 hover:bg-sky-500/25"
                      title="Ouvrir la page en plein écran">
                      ⛶ Plein écran
                    </a>
                    <button onClick={ouvrirPdfAJour} disabled={pdfOpening}
                      className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
                      title="Régénère le PDF depuis cette page, puis l'ouvre — le fichier envoyé au client est donc toujours la version courante">
                      {pdfOpening ? "📄 Génération…" : "📄 PDF à jour"}
                    </button>
                  </div>
                </div>
                {(((offre.data as Record<string,unknown>)?.stock_frozen_at as string) || offre.created_at) && (
                  <div className="mb-3 text-xs text-blue-300/80 bg-blue-500/5 border border-blue-500/20 rounded-lg px-3 py-2">
                    🔵 Stock figé à la commande · {new Date(((offre.data as Record<string,unknown>)?.stock_frozen_at as string) || offre.created_at as string).toLocaleString("fr-CH")}
                  </div>
                )}
                {pdfUrl && (
                  <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-500">
                    <span>
                      PDF en Storage
                      {pdfSnapshotAt ? ` · généré le ${new Date(pdfSnapshotAt).toLocaleString("fr-CH")}` : " · date de génération inconnue"}
                    </span>
                    <a href={pdfUrl} target="_blank" rel="noopener noreferrer" download className="underline hover:text-zinc-300">
                      fichier tel quel ↓
                    </a>
                    {pdfInitialUrl && (
                      <a href={pdfInitialUrl} target="_blank" rel="noopener noreferrer" download className="underline hover:text-zinc-300"
                        title="Le PDF tel qu'il était avant la première régénération">
                        version d&apos;origine ↓
                      </a>
                    )}
                  </div>
                )}
                <div className="overflow-hidden rounded-2xl border border-white/10 bg-white">
                  <iframe src={urlPrint} title="Aperçu commande" className="h-[900px] w-full border-0"/>
                </div>
              </section>
            )}

            {isCommandeReelle && (ficheTravailInitialUrl || ficheTravailUrl) && (
              <FicheTravailPreview
                initialUrl={ficheTravailInitialUrl}
                currentUrl={ficheTravailUrl}
                initialAt={ficheTravailInitialAt}
              />
            )}

            {/* Arrivages (chantier Arrivages, étape 3) : ce qui est déjà arrivé,
                ligne par ligne — distinct de la livraison au client ci-dessus. */}
            {isCommandeReelle && (
              <SuiviDelaisBlock numero={offre.numero_affiche} />
            )}
            {isCommandeReelle && (
              <ArrivagesBlock boutique="magasin" numero={offre.numero_affiche} />
            )}

            <AnnexesBlock
              entityType={offre.type_document === "Commande" ? "commande" : "offre"}
              entitySlug={slug}
              ajoutePar={offre.commercial}
            />

            {!isCommandeDirecte && (
              <section className="rounded-2xl border border-white/10 bg-[#2a2d31] p-6">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-xl font-semibold">Aperçu page client</h2>
                  <a href={urlPublique} target="_blank" rel="noopener noreferrer"
                    className="rounded-xl border border-white/10 bg-[#34383d] px-3 py-1.5 text-xs text-zinc-100 hover:bg-[#40454b]">Ouvrir ↗</a>
                </div>
                <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/20">
                  <iframe src={urlPublique} title="Aperçu" className="h-[900px] w-full border-0"/>
                </div>
              </section>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#2a2d31] p-4">
          <div className="flex flex-wrap gap-3">
            <Link href="/dashboard" className="inline-flex items-center rounded-xl border border-white/10 bg-[#34383d] px-4 py-2 text-sm text-zinc-100 hover:bg-[#40454b]">← Retour au dashboard</Link>
            <Link href="/drafts/nouveau" target="_blank" rel="noopener noreferrer" className="inline-flex items-center rounded-xl border border-white/10 bg-[#34383d] px-4 py-2 text-sm text-zinc-100 hover:bg-[#40454b]">+ Nouveau brouillon</Link>
            {offre && (
              <Link href={`/drafts/nouveau?prefill=${encodeURIComponent(JSON.stringify({
                nom: offre.client_nom||"", prenom: offre.client_prenom||"",
                societe: offre.client_societe||"",
                complement_nom: ((offre.data as Record<string,unknown>)?.complement_nom as string) || "",
                email: offre.client_email||"",
                telephone1: offre.client_tel1||"", rue: offre.client_rue||"",
                numero: ((offre.data as Record<string,unknown>)?.numero as string) || "",
                npa: offre.client_npa||"", ville: offre.client_ville||"",
                commercial: offre.commercial||"",
              }))}`} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center rounded-xl border border-[#2B8AD1]/40 bg-[#2B8AD1]/15 px-4 py-2 text-sm text-sky-300 hover:bg-[#2B8AD1]/25">
                👤 Brouillon même client
              </Link>
            )}
            {offre&&(
              <button onClick={()=>copierEnBrouillon(true)}
                className="inline-flex items-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300 hover:bg-emerald-500/20">
                📋 Copier {isTypeOffre ? "offre" : "commande"} complète en brouillon
              </button>
            )}
            {offre&&(
              <button onClick={()=>copierEnBrouillon(false)}
                className="inline-flex items-center rounded-xl border border-white/10 bg-[#34383d] px-4 py-2 text-sm text-zinc-300 hover:bg-[#40454b]">
                📋 Copie {isTypeOffre ? "offre" : "commande"} en brouillon sans client
              </button>
            )}
          </div>
        </div>

      </div>

      {/* Drawer de correction (Session 2 chantier corrections) */}
      {offre && (
        <CorrectionDrawer
          open={correctionDrawerOpen}
          entityType={offre.type_document === "Commande" ? "commande" : "offre"}
          entitySlug={slug}
          entityNumero={offre.numero_affiche}
          currentData={offre.data}
          onClose={() => setCorrectionDrawerOpen(false)}
          onSuccess={() => {
            // Recharger la page pour voir les nouvelles valeurs
            window.location.reload();
          }}
        />
      )}
    </main>
  )
}