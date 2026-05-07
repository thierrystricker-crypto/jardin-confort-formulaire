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
//
//  Auto-print après 1500ms (laisse les images charger).
// ═══════════════════════════════════════════════════════════════

import React, { useEffect, useState, useRef } from "react";

const THEME = "#2b8ad1";
const BLACK = "#000000";
const GREY  = "#333333";
const LIGHT = "#f9f9f9";
const ORANGE = "#e67e22";
const QTY_HIGHLIGHT = "#dc2626";

const TVA_RATE = 0.081;

type ServiceItem = { code: string; label: string };
const serviceOptions: ServiceItem[] = [
  { code: "montage",       label: "Frais de montage" },
  { code: "poste",         label: "Livraison des colis par La Poste" },
  { code: "trottoir",      label: "Livraison colis franco trottoir" },
  { code: "etage",         label: "Livraison à l'étage et déballage" },
  { code: "etage_montage", label: "Livraison à l'étage, déballage et montage" },
  { code: "reprise",       label: "Reprise et recyclage des anciens meubles" },
];

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
  accesLivraison?: string;
  deliveryMode?: string;
  discount?: string;
  discountPercent?: string;
  manualRounding?: string;
  enabledServices?: Record<string, boolean>;
  servicePrices?: Record<string, string>;
  ambianceImages?: string[];
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
  discount: "0", discountPercent: "0", manualRounding: "",
  enabledServices: {}, servicePrices: {}, ambianceImages: [],
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

function formatMoney(value: number) {
  const formatted = new Intl.NumberFormat("de-CH", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(value);
  return `CHF ${formatted}`;
}

function computeTotals(d: PrintData) {
  const isPrivateTTC = d.clientType === "Privé (prix TTC)";
  const subTotal = d.lines.reduce((s, l) => {
    if (l.type === "comment") return s;
    return s + (l.qty * l.unitPrice - (l.lineDiscount || 0));
  }, 0);
  const pct = Number(d.discountPercent || 0);
  const discountValue = pct > 0 ? Math.round(subTotal * pct) / 100 : Number(d.discount || 0);
  const enabled = d.enabledServices || {};
  const prices = d.servicePrices || {};
  const fixedServices = serviceOptions.reduce((s, srv) => {
    if (!enabled[srv.code]) return s;
    return s + Number(prices[srv.code] || 0);
  }, 0);
  const customService = enabled["custom"] ? Number(prices["custom"] || 0) : 0;
  const serviceTotal = fixedServices + customService;
  const totalAfterDiscount = subTotal - discountValue;
  const totalPlusServices = totalAfterDiscount + serviceTotal;
  const roundingValue = Math.min(0, Number(d.manualRounding) || 0);
  const totalAfterRounding = totalPlusServices + roundingValue;
  const tvaAmount = isPrivateTTC
    ? totalAfterRounding - totalAfterRounding / (1 + TVA_RATE)
    : totalAfterRounding * TVA_RATE;
  const finalTotal = isPrivateTTC ? totalAfterRounding : totalAfterRounding + tvaAmount;
  return {
    isPrivateTTC, subTotal, discountValue, serviceTotal,
    totalAfterDiscount, totalPlusServices, roundingValue,
    totalAfterRounding, tvaAmount, finalTotal,
  };
}

export default function PrintAllPage({ params }: { params: Promise<{ slug: string }> }) {
  const [data, setData] = useState<PrintData>(EMPTY);
  const [ready, setReady] = useState(false);
  const [numeroAffiche, setNumeroAffiche] = useState("");
  const [dateDocument, setDateDocument] = useState<string>("");
  const [typeDocument, setTypeDocument] = useState<string>("Commande");
  const [printedAt] = useState(formatDateTime());
  const printedRef = useRef(false);
  const barcodesRendered = useRef(false);

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
            setDateDocument(json.offre?.date_document || offreData.date || "");
            setTypeDocument(json.offre?.type_document || offreData.formType || "Commande");
            setData({ ...EMPTY, ...offreData });
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
        document.querySelectorAll<HTMLElement>(".barcode-sku").forEach((el) => {
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

  // ─── Auto-print après que tout soit chargé ───
  useEffect(() => {
    if (!ready || printedRef.current) return;
    printedRef.current = true;
    const timer = setTimeout(() => {
      window.print();
    }, 1500);
    return () => clearTimeout(timer);
  }, [ready]);

  if (!ready) {
    return (
      <div style={{padding:40, textAlign:"center", color:GREY, fontFamily:"sans-serif"}}>
        Chargement du jeu complet…
      </div>
    );
  }

  // ─── Variables partagées ───
  const livrSociete = data.livrDiff ? data.livrSociete : data.societe;
  const livrNom     = data.livrDiff ? data.livrNom     : data.nom;
  const livrPrenom  = data.livrDiff ? data.livrPrenom  : data.prenom;
  const livrRue     = data.livrDiff ? data.livrRue     : data.rue;
  const livrNumero  = data.livrDiff ? data.livrNumero  : data.numero;
  const livrNpa     = data.livrDiff ? data.livrNpa     : data.npa;
  const livrVille   = data.livrDiff ? data.livrVille   : data.ville;
  const livrTelEffectif = (data.livrDiff && data.livrTel) ? data.livrTel : data.telephone1;
  const clientEmail = data.email;
  const isPickup = data.deliveryMode === "À l'emporter";
  const totalQty = data.lines.reduce((s, l) => l.type === "comment" ? s : s + l.qty, 0);
  const totals = computeTotals(data);

  const activeServices = [
    ...serviceOptions
      .filter((s) => data.enabledServices?.[s.code])
      .map((s) => ({ label: s.label, amount: Number(data.servicePrices?.[s.code] || 0) })),
    ...(data.enabledServices?.["custom"]
      ? [{ label: data.servicePrices?.["custom_label"] || "Service personnalisé", amount: Number(data.servicePrices?.["custom"] || 0) }]
      : []),
  ];

  const numeroLabel = typeDocument === "Offre" ? "N° d'offre" : "N° de commande";
  const dateLabel = typeDocument === "Offre" ? "Date offre" : "Date commande";

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
        @page {
          size: A4 portrait;
          margin: 11mm 11mm 14mm 11mm;
          @bottom-right {
            content: "Page " counter(page) " / " counter(pages);
            font-family: 'Raleway', Arial, sans-serif;
            font-size: 9px;
            color: #888;
            padding-right: 2mm;
          }
        }
        @media screen {
          .doc-wrap-all { max-width: 794px; margin: 0 auto; padding: 20px 28px; box-shadow: 0 0 20px rgba(0,0,0,0.08); background: white; }
          .doc-wrap-all + .doc-wrap-all { margin-top: 30px; border-top: 4px dashed #ccc; padding-top: 40px; }
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

        /* ════════════════════════════════════════════════════════════ */
        /* ═══ STYLES FICHE DE TRAVAIL (page 1) ════════════════════════ */
        /* ════════════════════════════════════════════════════════════ */
        .ft-banner {
          background: ${THEME}; color: white;
          padding: 5px 12px; margin-bottom: 3mm;
          border-radius: 4px;
          display: flex; justify-content: space-between; align-items: center;
          font-size: 12px; font-weight: 700; letter-spacing: 0.05em;
        }
        .ft-banner-printed { font-size: 10px; font-weight: 400; opacity: 0.9; }
        .ft-header { display: flex; justify-content: space-between; gap: 10px; margin-bottom: 3mm; align-items: flex-start; }
        .ft-header-left { flex: 0 0 42%; }
        .ft-header-qr { flex: 0 0 80px; display: flex; flex-direction: column; align-items: center; padding-top: 2px; }
        .ft-header-qr img { display: block; }
        .ft-header-qr .qr-second { margin-top: 6px; }
        .ft-header-qr .qr-label { font-size: 8px; color: #666; margin-top: 2px; letter-spacing: 0.04em; text-transform: uppercase; text-align: center; }
        .ft-header-right { flex: 1; min-width: 0; }
        .ft-logo { max-width: 150px; max-height: 52px; object-fit: contain; display: block; margin-bottom: 4px; }
        .ft-type { font-size: 20px; font-weight: 900; color: ${THEME}; margin-bottom: 4px; line-height: 1.05; letter-spacing: 0.02em; text-transform: uppercase; }
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
        .ft-table thead th.th-left { text-align: left; }
        .ft-table thead th.th-center { text-align: center; }
        .ft-table thead th.th-right { text-align: right; }
        .ft-table tbody tr td { padding: 5px 4px; border-bottom: 1px solid #d1d5db; vertical-align: middle; font-size: 11.5px; }
        .ft-table tbody tr.row-product:nth-child(even) td { background: ${LIGHT}; }
        .ft-td-img { width: 56px; vertical-align: middle; text-align: center; }
        .ft-td-img img { max-width: 50px; max-height: 50px; object-fit: contain; }
        .ft-td-img-placeholder { width: 50px; height: 50px; margin: 0 auto; border: 1px dashed #d1d5db; border-radius: 4px; display: flex; align-items: center; justify-content: center; font-size: 18px; color: #9ca3af; }
        .ft-td-circles { width: 54px; text-align: center; }
        .ft-td-qty { width: 60px; text-align: center; vertical-align: middle; }
        .ft-td-stock { width: 78px; text-align: center; vertical-align: middle; }
        .ft-td-price { width: 70px; text-align: right; vertical-align: middle; }
        .ft-td-total { width: 78px; text-align: right; vertical-align: middle; font-weight: 700; }
        .ft-td-desc { padding-left: 6px !important; }
        .ft-check-circle { display: inline-block; width: 16px; height: 16px; border: 1.8px solid #000; border-radius: 50%; margin: 0 1.5px; vertical-align: middle; }
        .ft-check-circles-labels { display: block; font-size: 7.5px; color: #555; letter-spacing: 0.05em; margin-top: 2px; font-weight: 600; }
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

        /* ════════════════════════════════════════════════════════════ */
        /* ═══ STYLES COMMANDE CLIENT (page 2) ═════════════════════════ */
        /* ════════════════════════════════════════════════════════════ */
        .cc-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6mm; padding-bottom: 4mm; border-bottom: 3px solid ${THEME}; }
        .cc-header-left { flex: 1; }
        .cc-logo { max-width: 180px; max-height: 60px; object-fit: contain; }
        .cc-doc-type { font-size: 28px; font-weight: 900; color: ${THEME}; letter-spacing: 0.04em; text-transform: uppercase; margin-top: 5px; }
        .cc-doc-num { font-size: 14px; color: #555; margin-top: 2px; font-weight: 600; }
        .cc-header-right { text-align: right; font-size: 11px; color: #555; line-height: 1.5; padding-top: 4px; }
        .cc-header-right strong { color: ${BLACK}; font-size: 12px; }

        .cc-addresses { display: flex; gap: 18px; margin-bottom: 6mm; }
        .cc-addr-block { flex: 1; padding: 10px 14px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; }
        .cc-addr-title { font-size: 10px; font-weight: 700; color: ${THEME}; letter-spacing: 0.06em; text-transform: uppercase; margin-bottom: 6px; padding-bottom: 4px; border-bottom: 1px solid #e5e7eb; }
        .cc-addr-name { font-weight: 700; font-size: 13px; color: ${BLACK}; }
        .cc-addr-line { font-size: 12px; color: #444; }
        .cc-addr-contact { margin-top: 4px; font-size: 11px; color: #555; }

        .cc-meta-bar { display: flex; gap: 20px; padding: 8px 14px; background: rgba(43, 138, 209, 0.08); border-radius: 6px; margin-bottom: 5mm; font-size: 11.5px; flex-wrap: wrap; }
        .cc-meta-item strong { color: ${BLACK}; }

        .cc-table { width: 100%; border-collapse: collapse; margin-bottom: 4mm; }
        .cc-table thead th { padding: 8px 6px; background: ${THEME}; color: white; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
        .cc-table thead th.th-left { text-align: left; }
        .cc-table thead th.th-right { text-align: right; }
        .cc-table thead th.th-center { text-align: center; }
        .cc-table tbody tr td { padding: 8px 6px; border-bottom: 1px solid #e5e7eb; font-size: 11.5px; vertical-align: middle; }
        .cc-table tbody tr:nth-child(even) td { background: ${LIGHT}; }
        .cc-td-img { width: 60px; text-align: center; }
        .cc-td-img img { max-width: 50px; max-height: 50px; object-fit: contain; }
        .cc-td-qty { width: 55px; text-align: center; font-weight: 700; }
        .cc-td-price { width: 80px; text-align: right; }
        .cc-td-total { width: 90px; text-align: right; font-weight: 700; }
        .cc-item-title { font-weight: 700; color: ${BLACK}; }
        .cc-item-sku { font-size: 10px; color: #777; margin-top: 2px; }
        .cc-comment-row td { background: #eef4fb !important; font-style: italic; color: #1e3a5f !important; font-weight: 600; border-left: 3px solid ${THEME} !important; }

        .cc-totals-row { display: flex; gap: 14px; margin-bottom: 5mm; }
        .cc-remarks-block { flex: 1; padding: 12px 14px; background: #fef3c7; border-left: 3px solid #f59e0b; border-radius: 4px; font-size: 11.5px; line-height: 1.55; white-space: pre-wrap; }
        .cc-remarks-title { font-weight: 700; color: #92400e; margin-bottom: 4px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
        .cc-totals-block { flex: 0 0 42%; }
        .cc-totals-table { width: 100%; border-collapse: collapse; }
        .cc-totals-table td { padding: 5px 8px; font-size: 12px; border-bottom: 1px solid #f0f0f0; }
        .cc-totals-table .cc-tot-label { color: ${BLACK}; }
        .cc-totals-table .cc-tot-val { text-align: right; white-space: nowrap; color: ${BLACK}; }
        .cc-totals-table .cc-grand td { border-top: 2px solid ${THEME}; border-bottom: 2px solid ${THEME}; padding: 9px 8px; background: rgba(43, 138, 209, 0.08); font-weight: 900; font-size: 15px; }

        .cc-ambiance-section { margin-top: 8mm; page-break-inside: avoid; }
        .cc-ambiance-title { font-size: 13px; font-weight: 700; color: ${THEME}; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4mm; padding-bottom: 3px; border-bottom: 2px solid ${THEME}; }
        .cc-ambiance-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; }
        .cc-ambiance-grid img { width: 100%; height: auto; max-height: 180px; object-fit: cover; border-radius: 6px; border: 1px solid #e5e7eb; }

        /* ════════════════════════════════════════════════════════════ */
        /* ═══ STYLES PAGE DE GARDE COLIS (page 3) ═════════════════════ */
        /* ════════════════════════════════════════════════════════════ */
        .pg-wrap { display: flex; flex-direction: row; gap: 16mm; min-height: 250mm; padding-top: 12mm; }
        .pg-left { flex: 0 0 35%; display: flex; flex-direction: column; align-items: center; padding-top: 30mm; }
        .pg-logo { max-width: 100%; max-height: 200px; object-fit: contain; }
        .pg-company { font-size: 22px; font-weight: 900; color: ${THEME}; margin-top: 12mm; text-align: center; letter-spacing: 0.05em; line-height: 1.2; }
        .pg-company-addr { font-size: 12px; color: #555; margin-top: 6mm; text-align: center; line-height: 1.6; }
        .pg-right { flex: 1; display: flex; flex-direction: column; justify-content: space-between; padding-top: 20mm; }
        .pg-destinataire-label { font-size: 11px; color: #999; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 4mm; font-weight: 700; }
        .pg-name { font-size: 32px; font-weight: 900; color: ${BLACK}; line-height: 1.2; margin-bottom: 4mm; }
        .pg-address { font-size: 22px; color: ${BLACK}; line-height: 1.5; font-weight: 500; }
        .pg-bottom-info { margin-top: auto; padding-top: 10mm; border-top: 2px solid #e5e7eb; font-size: 12px; color: #555; line-height: 1.7; }
        .pg-bottom-info strong { color: ${BLACK}; font-weight: 700; }

        /* ════════════════════════════════════════════════════════════ */
        /* ═══ STYLES BULLETIN DE LIVRAISON (page 4) ═══════════════════ */
        /* ════════════════════════════════════════════════════════════ */
        .bl-banner { background: #10b981; color: white; padding: 5px 12px; margin-bottom: 4mm; border-radius: 4px; display: flex; justify-content: space-between; align-items: center; font-size: 12px; font-weight: 700; letter-spacing: 0.05em; }
        .bl-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 5mm; padding-bottom: 4mm; border-bottom: 3px solid #10b981; }
        .bl-header-left { flex: 1; }
        .bl-doc-type { font-size: 24px; font-weight: 900; color: #10b981; letter-spacing: 0.04em; text-transform: uppercase; margin-top: 5px; }
        .bl-doc-num { font-size: 13px; color: #555; margin-top: 2px; font-weight: 600; }
        .bl-header-right { text-align: right; font-size: 11px; color: #555; line-height: 1.5; }
        .bl-addresses { display: flex; gap: 18px; margin-bottom: 5mm; }
        .bl-addr-block { flex: 1; padding: 10px 14px; background: #f0fdf4; border: 2px solid #10b981; border-radius: 6px; }
        .bl-addr-title { font-size: 10px; font-weight: 700; color: #059669; letter-spacing: 0.06em; text-transform: uppercase; margin-bottom: 6px; }
        .bl-addr-name { font-weight: 700; font-size: 14px; color: ${BLACK}; }
        .bl-addr-line { font-size: 12px; color: #333; }
        .bl-table { width: 100%; border-collapse: collapse; margin-bottom: 5mm; }
        .bl-table thead th { padding: 8px 6px; background: #10b981; color: white; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
        .bl-table thead th.th-left { text-align: left; }
        .bl-table thead th.th-center { text-align: center; }
        .bl-table tbody tr td { padding: 8px 6px; border-bottom: 1px solid #d1fae5; font-size: 12px; vertical-align: middle; }
        .bl-table tbody tr:nth-child(even) td { background: #f0fdf4; }
        .bl-td-img { width: 60px; text-align: center; }
        .bl-td-img img { max-width: 50px; max-height: 50px; object-fit: contain; }
        .bl-td-qty { width: 70px; text-align: center; font-size: 18px; font-weight: 900; color: ${BLACK}; }
        .bl-item-title { font-weight: 700; color: ${BLACK}; font-size: 13px; }
        .bl-item-sku { font-size: 10px; color: #777; margin-top: 2px; }
        .bl-services { margin-bottom: 5mm; padding: 10px 14px; background: #f0fdf4; border-radius: 6px; }
        .bl-services-title { font-size: 11px; font-weight: 700; color: #059669; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
        .bl-services-list { font-size: 12px; color: ${BLACK}; line-height: 1.7; }
        .bl-thanks { margin-top: 8mm; padding: 14px 18px; background: linear-gradient(90deg, #d1fae5 0%, #a7f3d0 100%); border-radius: 8px; text-align: center; }
        .bl-thanks-title { font-size: 16px; font-weight: 900; color: #059669; margin-bottom: 4px; }
        .bl-thanks-text { font-size: 11.5px; color: #064e3b; line-height: 1.5; }
        .bl-partial-notice { margin-top: 4mm; padding: 8px 12px; background: #fef3c7; border: 1px solid #f59e0b; border-radius: 6px; font-size: 11px; color: #92400e; line-height: 1.5; }
      `}</style>

      {/* INFO + BOUTON IMPRIMER */}
      <div className="printall-info">
        🖨 Jeu complet — {numeroAffiche} · 4 pages
      </div>
      <button className="print-btn-all" onClick={() => window.print()}>
        🖨 Imprimer
      </button>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* ═══════════ PAGE 1 — FICHE DE TRAVAIL ════════════════════════ */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="doc-wrap-all">
        <div className="ft-banner">
          <span>📋 FICHE DE TRAVAIL — USAGE INTERNE</span>
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
                {data.deliveryMode && <tr><td className="ft-meta-label">Mode livraison</td><td><strong>{data.deliveryMode}</strong></td></tr>}
                <tr><td className="ft-meta-label">Total articles</td><td><strong>{totalQty} pce{totalQty > 1 ? "s" : ""}</strong></td></tr>
              </tbody>
            </table>
          </div>

          <div className="ft-header-qr">
            <div id="qr-commande-all"></div>
            <div className="qr-label">Scan = N° {typeDocument === "Offre" ? "offre" : "cmd"}</div>
            <div id="qr-client-all" className="qr-second"></div>
            <div className="qr-label">Ref client</div>
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
                  {livrTelEffectif && <div className="ft-addr-tel">📞 {livrTelEffectif}</div>}
                  {clientEmail && <div className="ft-addr-email">✉ {clientEmail}</div>}
                </>
              ) : (
                <>
                  {livrSociete && <div className="ft-addr-line">{livrSociete}</div>}
                  <div className="ft-addr-name">{livrNom} {livrPrenom}</div>
                  {livrRue && <div className="ft-addr-line">{livrRue} {livrNumero}</div>}
                  {livrNpa && <div className="ft-addr-line">{livrNpa} {livrVille}</div>}
                  {livrTelEffectif && <div className="ft-addr-tel">📞 {livrTelEffectif}</div>}
                  {clientEmail && <div className="ft-addr-email">✉ {clientEmail}</div>}
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

        {data.accesLivraison && data.accesLivraison.trim() && !isPickup && (
          <div className="ft-acces">
            <div className="ft-acces-title">🏢 Accès livraison / étage</div>
            <div className="ft-acces-text">{data.accesLivraison}</div>
          </div>
        )}

        <table className="ft-table">
          <thead>
            <tr>
              <th style={{width:56}}></th>
              <th className="th-center" style={{width:54}}></th>
              <th className="th-center" style={{width:60}}>Qté</th>
              <th className="th-left">Description / SKU / Code-barres</th>
              <th className="th-right" style={{width:70}}>Prix/pce</th>
              <th className="th-right" style={{width:78}}>Total</th>
              <th className="th-center" style={{width:78}}>Stock</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.length === 0 && (
              <tr><td colSpan={7} style={{textAlign:"center", padding:"20px", color:"#aaa", fontStyle:"italic"}}>Aucun article</td></tr>
            )}
            {data.lines.map((line) => {
              if (line.type === "comment") {
                return (
                  <tr key={line.id} className="ft-tr-comment">
                    <td colSpan={7}>💬 {line.title || <em style={{opacity:0.6}}>(commentaire vide)</em>}</td>
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
                <tr key={line.id} className="row-product">
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
                        <div className="ft-item-barcode"><svg className="barcode-sku" data-sku={line.sku}></svg></div>
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
                {totals.discountValue > 0 && <tr><td className="ft-pt-label">Après remise</td><td className="ft-pt-value">{formatMoney(totals.totalAfterDiscount)}</td></tr>}
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

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* ═══════════ PAGE 2 — COMMANDE CLIENT ═════════════════════════ */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="doc-wrap-all page-break">
        <div className="cc-header">
          <div className="cc-header-left">
            <img className="cc-logo"
              src="https://cdn.shopify.com/s/files/1/0360/3251/2135/files/logo_JARDIN_CONFORT_shopify.jpg?v=1614107698"
              alt="Jardin-Confort" />
            <div className="cc-doc-type">{typeDocument === "Offre" ? "Offre" : "Commande"}</div>
            <div className="cc-doc-num">N° {numeroAffiche}</div>
          </div>
          <div className="cc-header-right">
            <strong>Jardin-Confort SA</strong><br/>
            Route de Lavaux 425<br/>
            1095 Lutry · Suisse<br/>
            +41 21 791 36 71<br/>
            www.jardin-confort.ch
          </div>
        </div>

        <div className="cc-addresses">
          <div className="cc-addr-block">
            <div className="cc-addr-title">💼 Facturation</div>
            {data.societe && <div className="cc-addr-line">{data.societe}</div>}
            <div className="cc-addr-name">{data.nom} {data.prenom}</div>
            {data.rue && <div className="cc-addr-line">{data.rue} {data.numero}</div>}
            {data.npa && <div className="cc-addr-line">{data.npa} {data.ville}</div>}
            <div className="cc-addr-contact">
              {data.telephone1 && <span>📞 {data.telephone1}</span>}{data.telephone1 && data.email && " · "}
              {data.email && <span>✉ {data.email}</span>}
            </div>
          </div>
          <div className="cc-addr-block">
            <div className="cc-addr-title">📦 Livraison</div>
            {isPickup ? (
              <>
                <div className="cc-addr-name" style={{color: ORANGE}}>⚠ À L&apos;EMPORTER</div>
                <div className="cc-addr-line">Jardin-Confort SA · Route de Lavaux 425 · 1095 Lutry</div>
              </>
            ) : (
              <>
                {livrSociete && <div className="cc-addr-line">{livrSociete}</div>}
                <div className="cc-addr-name">{livrNom} {livrPrenom}</div>
                {livrRue && <div className="cc-addr-line">{livrRue} {livrNumero}</div>}
                {livrNpa && <div className="cc-addr-line">{livrNpa} {livrVille}</div>}
                {livrTelEffectif && <div className="cc-addr-contact">📞 {livrTelEffectif}</div>}
              </>
            )}
          </div>
        </div>

        <div className="cc-meta-bar">
          <span className="cc-meta-item"><strong>{dateLabel} :</strong> {formatDate(dateDocument)}</span>
          {data.commercial && <span className="cc-meta-item"><strong>Commercial :</strong> {data.commercial}</span>}
          {data.leadTime && <span className="cc-meta-item"><strong>Délai :</strong> {data.leadTime}</span>}
          {data.paymentMode && <span className="cc-meta-item"><strong>Paiement :</strong> {data.paymentMode}</span>}
          {data.reference && <span className="cc-meta-item"><strong>Réf :</strong> {data.reference}</span>}
        </div>

        <table className="cc-table">
          <thead>
            <tr>
              <th style={{width:60}}></th>
              <th className="th-left">Article / SKU</th>
              <th className="th-center" style={{width:55}}>Qté</th>
              <th className="th-right" style={{width:80}}>Prix unit.</th>
              <th className="th-right" style={{width:90}}>Total</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.length === 0 && (
              <tr><td colSpan={5} style={{textAlign:"center", padding:"20px", color:"#aaa", fontStyle:"italic"}}>Aucun article</td></tr>
            )}
            {data.lines.map((line) => {
              if (line.type === "comment") {
                return (
                  <tr key={line.id} className="cc-comment-row">
                    <td colSpan={5}>💬 {line.title || <em>(commentaire)</em>}</td>
                  </tr>
                );
              }
              const lineTotal = line.qty * line.unitPrice - (line.lineDiscount || 0);
              return (
                <tr key={line.id}>
                  <td className="cc-td-img">{line.image ? <img src={line.image} alt="" /> : "—"}</td>
                  <td>
                    <div className="cc-item-title">{line.title}</div>
                    {line.sku && <div className="cc-item-sku">SKU : {line.sku}</div>}
                  </td>
                  <td className="cc-td-qty">{line.qty}</td>
                  <td className="cc-td-price">{formatMoney(line.unitPrice)}</td>
                  <td className="cc-td-total">{formatMoney(lineTotal)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="cc-totals-row">
          <div className="cc-remarks-block">
            {data.remarks && data.remarks.trim() ? (
              <>
                <div className="cc-remarks-title">📝 Remarques</div>
                <div>{data.remarks}</div>
              </>
            ) : (
              <div style={{color:"#92400e", fontStyle:"italic"}}>Aucune remarque particulière.</div>
            )}
          </div>
          <div className="cc-totals-block">
            <table className="cc-totals-table">
              <tbody>
                <tr><td className="cc-tot-label">Sous-total</td><td className="cc-tot-val">{formatMoney(totals.subTotal)}</td></tr>
                {totals.discountValue > 0 && <tr><td className="cc-tot-label">Remise</td><td className="cc-tot-val" style={{color:"#2a8a2a"}}>− {formatMoney(totals.discountValue)}</td></tr>}
                {totals.serviceTotal > 0 && <tr><td className="cc-tot-label">Services</td><td className="cc-tot-val">{formatMoney(totals.serviceTotal)}</td></tr>}
                {totals.roundingValue !== 0 && <tr><td className="cc-tot-label">Arrondi</td><td className="cc-tot-val">{formatMoney(totals.roundingValue)}</td></tr>}
                {totals.isPrivateTTC ? (
                  <tr><td className="cc-tot-label" style={{fontSize:10.5, color:"#666"}}>TVA 8.1% incluse</td><td className="cc-tot-val" style={{fontSize:10.5, color:"#666"}}>{formatMoney(totals.tvaAmount)}</td></tr>
                ) : (
                  <>
                    <tr><td className="cc-tot-label">Total HT</td><td className="cc-tot-val">{formatMoney(totals.totalAfterRounding)}</td></tr>
                    <tr><td className="cc-tot-label" style={{fontSize:10.5, color:"#666"}}>+ TVA 8.1%</td><td className="cc-tot-val" style={{fontSize:10.5, color:"#666"}}>{formatMoney(totals.tvaAmount)}</td></tr>
                  </>
                )}
                <tr className="cc-grand"><td className="cc-tot-label">TOTAL {totals.isPrivateTTC ? "TTC" : "HT + TVA"}</td><td className="cc-tot-val">{formatMoney(totals.finalTotal)}</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Images d'ambiance (si présentes) */}
        {data.ambianceImages && data.ambianceImages.length > 0 && (
          <div className="cc-ambiance-section">
            <div className="cc-ambiance-title">🌿 Images d&apos;ambiance</div>
            <div className="cc-ambiance-grid">
              {data.ambianceImages.map((img, i) => (
                <img key={i} src={img} alt={`Ambiance ${i + 1}`} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* ═══════════ PAGE 3 — PAGE DE GARDE COLIS ═════════════════════ */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="doc-wrap-all page-break">
        <div className="pg-wrap">
          <div className="pg-left">
            <img className="pg-logo"
              src="https://cdn.shopify.com/s/files/1/0360/3251/2135/files/logo_JARDIN_CONFORT_shopify.jpg?v=1614107698"
              alt="Jardin-Confort" />
            <div className="pg-company">JARDIN<br/>CONFORT</div>
            <div className="pg-company-addr">
              Route de Lavaux 425<br/>
              1095 Lutry · Suisse<br/>
              +41 21 791 36 71
            </div>
          </div>

          <div className="pg-right">
            <div>
              <div className="pg-destinataire-label">📦 Destinataire</div>
              {livrSociete && <div className="pg-address" style={{marginBottom: "4mm"}}>{livrSociete}</div>}
              <div className="pg-name">{livrNom} {livrPrenom}</div>
              <div className="pg-address">
                {livrRue && <>{livrRue} {livrNumero}<br/></>}
                {livrNpa && <>{livrNpa} {livrVille}</>}
              </div>
              {livrTelEffectif && <div className="pg-address" style={{marginTop:"5mm", fontSize:18}}>📞 {livrTelEffectif}</div>}
            </div>

            <div className="pg-bottom-info">
              <strong>Commande :</strong> {numeroAffiche}<br/>
              <strong>Date :</strong> {formatDate(dateDocument)}<br/>
              {data.commercial && <><strong>Commercial :</strong> {data.commercial}<br/></>}
              {totalQty > 0 && <><strong>Articles :</strong> {totalQty} pce{totalQty > 1 ? "s" : ""}</>}
            </div>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* ═══════════ PAGE 4 — BULLETIN DE LIVRAISON ═══════════════════ */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="doc-wrap-all page-break">
        <div className="bl-banner">
          <span>🚚 BULLETIN DE LIVRAISON</span>
          <span style={{fontSize: 10, fontWeight: 400, opacity: 0.9}}>À conserver par le client</span>
        </div>

        <div className="bl-header">
          <div className="bl-header-left">
            <img className="cc-logo"
              src="https://cdn.shopify.com/s/files/1/0360/3251/2135/files/logo_JARDIN_CONFORT_shopify.jpg?v=1614107698"
              alt="Jardin-Confort" />
            <div className="bl-doc-type">Bulletin de livraison</div>
            <div className="bl-doc-num">N° {numeroAffiche}</div>
          </div>
          <div className="bl-header-right">
            <strong>Jardin-Confort SA</strong><br/>
            Route de Lavaux 425 · 1095 Lutry<br/>
            +41 21 791 36 71<br/>
            <strong>Date :</strong> {formatDate(dateDocument)}
          </div>
        </div>

        <div className="bl-addresses">
          <div className="bl-addr-block">
            <div className="bl-addr-title">📦 Livré à</div>
            {livrSociete && <div className="bl-addr-line">{livrSociete}</div>}
            <div className="bl-addr-name">{livrNom} {livrPrenom}</div>
            {livrRue && <div className="bl-addr-line">{livrRue} {livrNumero}</div>}
            {livrNpa && <div className="bl-addr-line">{livrNpa} {livrVille}</div>}
            {livrTelEffectif && <div className="bl-addr-line" style={{marginTop:4}}>📞 {livrTelEffectif}</div>}
          </div>
          <div className="bl-addr-block">
            <div className="bl-addr-title">ℹ Informations</div>
            <div className="bl-addr-line"><strong>Total articles :</strong> {totalQty} pce{totalQty > 1 ? "s" : ""}</div>
            {data.commercial && <div className="bl-addr-line"><strong>Commercial :</strong> {data.commercial}</div>}
            {data.deliveryMode && <div className="bl-addr-line"><strong>Mode :</strong> {data.deliveryMode}</div>}
            {data.leadTime && <div className="bl-addr-line"><strong>Délai :</strong> {data.leadTime}</div>}
          </div>
        </div>

        <table className="bl-table">
          <thead>
            <tr>
              <th style={{width:60}}></th>
              <th className="th-left">Article / SKU</th>
              <th className="th-center" style={{width:70}}>Quantité</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.filter(l => l.type !== "comment").length === 0 && (
              <tr><td colSpan={3} style={{textAlign:"center", padding:"20px", color:"#aaa", fontStyle:"italic"}}>Aucun article</td></tr>
            )}
            {data.lines.filter(l => l.type !== "comment").map((line) => (
              <tr key={line.id}>
                <td className="bl-td-img">{line.image ? <img src={line.image} alt="" /> : "—"}</td>
                <td>
                  <div className="bl-item-title">{line.title}</div>
                  {line.sku && <div className="bl-item-sku">SKU : {line.sku}</div>}
                </td>
                <td className="bl-td-qty">{line.qty}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {activeServices.length > 0 && (
          <div className="bl-services">
            <div className="bl-services-title">🛠 Services inclus</div>
            <div className="bl-services-list">
              {activeServices.map((srv, i) => (
                <div key={i}>✓ {srv.label}</div>
              ))}
            </div>
          </div>
        )}

        <div className="bl-thanks">
          <div className="bl-thanks-title">🌿 Merci pour vos achats !</div>
          <div className="bl-thanks-text">
            L&apos;équipe Jardin-Confort vous remercie de votre confiance.<br/>
            Pour toute question, contactez-nous au +41 21 791 36 71 ou sur www.jardin-confort.ch
          </div>
        </div>

        <div className="bl-partial-notice">
          ℹ <strong>En cas de livraison partielle :</strong> ce bulletin reflète les articles livrés ce jour. Les articles manquants vous seront livrés ultérieurement et feront l&apos;objet d&apos;un nouveau bulletin de livraison.
        </div>
      </div>
    </>
  );
}