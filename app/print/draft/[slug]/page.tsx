"use client";
// ═══════════════════════════════════════════════════════════════
//  app/print/draft/[slug]/page.tsx
//  Template d'impression — BROUILLON (Session 7)
//
//  Copié et adapté depuis /print/offre/[slug]/page.tsx (2026-05-15).
//  Différences par rapport à la page offre :
//   - Fetch depuis /api/drafts/[slug] (table drafts, pas offres)
//   - Filigrane "BROUILLON — DRA-XXX" en SVG répété
//   - Bandeau écran-only ambre (masqué à l'impression)
//   - Bouton "← Retour au brouillon"
//   - Pas de bloc signature
//   - Pas de lien validation + QR code
//   - Pas de badge stock (un brouillon ne reflète pas l'état stock live)
//   - Pas d'auto-print
//
//  Choix d'architecture : fichier autonome dupliqué plutôt qu'une prop
//  isDraft passée au template offre, pour ne pas alourdir le code chaud
//  diffusé aux clients et garder une liberté d'évolution indépendante.
// ═══════════════════════════════════════════════════════════════

import React, { useEffect, useState } from "react";
import {
  PrintData, QuoteLine, AmbianceImage,
  serviceOptions, formatMoney, formatDate,
  computeTotals,
} from "@/lib/jc-print-types";

const THEME  = "#2b8ad1";
const BLACK  = "#000000";
const GREY   = "#333333";
const LIGHT  = "#f9f9f9";
const AMBER  = "#f59e0b"; // couleur filigrane brouillon

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

// ─── Génération du filigrane SVG data-URI ───────────────────
// Motif répété en background-image sur .doc-wrap.
// Rotation -30°, opacité 0.11 → visible mais ne masque pas le contenu.
function buildWatermarkDataUri(numero: string): string {
  const safeNum = (numero || "BROUILLON").replace(/[<>&"']/g, "");
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='560' height='340' viewBox='0 0 560 340'>
<g transform='translate(280 170) rotate(-30)' fill='${AMBER}' fill-opacity='0.11' text-anchor='middle' font-family='Raleway, Helvetica, Arial, sans-serif' font-weight='700'>
<text y='-12' font-size='44' letter-spacing='4'>BROUILLON — ${safeNum}</text>
<text y='22' font-size='14' letter-spacing='2' fill-opacity='0.55'>Document non contractuel</text>
</g>
</svg>`;
  // encodeURIComponent garde le SVG inline propre, lisible et caché-friendly
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
}

export default function PrintDraftSlug({ params }: { params: Promise<{ slug: string }> }) {
  const [data, setData] = useState<PrintData>(EMPTY);
  const [ready, setReady] = useState(false);
  const [numeroAffiche, setNumeroAffiche] = useState("");
  const [draftSlug, setDraftSlug] = useState("");
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    async function load() {
      const { slug } = await params;
      setDraftSlug(slug);
      try {
        const res = await fetch(`/api/drafts/${slug}`);
        if (res.status === 404) {
          setNotFound(true);
          setReady(true);
          return;
        }
        if (res.ok) {
          const json = await res.json();
          const draft = json.draft;
          const draftData = draft?.data;
          if (draftData) {
            setNumeroAffiche(draft?.numero_affiche || slug);
            setData({
              ...EMPTY,
              ...draftData,
              customerNumber: draft?.client_numero_client || "",
              ambianceImages: draftData.ambianceImages || [],
            });
          }
        }
      } catch (e) {
        console.error("Erreur chargement brouillon:", e);
      }
      setReady(true);
    }
    load();
  }, [params]);

  if (!ready) {
    return (
      <div style={{padding:40, textAlign:"center", color:GREY, fontFamily:"Raleway, Arial, sans-serif"}}>
        Chargement du brouillon…
      </div>
    );
  }

  if (notFound) {
    return (
      <div style={{padding:40, textAlign:"center", color:GREY, fontFamily:"Raleway, Arial, sans-serif"}}>
        <h1 style={{color: AMBER, marginBottom: 12}}>Brouillon introuvable</h1>
        <p>Aucun brouillon trouvé pour <code>{draftSlug}</code>.</p>
        <a
          href="/dashboard"
          style={{
            display: "inline-block",
            marginTop: 16,
            padding: "8px 16px",
            background: AMBER,
            color: "white",
            textDecoration: "none",
            borderRadius: 6,
            fontWeight: 700,
          }}
        >
          ← Retour au dashboard
        </a>
      </div>
    );
  }

  const totals = computeTotals(data);
  const {
    isPrivateTTC, subTotal, discountValue,
    roundingValue, tvaAmount, finalTotal,
  } = totals;

  const activeServices = [
    ...serviceOptions
      .filter((s) => data.enabledServices[s.code])
      .map((s) => ({ label: s.label, amount: Number(data.servicePrices[s.code] || 0) })),
    ...(data.enabledServices["custom"]
      ? [{ label: data.servicePrices["custom_label"] || "Service personnalisé", amount: Number(data.servicePrices["custom"] || 0) }]
      : []),
  ];

  const watermarkUrl = buildWatermarkDataUri(numeroAffiche);

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
          .doc-wrap {
            max-width: 794px;
            margin: 0 auto;
            padding: 20px 28px;
            box-shadow: 0 0 20px rgba(0,0,0,0.08);
          }
          .print-btn {
            position: fixed;
            top: 16px;
            right: 16px;
            z-index: 100;
            background: ${THEME};
            color: white;
            border: 0;
            padding: 10px 20px;
            border-radius: 6px;
            font-size: 14px;
            font-weight: 700;
            cursor: pointer;
          }
          .draft-screen-banner {
            max-width: 794px;
            margin: 0 auto 14px auto;
            background: #FFF8E1;
            border: 1.5px solid ${AMBER};
            border-radius: 10px;
            padding: 12px 18px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 14px;
            font-size: 13px;
            color: #7B5E00;
          }
          .draft-screen-banner-text {
            font-weight: 600;
          }
          .draft-screen-banner-text small {
            display: block;
            font-weight: 400;
            font-size: 11px;
            color: #8a6d00;
            margin-top: 2px;
          }
          .draft-screen-back-btn {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            background: #FAEEDA;
            color: #633806;
            border: 1px solid ${AMBER};
            border-radius: 8px;
            padding: 7px 14px;
            font-size: 12px;
            font-weight: 700;
            text-decoration: none;
            white-space: nowrap;
            flex-shrink: 0;
            cursor: pointer;
          }
          .draft-screen-back-btn:hover {
            background: #FAC775;
          }
        }
        /* À l'impression : on cache le bandeau écran + le bouton imprimer */
        @media print {
          .print-btn { display: none !important; }
          .draft-screen-banner { display: none !important; }
        }

        /* ═══ FILIGRANE BROUILLON ═══
           SVG répété en background sur le wrapper du document.
           print-color-adjust: exact (hérité de body) → sort à l'imprimante. */
        .doc-wrap {
          background-color: white;
          background-image: ${watermarkUrl};
          background-repeat: repeat;
          background-position: 0 0;
        }

        .doc-header { display: flex; justify-content: space-between; gap: 20px; margin-bottom: 6mm; width: 100%; }
        .doc-header-left { flex: 0 0 46%; }
        .doc-header-right { flex: 0 0 50%; }
        .doc-logo { max-width: 175px; max-height: 65px; object-fit: contain; display: block; margin-bottom: 10px; }
        .doc-type { font-size: 26px; font-weight: 400; color: ${THEME}; margin-bottom: 8px; line-height: 1.1; }
        .doc-meta-table { border-collapse: collapse; width: 100%; }
        .doc-meta-table td { padding: 1px 6px 1px 0; vertical-align: top; font-size: 12px; line-height: 1.35; }
        .doc-meta-label { font-weight: 700; color: ${BLACK}; white-space: nowrap; width: 44%; }
        .doc-addr-window { padding: 10px 14px 10px 20px; min-height: 58mm; background: rgba(255,255,255,0.7); }
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
        .doc-table { width: 100%; border-collapse: collapse; margin-bottom: 6mm; background: rgba(255,255,255,0.85); }
        .doc-table thead th { padding: 7px 4px; border-top: 2px solid ${THEME}; border-bottom: 2px solid ${THEME}; font-weight: 700; font-size: 12px; color: ${BLACK}; background: rgba(255,255,255,0.95); }
        .doc-table thead th.th-left { text-align: left; }
        .doc-table thead th.th-center { text-align: center; }
        .doc-table thead th.th-right { text-align: right; }
        .doc-table tbody tr td { padding: 8px 4px; border-bottom: 1px solid #efefef; vertical-align: top; font-size: 12px; }
        .doc-table tbody tr:nth-child(odd) td { background: ${LIGHT}; }
        .td-img { width: 56px; vertical-align: middle; text-align: center; }
        .td-img img { max-width: 52px; max-height: 52px; object-fit: contain; }
        .td-desc { padding-left: 8px !important; }
        .tr-media td { text-align: center !important; }
        .media-small  { max-height: 22px !important; max-width: 80px !important; width: auto !important; height: auto !important; object-fit: contain !important; display: inline-block !important; }
        .media-medium { max-height: 50px !important; max-width: 180px !important; width: auto !important; height: auto !important; object-fit: contain !important; display: inline-block !important; }
        .media-large  { max-height: 110px !important; max-width: 350px !important; width: auto !important; height: auto !important; object-fit: contain !important; display: inline-block !important; }
        .media-img-small  { max-height: 80px !important; max-width: 200px !important; width: auto !important; height: auto !important; object-fit: contain !important; display: inline-block !important; }
        .media-img-medium { max-height: 180px !important; max-width: 400px !important; width: auto !important; height: auto !important; object-fit: contain !important; display: inline-block !important; }
        .media-img-large  { max-height: 320px !important; max-width: 700px !important; width: auto !important; height: auto !important; object-fit: contain !important; display: inline-block !important; }
        .td-center { text-align: center; vertical-align: middle; white-space: nowrap; }
        .td-right { text-align: right; vertical-align: middle; white-space: nowrap; }
        .td-total { text-align: right; vertical-align: middle; white-space: nowrap; font-weight: 700; color: ${BLACK}; }
        .item-title { font-weight: 700; color: ${BLACK}; line-height: 1.35; }
        .item-sku { font-size: 11px; color: #777; margin-top: 2px; font-weight: 400; }
        .item-discount { font-size: 11px; color: #2a8a2a; margin-top: 3px; }
        .tr-comment td { background: #eef4fb !important; }
        .td-comment { padding: 6px 10px !important; font-style: italic; color: #445 !important; font-size: 12px; }
        .doc-bottom-wrap {
          display: flex;
          gap: 20px;
          margin-bottom: 8mm;
          align-items: flex-end;
          page-break-inside: avoid;
          break-inside: avoid;
        }
        .doc-notes-sign-col { flex: 1; display: flex; flex-direction: column; justify-content: flex-end; }
        .doc-totals-col { flex: 0 0 44%; }
        .doc-notes-title { font-weight: 700; color: ${BLACK}; margin-bottom: 5px; font-size: 12px; }
        .doc-notes-text { font-size: 12px; color: ${GREY}; line-height: 1.55; white-space: pre-wrap; margin-bottom: 12px; }
        .doc-pricing { width: 100%; border-collapse: collapse; background: rgba(255,255,255,0.92); }
        .doc-pricing td { padding: 5px 4px; font-size: 12px; }
        .doc-pricing tr:nth-child(even) td { background: ${LIGHT}; }
        .doc-pricing .pt-label { font-weight: 600; color: ${BLACK}; }
        .doc-pricing .pt-sub { font-size: 11px; padding-left: 14px !important; color: #555; }
        .doc-pricing .pt-value { text-align: right; white-space: nowrap; color: ${BLACK}; }
        .doc-pricing .pt-tva td { color: #666; font-size: 11px; }
        .doc-pricing .pt-total td { border-top: 2px solid ${THEME} !important; border-bottom: 2px solid ${THEME} !important; padding: 8px 4px !important; }
        .pt-total-label { font-weight: 900 !important; font-size: 15px !important; color: ${BLACK} !important; }
        .pt-total-value { font-weight: 900 !important; font-size: 15px !important; color: ${BLACK} !important; text-align: right; white-space: nowrap; }
        .doc-thanks { text-align: center; font-weight: 700; color: ${THEME}; margin: 6mm 0 3px; font-size: 13px; }
        .doc-terms { text-align: center; font-size: 10px; color: #888; line-height: 1.5; margin-bottom: 6mm; }
        .doc-terms a { color: ${THEME}; }
        .doc-footer { border-top: 1px solid #ddd; padding-top: 6px; text-align: center; font-size: 11px; color: #666; line-height: 1.7; }
        .doc-footer strong { color: ${BLACK}; }
        .doc-footer-url { font-weight: 700; color: ${THEME}; }
        .doc-footer-social { margin-top: 5px; text-align: center; display: block; width: 100%; }
        .doc-footer-social img { width: 18px; height: 18px; margin: 0 4px; vertical-align: middle; display: inline-block; }
        .doc-ambiance-grid { display: flex; flex-wrap: wrap; gap: 14px; margin-bottom: 8mm; }
        .doc-ambiance-item { flex: 0 0 calc(50% - 7px); page-break-inside: avoid; break-inside: avoid; text-align: center; }
        .doc-ambiance-item img { max-width: 100%; max-height: 200px; object-fit: contain; display: block; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 4px; }
        .doc-ambiance-caption { font-size: 10px; color: #777; font-style: italic; margin-top: 5px; text-align: center; }
      `}</style>

      {/* ═══ BANDEAU ÉCRAN-ONLY ═══ */}
      <div className="draft-screen-banner">
        <a
          href={`/dashboard/draft/${draftSlug}`}
          className="draft-screen-back-btn"
        >
          ← Retour au brouillon
        </a>
        <div className="draft-screen-banner-text" style={{textAlign: "right", flex: 1}}>
          ⚠ Aperçu d&apos;un brouillon · Document non contractuel
          <small>Ne pas imprimer pour diffusion — utiliser le brouillon transformé en offre pour un document client.</small>
        </div>
      </div>

      {/* ═══ BOUTON IMPRIMER (écran only via @media print) ═══ */}
      <button className="print-btn" onClick={() => window.print()}>🖨 Imprimer quand même</button>

      <div className="doc-wrap">

        {/* HEADER */}
        <div className="doc-header">
          <div className="doc-header-left">
            <img className="doc-logo"
              src="https://cdn.shopify.com/s/files/1/0360/3251/2135/files/logo_JARDIN_CONFORT_shopify.jpg?v=1614107698"
              alt="Jardin-Confort" />
            <div className="doc-type">Brouillon</div>
            <table className="doc-meta-table">
              <tbody>
                <tr>
                  <td className="doc-meta-label">N° de brouillon</td>
                  <td>{numeroAffiche}</td>
                </tr>
                {data.reference && (
                  <tr><td className="doc-meta-label">Référence</td><td>{data.reference}</td></tr>
                )}
                <tr><td className="doc-meta-label">Date</td><td>{formatDate(data.date)}</td></tr>
                <tr><td className="doc-meta-label">Commercial</td><td>{data.commercial}</td></tr>
                <tr><td className="doc-meta-label">Mode de paiement</td><td>{data.paymentMode}</td></tr>
                {data.leadTime && (
                  <tr><td className="doc-meta-label">Délai de livraison</td><td>{data.leadTime}</td></tr>
                )}
                {(data as any).validiteDuree && (
                  <tr><td className="doc-meta-label">Validité de l&apos;offre</td><td>{(data as any).validiteDuree}</td></tr>
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
              <div className="doc-addr-ref">{numeroAffiche}</div>
              {data.societe && <div className="doc-addr-line">{data.societe}</div>}
              <div className="doc-addr-name">{data.nom} {data.prenom}</div>
              {data.complement_nom && <div className="doc-addr-line">{data.complement_nom}</div>}
              {data.rue && <div className="doc-addr-line">{data.rue} {data.numero}</div>}
              {data.npa && <div className="doc-addr-line">{data.npa} {data.ville}</div>}
              {data.telephone1 && <div className="doc-addr-line" style={{marginTop:8, fontSize:16}}>Tél. {data.telephone1}</div>}
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
                  {data.complement_nom && <div>{data.complement_nom}</div>}
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
                      {data.livr_complement_nom && <div>{data.livr_complement_nom}</div>}
                      {data.livrRue && <div>{data.livrRue} {data.livrNumero}</div>}
                      {data.livrNpa && <div>{data.livrNpa} {data.livrVille}</div>}
                      {data.livrTel && <div>Tél. {data.livrTel}</div>}
                    </>
                  ) : (
                    <>
                      {data.societe && <div>{data.societe}</div>}
                      <div style={{fontWeight:700}}>{data.nom} {data.prenom}</div>
                      {data.complement_nom && <div>{data.complement_nom}</div>}
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

        {/* TABLEAU ARTICLES — SANS badge stock (brouillon ≠ stock live) */}
        <table className="doc-table">
          <thead>
            <tr>
              <th style={{width:56}}></th>
              <th className="th-left">Description de l&apos;article</th>
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
              if (line.type === "media") {
                if (!(line as any).mediaUrl) return null;
                const mSize = (line as any).mediaSize;
                const mSource = (line as any).mediaSource;
                const prefix = mSource === "upload" ? "media-img-" : "media-";
                const sizeClass = mSize === "small" ? prefix + "small" : mSize === "large" ? prefix + "large" : prefix + "medium";
                return (
                  <tr key={line.id} className="tr-media">
                    <td colSpan={5}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={(line as any).mediaUrl} alt={line.title || ""} className={sizeClass} />
                    </td>
                  </tr>
                );
              }
              const lineTotal = line.qty * line.unitPrice - (line.lineDiscount || 0);
              return (
                <tr key={line.id}>
                  <td className="td-img">{line.image && <img src={line.image} alt="" />}</td>
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

        {/* NOTES + TOTAUX — SANS bloc signature */}
        <div className="doc-bottom-wrap">
          <div className="doc-notes-sign-col">
            {data.remarks && (
              <>
                <div className="doc-notes-title">Notes</div>
                <div className="doc-notes-text">{data.remarks}</div>
              </>
            )}
          </div>

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
                    <tr>
                      <td className="pt-label">Services</td>
                      <td className="pt-value" style={{fontSize:11, fontStyle:"italic", color:"#888"}}>inclus</td>
                    </tr>
                    {activeServices.map((srv, i) => (
                      <tr key={i}>
                        <td className="pt-label pt-sub">↳ {srv.label}</td>
                        <td className="pt-value" style={{fontSize:11}}>
                          {srv.amount === 0 ? "Offert" : formatMoney(srv.amount)}
                        </td>
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
                  <td className="pt-total-label">TOTAL {isPrivateTTC ? "TTC" : "HT + TVA"} (indicatif)</td>
                  <td className="pt-total-value">{formatMoney(finalTotal)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* PAS de bloc lien validation / QR code → spécifique aux offres */}

        {/* MENTION BROUILLON sous les totaux */}
        <p className="doc-thanks" style={{color: AMBER}}>
          📝 Document préliminaire — cette version est un brouillon non contractuel.
        </p>
        <p className="doc-terms">
          Les quantités, articles, prix et frais mentionnés sont indicatifs et peuvent
          évoluer avant émission de l&apos;offre définitive. Aucun engagement contractuel
          n&apos;est pris sur la base de ce document.<br/>
          L&apos;offre définitive sera émise après validation et fera seule foi.
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

        {/* IMAGES D'AMBIANCE — à la suite sans saut de page */}
        {data.ambianceImages.length > 0 && (
          <div style={{marginTop: "8mm"}}>
            <div style={{
              display: "flex",
              alignItems: "flex-end",
              gap: 16,
              marginBottom: "5mm",
              borderBottom: `2px solid ${THEME}`,
              paddingBottom: "4mm",
            }}>
              <img style={{maxWidth:130, maxHeight:50, objectFit:"contain"}}
                src="https://cdn.shopify.com/s/files/1/0360/3251/2135/files/logo_JARDIN_CONFORT_shopify.jpg?v=1614107698"
                alt="Jardin-Confort" />
              <div>
                <div style={{fontSize:18, fontWeight:700, color:THEME}}>
                  Images d&apos;illustration — {numeroAffiche}
                </div>
                <div style={{fontSize:11, color:"#aaa", fontStyle:"italic", marginTop:2}}>
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
          </div>
        )}

      </div>
    </>
  );
}