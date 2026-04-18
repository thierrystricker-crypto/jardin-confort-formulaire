"use client";
// app/offre/[slug]/valider/page.tsx
// Page de validation d'offre avec signature numérique
// Inspirée du code de validation Shopify existant

import React, { useEffect, useRef, useState } from "react";

const C = {
  blue:    "#0060A9",
  blueBtn: "#2B8AD1",
  text:    "#2A2B2A",
  grey:    "#6B7280",
  border:  "#E5E7EB",
  bg:      "#F8FAFC",
};
const FONT = "'DM Sans', system-ui, sans-serif";

type OffreData = {
  id: number;
  slug: string;
  type_document: string;
  numero_affiche: string;
  statut: string;
  date_document: string;
  commercial: string;
  client_nom: string;
  client_prenom: string;
  client_email: string | null;
  client_tel1: string | null;
  client_npa: string | null;
  client_ville: string | null;
  client_societe: string | null;
  total_ttc: number;
  payment_mode: string | null;
  data: Record<string, unknown>;
};

function fmtMoney(v: number) {
  return "CHF " + new Intl.NumberFormat("de-CH", { minimumFractionDigits: 2 }).format(v);
}
function fmtDate(iso: string) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("fr-CH", { day: "2-digit", month: "2-digit", year: "numeric" });
}
function todayStr() {
  return new Date().toLocaleDateString("fr-CH", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function ValiderOffrePage({ params }: { params: Promise<{ slug: string }> }) {
  const [offre, setOffre] = useState<OffreData | null>(null);
  const [loading, setLoading] = useState(true);
  const [slug, setSlug] = useState("");
  const [error, setError] = useState("");

  // Formulaire
  const [accepted, setAccepted] = useState(false);
  const [signataire, setSignataire] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [success, setSuccess] = useState(false);

  // Canvas signature
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const hasSignature = useRef(false);

  useEffect(() => {
    async function load() {
      const { slug: s } = await params;
      setSlug(s);
      try {
        const res = await fetch(`/api/offres/${s}`);
        if (!res.ok) { setError("Offre introuvable"); return; }
        const json = await res.json();
        const o = json.offre as OffreData;
        setOffre(o);
        setSignataire(`${o.client_prenom || ""} ${o.client_nom || ""}`.trim());
      } catch { setError("Erreur de chargement"); }
      finally { setLoading(false); }
    }
    load();
  }, [params]);

  // Init canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#2B8AD1";
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, rect.width, rect.height);
  }, [offre]);

  function getPos(e: React.MouseEvent | React.TouchEvent, canvas: HTMLCanvasElement) {
    const rect = canvas.getBoundingClientRect();
    const touch = "touches" in e ? e.touches[0] : e;
    return {
      x: (touch as React.Touch | MouseEvent).clientX - rect.left,
      y: (touch as React.Touch | MouseEvent).clientY - rect.top,
    };
  }

  function startDraw(e: React.MouseEvent | React.TouchEvent) {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    drawing.current = true;
    hasSignature.current = true;
    const pos = getPos(e, canvas);
    ctx.beginPath(); ctx.moveTo(pos.x, pos.y);
    e.preventDefault();
  }

  function draw(e: React.MouseEvent | React.TouchEvent) {
    if (!drawing.current) return;
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    const pos = getPos(e, canvas);
    ctx.lineTo(pos.x, pos.y); ctx.stroke();
    e.preventDefault();
  }

  function endDraw() { drawing.current = false; }

  function clearSignature() {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, rect.width, rect.height);
    hasSignature.current = false;
  }

  async function handleSubmit() {
    setSubmitError("");
    if (!accepted) { setSubmitError("Veuillez cocher la case d'acceptation."); return; }
    if (!signataire.trim()) { setSubmitError("Veuillez indiquer le nom du signataire."); return; }
    if (!hasSignature.current) { setSubmitError("Veuillez signer dans la zone prévue."); return; }

    const canvas = canvasRef.current;
    const signatureBase64 = canvas ? canvas.toDataURL("image/png") : "";

    setSubmitting(true);
    try {
      const res = await fetch(`/api/offres/${slug}/valider`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signataire: signataire.trim(),
          signature_base64: signatureBase64,
          date_signature: todayStr(),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Erreur serveur");

      setSuccess(true);
      // Redirection vers la page de confirmation avec le nouveau slug CMD
      setTimeout(() => {
        window.location.href = `/offre/${json.cmdSlug}/confirmation`;
      }, 1200);
    } catch (err) {
      setSubmitError((err as Error).message);
      setSubmitting(false);
    }
  }

  if (loading) return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",minHeight:"100vh",fontFamily:FONT}}>
      Chargement…
    </div>
  );
  if (error || !offre) return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",minHeight:"100vh",fontFamily:FONT,color:"red"}}>
      {error || "Offre introuvable"}
    </div>
  );

  const payMode = (offre.data?.paymentMode as string) || offre.payment_mode || "Paiement d'avance à la commande";

  return (
    <>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet"/>
      <style>{`
        *{box-sizing:border-box;margin:0;padding:0}
        body{font-family:${FONT};background:#F3F5F6;color:${C.text};font-size:15px}
        .jc-input{width:100%;border:1px solid ${C.border};border-radius:20px;padding:12px 16px;
          font-size:15px;font-family:${FONT};color:${C.text};background:white;outline:none}
        .jc-input:focus{border-color:${C.blueBtn};box-shadow:0 0 0 3px rgba(43,138,209,0.12)}
        .jc-input[readonly]{background:#F9FAFB}
      `}</style>

      {/* Header simplifié */}
      <div style={{background:"#2B8AD1",padding:"6px 0"}}>
        <div style={{maxWidth:1260,margin:"0 auto",padding:"0 24px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span style={{color:"white",fontSize:12,letterSpacing:"0.06em",fontWeight:500}}>1&apos;000 M2 D&apos;EXPOSITION A LUTRY</span>
          <span style={{color:"white",fontSize:12}}>Français</span>
        </div>
      </div>
      <header style={{background:"white",borderBottom:`1px solid ${C.border}`,marginBottom:32}}>
        <div style={{maxWidth:1260,margin:"0 auto",padding:"12px 24px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <a href="https://www.jardin-confort.ch">
            <img src="https://www.jardin-confort.ch/cdn/shop/files/logo_JARDIN_CONFORT_shopify_51f35272-8a30-45a2-8718-36fb2af011c8.jpg?v=1736184411&width=480"
              alt="Jardin-Confort" style={{height:60,objectFit:"contain"}}/>
          </a>
          <a href={`/offre/${slug}`} style={{fontSize:13,color:C.grey,textDecoration:"none"}}>
            ← Retour à l&apos;offre
          </a>
        </div>
      </header>

      <div style={{maxWidth:1260,margin:"0 auto",padding:"0 24px 48px"}}>

        {/* Breadcrumb */}
        <div style={{fontSize:14,color:C.grey,marginBottom:20}}>
          Offres clients / <span style={{color:C.text}}>{offre.numero_affiche}</span>
        </div>

        <h1 style={{fontSize:36,fontWeight:500,color:C.text,letterSpacing:"-0.02em",marginBottom:28}}>
          Validation de votre offre
        </h1>

        {/* Layout 2 colonnes */}
        <div style={{display:"grid",gridTemplateColumns:"320px 1fr",gap:28,alignItems:"start"}}>

          {/* Colonne gauche — résumé */}
          <div style={{background:"white",border:`1px solid ${C.border}`,borderRadius:26,padding:24,position:"sticky",top:20,boxShadow:"0 2px 8px rgba(0,0,0,0.04)"}}>
            <div style={{fontSize:24,fontWeight:700,marginBottom:20}}>{fmtMoney(offre.total_ttc)}</div>
            <div style={{fontSize:14,color:C.text,lineHeight:1.8}}>
              <div><strong>Référence :</strong> {offre.numero_affiche}</div>
              <div><strong>Client :</strong> {offre.client_prenom} {offre.client_nom}</div>
              <div><strong>Mode de paiement :</strong> {payMode}</div>
              <div><strong>Conseiller :</strong> {offre.commercial}</div>
            </div>
            <div style={{marginTop:20}}>
              <a href={`/offre/${slug}`}
                style={{display:"block",textAlign:"center",padding:"10px 16px",borderRadius:20,
                  border:`1px solid ${C.border}`,fontSize:13,color:C.text,textDecoration:"none",marginBottom:8}}>
                ← Voir l&apos;offre
              </a>
              <a href={`/print/offre/${slug}`} target="_blank" rel="noopener noreferrer"
                style={{display:"flex",alignItems:"center",justifyContent:"center",gap:6,
                  padding:"10px 16px",borderRadius:20,background:C.blueBtn,
                  fontSize:13,fontWeight:600,color:"white",textDecoration:"none"}}>
                <svg width="14" height="14" fill="none" stroke="white" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
                  <rect x="6" y="14" width="12" height="8"/>
                </svg>
                Imprimer / Télécharger
              </a>
            </div>
          </div>

          {/* Colonne droite — formulaire */}
          <div style={{display:"flex",flexDirection:"column",gap:20}}>

            {/* Infos offre */}
            <div style={{background:"white",border:`1px solid ${C.border}`,borderRadius:26,padding:28,boxShadow:"0 2px 8px rgba(0,0,0,0.04)"}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:24}}>
                <div>
                  <div style={{fontSize:13,fontWeight:700,color:C.blue,marginBottom:12}}>Informations sur l&apos;offre</div>
                  {[
                    ["Référence", offre.numero_affiche],
                    ["Date de l'offre", fmtDate(offre.date_document)],
                    ["Montant total", fmtMoney(offre.total_ttc)],
                    ["Mode de paiement", payMode],
                    ["Conseiller", offre.commercial],
                  ].map(([k,v]) => (
                    <div key={k} style={{marginBottom:8,fontSize:15,lineHeight:1.55}}>
                      <strong style={{display:"inline-block",minWidth:165,fontWeight:700}}>{k} :</strong>
                      <span>{v}</span>
                    </div>
                  ))}
                </div>
                <div>
                  <div style={{fontSize:13,fontWeight:700,color:C.blue,marginBottom:12}}>Coordonnées client</div>
                  {offre.client_societe && (
                    <div style={{marginBottom:8,fontSize:15}}>
                      <strong style={{display:"inline-block",minWidth:130,fontWeight:700}}>Société :</strong>
                      <span>{offre.client_societe}</span>
                    </div>
                  )}
                  {[
                    ["Nom", `${offre.client_prenom || ""} ${offre.client_nom || ""}`.trim()],
                    ["Email", offre.client_email || "–"],
                    ["Téléphone", offre.client_tel1 || "–"],
                    ["Localité", `${offre.client_npa || ""} ${offre.client_ville || ""}`.trim() || "–"],
                  ].map(([k,v]) => (
                    <div key={k} style={{marginBottom:8,fontSize:15,lineHeight:1.55}}>
                      <strong style={{display:"inline-block",minWidth:130,fontWeight:700}}>{k} :</strong>
                      <span>{v}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{marginTop:20,background:C.bg,border:`1px solid ${C.border}`,borderRadius:16,padding:"14px 18px",fontSize:14,color:C.text,lineHeight:1.7}}>
                Veuillez vérifier attentivement votre offre avant de la valider.
                {payMode === "Paiement d'avance à la commande" && " Le traitement de votre commande se fera sur la base d'un paiement d'avance à la commande."}
                {payMode === "Acompte de 50% à la commande" && " Le traitement de votre commande se fera sur la base d'un acompte de 50% à la commande."}
              </div>
            </div>

            {/* Bloc signature */}
            <div style={{background:"white",border:`1px solid ${C.border}`,borderRadius:26,padding:28,boxShadow:"0 2px 8px rgba(0,0,0,0.04)"}}>

              {/* Checkbox */}
              <label style={{display:"flex",alignItems:"flex-start",gap:12,marginBottom:24,fontSize:15,cursor:"pointer",lineHeight:1.5}}>
                <input type="checkbox" checked={accepted} onChange={e=>setAccepted(e.target.checked)}
                  style={{marginTop:3,transform:"scale(1.2)",accentColor:C.blueBtn,flexShrink:0}}/>
                Je confirme avoir lu le document et j&apos;accepte l&apos;offre telle que présentée.
              </label>

              {/* Zone de signature */}
              <div style={{marginBottom:20}}>
                <label style={{display:"block",marginBottom:8,fontWeight:700,color:C.text,fontSize:15}}>Signature</label>
                <div style={{border:`1px solid ${C.border}`,borderRadius:20,overflow:"hidden",background:"white"}}>
                  <canvas ref={canvasRef}
                    style={{width:"100%",height:200,display:"block",background:"white",touchAction:"none",cursor:"crosshair"}}
                    onMouseDown={startDraw} onMouseMove={draw} onMouseUp={endDraw} onMouseLeave={endDraw}
                    onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={endDraw}
                  />
                  <div style={{display:"flex",gap:8,padding:10,borderTop:`1px solid ${C.border}`,background:C.bg}}>
                    <button onClick={clearSignature}
                      style={{border:`1px solid ${C.border}`,background:"white",color:C.text,
                        borderRadius:20,padding:"8px 16px",fontWeight:700,cursor:"pointer",fontSize:13,fontFamily:FONT}}>
                      Effacer la signature
                    </button>
                  </div>
                </div>
              </div>

              {/* Signataire + date */}
              <div style={{display:"grid",gridTemplateColumns:"1fr 220px",gap:16,marginBottom:20}}>
                <div>
                  <label style={{display:"block",marginBottom:6,fontWeight:700,fontSize:15}}>Nom et prénom du signataire</label>
                  <input className="jc-input" type="text" value={signataire}
                    onChange={e=>setSignataire(e.target.value)} placeholder="Votre nom et prénom"/>
                </div>
                <div>
                  <label style={{display:"block",marginBottom:6,fontWeight:700,fontSize:15}}>Date de signature</label>
                  <input className="jc-input" type="text" value={todayStr()} readOnly/>
                </div>
              </div>

              {/* Erreur */}
              {submitError && (
                <div style={{background:"#FEF2F2",color:"#991B1B",border:"1px solid #FECACA",
                  borderRadius:16,padding:"12px 16px",marginBottom:16,fontSize:14}}>
                  {submitError}
                </div>
              )}

              {/* Succès */}
              {success && (
                <div style={{background:"#EEF7FF",color:C.blue,border:"1px solid #B7D8F0",
                  borderRadius:16,padding:16,marginBottom:16,fontSize:14,lineHeight:1.6}}>
                  ✅ Merci ! Votre offre a été validée. Redirection en cours…
                </div>
              )}

              {/* Bouton soumettre */}
              <button onClick={handleSubmit} disabled={submitting || success}
                style={{
                  display:"inline-flex",alignItems:"center",justifyContent:"center",
                  minHeight:52,padding:"0 32px",borderRadius:26,
                  background:C.blueBtn,color:"white",border:"none",
                  fontSize:16,fontWeight:600,cursor:submitting?"not-allowed":"pointer",
                  fontFamily:FONT,opacity:submitting?0.7:1,transition:"0.2s",
                }}>
                {submitting ? "Validation en cours…" : "Valider mon offre"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}