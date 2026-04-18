"use client";
// app/offre/[slug]/page.tsx
// Page publique client — design identique à la page /valider

import React, { useEffect, useState } from "react";

// ── Tokens identiques à la page /valider ──
const C = {
  blue:    "#0060A9",
  blueBtn: "#2B8AD1",
  text:    "#2A2B2A",
  grey:    "#6B7280",
  border:  "#E5E7EB",
  bg:      "#F8FAFC",
  green:   "#2C7E3F",
  orange:  "#E67E22",
};
const FONT = "'DM Sans', system-ui, sans-serif";
const TVA_RATE = 0.081;

const serviceLabels: Record<string, string> = {
  montage:       "Frais de montage",
  poste:         "Livraison des colis par La Poste",
  trottoir:      "Livraison colis franco trottoir par transporteur",
  etage:         "Livraison « à l'étage » et déballage des articles",
  etage_montage: "Livraison « à l'étage », déballage et montage",
  reprise:       "Reprise et recyclage des anciens meubles",
};

type QuoteLine = {
  id: string;
  type: "product" | "custom" | "comment";
  image?: string;
  sku?: string;
  title: string;
  unitPrice: number;
  qty: number;
  stock?: number | "sur_commande" | null;
  lineDiscount?: number;
  delaiLivraison?: string;
};

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
  client_npa: string | null;
  client_ville: string | null;
  client_societe: string | null;
  client_email: string | null;
  client_tel1: string | null;
  total_ttc: number;
  data: {
    lines: QuoteLine[];
    clientType: string;
    paymentMode: string;
    deliveryMode?: string;
    leadTime?: string;
    remarks?: string;
    reference?: string;
    societe?: string; nom?: string; prenom?: string;
    rue?: string; numero?: string; npa?: string; ville?: string;
    telephone1?: string; telephone2?: string; email?: string;
    livrDiff?: boolean;
    livrSociete?: string; livrNom?: string; livrPrenom?: string;
    livrTel?: string; livrRue?: string; livrNumero?: string;
    livrNpa?: string; livrVille?: string;
    discount?: string; discountPercent?: string; manualRounding?: string;
    enabledServices?: Record<string, boolean>;
    servicePrices?: Record<string, string>;
  };
  stockRefreshedAt?: string;
};

function fmt(v: number) {
  return "CHF\u00a0" + new Intl.NumberFormat("de-CH", {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  }).format(v);
}
function fmtDate(iso: string) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("fr-CH", {
    day: "2-digit", month: "2-digit", year: "numeric"
  });
}

// Card réutilisable — identique à /valider
function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: "white",
      border: `1px solid ${C.border}`,
      borderRadius: 26,
      boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
      ...style,
    }}>{children}</div>
  );
}

// Label de section — identique à /valider
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 13, fontWeight: 700, color: C.blue,
      marginBottom: 12,
    }}>{children}</div>
  );
}

export default function OffrePubliquePage({ params }: { params: Promise<{ slug: string }> }) {
  const [offre, setOffre] = useState<OffreData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      const { slug } = await params;
      try {
        const res = await fetch(`/api/offres/${slug}`);
        if (!res.ok) { setError(res.status === 404 ? "404" : "error"); return; }
        const json = await res.json();
        setOffre(json.offre);
      } catch { setError("error"); }
      finally { setLoading(false); }
    }
    load();
  }, [params]);

  if (loading) return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",
      minHeight:"100vh",fontFamily:FONT,color:C.grey,fontSize:15}}>
      Chargement de l&apos;offre…
    </div>
  );
  if (error === "404") return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",
      minHeight:"100vh",fontFamily:FONT,flexDirection:"column",gap:12}}>
      <div style={{fontSize:22,fontWeight:700,color:C.blue}}>Offre introuvable</div>
      <div style={{color:C.grey,fontSize:14}}>Cette offre n&apos;existe pas ou a été supprimée.</div>
    </div>
  );
  if (!offre) return null;

  const d = offre.data;
  const isPrivateTTC = d.clientType === "Privé (prix TTC)";
  const isEnCours = ["En cours","Envoyée"].includes(offre.statut);

  // ── Totaux ──
  const subTotal = (d.lines||[]).reduce((s,l) =>
    l.type==="comment" ? s : s + l.qty*l.unitPrice - (l.lineDiscount||0), 0);
  const discountPct = Number(d.discountPercent||0);
  const discountValue = discountPct > 0
    ? Math.round(subTotal*discountPct)/100
    : Number(d.discount||0);
  const activeServices = Object.entries(d.enabledServices||{})
    .filter(([,v]) => v)
    .map(([code]) => ({
      code,
      label: serviceLabels[code] || (d.servicePrices?.["custom_label"] || code),
      amount: Number(d.servicePrices?.[code]||0),
    }))
    .filter(s => s.amount > 0);
  const serviceTotal = activeServices.reduce((s,srv) => s+srv.amount, 0);
  const roundingValue = Math.min(0, Number(d.manualRounding)||0);
  const totalAfterAll = subTotal - discountValue + serviceTotal + roundingValue;
  const tvaAmount = isPrivateTTC
    ? totalAfterAll - totalAfterAll/(1+TVA_RATE)
    : totalAfterAll*TVA_RATE;
  const finalTotal = isPrivateTTC ? totalAfterAll : totalAfterAll+tvaAmount;

  // ── Adresses ──
  const addrFact = [
    d.societe || null,
    [d.nom, d.prenom].filter(Boolean).join(" ") || null,
    [d.rue, d.numero].filter(Boolean).join(" ") || null,
    [d.npa, d.ville].filter(Boolean).join(" ") || null,
    d.telephone1 ? `Tél. ${d.telephone1}` : null,
    d.email || null,
  ].filter(Boolean) as string[];

  const addrLivr: string[] = d.deliveryMode === "À l'emporter"
    ? ["À l'emporter", "Jardin-Confort SA", "Route de Lavaux 425", "1095 Lutry"]
    : d.livrDiff
      ? [d.livrSociete||null, [d.livrNom,d.livrPrenom].filter(Boolean).join(" ")||null,
          [d.livrRue,d.livrNumero].filter(Boolean).join(" ")||null,
          [d.livrNpa,d.livrVille].filter(Boolean).join(" ")||null,
          d.livrTel?`Tél. ${d.livrTel}`:null].filter(Boolean) as string[]
      : addrFact.filter(l => !l.includes("@"));

  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com"/>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700&display=swap" rel="stylesheet"/>
      <style>{`
        *{box-sizing:border-box;margin:0;padding:0}
        body{font-family:${FONT};background:#F3F5F6;color:${C.text};font-size:15px;line-height:1.6}
        a{text-decoration:none;color:${C.text}}
        .nav-sujet:hover .nav-dropdown{display:block!important}
        .nav-link:hover{box-shadow:inset 0 -2px 0 0 #3E4D56}
        @media(max-width:640px){
          .addr-grid{flex-direction:column!important}
          .totaux-grid{flex-direction:column!important}
          .article-img{display:none!important}
        }
      `}</style>

      {/* ── TOP BAR ── */}
      <div style={{background:"#2B8AD1",padding:"6px 0"}}>
        <div style={{maxWidth:1260,margin:"0 auto",padding:"0 24px",
          display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <span style={{color:"white",fontSize:12,letterSpacing:"0.06em",fontWeight:500}}>
            1&apos;000 M2 D&apos;EXPOSITION A LUTRY
          </span>
          <span style={{color:"white",fontSize:12}}>Français</span>
        </div>
      </div>

      {/* ── HEADER ── */}
      <header style={{background:"white",borderBottom:`1px solid ${C.border}`,marginBottom:32}}>
        <div style={{maxWidth:1260,margin:"0 auto",padding:"12px 24px 0"}}>
          {/* Logo + icônes */}
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",paddingBottom:8}}>
            <a href="https://www.jardin-confort.ch">
              <img src="https://www.jardin-confort.ch/cdn/shop/files/logo_JARDIN_CONFORT_shopify_51f35272-8a30-45a2-8718-36fb2af011c8.jpg?v=1736184411&width=480"
                alt="Jardin-Confort" style={{height:68,objectFit:"contain"}}/>
            </a>
            <div style={{display:"flex",alignItems:"center",gap:4}}>
              <a href="https://www.jardin-confort.ch/customer_authentication/redirect?locale=fr&region_country=CH"
                style={{display:"flex",alignItems:"center",justifyContent:"center",width:44,height:44,color:"#3E4D56"}}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm0 1.429a3.571 3.571 0 1 0 0 7.142 3.571 3.571 0 0 0 0-7.142zm0 10c2.558 0 5.114.471 7.664 1.411A3.571 3.571 0 0 1 22 18.19v3.096c0 .394-.32.714-.714.714H2.714A.714.714 0 0 1 2 21.286V18.19c0-1.495.933-2.833 2.336-3.35 2.55-.94 5.106-1.411 7.664-1.411zm0 1.428c-2.387 0-4.775.44-7.17 1.324a2.143 2.143 0 0 0-1.401 2.01v2.38H20.57v-2.38c0-.898-.56-1.7-1.401-2.01-2.395-.885-4.783-1.324-7.17-1.324z"/>
                </svg>
              </a>
              <a href="https://www.jardin-confort.ch/cart"
                style={{display:"flex",alignItems:"center",justifyContent:"center",width:44,height:44,color:"#3E4D56"}}>
                <svg width="24" height="24" viewBox="0 0 24 24">
                  <path fill="currentColor" d="M17 18a2 2 0 0 1 2 2 2 2 0 0 1-2 2 2 2 0 0 1-2-2c0-1.11.89-2 2-2M1 2h3.27l.94 2H20a1 1 0 0 1 1 1c0 .17-.05.34-.12.5l-3.58 6.47c-.34.61-1 1.03-1.75 1.03H8.1l-.9 1.63-.03.12a.25.25 0 0 0 .25.25H19v2H7a2 2 0 0 1-2-2c0-.35.09-.68.24-.96l1.36-2.45L3 4H1V2m6 16a2 2 0 0 1 2 2 2 2 0 0 1-2 2 2 2 0 0 1-2-2c0-1.11.89-2 2-2m9-7 2.78-5H6.14l2.36 5H16Z"/>
                </svg>
              </a>
            </div>
          </div>
          {/* Navigation */}
          <div style={{display:"flex",alignItems:"flex-end",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
            <nav style={{display:"flex",alignItems:"center",flexWrap:"wrap",margin:"0 -12px"}}>
              <a href="https://www.jardin-confort.ch" className="nav-link"
                style={{display:"block",margin:"0 12px",padding:"10px 0",fontSize:13,fontWeight:500,color:"#3E4D56",whiteSpace:"nowrap"}}>
                ACCUEIL
              </a>
              <a href="https://www.jardin-confort.ch"
                style={{display:"block",margin:"0 12px",padding:"10px 0",fontSize:13,fontWeight:500,color:"#3E4D56",
                  whiteSpace:"nowrap",boxShadow:"inset 0 -2px 0 0 #3E4D56"}}>
                ← RETOUR A LA BOUTIQUE
              </a>
              <div style={{position:"relative",margin:"0 12px"}} className="nav-sujet">
                <a href="https://www.jardin-confort.ch/pages/a-notre-sujet" className="nav-link"
                  style={{display:"inline-flex",alignItems:"center",gap:4,padding:"10px 0",
                    fontSize:13,fontWeight:500,color:"#3E4D56",whiteSpace:"nowrap"}}>
                  A NOTRE SUJET
                  <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>
                </a>
                <div className="nav-dropdown" style={{display:"none",position:"absolute",top:"100%",left:0,
                  background:"white",boxShadow:"0 5px 15px rgba(0,0,0,0.1)",borderTop:`1px solid ${C.border}`,
                  minWidth:220,zIndex:100,padding:"8px 0"}}>
                  {[["Qui sommes nous","https://www.jardin-confort.ch/pages/a-notre-sujet"],
                    ["Contact","https://www.jardin-confort.ch/pages/contact"],
                    ["Conditions générales","https://www.jardin-confort.ch/pages/conditions-generales"],
                    ["Coordonnées bancaires","https://www.jardin-confort.ch/pages/coordonnees-bancaires"],
                  ].map(([label,href]) => (
                    <a key={label} href={href} style={{display:"block",padding:"10px 20px",fontSize:13,color:"#3E4D56"}}
                      onMouseEnter={e=>(e.currentTarget.style.color=C.blueBtn)}
                      onMouseLeave={e=>(e.currentTarget.style.color="#3E4D56")}
                    >{label}</a>
                  ))}
                </div>
              </div>
            </nav>
            <a href="tel:+41217913671" style={{
              display:"inline-flex",alignItems:"center",gap:8,
              background:C.blueBtn,color:"white",padding:"8px 18px",borderRadius:20,
              fontSize:13,fontWeight:600,flexShrink:0,marginBottom:8}}>
              <svg width="15" height="15" fill="none" stroke="white" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.4 2 2 0 0 1 3.6 1.22h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.96a16 16 0 0 0 6 6l1.1-1.1a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
              </svg>
              +41 (0)21 791 36 71
            </a>
          </div>
        </div>
      </header>

      <main style={{maxWidth:1260,margin:"0 auto",padding:"0 24px 48px"}}>

        {/* ── BREADCRUMB ── */}
        <div style={{fontSize:14,color:C.grey,marginBottom:20}}>
          Offres clients / <span style={{color:C.text}}>{offre.numero_affiche}</span>
        </div>

        {/* ── TITRE ── */}
        <h1 style={{fontSize:36,fontWeight:500,color:C.text,letterSpacing:"-0.02em",marginBottom:28}}>
          Votre {offre.type_document.toLowerCase()} personnalisée
        </h1>

        {/* ── BLOC ACCUEIL PERSONNALISÉ ── */}
        {isEnCours && (
          <Card style={{padding:28,marginBottom:24}}>
            <div style={{display:"flex",alignItems:"flex-start",gap:16,flexWrap:"wrap"}}>
              <div style={{fontSize:32,flexShrink:0}}>🌿</div>
              <div style={{flex:1}}>
                <div style={{fontWeight:700,color:C.blue,fontSize:17,marginBottom:8}}>
                  Offre personnalisée en attente de votre validation
                </div>
                <div style={{fontSize:15,color:C.text,lineHeight:1.8}}>
                  Bonjour <strong>{[d.prenom,d.nom].filter(Boolean).join(" ") || `${offre.client_prenom} ${offre.client_nom}`}</strong>,
                  veuillez trouver votre offre selon notre aimable entretien.
                  Si tout est en ordre, vous pouvez volontiers valider celle-ci.
                  Vous recevrez ensuite une confirmation de commande avec les modalités de paiement convenues.
                </div>
                <div style={{fontSize:14,color:C.grey,marginTop:10}}>
                  Je reste à votre disposition pour toute information supplémentaire.{" "}
                  <strong style={{color:C.text}}>{offre.commercial}</strong>
                  {" · "}
                  <a href="tel:+41217913671" style={{color:C.blueBtn}}>+41 21 791 36 71</a>
                </div>
                <div style={{marginTop:16,display:"flex",gap:10,flexWrap:"wrap"}}>
                  <a href={`/offre/${offre.slug}/valider`} style={{
                    display:"inline-flex",alignItems:"center",gap:8,
                    background:C.blueBtn,color:"white",padding:"10px 22px",
                    borderRadius:20,fontSize:14,fontWeight:600}}>
                    ✅ Valider cette offre
                  </a>
                  <a href={`/print/offre/${offre.slug}`} target="_blank" rel="noopener noreferrer" style={{
                    display:"inline-flex",alignItems:"center",gap:8,
                    background:C.blueBtn,color:"white",padding:"10px 22px",
                    borderRadius:20,fontSize:14,fontWeight:600}}>
                    <svg width="14" height="14" fill="none" stroke="white" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
                      <rect x="6" y="14" width="12" height="8"/>
                    </svg>
                    Imprimer / Télécharger offre
                  </a>
                </div>
                {d.leadTime && (
                  <div style={{fontSize:13,color:C.grey,marginTop:10}}>
                    Délai estimé : <strong>{d.leadTime}</strong>
                    {d.deliveryMode && ` · ${d.deliveryMode}`}
                  </div>
                )}
              </div>
            </div>
          </Card>
        )}

        {offre.statut==="Acceptée" && (
          <Card style={{padding:"18px 24px",marginBottom:24,background:"#E8F5E9",border:`1px solid ${C.green}`}}>
            <div style={{display:"flex",alignItems:"center",gap:14}}>
              <span style={{fontSize:28}}>✅</span>
              <div>
                <div style={{fontWeight:700,color:C.green,fontSize:15}}>Offre acceptée — Merci pour votre confiance !</div>
                <div style={{fontSize:13,color:"#2e7d32",marginTop:3}}>Votre conseiller {offre.commercial} va prendre contact avec vous.</div>
              </div>
            </div>
          </Card>
        )}

        {/* ── STOCK ── */}
        {offre.stockRefreshedAt && (
          <div style={{
            background:"#FFF8E1",border:"1px solid #FFE082",borderRadius:16,
            padding:"10px 16px",marginBottom:20,fontSize:13,color:"#7B5E00",lineHeight:1.6,
          }}>
            ℹ️ <strong>Info stock non contractuelle.</strong>{" "}
            Disponibilités vérifiées le {new Date(offre.stockRefreshedAt).toLocaleString("fr-CH")} sous toutes réserves d&apos;erreurs et de disponibilité.
          </div>
        )}

        {/* ── ADRESSES ── */}
        <div className="addr-grid" style={{display:"flex",gap:16,marginBottom:20}}>
          <Card style={{flex:1,padding:"20px 24px"}}>
            <SectionLabel>Adresse de facturation</SectionLabel>
            {addrFact.map((line,i) => (
              <div key={i} style={{fontSize:15,fontWeight:i===1?600:400,
                color:i===1?C.text:C.grey,lineHeight:1.8}}>{line}</div>
            ))}
          </Card>
          <Card style={{flex:1,padding:"20px 24px"}}>
            <SectionLabel>Adresse de livraison</SectionLabel>
            {addrLivr.map((line,i) => (
              <div key={i} style={{fontSize:15,fontWeight:i===1?600:400,
                color:i===1?C.text:C.grey,lineHeight:1.8,
                fontStyle:d.deliveryMode==="À l'emporter"&&i>0?"italic":"normal"}}>{line}</div>
            ))}
          </Card>
        </div>

        {/* ── ARTICLES ── */}
        <Card style={{marginBottom:20}}>
          <div style={{padding:"16px 24px 12px",borderBottom:`1px solid ${C.border}`}}>
            <SectionLabel>Articles ({(d.lines||[]).filter(l=>l.type!=="comment").length})</SectionLabel>
          </div>
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead>
              <tr style={{background:C.bg}}>
                <th className="article-img" style={{width:80,padding:"10px 16px"}}></th>
                <th style={{textAlign:"left",padding:"10px 8px",fontSize:12,fontWeight:700,color:C.grey,textTransform:"uppercase",letterSpacing:"0.05em"}}>Article</th>
                <th style={{textAlign:"center",padding:"10px 8px",fontSize:12,fontWeight:700,color:C.grey,width:60}}>Qté</th>
                <th style={{textAlign:"right",padding:"10px 8px",fontSize:12,fontWeight:700,color:C.grey,width:110}}>Prix/pce</th>
                <th style={{textAlign:"right",padding:"10px 20px",fontSize:12,fontWeight:700,color:C.grey,width:120}}>Total</th>
              </tr>
            </thead>
            <tbody>
              {(d.lines||[]).map((line,i) => {
                if (line.type==="comment") return (
                  <tr key={line.id}>
                    <td colSpan={5} style={{padding:"10px 24px",fontStyle:"italic",
                      color:C.grey,fontSize:14,background:"#EEF4FB",
                      borderTop:`1px solid ${C.border}`,borderBottom:`1px solid ${C.border}`}}>
                      {line.title}
                    </td>
                  </tr>
                );
                const lineTotal = line.qty*line.unitPrice-(line.lineDiscount||0);
                const sn = typeof line.stock==="number" ? line.stock : null;
                const isSC = line.stock==="sur_commande"||(sn!==null&&sn<1);
                const isOk = sn!==null&&sn>2;
                const isLow = sn!==null&&sn>0&&sn<=2;
                return (
                  <tr key={line.id} style={{borderTop:`1px solid ${C.border}`,
                    background:i%2===0?"white":C.bg}}>
                    <td className="article-img" style={{padding:"12px 16px",textAlign:"center",verticalAlign:"middle"}}>
                      {line.image
                        ? <img src={line.image} alt="" style={{width:72,height:72,objectFit:"contain",borderRadius:8}}/>
                        : <div style={{width:72,height:72,background:C.bg,borderRadius:8}}/>
                      }
                    </td>
                    <td style={{padding:"12px 8px",verticalAlign:"middle"}}>
                      <div style={{fontWeight:600,color:C.text,fontSize:15}}>{line.title}</div>
                      {line.sku && <div style={{fontSize:13,color:C.grey,marginTop:1}}>Réf. {line.sku}</div>}
                      {(line.lineDiscount||0)>0 && (
                        <div style={{fontSize:13,color:C.green,marginTop:2,fontWeight:500}}>
                          Remise : − {fmt(line.lineDiscount||0)}
                        </div>
                      )}
                      <div style={{marginTop:4,fontSize:13,fontWeight:600}}>
                        {sn===null||sn===undefined ? null
                          : isSC ? <span style={{color:C.orange}}>📦 {line.delaiLivraison||"Sur commande"}</span>
                          : isOk ? <span style={{color:C.green}}>✓ En stock ({sn} pce{sn>1?"s":""})</span>
                          : isLow ? <span style={{color:C.orange}}>⚠ Stock limité ({sn} pce{sn>1?"s":""})</span>
                          : null}
                      </div>
                    </td>
                    <td style={{padding:"12px 8px",textAlign:"center",verticalAlign:"middle",color:C.grey,fontSize:15}}>{line.qty}</td>
                    <td style={{padding:"12px 8px",textAlign:"right",verticalAlign:"middle",color:C.grey,whiteSpace:"nowrap",fontSize:15}}>{fmt(line.unitPrice)}</td>
                    <td style={{padding:"12px 20px",textAlign:"right",verticalAlign:"middle",fontWeight:700,color:C.text,whiteSpace:"nowrap",fontSize:15}}>{fmt(lineTotal)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>

        {/* ── NOTES + TOTAUX ── */}
        <div className="totaux-grid" style={{display:"flex",gap:16,marginBottom:20,alignItems:"flex-start",flexWrap:"wrap"}}>

          {/* Notes + Conditions */}
          <div style={{flex:1,minWidth:220,display:"flex",flexDirection:"column",gap:16}}>
            {d.remarks && (
              <Card style={{padding:"20px 24px"}}>
                <SectionLabel>Notes</SectionLabel>
                <div style={{fontSize:15,lineHeight:1.7,whiteSpace:"pre-wrap",color:C.grey}}>{d.remarks}</div>
              </Card>
            )}
            <Card style={{padding:"20px 24px"}}>
              <SectionLabel>Conditions</SectionLabel>
              {[
                ["Paiement", d.paymentMode],
                ["Livraison", d.deliveryMode||"Livraison à domicile"],
                d.leadTime ? ["Délai estimé", d.leadTime] : null,
              ].filter((x): x is string[] => x !== null).map(([k,v],i) => (
                <div key={i} style={{display:"flex",gap:12,marginBottom:8,fontSize:15}}>
                  <span style={{color:C.grey,fontWeight:500,minWidth:110}}>{k}</span>
                  <span style={{color:C.text}}>{v}</span>
                </div>
              ))}
            </Card>
          </div>

          {/* Totaux */}
          <Card style={{minWidth:300}}>
            <div style={{padding:"16px 24px 12px",borderBottom:`1px solid ${C.border}`}}>
              <SectionLabel>Récapitulatif</SectionLabel>
            </div>
            <div style={{padding:"8px 0"}}>
              <div style={{display:"flex",justifyContent:"space-between",padding:"8px 24px",fontSize:15}}>
                <span style={{color:C.grey}}>Sous-total articles</span>
                <span>{fmt(subTotal)}</span>
              </div>
              {discountValue>0 && (
                <div style={{display:"flex",justifyContent:"space-between",padding:"6px 24px",fontSize:15}}>
                  <span style={{color:C.grey}}>Remise globale</span>
                  <span style={{color:C.green,fontWeight:600}}>− {fmt(discountValue)}</span>
                </div>
              )}
              {activeServices.length>0 && (
                <>
                  <div style={{padding:"8px 24px 4px",fontSize:12,fontWeight:700,color:C.grey,textTransform:"uppercase",letterSpacing:"0.06em"}}>
                    Services inclus
                  </div>
                  {activeServices.map(srv => (
                    <div key={srv.code} style={{display:"flex",justifyContent:"space-between",
                      padding:"5px 24px 5px 36px",fontSize:14}}>
                      <span style={{color:C.grey}}>↳ {srv.label}</span>
                      <span style={{whiteSpace:"nowrap"}}>{fmt(srv.amount)}</span>
                    </div>
                  ))}
                </>
              )}
              {roundingValue!==0 && (
                <div style={{display:"flex",justifyContent:"space-between",padding:"6px 24px",fontSize:15}}>
                  <span style={{color:C.grey}}>Arrondi</span>
                  <span>{fmt(roundingValue)}</span>
                </div>
              )}
              <div style={{display:"flex",justifyContent:"space-between",
                padding:"6px 24px",fontSize:13,color:C.grey,
                borderTop:`1px solid ${C.border}`,marginTop:4}}>
                <span>TVA 8.1% {isPrivateTTC?"(incluse)":""}</span>
                <span>{fmt(tvaAmount)}</span>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                padding:"16px 24px",background:C.blueBtn,borderRadius:"0 0 24px 24px",marginTop:4}}>
                <span style={{fontWeight:700,fontSize:16,color:"white"}}>TOTAL {isPrivateTTC?"TTC":"HT+TVA"}</span>
                <span style={{fontWeight:700,fontSize:20,color:"white",whiteSpace:"nowrap"}}>{fmt(finalTotal)}</span>
              </div>
            </div>
          </Card>
        </div>

      </main>

      {/* ══ FOOTER ══ */}
      <footer style={{background:"white",color:C.text,fontFamily:FONT,borderTop:`1px solid ${C.border}`}}>
        <div style={{maxWidth:1260,margin:"0 auto",padding:"40px 24px 16px"}}>
          <div style={{display:"flex",flexWrap:"wrap",gap:32,marginBottom:32,justifyContent:"space-between"}}>

            {/* Col 1 */}
            <div style={{flex:"1 1 280px",maxWidth:360}}>
              <img src="https://www.jardin-confort.ch/cdn/shop/files/logo_JARDIN_CONFORT_shopify_51f35272-8a30-45a2-8718-36fb2af011c8.jpg?v=1736184411&width=480"
                alt="Jardin-Confort" style={{height:52,objectFit:"contain",marginBottom:16}}/>
              <p style={{fontSize:13,fontWeight:700,color:C.text,marginBottom:8}}>LE MEILLEUR DU MOBILIER D&apos;EXTÉRIEUR DEPUIS 1960</p>
              <p style={{fontSize:13,color:C.grey,lineHeight:1.7}}>
                Plus de 40 grandes marques de meubles de jardin de renom sur 1&apos;000m2 d&apos;exposition à Lutry.
              </p>
              <div style={{display:"flex",gap:8,marginTop:16}}>
                {[
                  {href:"https://www.facebook.com/jardinconfort",icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>},
                  {href:"https://www.instagram.com/jardinconfort",icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="2" width="20" height="20" rx="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>},
                ].map(({href,icon}) => (
                  <a key={href} href={href} target="_blank" rel="noopener noreferrer"
                    style={{display:"flex",alignItems:"center",justifyContent:"center",
                      width:36,height:36,borderRadius:"50%",background:C.bg,color:C.text}}>
                    {icon}
                  </a>
                ))}
              </div>
            </div>

            {/* Col 2 */}
            <div style={{flex:"0 1 160px"}}>
              <h3 style={{fontSize:13,fontWeight:700,marginBottom:16,color:C.text}}>Liens</h3>
              {[["Recherche","https://www.jardin-confort.ch/search"],
                ["Conditions générales","https://www.jardin-confort.ch/pages/conditions-generales"],
                ["Politique des retours","https://www.jardin-confort.ch/pages/politique-des-retours"],
              ].map(([label,href]) => (
                <div key={label} style={{marginBottom:12}}>
                  <a href={href} style={{fontSize:14,color:C.grey}}>{label}</a>
                </div>
              ))}
            </div>

            {/* Col 3 */}
            <div style={{flex:"0 1 200px"}}>
              <h3 style={{fontSize:13,fontWeight:700,marginBottom:16,color:C.text}}>JARDIN-CONFORT SA</h3>
              <div style={{fontSize:14,color:C.grey,lineHeight:2}}>
                <div>Route de Lavaux 425</div>
                <div>CH-1095 Lutry</div>
                <div>Suisse</div>
                <div style={{marginTop:8}}>
                  <a href="tel:+41217913671" style={{color:C.grey}}>T : +41 21 791 36 71</a>
                </div>
              </div>
            </div>
          </div>

          <div style={{borderTop:`1px solid ${C.border}`,paddingTop:16,
            display:"flex",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
            <span style={{fontSize:13,color:C.grey}}>© {new Date().getFullYear()} Jardin-Confort SA.</span>
            <div style={{display:"flex",gap:20,flexWrap:"wrap"}}>
              {[["Conditions générales","https://www.jardin-confort.ch/pages/conditions-generales"],
                ["Contact","https://www.jardin-confort.ch/pages/contact"],
              ].map(([label,href]) => (
                <a key={label} href={href} style={{fontSize:13,color:C.grey}}>{label}</a>
              ))}
            </div>
          </div>
        </div>
      </footer>
    </>
  );
}