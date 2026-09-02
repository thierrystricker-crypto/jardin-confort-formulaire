"use client";
// ═══════════════════════════════════════════════════════════════
//  app/print/bulletin-livraison/[slug]/page.tsx
//  Template d'impression — BULLETIN DE LIVRAISON (sans prix)
//  Basé sur le template Commande, mais sans prix/totaux/TVA
//  Uniquement pour les commandes internes (CMD-XXXXX)
//
//  02.09.2026 — « Bulletin à la volée » : la page devient ÉDITABLE À L'ÉCRAN
//  (envoi partiel, ligne ajoutée, quantité modifiée) et peut ENREGISTRER un
//  PDF dans l'historique (table bulletins_livraison, bucket pdfs/bulletins/).
//    • Ouverte sans rien toucher, elle imprime exactement la commande.
//    • Rien n'écrit jamais dans `offres` : la commande reste la preuve.
//    • Tout l'appareil d'édition est masqué à l'impression (@media print).
//    • ?bulletin=<uuid> → affiche un bulletin ENREGISTRÉ, en lecture seule
//      (réimpression depuis le dashboard, et rendu pdf.co).
// ═══════════════════════════════════════════════════════════════

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  PrintData, QuoteLine,
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

// ── Ligne éditable du bulletin ──────────────────────────────────
// `sourceId` = id de la ligne de la commande (null si ajoutée ici).
// `removed`  = retirée de CE bulletin (reste visible à l'écran, grisée,
//              pour pouvoir la remettre ; jamais imprimée).
type BLine = {
  key: string;
  sourceId: string | null;
  type: "product" | "custom" | "comment" | "media";
  sku: string;
  title: string;
  qty: number;
  qtyOrig: number;
  image?: string;
  mediaUrl?: string;
  mediaSize?: "small" | "medium" | "large";
  mediaSource?: "library" | "upload";
  removed: boolean;
  added: boolean;
};

// Bulletin enregistré (forme de la table bulletins_livraison)
type SavedLine = {
  sourceId: string | null; type: BLine["type"]; sku: string; title: string; qty: number;
  image?: string; mediaUrl?: string; mediaSize?: BLine["mediaSize"]; mediaSource?: BLine["mediaSource"];
};
type SavedBulletin = {
  id: string;
  numero_bulletin: number;
  mention: string | null;
  lines: SavedLine[];
  nb_lignes: number;
  nb_pieces: number;
  pdf_url: string | null;
  date_bulletin: string | null;
  created_at: string;
};

function fromQuoteLine(l: QuoteLine): BLine {
  return {
    key: `src-${l.id}`,
    sourceId: l.id,
    type: l.type,
    sku: l.sku || "",
    title: l.title || "",
    qty: l.qty || 0,
    qtyOrig: l.qty || 0,
    image: l.image,
    mediaUrl: l.mediaUrl,
    mediaSize: l.mediaSize,
    mediaSource: l.mediaSource,
    removed: false,
    added: false,
  };
}

function fromSavedLine(l: SavedLine, i: number): BLine {
  return {
    key: `saved-${i}`,
    sourceId: l.sourceId,
    type: l.type,
    sku: l.sku || "",
    title: l.title || "",
    qty: l.qty || 0,
    qtyOrig: l.qty || 0,
    image: l.image,
    mediaUrl: l.mediaUrl,
    mediaSize: l.mediaSize,
    mediaSource: l.mediaSource,
    removed: false,
    added: l.sourceId === null,
  };
}

const isArticle = (l: { type: BLine["type"] }) => l.type === "product" || l.type === "custom";

// Date locale au format YYYY-MM-DD (pas toISOString : décalage UTC le soir)
function aujourdhuiIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function PrintBulletinLivraisonSlug({ params }: { params: Promise<{ slug: string }> }) {
  const [slug, setSlug] = useState("");
  const [data, setData] = useState<PrintData>(EMPTY);
  const [ready, setReady] = useState(false);
  const [numeroAffiche, setNumeroAffiche] = useState("");

  // ── Édition ──
  const [lines, setLines] = useState<BLine[]>([]);
  const [mention, setMention] = useState("");
  // Date du bulletin (= date d'envoi). SANS lien avec la date de commande,
  // sauf une règle : jamais antérieure à celle-ci. Pré-remplie à aujourd'hui.
  const [dateBulletin, setDateBulletin] = useState(aujourdhuiIso());
  const [saved, setSaved] = useState<SavedBulletin[]>([]);            // historique de la commande
  const [viewing, setViewing] = useState<SavedBulletin | null>(null); // mode ?bulletin=<id> (lecture seule)
  const [showAdd, setShowAdd] = useState(false);
  const [addTitle, setAddTitle] = useState("");
  const [addSku, setAddSku] = useState("");
  const [addQty, setAddQty] = useState("1");
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{ ok: boolean; msg: string; url?: string } | null>(null);

  // La barre est fixe et peut passer sur deux lignes (écran étroit) : le
  // dégagement au-dessus du document suit sa hauteur réelle.
  const barRef = useRef<HTMLDivElement | null>(null);
  const [barHeight, setBarHeight] = useState(52);
  useEffect(() => {
    const el = barRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setBarHeight(el.offsetHeight));
    ro.observe(el);
    setBarHeight(el.offsetHeight);
    return () => ro.disconnect();
  }, [ready]);

  useEffect(() => {
    async function load() {
      const { slug } = await params;
      setSlug(slug);
      const qs = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
      const bulletinId = qs?.get("bulletin") || "";
      // pdf.co rend cette page avec ?jc_token=… : on le transmet à l'API du
      // bulletin, qui n'est pas publique (proxy.ts l'accepte pour ce GET).
      const jcToken = qs?.get("jc_token") || "";
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
            const base: QuoteLine[] = Array.isArray(offreData.lines) ? offreData.lines : [];
            setLines(base.map(fromQuoteLine));
          }
        }
      } catch (e) {
        console.error("Erreur chargement commande:", e);
      }

      if (bulletinId) {
        // Mode lecture seule : un bulletin déjà enregistré
        try {
          const url = `/api/bulletins-livraison/${bulletinId}` + (jcToken ? `?jc_token=${encodeURIComponent(jcToken)}` : "");
          const r = await fetch(url);
          if (r.ok) {
            const j = await r.json();
            const b: SavedBulletin | undefined = j.bulletin;
            if (b) {
              setViewing(b);
              setMention(b.mention || "");
              if (b.date_bulletin) setDateBulletin(b.date_bulletin);
              setLines((b.lines || []).map(fromSavedLine));
            }
          }
        } catch (e) {
          console.error("Erreur chargement bulletin:", e);
        }
      } else {
        // Mode édition : historique pour le compteur et le « reste à livrer »
        try {
          const r = await fetch(`/api/bulletins-livraison?slug=${encodeURIComponent(slug)}`);
          if (r.ok) {
            const j = await r.json();
            setSaved(Array.isArray(j.bulletins) ? j.bulletins : []);
          }
        } catch { /* historique facultatif */ }
      }
      setReady(true);
    }
    load();
  }, [params]);

  // ── Dérivés ──
  const visibles = useMemo(() => lines.filter((l) => !l.removed), [lines]);
  const articlesVisibles = visibles.filter(isArticle);
  const articlesTotal = lines.filter(isArticle).length;
  const piecesVisibles = articlesVisibles.reduce((s, l) => s + l.qty, 0);
  const modifie = lines.some((l) => l.removed || l.added || (isArticle(l) && l.qty !== l.qtyOrig)) || mention.trim() !== "";
  // Date de commande au format YYYY-MM-DD (borne basse de la date du bulletin)
  const dateCommandeIso = (data.date || "").slice(0, 10);
  const dateInvalide = !!dateBulletin && !!dateCommandeIso && dateBulletin < dateCommandeIso;

  // « Reste à livrer » : quantité d'origine − ce qui figure déjà sur les
  // bulletins enregistrés (par sourceId). Les lignes ajoutées aux bulletins
  // précédents n'entrent pas dans le calcul (elles n'ont pas de sourceId).
  const dejaLivre = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of saved) for (const l of b.lines || []) {
      if (l.sourceId && isArticle(l)) m.set(l.sourceId, (m.get(l.sourceId) || 0) + (l.qty || 0));
    }
    return m;
  }, [saved]);
  const resteALivrerDisponible = saved.length > 0 && lines.some((l) => isArticle(l) && !!l.sourceId && (dejaLivre.get(l.sourceId) || 0) > 0);

  // ── Actions ──
  function setQty(key: string, v: string) {
    const n = Math.max(1, Math.floor(Number(v) || 1));
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, qty: n } : l)));
  }
  function toggleRemoved(key: string) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, removed: !l.removed } : l)));
  }
  function supprimerAjoutee(key: string) {
    setLines((ls) => ls.filter((l) => l.key !== key));
  }
  function toutRemettre() {
    setLines((ls) => ls.filter((l) => !l.added).map((l) => ({ ...l, removed: false, qty: l.qtyOrig })));
    setMention("");
    setSaveResult(null);
  }
  function appliquerResteALivrer() {
    setLines((ls) => ls.map((l) => {
      if (!isArticle(l) || !l.sourceId) return l;
      const reste = l.qtyOrig - (dejaLivre.get(l.sourceId) || 0);
      if (reste <= 0) return { ...l, removed: true, qty: l.qtyOrig };
      return { ...l, removed: false, qty: reste };
    }));
    if (!mention.trim()) setMention(`Livraison ${saved.length + 1} — solde`);
  }
  function ajouterLigne() {
    const title = addTitle.trim();
    if (!title) return;
    const qty = Math.max(1, Math.floor(Number(addQty) || 1));
    setLines((ls) => [...ls, {
      key: `add-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      sourceId: null, type: "custom", sku: addSku.trim(), title, qty, qtyOrig: qty,
      removed: false, added: true,
    }]);
    setAddTitle(""); setAddSku(""); setAddQty("1"); setShowAdd(false);
  }
  async function enregistrerPdf() {
    if (saving) return;
    if (articlesVisibles.length === 0) { setSaveResult({ ok: false, msg: "Le bulletin ne contient aucun article." }); return; }
    if (!dateBulletin) { setSaveResult({ ok: false, msg: "Indiquez la date du bulletin." }); return; }
    if (dateInvalide) { setSaveResult({ ok: false, msg: `La date du bulletin ne peut pas être antérieure à la date de commande (${formatDate(data.date)}).` }); return; }
    setSaving(true); setSaveResult(null);
    try {
      const payload = {
        slug,
        mention: mention.trim(),
        date_bulletin: dateBulletin,
        lines: visibles.map((l) => ({
          sourceId: l.sourceId, type: l.type, sku: l.sku, title: l.title, qty: l.qty,
          image: l.image, mediaUrl: l.mediaUrl, mediaSize: l.mediaSize, mediaSource: l.mediaSource,
        })),
      };
      const r = await fetch("/api/bulletins-livraison", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (r.ok && j.success) {
        setSaveResult({ ok: true, msg: `Bulletin n° ${j.bulletin.numero_bulletin} enregistré.`, url: j.bulletin.pdf_url });
      } else {
        setSaveResult({ ok: false, msg: (j.error || "Erreur inconnue") + (j.bulletin ? " — le bulletin est tout de même dans l'historique, sans PDF." : "") });
      }
      // Rafraîchir l'historique (compteur, reste à livrer)
      try {
        const rr = await fetch(`/api/bulletins-livraison?slug=${encodeURIComponent(slug)}`);
        if (rr.ok) { const jj = await rr.json(); setSaved(Array.isArray(jj.bulletins) ? jj.bulletins : []); }
      } catch { /* facultatif */ }
    } catch (e) {
      setSaveResult({ ok: false, msg: "Erreur réseau : " + (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

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

  const editable = !viewing;
  const mentionImprimee = mention.trim();

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
        }

        /* ── Barre d'édition (écran seulement) ─────────────────────── */
        .bl-bar { position: fixed; top: 0; left: 0; right: 0; z-index: 100; background: #1f2226; color: #e5e7eb; display: flex; align-items: center; gap: 8px; padding: 8px 14px; flex-wrap: wrap; box-shadow: 0 2px 10px rgba(0,0,0,.35); font-family: 'Raleway', Arial, sans-serif; }
        .bl-bar .bl-count { font-size: 12px; color: #a1a1aa; margin-right: auto; }
        .bl-bar .bl-count b { color: #fff; }
        .bl-btn { border: 1px solid rgba(255,255,255,.15); background: #34383d; color: #e5e7eb; padding: 7px 12px; border-radius: 8px; font-size: 13px; font-weight: 700; cursor: pointer; white-space: nowrap; text-decoration: none; font-family: inherit; }
        .bl-btn:hover { background: #40454b; }
        .bl-btn:disabled { opacity: .45; cursor: default; }
        .bl-btn.primary { background: ${THEME}; border-color: ${THEME}; color: white; }
        .bl-btn.primary:hover { background: #2477b3; }
        .bl-btn.save { background: #16a34a; border-color: #16a34a; color: white; }
        .bl-btn.save:hover { background: #15803d; }
        .bl-bar input.bl-mention { background: #2a2d31; color: #fff; border: 1px solid rgba(255,255,255,.15); border-radius: 8px; padding: 7px 10px; font-size: 13px; width: 230px; font-family: inherit; }
        .bl-bar input.bl-mention::placeholder { color: #71717a; }
        .bl-bar label.bl-date { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: #a1a1aa; }
        .bl-bar input.bl-date { background: #2a2d31; color: #fff; border: 1px solid rgba(255,255,255,.15); border-radius: 8px; padding: 6px 8px; font-size: 13px; font-family: inherit; color-scheme: dark; }
        .bl-bar input.bl-date.invalid { border-color: #f87171; background: #3b1d1d; }
        .bl-banner { max-width: 794px; margin: 12px auto -8px; padding: 10px 14px; border-radius: 8px; font-size: 13px; }
        .bl-banner.ok { background: #ecfdf5; border: 1px solid #6ee7b7; color: #065f46; }
        .bl-banner.ko { background: #fef2f2; border: 1px solid #fca5a5; color: #991b1b; }
        .bl-banner.info { background: #eff6ff; border: 1px solid #93c5fd; color: #1e3a8a; }
        .bl-banner a { color: inherit; font-weight: 700; }

        /* ── Cellules d'édition dans le tableau (écran seulement) ─── */
        .td-edit { width: 84px; text-align: center; vertical-align: middle; white-space: nowrap; }
        .bl-x { border: 1px solid #fca5a5; background: #fff1f2; color: #b91c1c; width: 26px; height: 26px; border-radius: 6px; cursor: pointer; font-weight: 700; font-size: 13px; line-height: 1; }
        .bl-x:hover { background: #fee2e2; }
        .bl-undo { border: 1px solid #93c5fd; background: #eff6ff; color: #1d4ed8; height: 26px; padding: 0 8px; border-radius: 6px; cursor: pointer; font-weight: 700; font-size: 12px; }
        .bl-undo:hover { background: #dbeafe; }
        input.bl-qty { width: 56px; text-align: center; font-weight: 700; font-size: 14px; padding: 4px 2px; border: 1px solid #cbd5e1; border-radius: 6px; color: ${BLACK}; font-family: inherit; }
        input.bl-qty.changed { border-color: #f59e0b; background: #fffbeb; }
        tr.row-removed td { opacity: .38; text-decoration: line-through; }
        tr.row-removed td.td-edit { opacity: 1; text-decoration: none; }
        tr.row-added td { background: #f0fdf4 !important; }
        .bl-tag { display: inline-block; font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 4px; margin-left: 6px; vertical-align: middle; }
        .bl-tag.added { background: #dcfce7; color: #166534; }
        .bl-tag.changed { background: #fef3c7; color: #92400e; }
        .bl-tag.removed { background: #fee2e2; color: #991b1b; }
        .bl-print-hint { font-size: 11px; color: #94a3b8; font-weight: 400; }
        tr.tr-add td { background: #f8fafc !important; padding: 8px 6px !important; }
        .bl-add-form { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
        .bl-add-form input { border: 1px solid #cbd5e1; border-radius: 6px; padding: 6px 8px; font-size: 12px; font-family: inherit; }
        .bl-add-link { background: none; border: 0; color: ${THEME}; font-weight: 700; cursor: pointer; font-size: 12px; padding: 0; font-family: inherit; }

        .bl-only-print { display: none; }
        @media print {
          .bl-bar, .bl-banner, .bl-spacer, .td-edit, .bl-tag, .bl-print-hint, tr.row-removed, tr.tr-add, th.th-edit, .bl-only-screen { display: none !important; }
          .bl-only-print { display: inline; }
          tr.row-added td { background: inherit !important; }
        }

        .doc-header { display: flex; justify-content: space-between; gap: 20px; margin-bottom: 6mm; width: 100%; }
        .doc-header-left { flex: 0 0 46%; }
        .doc-header-right { flex: 0 0 50%; }
        .doc-logo { max-width: 175px; max-height: 65px; object-fit: contain; display: block; margin-bottom: 10px; }
        .doc-type { font-size: 26px; font-weight: 400; color: ${THEME}; margin-bottom: 8px; line-height: 1.1; }
        .doc-mention { display: inline-block; font-size: 13px; font-weight: 700; color: #7B5E00; background: #FFF8E1; border: 1.5px solid #f59e0b; border-radius: 6px; padding: 3px 10px; margin: -2px 0 8px; }
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
        .tr-media td { text-align: center !important; }
        .media-small  { max-height: 22px !important; max-width: 80px !important; width: auto !important; height: auto !important; object-fit: contain !important; display: inline-block !important; }
        .media-medium { max-height: 50px !important; max-width: 180px !important; width: auto !important; height: auto !important; object-fit: contain !important; display: inline-block !important; }
        .media-large  { max-height: 110px !important; max-width: 350px !important; width: auto !important; height: auto !important; object-fit: contain !important; display: inline-block !important; }
        .media-img-small  { max-height: 80px !important; max-width: 200px !important; width: auto !important; height: auto !important; object-fit: contain !important; display: inline-block !important; }
        .media-img-medium { max-height: 180px !important; max-width: 400px !important; width: auto !important; height: auto !important; object-fit: contain !important; display: inline-block !important; }
        .media-img-large  { max-height: 320px !important; max-width: 700px !important; width: auto !important; height: auto !important; object-fit: contain !important; display: inline-block !important; }
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

      {/* ── BARRE D'ÉDITION (écran uniquement) ── */}
      <div className="bl-bar" ref={barRef}>
        {editable ? (
          <>
            <span className="bl-count">
              <b>{articlesVisibles.length}</b> / {articlesTotal} article{articlesTotal > 1 ? "s" : ""} · <b>{piecesVisibles}</b> pièce{piecesVisibles > 1 ? "s" : ""}
              {saved.length > 0 && <> · déjà {saved.length} bulletin{saved.length > 1 ? "s" : ""} enregistré{saved.length > 1 ? "s" : ""}</>}
              {modifie && <span style={{color:"#fbbf24"}}> · modifié</span>}
            </span>
            <label className="bl-date" title="Date d'envoi imprimée sur le bulletin. Indépendante de la date de commande, mais jamais avant elle.">
              Date du bulletin
              <input className={`bl-date ${dateInvalide ? "invalid" : ""}`} type="date" value={dateBulletin}
                min={dateCommandeIso || undefined} onChange={(e) => setDateBulletin(e.target.value)} />
            </label>
            <input className="bl-mention" value={mention} onChange={(e) => setMention(e.target.value)}
              placeholder="Mention (ex. Livraison partielle 1/2)" maxLength={120}
              title="Imprimée sous le titre du bulletin. Vide = rien n'apparaît." />
            {resteALivrerDisponible && (
              <button className="bl-btn" onClick={appliquerResteALivrer}
                title="Pré-remplit les quantités qui n'ont encore figuré sur aucun bulletin enregistré">📥 Reste à livrer</button>
            )}
            <button className="bl-btn" onClick={() => setShowAdd((v) => !v)}>＋ Ajouter une ligne</button>
            <button className="bl-btn" onClick={toutRemettre} disabled={!modifie} title="Revient à la commande d'origine">↺ Tout remettre</button>
            <button className="bl-btn primary" onClick={() => window.print()}>🖨 Imprimer</button>
            <button className="bl-btn save" onClick={enregistrerPdf} disabled={saving || articlesVisibles.length === 0 || dateInvalide || !dateBulletin}
              title="Enregistre ce bulletin dans l'historique de la commande et génère son PDF (~10 s)">
              {saving ? "⏳ Génération…" : "💾 Enregistrer en PDF"}
            </button>
          </>
        ) : (
          <>
            <span className="bl-count">
              Bulletin <b>n° {viewing?.numero_bulletin}</b> enregistré le {viewing ? new Date(viewing.created_at).toLocaleString("fr-CH") : ""} · lecture seule
            </span>
            {viewing?.pdf_url && <a className="bl-btn" href={viewing.pdf_url} target="_blank" rel="noopener noreferrer">📄 PDF</a>}
            <a className="bl-btn" href={`/print/bulletin-livraison/${slug}`}>✏️ Nouveau bulletin</a>
            <button className="bl-btn primary" onClick={() => window.print()}>🖨 Imprimer</button>
          </>
        )}
      </div>
      <div className="bl-spacer" style={{ height: barHeight + 12 }} />

      {saveResult && (
        <div className={`bl-banner ${saveResult.ok ? "ok" : "ko"}`}>
          {saveResult.ok ? "✅ " : "⚠️ "}{saveResult.msg}
          {saveResult.url && <> — <a href={saveResult.url} target="_blank" rel="noopener noreferrer">Ouvrir le PDF</a></>}
          {saveResult.ok && <> · Il apparaît maintenant sur la fiche de la commande.</>}
        </div>
      )}
      {editable && dateInvalide && (
        <div className="bl-banner ko">
          ⚠️ La date du bulletin ({formatDate(dateBulletin)}) est antérieure à la date de commande ({formatDate(data.date)}). Un bulletin ne peut pas précéder sa commande.
        </div>
      )}
      {editable && saved.length === 0 && !modifie && (
        <div className="bl-banner info">
          Ce bulletin reprend la commande telle quelle. Pour un envoi partiel : modifiez les quantités, retirez des lignes (✕) ou ajoutez-en — rien n&apos;est imprimé ni enregistré tant que vous ne le demandez pas. La commande elle-même n&apos;est jamais modifiée.
        </div>
      )}

      <div className="doc-wrap">

        {/* HEADER */}
        <div className="doc-header">
          <div className="doc-header-left">
            <img className="doc-logo"
              src="https://cdn.shopify.com/s/files/1/0360/3251/2135/files/logo_JARDIN_CONFORT_shopify.jpg?v=1614107698"
              alt="Jardin-Confort" />
            <div className="doc-type">Bulletin de livraison</div>
            {mentionImprimee && <div className="doc-mention">{mentionImprimee}</div>}
            <table className="doc-meta-table">
              <tbody>
                <tr>
                  <td className="doc-meta-label">N° de commande</td>
                  <td>{numeroAffiche || data.offerNumber}</td>
                </tr>
                {data.reference && (
                  <tr><td className="doc-meta-label">Référence</td><td>{data.reference}</td></tr>
                )}
                <tr><td className="doc-meta-label">Date de commande</td><td>{formatDate(data.date)}</td></tr>
                {dateBulletin && (
                  <tr><td className="doc-meta-label">Date du bulletin</td><td>{formatDate(dateBulletin)}</td></tr>
                )}
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
                  {data.livr_complement_nom && <div className="doc-addr-line">{data.livr_complement_nom}</div>}
                  {data.livrRue && <div className="doc-addr-line">{data.livrRue} {data.livrNumero}</div>}
                  {data.livrNpa && <div className="doc-addr-line">{data.livrNpa} {data.livrVille}</div>}
                  {data.livrTel && <div className="doc-addr-line" style={{marginTop:8, fontSize:16}}>Tél. {data.livrTel}</div>}
                </>
              ) : (
                <>
                  {data.societe && <div className="doc-addr-line">{data.societe}</div>}
                  <div className="doc-addr-name">{data.nom} {data.prenom}</div>
                  {data.complement_nom && <div className="doc-addr-line">{data.complement_nom}</div>}
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

        {/* TABLEAU ARTICLES (sans prix) */}
        <table className="doc-table">
          <thead>
            <tr>
              <th style={{width:56}}></th>
              <th className="th-left">Description de l&apos;article</th>
              <th className="th-center" style={{width:80}}>Qté</th>
              {editable && <th className="th-edit td-edit"><span className="bl-print-hint">édition</span></th>}
            </tr>
          </thead>
          <tbody>
            {visibles.length === 0 && (
              <tr><td colSpan={editable ? 4 : 3} style={{textAlign:"center", padding:"20px", color:"#aaa", fontStyle:"italic"}}>Aucun article</td></tr>
            )}
            {lines.map((line) => {
              // En lecture seule, une ligne retirée n'existe pas ; en édition
              // elle reste visible grisée (écran) et sort à l'impression.
              if (line.removed && !editable) return null;
              const rowCls = [line.removed ? "row-removed" : "", line.added ? "row-added" : ""].join(" ").trim();
              const editCell = editable ? (
                <td className="td-edit">
                  {line.removed ? (
                    <button className="bl-undo" onClick={() => toggleRemoved(line.key)} title="Remettre sur le bulletin">↩ Remettre</button>
                  ) : line.added ? (
                    <button className="bl-x" onClick={() => supprimerAjoutee(line.key)} title="Supprimer cette ligne ajoutée">✕</button>
                  ) : (
                    <button className="bl-x" onClick={() => toggleRemoved(line.key)} title="Retirer de ce bulletin (la commande n'est pas modifiée)">✕</button>
                  )}
                </td>
              ) : null;

              if (line.type === "comment") {
                return (
                  <tr key={line.key} className={`tr-comment ${rowCls}`}>
                    <td colSpan={3} className="td-comment">{line.title}</td>
                    {editCell}
                  </tr>
                );
              }
              if (line.type === "media") {
                if (!line.mediaUrl) return null;
                const prefix = line.mediaSource === "upload" ? "media-img-" : "media-";
                const sizeClass = line.mediaSize === "small" ? prefix + "small" : line.mediaSize === "large" ? prefix + "large" : prefix + "medium";
                return (
                  <tr key={line.key} className={`tr-media ${rowCls}`}>
                    <td colSpan={3}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={line.mediaUrl} alt={line.title || ""} className={sizeClass} />
                    </td>
                    {editCell}
                  </tr>
                );
              }
              const qtyChanged = !line.added && line.qty !== line.qtyOrig;
              return (
                <tr key={line.key} className={rowCls}>
                  <td className="td-img">{line.image && <img src={line.image} alt="" />}</td>
                  <td className="td-desc">
                    <div className="item-title">
                      {line.title}
                      {editable && line.added && <span className="bl-tag added">ajoutée</span>}
                      {editable && line.removed && <span className="bl-tag removed">retirée</span>}
                      {editable && qtyChanged && !line.removed && <span className="bl-tag changed">qté {line.qtyOrig} → {line.qty}</span>}
                    </div>
                    {line.sku && <div className="item-sku">{line.sku}</div>}
                  </td>
                  <td className="td-center">
                    {editable && !line.removed ? (
                      <>
                        {/* Écran : champ de saisie. Impression : texte, comme la commande. */}
                        <span className="bl-only-screen">× <input className={`bl-qty ${qtyChanged ? "changed" : ""}`} type="number" min={1} step={1}
                          value={line.qty} onChange={(e) => setQty(line.key, e.target.value)} /></span>
                        <span className="bl-only-print">× {line.qty}</span>
                      </>
                    ) : (
                      <>× {line.qty}</>
                    )}
                  </td>
                  {editCell}
                </tr>
              );
            })}
            {editable && (
              <tr className="tr-add">
                <td colSpan={4}>
                  {showAdd ? (
                    <div className="bl-add-form">
                      <input placeholder="Désignation de l'article" value={addTitle} onChange={(e) => setAddTitle(e.target.value)}
                        style={{flex:"1 1 260px"}} autoFocus maxLength={500}
                        onKeyDown={(e) => { if (e.key === "Enter") ajouterLigne(); if (e.key === "Escape") setShowAdd(false); }} />
                      <input placeholder="Réf. (facultatif)" value={addSku} onChange={(e) => setAddSku(e.target.value)} style={{width:130}} maxLength={100} />
                      <input type="number" min={1} step={1} value={addQty} onChange={(e) => setAddQty(e.target.value)} style={{width:64, textAlign:"center"}} title="Quantité" />
                      <button className="bl-btn primary" onClick={ajouterLigne} disabled={!addTitle.trim()} style={{padding:"6px 12px"}}>Ajouter</button>
                      <button className="bl-btn" onClick={() => setShowAdd(false)} style={{padding:"6px 10px"}}>Annuler</button>
                    </div>
                  ) : (
                    <button className="bl-add-link" onClick={() => setShowAdd(true)}>＋ Ajouter une ligne (pièce de rechange, accessoire, article hors commande…)</button>
                  )}
                </td>
              </tr>
            )}
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
