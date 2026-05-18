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
  type: "product" | "custom" | "comment" | "media";
  image?: string;
  sku: string;
  title: string;
  unitPrice: number;
  qty: number;
  stock?: number | null | "sur_commande";
  lineDiscount?: number;
  // ── Lignes média ──
  mediaUrl?: string;
  mediaSize?: "small" | "medium" | "large";
  mediaSource?: "library" | "upload";
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
    if (l.type === "comment" || l.type === "media") return s;
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
  // ─── Session 3 chantier corrections : historique des corrections ───
  type CorrectionEntry = {
    id: string;
    corrected_at: string;
    corrected_by: string;
    reason: string;
    fields_changed: Record<string, { old: unknown; new: unknown }>;
  };
  const [corrections, setCorrections] = useState<CorrectionEntry[]>([]);
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

      // ─── Chargement des corrections (Session 3 chantier corrections) ───
      // Affiché en haut de la fiche, sous le bandeau, si >= 1 correction.
      // Détail complet : auteur, date, raison, champs modifiés (l'équipe
      // entrepôt doit savoir précisément ce qui a changé après préparation).
      //
      // ⚠️ On NE peut PAS lire `typeDocument` (state) ici car les setState
      // précédents ne sont pas encore appliqués (closure async React).
      // → On re-fetch le slug et on lit directement la réponse.
      try {
        const { slug: s } = await params;
        const offreRes = await fetch(`/api/offres/${s}?snapshot=false`);
        const offreJson = offreRes.ok ? await offreRes.json() : null;
        const localTypeDoc = (offreJson?.offre?.type_document as string) || "Commande";
        const entityType = localTypeDoc === "Offre" ? "offre" : "commande";

        const cRes = await fetch(`/api/corrections?entity_type=${entityType}&entity_slug=${encodeURIComponent(s)}`);
        if (cRes.ok) {
          const cJson = await cRes.json();
          setCorrections(cJson.corrections || []);
        }
      } catch (e) {
        console.error("Erreur chargement corrections:", e);
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
              width: 1.5,
              height: 22,            // ▼ encore réduit (avant 26)
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

      // 2e QR : "NomClient Mag" (utilisé pour identifier le client en magasin)
      if (qrcode && data.nom) {
        const qrClientEl = document.getElementById("qr-client");
        if (qrClientEl) {
          const refValue = `${data.nom} Mag`;
          const qr2 = qrcode(0, "M");
          qr2.addData(refValue);
          qr2.make();
          qrClientEl.innerHTML = qr2.createImgTag(3, 0);
        }
      }

      barcodesRendered.current = true;
    }).catch((err) => console.error("Erreur chargement librairies barcode:", err));
  }, [ready, data.lines, data.nom, numeroAffiche]);

  if (!ready) return <div style={{padding:40, textAlign:"center", color:GREY}}>Chargement…</div>;

  // Adresse livraison
  const livrSociete  = data.livrDiff ? data.livrSociete  : data.societe;
  const livrNom      = data.livrDiff ? data.livrNom      : data.nom;
  const livrPrenom   = data.livrDiff ? data.livrPrenom   : data.prenom;
  const livrComplementNomEffectif = data.livrDiff ? (data as any).livr_complement_nom : (data as any).complement_nom;
  const livrRue      = data.livrDiff ? data.livrRue      : data.rue;
  const livrNumero   = data.livrDiff ? data.livrNumero   : data.numero;
  const livrNpa      = data.livrDiff ? data.livrNpa      : data.npa;
  const livrVille    = data.livrDiff ? data.livrVille    : data.ville;
  const livrTelEffectif = (data.livrDiff && data.livrTel) ? data.livrTel : data.telephone1;
  const clientEmail = data.email;

  const isPickup = data.deliveryMode === "À l'emporter";
  const totalQty = data.lines.reduce((s, l) => (l.type === "comment" || l.type === "media") ? s : s + l.qty, 0);

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
        @page {
          size: A4 portrait;
          margin: 11mm 11mm 14mm 11mm;
          /* Pagination en bas à droite : Page X / N */
          @bottom-right {
            content: "Page " counter(page) " / " counter(pages);
            font-family: 'Raleway', Arial, sans-serif;
            font-size: 9px;
            color: #888;
            padding-right: 2mm;
          }
          @bottom-left {
            content: "Fiche de travail · Document interne";
            font-family: 'Raleway', Arial, sans-serif;
            font-size: 9px;
            color: #888;
            padding-left: 2mm;
          }
        }
        @media screen {
          .doc-wrap { max-width: 794px; margin: 0 auto; padding: 20px 28px; box-shadow: 0 0 20px rgba(0,0,0,0.08); }
          .print-btn { position: fixed; top: 16px; right: 16px; z-index: 100; background: ${THEME}; color: white; border: 0; padding: 10px 20px; border-radius: 6px; font-size: 14px; font-weight: 700; cursor: pointer; }
        }
        @media print { .print-btn { display: none !important; } }

        /* ══ BANDEAU TITRE ══ */
        .doc-banner {
          background: ${THEME};
          color: white;
          padding: 5px 12px;
          margin-bottom: 3mm;
          border-radius: 4px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.05em;
        }
        .doc-banner-printed { font-size: 10px; font-weight: 400; opacity: 0.9; }

        /* ══ HEADER : 3 colonnes ══ */
        .doc-header {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          margin-bottom: 3mm;
          width: 100%;
          align-items: flex-start;
        }
        .doc-header-left { flex: 0 0 42%; }
        .doc-header-qr {
          flex: 0 0 80px;
          display: flex;
          flex-direction: column;
          align-items: center;
          padding-top: 2px;
        }
        .doc-header-qr img { display: block; }
        .doc-header-qr .qr-second { margin-top: 6px; }
        .doc-header-qr .qr-label {
          font-size: 8px;
          color: #666;
          margin-top: 2px;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          text-align: center;
        }
        .doc-header-right { flex: 1; min-width: 0; }

        .doc-logo { max-width: 150px; max-height: 52px; object-fit: contain; display: block; margin-bottom: 4px; }
        .doc-type {
          font-size: 22px; font-weight: 400;
          color: ${THEME}; margin-bottom: 4px;
          line-height: 1.05; letter-spacing: 0;
          text-transform: none;
        }
        .doc-meta-table { border-collapse: collapse; width: 100%; }
        .doc-meta-table td { padding: 1px 6px 1px 0; vertical-align: top; font-size: 11px; line-height: 1.3; }
        .doc-meta-label { font-weight: 700; color: ${BLACK}; white-space: nowrap; width: 50%; }

        /* ══ FENÊTRE ADRESSE LIVRAISON ══ */
        .doc-addr-window {
          padding: 8px 12px 9px 14px;
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
          margin-bottom: 5px;
          text-transform: uppercase;
        }
        .doc-addr-ref { font-size: 10.5px; color: #666; font-weight: 400; margin-bottom: 3px; }
        .doc-addr-name { font-size: 16px; font-weight: 700; color: ${BLACK}; line-height: 1.25; margin-bottom: 2px; }
        .doc-addr-line { font-size: 14px; color: ${BLACK}; line-height: 1.3; font-weight: 400; }
        .doc-addr-tel { margin-top: 3px; font-size: 12.5px; font-weight: 600; }
        .doc-addr-email { font-size: 11.5px; color: #555; }

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

        /* ══ ACCÈS LIVRAISON (violet, pour distinguer des remarques générales) ══ */
        .doc-acces-livraison {
          margin-bottom: 4mm;
          background: linear-gradient(90deg, #f3e8ff 0%, #ede9fe 100%);
          border: 2px solid #8b5cf6;
          border-radius: 6px;
          padding: 10px 14px;
          page-break-inside: avoid;
        }
        .doc-acces-livraison-title {
          display: inline-block;
          background: #8b5cf6;
          color: white;
          padding: 3px 10px;
          border-radius: 3px;
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          margin-bottom: 6px;
        }
        .doc-acces-livraison-text {
          font-size: 12px;
          color: #1f2937;
          line-height: 1.55;
          white-space: pre-wrap;
          font-weight: 500;
        }

        /* ══ TABLEAU ══ */
        .doc-table { width: 100%; border-collapse: collapse; margin-bottom: 3mm; }
        .doc-table thead th {
          padding: 6px 4px;
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
          padding: 5px 4px;
          border-bottom: 1px solid #d1d5db;
          vertical-align: middle;
          font-size: 11.5px;
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
          width: 11px; height: 11px;
          border: 1.4px solid #000;
          border-radius: 50%;
          margin: 0 1px;
          vertical-align: middle;
        }
        .check-circles-labels {
          display: block;
          font-size: 6.5px;
          color: #555;
          letter-spacing: 0.04em;
          margin-top: 2px;
          font-weight: 600;
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

        /* ── Lignes média (logo / image) ── */
        .tr-media td {
          background: white !important;
          padding: 12px 4px !important;
          text-align: center !important;
          border-bottom: 1px solid #d1d5db !important;
          border-left: 3px solid #a855f7 !important;
        }
        .tr-media img { width: auto; object-fit: contain; display: inline-block; vertical-align: middle; }
        .tr-media td { text-align: center !important; }
        .media-small  { max-height: 22px !important; max-width: 80px !important; width: auto !important; height: auto !important; object-fit: contain !important; display: inline-block !important; }
        .media-medium { max-height: 50px !important; max-width: 180px !important; width: auto !important; height: auto !important; object-fit: contain !important; display: inline-block !important; }
        .media-large  { max-height: 110px !important; max-width: 350px !important; width: auto !important; height: auto !important; object-fit: contain !important; display: inline-block !important; }
        .media-img-small  { max-height: 80px !important; max-width: 200px !important; width: auto !important; height: auto !important; object-fit: contain !important; display: inline-block !important; }
        .media-img-medium { max-height: 180px !important; max-width: 400px !important; width: auto !important; height: auto !important; object-fit: contain !important; display: inline-block !important; }
        .media-img-large  { max-height: 320px !important; max-width: 700px !important; width: auto !important; height: auto !important; object-fit: contain !important; display: inline-block !important; }

        /* ══ BOTTOM ══ */
        .doc-bottom-wrap {
          display: flex;
          gap: 14px;
          margin-bottom: 4mm;
          align-items: stretch; /* les 2 colonnes ont la même hauteur */
        }
        .doc-notes-col {
          flex: 1; min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
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

        /* ── Acompte / Solde fillable — cellules vides à remplir à la main ── */
        .pt-fillable td {
          padding: 14px 4px !important;
          background: #fffbea !important;
          border-bottom: 1px dashed #f59e0b !important;
        }
        /* La cellule de la valeur : juste "CHF" en gris discret, le reste vide pour écrire */
        .pt-fillable .pt-value {
          text-align: right;
          padding-right: 6px !important;
        }
        .pt-fill-empty {
          font-size: 12px;
          color: #999;
          font-weight: 400;
          letter-spacing: 0.05em;
        }

        .pt-paymentmode td {
          background: #f3f4f6 !important;
          font-size: 10.5px !important;
          padding: 6px 4px !important;
        }

        /* ══ BLOC ADRESSE DE FACTURATION (colonne gauche, au-dessus de la signature) ══ */
        .doc-billing-block {
          background: #f3f4f6;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          padding: 8px 12px 9px;
        }
        .doc-billing-block-title {
          font-size: 10px;
          font-weight: 700;
          color: #555;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          margin-bottom: 4px;
          padding-bottom: 3px;
          border-bottom: 1px solid #d1d5db;
        }
        .doc-billing-block-content {
          font-size: 11.5px;
          color: ${BLACK};
          line-height: 1.4;
        }
        .doc-billing-name {
          font-weight: 700;
          font-size: 12.5px;
          margin: 1px 0;
        }
        .doc-billing-contact {
          margin-top: 3px;
          font-size: 10.5px;
          color: #555;
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }

        /* ══ ZONE SIGNATURE FINALE (déplacée dans la colonne gauche) ══ */
        .doc-final-sign {
          margin-top: auto; /* pousse en bas de la colonne notes pour aligner avec totaux */
          border: 2px solid #000;
          border-radius: 4px;
          padding: 12px 14px 14px;
          page-break-inside: avoid;
          background: #f0faf2; /* vert très clair (rappel "OK") */
        }
        .doc-final-sign-text {
          font-size: 11.5px;
          font-weight: 700;
          color: ${BLACK};
          letter-spacing: 0.03em;
          text-transform: uppercase;
          margin-bottom: 14px;
          text-align: center;
        }
        .doc-final-sign-row {
          display: flex;
          gap: 18px;
          align-items: flex-end;
        }
        .doc-final-sign-field { flex: 0 0 32%; }
        .doc-final-sign-field-large { flex: 1; }
        .doc-final-sign-line {
          height: 26px;
          border-bottom: 1.5px solid #555;
        }
        .doc-final-sign-label {
          font-size: 9.5px;
          color: #555;
          margin-top: 2px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          text-align: left;
        }

        /* Footer remplacé par @page @bottom-left+@bottom-right qui s'affiche sur chaque page */
        .doc-footer-mini { display: none; }

        /* ══ HISTORIQUE DES CORRECTIONS (Session 3) ══ */
        /* Bloc placé en fin de document. On AUTORISE explicitement la
           coupure entre les pages : on préfère voir le DÉBUT du bloc en
           bas de la dernière page de la fiche plutôt que de pousser tout
           le bloc sur une nouvelle page (au risque qu'il ne soit pas vu).
           Le titre rouge "DOCUMENT CORRIGÉ" reste alors visible en pied
           et alerte le commercial qui tournera la page pour voir le détail. */
        .doc-corrections-block {
          margin-top: 4mm;
          margin-bottom: 2mm;
          background: linear-gradient(90deg, #fee2e2 0%, #fecaca 100%);
          border: 2px solid #dc2626;
          border-radius: 6px;
          padding: 10px 14px;
          /* page-break-inside: auto par défaut → on laisse couper si besoin */
        }
        /* En revanche, on garde l'EN-TÊTE (titre + intro) groupé : si on
           commence le bloc en bas de page, on veut au moins ces 2 éléments
           côte à côte. */
        .doc-corrections-head {
          page-break-inside: avoid;
          page-break-after: avoid;
        }
        /* Et chaque correction individuelle reste insécable pour ne pas
           qu'une ligne unique soit coupée en 2. */
        .doc-correction-item {
          page-break-inside: avoid;
        }
        .doc-corrections-title {
          display: inline-block;
          background: #dc2626;
          color: white;
          padding: 3px 10px;
          border-radius: 3px;
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          margin-bottom: 8px;
        }
        .doc-corrections-intro {
          font-size: 11px;
          color: #7f1d1d;
          font-weight: 600;
          margin-bottom: 8px;
        }
        .doc-correction-item {
          background: white;
          border: 1px solid #fca5a5;
          border-radius: 4px;
          padding: 5px 9px;
          margin-bottom: 3px;
          font-size: 10.5px;
          line-height: 1.5;
          display: flex;
          flex-wrap: wrap;
          align-items: baseline;
          gap: 0;
        }
        .doc-correction-item:last-child { margin-bottom: 0; }
        .doc-correction-version {
          background: #dc2626;
          color: white;
          padding: 1px 6px;
          border-radius: 3px;
          font-size: 9.5px;
          font-weight: 700;
          margin-right: 6px;
          flex-shrink: 0;
        }
        .doc-correction-author {
          font-weight: 700;
          color: #1f2937;
          margin-right: 6px;
        }
        .doc-correction-date {
          font-size: 9.5px;
          color: #6b7280;
        }
        .doc-correction-sep {
          margin: 0 6px;
          color: #cbd5e1;
          font-weight: 400;
        }
        .doc-correction-reason {
          font-style: italic;
          color: #1f2937;
        }
        .doc-correction-field-label {
          font-weight: 700;
          color: #7f1d1d;
        }
        .doc-correction-old {
          text-decoration: line-through;
          color: #9ca3af;
        }
        .doc-correction-arrow {
          margin: 0 4px;
          color: #dc2626;
          font-weight: 700;
        }
        .doc-correction-new {
          color: #1f2937;
          font-weight: 600;
        }
        .doc-correction-multifield {
          color: #7f1d1d;
        }
      `}</style>

      <button className="print-btn" onClick={() => window.print()}>🖨 Imprimer</button>

      <div className="doc-wrap">

        {/* BANDEAU */}
        <div className="doc-banner">
          <span>📋 FICHE DE TRAVAIL — USAGE INTERNE{numeroAffiche ? ` · ${numeroAffiche}` : ""}</span>
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

            {/* 2e QR code : "Ref: NomClient Mag" (équivalent du QR Shopify) */}
            <div id="qr-client" className="qr-second"></div>
            <div className="qr-label">Ref client</div>
          </div>

          <div className="doc-header-right">
            <div className="doc-addr-window">
              <span className="doc-addr-window-title">📦 Adresse de livraison</span>
              <div className="doc-addr-ref">Réf : {numeroAffiche}</div>

              {isPickup ? (
                <>
                  <div className="doc-pickup-badge">⚠ À L'EMPORTER</div>
                  <div style={{
                    fontSize: 12,
                    color: "#666",
                    fontStyle: "italic",
                    lineHeight: 1.5,
                    marginTop: 4,
                  }}>
                    Le client viendra retirer la marchandise<br/>
                    <strong style={{color:"#000", fontStyle:"normal"}}>Jardin-Confort SA</strong><br/>
                    Route de Lavaux 425 · 1095 Lutry
                  </div>
                  <div className="doc-addr-name" style={{marginTop: 8, fontSize: 13}}>
                    Client : {data.nom} {data.prenom}
                  </div>
                  {livrTelEffectif && <div className="doc-addr-tel">📞 {livrTelEffectif}</div>}
                  {clientEmail && <div className="doc-addr-email">✉ {clientEmail}</div>}
                </>
              ) : (
                <>
                  {livrSociete && <div className="doc-addr-line">{livrSociete}</div>}
                  <div className="doc-addr-name">{livrNom} {livrPrenom}</div>
                  {livrComplementNomEffectif && <div className="doc-addr-line">{livrComplementNomEffectif}</div>}
                  {livrRue && <div className="doc-addr-line">{livrRue} {livrNumero}</div>}
                  {livrNpa && <div className="doc-addr-line">{livrNpa} {livrVille}</div>}
                  {livrTelEffectif && <div className="doc-addr-tel">📞 {livrTelEffectif}</div>}
                  {clientEmail && <div className="doc-addr-email">✉ {clientEmail}</div>}
                </>
              )}
            </div>
          </div>
        </div>

        {/* (L'adresse de facturation est désormais affichée dans la colonne gauche en bas) */}

        {/* ══ REMARQUES EN HAUT — AVANT LES ARTICLES (très visibles) ══ */}
        {data.remarks && data.remarks.trim() && (
          <div className="doc-remarks-top">
            <div className="doc-remarks-top-title">⚠ Notes / Instructions importantes</div>
            <div className="doc-remarks-top-text">{data.remarks}</div>
          </div>
        )}

        {/* ══ ACCÈS LIVRAISON — caché si "À l'emporter" ══ */}
        {data.accesLivraison && data.accesLivraison.trim() && !isPickup && (
          <div className="doc-acces-livraison">
            <div className="doc-acces-livraison-title">🏢 Accès livraison / étage</div>
            <div className="doc-acces-livraison-text">{data.accesLivraison}</div>
          </div>
        )}

        {/* TABLEAU ARTICLES */}
        <table className="doc-table">
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
              // ─── Ligne COMMENTAIRE (bandeau bleu pâle, pleine largeur) ───
              if (line.type === "comment") {
                return (
                  <tr key={line.id} className="tr-comment">
                    <td colSpan={7}>💬 {line.title || <em style={{opacity:0.6}}>(commentaire vide)</em>}</td>
                  </tr>
                );
              }

              // ─── Ligne MÉDIA (logo de marque, sépare visuellement les groupes) ───
              if (line.type === "media") {
                if (!line.mediaUrl) return null;
                const prefix = line.mediaSource === "upload" ? "media-img-" : "media-";
                const sizeClass = line.mediaSize === "small" ? prefix + "small" : line.mediaSize === "large" ? prefix + "large" : prefix + "medium";
                return (
                  <tr key={line.id} className="tr-media">
                    <td colSpan={7}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={line.mediaUrl} alt={line.title || ""} className={sizeClass} />
                    </td>
                  </tr>
                );
              }

              // ─── Ligne ARTICLE (product OU custom à la volée) ───
              const isCustom = line.type === "custom";

              // Détection ligne Shopify locked (flag explicite OU id "shopify-*" rétroactif)
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const isLockedFT = (line as any).shopifyLocked === true || line.id?.startsWith("shopify-");

              // Stock
              let stockDisplay: React.ReactNode;
              if (line.stock === undefined || line.stock === null) {
                // Si ligne Shopify locked → SKU introuvable côté API → badge clair pour l'entrepôt
                stockDisplay = isLockedFT
                  ? <span style={{ color: "#ea580c", fontWeight: 700, fontSize: 11 }}>⚠ À vérifier</span>
                  : <span className="stock-na">—</span>;
              } else if (line.stock === "sur_commande" || line.stock === 0) {
                stockDisplay = <span className="stock-cmd">Sur commande</span>;
              } else if (typeof line.stock === "number") {
                const sn = line.stock;
                const qty = line.qty || 0;
                if (sn >= qty) {
                  stockDisplay = <span className="stock-ok">✓ En stock ({sn} pce{sn > 1 ? "s" : ""})</span>;
                } else if (sn > 0 && sn < qty) {
                  stockDisplay = <span className="stock-low">🟠 Stock partiel ({sn} / {qty} pce{qty > 1 ? "s" : ""})</span>;
                } else {
                  stockDisplay = <span className="stock-low">⚠ {sn} pce{sn > 1 ? "s" : ""}</span>;
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
                    <span className="check-circles-labels">Rès · cdé</span>
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

        {/* NOTES EN BAS + SIGNATURE (colonne gauche) + TOTAUX COMPLETS (colonne droite) */}
        <div className="doc-bottom-wrap">
          <div className="doc-notes-col">
            {data.remarks && data.remarks.trim() && (
              <>
                <div className="doc-notes-bottom-title">📌 Rappel des instructions</div>
                <div className="doc-notes-bottom-text">{data.remarks}</div>
              </>
            )}

            {/* ─── Bloc adresse de facturation (toujours visible) ─── */}
            <div className="doc-billing-block">
              <div className="doc-billing-block-title">💼 Adresse de facturation</div>
              <div className="doc-billing-block-content">
                {data.societe && <div>{data.societe}</div>}
                <div className="doc-billing-name">{data.nom} {data.prenom}</div>
                {(data as any).complement_nom && <div>{(data as any).complement_nom}</div>}
                {data.rue && <div>{data.rue} {data.numero}</div>}
                {data.npa && <div>{data.npa} {data.ville}</div>}
                <div className="doc-billing-contact">
                  {data.telephone1 && <span>📞 {data.telephone1}</span>}
                  {data.email && <span>✉ {data.email}</span>}
                </div>
              </div>
            </div>
            {/* ──────────────────────────────────────────────────── */}

            {/* ─── ZONE SIGNATURE CLIENT — déplacée à gauche pour gagner de la hauteur ─── */}
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

                {/* ─── Acompte / Solde — cellules vides à remplir à la main ─── */}
                <tr className="pt-fillable">
                  <td className="pt-label">Acompte versé</td>
                  <td className="pt-value"></td>
                </tr>
                <tr className="pt-fillable">
                  <td className="pt-label">Solde à percevoir</td>
                  <td className="pt-value"></td>
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

        {/* (Le bloc signature a été déplacé dans la colonne gauche, à côté des totaux) */}

        {/* ══ HISTORIQUE DES CORRECTIONS (Session 3 chantier corrections) ══ */}
        {/* Placé en FIN de document avec coupure de page autorisée : si le
            bloc dépasse en bas de la page courante, le DÉBUT (titre rouge
            "DOCUMENT CORRIGÉ") reste visible en pied, ce qui alerte le
            commercial qui tournera la page pour voir le détail. Contraire
            au pattern "tout ou rien" qui risquerait de masquer la
            notification entière sur une page suivante non lue. */}
        {corrections.length > 0 && (
          <div className="doc-corrections-block">
            <div className="doc-corrections-head">
              <div className="doc-corrections-title">⚠ Document corrigé · {corrections.length} correction{corrections.length > 1 ? "s" : ""}</div>
              <div className="doc-corrections-intro">
                Cette fiche reflète les corrections suivantes appliquées après création initiale.
                Vérifier que le dossier physique a bien été mis à jour.
              </div>
            </div>
            {corrections.map((c, idx) => {
              const version = corrections.length - idx + 1; // doc initial = v1, première correction = v2
              const date = new Date(c.corrected_at).toLocaleString("fr-CH", {
                day: "2-digit", month: "2-digit", year: "2-digit",
                hour: "2-digit", minute: "2-digit",
              });
              const formatVal = (v: unknown) => {
                if (typeof v === "boolean") return v ? "Oui" : "Non";
                if (v === null || v === undefined || v === "") return "(vide)";
                return String(v);
              };
              const labels: Record<string, string> = {
                paymentMode: "Mode de paiement",
                deliveryMode: "Mode de livraison",
                leadTime: "Délai de livraison",
                societe: "Société",
                nom: "Nom",
                prenom: "Prénom",
                complement_nom: "Complément nom",
                rue: "Rue",
                numero: "N°",
                rue2: "Complément d'adresse",
                npa: "NPA",
                ville: "Ville",
                telephone1: "Téléphone 1",
                telephone2: "Téléphone 2",
                email: "Email",
                livrDiff: "Adresse livraison différente",
                livrSociete: "Société livraison",
                livrNom: "Nom livraison",
                livrPrenom: "Prénom livraison",
                livr_complement_nom: "Complément nom livraison",
                livrRue: "Rue livraison",
                livrNumero: "N° livraison",
                livrRue2: "Complément d'adresse livraison",
                livrNpa: "NPA livraison",
                livrVille: "Ville livraison",
                livrTel: "Téléphone livraison",
                accesLivraison: "Accès livraison",
                remarks: "Remarques",
                notesInternes: "Notes internes",
              };
              const fieldEntries = Object.entries(c.fields_changed);
              const isSingleField = fieldEntries.length === 1;

              return (
                <div key={c.id} className="doc-correction-item">
                  <span className="doc-correction-version">v{version}</span>
                  <span className="doc-correction-author">{c.corrected_by}</span>
                  <span className="doc-correction-date">{date}</span>
                  <span className="doc-correction-sep">/</span>
                  <span className="doc-correction-reason">« {c.reason} »</span>
                  <span className="doc-correction-sep">/</span>
                  {isSingleField ? (
                    fieldEntries.map(([key, change]) => (
                      <React.Fragment key={key}>
                        <span className="doc-correction-field-label">{labels[key] || key} :</span>
                        <span className="doc-correction-old" style={{marginLeft: 4}}>{formatVal(change.old)}</span>
                        <span className="doc-correction-arrow">→</span>
                        <span className="doc-correction-new">{formatVal(change.new)}</span>
                      </React.Fragment>
                    ))
                  ) : (
                    <span className="doc-correction-multifield">
                      {fieldEntries.map(([key, change], i) => (
                        <React.Fragment key={key}>
                          {i > 0 && <span className="doc-correction-sep">·</span>}
                          <span className="doc-correction-field-label">{labels[key] || key} :</span>{" "}
                          <span className="doc-correction-old">{formatVal(change.old)}</span>
                          <span className="doc-correction-arrow">→</span>
                          <span className="doc-correction-new">{formatVal(change.new)}</span>
                        </React.Fragment>
                      ))}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}

      </div>
    </>
  );
}