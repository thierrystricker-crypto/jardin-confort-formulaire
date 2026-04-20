"use client";
// ═══════════════════════════════════════════════════════════════
//  app/print/offre/page.tsx
//  Template d'impression — OFFRE
//  Style fidèle aux templates Order Printer Pro de Jardin-Confort
//  Lit les données depuis localStorage (clé jc-offre-v15-draft)
//  S'ouvre dans un nouvel onglet via window.open('/print/offre')
// ═══════════════════════════════════════════════════════════════

import React, { useEffect, useState } from "react";
import {
  PrintData, QuoteLine, AmbianceImage,
  serviceOptions, formatMoney, formatDate, generateCustomerNumber,
  computeTotals, STORAGE_KEY,
} from "@/lib/jc-print-types";

// ── Couleurs brand Jardin-Confort ──
const THEME  = "#2b8ad1";
const BLACK  = "#000000";
const GREY   = "#333333";
const LIGHT  = "#f9f9f9";

// ── Données vides par défaut ──
const EMPTY: PrintData = {
  formType: "Offre", clientType: "Privé (prix TTC)",
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

export default function PrintOffe() {
  const [data, setData] = useState<PrintData>(EMPTY);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const snap = JSON.parse(raw);
        setData({
          ...EMPTY,
          ...snap,
          customerNumber: generateCustomerNumber(snap.email || ""),
          ambianceImages: snap.ambianceImages || [],
        });
      } catch {
        console.error("Erreur lecture localStorage");
      }
    }
    setReady(true);
  }, []);

  if (!ready) return <div style={{padding:40, textAlign:"center", color:GREY}}>Chargement…</div>;
const isPreview = !data.offerNumber || data.offerNumber.trim() === ""
  const totals = computeTotals(data);
  const {
    isPrivateTTC, subTotal, discountValue, serviceTotal,
    roundingValue, tvaAmount, finalTotal, totalAfterDiscount,
  } = totals;

  // Services actifs avec prix
  const activeServices = [
    ...serviceOptions
      .filter((s) => data.enabledServices[s.code])
      .map((s) => ({ label: s.label, amount: Number(data.servicePrices[s.code]) })),
    ...(data.enabledServices["custom"] && Number(data.servicePrices["custom"] || 0) > 0
      ? [{ label: data.servicePrices["custom_label"] || "Service personnalisé", amount: Number(data.servicePrices["custom"]) }]
      : []),
  ];

  return (
    <>
      {/* Police Raleway via link — plus fiable que @import dans <style> */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link href="https://fonts.googleapis.com/css2?family=Raleway:wght@300;400;700;900&display=swap" rel="stylesheet" />
      <style>{`
        /* ═══════════════════════════════════════════
           STYLES TEMPLATE OFFRE — Jardin-Confort
           Police Raleway chargée via <link> dans le head
        ═══════════════════════════════════════════ */

        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          font-family: 'Raleway', 'Helvetica Neue', Arial, sans-serif;
          font-size: 13px; line-height: 1.5; color: ${GREY};
          background: white;
          print-color-adjust: exact;
          -webkit-print-color-adjust: exact;
        }

        /* Marges A4 généreuses pour éviter les coupures */
        @page { size: A4 portrait; margin: 14mm 16mm 14mm 14mm; }

        /* ── Screen preview ── */
        @media screen {
          .doc-wrap { max-width: 794px; margin: 0 auto; padding: 20px 28px; }
        }

        /* ── HEADER ── */
        .doc-header { display: flex; justify-content: space-between; gap: 20px; margin-bottom: 6mm; width: 100%; }
        .doc-header-left { flex: 0 0 46%; }
        .doc-header-right { flex: 0 0 50%; }

        .doc-logo { max-width: 175px; max-height: 65px; object-fit: contain; display: block; margin-bottom: 10px; }
        .doc-logo-small { max-width: 130px; max-height: 50px; }

        /* Titre "Offre" — pas en gras */
        .doc-type { font-size: 26px; font-weight: 400; color: ${THEME}; margin-bottom: 8px; line-height: 1.1; }

        /* Méta infos — interligne compact */
        .doc-meta-table { border-collapse: collapse; width: 100%; }
        .doc-meta-table td { padding: 1px 6px 1px 0; vertical-align: top; font-size: 12px; line-height: 1.35; }
        .doc-meta-label { font-weight: 700; color: ${BLACK}; white-space: nowrap; width: 44%; }

        /* Fenêtre adresse — sans bordure, décalée à droite */
        .doc-addr-window { padding: 10px 14px 10px 20px; min-height: 58mm; background: white; }
        .doc-addr-ref { font-size: 12px; color: #666; font-weight: 400; margin-bottom: 8px; }
        .doc-addr-name { font-size: 19px; font-weight: 700; color: ${BLACK}; line-height: 1.3; margin-bottom: 4px; }
        .doc-addr-line { font-size: 19px; color: ${BLACK}; line-height: 1.3; font-weight: 400; }

        /* ── SÉPARATEUR ── */
        .doc-hr { border: 0; border-top: 2px solid ${THEME}; margin: 4mm 0; width: 100%; }

        /* ── ADRESSES — style Shopify : titre col gauche, contenu col droite ── */
        .doc-addresses {
          display: table; width: 100%;
          margin-bottom: 6mm;
          border-collapse: collapse;
        }
        .doc-addr-row { display: table-row; }

        /* Chaque bloc = 2 colonnes : titre | contenu */
        .doc-addr-group {
          display: table-cell;
          width: 50%;
          vertical-align: top;
          padding-right: 10px;
        }
        .doc-addr-inner {
          display: flex;
          gap: 0;
        }
        .doc-addr-title {
          font-size: 12px;
          font-weight: 700;
          color: ${THEME};
          white-space: nowrap;
          padding-right: 12px;
          padding-top: 1px;
          min-width: 110px;
          flex-shrink: 0;
          display: block;
        }
        .doc-addr-content { font-size: 12px; line-height: 1.6; color: ${BLACK}; flex: 1; }

        /* ── TABLEAU ARTICLES ── */
        .doc-table { width: 100%; border-collapse: collapse; margin-bottom: 6mm; }
        .doc-table thead th { padding: 7px 4px; border-top: 2px solid ${THEME}; border-bottom: 2px solid ${THEME}; font-weight: 700; font-size: 12px; color: ${BLACK}; }
        .doc-table thead th.th-left { text-align: left; }
        .doc-table thead th.th-center { text-align: center; }
        .doc-table thead th.th-right { text-align: right; }
        .doc-table tbody tr td { padding: 8px 4px; border-bottom: 1px solid #efefef; vertical-align: top; font-size: 12px; }
        .doc-table tbody tr:nth-child(odd) td { background: ${LIGHT}; }

        .td-img { width: 56px; vertical-align: middle; text-align: center; }
        .td-img img { max-width: 52px; max-height: 52px; object-fit: contain; }
        .td-desc { padding-left: 8px !important; }
        .td-center { text-align: center; vertical-align: middle; white-space: nowrap; }
        .td-right { text-align: right; vertical-align: middle; white-space: nowrap; }
        .td-total { text-align: right; vertical-align: middle; white-space: nowrap; font-weight: 700; color: ${BLACK}; }

        .item-title { font-weight: 700; color: ${BLACK}; line-height: 1.35; }
        .item-sku { font-size: 11px; color: #777; margin-top: 2px; font-weight: 400; }
        .item-discount { font-size: 11px; color: #2a8a2a; margin-top: 3px; }

        /* Ligne commentaire */
        .tr-comment td { background: #eef4fb !important; }
        .td-comment { padding: 6px 10px !important; font-style: italic; color: #445 !important; font-size: 12px; }

        /* ── ZONE TOTAUX + SIGNATURE CLIENT ── */
        .doc-bottom-wrap {
          display: flex;
          gap: 20px;
          margin-bottom: 8mm;
          align-items: flex-end; /* aligner en bas = signature au niveau du total */
        }
        .doc-notes-sign-col {
          flex: 1;
          display: flex;
          flex-direction: column;
          justify-content: flex-end;
        }
        .doc-totals-col { flex: 0 0 44%; }

        .doc-notes-title { font-weight: 700; color: ${BLACK}; margin-bottom: 5px; font-size: 12px; }
        .doc-notes-text { font-size: 12px; color: ${GREY}; line-height: 1.55; white-space: pre-wrap; margin-bottom: 12px; }

        /* Signature client seulement */
        .doc-sign-block { margin-top: auto; }
        .doc-sign-name { font-weight: 600; color: ${BLACK}; font-size: 12px; margin-bottom: 28px; }
        .doc-sign-line { border-bottom: 1px solid #aaa; margin-bottom: 4px; }
        .doc-sign-sub { font-size: 10px; color: #aaa; }

        /* Pricing table */
        .doc-pricing { width: 100%; border-collapse: collapse; }
        .doc-pricing td { padding: 5px 4px; font-size: 12px; }
        .doc-pricing tr:nth-child(even) td { background: ${LIGHT}; }
        .doc-pricing .pt-label { font-weight: 600; color: ${BLACK}; }
        .doc-pricing .pt-sub { font-size: 11px; padding-left: 14px !important; color: #555; }
        .doc-pricing .pt-value { text-align: right; white-space: nowrap; color: ${BLACK}; }
        .doc-pricing .pt-tva td { color: #666; font-size: 11px; }
        .doc-pricing .pt-total td { border-top: 2px solid ${THEME} !important; border-bottom: 2px solid ${THEME} !important; padding: 8px 4px !important; }
        .pt-total-label { font-weight: 900 !important; font-size: 15px !important; color: ${BLACK} !important; }
        .pt-total-value { font-weight: 900 !important; font-size: 15px !important; color: ${BLACK} !important; text-align: right; white-space: nowrap; }

        /* ── REMERCIEMENTS ── */
        .doc-thanks { text-align: center; font-weight: 700; color: ${THEME}; margin: 6mm 0 3px; font-size: 13px; }
        .doc-terms { text-align: center; font-size: 10px; color: #888; line-height: 1.5; margin-bottom: 6mm; }
        .doc-terms a { color: ${THEME}; }

        /* ── PIED DE PAGE — centré ── */
        .doc-footer { border-top: 1px solid #ddd; padding-top: 6px; text-align: center; font-size: 11px; color: #666; line-height: 1.7; }
        .doc-footer strong { color: ${BLACK}; }
        .doc-footer-url { font-weight: 700; color: ${THEME}; }
        .doc-footer-social { margin-top: 5px; text-align: center; display: block; width: 100%; }
        .doc-footer-social img { width: 18px; height: 18px; margin: 0 4px; vertical-align: middle; display: inline-block; }

        /* ── PAGE 2 — IMAGES D'AMBIANCE ── */
        .doc-page2 { page-break-before: always; break-before: page; padding-top: 4mm; }
        .doc-page2-header { display: flex; align-items: flex-end; gap: 16px; margin-bottom: 5mm; border-bottom: 2px solid ${THEME}; padding-bottom: 4mm; }
        .doc-page2-titles { flex: 1; }
        .doc-page2-type { font-size: 18px; font-weight: 700; color: ${THEME}; }
        .doc-page2-sub { font-size: 11px; color: #aaa; font-style: italic; margin-top: 2px; }
        .doc-ambiance-grid { display: flex; flex-wrap: wrap; gap: 14px; margin-bottom: 8mm; }
        .doc-ambiance-item { flex: 0 0 calc(50% - 7px); page-break-inside: avoid; break-inside: avoid; text-align: center; }
        .doc-ambiance-item img { max-width: 100%; max-height: 200px; object-fit: contain; display: block; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 4px; }
        .doc-ambiance-caption { font-size: 10px; color: #777; font-style: italic; margin-top: 5px; text-align: center; }

        /* ── Bouton print (écran seulement) ── */
        @media screen {
          .doc-wrap { box-shadow: 0 0 20px rgba(0,0,0,0.08); }
          .print-btn { position: fixed; top: 16px; right: 16px; z-index: 100; background: ${THEME}; color: white; border: 0; padding: 10px 20px; border-radius: 6px; font-size: 14px; font-weight: 700; cursor: pointer; }
        }
        @media print { .print-btn { display: none !important; } }
      `}</style>

      {isPreview && (
        <div style={{
          position:"fixed", top:0, left:0, right:0, bottom:0,
          display:"flex", alignItems:"center", justifyContent:"center",
          pointerEvents:"none", zIndex:50, transform:"rotate(-35deg)",
        }}>
          <div style={{
            fontSize:80, fontWeight:900, color:"rgba(220,38,38,0.12)",
            letterSpacing:"0.05em", whiteSpace:"nowrap", userSelect:"none",
          }}>PRINT PREVIEW ONLY</div>
        </div>
      )}
      {!isPreview && (
        {isPreview && (
        <div style={{
          position:"fixed", top:0, left:0, right:0, bottom:0,
          display:"flex", alignItems:"center", justifyContent:"center",
          pointerEvents:"none", zIndex:50, transform:"rotate(-35deg)",
        }}>
          <div style={{
            fontSize:80, fontWeight:900, color:"rgba(220,38,38,0.12)",
            letterSpacing:"0.05em", whiteSpace:"nowrap", userSelect:"none",
          }}>PRINT PREVIEW ONLY</div>
        </div>
      )}
      {!isPreview && (
        <button className="print-btn" onClick={() => window.print()}>🖨 Imprimer</button>
      )}
      )}

      <div className="doc-wrap">

        {/* ═══════════ PAGE 1 ═══════════ */}

        {/* HEADER */}
        <div className="doc-header">
          <div className="doc-header-left">
            <img
              className="doc-logo"
              src="https://cdn.shopify.com/s/files/1/0360/3251/2135/files/logo_JARDIN_CONFORT_shopify.jpg?v=1614107698"
              alt="Jardin-Confort"
            />
            <div className="doc-type">{data.formType}</div>
            <table className="doc-meta-table">
              <tbody>
                <tr>
                  <td className="doc-meta-label">N° {data.formType === "Offre" ? "d'offre" : "de commande"}</td>
                  <td>{data.offerNumber}</td>
                </tr>
                {data.reference && (
                  <tr><td className="doc-meta-label">Référence</td><td>{data.reference}</td></tr>
                )}
                <tr>
                  <td className="doc-meta-label">Date</td>
                  <td>{formatDate(data.date)}</td>
                </tr>
                <tr>
                  <td className="doc-meta-label">Commercial</td>
                  <td>{data.commercial}</td>
                </tr>
                <tr>
                  <td className="doc-meta-label">Mode de paiement</td>
                  <td>{data.paymentMode}</td>
                </tr>
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
              </tbody>
            </table>
          </div>

          {/* Fenêtre adresse destinataire */}
          <div className="doc-header-right">
            <div className="doc-addr-window">
              <div className="doc-addr-ref">{data.offerNumber}</div>
              {data.societe && <div className="doc-addr-line">{data.societe}</div>}
              <div className="doc-addr-name">{data.nom} {data.prenom}</div>
              {data.rue && <div className="doc-addr-line">{data.rue} {data.numero}</div>}
              {data.npa && <div className="doc-addr-line">{data.npa} {data.ville}</div>}
              {data.telephone1 && <div className="doc-addr-line" style={{marginTop:8, fontSize:16}}>Tél. {data.telephone1}</div>}
            </div>
          </div>
        </div>

        <hr className="doc-hr" />

        {/* ADRESSES — style Shopify : titre col gauche + contenu col droite, 4 colonnes */}
        <div className="doc-addresses">
          <div className="doc-addr-row">
            {/* Bloc facturation */}
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

            {/* Bloc livraison */}
            <div className="doc-addr-group">
              <div className="doc-addr-inner">
                <span className="doc-addr-title">Adresse de livraison</span>
                <div className="doc-addr-content">
                  {(data as any).deliveryMode === "À l'emporter" ? (
                    <div style={{fontStyle:"italic"}}>
                      À l'emporter<br/>
                      Jardin-Confort SA<br/>
                      Route de Lavaux 425 · 1095 Lutry
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

        {/* TABLEAU ARTICLES */}
        <table className="doc-table">
          <thead>
            <tr>
              <th style={{width:56}}></th>
              <th className="th-left">Description de l'article</th>
              <th className="th-center" style={{width:62}}>Qté</th>
              <th className="th-right" style={{width:90}}>Prix/pce</th>
              <th className="th-right" style={{width:100}}>Total</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.length === 0 && (
              <tr><td colSpan={5} style={{textAlign:"center", padding:"20px", color:"#aaa", fontStyle:"italic"}}>Aucun article</td></tr>
            )}
            {data.lines.map((line: QuoteLine) => {
              if (line.type === "comment") {
                return (
                  <tr key={line.id} className="tr-comment">
                    <td colSpan={5} className="td-comment">{line.title}</td>
                  </tr>
                );
              }
              const lineTotal = line.qty * line.unitPrice - (line.lineDiscount || 0);
              return (
                <tr key={line.id}>
                  <td className="td-img">
                    {line.image && <img src={line.image} alt="" />}
                  </td>
                  <td className="td-desc">
                    <div className="item-title">{line.title}</div>
                    {line.sku && <div className="item-sku">{line.sku}</div>}
                    {(line.lineDiscount || 0) > 0 && (
                      <div className="item-discount">Remise : − {formatMoney(line.lineDiscount || 0)}</div>
                    )}
                  </td>
                  <td className="td-center">× {line.qty}</td>
                  <td className="td-right">{formatMoney(line.unitPrice)}</td>
                  <td className="td-total">{formatMoney(lineTotal)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* NOTES + TOTAUX + SIGNATURE CLIENT */}
        <div className="doc-bottom-wrap">

          {/* Colonne gauche : Notes + Signature client */}
          <div className="doc-notes-sign-col">
            {data.remarks && (
              <>
                <div className="doc-notes-title">Notes</div>
                <div className="doc-notes-text">{data.remarks}</div>
              </>
            )}
            {/* Signature client — alignée au bas = niveau du total */}
            <div className="doc-sign-block">
              <div className="doc-sign-name">Client — {data.nom} {data.prenom}</div>
              <div className="doc-sign-line" />
              <div className="doc-sign-sub">Signature &amp; date</div>
            </div>
          </div>

          {/* Colonne droite : Tableau totaux */}
          <div className="doc-totals-col">
            <table className="doc-pricing">
              <tbody>
                <tr>
                  <td className="pt-label">Sous-total articles</td>
                  <td className="pt-value">{formatMoney(subTotal)}</td>
                </tr>
                {discountValue > 0 && (
                  <tr>
                    <td className="pt-label">Remise</td>
                    <td className="pt-value" style={{color:"#2a8a2a"}}>− {formatMoney(discountValue)}</td>
                  </tr>
                )}
                {discountValue > 0 && (
                  <tr>
                    <td className="pt-label">Après remise</td>
                    <td className="pt-value">{formatMoney(subTotal - discountValue)}</td>
                  </tr>
                )}
                {activeServices.length > 0 && (
                  <>
                    <tr><td className="pt-label">Services</td><td className="pt-value">{serviceTotal > 0 ? formatMoney(serviceTotal) : "Offert"}</td></tr>
                    {activeServices.map((srv, i) => (
                      <tr key={i}>
                        <td className="pt-label pt-sub">↳ {srv.label}</td>
                        <td className="pt-value" style={{fontSize:11}}>{srv.amount === 0 ? "Offert" : formatMoney(srv.amount)}</td>
                      </tr>
                    ))}
                  </>
                )}
                {roundingValue !== 0 && (
                  <tr>
                    <td className="pt-label">Arrondi</td>
                    <td className="pt-value">{formatMoney(roundingValue)}</td>
                  </tr>
                )}
                {isPrivateTTC ? (
                  <tr className="pt-tva">
                    <td className="pt-label">TVA 8.1% (incluse)</td>
                    <td className="pt-value">{formatMoney(tvaAmount)}</td>
                  </tr>
                ) : (
                  <>
                    <tr>
                      <td className="pt-label">Total HT</td>
                      <td className="pt-value">{formatMoney(totals.totalAfterRounding)}</td>
                    </tr>
                    <tr className="pt-tva">
                      <td className="pt-label">+ TVA 8.1%</td>
                      <td className="pt-value">{formatMoney(tvaAmount)}</td>
                    </tr>
                  </>
                )}
                <tr className="pt-total">
                  <td className="pt-total-label">TOTAL {isPrivateTTC ? "TTC" : "HT + TVA"}</td>
                  <td className="pt-total-value">{formatMoney(finalTotal)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* REMERCIEMENTS */}
        <p className="doc-thanks">
          Nous nous réjouissons de pouvoir traiter votre commande. Merci d'avance pour votre confiance !
        </p>
        <p className="doc-terms">
          En validant cette offre et/ou en passant une commande, vous confirmez avoir pris connaissance et accepté{" "}
          <a href="https://www.jardin-confort.ch/pages/conditions-generales">nos conditions générales</a>.
          Les quantités, articles et frais mentionnés peuvent différer de la version finale validée.
          Seule la confirmation de commande fait foi.
        </p>

        {/* PIED DE PAGE */}
        <div className="doc-footer">
          <div><strong>Jardin-Confort SA</strong></div>
          <div>Route de Lavaux 425 · 1095 Lutry · Suisse</div>
          <div>contact@jardinconfort.ch · +41 21 791 36 71</div>
          <div>TVA : CHE-100.142.327</div>
          <div>Banque Cantonale Vaudoise · IBAN CH72 0076 7000 K033 3796 5 · SWIFT BCVLCH2LXXX</div>
          <div className="doc-footer-url">www.jardin-confort.ch</div>
          <div className="doc-footer-social">
            <img src="https://cdn.shopify.com/s/files/1/0398/5025/files/Fb_icon.jpg?11755453313570768267" alt="Facebook" />
            <img src="https://cdn.shopify.com/s/files/1/0398/5025/files/instagram_9.png?576915513262272927" alt="Instagram" />
          </div>
        </div>

        {/* ═══════════ PAGE 2 — IMAGES D'AMBIANCE ═══════════ */}
        {data.ambianceImages.length > 0 && (
          <div className="doc-page2">
            <div className="doc-page2-header">
              <img
                className="doc-logo"
                style={{maxWidth:130, maxHeight:50}}
                src="https://cdn.shopify.com/s/files/1/0360/3251/2135/files/logo_JARDIN_CONFORT_shopify.jpg?v=1614107698"
                alt="Jardin-Confort"
              />
              <div className="doc-page2-titles">
                <div className="doc-page2-type">
                  Images d'illustration — {data.offerNumber}
                </div>
                <div className="doc-page2-sub">
                  Images non contractuelles · {data.nom} {data.prenom} · {formatDate(data.date)}
                </div>
              </div>
            </div>

            <div className="doc-ambiance-grid">
              {data.ambianceImages.map((img: AmbianceImage) => (
                <div key={img.id} className="doc-ambiance-item">
                  <img src={img.dataUrl} alt={img.legende || "Illustration"} />
                  {img.legende && <div className="doc-ambiance-caption">{img.legende}</div>}
                </div>
              ))}
            </div>

            <div className="doc-footer">
              <div><strong>Jardin-Confort SA</strong> · Route de Lavaux 425 · 1095 Lutry · contact@jardinconfort.ch · +41 21 791 36 71</div>
              <div className="doc-footer-url">www.jardin-confort.ch</div>
            </div>
          </div>
        )}

      </div>{/* end doc-wrap */}
    </>
  );
}