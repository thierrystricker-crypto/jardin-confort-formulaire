"use client";
// ═══════════════════════════════════════════════════════════════
//  app/offre/[slug]/page.tsx
//  Page publique CLIENT — vue de l'offre avec stock temps réel
//  URL : /offre/dev-2026-001  ou  /offre/cmd-80500
// ═══════════════════════════════════════════════════════════════

import React, { useEffect, useState } from "react";

const THEME = "#2b8ad1";

type StockStatus = number | "sur_commande" | null;

type QuoteLine = {
  id: string;
  type: "product" | "custom" | "comment";
  image?: string;
  sku: string;
  title: string;
  unitPrice: number;
  qty: number;
  stock?: StockStatus;
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
  reference: string;
  commercial: string;
  client_nom: string;
  client_prenom: string;
  client_societe: string;
  client_email: string;
  client_npa: string;
  client_ville: string;
  total_ttc: number;
  data: {
    lines: QuoteLine[];
    clientType: string;
    paymentMode: string;
    deliveryMode?: string;
    leadTime: string;
    remarks: string;
    discount: string;
    discountPercent: string;
    manualRounding: string;
    enabledServices: Record<string, boolean>;
    servicePrices: Record<string, string>;
    reference?: string;
    societe?: string;
    nom?: string;
    prenom?: string;
    rue?: string;
    numero?: string;
    npa?: string;
    ville?: string;
    telephone1?: string;
    livrDiff?: boolean;
    livrSociete?: string;
    livrNom?: string;
    livrPrenom?: string;
    livrTel?: string;
    livrRue?: string;
    livrNumero?: string;
    livrNpa?: string;
    livrVille?: string;
  };
  stockRefreshedAt?: string;
};

function formatMoney(value: number): string {
  return "CHF " + new Intl.NumberFormat("de-CH", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(value);
}

function formatDate(iso: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("fr-CH", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
}

const TVA_RATE = 0.081;
const serviceLabels: Record<string, string> = {
  montage:       "Frais de montage",
  poste:         "Livraison des colis par La Poste",
  trottoir:      "Livraison colis franco trottoir par transporteur",
  etage:         "Livraison « à l'étage » et déballage des articles",
  etage_montage: "Livraison « à l'étage », déballage et montage",
  reprise:       "Reprise et recyclage des anciens meubles",
};

export default function OffrePubliquePage({ params }: { params: Promise<{ slug: string }> }) {
  const [offre, setOffre] = useState<OffreData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [slug, setSlug] = useState("");

  useEffect(() => {
    async function load() {
      const { slug: s } = await params;
      setSlug(s);
      try {
        const res = await fetch(`/api/offres/${s}`);
        if (!res.ok) {
          if (res.status === 404) { setError("404"); return; }
          throw new Error("Erreur serveur");
        }
        const json = await res.json();
        setOffre(json.offre);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [params]);

  if (loading) return (
    <div style={{display:"flex", alignItems:"center", justifyContent:"center", minHeight:"100vh", fontFamily:"Raleway,sans-serif", color:"#555"}}>
      <div>Chargement de l'offre…</div>
    </div>
  );

  if (error === "404") return (
    <div style={{display:"flex", alignItems:"center", justifyContent:"center", minHeight:"100vh", fontFamily:"Raleway,sans-serif"}}>
      <div style={{textAlign:"center"}}>
        <div style={{fontSize:48, marginBottom:16}}>🔍</div>
        <div style={{fontSize:22, fontWeight:700, color:"#333"}}>Offre introuvable</div>
        <div style={{color:"#888", marginTop:8}}>Cette offre n'existe pas ou a été supprimée.</div>
      </div>
    </div>
  );

  if (error || !offre) return (
    <div style={{padding:40, color:"red", fontFamily:"Raleway,sans-serif"}}>Erreur : {error}</div>
  );

  const d = offre.data;
  const isPrivateTTC = d.clientType === "Privé (prix TTC)";

  // Calcul des totaux
  const subTotal = (d.lines || []).reduce((s: number, l: QuoteLine) => {
    if (l.type === "comment") return s;
    return s + l.qty * l.unitPrice - (l.lineDiscount || 0);
  }, 0);

  const discountPct = Number(d.discountPercent || 0);
  const discountValue = discountPct > 0
    ? Math.round(subTotal * discountPct) / 100
    : Number(d.discount || 0);

  const serviceTotal = Object.entries(d.enabledServices || {}).reduce((s, [code, enabled]) => {
    if (!enabled) return s;
    return s + Number(d.servicePrices?.[code] || 0);
  }, 0);

  const roundingValue = Math.min(0, Number(d.manualRounding) || 0);
  const totalAfterAll = subTotal - discountValue + serviceTotal + roundingValue;
  const tvaAmount = isPrivateTTC
    ? totalAfterAll - totalAfterAll / (1 + TVA_RATE)
    : totalAfterAll * TVA_RATE;
  const finalTotal = isPrivateTTC ? totalAfterAll : totalAfterAll + tvaAmount;

  const isEnCours = ["En cours", "Envoyée"].includes(offre.statut);

  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link href="https://fonts.googleapis.com/css2?family=Raleway:wght@300;400;600;700;900&display=swap" rel="stylesheet" />
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Raleway', sans-serif; background: #f5f6f8; color: #333; font-size: 14px; }
        @media print { @page { margin: 12mm; } }
      `}</style>

      {/* HEADER */}
      <header style={{background:"white", borderBottom:`3px solid ${THEME}`, padding:"16px 24px"}}>
        <div style={{maxWidth:860, margin:"0 auto", display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:12}}>
          <div style={{display:"flex", alignItems:"center", gap:14}}>
            <img
              src="https://cdn.shopify.com/s/files/1/0360/3251/2135/files/logo_JARDIN_CONFORT_shopify.jpg?v=1614107698"
              alt="Jardin-Confort"
              style={{height:48, objectFit:"contain"}}
            />
            <div>
              <div style={{fontSize:11, color:"#999", textTransform:"uppercase", letterSpacing:"0.06em"}}>Jardin-Confort SA · Lutry</div>
              <div style={{fontSize:20, fontWeight:700, color:THEME}}>{offre.type_document}</div>
            </div>
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:18, fontWeight:900, color:"#222"}}>{offre.numero_affiche}</div>
            {(offre.data.reference as string) && <div style={{fontSize:12, color:"#888", marginTop:2}}>{offre.data.reference as string}</div>}
            <div style={{fontSize:12, color:"#aaa", marginTop:2}}>
              {formatDate(offre.date_document)} · {offre.commercial}
            </div>
          </div>
        </div>
      </header>

      <main style={{maxWidth:860, margin:"24px auto", padding:"0 16px"}}>

        {/* STATUT OFFRE EN COURS */}
        {isEnCours && (
          <div style={{
            background:"#fff8e1", border:"1px solid #ffc107",
            borderRadius:8, padding:"12px 16px", marginBottom:20,
            display:"flex", alignItems:"center", gap:12,
          }}>
            <span style={{fontSize:20}}>⏳</span>
            <div>
              <div style={{fontWeight:700, color:"#856404"}}>Offre en attente de validation</div>
              <div style={{fontSize:12, color:"#856404", marginTop:2}}>
                Délai de livraison estimé : <strong>{d.leadTime}</strong> — Mode : {(d as any).deliveryMode || "Livraison à domicile"}
              </div>
            </div>
          </div>
        )}

        {offre.statut === "Acceptée" && (
          <div style={{background:"#e8f5e9", border:"1px solid #4caf50", borderRadius:8, padding:"12px 16px", marginBottom:20, display:"flex", alignItems:"center", gap:12}}>
            <span style={{fontSize:20}}>✅</span>
            <div style={{fontWeight:700, color:"#2e7d32"}}>Offre acceptée — Merci pour votre confiance !</div>
          </div>
        )}

        {/* ARTICLES */}
        <div style={{background:"white", borderRadius:8, border:"1px solid #e0e0e0", overflow:"hidden", marginBottom:20}}>
          <div style={{borderTop:`2px solid ${THEME}`, padding:"14px 16px", borderBottom:"1px solid #f0f0f0"}}>
            <div style={{fontWeight:700, fontSize:13, color:"#555", textTransform:"uppercase", letterSpacing:"0.06em"}}>
              Articles ({(d.lines || []).filter((l: QuoteLine) => l.type !== "comment").length})
            </div>
          </div>

          {(d.lines || []).map((line: QuoteLine) => {
            if (line.type === "comment") {
              return (
                <div key={line.id} style={{padding:"10px 16px", background:"#f0f5ff", borderBottom:"1px solid #e8edf5", fontStyle:"italic", color:"#556", fontSize:13}}>
                  {line.title}
                </div>
              );
            }
            const lineTotal = line.qty * line.unitPrice - (line.lineDiscount || 0);
            const stockNum = typeof line.stock === "number" ? line.stock : null;
            const isSurCommande = line.stock === "sur_commande" || stockNum === 0 || (stockNum !== null && stockNum < 1);
            const stockOk = stockNum !== null && stockNum > 2;
            const stockLow = stockNum !== null && stockNum > 0 && stockNum <= 2;

            return (
              <div key={line.id} style={{
                padding:"14px 16px",
                borderBottom:"1px solid #f5f5f5",
                display:"flex", alignItems:"flex-start", gap:14,
              }}>
                {line.image && (
                  <img src={line.image} alt="" style={{width:64, height:64, objectFit:"contain", borderRadius:4, border:"1px solid #eee", flexShrink:0}} />
                )}
                <div style={{flex:1, minWidth:0}}>
                  <div style={{fontWeight:700, color:"#111", lineHeight:1.3}}>{line.title}</div>
                  {line.sku && <div style={{fontSize:11, color:"#999", marginTop:2}}>{line.sku}</div>}
                  {(line.lineDiscount || 0) > 0 && (
                    <div style={{fontSize:12, color:"#2a8a2a", marginTop:3}}>Remise : − {formatMoney(line.lineDiscount || 0)}</div>
                  )}
                  {/* Stock */}
                  <div style={{marginTop:5, fontSize:12}}>
                    {line.stock === null || line.stock === undefined ? null
                      : isSurCommande ? (
                        <span style={{color:"#f59e0b", fontWeight:700}}>
                          {line.delaiLivraison || "Sur commande"}
                        </span>
                      ) : stockOk ? (
                        <span style={{color:"#2a8a2a", fontWeight:600}}>✓ En stock ({stockNum} pce{(stockNum||0) > 1 ? "s" : ""})</span>
                      ) : stockLow ? (
                        <span style={{color:"#f59e0b", fontWeight:600}}>⚠ Stock limité ({stockNum} pce{(stockNum||0) > 1 ? "s" : ""})</span>
                      ) : null
                    }
                  </div>
                </div>
                <div style={{textAlign:"right", flexShrink:0}}>
                  <div style={{fontSize:12, color:"#999"}}>× {line.qty} · {formatMoney(line.unitPrice)}</div>
                  <div style={{fontWeight:700, fontSize:15, color:"#111", marginTop:2}}>{formatMoney(lineTotal)}</div>
                </div>
              </div>
            );
          })}
        </div>

        {/* TOTAUX + NOTES */}
        <div style={{display:"flex", gap:16, flexWrap:"wrap", marginBottom:20}}>

          {/* Notes */}
          {d.remarks && (
            <div style={{flex:1, minWidth:200, background:"white", borderRadius:8, border:"1px solid #e0e0e0", padding:16}}>
              <div style={{fontWeight:700, fontSize:12, color:"#888", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:8}}>Notes</div>
              <div style={{fontSize:13, lineHeight:1.6, whiteSpace:"pre-wrap"}}>{d.remarks}</div>
            </div>
          )}

          {/* Totaux */}
          <div style={{background:"white", borderRadius:8, border:"1px solid #e0e0e0", overflow:"hidden", minWidth:260}}>
            <table style={{width:"100%", borderCollapse:"collapse"}}>
              <tbody>
                <tr>
                  <td style={{padding:"8px 16px", color:"#555"}}>Sous-total</td>
                  <td style={{padding:"8px 16px", textAlign:"right"}}>{formatMoney(subTotal)}</td>
                </tr>
                {discountValue > 0 && (
                  <tr>
                    <td style={{padding:"6px 16px", color:"#555"}}>Remise</td>
                    <td style={{padding:"6px 16px", textAlign:"right", color:"#2a8a2a"}}>− {formatMoney(discountValue)}</td>
                  </tr>
                )}
                {serviceTotal > 0 && (
                  <tr>
                    <td style={{padding:"6px 16px", color:"#555"}}>Services</td>
                    <td style={{padding:"6px 16px", textAlign:"right"}}>{formatMoney(serviceTotal)}</td>
                  </tr>
                )}
                {roundingValue !== 0 && (
                  <tr>
                    <td style={{padding:"6px 16px", color:"#555"}}>Arrondi</td>
                    <td style={{padding:"6px 16px", textAlign:"right"}}>{formatMoney(roundingValue)}</td>
                  </tr>
                )}
                <tr>
                  <td style={{padding:"6px 16px", color:"#888", fontSize:12}}>TVA 8.1% {isPrivateTTC ? "(incluse)" : ""}</td>
                  <td style={{padding:"6px 16px", textAlign:"right", color:"#888", fontSize:12}}>{formatMoney(tvaAmount)}</td>
                </tr>
                <tr style={{borderTop:`2px solid ${THEME}`}}>
                  <td style={{padding:"12px 16px", fontWeight:900, fontSize:16}}>TOTAL {isPrivateTTC ? "TTC" : "HT+TVA"}</td>
                  <td style={{padding:"12px 16px", textAlign:"right", fontWeight:900, fontSize:16}}>{formatMoney(finalTotal)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* INFOS LIVRAISON */}
        <div style={{background:"white", borderRadius:8, border:"1px solid #e0e0e0", padding:16, marginBottom:20}}>
          <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, flexWrap:"wrap"}}>
            <div>
              <div style={{fontSize:11, fontWeight:700, color:THEME, marginBottom:4}}>Adresse de livraison</div>
              <div style={{fontSize:13, lineHeight:1.7, color:"#333"}}>
                {offre.data.livrDiff ? (
                  <>
                    {offre.data.livrSociete && <div>{offre.data.livrSociete}</div>}
                    <div><strong>{offre.data.livrNom} {offre.data.livrPrenom}</strong></div>
                    <div>{offre.data.livrRue} {offre.data.livrNumero}</div>
                    <div>{offre.data.livrNpa} {offre.data.livrVille}</div>
                  </>
                ) : offre.data.deliveryMode === "À l'emporter" ? (
                  <div><em>À l'emporter — Jardin-Confort SA, Route de Lavaux 425, 1095 Lutry</em></div>
                ) : (
                  <>
                    {offre.data.societe && <div>{offre.data.societe}</div>}
                    <div><strong>{offre.client_nom} {offre.client_prenom}</strong></div>
                    <div>{offre.data.rue} {offre.data.numero}</div>
                    <div>{offre.client_npa} {offre.client_ville}</div>
                  </>
                )}
              </div>
            </div>
            <div>
              <div style={{fontSize:11, fontWeight:700, color:THEME, marginBottom:4}}>Conditions</div>
              <div style={{fontSize:13, lineHeight:1.7, color:"#333"}}>
                <div>💳 {offre.data.paymentMode}</div>
                <div>🚚 {offre.data.deliveryMode || "Livraison à domicile"}</div>
                {offre.data.leadTime && <div>⏱ Délai estimé : {offre.data.leadTime}</div>}
              </div>
            </div>
          </div>
        </div>

        {/* STOCK MIS À JOUR */}
        {offre.stockRefreshedAt && (
          <div style={{textAlign:"center", fontSize:11, color:"#aaa", marginBottom:20}}>
            Stock mis à jour le {new Date(offre.stockRefreshedAt).toLocaleString("fr-CH")}
          </div>
        )}

        {/* FOOTER */}
        <div style={{borderTop:"1px solid #e0e0e0", paddingTop:16, textAlign:"center", color:"#888", fontSize:12, lineHeight:1.8, marginBottom:40}}>
          <div><strong style={{color:"#333"}}>Jardin-Confort SA</strong></div>
          <div>Route de Lavaux 425 · 1095 Lutry · +41 21 791 36 71</div>
          <div>contact@jardinconfort.ch · <a href="https://www.jardin-confort.ch" style={{color:THEME}}>www.jardin-confort.ch</a></div>
          <div style={{marginTop:4}}>TVA CHE-100.142.327</div>
          <div style={{marginTop:8, fontSize:10, color:"#bbb"}}>
            En validant cette offre, vous confirmez avoir pris connaissance et accepté{" "}
            <a href="https://www.jardin-confort.ch/pages/conditions-generales" style={{color:"#bbb"}}>
              nos conditions générales
            </a>.
          </div>
        </div>

      </main>
    </>
  );
}