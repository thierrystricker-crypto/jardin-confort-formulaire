"use client";
// ═══════════════════════════════════════════════════════════════
//  app/print/fiche-travail/[slug]/page.tsx
//  Template d'impression — FICHE DE TRAVAIL (interne entrepôt)
//  v3 : utilise les colonnes Supabase (numero_affiche, date_document)
//        + remarques bien visibles + acompte/solde alignés droite
//        + lignes custom (à la volée) et comment correctement gérées
// ═══════════════════════════════════════════════════════════════

import React, { useEffect, useState, useRef } from "react";

const THEME  = "#2b8ad1";
const BLACK  = "#000000";
const GREY   = "#333333";
const LIGHT  = "#f9f9f9";
const ORANGE = "#e67e22";
const QTY_HIGHLIGHT = "#dc2626"; // rouge pour qty > 1

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
  deliveryMode?: string;
  discount?: string;
  discountPercent?: string;
  manualRounding?: string;
  enabledServices?: Record<string, boolean>;
  servicePrices?: Record<string, string>;
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
  enabledServices: {}, servicePrices: {},
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

// ── Calcul des totaux ──
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

export default function PrintFicheTravail({ params }: { params: Promise<{ slug: string }> }) {
  const [data, setData] = useState<PrintData>(EMPTY);
  const [ready, setReady] = useState(false);
  // ─── Récupérés depuis les COLONNES SUPABASE (pas du JSON data) ───
  const [numeroAffiche, setNumeroAffiche] = useState("");
  const [dateDocument, setDateDocument] = useState<string>("");
  const [typeDocument, setTypeDocument] = useState<string>("Commande");
  // ──────────────────────────────────────────────────────────────────
  const [printedAt] = useState(formatDateTime());
  const barcodesRendered = useRef(false);

  useEffect(() => {
    async function load() {
      const { slug } = await params;
      try {
        const res = await fetch(`/api/offres/${slug}?snapshot=false`);
        if (res.ok) {
          const json = await res.json();
          const offreData = json.offre?.data;
          if (offreData) {
            // Numéro et date depuis les colonnes Supabase, pas depuis data
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

  // Génération codes-barres + QR
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
              format: "CODE128",
              width: 1.6,
              height: 26,
              displayValue: false,
              margin: 0,
              lineColor: "#000000",
            });
          } catch (e) {
            console.warn("Barcode error pour SKU", sku, e);
          }
        });
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const qrcode = (window as any).qrcode;
      if (qrcode && numeroAffiche) {
        const qrEl = document.getElementById("qr-commande");
        if (qrEl) {
          const qr = qrcode(0, "M");
          qr.addData(numeroAffiche);
          qr.make();
          qrEl.innerHTML = qr.createImgTag(3, 0);
        }
      }
      barcodesRendered.current = true;
    }).catch((err) => console.error("Erreur chargement librairies barcode:", err));
  }, [ready, data.lines, numeroAffiche]);

  if (!ready) return <div style={{padding:40, textAlign:"center", color:GREY}}>Chargement…</div>;

  // Adresse livraison
  const livrSociete  = data.livrDiff ? data.livrSociete  : data.societe;
  const livrNom      = data.livrDiff ? data.livrNom      : data.nom;
  const livrPrenom   = data.livrDiff ? data.livrPrenom   : data.prenom;
  const livrRue      = data.livrDiff ? data.livrRue      : data.rue;
  const livrNumero   = data.livrDiff ? data.livrNumero   : data.numero;
  const livrNpa      = data.livrDiff ? data.livrNpa      : data.npa;
  const livrVille    = data.livrDiff ? data.livrVille    : data.ville;
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

  // Libellé contextuel pour le numéro de document
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
        @page { size: A4 portrait; margin: 12mm 12mm 12mm 12mm; }
        @media screen {
          .doc-wrap { max-width: 794px; margin: 0 auto; padding: 20px 28px; box-shadow: 0 0 20px rgba(0,0,0,0.08); }
          .print-btn { position: fixed; top: 16px; right: 16px; z-index: 100; background: ${THEME}; color: white; border: 0; padding: 10px 20px; border-radius: 6px; font-size: 14px; font-weight: 700; cursor: pointer; }
        }
        @media print { .print-btn { display: none !important; } }

        /* ══ BANDEAU TITRE ══ */
        .doc-banner {
          background: ${THEME};
          color: white;
          padding: 6px 14px;
          margin-bottom: 4mm;
          border-radius: 4px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 13px;
          font-weight: 700;
          letter-spacing: 0.05em;
        }
        .doc-banner-printed { font-size: 11px; font-weight: 400; opacity: 0.9; }

        /* ══ HEADER : 3 colonnes ══ */
        .doc-header {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 4mm;
          width: 100%;
          align-items: flex-start;
        }
        .doc-header-left { flex: 0 0 42%; }
        .doc-header-qr {
          flex: 0 0 90px;
          display: flex;
          flex-direction: column;
          align-items: center;
          padding-top: 4px;
        }
        .doc-header-qr img { display: block; }
        .doc-header-qr .qr-label {
          font-size: 8px;
          color: #666;
          margin-top: 3px;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          text-align: center;
        }
        .doc-header-right { flex: 1; min-width: 0; }

        .doc-logo { max-width: 165px; max-height: 60px; object-fit: contain; display: block; margin-bottom: 6px; }
        .doc-type {
          font-size: 22px; font-weight: 900;
          color: ${THEME}; margin-bottom: 6px;
          line-height: 1.1; letter-spacing: 0.02em;
          text-transform: uppercase;
        }
        .doc-meta-table { border-collapse: collapse; width: 100%; }
        .doc-meta-table td { padding: 1px 6px 1px 0; vertical-align: top; font-size: 11.5px; line-height: 1.35; }
        .doc-meta-label { font-weight: 700; color: ${BLACK}; white-space: nowrap; width: 50%; }

        /* ══ FENÊTRE ADRESSE LIVRAISON ══ */
        .doc-addr-window {
          padding: 10px 14px 10px 16px;
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
        .doc-addr-name { font-size: 17px; font-weight: 700; color: ${BLACK}; line-height: 1.3; margin-bottom: 3px; }
        .doc-addr-line { font-size: 15px; color: ${BLACK}; line-height: 1.35; font-weight: 400; }
        .doc-addr-tel { margin-top: 4px; font-size: 13px; font-weight: 600; }
        .doc-addr-email { font-size: 12px; color: #555; }

        .doc-pickup-badge {
          display: inline-block;
          background: ${ORANGE};
          color: white;
          padding: 4px 10px;
          border-radius: 4px;
          font-size: 12px;
          font-weight: 800;
          margin-bottom: 5px;
          letter-spacing: 0.05em;
        }

        /* ══ Adresse facturation (info secondaire) ══ */
        .doc-billing-info {
          background: #f3f4f6;
          padding: 7px 12px;
          border-radius: 4px;
          margin-bottom: 4mm;
          font-size: 11px;
          color: #555;
          display: flex;
          gap: 12px;
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

        /* ══ NOUVEAU : Bandeau remarques en haut (très visible) ══ */
        .doc-remarks-top {
          margin-bottom: 4mm;
          background: linear-gradient(90deg, #fef3c7 0%, #fef9c3 100%);
          border: 2px solid #f59e0b;
          border-radius: 6px;
          padding: 10px 14px;
          page-break-inside: avoid;
        }
        .doc-remarks-top-title {
          display: inline-block;
          background: #f59e0b;
          color: white;
          padding: 3px 10px;
          border-radius: 3px;
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          margin-bottom: 6px;
        }
        .doc-remarks-top-text {
          font-size: 12px;
          color: #1f2937;
          line-height: 1.55;
          white-space: pre-wrap;
          font-weight: 500;
        }

        /* ══ TABLEAU ══ */
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
        .doc-table thead th.th-right { text-align: right; }
        .doc-table tbody tr td {
          padding: 8px 4px;
          border-bottom: 1px solid #d1d5db;
          vertical-align: middle;
          font-size: 12px;
        }
        .doc-table tbody tr.row-product:nth-child(even) td { background: ${LIGHT}; }

        .td-img { width: 56px; vertical-align: middle; text-align: center; }
        .td-img img { max-width: 50px; max-height: 50px; object-fit: contain; }
        .td-img-placeholder {
          width: 50px; height: 50px;
          margin: 0 auto;
          border: 1px dashed #d1d5db;
          border-radius: 4px;
          display: flex; align-items: center; justify-content: center;
          font-size: 18px; color: #9ca3af;
        }
        .td-circles { width: 54px; text-align: center; }
        .td-qty { width: 60px; text-align: center; vertical-align: middle; }
        .td-stock { width: 78px; text-align: center; vertical-align: middle; }
        .td-price { width: 70px; text-align: right; vertical-align: middle; }
        .td-total { width: 78px; text-align: right; vertical-align: middle; font-weight: 700; }
        .td-desc { padding-left: 6px !important; }

        /* ── Cercles cmd/rés ── */
        .check-circle {
          display: inline-block;
          width: 16px; height: 16px;
          border: 1.8px solid #000;
          border-radius: 50%;
          margin: 0 1.5px;
          vertical-align: middle;
        }
        .check-circles-labels {
          display: block;
          font-size: 7.5px;
          color: #555;
          letter-spacing: 0.04em;
          margin-top: 2px;
          text-transform: uppercase;
        }

        /* ── Quantité ── */
        .qty-num {
          font-size: 24px;
          font-weight: 400;
          color: ${BLACK};
          line-height: 1;
        }
        .qty-num-multi {
          color: ${QTY_HIGHLIGHT};
          font-weight: 700;
        }
        .qty-x {
          font-size: 13px;
          color: #777;
          margin-left: 1px;
        }

        /* ── Description ── */
        .item-title { font-weight: 700; color: ${BLACK}; line-height: 1.3; font-size: 12px; }
        .item-sku-text { font-size: 10px; color: #555; margin-top: 1px; font-weight: 400; }
        .item-no-sku {
          display: inline-block;
          font-size: 9px;
          color: #92400e;
          background: #fef3c7;
          padding: 1px 6px;
          border-radius: 3px;
          margin-top: 2px;
          font-weight: 700;
          letter-spacing: 0.03em;
          text-transform: uppercase;
        }
        .item-barcode { margin-top: 3px; }
        .item-barcode svg { display: block; max-width: 100%; }
        /* Badge "À LA VOLÉE" pour les lignes custom */
        .item-custom-badge {
          display: inline-block;
          font-size: 9px;
          color: #1e40af;
          background: #dbeafe;
          padding: 1px 6px;
          border-radius: 3px;
          margin-right: 5px;
          font-weight: 700;
          letter-spacing: 0.03em;
          text-transform: uppercase;
          vertical-align: middle;
        }

        /* ── Stock ── */
        .stock-ok    { color: #2C7E3F; font-weight: 700; font-size: 12px; }
        .stock-low   { color: ${ORANGE}; font-weight: 700; font-size: 12px; }
        .stock-cmd   { color: #dc2626; font-weight: 700; font-size: 11px; }
        .stock-na    { color: #999; font-style: italic; font-size: 11px; }
        .stock-date  { display: block; font-size: 9px; color: #777; font-weight: 400; margin-top: 1px; }

        /* ── Prix ── */
        .price-val { font-size: 11.5px; color: ${BLACK}; }
        .line-discount { font-size: 10px; color: #2a8a2a; margin-top: 1px; }

        /* ── Lignes commentaires ── */
        .tr-comment td {
          background: #eef4fb !important;
          padding: 8px 12px !important;
          font-style: italic;
          color: #1e3a5f !important;
          font-size: 12px;
          font-weight: 600;
          border-left: 3px solid ${THEME} !important;
        }

        /* ══ BOTTOM ══ */
        .doc-bottom-wrap {
          display: flex;
          gap: 14px;
          margin-bottom: 4mm;
          align-items: flex-start;
        }
        .doc-notes-col { flex: 1; min-width: 0; }
        .doc-totals-col { flex: 0 0 46%; }

        /* Notes complémentaires en bas (rappel) — bordure plus discrète */
        .doc-notes-bottom-title {
          font-weight: 700;
          color: #555;
          margin-bottom: 4px;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .doc-notes-bottom-text {
          font-size: 11px;
          color: #555;
          line-height: 1.55;
          font-style: italic;
        }

        /* ── Tableau récap prix ── */
        .doc-pricing { width: 100%; border-collapse: collapse; }
        .doc-pricing td {
          padding: 5px 4px;
          font-size: 11.5px;
          border-bottom: 1px solid #efefef;
        }
        .doc-pricing tr:nth-child(even) td { background: ${LIGHT}; }
        .doc-pricing .pt-label { font-weight: 600; color: ${BLACK}; }
        .doc-pricing .pt-sub { font-size: 10.5px; padding-left: 14px !important; color: #555; font-weight: 400; }
        .doc-pricing .pt-value { text-align: right; white-space: nowrap; color: ${BLACK}; }
        .doc-pricing .pt-tva td { color: #666; font-size: 10.5px; }
        .doc-pricing .pt-total td {
          border-top: 2px solid ${THEME} !important;
          border-bottom: 2px solid ${THEME} !important;
          padding: 7px 4px !important;
          background: rgba(43, 138, 209, 0.08) !important;
        }
        .pt-total-label {
          font-weight: 900 !important;
          font-size: 14px !important;
          color: ${BLACK} !important;
        }
        .pt-total-value {
          font-weight: 900 !important;
          font-size: 14px !important;
          color: ${BLACK} !important;
          text-align: right;
          white-space: nowrap;
        }

        /* ── Acompte / Solde fillable — alignés à DROITE sous le TOTAL ── */
        .pt-fillable td {
          padding: 9px 4px !important;
          background: #fffbea !important;
          border-bottom: 1px dashed #f59e0b !important;
        }
        /* La cellule de la valeur : largeur fixe pour cadrer avec le total au-dessus */
        .pt-fillable .pt-value {
          text-align: right;
          font-size: 12px !important;
          color: #555 !important;
          letter-spacing: 0.05em;
          padding-right: 4px !important;
        }
        /* Trait sous la valeur (pour écrire dessus) */
        .pt-fillable .pt-fill-line {
          display: inline-block;
          width: 110px;
          border-bottom: 1.5px solid #888;
          height: 1px;
          vertical-align: middle;
        }

        .pt-paymentmode td {
          background: #f3f4f6 !important;
          font-size: 10.5px !important;
          padding: 6px 4px !important;
        }

        /* ══ ZONE SIGNATURE FINALE ══ */
        .doc-final-sign {
          margin-top: 5mm;
          border: 2px solid #000;
          border-radius: 4px;
          padding: 14px 18px;
          page-break-inside: avoid;
          background: #fafbfc;
        }
        .doc-final-sign-text {
          font-size: 13px;
          font-weight: 700;
          color: ${BLACK};
          letter-spacing: 0.03em;
          text-transform: uppercase;
          margin-bottom: 14px;
          text-align: center;
        }
        .doc-final-sign-row {
          display: flex;
          gap: 30px;
          align-items: flex-end;
        }
        .doc-final-sign-field { flex: 0 0 30%; }
        .doc-final-sign-field-large { flex: 1; }
        .doc-final-sign-line {
          height: 28px;
          border-bottom: 1.5px solid #555;
        }
        .doc-final-sign-label {
          font-size: 10px;
          color: #555;
          margin-top: 3px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          text-align: left;
        }

        .doc-footer-mini {
          margin-top: 4mm;
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

        {/* BANDEAU */}
        <div className="doc-banner">
          <span>📋 FICHE DE TRAVAIL — USAGE INTERNE</span>
          <span className="doc-banner-printed">Imprimée le {printedAt}</span>
        </div>

        {/* HEADER 3 colonnes */}
        <div className="doc-header">
          <div className="doc-header-left">
            <img className="doc-logo"
              src="https://cdn.shopify.com/s/files/1/0360/3251/2135/files/logo_JARDIN_CONFORT_shopify.jpg?v=1614107698"
              alt="Jardin-Confort" />
            <div className="doc-type">Fiche de travail</div>
            <table className="doc-meta-table">
              <tbody>
                <tr>
                  <td className="doc-meta-label">{numeroLabel}</td>
                  <td><strong>{numeroAffiche}</strong></td>
                </tr>
                {data.reference && (
                  <tr><td className="doc-meta-label">Référence</td><td>{data.reference}</td></tr>
                )}
                <tr><td className="doc-meta-label">{dateLabel}</td><td>{formatDate(dateDocument)}</td></tr>
                <tr><td className="doc-meta-label">Commercial</td><td>{data.commercial}</td></tr>
                {data.leadTime && (
                  <tr><td className="doc-meta-label">Délai de livraison</td><td>{data.leadTime}</td></tr>
                )}
                {data.deliveryMode && (
                  <tr><td className="doc-meta-label">Mode livraison</td><td><strong>{data.deliveryMode}</strong></td></tr>
                )}
                <tr><td className="doc-meta-label">Total articles</td><td><strong>{totalQty} pce{totalQty > 1 ? "s" : ""}</strong></td></tr>
              </tbody>
            </table>
          </div>

          <div className="doc-header-qr">
            <div id="qr-commande"></div>
            <div className="qr-label">Scan = N° {typeDocument === "Offre" ? "offre" : "cmd"}</div>
          </div>

          <div className="doc-header-right">
            <div className="doc-addr-window">
              <span className="doc-addr-window-title">📦 Adresse de livraison</span>
              <div className="doc-addr-ref">Réf : {numeroAffiche}</div>

              {isPickup && (
                <div className="doc-pickup-badge">⚠ À L'EMPORTER</div>
              )}

              {livrSociete && <div className="doc-addr-line">{livrSociete}</div>}
              <div className="doc-addr-name">{livrNom} {livrPrenom}</div>
              {livrRue && <div className="doc-addr-line">{livrRue} {livrNumero}</div>}
              {livrNpa && <div className="doc-addr-line">{livrNpa} {livrVille}</div>}
              {livrTelEffectif && <div className="doc-addr-tel">📞 {livrTelEffectif}</div>}
              {clientEmail && <div className="doc-addr-email">✉ {clientEmail}</div>}
            </div>
          </div>
        </div>

        {/* Adresse facturation si différente */}
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

        {/* ══ REMARQUES EN HAUT — AVANT LES ARTICLES (très visibles) ══ */}
        {data.remarks && data.remarks.trim() && (
          <div className="doc-remarks-top">
            <div className="doc-remarks-top-title">⚠ Notes / Instructions importantes</div>
            <div className="doc-remarks-top-text">{data.remarks}</div>
          </div>
        )}

        {/* TABLEAU ARTICLES */}
        <table className="doc-table">
          <thead>
            <tr>
              <th style={{width:56}}></th>
              <th className="th-center" style={{width:54}}>Cmd / Rés</th>
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
              // ─── Ligne COMMENTAIRE (bandeau bleu pâle, pleine largeur) ───
              if (line.type === "comment") {
                return (
                  <tr key={line.id} className="tr-comment">
                    <td colSpan={7}>💬 {line.title || <em style={{opacity:0.6}}>(commentaire vide)</em>}</td>
                  </tr>
                );
              }

              // ─── Ligne ARTICLE (product OU custom à la volée) ───
              const isCustom = line.type === "custom";

              // Stock
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

              const lineTotal = line.qty * line.unitPrice - (line.lineDiscount || 0);
              const isMultiQty = line.qty > 1;

              return (
                <tr key={line.id} className="row-product">
                  <td className="td-img">
                    {line.image ? (
                      <img src={line.image} alt="" />
                    ) : (
                      <div className="td-img-placeholder">{isCustom ? "✏️" : "—"}</div>
                    )}
                  </td>

                  <td className="td-circles">
                    <div>
                      <span className="check-circle"></span>
                      <span className="check-circle"></span>
                    </div>
                    <span className="check-circles-labels">cmd · rés</span>
                  </td>

                  <td className="td-qty">
                    <span className={`qty-num${isMultiQty ? " qty-num-multi" : ""}`}>{line.qty}</span>
                    <span className="qty-x">×</span>
                  </td>

                  <td className="td-desc">
                    <div className="item-title">
                      {isCustom && <span className="item-custom-badge">À la volée</span>}
                      {line.title}
                    </div>
                    {line.sku ? (
                      <>
                        <div className="item-sku-text">SKU : {line.sku}</div>
                        <div className="item-barcode">
                          <svg className="barcode-sku" data-sku={line.sku}></svg>
                        </div>
                      </>
                    ) : (
                      <span className="item-no-sku">⚠ Sans SKU</span>
                    )}
                  </td>

                  <td className="td-price">
                    <span className="price-val">{formatMoney(line.unitPrice)}</span>
                  </td>

                  <td className="td-total">
                    {formatMoney(lineTotal)}
                    {(line.lineDiscount || 0) > 0 && (
                      <div className="line-discount">− {formatMoney(line.lineDiscount || 0)}</div>
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

        {/* NOTES EN BAS (rappel discret) + TOTAUX COMPLETS */}
        <div className="doc-bottom-wrap">
          <div className="doc-notes-col">
            {data.remarks && data.remarks.trim() && (
              <>
                <div className="doc-notes-bottom-title">📌 Rappel des instructions</div>
                <div className="doc-notes-bottom-text">{data.remarks}</div>
              </>
            )}
          </div>

          <div className="doc-totals-col">
            <table className="doc-pricing">
              <tbody>
                <tr>
                  <td className="pt-label">Sous-total articles</td>
                  <td className="pt-value">{formatMoney(totals.subTotal)}</td>
                </tr>
                {totals.discountValue > 0 && (
                  <tr>
                    <td className="pt-label">Remise</td>
                    <td className="pt-value" style={{color:"#2a8a2a"}}>− {formatMoney(totals.discountValue)}</td>
                  </tr>
                )}
                {totals.discountValue > 0 && (
                  <tr>
                    <td className="pt-label">Après remise</td>
                    <td className="pt-value">{formatMoney(totals.totalAfterDiscount)}</td>
                  </tr>
                )}
                {activeServices.length > 0 && (
                  <>
                    <tr>
                      <td className="pt-label">Services</td>
                      <td className="pt-value">{formatMoney(totals.serviceTotal)}</td>
                    </tr>
                    {activeServices.map((srv, i) => (
                      <tr key={i}>
                        <td className="pt-sub">↳ {srv.label}</td>
                        <td className="pt-value" style={{fontSize:10.5}}>
                          {srv.amount === 0 ? "Offert" : formatMoney(srv.amount)}
                        </td>
                      </tr>
                    ))}
                  </>
                )}
                {totals.roundingValue !== 0 && (
                  <tr>
                    <td className="pt-label">Arrondi</td>
                    <td className="pt-value">{formatMoney(totals.roundingValue)}</td>
                  </tr>
                )}
                {totals.isPrivateTTC ? (
                  <tr className="pt-tva">
                    <td className="pt-label">TVA 8.1% incluse</td>
                    <td className="pt-value">{formatMoney(totals.tvaAmount)}</td>
                  </tr>
                ) : (
                  <>
                    <tr>
                      <td className="pt-label">Total HT</td>
                      <td className="pt-value">{formatMoney(totals.totalAfterRounding)}</td>
                    </tr>
                    <tr className="pt-tva">
                      <td className="pt-label">+ TVA 8.1%</td>
                      <td className="pt-value">{formatMoney(totals.tvaAmount)}</td>
                    </tr>
                  </>
                )}
                <tr className="pt-total">
                  <td className="pt-total-label">TOTAL {totals.isPrivateTTC ? "TTC" : "HT + TVA"}</td>
                  <td className="pt-total-value">{formatMoney(totals.finalTotal)}</td>
                </tr>

                {/* ─── Acompte / Solde — alignés à droite (dans la colonne value) ─── */}
                <tr className="pt-fillable">
                  <td className="pt-label">Acompte versé</td>
                  <td className="pt-value">
                    CHF&nbsp;<span className="pt-fill-line"></span>
                  </td>
                </tr>
                <tr className="pt-fillable">
                  <td className="pt-label">Solde à percevoir</td>
                  <td className="pt-value">
                    CHF&nbsp;<span className="pt-fill-line"></span>
                  </td>
                </tr>

                {data.paymentMode && (
                  <tr className="pt-paymentmode">
                    <td className="pt-label">Mode paiement</td>
                    <td className="pt-value" style={{fontSize:10.5}}>{data.paymentMode}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ZONE SIGNATURE CLIENT FINALE */}
        <div className="doc-final-sign">
          <div className="doc-final-sign-text">
            ✓ Marchandise contrôlée et reçue en parfait état
          </div>
          <div className="doc-final-sign-row">
            <div className="doc-final-sign-field">
              <div className="doc-final-sign-line"></div>
              <div className="doc-final-sign-label">Date</div>
            </div>
            <div className="doc-final-sign-field-large">
              <div className="doc-final-sign-line"></div>
              <div className="doc-final-sign-label">Signature client</div>
            </div>
          </div>
        </div>

        <div className="doc-footer-mini">
          Jardin-Confort SA · Route de Lavaux 425 · 1095 Lutry · +41 21 791 36 71 · Document interne — ne pas remettre au client
        </div>

      </div>
    </>
  );
}