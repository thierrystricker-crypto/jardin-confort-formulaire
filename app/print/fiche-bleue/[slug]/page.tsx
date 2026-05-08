"use client";
// ═══════════════════════════════════════════════════════════════
//  app/print/fiche-bleue/[slug]/page.tsx
//  Template d'impression — FICHE BLEUE (archive classeur papier)
//
//  Format : 1 seule page A4
//  Style : dégradé bleu papier carbone vintage
//  - Bordures bleu moyen (économie d'encre vs fond uni)
//  - Centre clair pour lisibilité maximale
//  - Toutes les infos de la commande condensées
//
//  Génère via /print/fiche-bleue/{slug}
// ═══════════════════════════════════════════════════════════════

import React, { useEffect, useState } from "react";
import {
  PrintData, QuoteLine,
  serviceOptions, formatMoney, formatDate,
  computeTotals,
} from "@/lib/jc-print-types";

const BLUE_STRONG = "#4a7ba7";
const BLUE_MID    = "#a8c5e0";
const BLUE_LIGHT  = "#e8f0f8";
const BLACK       = "#000000";
const GREY        = "#222222";

const EMPTY: PrintData = {
  formType: "Commande", clientType: "Privé (prix TTC)",
  paymentMode: "", offerStatus: "En cours",
  date: "", commercial: "", offerNumber: "", reference: "",
  societe: "", nom: "", prenom: "", rue: "", numero: "", npa: "", ville: "",
  telephone1: "", telephone2: "", email: "", customerNumber: "",
  livrDiff: false, livrSociete: "", livrNom: "", livrPrenom: "",
  livrTel: "", livrRue: "", livrNumero: "", livrNpa: "", livrVille: "",
  lines: [], discount: "0", discountPercent: "0", manualRounding: "",
  enabledServices: {}, servicePrices: {}, remarks: "", leadTime: "",
  ambianceImages: [],
  deliveryMode: "Livraison à domicile",
// eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

export default function PrintFicheBleueSlug({ params }: { params: Promise<{ slug: string }> }) {
  const [data, setData] = useState<PrintData>(EMPTY);
  const [ready, setReady] = useState(false);
  const [numeroAffiche, setNumeroAffiche] = useState("");
  const [dateDocument, setDateDocument] = useState<string>("");
  const [typeDocument, setTypeDocument] = useState<string>("Commande");

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
            setDateDocument(json.offre?.date_document || offreData.date || "");
            setTypeDocument(json.offre?.type_document || offreData.formType || "Commande");
            setData({
              ...EMPTY,
              ...offreData,
              customerNumber: json.offre?.numero_client || "",
            });
          }
        }
      } catch (e) {
        console.error("Erreur chargement:", e);
      }
      setReady(true);
    }
    load();
  }, [params]);

  if (!ready) return <div style={{padding:40, textAlign:"center", color:GREY}}>Chargement…</div>;

  const totals = computeTotals(data);
  const { isPrivateTTC, subTotal, discountValue, serviceTotal, roundingValue, tvaAmount, finalTotal } = totals;

  const activeServices = [
    ...serviceOptions
      .filter((s) => data.enabledServices[s.code])
      .map((s) => ({ label: s.label, amount: Number(data.servicePrices[s.code] || 0) })),
    ...(data.enabledServices["custom"]
      ? [{ label: data.servicePrices["custom_label"] || "Service personnalisé", amount: Number(data.servicePrices["custom"] || 0) }]
      : []),
  ];

  const numeroLabel = typeDocument === "Offre" ? "N° offre" : "N° commande";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isPickup = (data as any).deliveryMode === "À l'emporter";
  const totalLines = data.lines.filter(l => l.type !== "comment" && l.type !== "media").length;
  const totalQty = data.lines.reduce((s, l) => (l.type === "comment" || l.type === "media") ? s : s + l.qty, 0);

  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link href="https://fonts.googleapis.com/css2?family=Raleway:wght@300;400;700;900&display=swap" rel="stylesheet" />
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          font-family: 'Raleway', 'Helvetica Neue', Arial, sans-serif;
          font-size: 10px; line-height: 1.35; color: ${BLACK};
          background: white;
          print-color-adjust: exact;
          -webkit-print-color-adjust: exact;
        }
        @page {
          size: A4 portrait;
          margin: 0;
        }

        @media screen {
          .fb-page {
            max-width: 794px; margin: 20px auto;
            box-shadow: 0 0 30px rgba(0,0,0,0.2);
          }
          .fb-print-btn {
            position: fixed; top: 16px; right: 16px; z-index: 100;
            background: ${BLUE_STRONG}; color: white; border: 0;
            padding: 10px 20px; border-radius: 6px;
            font-size: 14px; font-weight: 700; cursor: pointer;
            box-shadow: 0 2px 8px rgba(0,0,0,0.15);
          }
        }
        @media print {
          .fb-print-btn { display: none !important; }
          .fb-page { box-shadow: none; margin: 0; max-width: 100%; }
        }

        /* ═══ PAGE A4 — fond papier carbone bleu ═══ */
        .fb-page {
          width: 210mm; height: 297mm;
          position: relative;
          /* Dégradé radial : bleu fort sur les bords → bleu clair au centre */
          background:
            radial-gradient(ellipse at center,
              ${BLUE_LIGHT} 0%,
              ${BLUE_LIGHT} 35%,
              ${BLUE_MID} 75%,
              ${BLUE_STRONG} 100%);
          padding: 8mm 10mm;
          overflow: hidden;
        }

        /* Filigrane en arrière-plan (très léger) */
        .fb-watermark {
          position: absolute;
          top: 50%; left: 50%;
          transform: translate(-50%, -50%) rotate(-30deg);
          font-size: 90px; font-weight: 900;
          color: ${BLUE_STRONG};
          opacity: 0.06;
          letter-spacing: 0.1em;
          white-space: nowrap;
          pointer-events: none;
          z-index: 0;
        }

        /* Contenu au-dessus du filigrane */
        .fb-content {
          position: relative;
          z-index: 1;
          height: 100%;
          display: flex;
          flex-direction: column;
        }

        /* ═══ HEADER ═══ */
        .fb-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 10mm;
          margin-bottom: 4mm;
          padding-bottom: 3mm;
          border-bottom: 2px solid ${BLUE_STRONG};
        }
        .fb-header-left { flex: 0 0 auto; }
        .fb-header-right { flex: 1; text-align: right; }

        .fb-logo { max-height: 14mm; max-width: 50mm; object-fit: contain; }

        .fb-doc-title {
          font-size: 16px; font-weight: 900;
          color: ${BLUE_STRONG};
          letter-spacing: 0.05em;
          text-transform: uppercase;
          margin-top: 2mm;
        }
        .fb-doc-title-fb {
          display: inline-block;
          background: ${BLUE_STRONG};
          color: white;
          padding: 2px 10px;
          border-radius: 3px;
          font-size: 13px;
          font-weight: 900;
          letter-spacing: 0.08em;
          margin-left: 6px;
          vertical-align: middle;
        }
        .fb-doc-subtitle {
          font-size: 9px;
          color: ${GREY};
          font-style: italic;
          margin-top: 1mm;
          letter-spacing: 0.02em;
        }
        .fb-doc-num {
          font-size: 22px;
          font-weight: 900;
          color: ${BLACK};
          line-height: 1;
        }
        .fb-doc-date-big {
          font-size: 28px;
          font-weight: 900;
          color: ${BLUE_STRONG};
          line-height: 1;
          margin-top: 4mm;
          letter-spacing: 0.02em;
        }
        .fb-doc-date {
          font-size: 11px;
          color: ${GREY};
          margin-top: 1mm;
        }

        /* ═══ Coin "à couper" en bas à droite ═══ */
        .fb-cut-corner {
          position: absolute;
          bottom: 0;
          right: 0;
          width: 30mm;
          height: 30mm;
          z-index: 5;
          pointer-events: none;
        }
        .fb-cut-corner-bg {
          position: absolute;
          bottom: 0;
          right: 0;
          width: 0;
          height: 0;
          border-left: 30mm solid transparent;
          border-bottom: 30mm solid rgba(74, 123, 167, 0.35);
        }
        .fb-cut-corner-line {
          position: absolute;
          bottom: 30mm;
          right: 0;
          width: 42mm;
          height: 2px;
          background: repeating-linear-gradient(
            to right,
            ${BLUE_STRONG} 0,
            ${BLUE_STRONG} 3px,
            transparent 3px,
            transparent 6px
          );
          transform-origin: bottom right;
          transform: rotate(-45deg);
        }
        .fb-cut-corner-scissors {
          position: absolute;
          bottom: 17mm;
          right: 17mm;
          font-size: 14px;
          transform: rotate(-45deg);
          color: ${BLUE_STRONG};
          font-weight: 900;
        }
        .fb-cut-corner-label {
          position: absolute;
          bottom: 4mm;
          right: 4mm;
          font-size: 8px;
          color: ${BLUE_STRONG};
          font-style: italic;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          transform: rotate(-45deg);
          transform-origin: center;
        }

        /* ═══ INFO STRIP : 3 colonnes (client / livraison / paiement) ═══ */
        .fb-info-grid {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 4mm;
          margin-bottom: 3mm;
        }
        .fb-info-block {
          background: rgba(255,255,255,0.75);
          border: 1px solid ${BLUE_MID};
          border-radius: 4px;
          padding: 5px 8px;
        }
        .fb-info-title {
          font-size: 8px;
          font-weight: 700;
          color: ${BLUE_STRONG};
          text-transform: uppercase;
          letter-spacing: 0.06em;
          margin-bottom: 3px;
          padding-bottom: 2px;
          border-bottom: 1px solid ${BLUE_MID};
        }
        .fb-info-content {
          font-size: 10px;
          line-height: 1.4;
          color: ${BLACK};
        }
        .fb-info-content strong { color: ${BLACK}; font-weight: 700; }
        .fb-info-content .fb-info-name { font-size: 11px; font-weight: 700; }
        .fb-pickup-tag {
          display: inline-block;
          background: #f59e0b;
          color: white;
          padding: 1px 6px;
          border-radius: 3px;
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }

        /* ═══ TABLEAU ARTICLES ═══ */
        .fb-table-wrap {
          background: rgba(255,255,255,0.85);
          border: 1px solid ${BLUE_MID};
          border-radius: 4px;
          margin-bottom: 3mm;
          overflow: hidden;
          flex: 1;
          min-height: 0;
        }
        .fb-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 9.5px;
        }
        .fb-table thead th {
          background: ${BLUE_STRONG};
          color: white;
          padding: 4px 5px;
          font-weight: 700;
          font-size: 9px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          text-align: left;
        }
        .fb-table thead th.th-c { text-align: center; }
        .fb-table thead th.th-r { text-align: right; }
        .fb-table tbody tr td {
          padding: 3px 5px;
          border-bottom: 1px solid #e0e8f0;
          vertical-align: top;
          font-size: 9.5px;
        }
        .fb-table tbody tr:nth-child(even) td {
          background: rgba(232, 240, 248, 0.5);
        }
        .fb-td-img { width: 38px; text-align: center; vertical-align: middle; }
        .fb-td-img img {
          max-width: 32px;
          max-height: 32px;
          object-fit: contain;
          display: block;
          margin: 0 auto;
        }
        .fb-td-qty { width: 32px; text-align: center; font-weight: 700; font-size: 11px; }
        .fb-td-sku { width: 70px; font-size: 8.5px; color: #555; font-family: ui-monospace, monospace; }
        .fb-td-desc { padding-left: 4px; }
        .fb-td-desc-title { font-weight: 700; line-height: 1.25; color: ${BLACK}; }
        .fb-td-price { width: 60px; text-align: right; white-space: nowrap; }
        .fb-td-total { width: 70px; text-align: right; white-space: nowrap; font-weight: 700; }
        .fb-td-stock { width: 60px; text-align: center; font-size: 8.5px; }
        .fb-stock-ok { color: #2C7E3F; font-weight: 700; }
        .fb-stock-low { color: #e67e22; font-weight: 700; }
        .fb-stock-cmd { color: #dc2626; font-weight: 700; }
        .fb-stock-na { color: #999; font-style: italic; }
        .fb-tr-comment td {
          background: #fff8dc !important;
          padding: 3px 8px !important;
          font-style: italic;
          font-size: 9px;
          color: #555 !important;
          border-left: 2px solid ${BLUE_STRONG};
        }
        .fb-tr-media td {
          background: white !important;
          padding: 4px !important;
          text-align: center !important;
        }
        .fb-tr-media img {
          width: auto;
          object-fit: contain;
          display: inline-block;
          vertical-align: middle;
        }
        .fb-media-small  { height: 22px !important; max-height: 22px !important; }
        .fb-media-medium { height: 36px !important; max-height: 36px !important; }
        .fb-media-large  { height: 56px !important; max-height: 56px !important; }
        .fb-line-discount { font-size: 8px; color: #2a8a2a; }

        /* ═══ FOOTER : services + totaux + signature ═══ */
        .fb-footer-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 4mm;
        }
        .fb-services-box {
          background: rgba(255,255,255,0.75);
          border: 1px solid ${BLUE_MID};
          border-radius: 4px;
          padding: 5px 8px;
          font-size: 9px;
        }
        .fb-services-title {
          font-weight: 700;
          color: ${BLUE_STRONG};
          text-transform: uppercase;
          font-size: 8px;
          letter-spacing: 0.04em;
          margin-bottom: 3px;
          padding-bottom: 2px;
          border-bottom: 1px solid ${BLUE_MID};
        }
        .fb-services-list { line-height: 1.5; }
        .fb-services-list-row { display: flex; justify-content: space-between; gap: 8px; }
        .fb-remarks-box {
          background: rgba(255, 251, 230, 0.85);
          border: 1px solid #f59e0b;
          border-radius: 4px;
          padding: 5px 8px;
          font-size: 9px;
          line-height: 1.4;
          color: ${BLACK};
          margin-top: 3mm;
        }
        .fb-remarks-title {
          font-weight: 700;
          color: #92400e;
          text-transform: uppercase;
          font-size: 8px;
          letter-spacing: 0.04em;
          margin-bottom: 2px;
        }

        .fb-totals {
          background: rgba(255,255,255,0.95);
          border: 1.5px solid ${BLUE_STRONG};
          border-radius: 4px;
          padding: 6px 10px;
          font-size: 10px;
        }
        .fb-totals-row {
          display: flex;
          justify-content: space-between;
          padding: 2px 0;
        }
        .fb-totals-row.fb-total-final {
          margin-top: 4px;
          padding-top: 6px;
          border-top: 2px solid ${BLUE_STRONG};
          font-size: 13px;
          font-weight: 900;
        }
        .fb-totals-row.fb-discount { color: #2a8a2a; }

        /* ═══ Signature & validation en bas ═══ */
        .fb-bottom-row {
          margin-top: 3mm;
          display: flex;
          gap: 4mm;
          align-items: stretch;
        }
        .fb-sign-block {
          flex: 1;
          background: rgba(255,255,255,0.75);
          border: 1px dashed ${BLUE_STRONG};
          border-radius: 4px;
          padding: 4px 8px 8px;
          page-break-inside: avoid;
        }
        .fb-sign-title {
          font-size: 8px;
          font-weight: 700;
          color: ${BLUE_STRONG};
          text-transform: uppercase;
          letter-spacing: 0.04em;
          margin-bottom: 12px;
        }
        .fb-sign-line {
          border-bottom: 1px solid #555;
          height: 14px;
          margin-bottom: 1mm;
        }
        .fb-sign-sub {
          font-size: 8px;
          color: #666;
          font-style: italic;
        }

        /* ═══ Stat strip footer ═══ */
        .fb-stat-strip {
          margin-top: 3mm;
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 8.5px;
          color: ${BLACK};
          padding: 3px 8px;
          background: rgba(255,255,255,0.6);
          border-radius: 3px;
          /* Réserve d'espace à droite pour le coin à couper */
          padding-right: 32mm;
        }
        .fb-stat-strip strong { font-weight: 700; }
      `}</style>

      <button className="fb-print-btn" onClick={() => window.print()}>🖨 Imprimer fiche bleue</button>

      <div className="fb-page">
        <div className="fb-watermark">ARCHIVE · {numeroAffiche}</div>

        <div className="fb-content">

          {/* HEADER */}
          <div className="fb-header">
            <div className="fb-header-left">
              <img className="fb-logo"
                src="https://cdn.shopify.com/s/files/1/0360/3251/2135/files/logo_JARDIN_CONFORT_shopify.jpg?v=1614107698"
                alt="Jardin-Confort" />
              <div className="fb-doc-title">
                {typeDocument === "Offre" ? "Offre" : "Commande"} · Archive
                <span className="fb-doc-title-fb">FICHE BLEUE</span>
              </div>
              <div className="fb-doc-subtitle">Fiche d&apos;archive — Classeur papier · Conservation interne</div>
            </div>
            <div className="fb-header-right">
              <div className="fb-doc-num">{numeroAffiche}</div>
              <div className="fb-doc-date">{numeroLabel}</div>
              <div className="fb-doc-date-big">{formatDate(dateDocument || data.date)}</div>
              {data.reference && (
                <div className="fb-doc-date" style={{fontStyle: "italic", marginTop: "2mm"}}>Réf. {data.reference}</div>
              )}
            </div>
          </div>

          {/* INFO STRIP */}
          <div className="fb-info-grid">
            {/* Bloc commercial / paiement (gauche) */}
            <div className="fb-info-block">
              <div className="fb-info-title">💼 Commercial / Paiement</div>
              <div className="fb-info-content">
                <div><strong>Commercial :</strong></div>
                <div className="fb-info-name">{data.commercial}</div>
                <div style={{marginTop: 3}}><strong>Mode paiement :</strong></div>
                <div style={{fontSize: 9}}>{data.paymentMode}</div>
                <div style={{marginTop: 3}}><strong>Type client :</strong> {data.clientType}</div>
              </div>
            </div>

            {/* Bloc livraison (centre) */}
            <div className="fb-info-block">
              <div className="fb-info-title">📦 Livraison</div>
              <div className="fb-info-content">
                {isPickup ? (
                  <>
                    <div className="fb-pickup-tag">À l&apos;emporter</div>
                    <div style={{marginTop: 3, fontSize: 9, fontStyle: "italic"}}>
                      Retrait Jardin-Confort SA<br/>
                      Lutry
                    </div>
                  </>
                ) : data.livrDiff ? (
                  <>
                    {data.livrSociete && <div>{data.livrSociete}</div>}
                    <div className="fb-info-name">{data.livrNom} {data.livrPrenom}</div>
                    {data.livrRue && <div>{data.livrRue} {data.livrNumero}</div>}
                    {data.livrNpa && <div>{data.livrNpa} {data.livrVille}</div>}
                    {data.livrTel && <div>📞 {data.livrTel}</div>}
                  </>
                ) : (
                  <div style={{fontStyle: "italic", fontSize: 9, color: "#555"}}>
                    Identique à facturation<br/>
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    {(data as any).deliveryMode}
                  </div>
                )}
                {data.leadTime && <div style={{marginTop: 3, fontSize: 9}}><strong>Délai :</strong> {data.leadTime}</div>}
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {(data as any).accesLivraison && !isPickup && (
                  <div style={{marginTop: 3, fontSize: 8.5, color: "#555", fontStyle: "italic"}}>
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    🏢 {(data as any).accesLivraison}
                  </div>
                )}
              </div>
            </div>

            {/* Bloc client / facturation (droite) */}
            <div className="fb-info-block">
              <div className="fb-info-title">👤 Client / Facturation</div>
              <div className="fb-info-content">
                {data.societe && <div>{data.societe}</div>}
                <div className="fb-info-name">{data.nom} {data.prenom}</div>
                {data.rue && <div>{data.rue} {data.numero}</div>}
                {data.npa && <div>{data.npa} {data.ville}</div>}
                {data.telephone1 && <div>📞 {data.telephone1}</div>}
                {data.email && <div style={{fontSize: 9}}>✉ {data.email}</div>}
                {data.customerNumber && <div style={{fontSize: 9, color: "#555", marginTop: 2}}>N° client : {data.customerNumber}</div>}
              </div>
            </div>
          </div>

          {/* TABLEAU ARTICLES */}
          <div className="fb-table-wrap">
            <table className="fb-table">
              <thead>
                <tr>
                  <th style={{width: 38}}></th>
                  <th className="th-c" style={{width: 32}}>Qté</th>
                  <th style={{width: 70}}>SKU</th>
                  <th>Désignation</th>
                  <th className="th-r" style={{width: 60}}>Prix/u</th>
                  <th className="th-r" style={{width: 70}}>Total</th>
                  <th className="th-c" style={{width: 60}}>Stock</th>
                </tr>
              </thead>
              <tbody>
                {data.lines.length === 0 && (
                  <tr><td colSpan={7} style={{textAlign: "center", padding: 8, fontStyle: "italic", color: "#999"}}>Aucun article</td></tr>
                )}
                {data.lines.map((line: QuoteLine) => {
                  if (line.type === "comment") {
                    return (
                      <tr key={line.id} className="fb-tr-comment">
                        <td colSpan={7}>💬 {line.title || <em style={{opacity: 0.6}}>(commentaire vide)</em>}</td>
                      </tr>
                    );
                  }
                  if (line.type === "media") {
                    if (!line.mediaUrl) return null;
                    const sizeClass = line.mediaSize === "small" ? "fb-media-small" : line.mediaSize === "large" ? "fb-media-large" : "fb-media-medium";
                    return (
                      <tr key={line.id} className="fb-tr-media">
                        <td colSpan={7}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={line.mediaUrl} alt={line.title || ""} className={sizeClass} />
                        </td>
                      </tr>
                    );
                  }

                  const lineTotal = line.qty * line.unitPrice - (line.lineDiscount || 0);
                  let stockEl: React.ReactNode;
                  const sn = typeof line.stock === "number" ? line.stock : null;
                  if (line.stock === undefined || line.stock === null) {
                    stockEl = <span className="fb-stock-na">—</span>;
                  } else if (line.stock === "sur_commande" || (sn !== null && sn < 1)) {
                    stockEl = <span className="fb-stock-cmd">CMD</span>;
                  } else if (sn !== null && sn > 2) {
                    stockEl = <span className="fb-stock-ok">✓ {sn}</span>;
                  } else if (sn !== null && sn > 0) {
                    stockEl = <span className="fb-stock-low">⚠ {sn}</span>;
                  }

                  return (
                    <tr key={line.id}>
                      <td className="fb-td-img">
                        {line.image && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={line.image} alt="" />
                        )}
                      </td>
                      <td className="fb-td-qty">{line.qty}×</td>
                      <td className="fb-td-sku">{line.sku || "—"}</td>
                      <td className="fb-td-desc">
                        <div className="fb-td-desc-title">{line.title}</div>
                        {(line.lineDiscount || 0) > 0 && (
                          <div className="fb-line-discount">Remise : − {formatMoney(line.lineDiscount || 0)}</div>
                        )}
                      </td>
                      <td className="fb-td-price">{formatMoney(line.unitPrice)}</td>
                      <td className="fb-td-total">{formatMoney(lineTotal)}</td>
                      <td className="fb-td-stock">{stockEl}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* SERVICES + REMARQUES (col 1) | TOTAUX (col 2) */}
          <div className="fb-footer-grid">

            <div>
              {activeServices.length > 0 && (
                <div className="fb-services-box">
                  <div className="fb-services-title">Services</div>
                  <div className="fb-services-list">
                    {activeServices.map((srv, i) => (
                      <div key={i} className="fb-services-list-row">
                        <span>↳ {srv.label}</span>
                        <span style={{fontWeight: 700}}>{srv.amount === 0 ? "Offert" : formatMoney(srv.amount)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {data.remarks && data.remarks.trim() && (
                <div className="fb-remarks-box">
                  <div className="fb-remarks-title">⚠ Remarques</div>
                  <div>{data.remarks}</div>
                </div>
              )}
            </div>

            <div className="fb-totals">
              <div className="fb-totals-row">
                <span>Sous-total articles</span>
                <span>{formatMoney(subTotal)}</span>
              </div>
              {discountValue > 0 && (
                <div className="fb-totals-row fb-discount">
                  <span>Remise</span>
                  <span>− {formatMoney(discountValue)}</span>
                </div>
              )}
              {serviceTotal > 0 && (
                <div className="fb-totals-row">
                  <span>Services</span>
                  <span>{formatMoney(serviceTotal)}</span>
                </div>
              )}
              {roundingValue !== 0 && (
                <div className="fb-totals-row">
                  <span>Arrondi</span>
                  <span>{formatMoney(roundingValue)}</span>
                </div>
              )}
              {isPrivateTTC ? (
                <div className="fb-totals-row" style={{fontSize: 9, color: "#666"}}>
                  <span>TVA 8.1% incluse</span>
                  <span>{formatMoney(tvaAmount)}</span>
                </div>
              ) : (
                <>
                  <div className="fb-totals-row">
                    <span>Total HT</span>
                    <span>{formatMoney(totals.totalAfterRounding)}</span>
                  </div>
                  <div className="fb-totals-row" style={{fontSize: 9, color: "#666"}}>
                    <span>+ TVA 8.1%</span>
                    <span>{formatMoney(tvaAmount)}</span>
                  </div>
                </>
              )}
              <div className="fb-totals-row fb-total-final">
                <span>TOTAL {isPrivateTTC ? "TTC" : "HT+TVA"}</span>
                <span>{formatMoney(finalTotal)}</span>
              </div>
            </div>
          </div>

          {/* SIGNATURE + STATS */}
          <div className="fb-bottom-row">
            <div className="fb-sign-block" style={{flex: 0.5}}>
              <div className="fb-sign-title">Visa commercial</div>
              <div className="fb-sign-line"></div>
              <div className="fb-sign-sub">Date · Signature</div>
            </div>
            <div className="fb-sign-block" style={{flex: 0.5}}>
              <div className="fb-sign-title">Contrôle archive</div>
              <div className="fb-sign-line"></div>
              <div className="fb-sign-sub">Date · Initiales</div>
            </div>
            <div className="fb-sign-block" style={{flex: 1, border: `1px solid ${BLUE_STRONG}`, background: "rgba(255,255,255,0.85)"}}>
              <div className="fb-sign-title">Notes archive</div>
              <div style={{fontSize: 8.5, color: "#666", lineHeight: 1.4}}>
                Acompte : ____________________ CHF<br/>
                Solde : _______________________ CHF<br/>
                Échéance : ____________________
              </div>
            </div>
          </div>

          <div className="fb-stat-strip">
            <span><strong>{totalLines}</strong> ligne{totalLines > 1 ? "s" : ""} · <strong>{totalQty}</strong> pce{totalQty > 1 ? "s" : ""}</span>
            <span>Jardin-Confort SA · Route de Lavaux 425 · 1095 Lutry · TVA CHE-100.142.327</span>
            <span style={{fontStyle: "italic", color: "#555"}}>Doc interne — ne pas distribuer</span>
          </div>

        </div>{/* fin fb-content */}

        {/* ═══ Coin à couper après archivage ═══ */}
        <div className="fb-cut-corner">
          <div className="fb-cut-corner-bg"></div>
          <div className="fb-cut-corner-line"></div>
          <div className="fb-cut-corner-scissors">✂</div>
          <div className="fb-cut-corner-label">Couper après<br/>classement</div>
        </div>

      </div>{/* fin fb-page */}
    </>
  );
}