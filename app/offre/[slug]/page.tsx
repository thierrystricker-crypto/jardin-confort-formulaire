"use client";
// app/offre/[slug]/page.tsx
// Page publique client — style boutique jardin-confort.ch
// DM Sans, #0060A9, #F3F5F6, corner radius 16px

import React, { useEffect, useState } from "react";

// ── Tokens du thème Jardin-Confort boutique ──
const C = {
  blue:       "#0060A9",   // headings, accents
  blueBtn:    "#2B8AD1",   // boutons primaires
  text:       "#2A2B2A",   // texte body
  bgPage:     "#F3F5F6",   // fond page
  bgCard:     "#FFFFFF",   // fond cards
  border:     "#E8EAED",   // bordures
  green:      "#2C7E3F",   // stock ok
  orange:     "#E67E22",   // stock limité / sur commande
  grey:       "#6B7280",   // texte secondaire
  topBar:     "#0060A9",   // bande top
};
const R = "16px"; // corner radius
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

// ── Composant card ──
function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: C.bgCard,
      border: `1px solid ${C.border}`,
      borderRadius: R,
      overflow: "hidden",
      ...style,
    }}>{children}</div>
  );
}

// ── Label de section ──
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 700, color: C.blue,
      textTransform: "uppercase", letterSpacing: "0.08em",
      padding: "14px 20px 10px",
      borderBottom: `1px solid ${C.border}`,
      marginBottom: 0,
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
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center",
      minHeight:"100vh", fontFamily:FONT, color:C.grey, fontSize:15 }}>
      Chargement de l'offre…
    </div>
  );

  if (error === "404") return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center",
      minHeight:"100vh", fontFamily:FONT, flexDirection:"column", gap:16,
      background: C.bgPage }}>
      <div style={{fontSize:52}}>🔍</div>
      <div style={{fontSize:22, fontWeight:700, color:C.blue}}>Offre introuvable</div>
      <div style={{color:C.grey, fontSize:14}}>Cette offre n'existe pas ou a été supprimée.</div>
    </div>
  );

  if (!offre) return null;
  const d = offre.data;
  const isPrivateTTC = d.clientType === "Privé (prix TTC)";

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

  const isEnCours = ["En cours","Envoyée"].includes(offre.statut);

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
      ? [
          d.livrSociete || null,
          [d.livrNom, d.livrPrenom].filter(Boolean).join(" ") || null,
          [d.livrRue, d.livrNumero].filter(Boolean).join(" ") || null,
          [d.livrNpa, d.livrVille].filter(Boolean).join(" ") || null,
          d.livrTel ? `Tél. ${d.livrTel}` : null,
        ].filter(Boolean) as string[]
      : addrFact.filter(l => !l.includes("@"));

  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com"/>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet"/>
      <style>{`
        *{box-sizing:border-box;margin:0;padding:0}
        body{font-family:${FONT};background:${C.bgPage};color:${C.text};font-size:15px;line-height:1.6}
        a{color:${C.blue};text-decoration:none}
        @media(max-width:640px){
          .addr-grid{flex-direction:column!important}
          .totaux-grid{flex-direction:column!important}
          .article-img{display:none!important}
        }
      `}</style>

      {/* ── TOP BAR bleue ── */}
      <div style={{background:C.topBar, padding:"7px 0", textAlign:"center"}}>
        <span style={{color:"white", fontSize:12, letterSpacing:"0.06em", fontWeight:500}}>
          MOBILIER D'EXTÉRIEUR DEPUIS 1960
        </span>
      </div>

      {/* ── HEADER boutique ── */}
      <header style={{background:"white", borderBottom:`1px solid ${C.border}`, padding:"16px 0", marginBottom:32}}>
        <div style={{maxWidth:960, margin:"0 auto", padding:"0 24px",
          display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:16}}>
          <img
            src="https://cdn.shopify.com/s/files/1/0360/3251/2135/files/logo_JARDIN_CONFORT_shopify.jpg?v=1614107698"
            alt="Jardin-Confort" style={{height:52, objectFit:"contain"}}
          />
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:13, color:C.grey}}>Votre offre personnalisée</div>
            <div style={{fontSize:22, fontWeight:700, color:C.blue, letterSpacing:"-0.02em"}}>
              {offre.type_document} {offre.numero_affiche}
            </div>
            <div style={{fontSize:13, color:C.grey, marginTop:2}}>
              {fmtDate(offre.date_document)} · Conseiller : {offre.commercial}
              {d.reference && ` · ${d.reference}`}
            </div>
          </div>
        </div>
      </header>

      <main style={{maxWidth:960, margin:"0 auto", padding:"0 24px 64px"}}>

        {/* ── STATUT ── */}
        {isEnCours && (
          <div style={{
            background:"#FFF8E1", border:"1px solid #FFD54F",
            borderRadius:R, padding:"14px 20px", marginBottom:24,
            display:"flex", alignItems:"center", gap:14,
          }}>
            <span style={{fontSize:24, flexShrink:0}}>⏳</span>
            <div>
              <div style={{fontWeight:700, color:"#856404", fontSize:15}}>
                Offre en attente de validation
              </div>
              <div style={{fontSize:13, color:"#9A7800", marginTop:3}}>
                Délai de livraison estimé : <strong>{d.leadTime||"–"}</strong>
                {d.deliveryMode && ` · ${d.deliveryMode}`}
              </div>
            </div>
          </div>
        )}
        {offre.statut==="Acceptée" && (
          <div style={{
            background:"#E8F5E9", border:`1px solid ${C.green}`,
            borderRadius:R, padding:"14px 20px", marginBottom:24,
            display:"flex", alignItems:"center", gap:14,
          }}>
            <span style={{fontSize:24}}>✅</span>
            <div style={{fontWeight:700, color:C.green, fontSize:15}}>
              Offre acceptée — Merci pour votre confiance !
            </div>
          </div>
        )}

        {/* ── ADRESSES ── */}
        <div className="addr-grid" style={{display:"flex", gap:16, marginBottom:24}}>
          <Card style={{flex:1}}>
            <SectionLabel>Adresse de facturation</SectionLabel>
            <div style={{padding:"14px 20px"}}>
              {addrFact.map((line, i) => (
                <div key={i} style={{
                  fontSize:14,
                  fontWeight: i===1 ? 600 : 400,
                  color: i===1 ? C.text : C.grey,
                  lineHeight:1.8,
                  fontStyle: line.includes("@") ? "normal" : "normal",
                }}>{line}</div>
              ))}
            </div>
          </Card>
          <Card style={{flex:1}}>
            <SectionLabel>Adresse de livraison</SectionLabel>
            <div style={{padding:"14px 20px"}}>
              {addrLivr.map((line, i) => (
                <div key={i} style={{
                  fontSize:14,
                  fontWeight: i===1 ? 600 : 400,
                  color: i===1 ? C.text : C.grey,
                  lineHeight:1.8,
                  fontStyle: d.deliveryMode==="À l'emporter" && i>0 ? "italic" : "normal",
                }}>{line}</div>
              ))}
            </div>
          </Card>
        </div>

        {/* ── ARTICLES ── */}
        <Card style={{marginBottom:24}}>
          <SectionLabel>
            Articles ({(d.lines||[]).filter(l=>l.type!=="comment").length})
          </SectionLabel>
          <table style={{width:"100%", borderCollapse:"collapse"}}>
            <thead>
              <tr style={{background:C.bgPage}}>
                <th className="article-img" style={{width:72,padding:"10px 16px"}}></th>
                <th style={{textAlign:"left",padding:"10px 8px",fontSize:12,fontWeight:600,color:C.grey}}>Article</th>
                <th style={{textAlign:"center",padding:"10px 8px",fontSize:12,fontWeight:600,color:C.grey,width:60}}>Qté</th>
                <th style={{textAlign:"right",padding:"10px 8px",fontSize:12,fontWeight:600,color:C.grey,width:110}}>Prix/pce</th>
                <th style={{textAlign:"right",padding:"10px 16px",fontSize:12,fontWeight:600,color:C.grey,width:120}}>Total</th>
              </tr>
            </thead>
            <tbody>
              {(d.lines||[]).map((line,i) => {
                if (line.type==="comment") return (
                  <tr key={line.id}>
                    <td colSpan={5} style={{
                      padding:"10px 16px", fontStyle:"italic",
                      color:C.grey, fontSize:13,
                      background:"#EEF4FB",
                      borderTop:`1px solid ${C.border}`,
                      borderBottom:`1px solid ${C.border}`,
                    }}>{line.title}</td>
                  </tr>
                );
                const lineTotal = line.qty*line.unitPrice-(line.lineDiscount||0);
                const sn = typeof line.stock==="number" ? line.stock : null;
                const isSC = line.stock==="sur_commande"||(sn!==null&&sn<1);
                const isOk = sn!==null&&sn>2;
                const isLow = sn!==null&&sn>0&&sn<=2;
                return (
                  <tr key={line.id} style={{
                    borderTop:`1px solid ${C.border}`,
                    background: i%2===0 ? "white" : C.bgPage,
                  }}>
                    <td className="article-img" style={{padding:"12px 16px",textAlign:"center",verticalAlign:"middle"}}>
                      {line.image
                        ? <img src={line.image} alt="" style={{width:56,height:56,objectFit:"contain",borderRadius:8}}/>
                        : <div style={{width:56,height:56,background:C.bgPage,borderRadius:8}}/>
                      }
                    </td>
                    <td style={{padding:"12px 8px",verticalAlign:"middle"}}>
                      <div style={{fontWeight:600,color:C.text,fontSize:14}}>{line.title}</div>
                      {line.sku && <div style={{fontSize:12,color:C.grey,marginTop:1}}>Réf. {line.sku}</div>}
                      {(line.lineDiscount||0)>0 && (
                        <div style={{fontSize:12,color:C.green,marginTop:2,fontWeight:500}}>
                          Remise : − {fmt(line.lineDiscount||0)}
                        </div>
                      )}
                      <div style={{marginTop:5,fontSize:12,fontWeight:600}}>
                        {sn===null||sn===undefined ? null
                          : isSC
                            ? <span style={{color:C.orange}}>📦 {line.delaiLivraison||"Sur commande"}</span>
                            : isOk
                              ? <span style={{color:C.green}}>✓ En stock ({sn} pce{sn>1?"s":""})</span>
                              : isLow
                                ? <span style={{color:C.orange}}>⚠ Stock limité ({sn} pce{sn>1?"s":""})</span>
                                : null}
                      </div>
                    </td>
                    <td style={{padding:"12px 8px",textAlign:"center",verticalAlign:"middle",color:C.grey,fontSize:14}}>
                      {line.qty}
                    </td>
                    <td style={{padding:"12px 8px",textAlign:"right",verticalAlign:"middle",color:C.grey,whiteSpace:"nowrap",fontSize:14}}>
                      {fmt(line.unitPrice)}
                    </td>
                    <td style={{padding:"12px 16px",textAlign:"right",verticalAlign:"middle",fontWeight:700,color:C.text,whiteSpace:"nowrap",fontSize:14}}>
                      {fmt(lineTotal)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>

        {/* ── NOTES + TOTAUX ── */}
        <div className="totaux-grid" style={{display:"flex",gap:16,marginBottom:24,alignItems:"flex-start",flexWrap:"wrap"}}>

          {/* Gauche : notes + conditions */}
          <div style={{flex:1,minWidth:220,display:"flex",flexDirection:"column",gap:16}}>
            {d.remarks && (
              <Card>
                <SectionLabel>Notes</SectionLabel>
                <div style={{padding:"14px 20px",fontSize:14,lineHeight:1.7,color:C.grey,whiteSpace:"pre-wrap"}}>
                  {d.remarks}
                </div>
              </Card>
            )}
            <Card>
              <SectionLabel>Conditions</SectionLabel>
              <div style={{padding:"14px 20px"}}>
                {[
                  ["Paiement", d.paymentMode],
                  ["Livraison", d.deliveryMode||"Livraison à domicile"],
                  d.leadTime ? ["Délai estimé", d.leadTime] : null,
                ].filter((x): x is string[] => x !== null).map(([k,v],i) => (
                  <div key={i} style={{display:"flex",gap:12,marginBottom:8,fontSize:14}}>
                    <span style={{color:C.grey,fontWeight:500,minWidth:100}}>{k}</span>
                    <span style={{color:C.text}}>{v}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {/* Droite : totaux */}
          <Card style={{minWidth:300}}>
            <SectionLabel>Récapitulatif</SectionLabel>
            <div style={{padding:"8px 0"}}>
              {/* Sous-total */}
              <div style={{display:"flex",justifyContent:"space-between",padding:"8px 20px",fontSize:14}}>
                <span style={{color:C.grey}}>Sous-total articles</span>
                <span style={{color:C.text}}>{fmt(subTotal)}</span>
              </div>
              {/* Remise */}
              {discountValue>0 && (
                <div style={{display:"flex",justifyContent:"space-between",padding:"6px 20px",fontSize:14}}>
                  <span style={{color:C.grey}}>Remise</span>
                  <span style={{color:C.green,fontWeight:600}}>− {fmt(discountValue)}</span>
                </div>
              )}
              {/* Services */}
              {activeServices.length>0 && (
                <>
                  <div style={{padding:"8px 20px 4px",fontSize:11,fontWeight:700,color:C.grey,textTransform:"uppercase",letterSpacing:"0.06em"}}>
                    Services inclus
                  </div>
                  {activeServices.map((srv,i) => (
                    <div key={srv.code} style={{
                      display:"flex",justifyContent:"space-between",
                      padding:"5px 20px 5px 32px",fontSize:13,
                      background:i%2===0?"white":C.bgPage,
                    }}>
                      <span style={{color:C.grey}}>↳ {srv.label}</span>
                      <span style={{color:C.text,whiteSpace:"nowrap"}}>{fmt(srv.amount)}</span>
                    </div>
                  ))}
                </>
              )}
              {/* Arrondi */}
              {roundingValue!==0 && (
                <div style={{display:"flex",justifyContent:"space-between",padding:"6px 20px",fontSize:14}}>
                  <span style={{color:C.grey}}>Arrondi</span>
                  <span>{fmt(roundingValue)}</span>
                </div>
              )}
              {/* TVA */}
              <div style={{
                display:"flex",justifyContent:"space-between",
                padding:"6px 20px",fontSize:12,color:C.grey,
                borderTop:`1px solid ${C.border}`,marginTop:4,
              }}>
                <span>TVA 8.1% {isPrivateTTC?"(incluse)":""}</span>
                <span>{fmt(tvaAmount)}</span>
              </div>
              {/* TOTAL */}
              <div style={{
                display:"flex",justifyContent:"space-between",alignItems:"center",
                padding:"16px 20px",
                background:C.blue,
                borderRadius:"0 0 14px 14px",
                marginTop:4,
              }}>
                <span style={{fontWeight:700,fontSize:16,color:"white"}}>
                  TOTAL {isPrivateTTC?"TTC":"HT+TVA"}
                </span>
                <span style={{fontWeight:700,fontSize:20,color:"white",whiteSpace:"nowrap"}}>
                  {fmt(finalTotal)}
                </span>
              </div>
            </div>
          </Card>
        </div>

        {/* ── STOCK MIS À JOUR ── */}
        {offre.stockRefreshedAt && (
          <div style={{textAlign:"center",fontSize:12,color:"#C0C4CC",marginBottom:32}}>
            🔄 Disponibilités vérifiées le {new Date(offre.stockRefreshedAt).toLocaleString("fr-CH")}
          </div>
        )}

        {/* ── FOOTER ── */}
        <div style={{
          borderTop:`1px solid ${C.border}`,paddingTop:24,
          textAlign:"center",color:C.grey,fontSize:13,lineHeight:2,
        }}>
          <div>
            <strong style={{color:C.text}}>Jardin-Confort SA</strong> · Route de Lavaux 425 · 1095 Lutry
          </div>
          <div>
            <a href="tel:+41217913671" style={{color:C.blue}}>+41 21 791 36 71</a>
            {" · "}
            <a href="mailto:contact@jardinconfort.ch" style={{color:C.blue}}>contact@jardinconfort.ch</a>
            {" · "}
            <a href="https://www.jardin-confort.ch" style={{color:C.blue}}>www.jardin-confort.ch</a>
          </div>
          <div style={{fontSize:11,color:"#C0C4CC",marginTop:8}}>
            TVA CHE-100.142.327 ·{" "}
            <a href="https://www.jardin-confort.ch/pages/conditions-generales" style={{color:"#C0C4CC"}}>
              Conditions générales de vente
            </a>
          </div>
        </div>

      </main>
    </>
  );
}