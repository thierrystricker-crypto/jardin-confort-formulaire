"use client";
// ═══════════════════════════════════════════════════════════════
//  app/print/all/[slug]/page.tsx
//  Template d'impression GROUPÉE — Le Jeu Complet (4 pages)
//
//  ORDRE :
//    Page 1 — Fiche de travail (initiale, stock figé)
//    Page 2 — Commande client (avec prix + images d'ambiance)
//    Page 3 — Page de garde colis (A4 logo + adresse)
//    Page 4 — Bulletin de livraison (sans prix)
//    Page 5 — Fiche bleue archive (1 page A4, dégradé bleu)
//
//  Ce fichier reproduit FIDÈLEMENT les 4 templates existants :
//    - app/print/fiche-travail/[slug]/page.tsx       (préfixe .ft-)
//    - app/print/offre/[slug]/page.tsx               (préfixe .cc-)
//    - app/print/page-garde-colis/[slug]/page.tsx    (préfixe .pg-)
//    - app/print/bulletin-livraison/[slug]/page.tsx  (préfixe .bl-)
//
//  Auto-print après 1500ms (laisse les images charger).
// ═══════════════════════════════════════════════════════════════

import React, { useEffect, useState, useRef } from "react";
import {
  PrintData, QuoteLine, AmbianceImage,
  serviceOptions, formatMoney, formatDate,
  computeTotals,
} from "@/lib/jc-print-types";

const THEME  = "#2b8ad1";
const BLACK  = "#000000";
const GREY   = "#333333";
const LIGHT  = "#f9f9f9";
const ORANGE = "#e67e22";
const QTY_HIGHLIGHT = "#dc2626";

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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

function formatDateTime() {
  return new Date().toLocaleString("fr-CH", {
    day: "2-digit", month: "2-digit", year: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function PrintAllPage({ params }: { params: Promise<{ slug: string }> }) {
  const [mounted, setMounted] = useState(false);
  const [data, setData] = useState<PrintData>(EMPTY);
  const [ready, setReady] = useState(false);
  const [numeroAffiche, setNumeroAffiche] = useState("");
  const [offreSlug, setOffreSlug] = useState("");
  const [dateDocument, setDateDocument] = useState<string>("");
  const [typeDocument, setTypeDocument] = useState<string>("Commande");
  const [printedAt, setPrintedAt] = useState("");
  const barcodesRendered = useRef(false);

  // ─── Mount côté client uniquement (évite erreur hydratation #418) ───
  useEffect(() => {
    setMounted(true);
    setPrintedAt(formatDateTime());
  }, []);

  // ─── Charge les données une seule fois ───
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
            setOffreSlug(slug);
            setDateDocument(json.offre?.date_document || offreData.date || "");
            setTypeDocument(json.offre?.type_document || offreData.formType || "Commande");
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

  // ─── Génère codes-barres + QR pour la page Fiche de travail ───
  useEffect(() => {
    if (!ready || barcodesRendered.current) return;
    if (data.lines.length === 0 && !numeroAffiche) return;

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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const JsBarcode = (window as any).JsBarcode;
      if (JsBarcode) {
        document.querySelectorAll<HTMLElement>(".barcode-sku-all").forEach((el) => {
          const sku = el.getAttribute("data-sku");
          if (!sku) return;
          try {
            JsBarcode(el, sku, {
              format: "CODE128", width: 1.5, height: 22,
              displayValue: false, margin: 0, lineColor: "#000000",
            });
          } catch (e) { console.warn("Barcode error:", sku, e); }
        });
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const qrcode = (window as any).qrcode;
      if (qrcode && numeroAffiche) {
        const qrEl = document.getElementById("qr-commande-all");
        if (qrEl) {
          const qr = qrcode(0, "M");
          qr.addData(numeroAffiche); qr.make();
          qrEl.innerHTML = qr.createImgTag(3, 0);
        }
      }
      if (qrcode && data.nom) {
        const qrClientEl = document.getElementById("qr-client-all");
        if (qrClientEl) {
          const refValue = `${data.nom} Mag`;
          const qr2 = qrcode(0, "M");
          qr2.addData(refValue); qr2.make();
          qrClientEl.innerHTML = qr2.createImgTag(3, 0);
        }
      }
      barcodesRendered.current = true;
    }).catch((err) => console.error("Erreur chargement librairies barcode:", err));
  }, [ready, data.lines, data.nom, numeroAffiche]);

  // Pas de SSR : on attend le mount côté client pour tout rendre
  if (!mounted || !ready) {
    return (
      <div style={{padding:40, textAlign:"center", color:GREY, fontFamily:"sans-serif"}}>
        Chargement du jeu complet…
      </div>
    );
  }

  const totals = computeTotals(data);
  const {
    isPrivateTTC, subTotal, discountValue, serviceTotal,
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

  const activeServicesNoPrice = [
    ...serviceOptions
      .filter((s) => data.enabledServices[s.code])
      .map((s) => ({ label: s.label })),
    ...(data.enabledServices["custom"]
      ? [{ label: data.servicePrices["custom_label"] || "Service personnalisé" }]
      : []),
  ];

  const validationUrl = `https://offres.jardin-confort.ch/offre/${offreSlug || numeroAffiche.toLowerCase().replace(/\s+/g, "-")}`;

  // Variables fiche de travail
  const livrSocieteFT = data.livrDiff ? data.livrSociete : data.societe;
  const livrNomFT     = data.livrDiff ? data.livrNom     : data.nom;
  const livrPrenomFT  = data.livrDiff ? data.livrPrenom  : data.prenom;
  const livrComplementNomFTeff = data.livrDiff ? data.livr_complement_nom : data.complement_nom;
  const livrRueFT     = data.livrDiff ? data.livrRue     : data.rue;
  const livrNumeroFT  = data.livrDiff ? data.livrNumero  : data.numero;
  const livrNpaFT     = data.livrDiff ? data.livrNpa     : data.npa;
  const livrVilleFT   = data.livrDiff ? data.livrVille   : data.ville;
  const livrTelFTeff = (data.livrDiff && data.livrTel) ? data.livrTel : data.telephone1;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isPickup = (data as any).deliveryMode === "À l'emporter";
  const totalQty = data.lines.reduce((s, l) => (l.type === "comment" || l.type === "media") ? s : s + l.qty, 0);
  const numeroLabel = typeDocument === "Offre" ? "N° d'offre" : "N° de commande";
  const dateLabel = typeDocument === "Offre" ? "Date offre" : "Date commande";

  // Variables page de garde
  const showLivrDiffPG = !isPickup && data.livrDiff;
  const pgSociete = showLivrDiffPG ? data.livrSociete : data.societe;
  const pgNom     = showLivrDiffPG ? data.livrNom     : data.nom;
  const pgPrenom  = showLivrDiffPG ? data.livrPrenom  : data.prenom;
  const pgComplementNom = showLivrDiffPG ? data.livr_complement_nom : data.complement_nom;
  const pgRue     = showLivrDiffPG ? data.livrRue     : data.rue;
  const pgNumero  = showLivrDiffPG ? data.livrNumero  : data.numero;
  const pgNpa     = showLivrDiffPG ? data.livrNpa     : data.npa;
  const pgVille   = showLivrDiffPG ? data.livrVille   : data.ville;

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
          .doc-wrap-all {
            max-width: 794px; margin: 0 auto; padding: 20px 28px;
            box-shadow: 0 0 20px rgba(0,0,0,0.08); background: white;
          }
          .doc-wrap-all + .doc-wrap-all {
            margin-top: 30px; border-top: 4px dashed #ccc; padding-top: 40px;
          }
          .print-btn-all {
            position: fixed; top: 16px; right: 16px; z-index: 100;
            background: ${THEME}; color: white; border: 0;
            padding: 12px 24px; border-radius: 6px;
            font-size: 14px; font-weight: 700; cursor: pointer;
            box-shadow: 0 2px 8px rgba(0,0,0,0.15);
          }
          .print-btn-all:hover { background: #1e6fa8; }
          .printall-info {
            position: fixed; top: 16px; left: 16px; z-index: 100;
            background: white; color: ${BLACK};
            padding: 8px 14px; border-radius: 6px;
            font-size: 12px; font-weight: 600;
            box-shadow: 0 2px 8px rgba(0,0,0,0.15);
            border: 1px solid #d1d5db;
          }
        }
        @media print {
          .print-btn-all, .printall-info { display: none !important; }
          .doc-wrap-all { box-shadow: none; padding: 0; max-width: 100%; }
          .doc-wrap-all + .doc-wrap-all { border-top: none; margin-top: 0; padding-top: 0; }
          .page-break { page-break-before: always; }
        }
        .page-break { page-break-before: always; }

        /* ════════════════════════════════════════════════════════════════════ */
        /* ═══ STYLES FICHE DE TRAVAIL (page 1) — préfixe .ft- ═══════════════ */
        /* ════════════════════════════════════════════════════════════════════ */
        .ft-banner { background: ${THEME}; color: white; padding: 5px 12px; margin-bottom: 3mm; border-radius: 4px; display: flex; justify-content: space-between; align-items: center; font-size: 12px; font-weight: 700; letter-spacing: 0.05em; }
        .ft-banner-printed { font-size: 10px; font-weight: 400; opacity: 0.9; }
        .ft-header { display: flex; justify-content: space-between; gap: 10px; margin-bottom: 3mm; align-items: flex-start; }
        .ft-header-left { flex: 0 0 42%; }
        .ft-header-qr { flex: 0 0 80px; display: flex; flex-direction: column; align-items: center; padding-top: 2px; }
        .ft-header-qr img { display: block; }
        .ft-header-qr .ft-qr-second { margin-top: 6px; }
        .ft-qr-label { font-size: 8px; color: #666; margin-top: 2px; letter-spacing: 0.04em; text-transform: uppercase; text-align: center; }
        .ft-header-right { flex: 1; min-width: 0; }
        .ft-logo { max-width: 150px; max-height: 52px; object-fit: contain; display: block; margin-bottom: 4px; }
        .ft-type { font-size: 22px; font-weight: 400; color: ${THEME}; margin-bottom: 4px; line-height: 1.05; letter-spacing: 0; text-transform: none; }
        .ft-meta-table { border-collapse: collapse; width: 100%; }
        .ft-meta-table td { padding: 1px 6px 1px 0; vertical-align: top; font-size: 11px; line-height: 1.3; }
        .ft-meta-label { font-weight: 700; color: ${BLACK}; white-space: nowrap; width: 50%; }
        .ft-addr-window { padding: 8px 12px 9px 14px; background: white; border: 2px solid ${THEME}; border-radius: 6px; }
        .ft-addr-window-title { display: inline-block; background: ${THEME}; color: white; padding: 2px 8px; border-radius: 3px; font-size: 10px; font-weight: 700; letter-spacing: 0.06em; margin-bottom: 5px; text-transform: uppercase; }
        .ft-addr-ref { font-size: 10.5px; color: #666; font-weight: 400; margin-bottom: 3px; }
        .ft-addr-name { font-size: 16px; font-weight: 700; color: ${BLACK}; line-height: 1.25; margin-bottom: 2px; }
        .ft-addr-line { font-size: 14px; color: ${BLACK}; line-height: 1.3; font-weight: 400; }
        .ft-addr-tel { margin-top: 3px; font-size: 12.5px; font-weight: 600; }
        .ft-addr-email { font-size: 11.5px; color: #555; }
        .ft-pickup-badge { display: inline-block; background: ${ORANGE}; color: white; padding: 4px 10px; border-radius: 4px; font-size: 12px; font-weight: 800; margin-bottom: 5px; letter-spacing: 0.05em; }
        .ft-remarks-top { margin-bottom: 4mm; background: linear-gradient(90deg, #fef3c7 0%, #fef9c3 100%); border: 2px solid #f59e0b; border-radius: 6px; padding: 10px 14px; page-break-inside: avoid; }
        .ft-remarks-top-title { display: inline-block; background: #f59e0b; color: white; padding: 3px 10px; border-radius: 3px; font-size: 11px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; margin-bottom: 6px; }
        .ft-remarks-top-text { font-size: 12px; color: #1f2937; line-height: 1.55; white-space: pre-wrap; font-weight: 500; }
        .ft-acces { margin-bottom: 4mm; background: linear-gradient(90deg, #f3e8ff 0%, #ede9fe 100%); border: 2px solid #8b5cf6; border-radius: 6px; padding: 10px 14px; page-break-inside: avoid; }
        .ft-acces-title { display: inline-block; background: #8b5cf6; color: white; padding: 3px 10px; border-radius: 3px; font-size: 11px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; margin-bottom: 6px; }
        .ft-acces-text { font-size: 12px; color: #1f2937; line-height: 1.55; white-space: pre-wrap; font-weight: 500; }
        .ft-table { width: 100%; border-collapse: collapse; margin-bottom: 3mm; }
        .ft-table thead th { padding: 6px 4px; border-top: 2px solid ${THEME}; border-bottom: 2px solid ${THEME}; font-weight: 700; font-size: 11px; color: ${BLACK}; text-transform: uppercase; letter-spacing: 0.04em; }
        .ft-table thead th.ft-th-left { text-align: left; }
        .ft-table thead th.ft-th-center { text-align: center; }
        .ft-table thead th.ft-th-right { text-align: right; }
        .ft-table tbody tr td { padding: 5px 4px; border-bottom: 1px solid #d1d5db; vertical-align: middle; font-size: 11.5px; }
        .ft-table tbody tr.ft-row-product:nth-child(even) td { background: ${LIGHT}; }
        .ft-td-img { width: 56px; vertical-align: middle; text-align: center; }
        .ft-td-img img { max-width: 50px; max-height: 50px; object-fit: contain; }
        .ft-td-img-placeholder { width: 50px; height: 50px; margin: 0 auto; border: 1px dashed #d1d5db; border-radius: 4px; display: flex; align-items: center; justify-content: center; font-size: 18px; color: #9ca3af; }
        .ft-td-circles { width: 54px; text-align: center; }
        .ft-td-qty { width: 60px; text-align: center; vertical-align: middle; }
        .ft-td-stock { width: 78px; text-align: center; vertical-align: middle; }
        .ft-td-price { width: 70px; text-align: right; vertical-align: middle; }
        .ft-td-total { width: 78px; text-align: right; vertical-align: middle; font-weight: 700; }
        .ft-td-desc { padding-left: 6px !important; }
        .ft-check-circle { display: inline-block; width: 11px; height: 11px; border: 1.4px solid #000; border-radius: 50%; margin: 0 1px; vertical-align: middle; }
        .ft-check-circles-labels { display: block; font-size: 6.5px; color: #555; letter-spacing: 0.04em; margin-top: 2px; font-weight: 600; }
        .ft-qty-num { font-size: 24px; font-weight: 400; color: ${BLACK}; line-height: 1; }
        .ft-qty-num-multi { color: ${QTY_HIGHLIGHT}; font-weight: 700; }
        .ft-qty-x { font-size: 13px; color: #777; margin-left: 1px; }
        .ft-item-title { font-weight: 700; color: ${BLACK}; line-height: 1.3; font-size: 12px; }
        .ft-item-sku-text { font-size: 10px; color: #555; margin-top: 1px; font-weight: 400; }
        .ft-item-no-sku { display: inline-block; font-size: 9px; color: #92400e; background: #fef3c7; padding: 1px 6px; border-radius: 3px; margin-top: 2px; font-weight: 700; letter-spacing: 0.03em; text-transform: uppercase; }
        .ft-item-barcode { margin-top: 3px; }
        .ft-item-barcode svg { display: block; max-width: 100%; }
        .ft-item-custom-badge { display: inline-block; font-size: 9px; color: #1e40af; background: #dbeafe; padding: 1px 6px; border-radius: 3px; margin-right: 5px; font-weight: 700; letter-spacing: 0.03em; text-transform: uppercase; vertical-align: middle; }
        .ft-stock-ok    { color: #2C7E3F; font-weight: 700; font-size: 12px; }
        .ft-stock-low   { color: ${ORANGE}; font-weight: 700; font-size: 12px; }
        .ft-stock-cmd   { color: #dc2626; font-weight: 700; font-size: 11px; }
        .ft-stock-na    { color: #999; font-style: italic; font-size: 11px; }
        .ft-stock-date  { display: block; font-size: 9px; color: #777; font-weight: 400; margin-top: 1px; }
        .ft-price-val { font-size: 11.5px; color: ${BLACK}; }
        .ft-line-discount { font-size: 10px; color: #2a8a2a; margin-top: 1px; }
        .ft-tr-comment td { background: #eef4fb !important; padding: 8px 12px !important; font-style: italic; color: #1e3a5f !important; font-size: 12px; font-weight: 600; border-left: 3px solid ${THEME} !important; }
        .ft-bottom-wrap { display: flex; gap: 14px; margin-bottom: 4mm; align-items: stretch; }
        .ft-notes-col { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
        .ft-totals-col { flex: 0 0 46%; }
        .ft-notes-bottom-title { font-weight: 700; color: #555; margin-bottom: 4px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
        .ft-notes-bottom-text { font-size: 11px; color: #555; line-height: 1.55; font-style: italic; }
        .ft-pricing { width: 100%; border-collapse: collapse; }
        .ft-pricing td { padding: 5px 4px; font-size: 11.5px; border-bottom: 1px solid #efefef; }
        .ft-pricing tr:nth-child(even) td { background: ${LIGHT}; }
        .ft-pt-label { font-weight: 600; color: ${BLACK}; }
        .ft-pt-sub { font-size: 10.5px; padding-left: 14px !important; color: #555; font-weight: 400; }
        .ft-pt-value { text-align: right; white-space: nowrap; color: ${BLACK}; }
        .ft-pt-tva td { color: #666; font-size: 10.5px; }
        .ft-pt-total td { border-top: 2px solid ${THEME} !important; border-bottom: 2px solid ${THEME} !important; padding: 7px 4px !important; background: rgba(43, 138, 209, 0.08) !important; }
        .ft-pt-total-label { font-weight: 900 !important; font-size: 14px !important; color: ${BLACK} !important; }
        .ft-pt-total-value { font-weight: 900 !important; font-size: 14px !important; color: ${BLACK} !important; text-align: right; white-space: nowrap; }
        .ft-pt-fillable td { padding: 14px 4px !important; background: #fffbea !important; border-bottom: 1px dashed #f59e0b !important; }
        .ft-pt-fillable .ft-pt-value { text-align: right; padding-right: 6px !important; }
        .ft-pt-paymentmode td { background: #f3f4f6 !important; font-size: 10.5px !important; padding: 6px 4px !important; }
        .ft-billing-block { background: #f3f4f6; border: 1px solid #d1d5db; border-radius: 6px; padding: 8px 12px 9px; }
        .ft-billing-block-title { font-size: 10px; font-weight: 700; color: #555; letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 4px; padding-bottom: 3px; border-bottom: 1px solid #d1d5db; }
        .ft-billing-block-content { font-size: 11.5px; color: ${BLACK}; line-height: 1.4; }
        .ft-billing-name { font-weight: 700; font-size: 12.5px; margin: 1px 0; }
        .ft-billing-contact { margin-top: 3px; font-size: 10.5px; color: #555; display: flex; gap: 10px; flex-wrap: wrap; }
        .ft-final-sign { margin-top: auto; border: 2px solid #000; border-radius: 4px; padding: 12px 14px 14px; page-break-inside: avoid; background: #f0faf2; }
        .ft-final-sign-text { font-size: 11.5px; font-weight: 700; color: ${BLACK}; letter-spacing: 0.03em; text-transform: uppercase; margin-bottom: 14px; text-align: center; }
        .ft-final-sign-row { display: flex; gap: 18px; align-items: flex-end; }
        .ft-final-sign-field { flex: 0 0 32%; }
        .ft-final-sign-field-large { flex: 1; }
        .ft-final-sign-line { height: 26px; border-bottom: 1.5px solid #555; }
        .ft-final-sign-label { font-size: 9.5px; color: #555; margin-top: 2px; text-transform: uppercase; letter-spacing: 0.05em; text-align: left; }

        /* ════════════════════════════════════════════════════════════════════ */
        /* ═══ STYLES COMMANDE CLIENT (page 2) — préfixe .cc- ═══════════════ */
        /* ═══ Reproduit fidèlement app/print/offre/[slug]/page.tsx ═══════════ */
        /* ════════════════════════════════════════════════════════════════════ */
        .cc-header { display: flex; justify-content: space-between; gap: 20px; margin-bottom: 6mm; width: 100%; }
        .cc-header-left { flex: 0 0 46%; }
        .cc-header-right { flex: 0 0 50%; }
        .cc-logo { max-width: 175px; max-height: 65px; object-fit: contain; display: block; margin-bottom: 10px; }
        .cc-type { font-size: 26px; font-weight: 400; color: ${THEME}; margin-bottom: 8px; line-height: 1.1; }
        .cc-meta-table { border-collapse: collapse; width: 100%; }
        .cc-meta-table td { padding: 1px 6px 1px 0; vertical-align: top; font-size: 12px; line-height: 1.35; }
        .cc-meta-label { font-weight: 700; color: ${BLACK}; white-space: nowrap; width: 44%; }
        .cc-addr-window { padding: 10px 14px 10px 20px; min-height: 58mm; background: white; }
        .cc-addr-ref { font-size: 12px; color: #666; font-weight: 400; margin-bottom: 8px; }
        .cc-addr-name { font-size: 19px; font-weight: 700; color: ${BLACK}; line-height: 1.3; margin-bottom: 4px; }
        .cc-addr-line { font-size: 19px; color: ${BLACK}; line-height: 1.3; font-weight: 400; }
        .cc-hr { border: 0; border-top: 2px solid ${THEME}; margin: 4mm 0; width: 100%; }
        .cc-addresses { display: table; width: 100%; margin-bottom: 6mm; border-collapse: collapse; }
        .cc-addr-row { display: table-row; }
        .cc-addr-group { display: table-cell; width: 50%; vertical-align: top; padding-right: 10px; }
        .cc-addr-inner { display: flex; gap: 0; }
        .cc-addr-title { font-size: 12px; font-weight: 700; color: ${THEME}; white-space: nowrap; padding-right: 12px; padding-top: 1px; min-width: 110px; flex-shrink: 0; display: block; }
        .cc-addr-content { font-size: 12px; line-height: 1.6; color: ${BLACK}; flex: 1; }
        .cc-table { width: 100%; border-collapse: collapse; margin-bottom: 6mm; }
        .cc-table thead th { padding: 7px 4px; border-top: 2px solid ${THEME}; border-bottom: 2px solid ${THEME}; font-weight: 700; font-size: 12px; color: ${BLACK}; }
        .cc-table thead th.cc-th-left { text-align: left; }
        .cc-table thead th.cc-th-center { text-align: center; }
        .cc-table thead th.cc-th-right { text-align: right; }
        .cc-table tbody tr td { padding: 8px 4px; border-bottom: 1px solid #efefef; vertical-align: top; font-size: 12px; }
        .cc-table tbody tr:nth-child(odd) td { background: ${LIGHT}; }
        .cc-td-img { width: 56px; vertical-align: middle; text-align: center; }
        .cc-td-img img { max-width: 52px; max-height: 52px; object-fit: contain; }
        .cc-td-desc { padding-left: 8px !important; }
        .cc-td-center { text-align: center; vertical-align: middle; white-space: nowrap; }
        .cc-td-right { text-align: right; vertical-align: middle; white-space: nowrap; }
        .cc-td-total { text-align: right; vertical-align: middle; white-space: nowrap; font-weight: 700; color: ${BLACK}; }
        .cc-item-title { font-weight: 700; color: ${BLACK}; line-height: 1.35; }
        .cc-item-sku { font-size: 11px; color: #777; margin-top: 2px; font-weight: 400; }
        .cc-item-discount { font-size: 11px; color: #2a8a2a; margin-top: 3px; }
        .cc-tr-comment td { background: #eef4fb !important; }
        .cc-td-comment { padding: 6px 10px !important; font-style: italic; color: #445 !important; font-size: 12px; }
        .cc-bottom-wrap { display: flex; gap: 20px; margin-bottom: 8mm; align-items: flex-end; page-break-inside: avoid; break-inside: avoid; }
        .cc-notes-sign-col { flex: 1; display: flex; flex-direction: column; justify-content: flex-end; }
        .cc-totals-col { flex: 0 0 44%; }
        .cc-notes-title { font-weight: 700; color: ${BLACK}; margin-bottom: 5px; font-size: 12px; }
        .cc-notes-text { font-size: 12px; color: ${GREY}; line-height: 1.55; white-space: pre-wrap; margin-bottom: 12px; }
        .cc-sign-block { margin-top: auto; background: #f0faf2; border: 1.5px solid #a7d9b0; border-radius: 10px; padding: 14px 18px 12px; page-break-inside: avoid; break-inside: avoid; }
        .cc-sign-name { font-weight: 700; color: ${BLACK}; font-size: 12px; margin-bottom: 24px; }
        .cc-sign-line { border-bottom: 1.5px solid #5a9e6a; margin-bottom: 5px; }
        .cc-sign-sub { font-size: 10px; color: #5a9e6a; font-style: italic; }
        .cc-pricing { width: 100%; border-collapse: collapse; }
        .cc-pricing td { padding: 5px 4px; font-size: 12px; }
        .cc-pricing tr:nth-child(even) td { background: ${LIGHT}; }
        .cc-pt-label { font-weight: 600; color: ${BLACK}; }
        .cc-pt-sub { font-size: 11px; padding-left: 14px !important; color: #555; }
        .cc-pt-value { text-align: right; white-space: nowrap; color: ${BLACK}; }
        .cc-pt-tva td { color: #666; font-size: 11px; }
        .cc-pt-total td { border-top: 2px solid ${THEME} !important; border-bottom: 2px solid ${THEME} !important; padding: 8px 4px !important; }
        .cc-pt-total-label { font-weight: 900 !important; font-size: 15px !important; color: ${BLACK} !important; }
        .cc-pt-total-value { font-weight: 900 !important; font-size: 15px !important; color: ${BLACK} !important; text-align: right; white-space: nowrap; }
        .cc-thanks { text-align: center; font-weight: 700; color: ${THEME}; margin: 6mm 0 3px; font-size: 13px; }
        .cc-terms { text-align: center; font-size: 10px; color: #888; line-height: 1.5; margin-bottom: 6mm; }
        .cc-terms a { color: ${THEME}; }
        .cc-footer { border-top: 1px solid #ddd; padding-top: 6px; text-align: center; font-size: 11px; color: #666; line-height: 1.7; }
        .cc-footer strong { color: ${BLACK}; }
        .cc-footer-url { font-weight: 700; color: ${THEME}; }
        .cc-footer-social { margin-top: 5px; text-align: center; display: block; width: 100%; }
        .cc-footer-social img { width: 18px; height: 18px; margin: 0 4px; vertical-align: middle; display: inline-block; }
        .cc-ambiance-grid { display: flex; flex-wrap: wrap; gap: 14px; margin-bottom: 8mm; }
        .cc-ambiance-item { flex: 0 0 calc(50% - 7px); page-break-inside: avoid; break-inside: avoid; text-align: center; }
        .cc-ambiance-item img { max-width: 100%; max-height: 200px; object-fit: contain; display: block; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 4px; }
        .cc-ambiance-caption { font-size: 10px; color: #777; font-style: italic; margin-top: 5px; text-align: center; }

        /* ════════════════════════════════════════════════════════════════════ */
        /* ═══ STYLES PAGE DE GARDE COLIS (page 3) — préfixe .pg- ═══════════ */
        /* ═══ Reproduit fidèlement app/print/page-garde-colis/[slug]/page.tsx ═ */
        /* ════════════════════════════════════════════════════════════════════ */
        .pg-wrap { position: relative; padding: 30px 30px 0 30px; }
        @media screen { .pg-wrap { min-height: 1000px; } }
        @media print { .pg-wrap { padding: 30px 30px 0 30px; } }
        .pg-top-row { display: flex; justify-content: space-between; align-items: flex-start; margin-top: 8mm; gap: 20px; }
        .pg-return-block { display: flex; gap: 18px; align-items: flex-start; flex: 0 0 auto; }
        .pg-return-logo { max-width: 320px; max-height: 200px; object-fit: contain; }
        .pg-client-addr {
          flex: 1 1 auto;
          padding: 12px 24px;
          min-width: 90mm;
          max-width: 100%;
          margin-top: 30mm;
          word-wrap: break-word;
          overflow-wrap: break-word;
          word-break: break-word;
        }
        .pg-client-addr-line {
          font-size: 22px;
          color: ${BLACK};
          line-height: 1.35;
          font-weight: 400;
          word-wrap: break-word;
          overflow-wrap: break-word;
          word-break: break-word;
          max-width: 100%;
        }
        .pg-client-addr-name {
          font-size: 24px;
          font-weight: 700;
          color: ${BLACK};
          line-height: 1.3;
          margin-bottom: 2px;
          word-wrap: break-word;
          overflow-wrap: break-word;
          word-break: break-word;
          max-width: 100%;
        }
        .pg-order-info { margin-top: 6mm; padding-left: 0; }
        .pg-order-info-line { font-size: 14px; color: ${BLACK}; line-height: 1.7; }
        .pg-order-info-line strong { font-weight: 700; }
        .pg-accent-bar { width: 60mm; height: 3px; background: ${THEME}; margin-top: 8mm; }

        /* ════════════════════════════════════════════════════════════════════ */
        /* ═══ STYLES BULLETIN DE LIVRAISON (page 4) — préfixe .bl- ═══════ */
        /* ═══ Reproduit fidèlement app/print/bulletin-livraison/[slug]/page.tsx*/
        /* ════════════════════════════════════════════════════════════════════ */
        .bl-header { display: flex; justify-content: space-between; gap: 20px; margin-bottom: 6mm; width: 100%; }
        .bl-header-left { flex: 0 0 46%; }
        .bl-header-right { flex: 0 0 50%; }
        .bl-logo { max-width: 175px; max-height: 65px; object-fit: contain; display: block; margin-bottom: 10px; }
        .bl-type { font-size: 26px; font-weight: 400; color: ${THEME}; margin-bottom: 8px; line-height: 1.1; }
        .bl-meta-table { border-collapse: collapse; width: 100%; }
        .bl-meta-table td { padding: 1px 6px 1px 0; vertical-align: top; font-size: 12px; line-height: 1.35; }
        .bl-meta-label { font-weight: 700; color: ${BLACK}; white-space: nowrap; width: 44%; }
        .bl-addr-window { padding: 10px 14px 10px 20px; min-height: 58mm; background: white; }
        .bl-addr-ref { font-size: 12px; color: #666; font-weight: 400; margin-bottom: 8px; }
        .bl-addr-name { font-size: 19px; font-weight: 700; color: ${BLACK}; line-height: 1.3; margin-bottom: 4px; }
        .bl-addr-line { font-size: 19px; color: ${BLACK}; line-height: 1.3; font-weight: 400; }
        .bl-hr { border: 0; border-top: 2px solid ${THEME}; margin: 4mm 0; width: 100%; }
        .bl-addresses { display: table; width: 100%; margin-bottom: 6mm; border-collapse: collapse; }
        .bl-addr-row { display: table-row; }
        .bl-addr-group { display: table-cell; width: 50%; vertical-align: top; padding-right: 10px; }
        .bl-addr-inner { display: flex; gap: 0; }
        .bl-addr-title { font-size: 12px; font-weight: 700; color: ${THEME}; white-space: nowrap; padding-right: 12px; padding-top: 1px; min-width: 110px; flex-shrink: 0; display: block; }
        .bl-addr-content { font-size: 12px; line-height: 1.6; color: ${BLACK}; flex: 1; }
        .bl-table { width: 100%; border-collapse: collapse; margin-bottom: 6mm; }
        .bl-table thead th { padding: 7px 4px; border-top: 2px solid ${THEME}; border-bottom: 2px solid ${THEME}; font-weight: 700; font-size: 12px; color: ${BLACK}; }
        .bl-table thead th.bl-th-left { text-align: left; }
        .bl-table thead th.bl-th-center { text-align: center; }
        .bl-table tbody tr td { padding: 8px 4px; border-bottom: 1px solid #efefef; vertical-align: top; font-size: 12px; }
        .bl-table tbody tr:nth-child(odd) td { background: ${LIGHT}; }
        .bl-td-img { width: 56px; vertical-align: middle; text-align: center; }
        .bl-td-img img { max-width: 52px; max-height: 52px; object-fit: contain; }
        .bl-td-desc { padding-left: 8px !important; }
        .bl-td-center { text-align: center; vertical-align: middle; white-space: nowrap; font-weight: 700; color: ${BLACK}; font-size: 14px; }
        .bl-item-title { font-weight: 700; color: ${BLACK}; line-height: 1.35; }
        .bl-item-sku { font-size: 11px; color: #777; margin-top: 2px; font-weight: 400; }
        .bl-tr-comment td { background: #eef4fb !important; }
        .bl-td-comment { padding: 6px 10px !important; font-style: italic; color: #445 !important; font-size: 12px; }
        .bl-services-box { margin-bottom: 6mm; padding: 12px 16px; background: #f0f7ff; border-left: 3px solid ${THEME}; border-radius: 4px; }
        .bl-services-title { font-size: 12px; font-weight: 700; color: ${BLACK}; margin-bottom: 6px; }
        .bl-services-list { font-size: 12px; color: ${GREY}; line-height: 1.7; }
        .bl-notes-block { margin-bottom: 6mm; }
        .bl-notes-title { font-weight: 700; color: ${BLACK}; margin-bottom: 5px; font-size: 12px; }
        .bl-notes-text { font-size: 12px; color: ${GREY}; line-height: 1.55; white-space: pre-wrap; }
        .bl-thanks-block { text-align: center; margin: 8mm 0 4mm; padding: 14px 20px; background: #f0faf2; border: 1px solid #a7d9b0; border-radius: 8px; }
        .bl-thanks-title { font-size: 14px; font-weight: 700; color: ${THEME}; margin-bottom: 6px; }
        .bl-thanks-text { font-size: 11px; color: ${GREY}; line-height: 1.6; }
        .bl-footer { border-top: 1px solid #ddd; padding-top: 6px; text-align: center; font-size: 11px; color: #666; line-height: 1.7; margin-top: 6mm; }
        .bl-footer strong { color: ${BLACK}; }
        .bl-footer-url { font-weight: 700; color: ${THEME}; }
        .bl-footer-social { margin-top: 5px; text-align: center; display: block; width: 100%; }
        .bl-footer-social img { width: 18px; height: 18px; margin: 0 4px; vertical-align: middle; display: inline-block; }

        /* ════════════════════════════════════════════════════════════════════ */
        /* ═══ STYLES FICHE BLEUE ARCHIVE (page 5) — préfixe .fb- ══════════ */
        /* ════════════════════════════════════════════════════════════════════ */
        .fb-page-wrap {
          width: 100%;
          max-width: 100%;
          position: relative;
          background: radial-gradient(ellipse at center, #e8f0f8 0%, #e8f0f8 35%, #a8c5e0 75%, #4a7ba7 100%);
          padding: 8mm 10mm;
          overflow: hidden;
          margin: 0;
          box-sizing: border-box;
        }
        @media print {
          .fb-page-wrap {
            box-shadow: none;
            width: 210mm;
            max-width: 210mm;
            min-height: 280mm;
            margin: -14mm -16mm -14mm -14mm;
            padding: 22mm 26mm 22mm 24mm;
            box-sizing: border-box;
          }
        }
        .fb-watermark {
          position: absolute; top: 50%; left: 50%;
          transform: translate(-50%, -50%) rotate(-30deg);
          font-size: 90px; font-weight: 900; color: #4a7ba7;
          opacity: 0.06; letter-spacing: 0.1em; white-space: nowrap;
          pointer-events: none; z-index: 0;
        }
        .fb-content { position: relative; z-index: 1; height: 100%; display: flex; flex-direction: column; }
        .fb-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 10mm; margin-bottom: 4mm; padding-bottom: 3mm; border-bottom: 2px solid #4a7ba7; }
        .fb-header-left { flex: 0 0 auto; }
        .fb-header-right { flex: 1; text-align: right; }
        .fb-logo-bleue { max-height: 14mm; max-width: 50mm; object-fit: contain; }
        .fb-doc-title { font-size: 16px; font-weight: 900; color: #4a7ba7; letter-spacing: 0.05em; text-transform: uppercase; margin-top: 2mm; }
        .fb-doc-title-fb { display: inline-block; background: #4a7ba7; color: white; padding: 2px 10px; border-radius: 3px; font-size: 13px; font-weight: 900; letter-spacing: 0.08em; margin-left: 6px; vertical-align: middle; }
        .fb-doc-subtitle { font-size: 9px; color: #222; font-style: italic; margin-top: 1mm; letter-spacing: 0.02em; }
        .fb-doc-num { font-size: 22px; font-weight: 900; color: #000; line-height: 1; }
        .fb-doc-date-big { font-size: 28px; font-weight: 900; color: #4a7ba7; line-height: 1; margin-top: 4mm; letter-spacing: 0.02em; }
        .fb-doc-date { font-size: 11px; color: #222; margin-top: 1mm; }
        /* Coin "à couper" en bas à droite */
        .fb-cut-corner { position: absolute; bottom: 0; right: 0; width: 30mm; height: 30mm; z-index: 5; pointer-events: none; }
        .fb-cut-corner-bg { position: absolute; bottom: 0; right: 0; width: 0; height: 0; border-left: 30mm solid transparent; border-bottom: 30mm solid rgba(74, 123, 167, 0.35); }
        .fb-cut-corner-line { position: absolute; bottom: 30mm; right: 0; width: 42mm; height: 2px; background: repeating-linear-gradient(to right, #4a7ba7 0, #4a7ba7 3px, transparent 3px, transparent 6px); transform-origin: bottom right; transform: rotate(-45deg); }
        .fb-cut-corner-scissors { position: absolute; bottom: 17mm; right: 17mm; font-size: 14px; transform: rotate(-45deg); color: #4a7ba7; font-weight: 900; }
        .fb-cut-corner-label { position: absolute; bottom: 4mm; right: 4mm; font-size: 8px; color: #4a7ba7; font-style: italic; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; transform: rotate(-45deg); transform-origin: center; }
        .fb-info-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 4mm; margin-bottom: 3mm; }
        .fb-info-block { background: rgba(255,255,255,0.75); border: 1px solid #a8c5e0; border-radius: 4px; padding: 5px 8px; }
        .fb-info-title { font-size: 8px; font-weight: 700; color: #4a7ba7; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 3px; padding-bottom: 2px; border-bottom: 1px solid #a8c5e0; }
        .fb-info-content { font-size: 10px; line-height: 1.4; color: #000; }
        .fb-info-name { font-size: 11px; font-weight: 700; }
        .fb-pickup-tag { display: inline-block; background: #f59e0b; color: white; padding: 1px 6px; border-radius: 3px; font-size: 9px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
        .fb-table-wrap { background: rgba(255,255,255,0.85); border: 1px solid #a8c5e0; border-radius: 4px; margin-bottom: 3mm; overflow: hidden; flex: 1; min-height: 0; }
        .fb-table { width: 100%; border-collapse: collapse; font-size: 9.5px; }
        .fb-table thead th { background: #4a7ba7; color: white; padding: 4px 5px; font-weight: 700; font-size: 9px; text-transform: uppercase; letter-spacing: 0.04em; text-align: left; }
        .fb-table thead th.fb-th-c { text-align: center; }
        .fb-table thead th.fb-th-r { text-align: right; }
        .fb-table tbody tr td { padding: 3px 5px; border-bottom: 1px solid #e0e8f0; vertical-align: top; font-size: 9.5px; }
        .fb-table tbody tr:nth-child(even) td { background: rgba(232, 240, 248, 0.5); }
        .fb-td-img-bleue { width: 38px; text-align: center; vertical-align: middle; }
        .fb-td-img-bleue img { max-width: 32px; max-height: 32px; object-fit: contain; display: block; margin: 0 auto; }
        .fb-td-qty-bleue { width: 32px; text-align: center; font-weight: 700; font-size: 11px; }
        .fb-td-sku-bleue { width: 70px; font-size: 8.5px; color: #555; font-family: ui-monospace, monospace; }
        .fb-td-desc-bleue { padding-left: 4px; }
        .fb-td-desc-title-bleue { font-weight: 700; line-height: 1.25; color: #000; }
        .fb-td-price-bleue { width: 60px; text-align: right; white-space: nowrap; }
        .fb-td-total-bleue { width: 70px; text-align: right; white-space: nowrap; font-weight: 700; }
        .fb-td-stock-bleue { width: 60px; text-align: center; font-size: 8.5px; }
        .fb-stock-ok-bleue { color: #2C7E3F; font-weight: 700; }
        .fb-stock-low-bleue { color: #e67e22; font-weight: 700; }
        .fb-stock-cmd-bleue { color: #dc2626; font-weight: 700; }
        .fb-stock-na-bleue { color: #999; font-style: italic; }
        .fb-tr-comment-bleue td { background: #fff8dc !important; padding: 3px 8px !important; font-style: italic; font-size: 9px; color: #555 !important; border-left: 2px solid #4a7ba7; }
        .fb-tr-media-bleue td { background: white !important; padding: 4px !important; text-align: center !important; }
        .fb-tr-media-bleue img { width: auto; object-fit: contain; display: inline-block; vertical-align: middle; }
        .fb-media-small  { max-height: 18px !important; max-width: 60px !important; width: auto !important; height: auto !important; object-fit: contain !important; display: inline-block !important; }
        .fb-media-medium { max-height: 40px !important; max-width: 130px !important; width: auto !important; height: auto !important; object-fit: contain !important; display: inline-block !important; }
        .fb-media-large  { max-height: 80px !important; max-width: 250px !important; width: auto !important; height: auto !important; object-fit: contain !important; display: inline-block !important; }
        .fb-media-img-small  { max-height: 60px !important; max-width: 140px !important; width: auto !important; height: auto !important; object-fit: contain !important; display: inline-block !important; }
        .fb-media-img-medium { max-height: 130px !important; max-width: 280px !important; width: auto !important; height: auto !important; object-fit: contain !important; display: inline-block !important; }
        .fb-media-img-large  { max-height: 220px !important; max-width: 480px !important; width: auto !important; height: auto !important; object-fit: contain !important; display: inline-block !important; }
        .fb-line-discount-bleue { font-size: 8px; color: #2a8a2a; }
        .fb-footer-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; }
        .fb-services-box { background: rgba(255,255,255,0.75); border: 1px solid #a8c5e0; border-radius: 4px; padding: 5px 8px; font-size: 9px; }
        .fb-services-title { font-weight: 700; color: #4a7ba7; text-transform: uppercase; font-size: 8px; letter-spacing: 0.04em; margin-bottom: 3px; padding-bottom: 2px; border-bottom: 1px solid #a8c5e0; }
        .fb-services-list { line-height: 1.5; }
        .fb-services-list-row { display: flex; justify-content: space-between; gap: 8px; }
        .fb-remarks-box { background: rgba(255, 251, 230, 0.85); border: 1px solid #f59e0b; border-radius: 4px; padding: 5px 8px; font-size: 9px; line-height: 1.4; color: #000; margin-top: 3mm; }
        .fb-remarks-title { font-weight: 700; color: #92400e; text-transform: uppercase; font-size: 8px; letter-spacing: 0.04em; margin-bottom: 2px; }
        .fb-totals { background: rgba(255,255,255,0.95); border: 1.5px solid #4a7ba7; border-radius: 4px; padding: 6px 10px; font-size: 10px; }
        .fb-totals-row { display: flex; justify-content: space-between; padding: 2px 0; }
        .fb-total-final { margin-top: 4px; padding-top: 6px; border-top: 2px solid #4a7ba7; font-size: 13px; font-weight: 900; }
        .fb-discount-row { color: #2a8a2a; }
        .fb-bottom-row { margin-top: 3mm; display: flex; gap: 4mm; align-items: stretch; }
        .fb-sign-block { background: rgba(255,255,255,0.75); border: 1px dashed #4a7ba7; border-radius: 4px; padding: 4px 8px 8px; page-break-inside: avoid; }
        .fb-sign-title { font-size: 8px; font-weight: 700; color: #4a7ba7; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 12px; }
        .fb-sign-line { border-bottom: 1px solid #555; height: 14px; margin-bottom: 1mm; }
        .fb-sign-sub { font-size: 8px; color: #666; font-style: italic; }
        .fb-stat-strip { margin-top: 3mm; display: flex; justify-content: space-between; align-items: center; font-size: 8.5px; color: #000; padding: 3px 8px; background: rgba(255,255,255,0.6); border-radius: 3px; padding-right: 32mm; }

        /* ════════════════════════════════════════════════════════════════════ */
        /* ═══ STYLES LIGNES MÉDIA — partagés entre ft / cc / bl ═══════════ */
        /* ════════════════════════════════════════════════════════════════════ */
        .ft-tr-media td {
          background: white !important;
          padding: 12px 4px !important;
          text-align: center !important;
          border-bottom: 1px solid #d1d5db !important;
          border-left: 3px solid #a855f7 !important;
        }
        .cc-tr-media td, .bl-tr-media td {
          background: white !important;
          padding: 14px 4px !important;
          text-align: center !important;
          border-bottom: 1px solid #efefef;
        }
        .ft-tr-media img, .cc-tr-media img, .bl-tr-media img {
          width: auto; object-fit: contain; display: inline-block; vertical-align: middle;
        }
        .media-small  { max-height: 22px !important; max-width: 80px !important; width: auto !important; height: auto !important; object-fit: contain !important; display: inline-block !important; }
        .media-medium { max-height: 50px !important; max-width: 180px !important; width: auto !important; height: auto !important; object-fit: contain !important; display: inline-block !important; }
        .media-large  { max-height: 110px !important; max-width: 350px !important; width: auto !important; height: auto !important; object-fit: contain !important; display: inline-block !important; }
        .media-img-small  { max-height: 80px !important; max-width: 200px !important; width: auto !important; height: auto !important; object-fit: contain !important; display: inline-block !important; }
        .media-img-medium { max-height: 180px !important; max-width: 400px !important; width: auto !important; height: auto !important; object-fit: contain !important; display: inline-block !important; }
        .media-img-large  { max-height: 320px !important; max-width: 700px !important; width: auto !important; height: auto !important; object-fit: contain !important; display: inline-block !important; }
      `}</style>

      <div className="printall-info">
        🖨 Jeu complet — {numeroAffiche} · 5 pages
      </div>
      <button className="print-btn-all" onClick={() => window.print()}>
        🖨 Imprimer
      </button>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* ═══════════════ PAGE 1 — FICHE DE TRAVAIL ════════════════════════ */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      <div className="doc-wrap-all">
        <div className="ft-banner">
          <span>📋 FICHE DE TRAVAIL — USAGE INTERNE{numeroAffiche ? ` · ${numeroAffiche}` : ""}</span>
          <span className="ft-banner-printed">Imprimée le {printedAt}</span>
        </div>

        <div className="ft-header">
          <div className="ft-header-left">
            <img className="ft-logo"
              src="https://cdn.shopify.com/s/files/1/0360/3251/2135/files/logo_JARDIN_CONFORT_shopify.jpg?v=1614107698"
              alt="Jardin-Confort" />
            <div className="ft-type">Fiche de travail</div>
            <table className="ft-meta-table">
              <tbody>
                <tr><td className="ft-meta-label">{numeroLabel}</td><td><strong>{numeroAffiche}</strong></td></tr>
                {data.reference && <tr><td className="ft-meta-label">Référence</td><td>{data.reference}</td></tr>}
                <tr><td className="ft-meta-label">{dateLabel}</td><td>{formatDate(dateDocument)}</td></tr>
                <tr><td className="ft-meta-label">Commercial</td><td>{data.commercial}</td></tr>
                {data.leadTime && <tr><td className="ft-meta-label">Délai de livraison</td><td>{data.leadTime}</td></tr>}
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {(data as any).deliveryMode && <tr><td className="ft-meta-label">Mode livraison</td><td><strong>{(data as any).deliveryMode}</strong></td></tr>}
                <tr><td className="ft-meta-label">Total articles</td><td><strong>{totalQty} pce{totalQty > 1 ? "s" : ""}</strong></td></tr>
              </tbody>
            </table>
          </div>

          <div className="ft-header-qr">
            <div id="qr-commande-all"></div>
            <div className="ft-qr-label">Scan = N° {typeDocument === "Offre" ? "offre" : "cmd"}</div>
            <div id="qr-client-all" className="ft-qr-second"></div>
            <div className="ft-qr-label">Ref client</div>
          </div>

          <div className="ft-header-right">
            <div className="ft-addr-window">
              <span className="ft-addr-window-title">📦 Adresse de livraison</span>
              <div className="ft-addr-ref">Réf : {numeroAffiche}</div>
              {isPickup ? (
                <>
                  <div className="ft-pickup-badge">⚠ À L&apos;EMPORTER</div>
                  <div style={{fontSize: 12, color: "#666", fontStyle: "italic", lineHeight: 1.5, marginTop: 4}}>
                    Le client viendra retirer la marchandise<br/>
                    <strong style={{color:"#000", fontStyle:"normal"}}>Jardin-Confort SA</strong><br/>
                    Route de Lavaux 425 · 1095 Lutry
                  </div>
                  <div className="ft-addr-name" style={{marginTop: 8, fontSize: 13}}>Client : {data.nom} {data.prenom}</div>
                  {livrTelFTeff && <div className="ft-addr-tel">📞 {livrTelFTeff}</div>}
                  {data.email && <div className="ft-addr-email">✉ {data.email}</div>}
                </>
              ) : (
                <>
                  {livrSocieteFT && <div className="ft-addr-line">{livrSocieteFT}</div>}
                  <div className="ft-addr-name">{livrNomFT} {livrPrenomFT}</div>
                  {livrComplementNomFTeff && <div className="ft-addr-line">{livrComplementNomFTeff}</div>}
                  {livrRueFT && <div className="ft-addr-line">{livrRueFT} {livrNumeroFT}</div>}
                  {livrNpaFT && <div className="ft-addr-line">{livrNpaFT} {livrVilleFT}</div>}
                  {livrTelFTeff && <div className="ft-addr-tel">📞 {livrTelFTeff}</div>}
                  {data.email && <div className="ft-addr-email">✉ {data.email}</div>}
                </>
              )}
            </div>
          </div>
        </div>

        {data.remarks && data.remarks.trim() && (
          <div className="ft-remarks-top">
            <div className="ft-remarks-top-title">⚠ Notes / Instructions importantes</div>
            <div className="ft-remarks-top-text">{data.remarks}</div>
          </div>
        )}

        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        {(data as any).accesLivraison && (data as any).accesLivraison.trim() && !isPickup && (
          <div className="ft-acces">
            <div className="ft-acces-title">🏢 Accès livraison / étage</div>
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            <div className="ft-acces-text">{(data as any).accesLivraison}</div>
          </div>
        )}

        <table className="ft-table">
          <thead>
            <tr>
              <th style={{width:56}}></th>
              <th className="ft-th-center" style={{width:54}}></th>
              <th className="ft-th-center" style={{width:60}}>Qté</th>
              <th className="ft-th-left">Description / SKU / Code-barres</th>
              <th className="ft-th-right" style={{width:70}}>Prix/pce</th>
              <th className="ft-th-right" style={{width:78}}>Total</th>
              <th className="ft-th-center" style={{width:78}}>Stock</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.length === 0 && (
              <tr><td colSpan={7} style={{textAlign:"center", padding:"20px", color:"#aaa", fontStyle:"italic"}}>Aucun article</td></tr>
            )}
            {data.lines.map((line: QuoteLine) => {
              if (line.type === "comment") {
                return (
                  <tr key={line.id} className="ft-tr-comment">
                    <td colSpan={7}>💬 {line.title || <em style={{opacity:0.6}}>(commentaire vide)</em>}</td>
                  </tr>
                );
              }
              if (line.type === "media") {
                if (!line.mediaUrl) return null;
                const prefix = line.mediaSource === "upload" ? "media-img-" : "media-";
                const sizeClass = line.mediaSize === "small" ? prefix + "small" : line.mediaSize === "large" ? prefix + "large" : prefix + "medium";
                return (
                  <tr key={line.id} className="ft-tr-media">
                    <td colSpan={7}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={line.mediaUrl} alt={line.title || ""} className={sizeClass} />
                    </td>
                  </tr>
                );
              }
              const isCustom = line.type === "custom";
              let stockDisplay: React.ReactNode;
              if (line.stock === undefined || line.stock === null) {
                stockDisplay = <span className="ft-stock-na">—</span>;
              } else if (line.stock === "sur_commande" || line.stock === 0) {
                stockDisplay = <span className="ft-stock-cmd">Sur commande</span>;
              } else if (typeof line.stock === "number") {
                if (line.stock > 2) {
                  stockDisplay = <span className="ft-stock-ok">✓ {line.stock} pce{line.stock > 1 ? "s" : ""}</span>;
                } else {
                  stockDisplay = <span className="ft-stock-low">⚠ {line.stock} pce{line.stock > 1 ? "s" : ""}</span>;
                }
              }
              const lineTotal = line.qty * line.unitPrice - (line.lineDiscount || 0);
              const isMultiQty = line.qty > 1;
              return (
                <tr key={line.id} className="ft-row-product">
                  <td className="ft-td-img">
                    {line.image ? <img src={line.image} alt="" /> : <div className="ft-td-img-placeholder">{isCustom ? "✏️" : "—"}</div>}
                  </td>
                  <td className="ft-td-circles">
                    <div>
                      <span className="ft-check-circle"></span>
                      <span className="ft-check-circle"></span>
                    </div>
                    <span className="ft-check-circles-labels">Rès · cdé</span>
                  </td>
                  <td className="ft-td-qty">
                    <span className={`ft-qty-num${isMultiQty ? " ft-qty-num-multi" : ""}`}>{line.qty}</span>
                    <span className="ft-qty-x">×</span>
                  </td>
                  <td className="ft-td-desc">
                    <div className="ft-item-title">
                      {isCustom && <span className="ft-item-custom-badge">À la volée</span>}
                      {line.title}
                    </div>
                    {line.sku ? (
                      <>
                        <div className="ft-item-sku-text">SKU : {line.sku}</div>
                        <div className="ft-item-barcode"><svg className="barcode-sku-all" data-sku={line.sku}></svg></div>
                      </>
                    ) : (
                      <span className="ft-item-no-sku">⚠ Sans SKU</span>
                    )}
                  </td>
                  <td className="ft-td-price"><span className="ft-price-val">{formatMoney(line.unitPrice)}</span></td>
                  <td className="ft-td-total">
                    {formatMoney(lineTotal)}
                    {(line.lineDiscount || 0) > 0 && <div className="ft-line-discount">− {formatMoney(line.lineDiscount || 0)}</div>}
                  </td>
                  <td className="ft-td-stock">
                    {stockDisplay}
                    <span className="ft-stock-date">au {printedAt.split(" ")[0]}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="ft-bottom-wrap">
          <div className="ft-notes-col">
            {data.remarks && data.remarks.trim() && (
              <>
                <div className="ft-notes-bottom-title">📌 Rappel des instructions</div>
                <div className="ft-notes-bottom-text">{data.remarks}</div>
              </>
            )}
            <div className="ft-billing-block">
              <div className="ft-billing-block-title">💼 Adresse de facturation</div>
              <div className="ft-billing-block-content">
                {data.societe && <div>{data.societe}</div>}
                <div className="ft-billing-name">{data.nom} {data.prenom}</div>
                {data.complement_nom && <div>{data.complement_nom}</div>}
                {data.rue && <div>{data.rue} {data.numero}</div>}
                {data.npa && <div>{data.npa} {data.ville}</div>}
                <div className="ft-billing-contact">
                  {data.telephone1 && <span>📞 {data.telephone1}</span>}
                  {data.email && <span>✉ {data.email}</span>}
                </div>
              </div>
            </div>
            <div className="ft-final-sign">
              <div className="ft-final-sign-text">✓ Marchandise contrôlée et reçue en parfait état</div>
              <div className="ft-final-sign-row">
                <div className="ft-final-sign-field">
                  <div className="ft-final-sign-line"></div>
                  <div className="ft-final-sign-label">Date</div>
                </div>
                <div className="ft-final-sign-field-large">
                  <div className="ft-final-sign-line"></div>
                  <div className="ft-final-sign-label">Signature client</div>
                </div>
              </div>
            </div>
          </div>

          <div className="ft-totals-col">
            <table className="ft-pricing">
              <tbody>
                <tr><td className="ft-pt-label">Sous-total articles</td><td className="ft-pt-value">{formatMoney(totals.subTotal)}</td></tr>
                {totals.discountValue > 0 && <tr><td className="ft-pt-label">Remise</td><td className="ft-pt-value" style={{color:"#2a8a2a"}}>− {formatMoney(totals.discountValue)}</td></tr>}
                {totals.discountValue > 0 && <tr><td className="ft-pt-label">Après remise</td><td className="ft-pt-value">{formatMoney(subTotal - discountValue)}</td></tr>}
                {activeServices.length > 0 && (
                  <>
                    <tr><td className="ft-pt-label">Services</td><td className="ft-pt-value">{formatMoney(totals.serviceTotal)}</td></tr>
                    {activeServices.map((srv, i) => (
                      <tr key={i}><td className="ft-pt-sub">↳ {srv.label}</td><td className="ft-pt-value" style={{fontSize:10.5}}>{srv.amount === 0 ? "Offert" : formatMoney(srv.amount)}</td></tr>
                    ))}
                  </>
                )}
                {totals.roundingValue !== 0 && <tr><td className="ft-pt-label">Arrondi</td><td className="ft-pt-value">{formatMoney(totals.roundingValue)}</td></tr>}
                {totals.isPrivateTTC ? (
                  <tr className="ft-pt-tva"><td className="ft-pt-label">TVA 8.1% incluse</td><td className="ft-pt-value">{formatMoney(totals.tvaAmount)}</td></tr>
                ) : (
                  <>
                    <tr><td className="ft-pt-label">Total HT</td><td className="ft-pt-value">{formatMoney(totals.totalAfterRounding)}</td></tr>
                    <tr className="ft-pt-tva"><td className="ft-pt-label">+ TVA 8.1%</td><td className="ft-pt-value">{formatMoney(totals.tvaAmount)}</td></tr>
                  </>
                )}
                <tr className="ft-pt-total"><td className="ft-pt-total-label">TOTAL {totals.isPrivateTTC ? "TTC" : "HT + TVA"}</td><td className="ft-pt-total-value">{formatMoney(totals.finalTotal)}</td></tr>
                <tr className="ft-pt-fillable"><td className="ft-pt-label">Acompte versé</td><td className="ft-pt-value"></td></tr>
                <tr className="ft-pt-fillable"><td className="ft-pt-label">Solde à percevoir</td><td className="ft-pt-value"></td></tr>
                {data.paymentMode && <tr className="ft-pt-paymentmode"><td className="ft-pt-label">Mode paiement</td><td className="ft-pt-value" style={{fontSize:10.5}}>{data.paymentMode}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* ═══════════════ PAGE 2 — COMMANDE CLIENT ════════════════════════ */}
      {/* ═══ Reproduit fidèlement app/print/offre/[slug]/page.tsx ═════════ */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      <div className="doc-wrap-all page-break">
        {/* HEADER */}
        <div className="cc-header">
          <div className="cc-header-left">
            <img className="cc-logo"
              src="https://cdn.shopify.com/s/files/1/0360/3251/2135/files/logo_JARDIN_CONFORT_shopify.jpg?v=1614107698"
              alt="Jardin-Confort" />
            <div className="cc-type">{data.formType}</div>
            <table className="cc-meta-table">
              <tbody>
                <tr>
                  <td className="cc-meta-label">N° {data.formType === "Offre" ? "d'offre" : "de commande"}</td>
                  <td>{numeroAffiche || data.offerNumber}</td>
                </tr>
                {data.reference && (
                  <tr><td className="cc-meta-label">Référence</td><td>{data.reference}</td></tr>
                )}
                <tr><td className="cc-meta-label">Date</td><td>{formatDate(data.date)}</td></tr>
                <tr><td className="cc-meta-label">Commercial</td><td>{data.commercial}</td></tr>
                <tr><td className="cc-meta-label">Mode de paiement</td><td>{data.paymentMode}</td></tr>
                {data.leadTime && (
                  <tr><td className="cc-meta-label">Délai de livraison</td><td>{data.leadTime}</td></tr>
                )}
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {(data as any).validiteDuree && (
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  <tr><td className="cc-meta-label">Validité de l&apos;offre</td><td>{(data as any).validiteDuree}</td></tr>
                )}
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {(data as any).deliveryMode && (
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  <tr><td className="cc-meta-label">Mode de livraison</td><td>{(data as any).deliveryMode}</td></tr>
                )}
                {data.email && (
                  <tr><td className="cc-meta-label">E-mail</td><td>{data.email}</td></tr>
                )}
                {data.customerNumber && (
                  <tr><td className="cc-meta-label">N° client</td><td>{data.customerNumber}</td></tr>
                )}
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {(data as any).accesLivraison && (data as any).deliveryMode !== "À l'emporter" && (
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  <tr><td className="cc-meta-label">Accès livraison</td><td style={{fontStyle:"italic"}}>{(data as any).accesLivraison}</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="cc-header-right">
            <div className="cc-addr-window">
              <div className="cc-addr-ref">{numeroAffiche || data.offerNumber}</div>
              {data.societe && <div className="cc-addr-line">{data.societe}</div>}
              <div className="cc-addr-name">{data.nom} {data.prenom}</div>
              {data.complement_nom && <div className="cc-addr-line">{data.complement_nom}</div>}
              {data.rue && <div className="cc-addr-line">{data.rue} {data.numero}</div>}
              {data.npa && <div className="cc-addr-line">{data.npa} {data.ville}</div>}
              {data.telephone1 && <div className="cc-addr-line" style={{marginTop:8, fontSize:16}}>Tél. {data.telephone1}</div>}
            </div>
          </div>
        </div>

        <hr className="cc-hr" />

        {/* ADRESSES */}
        <div className="cc-addresses">
          <div className="cc-addr-row">
            <div className="cc-addr-group">
              <div className="cc-addr-inner">
                <span className="cc-addr-title">Adresse de facturation</span>
                <div className="cc-addr-content">
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
            <div className="cc-addr-group">
              <div className="cc-addr-inner">
                <span className="cc-addr-title">Adresse de livraison</span>
                <div className="cc-addr-content">
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
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

        {/* TABLEAU ARTICLES */}
        <table className="cc-table">
          <thead>
            <tr>
              <th style={{width:56}}></th>
              <th className="cc-th-left">Description de l&apos;article</th>
              <th className="cc-th-center" style={{width:62}}>Qté</th>
              <th className="cc-th-right" style={{width:90}}>Prix/pce</th>
              <th className="cc-th-right" style={{width:100}}>Total</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.length === 0 && (
              <tr><td colSpan={5} style={{textAlign:"center", padding:"20px", color:"#aaa", fontStyle:"italic"}}>Aucun article</td></tr>
            )}
            {data.lines.map((line: QuoteLine) => {
              if (line.type === "comment") {
                return (
                  <tr key={line.id} className="cc-tr-comment">
                    <td colSpan={5} className="cc-td-comment">{line.title}</td>
                  </tr>
                );
              }
              if (line.type === "media") {
                if (!line.mediaUrl) return null;
                const prefix = line.mediaSource === "upload" ? "media-img-" : "media-";
                const sizeClass = line.mediaSize === "small" ? prefix + "small" : line.mediaSize === "large" ? prefix + "large" : prefix + "medium";
                return (
                  <tr key={line.id} className="cc-tr-media">
                    <td colSpan={5}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={line.mediaUrl} alt={line.title || ""} className={sizeClass} />
                    </td>
                  </tr>
                );
              }
              const lineTotal = line.qty * line.unitPrice - (line.lineDiscount || 0);
              return (
                <tr key={line.id}>
                  <td className="cc-td-img">{line.image && <img src={line.image} alt="" />}</td>
                  <td className="cc-td-desc">
                    <div className="cc-item-title">{line.title}</div>
                    {line.sku && <div className="cc-item-sku">{line.sku}</div>}
                    {(line.lineDiscount || 0) > 0 && (
                      <div className="cc-item-discount">Remise : − {formatMoney(line.lineDiscount || 0)}</div>
                    )}
                    {data.formType === "Commande" && (() => {
                      const sn = typeof line.stock === "number" ? line.stock : null;
                      const isSC = line.stock === "sur_commande" || (sn !== null && sn < 1);
                      const isOk = sn !== null && sn > 2;
                      const isLow = sn !== null && sn > 0 && sn <= 2;
                      const baseStyle: React.CSSProperties = { fontSize: 11, fontWeight: 600, marginTop: 4 };
                      if (isSC) return (
                        <div style={{ ...baseStyle, color: "#E67E22" }}>
                          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                          📦 {(line as any).delaiLivraison || "Sur commande"}
                        </div>
                      );
                      if (isOk) return (
                        <div style={{ ...baseStyle, color: "#2C7E3F" }}>
                          ✓ En stock ({sn} pce{sn! > 1 ? "s" : ""})
                        </div>
                      );
                      if (isLow) return (
                        <div style={{ ...baseStyle, color: "#E67E22" }}>
                          ⚠ Stock limité ({sn} pce{sn! > 1 ? "s" : ""})
                        </div>
                      );
                      return null;
                    })()}
                  </td>
                  <td className="cc-td-center">× {line.qty}</td>
                  <td className="cc-td-right">{formatMoney(line.unitPrice)}</td>
                  <td className="cc-td-total">{formatMoney(lineTotal)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* NOTES + TOTAUX + SIGNATURE CLIENT */}
        <div className="cc-bottom-wrap">
          <div className="cc-notes-sign-col">
            {data.remarks && (
              <>
                <div className="cc-notes-title">Notes</div>
                <div className="cc-notes-text">{data.remarks}</div>
              </>
            )}
            {data.formType === "Offre" && (
              <div className="cc-sign-block">
                <div className="cc-sign-name">Bon pour accord — {data.nom} {data.prenom}</div>
                <div className="cc-sign-line" />
                <div className="cc-sign-sub">Signature &amp; date</div>
              </div>
            )}
          </div>

          <div className="cc-totals-col">
            <table className="cc-pricing">
              <tbody>
                <tr>
                  <td className="cc-pt-label">Sous-total articles</td>
                  <td className="cc-pt-value">{formatMoney(subTotal)}</td>
                </tr>
                {discountValue > 0 && (
                  <tr>
                    <td className="cc-pt-label">Remise</td>
                    <td className="cc-pt-value" style={{color:"#2a8a2a"}}>− {formatMoney(discountValue)}</td>
                  </tr>
                )}
                {discountValue > 0 && (
                  <tr>
                    <td className="cc-pt-label">Après remise</td>
                    <td className="cc-pt-value">{formatMoney(subTotal - discountValue)}</td>
                  </tr>
                )}
                {activeServices.length > 0 && (
                  <>
                    <tr>
                      <td className="cc-pt-label">Services</td>
                      <td className="cc-pt-value" style={{fontSize:11, fontStyle:"italic", color:"#888"}}>inclus</td>
                    </tr>
                    {activeServices.map((srv, i) => (
                      <tr key={i}>
                        <td className="cc-pt-label cc-pt-sub">↳ {srv.label}</td>
                        <td className="cc-pt-value" style={{fontSize:11}}>
                          {srv.amount === 0 ? "Offert" : formatMoney(srv.amount)}
                        </td>
                      </tr>
                    ))}
                  </>
                )}
                {roundingValue !== 0 && (
                  <tr>
                    <td className="cc-pt-label">Arrondi</td>
                    <td className="cc-pt-value">{formatMoney(roundingValue)}</td>
                  </tr>
                )}
                {isPrivateTTC ? (
                  <tr className="cc-pt-tva">
                    <td className="cc-pt-label">TVA 8.1% (incluse)</td>
                    <td className="cc-pt-value">{formatMoney(tvaAmount)}</td>
                  </tr>
                ) : (
                  <>
                    <tr>
                      <td className="cc-pt-label">Total HT</td>
                      <td className="cc-pt-value">{formatMoney(totals.totalAfterRounding)}</td>
                    </tr>
                    <tr className="cc-pt-tva">
                      <td className="cc-pt-label">+ TVA 8.1%</td>
                      <td className="cc-pt-value">{formatMoney(tvaAmount)}</td>
                    </tr>
                  </>
                )}
                <tr className="cc-pt-total">
                  <td className="cc-pt-total-label">TOTAL {isPrivateTTC ? "TTC" : "HT + TVA"}</td>
                  <td className="cc-pt-total-value">{formatMoney(finalTotal)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* LIEN VALIDATION EN LIGNE — offres uniquement */}
        {data.formType === "Offre" && (
        <div style={{
          margin: "0 0 6mm 0",
          background: "linear-gradient(135deg, #EEF6FF 0%, #E8F4FF 100%)",
          border: "1.5px solid #2b8ad1",
          borderRadius: 12,
          padding: "14px 20px",
          display: "flex",
          alignItems: "center",
          gap: 20,
        }}>
          <div style={{flex:1}}>
            <div style={{fontSize:13, fontWeight:700, color:"#0a1551", marginBottom:4}}>
              ✍️ Signature électronique disponible
            </div>
            <div style={{fontSize:11, color:"#5e678f", lineHeight:1.6, marginBottom:10}}>
              Vous pouvez valider et signer cette offre directement en ligne depuis votre smartphone ou ordinateur, sans impression nécessaire.
            </div>
            <a href={validationUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-block",
                background: "#2b8ad1",
                color: "white",
                borderRadius: 20,
                padding: "8px 18px",
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: "0.02em",
                textDecoration: "none",
              }}>
              ✅ Valider mon offre en ligne →
            </a>
            <div style={{marginTop:6, fontSize:10, color:"#5e678f", wordBreak:"break-all"}}>
              {validationUrl}
            </div>
          </div>
          <div style={{flexShrink:0, textAlign:"center"}}>
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=110x110&data=${encodeURIComponent(validationUrl)}`}
              alt="QR Code validation"
              style={{width:110, height:110, borderRadius:8, border:"1px solid #c7dff5"}}
            />
            <div style={{fontSize:9, color:"#5e678f", marginTop:4}}>Scanner pour valider</div>
          </div>
        </div>
        )}

        {/* REMERCIEMENTS */}
        <p className="cc-thanks">
          Nous nous réjouissons de pouvoir traiter votre commande. Merci d&apos;avance pour votre confiance !
        </p>
        <p className="cc-terms">
          En validant cette offre et/ou en passant une commande, vous confirmez avoir pris connaissance et accepté{" "}
          <a href="https://www.jardin-confort.ch/pages/conditions-generales">nos conditions générales</a>.<br/>
          Les quantités, articles et frais mentionnés peuvent différer de la version finale validée.
          Seule la confirmation de commande fait foi.
        </p>

        {/* PIED DE PAGE */}
        <div className="cc-footer">
          <div><strong>Jardin-Confort SA</strong></div>
          <div>Route de Lavaux 425 · 1095 Lutry · Suisse</div>
          <div>contact@jardinconfort.ch · +41 21 791 36 71</div>
          <div>TVA : CHE-100.142.327</div>
          <div>Banque Cantonale Vaudoise · IBAN CH72 0076 7000 K033 3796 5 · SWIFT BCVLCH2LXXX</div>
          <div className="cc-footer-url">www.jardin-confort.ch</div>
          <div className="cc-footer-social">
            <img src="https://cdn.shopify.com/s/files/1/0398/5025/files/Fb_icon.jpg?11755453313570768267" alt="Facebook" />
            <img src="https://cdn.shopify.com/s/files/1/0398/5025/files/instagram_9.png?576915513262272927" alt="Instagram" />
          </div>
        </div>

        {/* IMAGES D'AMBIANCE */}
        {data.ambianceImages && data.ambianceImages.length > 0 && (
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
                  Images d&apos;illustration — {numeroAffiche || data.offerNumber}
                </div>
                <div style={{fontSize:11, color:"#aaa", fontStyle:"italic", marginTop:2}}>
                  Images non contractuelles · {data.nom} {data.prenom} · {formatDate(data.date)}
                </div>
              </div>
            </div>
            <div className="cc-ambiance-grid">
              {data.ambianceImages.map((img: AmbianceImage) => (
                <div key={img.id} className="cc-ambiance-item">
                  <img src={img.dataUrl} alt={img.legende || "Illustration"} />
                  {img.legende && <div className="cc-ambiance-caption">{img.legende}</div>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* ═══════════════ PAGE 3 — PAGE DE GARDE COLIS ════════════════════ */}
      {/* ═══ Reproduit fidèlement app/print/page-garde-colis/[slug]/... ══ */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      <div className="doc-wrap-all page-break">
        <div className="pg-wrap">
          <div className="pg-top-row">
            <div className="pg-return-block">
              <img className="pg-return-logo"
                src="https://cdn.shopify.com/s/files/1/0360/3251/2135/files/Logo_Jardin-Confort_et_adresse_vertical-01.png?v=1723586050"
                alt="Jardin-Confort" />
            </div>

            <div className="pg-client-addr">
              {pgSociete && <div className="pg-client-addr-line">{pgSociete}</div>}
              <div className="pg-client-addr-name">{pgNom} {pgPrenom}</div>
              {pgComplementNom && <div className="pg-client-addr-line">{pgComplementNom}</div>}
              {pgRue && <div className="pg-client-addr-line">{pgRue} {pgNumero}</div>}
              {pgNpa && <div className="pg-client-addr-line">{pgNpa} {pgVille}</div>}
            </div>
          </div>

          <div className="pg-accent-bar" />

          <div className="pg-order-info">
            <div className="pg-order-info-line">
              <strong>N° de commande :</strong> {numeroAffiche || data.offerNumber}
            </div>
            <div className="pg-order-info-line">
              <strong>Date :</strong> {formatDate(data.date)}
            </div>
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {(data as any).deliveryMode && (
              <div className="pg-order-info-line">
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                <strong>Expédition :</strong> {(data as any).deliveryMode}
              </div>
            )}
            {data.commercial && (
              <div className="pg-order-info-line">
                <strong>Commercial :</strong> {data.commercial}
              </div>
            )}
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {(data as any).accesLivraison && (data as any).deliveryMode !== "À l'emporter" && (
              <div className="pg-order-info-line" style={{fontStyle:"italic", color:GREY, marginTop: 6}}>
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                <strong style={{color:BLACK}}>Accès :</strong> {(data as any).accesLivraison}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* ═══════════════ PAGE 4 — BULLETIN DE LIVRAISON ══════════════════ */}
      {/* ═══ Reproduit fidèlement app/print/bulletin-livraison/[slug]/... ═ */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      <div className="doc-wrap-all page-break">
        {/* HEADER */}
        <div className="bl-header">
          <div className="bl-header-left">
            <img className="bl-logo"
              src="https://cdn.shopify.com/s/files/1/0360/3251/2135/files/logo_JARDIN_CONFORT_shopify.jpg?v=1614107698"
              alt="Jardin-Confort" />
            <div className="bl-type">Bulletin de livraison</div>
            <table className="bl-meta-table">
              <tbody>
                <tr>
                  <td className="bl-meta-label">N° de commande</td>
                  <td>{numeroAffiche || data.offerNumber}</td>
                </tr>
                {data.reference && (
                  <tr><td className="bl-meta-label">Référence</td><td>{data.reference}</td></tr>
                )}
                <tr><td className="bl-meta-label">Date</td><td>{formatDate(data.date)}</td></tr>
                <tr><td className="bl-meta-label">Commercial</td><td>{data.commercial}</td></tr>
                {data.leadTime && (
                  <tr><td className="bl-meta-label">Délai de livraison</td><td>{data.leadTime}</td></tr>
                )}
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {(data as any).deliveryMode && (
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  <tr><td className="bl-meta-label">Mode de livraison</td><td>{(data as any).deliveryMode}</td></tr>
                )}
                {data.email && (
                  <tr><td className="bl-meta-label">E-mail</td><td>{data.email}</td></tr>
                )}
                {data.customerNumber && (
                  <tr><td className="bl-meta-label">N° client</td><td>{data.customerNumber}</td></tr>
                )}
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {(data as any).accesLivraison && (data as any).deliveryMode !== "À l'emporter" && (
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  <tr><td className="bl-meta-label">Accès livraison</td><td style={{fontStyle:"italic"}}>{(data as any).accesLivraison}</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="bl-header-right">
            <div className="bl-addr-window">
              <div className="bl-addr-ref">{numeroAffiche || data.offerNumber}</div>
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {(data as any).deliveryMode === "À l'emporter" ? (
                <>
                  {data.societe && <div className="bl-addr-line">{data.societe}</div>}
                  <div className="bl-addr-name">{data.nom} {data.prenom}</div>
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
                  {data.livrSociete && <div className="bl-addr-line">{data.livrSociete}</div>}
                  <div className="bl-addr-name">{data.livrNom} {data.livrPrenom}</div>
                  {data.livr_complement_nom && <div className="bl-addr-line">{data.livr_complement_nom}</div>}
                  {data.livrRue && <div className="bl-addr-line">{data.livrRue} {data.livrNumero}</div>}
                  {data.livrNpa && <div className="bl-addr-line">{data.livrNpa} {data.livrVille}</div>}
                  {data.livrTel && <div className="bl-addr-line" style={{marginTop:8, fontSize:16}}>Tél. {data.livrTel}</div>}
                </>
              ) : (
                <>
                  {data.societe && <div className="bl-addr-line">{data.societe}</div>}
                  <div className="bl-addr-name">{data.nom} {data.prenom}</div>
                  {data.complement_nom && <div className="bl-addr-line">{data.complement_nom}</div>}
                  {data.rue && <div className="bl-addr-line">{data.rue} {data.numero}</div>}
                  {data.npa && <div className="bl-addr-line">{data.npa} {data.ville}</div>}
                  {data.telephone1 && <div className="bl-addr-line" style={{marginTop:8, fontSize:16}}>Tél. {data.telephone1}</div>}
                </>
              )}
            </div>
          </div>
        </div>

        <hr className="bl-hr" />

        {/* ADRESSES */}
        <div className="bl-addresses">
          <div className="bl-addr-row">
            <div className="bl-addr-group">
              <div className="bl-addr-inner">
                <span className="bl-addr-title">Adresse de facturation</span>
                <div className="bl-addr-content">
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
            <div className="bl-addr-group">
              <div className="bl-addr-inner">
                <span className="bl-addr-title">Adresse de livraison</span>
                <div className="bl-addr-content">
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
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

        {/* TABLEAU ARTICLES (sans prix) */}
        <table className="bl-table">
          <thead>
            <tr>
              <th style={{width:56}}></th>
              <th className="bl-th-left">Description de l&apos;article</th>
              <th className="bl-th-center" style={{width:80}}>Qté</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.length === 0 && (
              <tr><td colSpan={3} style={{textAlign:"center", padding:"20px", color:"#aaa", fontStyle:"italic"}}>Aucun article</td></tr>
            )}
            {data.lines.map((line: QuoteLine) => {
              if (line.type === "comment") {
                return (
                  <tr key={line.id} className="bl-tr-comment">
                    <td colSpan={3} className="bl-td-comment">{line.title}</td>
                  </tr>
                );
              }
              if (line.type === "media") {
                if (!line.mediaUrl) return null;
                const prefix = line.mediaSource === "upload" ? "media-img-" : "media-";
                const sizeClass = line.mediaSize === "small" ? prefix + "small" : line.mediaSize === "large" ? prefix + "large" : prefix + "medium";
                return (
                  <tr key={line.id} className="bl-tr-media">
                    <td colSpan={3}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={line.mediaUrl} alt={line.title || ""} className={sizeClass} />
                    </td>
                  </tr>
                );
              }
              return (
                <tr key={line.id}>
                  <td className="bl-td-img">{line.image && <img src={line.image} alt="" />}</td>
                  <td className="bl-td-desc">
                    <div className="bl-item-title">{line.title}</div>
                    {line.sku && <div className="bl-item-sku">{line.sku}</div>}
                  </td>
                  <td className="bl-td-center">× {line.qty}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* SERVICES (sans prix) */}
        {activeServicesNoPrice.length > 0 && (
          <div className="bl-services-box">
            <div className="bl-services-title">Services inclus</div>
            <div className="bl-services-list">
              {activeServicesNoPrice.map((srv, i) => (
                <div key={i}>↳ {srv.label}</div>
              ))}
            </div>
          </div>
        )}

        {/* NOTES */}
        {data.remarks && (
          <div className="bl-notes-block">
            <div className="bl-notes-title">Notes</div>
            <div className="bl-notes-text">{data.remarks}</div>
          </div>
        )}

        {/* MESSAGE DE REMERCIEMENT */}
        <div className="bl-thanks-block">
          <div className="bl-thanks-title">Merci pour vos achats !</div>
          <div className="bl-thanks-text">
            Les éventuels articles non livrés de cette commande ont fait/font/feront partie d&apos;une livraison parallèle ou ultérieure.<br/>
            Si vous avez la moindre question, n&apos;hésitez pas à nous contacter.
          </div>
        </div>

        {/* PIED DE PAGE */}
        <div className="bl-footer">
          <div><strong>Jardin-Confort SA</strong></div>
          <div>Route de Lavaux 425 · 1095 Lutry · Suisse</div>
          <div>contact@jardinconfort.ch · +41 21 791 36 71</div>
          <div>TVA : CHE-100.142.327</div>
          <div className="bl-footer-url">www.jardin-confort.ch</div>
          <div className="bl-footer-social">
            <img src="https://cdn.shopify.com/s/files/1/0398/5025/files/Fb_icon.jpg?11755453313570768267" alt="Facebook" />
            <img src="https://cdn.shopify.com/s/files/1/0398/5025/files/instagram_9.png?576915513262272927" alt="Instagram" />
          </div>
        </div>

      </div>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* ═══════════════ PAGE 5 — FICHE BLEUE ARCHIVE ════════════════════ */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      <div className="page-break" style={{padding: 0, margin: 0, maxWidth: "100%"}}>
        <div className="fb-page-wrap">
          <div className="fb-watermark">ARCHIVE · {numeroAffiche}</div>
          <div className="fb-content">

            {/* HEADER */}
            <div className="fb-header">
              <div className="fb-header-left">
                <img className="fb-logo-bleue"
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
                <div className="fb-doc-date">{typeDocument === "Offre" ? "N° offre" : "N° commande"}</div>
                <div className="fb-doc-date-big">{formatDate(dateDocument || data.date)}</div>
                {data.reference && <div className="fb-doc-date" style={{fontStyle: "italic", marginTop: "2mm"}}>Réf. {data.reference}</div>}
              </div>
            </div>

            {/* INFO STRIP */}
            <div className="fb-info-grid">
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

              <div className="fb-info-block">
                <div className="fb-info-title">📦 Livraison</div>
                <div className="fb-info-content">
                  {isPickup ? (
                    <>
                      <div className="fb-pickup-tag">À l&apos;emporter</div>
                      <div style={{marginTop: 3, fontSize: 9, fontStyle: "italic"}}>Retrait Jardin-Confort SA<br/>Lutry</div>
                    </>
                  ) : data.livrDiff ? (
                    <>
                      {data.livrSociete && <div>{data.livrSociete}</div>}
                      <div className="fb-info-name">{data.livrNom} {data.livrPrenom}</div>
                      {data.livr_complement_nom && <div>{data.livr_complement_nom}</div>}
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

              <div className="fb-info-block">
                <div className="fb-info-title">👤 Client / Facturation</div>
                <div className="fb-info-content">
                  {data.societe && <div>{data.societe}</div>}
                  <div className="fb-info-name">{data.nom} {data.prenom}</div>
                  {data.complement_nom && <div>{data.complement_nom}</div>}
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
                    <th className="fb-th-c" style={{width: 32}}>Qté</th>
                    <th style={{width: 70}}>SKU</th>
                    <th>Désignation</th>
                    <th className="fb-th-r" style={{width: 60}}>Prix/u</th>
                    <th className="fb-th-r" style={{width: 70}}>Total</th>
                    <th className="fb-th-c" style={{width: 60}}>Stock</th>
                  </tr>
                </thead>
                <tbody>
                  {data.lines.length === 0 && (
                    <tr><td colSpan={7} style={{textAlign: "center", padding: 8, fontStyle: "italic", color: "#999"}}>Aucun article</td></tr>
                  )}
                  {data.lines.map((line: QuoteLine) => {
                    if (line.type === "comment") {
                      return (
                        <tr key={line.id} className="fb-tr-comment-bleue">
                          <td colSpan={7}>💬 {line.title || <em style={{opacity: 0.6}}>(commentaire vide)</em>}</td>
                        </tr>
                      );
                    }
                    if (line.type === "media") {
                      if (!line.mediaUrl) return null;
                      const prefix = line.mediaSource === "upload" ? "fb-media-img-" : "fb-media-";
                      const sizeClass = line.mediaSize === "small" ? prefix + "small" : line.mediaSize === "large" ? prefix + "large" : prefix + "medium";
                      return (
                        <tr key={line.id} className="fb-tr-media-bleue">
                          <td colSpan={7}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={line.mediaUrl} alt={line.title || ""} className={sizeClass} />
                          </td>
                        </tr>
                      );
                    }
                    const lineTotalFB = line.qty * line.unitPrice - (line.lineDiscount || 0);
                    let stockElFB: React.ReactNode;
                    const snFB = typeof line.stock === "number" ? line.stock : null;
                    if (line.stock === undefined || line.stock === null) {
                      stockElFB = <span className="fb-stock-na-bleue">—</span>;
                    } else if (line.stock === "sur_commande" || (snFB !== null && snFB < 1)) {
                      stockElFB = <span className="fb-stock-cmd-bleue">CMD</span>;
                    } else if (snFB !== null && snFB > 2) {
                      stockElFB = <span className="fb-stock-ok-bleue">✓ {snFB}</span>;
                    } else if (snFB !== null && snFB > 0) {
                      stockElFB = <span className="fb-stock-low-bleue">⚠ {snFB}</span>;
                    }
                    return (
                      <tr key={line.id}>
                        <td className="fb-td-img-bleue">
                          {line.image && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={line.image} alt="" />
                          )}
                        </td>
                        <td className="fb-td-qty-bleue">{line.qty}×</td>
                        <td className="fb-td-sku-bleue">{line.sku || "—"}</td>
                        <td className="fb-td-desc-bleue">
                          <div className="fb-td-desc-title-bleue">{line.title}</div>
                          {(line.lineDiscount || 0) > 0 && (
                            <div className="fb-line-discount-bleue">Remise : − {formatMoney(line.lineDiscount || 0)}</div>
                          )}
                        </td>
                        <td className="fb-td-price-bleue">{formatMoney(line.unitPrice)}</td>
                        <td className="fb-td-total-bleue">{formatMoney(lineTotalFB)}</td>
                        <td className="fb-td-stock-bleue">{stockElFB}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* SERVICES + REMARQUES | TOTAUX */}
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
                  <div className="fb-totals-row fb-discount-row">
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
              <div className="fb-sign-block" style={{flex: 1, border: "1px solid #4a7ba7", background: "rgba(255,255,255,0.85)"}}>
                <div className="fb-sign-title">Notes archive</div>
                <div style={{fontSize: 8.5, color: "#666", lineHeight: 1.4}}>
                  Acompte : ____________________ CHF<br/>
                  Solde : _______________________ CHF<br/>
                  Échéance : ____________________
                </div>
              </div>
            </div>

            <div className="fb-stat-strip">
              {(() => {
                const totalLinesAll = data.lines.filter(l => l.type !== "comment" && l.type !== "media").length;
                const totalQtyAll = data.lines.reduce((s, l) => (l.type === "comment" || l.type === "media") ? s : s + l.qty, 0);
                return <span><strong>{totalLinesAll}</strong> ligne{totalLinesAll > 1 ? "s" : ""} · <strong>{totalQtyAll}</strong> pce{totalQtyAll > 1 ? "s" : ""}</span>;
              })()}
              <span>Jardin-Confort SA · Route de Lavaux 425 · 1095 Lutry · TVA CHE-100.142.327</span>
              <span style={{fontStyle: "italic", color: "#555"}}>Doc interne — ne pas distribuer</span>
            </div>

          </div>

          {/* Coin à couper après archivage */}
          <div className="fb-cut-corner">
            <div className="fb-cut-corner-bg"></div>
            <div className="fb-cut-corner-line"></div>
            <div className="fb-cut-corner-scissors">✂</div>
            <div className="fb-cut-corner-label">Couper après<br/>classement</div>
          </div>

        </div>
      </div>
    </>
  );
}