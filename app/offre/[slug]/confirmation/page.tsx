"use client";
// app/offre/[slug]/confirmation/page.tsx
// Page de confirmation après validation d'offre → commande CMD

import React, { useEffect, useState } from "react";

const C = {
  blue:    "#0060A9",
  blueBtn: "#2B8AD1",
  text:    "#2A2B2A",
  grey:    "#6B7280",
  border:  "#E5E7EB",
  bg:      "#F8FAFC",
};
const FONT = "'DM Sans', system-ui, sans-serif";

// QR paiement statique (sera remplacé par pdf4me plus tard)
const QR_STATIC = "https://cdn.shopify.com/s/files/1/0360/3251/2135/files/qr_payment_jardinconfort.png";

type CmdData = {
  id: number;
  slug: string;
  numero_affiche: string;
  numero_commande: string;
  statut: string;
  date_document: string;
  commercial: string;
  client_nom: string;
  client_prenom: string;
  client_societe: string | null;
  client_email: string | null;
  client_tel1: string | null;
  client_npa: string | null;
  client_ville: string | null;
  client_rue: string | null;
  total_ttc: number;
  payment_mode: string | null;
  offre_origine: string | null;
  data: Record<string, unknown>;
};

function fmt(v: number) {
  return "CHF\u00a0" + new Intl.NumberFormat("de-CH", { minimumFractionDigits: 2 }).format(v);
}
function fmtDate(iso: string) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("fr-CH", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function ConfirmationPage({ params }: { params: Promise<{ slug: string }> }) {
  const [cmd, setCmd] = useState<CmdData | null>(null);
  const [loading, setLoading] = useState(true);
  const [slug, setSlug] = useState("");
const [pdfUrl, setPdfUrl] = useState("");
  const [qrUrl, setQrUrl] = useState("");

  useEffect(() => {
    async function load() {
      const { slug: s } = await params;
      setSlug(s);
      try {
        const res = await fetch(`/api/offres/${s}`);
        if (res.ok) {
          const json = await res.json();
          setCmd(json.offre as CmdData);
          setPdfUrl(json.offre?.pdf_url || "");
          setQrUrl(json.offre?.qr_url || "");
        }
      } catch { /* ignore */ }
      finally { setLoading(false); }
    }
    load();
  }, [params]);

  if (loading) return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",minHeight:"100vh",fontFamily:FONT}}>
      Chargement…
    </div>
  );

  if (!cmd) return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",minHeight:"100vh",fontFamily:FONT,flexDirection:"column",gap:12}}>
      <div style={{fontSize:22,fontWeight:700,color:C.blue}}>Commande introuvable</div>
    </div>
  );

  const payMode = (cmd.data?.paymentMode as string) || cmd.payment_mode || "Paiement d'avance à la commande";
  const nomComplet = `${cmd.client_prenom || ""} ${cmd.client_nom || ""}`.trim();
  const isAcompte = payMode.includes("50%");

  return (
    <>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet"/>
      <style>{`
        *{box-sizing:border-box;margin:0;padding:0}
        body{font-family:${FONT};background:#F3F5F6;color:${C.text};font-size:15px}
        a{color:${C.text};text-decoration:none}
      `}</style>

      {/* Header */}
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
          <a href="https://www.jardin-confort.ch" style={{fontSize:13,color:C.grey}}>
            ← Retour à la boutique
          </a>
        </div>
      </header>

      <div style={{maxWidth:1260,margin:"0 auto",padding:"0 24px 48px"}}>

        {/* Breadcrumb */}
        <div style={{fontSize:14,color:C.grey,marginBottom:20}}>
          Commandes / <span style={{color:C.text}}>{cmd.numero_commande}</span>
        </div>

        {/* Titre */}
        <h1 style={{fontSize:36,fontWeight:500,color:C.blue,letterSpacing:"-0.02em",marginBottom:28}}>
          Confirmation de commande
        </h1>

        {/* Bloc montants + actions */}
        <div style={{
          display:"grid", gridTemplateColumns:"1fr 320px", gap:24, marginBottom:24,
          background:"white", border:`1px solid ${C.border}`, borderRadius:26,
          padding:24, boxShadow:"0 2px 8px rgba(0,0,0,0.04)",
        }}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
            <div style={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:20,padding:"18px 20px"}}>
              <div style={{fontSize:13,fontWeight:700,color:C.grey,textTransform:"uppercase",letterSpacing:"0.04em",marginBottom:8}}>
                Montant total de la commande
              </div>
              <div style={{fontSize:34,fontWeight:700,color:C.text}}>{fmt(cmd.total_ttc)}</div>
            </div>
            <div style={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:20,padding:"18px 20px"}}>
              <div style={{fontSize:13,fontWeight:700,color:C.grey,textTransform:"uppercase",letterSpacing:"0.04em",marginBottom:8}}>
                {isAcompte ? "Acompte à payer de suite (50%)" : "Montant à payer de suite"}
              </div>
              <div style={{fontSize:34,fontWeight:700,color:C.text}}>
                {fmt(isAcompte ? Math.round(cmd.total_ttc * 0.5 * 100) / 100 : cmd.total_ttc)}
              </div>
            </div>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            {pdfUrl ? (
              <a href={pdfUrl} target="_blank" rel="noopener noreferrer" download
                style={{
                  display:"flex",alignItems:"center",justifyContent:"center",gap:8,
                  minHeight:52,padding:"0 20px",borderRadius:26,
                  background:C.blueBtn,color:"white",fontWeight:600,fontSize:15,
                }}>
                <svg width="16" height="16" fill="none" stroke="white" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                Télécharger la confirmation PDF
              </a>
            ) : (
              <a href={`/print/offre/${slug}`} target="_blank" rel="noopener noreferrer"
                style={{
                  display:"flex",alignItems:"center",justifyContent:"center",gap:8,
                  minHeight:52,padding:"0 20px",borderRadius:26,
                  background:C.blueBtn,color:"white",fontWeight:600,fontSize:15,
                }}>
                <svg width="16" height="16" fill="none" stroke="white" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
                  <rect x="6" y="14" width="12" height="8"/>
                </svg>
                Voir la confirmation
              </a>
            )}
            <a href={`/offre/${slug}`} target="_blank" rel="noopener noreferrer"
              style={{
                display:"flex",alignItems:"center",justifyContent:"center",gap:8,
                minHeight:52,padding:"0 20px",borderRadius:26,
                background:"white",color:C.blueBtn,fontWeight:600,fontSize:15,
                border:`1px solid ${C.blueBtn}`,
              }}>
              👁 Voir le détail de la commande
            </a>
            <a href="mailto:contact@jardinconfort.ch"
              style={{
                display:"flex",alignItems:"center",justifyContent:"center",
                minHeight:52,padding:"0 20px",borderRadius:26,
                background:"white",color:C.text,fontWeight:600,fontSize:15,
                border:`1px solid ${C.border}`,
              }}>
              Contacter Jardin-Confort
            </a>
          </div>
        </div>

        {/* Infos commande + client */}
        <div style={{background:"white",border:`1px solid ${C.border}`,borderRadius:26,padding:28,marginBottom:24,boxShadow:"0 2px 8px rgba(0,0,0,0.04)"}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:32}}>
            <div>
              <div style={{fontSize:13,fontWeight:700,color:C.blue,marginBottom:14}}>Informations sur la commande</div>
              {[
                ["Numéro de commande", cmd.numero_commande],
                ["Offre d'origine", cmd.offre_origine || "–"],
                ["Date de commande", fmtDate(cmd.date_document)],
                ["Mode de paiement", payMode],
                ["Votre conseiller", cmd.commercial],
              ].map(([k,v]) => (
                <div key={k} style={{marginBottom:8,fontSize:15,lineHeight:1.55}}>
                  <strong style={{display:"inline-block",minWidth:200,fontWeight:700}}>{k} :</strong>
                  <span>{v}</span>
                </div>
              ))}
            </div>
            <div>
              <div style={{fontSize:13,fontWeight:700,color:C.blue,marginBottom:14}}>Coordonnées client</div>
              {cmd.client_societe && (
                <div style={{marginBottom:8,fontSize:15}}>
                  <strong style={{display:"inline-block",minWidth:150,fontWeight:700}}>Société :</strong>
                  <span>{cmd.client_societe}</span>
                </div>
              )}
              {[
                ["Nom du client", nomComplet],
                ["Email", cmd.client_email || "–"],
                ["Téléphone", cmd.client_tel1 ? cmd.client_tel1.replace(/^(\+41|0041|41)(\d{2})(\d{3})(\d{2})(\d{2})$/, "+41 $2 $3 $4 $5") : "–"],
                ["Adresse", [cmd.client_rue, `${cmd.client_npa||""} ${cmd.client_ville||""}`].filter(Boolean).join(", ")],
              ].map(([k,v]) => (
                <div key={k} style={{marginBottom:8,fontSize:15,lineHeight:1.55}}>
                  <strong style={{display:"inline-block",minWidth:150,fontWeight:700}}>{k} :</strong>
                  <span>{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Message de confirmation */}
        <div style={{
          background:"#EEF7FF",border:"1px solid #B7D8F0",borderRadius:22,
          padding:"22px 24px",marginBottom:24,color:C.blue,lineHeight:1.75,fontSize:16,
        }}>
          <p style={{marginBottom:14}}>
            Merci beaucoup <strong>{nomComplet}</strong> pour la validation de votre commande.
          </p>
          <p style={{marginBottom:14}}>
            Notre équipe a été avertie de votre confirmation et va prendre contact avec vous au plus vite.
          </p>
          <p style={{marginBottom:14}}>
            {isAcompte
              ? "Veuillez à présent procéder au paiement de l'acompte convenu (50%) sur notre compte bancaire selon les détails de paiement ci-dessous."
              : "Veuillez à présent procéder au paiement du montant convenu sur notre compte bancaire selon les détails de paiement ci-dessous."
            }
          </p>
          <p>
            Vous pouvez télécharger votre confirmation de commande à l&apos;aide du bouton prévu à cet effet.
            Pour toute question : <a href="mailto:contact@jardinconfort.ch" style={{color:C.blue,fontWeight:700}}>contact@jardinconfort.ch</a>
          </p>
        </div>

        {/* QR paiement */}
        <div style={{background:"white",border:`1px solid ${C.border}`,borderRadius:26,padding:28,marginBottom:24,boxShadow:"0 2px 8px rgba(0,0,0,0.04)"}}>
          <h2 style={{fontSize:24,fontWeight:600,color:C.blue,marginBottom:8}}>QR Paiement</h2>
          <p style={{fontSize:14,color:C.grey,marginBottom:20,lineHeight:1.6}}>
            Veuillez scanner le QR code ci-dessous ou utiliser les coordonnées bancaires indiquées.
            Le montant à inscrire est : <strong>{fmt(isAcompte ? Math.round(cmd.total_ttc * 0.5 * 100) / 100 : cmd.total_ttc)}</strong>
          </p>
          <div style={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:20,padding:20,marginBottom:20,textAlign:"center"}}>
            {qrUrl ? (
              <a href={qrUrl} target="_blank" rel="noopener noreferrer" download>
                <img src={qrUrl} alt="QR Paiement Jardin-Confort"
                  style={{maxWidth:500,width:"100%",height:"auto",borderRadius:8}}/>
              </a>
            ) : (
              <div style={{padding:40,color:C.grey,fontSize:14}}>
                QR code en cours de génération — revenez dans quelques instants ou rechargez la page.
              </div>
            )}
          </div>
          {/* Coordonnées bancaires */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
            {[
              ["IBAN", "CH72 0076 7000 K033 3796 5"],
              ["Référence", cmd.numero_commande],
              ["Bénéficiaire", "Jardin-Confort SA"],
              ["Banque", "BCV – Banque Cantonale Vaudoise"],
            ].map(([label, value]) => (
              <div key={label} style={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:16,padding:"14px 16px"}}>
                <div style={{fontSize:11,fontWeight:700,color:C.grey,textTransform:"uppercase",letterSpacing:"0.04em",marginBottom:6}}>{label}</div>
                <div style={{fontSize:15,color:C.text,fontWeight:500}}>{value}</div>
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* Footer simple */}
      <footer style={{background:"white",borderTop:`1px solid ${C.border}`,padding:"20px 24px",textAlign:"center",fontSize:12,color:C.grey}}>
        © {new Date().getFullYear()} Jardin-Confort SA · Route de Lavaux 425 · 1095 Lutry ·{" "}
        <a href="tel:+41217913671" style={{color:C.grey}}>+41 21 791 36 71</a>
      </footer>
    </>
  );
}