"use client";
// app/dashboard/[slug]/page.tsx

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";

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
  const [qrUrl,setQrUrl]=useState<string|null>(null)
  const [qrGenerating,setQrGenerating]=useState(false)
  // ─── NOUVEAU : state pour la fiche de travail ───
  const [ficheTravailUrl, setFicheTravailUrl] = useState<string|null>(null)
  const [ficheTravailGenerating, setFicheTravailGenerating] = useState(false)
  // ────────────────────────────────────────────────
  const [relancing,setRelancing]=useState(false)
  const [relanceStatus,setRelanceStatus]=useState("")
  const [emailCopied,setEmailCopied]=useState(false)
  const [clientId,setClientId]=useState<number|null>(null)
  const [probabilite,setProbabilite]=useState<string>("neutre")
  const [probSaving,setProbSaving]=useState(false)
  const [converting,setConverting]=useState(false)

  async function pollPdf(slugToCheck: string) {
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 3000))
      try {
        const res = await fetch(`/api/offres/${slugToCheck}`)
        if (res.ok) {
          const json = await res.json()
          const url = (json.offre as Record<string,unknown>)?.pdf_url as string|null
          if (url) { setPdfUrl(url); setPdfGenerating(false); return }
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
          setPdfUrl(existingPdfUrl)
        } else {
          setPdfGenerating(true)
          pollPdf(s)
        }
        if ((o as unknown as Record<string,unknown>).qr_url) {
          setQrUrl((o as unknown as Record<string,unknown>).qr_url as string)
        }
        // ─── NOUVEAU : charger l'URL fiche travail si déjà générée ───
        if ((o as unknown as Record<string,unknown>).fiche_travail_pdf_url) {
          setFicheTravailUrl((o as unknown as Record<string,unknown>).fiche_travail_pdf_url as string)
        }
        // ──────────────────────────────────────────────────────────────
        if ((o as unknown as Record<string,unknown>).probabilite) {
          setProbabilite((o as unknown as Record<string,unknown>).probabilite as string)
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

  // ─── NOUVEAU : fonction de génération de la fiche de travail ───
  async function generateFicheTravail() {
    if(!slug) return
    setFicheTravailGenerating(true)
    try {
      const res = await fetch(`/api/offres/${slug}/fiche-travail-pdf`, { method: "POST" })
      const json = await res.json()
      if (res.ok && json.pdf_url) {
        setFicheTravailUrl(json.pdf_url)
        // Ouvrir directement le PDF dans un nouvel onglet
        window.open(json.pdf_url, "_blank")
      } else {
        alert("Erreur génération fiche de travail : " + (json.error || res.status))
      }
    } catch (e) {
      alert("Erreur réseau : " + (e as Error).message)
    } finally {
      setFicheTravailGenerating(false)
    }
  }
  // ────────────────────────────────────────────────────────────────

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

  function copierOffre(avecClient: boolean) {
    if(!offre) return
    const offreData = offre.data as Record<string,unknown>
    const prefill: Record<string,unknown> = {
      commercial: offre.commercial||"",
      lines: offreData.lines||[],
      discount: offreData.discount||"0",
      discountPercent: offreData.discountPercent||"0",
      enabledServices: offreData.enabledServices||{},
      servicePrices: offreData.servicePrices||{},
      leadTime: offreData.leadTime||"",
      paymentMode: offreData.paymentMode||"",
      deliveryMode: offreData.deliveryMode||"",
      remarks: offreData.remarks||"",
    }
    if(avecClient) {
      Object.assign(prefill, {
        nom: offre.client_nom||"", prenom: offre.client_prenom||"",
        societe: offre.client_societe||"", email: offre.client_email||"",
        telephone1: offre.client_tel1||"", rue: offre.client_rue||"",
        npa: offre.client_npa||"", ville: offre.client_ville||"",
      })
    }
    localStorage.setItem("jc-offre-copy", JSON.stringify(prefill))
    window.open(`/offres/nouveau?from_copy=1`, "_blank")
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

  const mailBody=useMemo(()=>{
    if(!offre) return ""
    const nomComplet=[offre.client_prenom, offre.client_nom].filter(Boolean).join(" ")
    const pdfUrl=`${APP_URL}/print/offre/${offre.slug}`
    const validationUrl=`${APP_URL}/offre/${offre.slug}`
    const total=new Intl.NumberFormat("fr-CH",{minimumFractionDigits:2,maximumFractionDigits:2}).format(offre.total_ttc||0)
    return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#F3F5F6;font-family:Verdana,Arial,Helvetica,sans-serif;">
<table border="0" width="100%" cellspacing="0" cellpadding="0" bgcolor="#F3F5F6"><tbody><tr><td align="center" style="padding:28px 16px;">

<table style="border-radius:16px;border:1px solid #E8EAF3;max-width:600px;width:100%;" border="0" cellspacing="0" cellpadding="0" bgcolor="#FFFFFF"><tbody>

<tr><td style="padding:28px 28px 6px 28px;text-align:center;">
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
  const isOffre=offre.type_document==="Offre"&&!["Convertie","Acceptée"].includes(offre.statut)
  // ─── NOUVEAU : afficher le bouton fiche de travail uniquement pour les commandes ───
  const isCommande = offre.type_document === "Commande" || ["Acceptée", "Convertie"].includes(offre.statut)

  return (
    <main className="min-h-screen bg-[#1f2125] px-6 py-8 text-zinc-100">
      <div className="mx-auto max-w-[1800px] space-y-6">

        {/* TOP */}
        <div className="rounded-2xl border border-white/10 bg-[#2a2d31] p-6">
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <Link href="/dashboard" className="inline-flex items-center rounded-xl border border-white/10 bg-[#34383d] px-4 py-2 text-sm text-zinc-100 transition hover:bg-[#40454b]">← Retour au dashboard</Link>
            {offre.client_email&&(
              <button type="button" disabled={relancing}
                onClick={async()=>{
                  await enregistrerRelance()
                  window.location.href=`mailto:${offre.client_email}?subject=${encodeURIComponent(`Suivi offre ${offre.numero_affiche}`)}&body=${encodeURIComponent(mailBody)}`
                }}
                className="inline-flex items-center rounded-xl border border-white/10 bg-[#34383d] px-4 py-2 text-sm text-zinc-100 transition hover:bg-[#40454b] disabled:opacity-50">
                ✉ Email relance
              </button>
            )}
            <a href={urlPublique} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center rounded-xl border border-white/10 bg-[#34383d] px-4 py-2 text-sm text-zinc-100 transition hover:bg-[#40454b]">👁 Page client</a>
            <a href={urlPrint} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center rounded-xl border border-white/10 bg-[#34383d] px-4 py-2 text-sm text-zinc-100 transition hover:bg-[#40454b]">🖨 Imprimer</a>
            {pdfUrl ? (
              <a href={pdfUrl} target="_blank" rel="noopener noreferrer" download
                className="inline-flex items-center rounded-xl border border-emerald-500/30 bg-emerald-500/15 px-4 py-2 text-sm text-emerald-300 transition hover:bg-emerald-500/20">
                📄 Télécharger PDF
              </a>
            ) : (
              <button onClick={generatePdf} disabled={pdfGenerating}
                className="relative inline-flex items-center overflow-hidden rounded-xl border border-white/10 bg-[#34383d] px-4 py-2 text-sm text-zinc-300 transition hover:bg-[#40454b] disabled:opacity-80">
                {pdfGenerating && (
                  <span className="absolute inset-0 overflow-hidden rounded-xl">
                    <span className="absolute inset-y-0 left-0 animate-[progress_8s_ease-in-out_forwards] bg-emerald-500/30"/>
                  </span>
                )}
                <span className="relative">{pdfGenerating ? "📄 Génération PDF…" : "📄 Générer PDF"}</span>
              </button>
            )}
            {qrUrl ? (
              <a href={qrUrl} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center rounded-xl border border-sky-500/30 bg-sky-500/15 px-4 py-2 text-sm text-sky-300 transition hover:bg-sky-500/20">
                🧾 QR paiement
              </a>
            ) : (
              <button onClick={generateQr} disabled={qrGenerating}
                className="relative inline-flex items-center overflow-hidden rounded-xl border border-white/10 bg-[#34383d] px-4 py-2 text-sm text-zinc-300 transition hover:bg-[#40454b] disabled:opacity-80">
                {qrGenerating && (
                  <span className="absolute inset-0 overflow-hidden rounded-xl">
                    <span className="absolute inset-y-0 left-0 animate-[progress_12s_ease-in-out_forwards] bg-[#2B8AD1]/30"/>
                  </span>
                )}
                <span className="relative">{qrGenerating ? "⏳ Génération QR…" : "🧾 Générer QR paiement"}</span>
              </button>
            )}

            {/* ─── NOUVEAU : bouton Fiche de travail (commandes uniquement) ─── */}
            {isCommande && (
              <>
                {ficheTravailUrl ? (
                  <a href={ficheTravailUrl} target="_blank" rel="noopener noreferrer" download
                    className="inline-flex items-center rounded-xl border border-amber-500/30 bg-amber-500/15 px-4 py-2 text-sm text-amber-300 transition hover:bg-amber-500/20">
                    📋 Fiche de travail
                  </a>
                ) : (
                  <button onClick={generateFicheTravail} disabled={ficheTravailGenerating}
                    className="relative inline-flex items-center overflow-hidden rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-300 transition hover:bg-amber-500/20 disabled:opacity-80">
                    {ficheTravailGenerating && (
                      <span className="absolute inset-0 overflow-hidden rounded-xl">
                        <span className="absolute inset-y-0 left-0 animate-[progress_8s_ease-in-out_forwards] bg-amber-500/30"/>
                      </span>
                    )}
                    <span className="relative">
                      {ficheTravailGenerating ? "📋 Génération…" : "📋 Générer fiche de travail"}
                    </span>
                  </button>
                )}
                {ficheTravailUrl && (
                  <button onClick={generateFicheTravail} disabled={ficheTravailGenerating}
                    className="inline-flex items-center rounded-xl border border-white/10 bg-[#34383d] px-3 py-2 text-xs text-zinc-400 transition hover:bg-[#40454b] disabled:opacity-50"
                    title="Régénérer la fiche avec le stock à jour">
                    {ficheTravailGenerating ? "⏳" : "🔄"}
                  </button>
                )}
              </>
            )}
            {/* ───────────────────────────────────────────────────────────────── */}
          </div>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex items-start gap-4">
              <img src="https://cdn.shopify.com/s/files/1/0360/3251/2135/files/picto_jardin_confort_apple_low.png?v=1775944940" alt="" className="h-16 w-16 rounded-xl object-contain"/>
              <div>
                <div className="text-sm text-zinc-400">Dossier</div>
                <h1 className="mt-2 text-3xl font-semibold">{offre.numero_affiche}</h1>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${getStatusColor(offre.statut,offre.type_document)}`}>{offre.statut}</span>
                  <span className="text-sm text-zinc-400">{offre.type_document}</span>
                  {offre.offre_origine&&<span className="text-sm text-zinc-500">Issu de : {offre.offre_origine}</span>}
                  {days!==null&&(
                    <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${getDaysBadgeColor(days)}`}>{days} jour{days>1?"s":""} ouvert</span>
                  )}
                  {/* Badge probabilité dans le header */}
                  {probabilite!=="neutre"&&(
                    <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${probabilite==="forte"?"bg-emerald-500/15 text-emerald-300":probabilite==="moyenne"?"bg-amber-500/15 text-amber-300":"bg-rose-500/15 text-rose-300"}`}>
                      {probabilite==="forte"?"🟢 Forte":probabilite==="moyenne"?"🟡 Moyenne":"🔴 Faible"}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-3xl font-bold text-zinc-100">{fmtMoney(offre.total_ttc)}</div>
              <div className="mt-1 text-sm text-zinc-400">{offre.payment_mode||"—"}</div>
              <div className="mt-1 text-sm text-zinc-500">{offre.nb_articles} article{offre.nb_articles!==1?"s":""}</div>
            </div>
          </div>
        </div>

        {/* GRILLE */}
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_660px]">

          {/* Gauche */}
          <div className="space-y-6">

            <div className="grid gap-6 lg:grid-cols-2">
              <section className="rounded-2xl border border-white/10 bg-[#2a2d31] p-6">
                <div className="mb-4 flex items-center justify-between">
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
                      window.location.href=`mailto:${offre.client_email}?subject=${encodeURIComponent(`Suivi offre ${offre.numero_affiche}`)}&body=${encodeURIComponent(mailBody)}`
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

            <section className="rounded-2xl border border-white/10 bg-[#2a2d31] p-6">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-xl font-semibold">Brouillon mail de relance</h2>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(mailBody)
                    setSaveStatus("📋 Brouillon copié !")
                    setSaveKind("success")
                    setTimeout(() => setSaveStatus(""), 2000)
                  }}
                  className="rounded-xl border border-white/10 bg-[#34383d] px-4 py-2 text-sm text-zinc-300 hover:bg-[#40454b]">
                  📋 Copier
                </button>
              </div>
              <div className="rounded-xl border border-white/10 bg-white overflow-hidden" style={{minHeight:200}}>
                <iframe srcDoc={mailBody} title="Aperçu email" className="w-full border-0" style={{height:520}}/>
              </div>
            </section>
          </div>

          {/* Droite — aperçus */}
          <div className="space-y-6 xl:sticky xl:top-6 xl:self-start">

            {pdfUrl && (
              <section className="rounded-2xl border border-white/10 bg-[#2a2d31] p-6">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-xl font-semibold">Aperçu PDF</h2>
                  <a href={pdfUrl} target="_blank" rel="noopener noreferrer" download
                    className="rounded-xl border border-white/10 bg-[#34383d] px-3 py-1.5 text-xs text-zinc-100 hover:bg-[#40454b]">Télécharger ↓</a>
                </div>
                <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/20">
                  <iframe src={pdfUrl} title="Aperçu PDF" className="h-[800px] w-full border-0"/>
                </div>
              </section>
            )}

            {/* ─── NOUVEAU : aperçu Fiche de travail (commandes uniquement) ─── */}
            {isCommande && ficheTravailUrl && (
              <section className="rounded-2xl border border-amber-500/20 bg-[#2a2d31] p-6">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-xl font-semibold flex items-center gap-2">
                    📋 Fiche de travail
                    <span className="text-xs font-normal text-amber-300/70 bg-amber-500/10 border border-amber-500/20 rounded px-2 py-0.5">Interne</span>
                  </h2>
                  <a href={ficheTravailUrl} target="_blank" rel="noopener noreferrer" download
                    className="rounded-xl border border-amber-500/30 bg-amber-500/15 px-3 py-1.5 text-xs text-amber-300 hover:bg-amber-500/20">Télécharger ↓</a>
                </div>
                <div className="overflow-hidden rounded-2xl border border-amber-500/20 bg-black/20">
                  <iframe src={ficheTravailUrl} title="Aperçu fiche de travail" className="h-[600px] w-full border-0"/>
                </div>
              </section>
            )}
            {/* ──────────────────────────────────────────────────────────────── */}

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
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#2a2d31] p-4">
          <div className="flex flex-wrap gap-3">
            <Link href="/dashboard" className="inline-flex items-center rounded-xl border border-white/10 bg-[#34383d] px-4 py-2 text-sm text-zinc-100 hover:bg-[#40454b]">← Retour au dashboard</Link>
            <Link href="/offres/nouveau" target="_blank" rel="noopener noreferrer" className="inline-flex items-center rounded-xl border border-white/10 bg-[#34383d] px-4 py-2 text-sm text-zinc-100 hover:bg-[#40454b]">+ Nouvelle offre</Link>
            {offre && (
              <Link href={`/offres/nouveau?prefill=${encodeURIComponent(JSON.stringify({
                nom: offre.client_nom||"", prenom: offre.client_prenom||"",
                societe: offre.client_societe||"", email: offre.client_email||"",
                telephone1: offre.client_tel1||"", rue: offre.client_rue||"",
                npa: offre.client_npa||"", ville: offre.client_ville||"",
                commercial: offre.commercial||"",
              }))}`} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center rounded-xl border border-[#2B8AD1]/40 bg-[#2B8AD1]/15 px-4 py-2 text-sm text-sky-300 hover:bg-[#2B8AD1]/25">
                👤 Nouvelle offre même client
              </Link>
            )}
            {offre&&(
              <button onClick={()=>copierOffre(true)}
                className="inline-flex items-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300 hover:bg-emerald-500/20">
                📋 Copier offre complète
              </button>
            )}
            {offre&&(
              <button onClick={()=>copierOffre(false)}
                className="inline-flex items-center rounded-xl border border-white/10 bg-[#34383d] px-4 py-2 text-sm text-zinc-300 hover:bg-[#40454b]">
                📋 Copie offre sans client
              </button>
            )}
          </div>
        </div>

      </div>
    </main>
  )
}
