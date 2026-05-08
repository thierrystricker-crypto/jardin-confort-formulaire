"use client";
// ═══════════════════════════════════════════════════════════════
//  app/print/bulletin-livraison/[slug]/page.tsx
//  Template d'impression — BULLETIN DE LIVRAISON (sans prix)
//  Basé sur le template Commande, mais sans prix/totaux/TVA
//  Uniquement pour les commandes internes (CMD-XXXXX)
// ═══════════════════════════════════════════════════════════════

import React, { useEffect, useState } from "react";
import {
  PrintData, QuoteLine, AmbianceImage,
  serviceOptions, formatDate,
} from "@/lib/jc-print-types";

const THEME  = "#2b8ad1";
const BLACK  = "#000000";
const GREY   = "#333333";
const LIGHT  = "#f9f9f9";

const EMPTY: PrintData = {
  formType: "Commande", clientType: "Privé (prix TTC)",
  paymentMode: "Paiement d'avance à la commande", offerStatus: "En cours",
  date: "", commercial: "", offerNumber: "", reference: "",
  societe: "", nom: "", prenom: "", rue: "", numero: "", npa: "", ville: "",
  telephone1: "", telephone2: "", email: "", customerNumber: "",
  livrDiff: false, livrSociete: "", livrNom: "", livrPrenom: "",
  livrTel: "", livrRue: "", livrNumero: "", livrNpa: "", livrVille: "",
  lines: [], discount: "0", discountPercent: "0", manualRounding: "",
  enabledServices: {}, servicePrices: {}, remarks: "", leadTime: "",
  ambianceImages: [],
  deliveryMode: "Livraison à domicile",
} as any;

export default function PrintBulletinLivraisonSlug({ params }: { params: Promise<{ slug: string }> }) {
  const [data, setData] = useState<PrintData>(EMPTY);
  const [ready, setReady] = useState(false);
  const [numeroAffiche, setNumeroAffiche] = useState("");

  useEffect(() => {
    async function load() {
      const { slug } = await params;
      try {
        const res = await fetch(`/api/offres/${slug}?snapshot=false`);
        if (res.ok) {
          const json = await res.json();
          const offreData = json.offre?.data;
          if (offreData) {
            setNumeroAffiche(json.offre?.numero_affiche || offreData.offerNumber || slug);
            setData({
              ...EMPTY,
              ...offreData,
              customerNumber: json.offre?.numero_client || "",
              ambianceImages: offreData.ambianceImages || [],
            });
          }
        }
      } catch (e) {
        console.error("Erreur chargement commande:", e);
      }
      setReady(true);
    }
    load();
  }, [params]);

  if (!ready) return <div style={{padding:40, textAlign:"center", color:GREY}}>Chargement…</div>;

  // Services actifs (pour affichage sans prix)
  const activeServices = [
    ...serviceOptions
      .filter((s) => data.enabledServices[s.code])
      .map((s) => ({ label: s.label })),
    ...(data.enabledServices["custom"]
      ? [{ label: data.servicePrices["custom_label"] || "Service personnalisé" }]
      : []),
  ];

  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link href="https://fonts.googleapis.com/css2?family=Raleway:wght@300;400;700;900&display=swap" rel="stylesheet" />
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          font-family: 'Raleway', 'Helvetica Neue', Arial, sans-serif;
          font-size: 13px; line-height: 1.5; color: ${GREY};
          background: white;
          print-color-adjust: exact;
          -webkit-print-color-adjust: exact;
        }
        @page { size: A4 portrait; margin: 14mm 16mm 14mm 14mm; }
        @media screen {
          .doc-wrap { max-width: 794px; margin: 0 auto; padding: 20px 28px; box-shadow: 0 0 20px rgba(0,0,0,0.08); }
          .print-btn { position: fixed; top: 16px; right: 16px; z-index: 100; background: ${THEME}; color: white; border: 0; padding: 10px 20px; border-radius: 6px; font-size: 14px; font-weight: 700; cursor: pointer; }
        }
        @media print { .print-btn { display: none !important; } }

        .doc-header { display: flex; justify-content: space-between; gap: 20px; margin-bottom: 6mm; width: 100%; }
        .doc-header-left { flex: 0 0 46%; }
        .doc-header-right { flex: 0 0 50%; }
        .doc-logo { max-width: 175px; max-height: 65px; object-fit: contain; display: block; margin-bottom: 10px; }
        .doc-type { font-size: 26px; font-weight: 400; color: ${THEME}; margin-bottom: 8px; line-height: 1.1; }
        .doc-meta-table { border-collapse: collapse; width: 100%; }
        .doc-meta-table td { padding: 1px 6px 1px 0; vertical-align: top; font-size: 12px; line-height: 1.35; }
        .doc-meta-label { font-weight: 700; color: ${BLACK}; white-space: nowrap; width: 44%; }
        .doc-addr-window { padding: 10px 14px 10px 20px; min-height: 58mm; background: white; }
        .doc-addr-ref { font-size: 12px; color: #666; font-weight: 400; margin-bottom: 8px; }
        .doc-addr-name { font-size: 19px; font-weight: 700; color: ${BLACK}; line-height: 1.3; margin-bottom: 4px; }
        .doc-addr-line { font-size: 19px; color: ${BLACK}; line-height: 1.3; font-weight: 400; }
        .doc-hr { border: 0; border-top: 2px solid ${THEME}; margin: 4mm 0; width: 100%; }
        .doc-addresses { display: table; width: 100%; margin-bottom: 6mm; border-collapse: collapse; }
        .doc-addr-row { display: table-row; }
        .doc-addr-group { display: table-cell; width: 50%; vertical-align: top; padding-right: 10px; }
        .doc-addr-inner { display: flex; gap: 0; }
        .doc-addr-title { font-size: 12px; font-weight: 700; color: ${THEME}; white-space: nowrap; padding-right: 12px; padding-top: 1px; min-width: 110px; flex-shrink: 0; display: block; }
        .doc-addr-content { font-size: 12px; line-height: 1.6; color: ${BLACK}; flex: 1; }
        .doc-table { width: 100%; border-collapse: collapse; margin-bottom: 6mm; }
        .doc-table thead th { padding: 7px 4px; border-top: 2px solid ${THEME}; border-bottom: 2px solid ${THEME}; font-weight: 700; font-size: 12px; color: ${BLACK}; }
        .doc-table thead th.th-left { text-align: left; }
        .doc-table thead th.th-center { text-align: center; }
        .doc-table tbody tr td { padding: 8px 4px; border-bottom: 1px solid #efefef; vertical-align: top; font-size: 12px; }
        .doc-table tbody tr:nth-child(odd) td { background: ${LIGHT}; }
        .td-img { width: 56px; vertical-align: middle; text-align: center; }
        .td-img img { max-width: 52px; max-height: 52px; object-fit: contain; }
        .td-desc { padding-left: 8px !important; }
        .td-center { text-align: center; vertical-align: middle; white-space: nowrap; font-weight: 700; color: ${BLACK}; font-size: 14px; }
        .item-title { font-weight: 700; color: ${BLACK}; line-height: 1.35; }
        .item-sku { font-size: 11px; color: #777; margin-top: 2px; font-weight: 400; }
        .tr-comment td { background: #eef4fb !important; }
        .td-comment { padding: 6px 10px !important; font-style: italic; color: #445 !important; font-size: 12px; }

        .tr-media td {
          background: white !important;
          padding: 14px 4px !important;
          text-align: center !important;
          border-bottom: 1px solid #efefef;
        }
        .tr-media img { width: auto; object-fit: contain; display: inline-block; vertical-align: middle; }
        .media-small  { height: 30px !important; max-height: 30px !important; }
        .media-medium { height: 50px !important; max-height: 50px !important; }
        .media-large  { height: 80px !important; max-height: 80px !important; }
        .doc-services-box { margin-bottom: 6mm; padding: 12px 16px; background: #f0f7ff; border-left: 3px solid ${THEME}; border-radius: 4px; }
        .doc-services-title { font-size: 12px; font-weight: 700; color: ${BLACK}; margin-bottom: 6px; }
        .doc-services-list { font-size: 12px; color: ${GREY}; line-height: 1.7; }
        .doc-notes-block { margin-bottom: 6mm; }
        .doc-notes-title { font-weight: 700; color: ${BLACK}; margin-bottom: 5px; font-size: 12px; }
        .doc-notes-text { font-size: 12px; color: ${GREY}; line-height: 1.55; white-space: pre-wrap; }
        .doc-thanks-block { text-align: center; margin: 8mm 0 4mm; padding: 14px 20px; background: #f0faf2; border: 1px solid #a7d9b0; border-radius: 8px; }
        .doc-thanks-title { font-size: 14px; font-weight: 700; color: ${THEME}; margin-bottom: 6px; }
        .doc-thanks-text { font-size: 11px; color: ${GREY}; line-height: 1.6; }
        .doc-footer { border-top: 1px solid #ddd; padding-top: 6px; text-align: center; font-size: 11px; color: #666; line-height: 1.7; margin-top: 6mm; }
        .doc-footer strong { color: ${BLACK}; }
        .doc-footer-url { font-weight: 700; color: ${THEME}; }
        .doc-footer-social { margin-top: 5px; text-align: center; display: block; width: 100%; }
        .doc-footer-social img { width: 18px; height: 18px; margin: 0 4px; vertical-align: middle; display: inline-block; }
      `}</style>

      <button className="print-btn" onClick={() => window.print()}>🖨 Imprimer</button>

      <div className="doc-wrap">

        {/* HEADER */}
        <div className="doc-header">
          <div className="doc-header-left">
            <img className="doc-logo"
              src="https://cdn.shopify.com/s/files/1/0360/3251/2135/files/logo_JARDIN_CONFORT_shopify.jpg?v=1614107698"
              alt="Jardin-Confort" />
            <div className="doc-type">Bulletin de livraison</div>
            <table className="doc-meta-table">
              <tbody>
                <tr>
                  <td className="doc-meta-label">N° de commande</td>
                  <td>{numeroAffiche || data.offerNumber}</td>
                </tr>
                {data.reference && (
                  <tr><td className="doc-meta-label">Référence</td><td>{data.reference}</td></tr>
                )}
                <tr><td className="doc-meta-label">Date</td><td>{formatDate(data.date)}</td></tr>
                <tr><td className="doc-meta-label">Commercial</td><td>{data.commercial}</td></tr>
                {data.leadTime && (
                  <tr><td className="doc-meta-label">Délai de livraison</td><td>{data.leadTime}</td></tr>
                )}
                {(data as any).deliveryMode && (
                  <tr><td className="doc-meta-label">Mode de livraison</td><td>{(data as any).deliveryMode}</td></tr>
                )}
                {data.email && (
                  <tr><td className="doc-meta-label">E-mail</td><td>{data.email}</td></tr>
                )}
                {data.customerNumber && (
                  <tr><td className="doc-meta-label">N° client</td><td>{data.customerNumber}</td></tr>
                )}
                {(data as any).accesLivraison && (data as any).deliveryMode !== "À l'emporter" && (
                  <tr><td className="doc-meta-label">Accès livraison</td><td style={{fontStyle:"italic"}}>{(data as any).accesLivraison}</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="doc-header-right">
            <div className="doc-addr-window">
              <div className="doc-addr-ref">{numeroAffiche || data.offerNumber}</div>
              {/* Bloc adresse de livraison (priorité sur facturation) */}
              {(data as any).deliveryMode === "À l'emporter" ? (
                <>
                  {data.societe && <div className="doc-addr-line">{data.societe}</div>}
                  <div className="doc-addr-name">{data.nom} {data.prenom}</div>
                  <div style={{
                    marginTop: 8,
                    background: "#FFF8E1",
                    border: "1.5px solid #f59e0b",
                    borderRadius: 6,
                    padding: "8px 12px",
                    fontWeight: 700,
                    fontSize: 14,
                    color: "#7B5E00",
                  }}>
                    📦 RETRAIT EN MAGASIN
                  </div>
                </>
              ) : data.livrDiff ? (
                <>
                  {data.livrSociete && <div className="doc-addr-line">{data.livrSociete}</div>}
                  <div className="doc-addr-name">{data.livrNom} {data.livrPrenom}</div>
                  {data.livrRue && <div className="doc-addr-line">{data.livrRue} {data.livrNumero}</div>}
                  {data.livrNpa && <div className="doc-addr-line">{data.livrNpa} {data.livrVille}</div>}
                  {data.livrTel && <div className="doc-addr-line" style={{marginTop:8, fontSize:16}}>Tél. {data.livrTel}</div>}
                </>
              ) : (
                <>
                  {data.societe && <div className="doc-addr-line">{data.societe}</div>}
                  <div className="doc-addr-name">{data.nom} {data.prenom}</div>
                  {data.rue && <div className="doc-addr-line">{data.rue} {data.numero}</div>}
                  {data.npa && <div className="doc-addr-line">{data.npa} {data.ville}</div>}
                  {data.telephone1 && <div className="doc-addr-line" style={{marginTop:8, fontSize:16}}>Tél. {data.telephone1}</div>}
                </>
              )}
            </div>
          </div>
        </div>

        <hr className="doc-hr" />

        {/* ADRESSES */}
        <div className="doc-addresses">
          <div className="doc-addr-row">
            <div className="doc-addr-group">
              <div className="doc-addr-inner">
                <span className="doc-addr-title">Adresse de facturation</span>
                <div className="doc-addr-content">
                  {data.societe && <div>{data.societe}</div>}
                  <div style={{fontWeight:700}}>{data.nom} {data.prenom}</div>
                  {data.rue && <div>{data.rue} {data.numero}</div>}
                  {data.npa && <div>{data.npa} {data.ville}</div>}
                  {data.telephone1 && <div>Tél. {data.telephone1}</div>}
                  {data.telephone2 && <div>Tél. {data.telephone2}</div>}
                  {data.email && <div>{data.email}</div>}
                </div>
              </div>
            </div>
            <div className="doc-addr-group">
              <div className="doc-addr-inner">
                <span className="doc-addr-title">Adresse de livraison</span>
                <div className="doc-addr-content">
                  {(data as any).deliveryMode === "À l'emporter" ? (
                    <div style={{
                      background: "#FFF8E1",
                      border: "1.5px solid #f59e0b",
                      borderRadius: 6,
                      padding: "8px 12px",
                      fontWeight: 700,
                      color: "#7B5E00",
                    }}>
                      📦 RETRAIT EN MAGASIN — À l&apos;emporter
                      <div style={{fontWeight: 400, fontSize: 11, marginTop: 4, color: "#666"}}>
                        Jardin-Confort SA<br/>
                        Route de Lavaux 425 · 1095 Lutry
                      </div>
                    </div>
                  ) : data.livrDiff ? (
                    <>
                      {data.livrSociete && <div>{data.livrSociete}</div>}
                      <div style={{fontWeight:700}}>{data.livrNom} {data.livrPrenom}</div>
                      {data.livrRue && <div>{data.livrRue} {data.livrNumero}</div>}
                      {data.livrNpa && <div>{data.livrNpa} {data.livrVille}</div>}
                      {data.livrTel && <div>Tél. {data.livrTel}</div>}
                    </>
                  ) : (
                    <>
                      {data.societe && <div>{data.societe}</div>}
                      <div style={{fontWeight:700}}>{data.nom} {data.prenom}</div>
                      {data.rue && <div>{data.rue} {data.numero}</div>}
                      {data.npa && <div>{data.npa} {data.ville}</div>}
                      {data.telephone1 && <div>Tél. {data.telephone1}</div>}
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* TABLEAU ARTICLES (sans prix) */}
        <table className="doc-table">
          <thead>
            <tr>
              <th style={{width:56}}></th>
              <th className="th-left">Description de l&apos;article</th>
              <th className="th-center" style={{width:80}}>Qté</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.length === 0 && (
              <tr><td colSpan={3} style={{textAlign:"center", padding:"20px", color:"#aaa", fontStyle:"italic"}}>Aucun article</td></tr>
            )}
            {data.lines.map((line: QuoteLine) => {
              if (line.type === "comment") {
                return (
                  <tr key={line.id} className="tr-comment">
                    <td colSpan={3} className="td-comment">{line.title}</td>
                  </tr>
                );
              }
              if (line.type === "media") {
                if (!(line as any).mediaUrl) return null;
                const mSize = (line as any).mediaSize;
                const sizeClass = mSize === "small" ? "media-small" : mSize === "large" ? "media-large" : "media-medium";
                return (
                  <tr key={line.id} className="tr-media">
                    <td colSpan={3}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={(line as any).mediaUrl} alt={line.title || ""} className={sizeClass} />
                    </td>
                  </tr>
                );
              }
              return (
                <tr key={line.id}>
                  <td className="td-img">{line.image && <img src={line.image} alt="" />}</td>
                  <td className="td-desc">
                    <div className="item-title">{line.title}</div>
                    {line.sku && <div className="item-sku">{line.sku}</div>}
                  </td>
                  <td className="td-center">× {line.qty}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* SERVICES (sans prix) */}
        {activeServices.length > 0 && (
          <div className="doc-services-box">
            <div className="doc-services-title">Services inclus</div>
            <div className="doc-services-list">
              {activeServices.map((srv, i) => (
                <div key={i}>↳ {srv.label}</div>
              ))}
            </div>
          </div>
        )}

        {/* NOTES */}
        {data.remarks && (
          <div className="doc-notes-block">
            <div className="doc-notes-title">Notes</div>
            <div className="doc-notes-text">{data.remarks}</div>
          </div>
        )}

        {/* MESSAGE DE REMERCIEMENT */}
        <div className="doc-thanks-block">
          <div className="doc-thanks-title">Merci pour vos achats !</div>
          <div className="doc-thanks-text">
            Les éventuels articles non livrés de cette commande ont fait/font/feront partie d&apos;une livraison parallèle ou ultérieure.<br/>
            Si vous avez la moindre question, n&apos;hésitez pas à nous contacter.
          </div>
        </div>

        {/* PIED DE PAGE */}
        <div className="doc-footer">
          <div><strong>Jardin-Confort SA</strong></div>
          <div>Route de Lavaux 425 · 1095 Lutry · Suisse</div>
          <div>contact@jardinconfort.ch · +41 21 791 36 71</div>
          <div>TVA : CHE-100.142.327</div>
          <div className="doc-footer-url">www.jardin-confort.ch</div>
          <div className="doc-footer-social">
            <img src="https://cdn.shopify.com/s/files/1/0398/5025/files/Fb_icon.jpg?11755453313570768267" alt="Facebook" />
            <img src="https://cdn.shopify.com/s/files/1/0398/5025/files/instagram_9.png?576915513262272927" alt="Instagram" />
          </div>
        </div>

      </div>
    </>
  );
}