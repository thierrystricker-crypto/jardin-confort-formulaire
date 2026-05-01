"use client";
// ═══════════════════════════════════════════════════════════════
//  app/print/fiche-travail/[slug]/page.tsx
//  Template d'impression — FICHE DE TRAVAIL (interne entrepôt)
//  Adresse de LIVRAISON principale + codes-barres SKU + QR commande
//  Cercles ®© commandé/réservé · Big-qty · Stock · Acompte/Solde
// ═══════════════════════════════════════════════════════════════

import React, { useEffect, useState, useRef } from "react";

const THEME  = "#2b8ad1";
const BLACK  = "#000000";
const GREY   = "#333333";
const LIGHT  = "#f9f9f9";
const ORANGE = "#e67e22";

type QuoteLine = {
  id: string;
  type: "product" | "custom" | "comment";
  image?: string;
  sku: string;
  title: string;
  unitPrice: number;
  qty: number;
  stock?: number | null | "sur_commande";
  lineDiscount?: number;
};

type PrintData = {
  formType: string;
  clientType: string;
  paymentMode: string;
  date: string;
  commercial: string;
  offerNumber: string;
  reference: string;
  societe: string; nom: string; prenom: string;
  rue: string; numero: string; npa: string; ville: string;
  telephone1: string; telephone2: string; email: string;
  livrDiff: boolean;
  livrSociete: string; livrNom: string; livrPrenom: string;
  livrTel: string; livrRue: string; livrNumero: string; livrNpa: string; livrVille: string;
  lines: QuoteLine[];
  remarks: string;
  leadTime: string;
  deliveryMode?: string;
};

const EMPTY: PrintData = {
  formType: "Commande", clientType: "Privé (prix TTC)",
  paymentMode: "", date: "", commercial: "", offerNumber: "", reference: "",
  societe: "", nom: "", prenom: "", rue: "", numero: "", npa: "", ville: "",
  telephone1: "", telephone2: "", email: "",
  livrDiff: false, livrSociete: "", livrNom: "", livrPrenom: "",
  livrTel: "", livrRue: "", livrNumero: "", livrNpa: "", livrVille: "",
  lines: [], remarks: "", leadTime: "",
  deliveryMode: "Livraison à domicile",
};

function formatDate(iso: string) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("fr-CH", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatDateTime() {
  return new Date().toLocaleString("fr-CH", {
    day: "2-digit", month: "2-digit", year: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function PrintFicheTravail({ params }: { params: Promise<{ slug: string }> }) {
  const [data, setData] = useState<PrintData>(EMPTY);
  const [ready, setReady] = useState(false);
  const [numeroAffiche, setNumeroAffiche] = useState("");
  const [printedAt] = useState(formatDateTime());
  const barcodesRendered = useRef(false);

  useEffect(() => {
    async function load() {
      const { slug } = await params;
      try {
        // snapshot=false → on récupère le STOCK LIVE Shopify (cf. ton API)
        const res = await fetch(`/api/offres/${slug}?snapshot=false`);
        if (res.ok) {
          const json = await res.json();
          const offreData = json.offre?.data;
          if (offreData) {
            setNumeroAffiche(json.offre?.numero_affiche || offreData.offerNumber || slug);
            setData({
              ...EMPTY,
              ...offreData,
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

  // ── Génération des codes-barres CODE128 (JsBarcode) + QR Code ──
  // On charge JsBarcode et qrcode-generator depuis CDN, on les dessine après render.
  useEffect(() => {
    if (!ready || barcodesRendered.current) return;
    if (data.lines.length === 0 && !numeroAffiche) return;

    // Charger JsBarcode + qrcode dynamiquement (1 seule fois)
    const loadScript = (src: string, id: string) =>
      new Promise<void>((resolve, reject) => {
        if (document.getElementById(id)) { resolve(); return; }
        const s = document.createElement("script");
        s.id = id; s.src = src; s.async = true;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error(`Échec chargement ${src}`));
        document.head.appendChild(s);
      });

    Promise.all([
      loadScript("https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js", "jsbarcode-script"),
      loadScript("https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js", "qrcode-script"),
    ]).then(() => {
      // Codes-barres SKU
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const JsBarcode = (window as any).JsBarcode;
      if (JsBarcode) {
        document.querySelectorAll<HTMLElement>(".barcode-sku").forEach((el) => {
          const sku = el.getAttribute("data-sku");
          if (!sku) return;
          try {
            JsBarcode(el, sku, {
              format: "CODE128",
              width: 1.6,
              height: 38,
              displayValue: true,
              fontSize: 11,
              font: "Raleway, Arial, sans-serif",
              margin: 0,
              textMargin: 2,
              lineColor: "#000000",
            });
          } catch (e) {
            console.warn("Barcode error pour SKU", sku, e);
          }
        });
      }

      // QR Code commande
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const qrcode = (window as any).qrcode;
      if (qrcode && numeroAffiche) {
        const qrEl = document.getElementById("qr-commande");
        if (qrEl) {
          const qr = qrcode(0, "M");
          qr.addData(numeroAffiche);
          qr.make();
          qrEl.innerHTML = qr.createImgTag(4, 0); // 4px par module, 0 marge
        }
      }
      barcodesRendered.current = true;
    }).catch((err) => console.error("Erreur chargement librairies barcode:", err));
  }, [ready, data.lines, numeroAffiche]);

  if (!ready) return <div style={{padding:40, textAlign:"center", color:GREY}}>Chargement…</div>;

  // ── Adresse de livraison à afficher en HAUT (principale) ──
  const livrSociete  = data.livrDiff ? data.livrSociete  : data.societe;
  const livrNom      = data.livrDiff ? data.livrNom      : data.nom;
  const livrPrenom   = data.livrDiff ? data.livrPrenom   : data.prenom;
  const livrRue      = data.livrDiff ? data.livrRue      : data.rue;
  const livrNumero   = data.livrDiff ? data.livrNumero   : data.numero;
  const livrNpa      = data.livrDiff ? data.livrNpa      : data.npa;
  const livrVille    = data.livrDiff ? data.livrVille    : data.ville;
  const livrTel      = data.livrDiff ? data.livrTel      : data.telephone1;

  const isPickup = data.deliveryMode === "À l'emporter";
  const totalQty = data.lines.reduce((s, l) => l.type === "comment" ? s : s + l.qty, 0);

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
        @page { size: A4 portrait; margin: 12mm 12mm 12mm 12mm; }
        @media screen {
          .doc-wrap { max-width: 794px; margin: 0 auto; padding: 20px 28px; box-shadow: 0 0 20px rgba(0,0,0,0.08); }
          .print-btn { position: fixed; top: 16px; right: 16px; z-index: 100; background: ${THEME}; color: white; border: 0; padding: 10px 20px; border-radius: 6px; font-size: 14px; font-weight: 700; cursor: pointer; }
        }
        @media print { .print-btn { display: none !important; } }

        /* ══ BANDEAU TITRE FICHE DE TRAVAIL ══ */
        .doc-banner {
          background: ${THEME};
          color: white;
          padding: 6px 14px;
          margin-bottom: 5mm;
          border-radius: 4px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 13px;
          font-weight: 700;
          letter-spacing: 0.05em;
        }
        .doc-banner-printed { font-size: 11px; font-weight: 400; opacity: 0.9; }

        /* ══ HEADER ══ */
        .doc-header { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 5mm; width: 100%; }
        .doc-header-left { flex: 0 0 46%; }
        .doc-header-right { flex: 0 0 50%; }
        .doc-logo { max-width: 165px; max-height: 60px; object-fit: contain; display: block; margin-bottom: 8px; }
        .doc-type {
          font-size: 22px; font-weight: 900;
          color: ${THEME}; margin-bottom: 6px;
          line-height: 1.1; letter-spacing: 0.02em;
          text-transform: uppercase;
        }
        .doc-meta-table { border-collapse: collapse; width: 100%; }
        .doc-meta-table td { padding: 1px 6px 1px 0; vertical-align: top; font-size: 12px; line-height: 1.35; }
        .doc-meta-label { font-weight: 700; color: ${BLACK}; white-space: nowrap; width: 44%; }

        /* QR Code à côté du logo */
        .qr-wrap {
          display: inline-flex; flex-direction: column; align-items: center;
          margin-top: 8px;
        }
        .qr-wrap img { display: block; }
        .qr-label {
          font-size: 9px; color: #666; margin-top: 2px;
          letter-spacing: 0.05em; text-transform: uppercase;
        }

        /* ══ FENÊTRE ADRESSE LIVRAISON (principale) ══ */
        .doc-addr-window {
          padding: 10px 14px 10px 16px;
          min-height: 50mm;
          background: white;
          border: 2px solid ${THEME};
          border-radius: 6px;
        }
        .doc-addr-window-title {
          display: inline-block;
          background: ${THEME};
          color: white;
          padding: 2px 8px;
          border-radius: 3px;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.06em;
          margin-bottom: 6px;
          text-transform: uppercase;
        }
        .doc-addr-ref { font-size: 11px; color: #666; font-weight: 400; margin-bottom: 4px; }
        .doc-addr-name { font-size: 18px; font-weight: 700; color: ${BLACK}; line-height: 1.3; margin-bottom: 3px; }
        .doc-addr-line { font-size: 16px; color: ${BLACK}; line-height: 1.35; font-weight: 400; }
        .doc-addr-tel { margin-top: 6px; font-size: 14px; font-weight: 600; }

        .doc-pickup-badge {
          display: inline-block;
          background: ${ORANGE};
          color: white;
          padding: 5px 12px;
          border-radius: 4px;
          font-size: 13px;
          font-weight: 800;
          margin-bottom: 6px;
          letter-spacing: 0.05em;
        }

        .doc-hr { border: 0; border-top: 2px solid ${THEME}; margin: 4mm 0; width: 100%; }

        /* ══ ADRESSE FACTURATION (secondaire) ══ */
        .doc-billing-info {
          background: #f3f4f6;
          padding: 8px 12px;
          border-radius: 4px;
          margin-bottom: 4mm;
          font-size: 11px;
          color: #555;
          display: flex;
          gap: 14px;
          align-items: baseline;
        }
        .doc-billing-info-label {
          font-weight: 700;
          color: ${BLACK};
          text-transform: uppercase;
          letter-spacing: 0.05em;
          font-size: 10px;
          flex-shrink: 0;
        }

        /* ══ TABLEAU ARTICLES ══ */
        .doc-table { width: 100%; border-collapse: collapse; margin-bottom: 4mm; }
        .doc-table thead th {
          padding: 7px 4px;
          border-top: 2px solid ${THEME};
          border-bottom: 2px solid ${THEME};
          font-weight: 700;
          font-size: 11px;
          color: ${BLACK};
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .doc-table thead th.th-left { text-align: left; }
        .doc-table thead th.th-center { text-align: center; }
        .doc-table tbody tr td {
          padding: 8px 4px;
          border-bottom: 1px solid #d1d5db;
          vertical-align: middle;
          font-size: 12px;
        }
        .doc-table tbody tr.row-product:nth-child(even) td { background: ${LIGHT}; }
        .td-img { width: 56px; vertical-align: middle; text-align: center; }
        .td-img img { max-width: 50px; max-height: 50px; object-fit: contain; }
        .td-circles { width: 60px; text-align: center; }
        .td-qty { width: 80px; text-align: center; vertical-align: middle; }
        .td-stock { width: 80px; text-align: center; vertical-align: middle; }
        .td-desc { padding-left: 6px !important; }

        /* ── Cercles commandé/réservé (style ®©) ── */
        .check-circle {
          display: inline-block;
          width: 22px; height: 22px;
          border: 2px solid #000;
          border-radius: 50%;
          margin: 0 2px;
          vertical-align: middle;
        }
        .check-circles-labels {
          display: block;
          font-size: 8px;
          color: #555;
          letter-spacing: 0.04em;
          margin-top: 2px;
          text-transform: uppercase;
        }

        /* ── Big quantity ── */
        .big-qty {
          font-size: 26px;
          font-weight: 900;
          color: ${BLACK};
          line-height: 1;
        }
        .big-qty-x {
          font-size: 14px;
          font-weight: 700;
          color: #555;
          margin-left: 1px;
        }

        /* ── Description ── */
        .item-title { font-weight: 700; color: ${BLACK}; line-height: 1.35; font-size: 12px; }
        .item-sku-text { font-size: 10px; color: #555; margin-top: 2px; font-weight: 400; }
        .item-barcode { margin-top: 4px; }
        .item-barcode svg { display: block; max-width: 100%; }

        /* ── Stock ── */
        .stock-ok    { color: #2C7E3F; font-weight: 700; font-size: 12px; }
        .stock-low   { color: ${ORANGE}; font-weight: 700; font-size: 12px; }
        .stock-cmd   { color: #dc2626; font-weight: 700; font-size: 11px; }
        .stock-na    { color: #999; font-style: italic; font-size: 11px; }
        .stock-date  { display: block; font-size: 9px; color: #777; font-weight: 400; margin-top: 2px; }

        /* ── Lignes commentaires ── */
        .tr-comment td {
          background: #eef4fb !important;
          padding: 6px 10px !important;
          font-style: italic;
          color: #445 !important;
          font-size: 12px;
        }

        /* ══ NOTES + TOTAUX ══ */
        .doc-bottom-wrap {
          display: flex;
          gap: 14px;
          margin-bottom: 5mm;
          align-items: flex-start;
        }
        .doc-notes-col { flex: 1; }
        .doc-totals-col { flex: 0 0 42%; }

        .doc-notes-title {
          font-weight: 700;
          color: ${BLACK};
          margin-bottom: 5px;
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .doc-notes-text {
          font-size: 12px;
          color: ${GREY};
          line-height: 1.55;
          white-space: pre-wrap;
          padding: 8px 10px;
          background: #fffbea;
          border-left: 3px solid #f59e0b;
          border-radius: 0 4px 4px 0;
        }

        /* ── Tableau récap (avec acompte/solde à remplir à la main) ── */
        .doc-recap { width: 100%; border-collapse: collapse; }
        .doc-recap td {
          padding: 6px 8px;
          font-size: 12px;
          border-bottom: 1px solid #e5e7eb;
        }
        .doc-recap .recap-label { font-weight: 600; color: ${BLACK}; }
        .doc-recap .recap-value { text-align: right; white-space: nowrap; color: ${BLACK}; font-weight: 600; }
        .doc-recap .recap-total td {
          border-top: 2px solid ${THEME};
          border-bottom: 2px solid ${THEME};
          padding: 9px 8px;
          font-size: 14px;
          font-weight: 900;
          color: ${BLACK};
          background: rgba(43, 138, 209, 0.06);
        }
        .doc-recap .recap-fillable td {
          padding: 12px 8px;
          background: #fffbea;
          border-bottom: 1px dashed #f59e0b;
        }
        .doc-recap .recap-fillable .recap-value {
          border-bottom: 1.5px solid #999;
          min-width: 90px;
          display: inline-block;
        }
        .doc-recap .recap-final td {
          border-top: 2px solid #000;
          padding: 10px 8px;
          font-size: 14px;
          font-weight: 900;
          color: ${BLACK};
          background: #f3f4f6;
        }

        /* ══ ZONE SIGNATURES PRÉPARATION/LIVRAISON ══ */
        .doc-sign-row {
          display: flex;
          gap: 16px;
          margin-top: 4mm;
          page-break-inside: avoid;
        }
        .doc-sign-box {
          flex: 1;
          border: 1px solid #999;
          border-radius: 4px;
          padding: 10px 12px;
          min-height: 80px;
        }
        .doc-sign-title {
          font-size: 11px;
          font-weight: 700;
          color: ${BLACK};
          text-transform: uppercase;
          letter-spacing: 0.04em;
          margin-bottom: 8px;
          border-bottom: 1px solid #ccc;
          padding-bottom: 4px;
        }
        .doc-sign-line {
          height: 28px;
          border-bottom: 1px solid #999;
          margin-top: 18px;
        }
        .doc-sign-sub {
          font-size: 9px;
          color: #777;
          margin-top: 3px;
          text-align: center;
        }

        /* ══ FOOTER MINIMAL ══ */
        .doc-footer-mini {
          margin-top: 5mm;
          padding-top: 5px;
          border-top: 1px solid #d1d5db;
          text-align: center;
          font-size: 9px;
          color: #888;
          line-height: 1.5;
        }
      `}</style>

      <button className="print-btn" onClick={() => window.print()}>🖨 Imprimer</button>

      <div className="doc-wrap">

        {/* ══ BANDEAU FICHE DE TRAVAIL ══ */}
        <div className="doc-banner">
          <span>📋 FICHE DE TRAVAIL — USAGE INTERNE</span>
          <span className="doc-banner-printed">Imprimée le {printedAt}</span>
        </div>

        {/* ══ HEADER ══ */}
        <div className="doc-header">
          <div className="doc-header-left">
            <img className="doc-logo"
              src="https://cdn.shopify.com/s/files/1/0360/3251/2135/files/logo_JARDIN_CONFORT_shopify.jpg?v=1614107698"
              alt="Jardin-Confort" />
            <div className="doc-type">Fiche de travail</div>
            <table className="doc-meta-table">
              <tbody>
                <tr>
                  <td className="doc-meta-label">N° {data.formType === "Offre" ? "d'offre" : "de commande"}</td>
                  <td><strong>{numeroAffiche || data.offerNumber}</strong></td>
                </tr>
                {data.reference && (
                  <tr><td className="doc-meta-label">Référence</td><td>{data.reference}</td></tr>
                )}
                <tr><td className="doc-meta-label">Date commande</td><td>{formatDate(data.date)}</td></tr>
                <tr><td className="doc-meta-label">Commercial</td><td>{data.commercial}</td></tr>
                {data.leadTime && (
                  <tr><td className="doc-meta-label">Délai de livraison</td><td>{data.leadTime}</td></tr>
                )}
                {data.deliveryMode && (
                  <tr><td className="doc-meta-label">Mode de livraison</td><td><strong>{data.deliveryMode}</strong></td></tr>
                )}
                <tr><td className="doc-meta-label">Total articles</td><td><strong>{totalQty} pce{totalQty > 1 ? "s" : ""}</strong></td></tr>
              </tbody>
            </table>

            {/* QR code commande */}
            <div className="qr-wrap">
              <div id="qr-commande"></div>
              <div className="qr-label">Scan = N° commande</div>
            </div>
          </div>

          <div className="doc-header-right">
            <div className="doc-addr-window">
              <span className="doc-addr-window-title">📦 Adresse de livraison</span>
              <div className="doc-addr-ref">Réf : {numeroAffiche || data.offerNumber}</div>

              {isPickup && (
                <div className="doc-pickup-badge">⚠ À L'EMPORTER</div>
              )}

              {livrSociete && <div className="doc-addr-line">{livrSociete}</div>}
              <div className="doc-addr-name">{livrNom} {livrPrenom}</div>
              {livrRue && <div className="doc-addr-line">{livrRue} {livrNumero}</div>}
              {livrNpa && <div className="doc-addr-line">{livrNpa} {livrVille}</div>}
              {livrTel && <div className="doc-addr-tel">📞 {livrTel}</div>}
            </div>
          </div>
        </div>

        {/* ══ Adresse facturation (info secondaire) ══ */}
        {data.livrDiff && (
          <div className="doc-billing-info">
            <span className="doc-billing-info-label">Facturation :</span>
            <span>
              {data.societe && <>{data.societe} · </>}
              {data.nom} {data.prenom} · {data.rue} {data.numero}, {data.npa} {data.ville}
              {data.telephone1 && <> · {data.telephone1}</>}
            </span>
          </div>
        )}

        {/* ══ TABLEAU ARTICLES ══ */}
        <table className="doc-table">
          <thead>
            <tr>
              <th style={{width:56}}></th>
              <th className="th-center" style={{width:60}}>Cmd / Rés</th>
              <th className="th-center" style={{width:80}}>Qté</th>
              <th className="th-left">Description / SKU / Code-barres</th>
              <th className="th-center" style={{width:80}}>Stock</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.length === 0 && (
              <tr><td colSpan={5} style={{textAlign:"center", padding:"20px", color:"#aaa", fontStyle:"italic"}}>Aucun article</td></tr>
            )}
            {data.lines.map((line) => {
              if (line.type === "comment") {
                return (
                  <tr key={line.id} className="tr-comment">
                    <td colSpan={5}>💬 {line.title}</td>
                  </tr>
                );
              }

              // Affichage stock
              let stockDisplay: React.ReactNode;
              if (line.stock === undefined || line.stock === null) {
                stockDisplay = <span className="stock-na">—</span>;
              } else if (line.stock === "sur_commande" || line.stock === 0) {
                stockDisplay = <span className="stock-cmd">Sur commande</span>;
              } else if (typeof line.stock === "number") {
                if (line.stock > 2) {
                  stockDisplay = <span className="stock-ok">✓ {line.stock} pce{line.stock > 1 ? "s" : ""}</span>;
                } else {
                  stockDisplay = <span className="stock-low">⚠ {line.stock} pce{line.stock > 1 ? "s" : ""}</span>;
                }
              }

              return (
                <tr key={line.id} className="row-product">
                  <td className="td-img">
                    {line.image && <img src={line.image} alt="" />}
                  </td>

                  {/* Cercles ®© commandé / réservé */}
                  <td className="td-circles">
                    <div>
                      <span className="check-circle"></span>
                      <span className="check-circle"></span>
                    </div>
                    <span className="check-circles-labels">cmd · rés</span>
                  </td>

                  {/* Big qty */}
                  <td className="td-qty">
                    <span className="big-qty">{line.qty}</span>
                    <span className="big-qty-x">×</span>
                  </td>

                  {/* Description + SKU + Code-barres */}
                  <td className="td-desc">
                    <div className="item-title">{line.title}</div>
                    {line.sku && (
                      <>
                        <div className="item-sku-text">SKU : {line.sku}</div>
                        <div className="item-barcode">
                          <svg className="barcode-sku" data-sku={line.sku}></svg>
                        </div>
                      </>
                    )}
                  </td>

                  <td className="td-stock">
                    {stockDisplay}
                    <span className="stock-date">au {printedAt.split(" ")[0]}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* ══ NOTES + RÉCAP ══ */}
        <div className="doc-bottom-wrap">
          <div className="doc-notes-col">
            {data.remarks && (
              <>
                <div className="doc-notes-title">⚠ Notes / Instructions</div>
                <div className="doc-notes-text">{data.remarks}</div>
              </>
            )}
          </div>

          <div className="doc-totals-col">
            <table className="doc-recap">
              <tbody>
                <tr className="recap-total">
                  <td className="recap-label">TOTAL TTC</td>
                  <td className="recap-value">
                    <span style={{fontSize: 11, color: "#888", fontWeight: 400, marginRight: 4}}>(voir commande)</span>
                  </td>
                </tr>
                <tr className="recap-fillable">
                  <td className="recap-label">Acompte versé</td>
                  <td className="recap-value">CHF&nbsp;_____________</td>
                </tr>
                <tr className="recap-fillable">
                  <td className="recap-label">Solde à percevoir</td>
                  <td className="recap-value">CHF&nbsp;_____________</td>
                </tr>
                <tr className="recap-final">
                  <td className="recap-label">Mode de paiement</td>
                  <td className="recap-value" style={{fontSize:11}}>{data.paymentMode}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* ══ ZONE SIGNATURES ══ */}
        <div className="doc-sign-row">
          <div className="doc-sign-box">
            <div className="doc-sign-title">Préparé par</div>
            <div style={{fontSize:10, color:"#777"}}>Nom · Date · Heure</div>
            <div className="doc-sign-line"></div>
            <div className="doc-sign-sub">Signature préparateur</div>
          </div>
          <div className="doc-sign-box">
            <div className="doc-sign-title">Contrôlé par</div>
            <div style={{fontSize:10, color:"#777"}}>Nom · Date · Heure</div>
            <div className="doc-sign-line"></div>
            <div className="doc-sign-sub">Signature contrôle</div>
          </div>
          <div className="doc-sign-box">
            <div className="doc-sign-title">Livré / Remis</div>
            <div style={{fontSize:10, color:"#777"}}>Nom · Date · Heure</div>
            <div className="doc-sign-line"></div>
            <div className="doc-sign-sub">Signature livreur / client</div>
          </div>
        </div>

        {/* ══ FOOTER MINIMAL ══ */}
        <div className="doc-footer-mini">
          Jardin-Confort SA · Route de Lavaux 425 · 1095 Lutry · +41 21 791 36 71 · Document interne — ne pas remettre au client
        </div>

      </div>
    </>
  );
}