"use client";
// app/offre/[slug]/page.tsx
// Page publique client — style identique au template d'impression Jardin-Confort
// Stock en temps réel depuis Shopify

import React, { useEffect, useState } from "react";

const THEME = "#2b8ad1";
const BLACK = "#000000";
const GREY  = "#333333";
const LIGHT = "#f9f9f9";

const serviceLabels: Record<string, string> = {
  montage:       "Frais de montage",
  poste:         "Livraison des colis par La Poste",
  trottoir:      "Livraison colis franco trottoir par transporteur",
  etage:         "Livraison « à l'étage » et déballage des articles",
  etage_montage: "Livraison « à l'étage », déballage et montage",
  reprise:       "Reprise et recyclage des anciens meubles",
};

const TVA_RATE = 0.081;

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
  client_npa: string;
  client_ville: string;
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
  return "CHF\u00a0" + new Intl.NumberFormat("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
}
function fmtDate(iso: string) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("fr-CH", { day: "2-digit", month: "2-digit", year: "numeric" });
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
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",minHeight:"100vh",fontFamily:"'Raleway',sans-serif",color:GREY,fontSize:14}}>
      Chargement de l'offre…
    </div>
  );
  if (error === "404") return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",minHeight:"100vh",fontFamily:"'Raleway',sans-serif",flexDirection:"column",gap:12}}>
      <div style={{fontSize:48}}>🔍</div>
      <div style={{fontSize:20,fontWeight:700,color:"#333"}}>Offre introuvable</div>
      <div style={{color:"#888",fontSize:13}}>Cette offre n'existe pas ou a été supprimée.</div>
    </div>
  );
  if (!offre) return null;

  const d = offre.data;
  const isPrivateTTC = d.clientType === "Privé (prix TTC)";

  // ── Totaux ──
  const subTotal = (d.lines||[]).reduce((s,l) => l.type==="comment" ? s : s + l.qty*l.unitPrice - (l.lineDiscount||0), 0);
  const discountPct = Number(d.discountPercent||0);
  const discountValue = discountPct > 0 ? Math.round(subTotal*discountPct)/100 : Number(d.discount||0);
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
  const tvaAmount = isPrivateTTC ? totalAfterAll - totalAfterAll/(1+TVA_RATE) : totalAfterAll*TVA_RATE;
  const finalTotal = isPrivateTTC ? totalAfterAll : totalAfterAll+tvaAmount;

  const isEnCours = ["En cours","Envoyée"].includes(offre.statut);

  // Adresses
  const addrFact = [
    d.societe,
    [d.nom, d.prenom].filter(Boolean).join(" "),
    [d.rue, d.numero].filter(Boolean).join(" "),
    [d.npa, d.ville].filter(Boolean).join(" "),
    d.telephone1 ? `Tél. ${d.telephone1}` : null,
    d.email,
  ].filter(Boolean) as string[];

  const addrLivr = d.deliveryMode === "À l'emporter"
    ? ["À l'emporter", "Jardin-Confort SA", "Route de Lavaux 425", "1095 Lutry"]
    : d.livrDiff
      ? [d.livrSociete, [d.livrNom, d.livrPrenom].filter(Boolean).join(" "), [d.livrRue, d.livrNumero].filter(Boolean).join(" "), [d.livrNpa, d.livrVille].filter(Boolean).join(" "), d.livrTel ? `Tél. ${d.livrTel}` : null].filter(Boolean) as string[]
      : addrFact.slice(0, -1); // Même que facturation sans email

  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com"/>
      <link href="https://fonts.googleapis.com/css2?family=Raleway:wght@300;400;600;700;900&display=swap" rel="stylesheet"/>
      <style>{`
        *{box-sizing:border-box;margin:0;padding:0}
        body{font-family:'Raleway',sans-serif;background:#eff1f4;color:${GREY};font-size:13px;line-height:1.5}
        a{color:${THEME}}
        @media print{@page{margin:14mm 16mm}body{background:white}.no-print{display:none!important}}
      `}</style>

      {/* ── HEADER ── */}
      <div style={{background:"white",borderBottom:`3px solid ${THEME}`,marginBottom:24}}>
        <div style={{maxWidth:900,margin:"0 auto",padding:"14px 24px",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:12}}>
          <div style={{display:"flex",alignItems:"center",gap:16}}>
            <img src="https://cdn.shopify.com/s/files/1/0360/3251/2135/files/logo_JARDIN_CONFORT_shopify.jpg?v=1614107698"
              alt="Jardin-Confort" style={{height:52,objectFit:"contain"}}/>
            <div>
              <div style={{fontSize:11,color:"#bbb",textTransform:"uppercase",letterSpacing:"0.08em"}}>Jardin-Confort SA · Lutry</div>
              <div style={{fontSize:22,fontWeight:400,color:THEME,letterSpacing:"-0.01em"}}>{offre.type_document}</div>
            </div>
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:22,fontWeight:900,color:BLACK,letterSpacing:"-0.02em"}}>{offre.numero_affiche}</div>
            {d.reference && <div style={{fontSize:12,color:"#999",marginTop:1}}>{d.reference}</div>}
            <div style={{fontSize:11,color:"#bbb",marginTop:2}}>{fmtDate(offre.date_document)} · {offre.commercial}</div>
          </div>
        </div>
      </div>

      <div style={{maxWidth:900,margin:"0 auto",padding:"0 24px 48px"}}>

        {/* ── STATUT ── */}
        {isEnCours && (
          <div style={{background:"#fff8e1",border:"1px solid #ffc107",borderRadius:6,padding:"12px 16px",marginBottom:20,display:"flex",alignItems:"center",gap:12}}>
            <span style={{fontSize:18,flexShrink:0}}>⏳</span>
            <div>
              <div style={{fontWeight:700,color:"#856404",fontSize:13}}>Offre en attente de validation</div>
              <div style={{fontSize:12,color:"#856404",marginTop:2}}>
                Délai estimé : <strong>{d.leadTime||"–"}</strong>
                {d.deliveryMode && ` · ${d.deliveryMode}`}
              </div>
            </div>
          </div>
        )}
        {offre.statut==="Acceptée" && (
          <div style={{background:"#e8f5e9",border:"1px solid #4caf50",borderRadius:6,padding:"12px 16px",marginBottom:20,display:"flex",alignItems:"center",gap:10}}>
            <span style={{fontSize:18}}>✅</span>
            <div style={{fontWeight:700,color:"#2e7d32",fontSize:13}}>Offre acceptée — Merci pour votre confiance !</div>
          </div>
        )}

        {/* ── ADRESSES (style template print) ── */}
        <div style={{display:"flex",gap:0,marginBottom:20,background:"white",border:"1px solid #e0e0e0",borderRadius:6,overflow:"hidden"}}>
          <div style={{flex:1,padding:"16px 20px",borderRight:"2px solid #f0f0f0"}}>
            <div style={{fontSize:10,fontWeight:700,color:THEME,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:8,paddingBottom:6,borderBottom:`1px solid ${THEME}`}}>
              Adresse de facturation
            </div>
            {addrFact.map((line,i) => (
              <div key={i} style={{fontSize:12,color:i===1?BLACK:GREY,fontWeight:i===1?700:400,lineHeight:1.7}}>{line}</div>
            ))}
          </div>
          <div style={{flex:1,padding:"16px 20px"}}>
            <div style={{fontSize:10,fontWeight:700,color:THEME,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:8,paddingBottom:6,borderBottom:`1px solid ${THEME}`}}>
              Adresse de livraison
            </div>
            {addrLivr.map((line,i) => (
              <div key={i} style={{fontSize:12,color:i===1?BLACK:GREY,fontWeight:i===1?700:400,lineHeight:1.7,fontStyle:d.deliveryMode==="À l'emporter"&&i>0?"italic":"normal"}}>{line}</div>
            ))}
          </div>
        </div>

        {/* ── TABLEAU ARTICLES (style identique template print) ── */}
        <div style={{background:"white",border:"1px solid #e0e0e0",borderRadius:6,overflow:"hidden",marginBottom:20}}>
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead>
              <tr style={{borderTop:`2px solid ${THEME}`,borderBottom:`2px solid ${THEME}`,background:"white"}}>
                <th style={{width:60,padding:"9px 12px"}}></th>
                <th style={{textAlign:"left",padding:"9px 8px",fontSize:11,fontWeight:700,color:BLACK,textTransform:"uppercase",letterSpacing:"0.05em"}}>Description de l'article</th>
                <th style={{textAlign:"center",padding:"9px 8px",fontSize:11,fontWeight:700,color:BLACK,width:55,textTransform:"uppercase",letterSpacing:"0.05em"}}>Qté</th>
                <th style={{textAlign:"right",padding:"9px 8px",fontSize:11,fontWeight:700,color:BLACK,width:105,textTransform:"uppercase",letterSpacing:"0.05em"}}>Prix/pce</th>
                <th style={{textAlign:"right",padding:"9px 14px",fontSize:11,fontWeight:700,color:BLACK,width:115,textTransform:"uppercase",letterSpacing:"0.05em"}}>Total</th>
              </tr>
            </thead>
            <tbody>
              {(d.lines||[]).map((line,i) => {
                if (line.type==="comment") return (
                  <tr key={line.id}>
                    <td colSpan={5} style={{padding:"8px 14px",fontStyle:"italic",color:"#667",fontSize:12,background:"#eef4fb",borderBottom:"1px solid #dde8f5"}}>{line.title}</td>
                  </tr>
                );
                const lineTotal = line.qty*line.unitPrice-(line.lineDiscount||0);
                const sn = typeof line.stock==="number" ? line.stock : null;
                const isSC = line.stock==="sur_commande"||(sn!==null&&sn<1);
                const isOk = sn!==null&&sn>2;
                const isLow = sn!==null&&sn>0&&sn<=2;
                return (
                  <tr key={line.id} style={{background:i%2===0?LIGHT:"white"}}>
                    <td style={{padding:"10px 12px",textAlign:"center",borderBottom:"1px solid #efefef",verticalAlign:"middle"}}>
                      {line.image && <img src={line.image} alt="" style={{width:50,height:50,objectFit:"contain"}}/>}
                    </td>
                    <td style={{padding:"10px 8px",borderBottom:"1px solid #efefef",verticalAlign:"middle"}}>
                      <div style={{fontWeight:700,color:BLACK,fontSize:13}}>{line.title}</div>
                      {line.sku && <div style={{fontSize:11,color:"#aaa",marginTop:1}}>{line.sku}</div>}
                      {(line.lineDiscount||0)>0 && (
                        <div style={{fontSize:11,color:"#27ae60",marginTop:2}}>Remise : − {fmt(line.lineDiscount||0)}</div>
                      )}
                      <div style={{marginTop:4,fontSize:11,fontWeight:600}}>
                        {sn===null||sn===undefined ? null
                          : isSC ? <span style={{color:"#e67e22"}}>{line.delaiLivraison||"Sur commande"}</span>
                          : isOk ? <span style={{color:"#27ae60"}}>✓ En stock ({sn} pce{sn>1?"s":""})</span>
                          : isLow ? <span style={{color:"#e67e22"}}>⚠ Stock limité ({sn} pce{sn>1?"s":""})</span>
                          : null}
                      </div>
                    </td>
                    <td style={{padding:"10px 8px",textAlign:"center",borderBottom:"1px solid #efefef",color:GREY,verticalAlign:"middle",fontSize:13}}>× {line.qty}</td>
                    <td style={{padding:"10px 8px",textAlign:"right",borderBottom:"1px solid #efefef",color:GREY,whiteSpace:"nowrap",verticalAlign:"middle",fontSize:13}}>{fmt(line.unitPrice)}</td>
                    <td style={{padding:"10px 14px",textAlign:"right",borderBottom:"1px solid #efefef",fontWeight:700,color:BLACK,whiteSpace:"nowrap",verticalAlign:"middle",fontSize:13}}>{fmt(lineTotal)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* ── NOTES + TOTAUX (côte à côte comme template print) ── */}
        <div style={{display:"flex",gap:16,marginBottom:20,alignItems:"flex-start",flexWrap:"wrap"}}>

          {/* Notes */}
          <div style={{flex:1,minWidth:200,display:"flex",flexDirection:"column",gap:12}}>
            {d.remarks && (
              <div style={{background:"white",border:"1px solid #e0e0e0",borderRadius:6,padding:"14px 18px"}}>
                <div style={{fontSize:10,fontWeight:700,color:BLACK,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8,paddingBottom:5,borderBottom:"1px solid #eee"}}>Notes</div>
                <div style={{fontSize:12,lineHeight:1.7,whiteSpace:"pre-wrap",color:GREY}}>{d.remarks}</div>
              </div>
            )}
            {/* Conditions */}
            <div style={{background:"white",border:"1px solid #e0e0e0",borderRadius:6,padding:"14px 18px"}}>
              <div style={{fontSize:10,fontWeight:700,color:BLACK,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8,paddingBottom:5,borderBottom:"1px solid #eee"}}>Conditions</div>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                <tbody>
                  <tr><td style={{color:GREY,paddingBottom:4,paddingRight:8,fontWeight:600,width:"45%"}}>Paiement</td><td>{d.paymentMode}</td></tr>
                  <tr><td style={{color:GREY,paddingBottom:4,fontWeight:600}}>Livraison</td><td>{d.deliveryMode||"Livraison à domicile"}</td></tr>
                  {d.leadTime && <tr><td style={{color:GREY,paddingBottom:4,fontWeight:600}}>Délai estimé</td><td>{d.leadTime}</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {/* Totaux */}
          <div style={{minWidth:300,background:"white",border:"1px solid #e0e0e0",borderRadius:6,overflow:"hidden"}}>
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <tbody>
                {/* Sous-total */}
                <tr style={{background:LIGHT}}>
                  <td style={{padding:"9px 16px",fontSize:12,color:GREY}}>Sous-total articles</td>
                  <td style={{padding:"9px 16px",textAlign:"right",fontSize:12,whiteSpace:"nowrap"}}>{fmt(subTotal)}</td>
                </tr>
                {/* Remise */}
                {discountValue>0 && (
                  <tr>
                    <td style={{padding:"7px 16px",fontSize:12,color:GREY}}>Remise globale</td>
                    <td style={{padding:"7px 16px",textAlign:"right",fontSize:12,color:"#27ae60",whiteSpace:"nowrap"}}>− {fmt(discountValue)}</td>
                  </tr>
                )}
                {/* Services détaillés */}
                {activeServices.length>0 && (
                  <>
                    <tr style={{background:LIGHT}}>
                      <td colSpan={2} style={{padding:"7px 16px 3px",fontSize:10,fontWeight:700,color:BLACK,textTransform:"uppercase",letterSpacing:"0.06em"}}>
                        Services
                      </td>
                    </tr>
                    {activeServices.map((srv,i) => (
                      <tr key={srv.code} style={{background:i%2===0?"white":LIGHT}}>
                        <td style={{padding:"5px 16px 5px 24px",fontSize:12,color:GREY}}>↳ {srv.label}</td>
                        <td style={{padding:"5px 16px",textAlign:"right",fontSize:12,whiteSpace:"nowrap"}}>{fmt(srv.amount)}</td>
                      </tr>
                    ))}
                  </>
                )}
                {/* Arrondi */}
                {roundingValue!==0 && (
                  <tr>
                    <td style={{padding:"7px 16px",fontSize:12,color:GREY}}>Arrondi</td>
                    <td style={{padding:"7px 16px",textAlign:"right",fontSize:12,whiteSpace:"nowrap"}}>{fmt(roundingValue)}</td>
                  </tr>
                )}
                {/* TVA */}
                <tr style={{borderTop:"1px solid #eee"}}>
                  <td style={{padding:"7px 16px",fontSize:11,color:"#aaa"}}>TVA 8.1% {isPrivateTTC?"(incluse)":""}</td>
                  <td style={{padding:"7px 16px",textAlign:"right",fontSize:11,color:"#aaa",whiteSpace:"nowrap"}}>{fmt(tvaAmount)}</td>
                </tr>
                {/* TOTAL */}
                <tr style={{borderTop:`2px solid ${THEME}`,background:"white"}}>
                  <td style={{padding:"14px 16px",fontWeight:900,fontSize:17,color:BLACK}}>TOTAL {isPrivateTTC?"TTC":"HT+TVA"}</td>
                  <td style={{padding:"14px 16px",textAlign:"right",fontWeight:900,fontSize:17,color:BLACK,whiteSpace:"nowrap"}}>{fmt(finalTotal)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* ── STOCK MIS À JOUR ── */}
        {offre.stockRefreshedAt && (
          <div style={{textAlign:"center",fontSize:11,color:"#ccc",marginBottom:24}}>
            Stock mis à jour le {new Date(offre.stockRefreshedAt).toLocaleString("fr-CH")}
          </div>
        )}

        {/* ── FOOTER ── */}
        <div style={{borderTop:"1px solid #ddd",paddingTop:14,textAlign:"center",color:"#bbb",fontSize:11,lineHeight:1.9}}>
          <strong style={{color:"#666",fontSize:12}}>Jardin-Confort SA</strong><br/>
          Route de Lavaux 425 · 1095 Lutry · +41 21 791 36 71 · contact@jardinconfort.ch<br/>
          <a href="https://www.jardin-confort.ch" style={{color:THEME}}>www.jardin-confort.ch</a> · TVA CHE-100.142.327<br/>
          <span style={{fontSize:10,color:"#ddd"}}>
            En consultant cette offre, vous acceptez nos{" "}
            <a href="https://www.jardin-confort.ch/pages/conditions-generales" style={{color:"#ccc"}}>conditions générales de vente</a>.
          </span>
        </div>

      </div>
    </>
  );
}