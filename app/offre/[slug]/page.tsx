"use client";
// app/offre/[slug]/page.tsx
// Page UNIQUE : détails offre + signature + validation
// Layout : colonne gauche sticky (résumé + boutons) | colonne droite (infos → articles → totaux → signature)

import React, { useEffect, useRef, useState } from "react";

const C = {
  blue:    "#0060A9",
  blueBtn: "#2B8AD1",
  text:    "#2A2B2A",
  grey:    "#6B7280",
  border:  "#E5E7EB",
  bg:      "#F8FAFC",
  green:   "#2C7E3F",
  orange:  "#E67E22",
};
const FONT = "'DM Sans', system-ui, sans-serif";
const TVA_RATE = 0.081;

const serviceLabels: Record<string, string> = {
  montage:       "Frais de montage",
  poste:         "Livraison des colis par La Poste",
  trottoir:      "Livraison colis franco trottoir par transporteur",
  etage:         "Livraison « à l'étage » et déballage des articles",
  etage_montage: "Livraison « à l'étage », déballage et montage",
  reprise:       "Reprise et recyclage des anciens meubles",
};

type QuoteLine = {
  id: string;
  type: "product" | "custom" | "comment";
  image?: string;
  sku?: string;
  title: string;
  unitPrice: number;
  qty: number;
  stock?: number | "sur_commande" | null;
  lineDiscount?: number;
  delaiLivraison?: string;
};

type OffreRow = {
  id: number;
  slug: string;
  type_document: string;
  numero_affiche: string;
  statut: string;
  date_document: string;
  commercial: string;
  client_nom: string;
  client_prenom: string;
  client_societe: string | null;
  client_email: string | null;
  client_tel1: string | null;
  client_npa: string | null;
  client_ville: string | null;
  client_rue: string | null;
  total_ttc: number;
  payment_mode: string | null;
  stockRefreshedAt?: string;
  validite_duree: string | null;
  data: {
    lines?: QuoteLine[];
    clientType?: string;
    paymentMode?: string;
    deliveryMode?: string;
    leadTime?: string;
    remarks?: string;
    reference?: string;
    societe?: string; nom?: string; prenom?: string;
    rue?: string; numero?: string; npa?: string; ville?: string;
    telephone1?: string; email?: string;
    livrDiff?: boolean;
    livrSociete?: string; livrNom?: string; livrPrenom?: string;
    livrTel?: string; livrRue?: string; livrNumero?: string;
    livrNpa?: string; livrVille?: string;
    discount?: string; discountPercent?: string; manualRounding?: string;
    enabledServices?: Record<string, boolean>;
    servicePrices?: Record<string, string>;
    validiteDuree?: string;
  };
};

function fmt(v: number) {
  return "CHF\u00a0" + new Intl.NumberFormat("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
}
function fmtDate(iso: string) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("fr-CH", { day: "2-digit", month: "2-digit", year: "numeric" });
}
function todayStr() {
  return new Date().toLocaleDateString("fr-CH", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function Card({ children, style, id }: { children: React.ReactNode; style?: React.CSSProperties; id?: string }) {
  return (
    <div id={id} style={{ background: "white", border: `1px solid ${C.border}`, borderRadius: 26, boxShadow: "0 2px 8px rgba(0,0,0,0.04)", ...style }}>
      {children}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 13, fontWeight: 700, color: C.blue, marginBottom: 12 }}>{children}</div>;
}

export default function OffrePage({ params }: { params: Promise<{ slug: string }> }) {
  const [offre, setOffre] = useState<OffreRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [slug, setSlug] = useState("");
  const [pageError, setPageError] = useState("");

  // Validation state
  const [accepted, setAccepted] = useState(false);
  const [signataire, setSignataire] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [success, setSuccess] = useState(false);
  const [signatureVisible, setSignatureVisible] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const hasSignature = useRef(false);

  // Load offre
  useEffect(() => {
    async function load() {
      const { slug: s } = await params;
      setSlug(s);
      try {
        const res = await fetch(`/api/offres/${s}`);
        if (!res.ok) { setPageError("404"); return; }
        const json = await res.json();
        const o = json.offre as OffreRow;
        setOffre(o);
        setSignataire(`${o.client_prenom || ""} ${o.client_nom || ""}`.trim());
      } catch { setPageError("error"); }
      finally { setLoading(false); }
    }
    load();
  }, [params]);

  // Init canvas after offre loaded
  useEffect(() => {
    if (!offre) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.strokeStyle = C.blueBtn;
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, rect.width, rect.height);
  }, [offre]);

useEffect(() => {
    const el = document.getElementById("bloc-signature");
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setSignatureVisible(entry.isIntersecting),
      { threshold: 0.2 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [offre]);

  function getPos(e: React.MouseEvent | React.TouchEvent, canvas: HTMLCanvasElement) {
    const rect = canvas.getBoundingClientRect();
    const src = "touches" in e ? e.touches[0] : (e as React.MouseEvent);
    return { x: src.clientX - rect.left, y: src.clientY - rect.top };
  }
  function startDraw(e: React.MouseEvent | React.TouchEvent) {
    const cv = canvasRef.current; if (!cv) return;
    const ctx = cv.getContext("2d"); if (!ctx) return;
    drawing.current = true; hasSignature.current = true;
    const p = getPos(e, cv); ctx.beginPath(); ctx.moveTo(p.x, p.y);
    e.preventDefault();
  }
  function draw(e: React.MouseEvent | React.TouchEvent) {
    if (!drawing.current) return;
    const cv = canvasRef.current; if (!cv) return;
    const ctx = cv.getContext("2d"); if (!ctx) return;
    const p = getPos(e, cv); ctx.lineTo(p.x, p.y); ctx.stroke();
    e.preventDefault();
  }
  function endDraw() { drawing.current = false; }
  function clearSignature() {
    const cv = canvasRef.current; if (!cv) return;
    const ctx = cv.getContext("2d"); if (!ctx) return;
    const r = cv.getBoundingClientRect();
    ctx.clearRect(0, 0, r.width, r.height);
    ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, 0, r.width, r.height);
    hasSignature.current = false;
  }

  async function handleSubmit() {
    setSubmitError("");
    if (!accepted) { setSubmitError("Veuillez cocher la case d'acceptation."); return; }
    if (!signataire.trim()) { setSubmitError("Veuillez indiquer le nom du signataire."); return; }
    if (!hasSignature.current) { setSubmitError("Veuillez signer dans la zone prévue."); return; }
    const signatureBase64 = canvasRef.current?.toDataURL("image/png") || "";
    setSubmitting(true);
    try {
      const res = await fetch(`/api/offres/${slug}/valider`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signataire: signataire.trim(), signature_base64: signatureBase64, date_signature: todayStr() }),
      });
      const json = await res.json();

      // Cas doublon : offre déjà validée → rediriger vers confirmation existante
      if (res.status === 409 && json.cmdSlug) {
        setSuccess(true);
        setTimeout(() => { window.location.href = `/offre/${json.cmdSlug}/confirmation`; }, 800);
        return;
      }

      if (!res.ok) throw new Error(json.error || "Erreur serveur");
      setSuccess(true);
      setTimeout(() => { window.location.href = `/offre/${json.cmdSlug}/confirmation`; }, 1400);
    } catch (err) {
      setSubmitError((err as Error).message);
      setSubmitting(false);
    }
  }

  // ── Loading / Error states ──
  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", fontFamily: FONT, color: C.grey }}>
      Chargement de l&apos;offre…
    </div>
  );
  if (pageError === "404" || !offre) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", fontFamily: FONT, flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: C.blue }}>Offre introuvable</div>
      <div style={{ color: C.grey, fontSize: 14 }}>Cette offre n&apos;existe pas ou a été supprimée.</div>
    </div>
  );

  // ── Calculs ──
  const d = offre.data;
  const isPrivateTTC = d.clientType === "Privé (prix TTC)";
  const payMode = d.paymentMode || offre.payment_mode || "Paiement d'avance à la commande";
  const isEnCours = ["En cours", "Envoyée"].includes(offre.statut);
  const isAcceptee = offre.statut === "Acceptée";

  // Calcul expiration
  const validiteDuree = offre.validite_duree || d.validiteDuree || "30 jours"
  const joursValidite = parseInt(validiteDuree) || 30
  const dateDocument = offre.date_document ? new Date(offre.date_document) : null
  const dateExpiration = dateDocument ? new Date(dateDocument.getTime() + joursValidite * 86400000) : null
  const isExpire = dateExpiration ? new Date() > dateExpiration : false
  const joursRestants = dateExpiration ? Math.ceil((dateExpiration.getTime() - Date.now()) / 86400000) : null

  const lines = d.lines || [];
  const subTotal = lines.reduce((s, l) => l.type === "comment" ? s : s + l.qty * l.unitPrice - (l.lineDiscount || 0), 0);
  const discountPct = Number(d.discountPercent || 0);
  const discountValue = discountPct > 0 ? Math.round(subTotal * discountPct) / 100 : Number(d.discount || 0);
  const activeServices = Object.entries(d.enabledServices || {})
    .filter(([, v]) => v)
    .map(([code]) => ({ code, label: serviceLabels[code] || code, amount: Number(d.servicePrices?.[code] || 0) }));
  const serviceTotal = activeServices.reduce((s, srv) => s + srv.amount, 0);
  const roundingValue = Number(d.manualRounding || 0);
  const totalAfterAll = subTotal - discountValue + serviceTotal + roundingValue;
  const tvaAmount = isPrivateTTC ? totalAfterAll - totalAfterAll / (1 + TVA_RATE) : totalAfterAll * TVA_RATE;
  const finalTotal = isPrivateTTC ? totalAfterAll : totalAfterAll + tvaAmount;

  // Adresses
  const addrFact = [
    d.societe || null,
    [d.prenom, d.nom].filter(Boolean).join(" ") || null,
    [d.rue, d.numero].filter(Boolean).join(" ") || null,
    [d.npa, d.ville].filter(Boolean).join(" ") || null,
    d.telephone1 ? `Tél. ${d.telephone1}` : null,
    d.email || null,
  ].filter(Boolean) as string[];

  const addrLivr: string[] = d.deliveryMode === "À l'emporter"
    ? ["À l'emporter", "Jardin-Confort SA", "Route de Lavaux 425", "1095 Lutry"]
    : d.livrDiff
      ? [d.livrSociete || null, [d.livrNom, d.livrPrenom].filter(Boolean).join(" ") || null,
         [d.livrRue, d.livrNumero].filter(Boolean).join(" ") || null,
         [d.livrNpa, d.livrVille].filter(Boolean).join(" ") || null,
         d.livrTel ? `Tél. ${d.livrTel}` : null].filter(Boolean) as string[]
      : addrFact.filter(l => !l.includes("@"));

  const nomClient = [d.prenom, d.nom].filter(Boolean).join(" ") || `${offre.client_prenom} ${offre.client_nom}`;

  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700&display=swap" rel="stylesheet" />
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { font-family: ${FONT}; background: #F3F5F6; color: ${C.text}; font-size: 15px; line-height: 1.6; }
        a { text-decoration: none; color: ${C.text}; }
        .jc-input { width: 100%; border: 1px solid ${C.border}; border-radius: 20px; padding: 12px 16px;
          font-size: 15px; font-family: ${FONT}; color: ${C.text}; background: white; outline: none; }
        .jc-input:focus { border-color: ${C.blueBtn}; box-shadow: 0 0 0 3px rgba(43,138,209,0.12); }
        .jc-input[readonly] { background: #F9FAFB; }
        .nav-sujet:hover .nav-dropdown { display: block !important; }
        .nav-lnk { transition: box-shadow 0.1s; }
        .nav-lnk:hover { box-shadow: inset 0 -2px 0 0 #3E4D56; }
        @media (max-width: 900px) {
          .two-col { grid-template-columns: 1fr !important; }
          .side-sticky { position: static !important; }
          .hide-mobile { display: none !important; }
        }
      `}</style>

      {/* ── TOP BAR ── */}
      <div style={{ background: C.blueBtn, padding: "6px 0" }}>
        <div style={{ maxWidth: 1260, margin: "0 auto", padding: "0 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ color: "white", fontSize: 12, letterSpacing: "0.06em", fontWeight: 500 }}>1&apos;000 M2 D&apos;EXPOSITION A LUTRY</span>
          <span style={{ color: "white", fontSize: 12 }}>Français</span>
        </div>
      </div>

      {/* ── HEADER ── */}
      <header style={{ background: "white", borderBottom: `1px solid ${C.border}`, marginBottom: 32 }}>
        <div style={{ maxWidth: 1260, margin: "0 auto", padding: "12px 24px 0" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingBottom: 8 }}>
            <a href="https://www.jardin-confort.ch">
              <img src="https://www.jardin-confort.ch/cdn/shop/files/logo_JARDIN_CONFORT_shopify_51f35272-8a30-45a2-8718-36fb2af011c8.jpg?v=1736184411&width=480"
                alt="Jardin-Confort" style={{ height: 68, objectFit: "contain" }} />
            </a>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <a href="https://www.jardin-confort.ch/customer_authentication/redirect?locale=fr&region_country=CH"
                style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 44, height: 44, color: "#3E4D56" }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm0 1.429a3.571 3.571 0 1 0 0 7.142 3.571 3.571 0 0 0 0-7.142zm0 10c2.558 0 5.114.471 7.664 1.411A3.571 3.571 0 0 1 22 18.19v3.096c0 .394-.32.714-.714.714H2.714A.714.714 0 0 1 2 21.286V18.19c0-1.495.933-2.833 2.336-3.35 2.55-.94 5.106-1.411 7.664-1.411zm0 1.428c-2.387 0-4.775.44-7.17 1.324a2.143 2.143 0 0 0-1.401 2.01v2.38H20.57v-2.38c0-.898-.56-1.7-1.401-2.01-2.395-.885-4.783-1.324-7.17-1.324z" />
                </svg>
              </a>
              <a href="https://www.jardin-confort.ch/cart"
                style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 44, height: 44, color: "#3E4D56" }}>
                <svg width="24" height="24" viewBox="0 0 24 24">
                  <path fill="currentColor" d="M17 18a2 2 0 0 1 2 2 2 2 0 0 1-2 2 2 2 0 0 1-2-2c0-1.11.89-2 2-2M1 2h3.27l.94 2H20a1 1 0 0 1 1 1c0 .17-.05.34-.12.5l-3.58 6.47c-.34.61-1 1.03-1.75 1.03H8.1l-.9 1.63-.03.12a.25.25 0 0 0 .25.25H19v2H7a2 2 0 0 1-2-2c0-.35.09-.68.24-.96l1.36-2.45L3 4H1V2m6 16a2 2 0 0 1 2 2 2 2 0 0 1-2 2 2 2 0 0 1-2-2c0-1.11.89-2 2-2m9-7 2.78-5H6.14l2.36 5H16Z" />
                </svg>
              </a>
            </div>
          </div>
          {/* Nav */}
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
            <nav style={{ display: "flex", alignItems: "center", flexWrap: "wrap", margin: "0 -12px" }}>
              <a href="https://www.jardin-confort.ch" className="nav-lnk"
                style={{ display: "block", margin: "0 12px", padding: "10px 0", fontSize: 13, fontWeight: 500, color: "#3E4D56", whiteSpace: "nowrap" }}>ACCUEIL</a>
              <a href="https://www.jardin-confort.ch"
                style={{ display: "block", margin: "0 12px", padding: "10px 0", fontSize: 13, fontWeight: 500, color: "#3E4D56", whiteSpace: "nowrap", boxShadow: "inset 0 -2px 0 0 #3E4D56" }}>← RETOUR A LA BOUTIQUE</a>
              <div style={{ position: "relative", margin: "0 12px" }} className="nav-sujet">
                <a href="https://www.jardin-confort.ch/pages/a-notre-sujet" className="nav-lnk"
                  style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "10px 0", fontSize: 13, fontWeight: 500, color: "#3E4D56", whiteSpace: "nowrap" }}>
                  A NOTRE SUJET
                  <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg>
                </a>
                <div className="nav-dropdown" style={{ display: "none", position: "absolute", top: "100%", left: 0, background: "white", boxShadow: "0 5px 15px rgba(0,0,0,0.1)", borderTop: `1px solid ${C.border}`, minWidth: 220, zIndex: 100, padding: "8px 0" }}>
                  {[["Qui sommes nous", "https://www.jardin-confort.ch/pages/a-notre-sujet"],
                    ["Contact", "https://www.jardin-confort.ch/pages/contact"],
                    ["Conditions générales", "https://www.jardin-confort.ch/pages/conditions-generales"],
                  ].map(([label, href]) => (
                    <a key={label} href={href} style={{ display: "block", padding: "10px 20px", fontSize: 13, color: "#3E4D56" }}
                      onMouseEnter={e => (e.currentTarget.style.color = C.blueBtn)}
                      onMouseLeave={e => (e.currentTarget.style.color = "#3E4D56")}>{label}</a>
                  ))}
                </div>
              </div>
            </nav>
            <a href="tel:+41217913671" style={{ display: "inline-flex", alignItems: "center", gap: 8, background: C.blueBtn, color: "white", padding: "8px 18px", borderRadius: 20, fontSize: 13, fontWeight: 600, flexShrink: 0, marginBottom: 8 }}>
              <svg width="15" height="15" fill="none" stroke="white" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.4 2 2 0 0 1 3.6 1.22h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.96a16 16 0 0 0 6 6l1.1-1.1a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
              </svg>
              +41 (0)21 791 36 71
            </a>
          </div>
        </div>
      </header>

      {/* ── CONTENU PRINCIPAL ── */}
      <div style={{ maxWidth: 1260, margin: "0 auto", padding: "0 24px 48px" }}>

        {/* Breadcrumb */}
        <div style={{ fontSize: 14, color: C.grey, marginBottom: 20 }}>
          Offres clients / <span style={{ color: C.text, fontWeight: 600 }}>{offre.numero_affiche}</span>
        </div>

        {/* Titre */}
        <h1 style={{ fontSize: 36, fontWeight: 500, color: C.text, letterSpacing: "-0.02em", marginBottom: 28 }}>
          Confirmez ici votre offre en 1 clic !
        </h1>

        {/* ── LAYOUT 2 COLONNES ── */}
        <div className="two-col" style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 24, alignItems: "start" }}>

          {/* ════ COLONNE GAUCHE — STICKY ════ */}
          <div className="side-sticky" style={{ position: "sticky", top: 20, display: "flex", flexDirection: "column", gap: 16 }}>

            {/* Card résumé montant */}
            <Card style={{ padding: 24 }}>
              <div style={{ fontSize: 26, fontWeight: 700, color: C.text, marginBottom: 16 }}>{fmt(finalTotal)}</div>
              <div style={{ fontSize: 14, lineHeight: 2, color: C.text }}>
                <div><strong style={{ fontWeight: 700 }}>Référence : </strong>{offre.numero_affiche}</div>
                {d.reference && <div><strong style={{ fontWeight: 700 }}>Réf. client : </strong>{d.reference}</div>}
                <div><strong style={{ fontWeight: 700 }}>Client : </strong>{nomClient}</div>
                <div><strong style={{ fontWeight: 700 }}>Paiement : </strong>{payMode}</div>
                <div><strong style={{ fontWeight: 700 }}>Conseiller : </strong>{offre.commercial}</div>
                <div><strong style={{ fontWeight: 700 }}>Date : </strong>{fmtDate(offre.date_document)}</div>
                {dateExpiration && (
                  <div style={{ marginTop: 8, padding: "8px 12px", borderRadius: 12,
                    background: isExpire ? "#FEF2F2" : joursRestants !== null && joursRestants <= 7 ? "#FFF8E1" : "#E8F5E9",
                    border: `1px solid ${isExpire ? "#FECACA" : joursRestants !== null && joursRestants <= 7 ? "#FFE082" : "#A5D6A7"}`,
                    fontSize: 13, fontWeight: 600,
                    color: isExpire ? "#991B1B" : joursRestants !== null && joursRestants <= 7 ? "#7B5E00" : C.green }}>
                    {isExpire
                      ? `⚠️ Offre expirée le ${fmtDate(dateExpiration.toISOString())}`
                      : `✓ Valide jusqu'au ${fmtDate(dateExpiration.toISOString())} (${joursRestants}j)`}
                  </div>
                )}
              </div>
            </Card>

            {/* Boutons actions */}
            {isEnCours && (
              <Card style={{ padding: 20 }}>
                {!signatureVisible && (
                  <button
                    onClick={() => document.getElementById("bloc-signature")?.scrollIntoView({ behavior: "smooth", block: "center" })}
                    style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", minHeight: 48, borderRadius: 24, background: C.blueBtn, color: "white", border: "none", fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: FONT, marginBottom: 10 }}>
                    ✅ Accepter &amp; signer
                  </button>
                )}
                <a href={`/print/offre/${slug}`} target="_blank" rel="noopener noreferrer"
                  style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", minHeight: 44, borderRadius: 24, background: "white", color: C.text, border: `1px solid ${C.border}`, fontSize: 14, fontWeight: 600 }}>
                  <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" />
                  </svg>
                  Voir / imprimer le devis PDF
                </a>
              </Card>
            )}

            {/* Statut acceptée — offre déjà validée */}
            {isAcceptee && (
              <Card style={{ padding: 24, background: "#E8F5E9", border: `1px solid ${C.green}` }}>
                <div style={{ fontWeight: 700, color: C.green, fontSize: 18, marginBottom: 8 }}>✅ Offre déjà validée</div>
                <div style={{ fontSize: 14, color: "#2e7d32", lineHeight: 1.8, marginBottom: 16 }}>
                  Cette offre a déjà été acceptée et confirmée. Merci pour votre confiance !<br/>
                  Votre commande est en cours de traitement par notre équipe.
                </div>
                <a href={`/offre/${slug}/confirmation`}
                  style={{ display:"inline-flex", alignItems:"center", gap:8, background:C.green, color:"white", padding:"10px 20px", borderRadius:20, fontSize:14, fontWeight:600, textDecoration:"none" }}>
                  📋 Voir ma confirmation de commande →
                </a>
              </Card>
            )}
          </div>

          {/* ════ COLONNE DROITE — CONTENU ════ */}
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

            {/* 1. Bloc accueil personnalisé */}
            <Card style={{ padding: 28 }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
                <span style={{ fontSize: 28, flexShrink: 0 }}>🌿</span>
                <div>
                  <div style={{ fontWeight: 700, color: C.blue, fontSize: 16, marginBottom: 6 }}>
                    Offre personnalisée en attente de votre validation
                  </div>
                  <div style={{ fontSize: 15, color: C.text, lineHeight: 1.8 }}>
                    Bonjour <strong>{nomClient}</strong>, veuillez trouver votre offre selon notre aimable entretien.
                    Si tout est en ordre, vous pouvez volontiers valider celle-ci en signant ci-dessous.
                    Vous recevrez ensuite une confirmation de commande avec les modalités de paiement convenues.
                  </div>
                  <div style={{ fontSize: 13, color: C.grey, marginTop: 8 }}>
                    Je reste à votre disposition pour toute information supplémentaire.{" "}
                    <strong style={{ color: C.text }}>{offre.commercial}</strong>{" · "}
                    <a href="tel:+41217913671" style={{ color: C.blueBtn }}>+41 21 791 36 71</a>
                  </div>
                </div>
              </div>
              {/* Note paiement */}
              <div style={{ marginTop: 18, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 16, padding: "12px 18px", fontSize: 14, color: C.text, lineHeight: 1.7 }}>
                Veuillez vérifier attentivement votre offre avant de la valider.
                {payMode === "Paiement d'avance à la commande" && " Le traitement de votre commande se fera sur la base d'un paiement d'avance à la commande."}
                {payMode === "Acompte de 50% à la commande" && " Le traitement de votre commande se fera sur la base d'un acompte de 50% à la commande."}
              </div>
            </Card>

            {/* 2. Infos offre + coordonnées client */}
            <Card style={{ padding: 28 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
                <div>
                  <SectionTitle>Informations sur l&apos;offre</SectionTitle>
                  {[
                    ["Référence", offre.numero_affiche],
                    ["Date de l'offre", fmtDate(offre.date_document)],
                    ["Montant total", fmt(finalTotal)],
                    ["Mode de paiement", payMode],
                    ["Conseiller", offre.commercial],
                  ].map(([k, v]) => (
                    <div key={k} style={{ marginBottom: 8, fontSize: 15, lineHeight: 1.55 }}>
                      <strong style={{ display: "inline-block", minWidth: 165, fontWeight: 700 }}>{k} :</strong>
                      <span style={{ color: C.grey }}>{v}</span>
                    </div>
                  ))}
                </div>
                <div>
                  <SectionTitle>Coordonnées client</SectionTitle>
                  {offre.client_societe && (
                    <div style={{ marginBottom: 8, fontSize: 15 }}>
                      <strong style={{ display: "inline-block", minWidth: 120, fontWeight: 700 }}>Société :</strong>
                      <span style={{ color: C.grey }}>{offre.client_societe}</span>
                    </div>
                  )}
                  {[
                    ["Nom", `${d.prenom || ""} ${d.nom || ""}`.trim() || nomClient],
                    ["Email", d.email || offre.client_email || "–"],
                    ["Téléphone", d.telephone1 || offre.client_tel1 || "–"],
                    ["Localité", [d.npa || offre.client_npa, d.ville || offre.client_ville].filter(Boolean).join(" ") || "–"],
                  ].map(([k, v]) => (
                    <div key={k} style={{ marginBottom: 8, fontSize: 15, lineHeight: 1.55 }}>
                      <strong style={{ display: "inline-block", minWidth: 120, fontWeight: 700 }}>{k} :</strong>
                      <span style={{ color: C.grey }}>{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            </Card>

            {/* 3. Adresses */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <Card style={{ padding: "20px 24px" }}>
                <SectionTitle>Adresse de facturation</SectionTitle>
                {addrFact.map((line, i) => (
                  <div key={i} style={{ fontSize: 15, fontWeight: i === 1 ? 600 : 400, color: i === 1 ? C.text : C.grey, lineHeight: 1.8 }}>{line}</div>
                ))}
              </Card>
              <Card style={{ padding: "20px 24px" }}>
                <SectionTitle>Adresse de livraison</SectionTitle>
                {addrLivr.map((line, i) => (
                  <div key={i} style={{ fontSize: 15, fontWeight: i === 1 ? 600 : 400, color: i === 1 ? C.text : C.grey, lineHeight: 1.8 }}>{line}</div>
                ))}
              </Card>
            </div>

            {/* 4. Stock info */}
            {offre.stockRefreshedAt && (
              <div style={{ background: "#FFF8E1", border: "1px solid #FFE082", borderRadius: 16, padding: "10px 16px", fontSize: 13, color: "#7B5E00", lineHeight: 1.6 }}>
                ℹ️ <strong>Info stock non contractuelle.</strong>{" "}
                Disponibilités vérifiées le {new Date(offre.stockRefreshedAt).toLocaleString("fr-CH")} sous toutes réserves d&apos;erreurs et de disponibilité.
              </div>
            )}

            {/* 5. Articles */}
            <Card>
              <div style={{ padding: "16px 24px 12px", borderBottom: `1px solid ${C.border}` }}>
                <SectionTitle>Articles ({lines.filter(l => l.type !== "comment").length})</SectionTitle>
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: C.bg }}>
                    <th className="hide-mobile" style={{ width: 88, padding: "10px 16px" }}></th>
                    <th style={{ textAlign: "left", padding: "10px 8px", fontSize: 12, fontWeight: 700, color: C.grey, textTransform: "uppercase", letterSpacing: "0.05em" }}>Article</th>
                    <th style={{ textAlign: "center", padding: "10px 8px", fontSize: 12, fontWeight: 700, color: C.grey, width: 60 }}>Qté</th>
                    <th style={{ textAlign: "right", padding: "10px 8px", fontSize: 12, fontWeight: 700, color: C.grey, width: 110 }}>Prix/pce</th>
                    <th style={{ textAlign: "right", padding: "10px 20px", fontSize: 12, fontWeight: 700, color: C.grey, width: 120 }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, i) => {
                    if (line.type === "comment") return (
                      <tr key={line.id}>
                        <td colSpan={5} style={{ padding: "10px 24px", fontStyle: "italic", color: C.grey, fontSize: 14, background: "#EEF4FB", borderTop: `1px solid ${C.border}` }}>
                          {line.title}
                        </td>
                      </tr>
                    );
                    const lineTotal = line.qty * line.unitPrice - (line.lineDiscount || 0);
                    const sn = typeof line.stock === "number" ? line.stock : null;
                    const isSC = line.stock === "sur_commande" || (sn !== null && sn < 1);
                    const isOk = sn !== null && sn > 2;
                    const isLow = sn !== null && sn > 0 && sn <= 2;
                    return (
                      <tr key={line.id} style={{ borderTop: `1px solid ${C.border}`, background: i % 2 === 0 ? "white" : C.bg }}>
                        <td className="hide-mobile" style={{ padding: "12px 16px", textAlign: "center", verticalAlign: "middle" }}>
                          {line.image
                            ? <img src={line.image} alt="" style={{ width: 72, height: 72, objectFit: "contain", borderRadius: 8 }} />
                            : <div style={{ width: 72, height: 72, background: C.bg, borderRadius: 8 }} />}
                        </td>
                        <td style={{ padding: "12px 8px", verticalAlign: "middle" }}>
                          <div style={{ fontWeight: 600, color: C.text, fontSize: 15 }}>{line.title}</div>
                          {line.sku && <div style={{ fontSize: 13, color: C.grey, marginTop: 1 }}>Réf. {line.sku}</div>}
                          {(line.lineDiscount || 0) > 0 && (
                            <div style={{ fontSize: 13, color: C.green, marginTop: 2, fontWeight: 500 }}>Remise : − {fmt(line.lineDiscount || 0)}</div>
                          )}
                          <div style={{ marginTop: 4, fontSize: 13, fontWeight: 600 }}>
                            {isSC ? <span style={{ color: C.orange }}>📦 {line.delaiLivraison || "Sur commande"}</span>
                              : isOk ? <span style={{ color: C.green }}>✓ En stock ({sn} pce{sn! > 1 ? "s" : ""})</span>
                                : isLow ? <span style={{ color: C.orange }}>⚠ Stock limité ({sn} pce{sn! > 1 ? "s" : ""})</span>
                                  : null}
                          </div>
                        </td>
                        <td style={{ padding: "12px 8px", textAlign: "center", verticalAlign: "middle", color: C.grey, fontSize: 15 }}>{line.qty}</td>
                        <td style={{ padding: "12px 8px", textAlign: "right", verticalAlign: "middle", color: C.grey, whiteSpace: "nowrap", fontSize: 15 }}>{fmt(line.unitPrice)}</td>
                        <td style={{ padding: "12px 20px", textAlign: "right", verticalAlign: "middle", fontWeight: 700, color: C.text, whiteSpace: "nowrap", fontSize: 15 }}>{fmt(lineTotal)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>

            {/* 6. Conditions + Totaux */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 16, alignItems: "start" }}>
              <Card style={{ padding: "20px 24px" }}>
                <SectionTitle>Conditions</SectionTitle>
                {[
                  ["Paiement", payMode],
                  ["Livraison", d.deliveryMode || "Livraison à domicile"],
                  d.leadTime ? ["Délai estimé", d.leadTime] : null,
                ].filter((x): x is string[] => x !== null).map(([k, v], i) => (
                  <div key={i} style={{ display: "flex", gap: 12, marginBottom: 8, fontSize: 15 }}>
                    <span style={{ color: C.grey, minWidth: 110 }}>{k}</span>
                    <span style={{ color: C.text, fontWeight: 500 }}>{v}</span>
                  </div>
                ))}
                {d.remarks && (
                  <>
                    <div style={{ height: 1, background: C.border, margin: "14px 0" }} />
                    <SectionTitle>Notes</SectionTitle>
                    <div style={{ fontSize: 14, color: C.grey, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{d.remarks}</div>
                  </>
                )}
              </Card>

              {/* Totaux */}
              <Card style={{ minWidth: 280 }}>
                <div style={{ padding: "16px 24px 8px", borderBottom: `1px solid ${C.border}` }}>
                  <SectionTitle>Récapitulatif</SectionTitle>
                </div>
                <div style={{ padding: "8px 0" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "7px 24px", fontSize: 15 }}>
                    <span style={{ color: C.grey }}>Sous-total</span><span>{fmt(subTotal)}</span>
                  </div>
                  {discountValue > 0 && (
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "7px 24px", fontSize: 15 }}>
                      <span style={{ color: C.grey }}>Remise</span>
                      <span style={{ color: C.green, fontWeight: 600 }}>− {fmt(discountValue)}</span>
                    </div>
                  )}
                  {activeServices.length > 0 && (
                    <>
                      <div style={{ padding: "8px 24px 2px", fontSize: 12, fontWeight: 700, color: C.grey, textTransform: "uppercase", letterSpacing: "0.05em" }}>Services inclus</div>
                      {activeServices.map(srv => (
                        <div key={srv.code} style={{ display: "flex", justifyContent: "space-between", padding: "5px 24px 5px 36px", fontSize: 14 }}>
                          <span style={{ color: C.grey }}>↳ {srv.label}</span>
                          <span>{srv.amount === 0 ? "Offert" : fmt(srv.amount)}</span>
                        </div>
                      ))}
                    </>
                  )}
                  {roundingValue !== 0 && (
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "7px 24px", fontSize: 15 }}>
                      <span style={{ color: C.grey }}>Arrondi</span><span>{fmt(roundingValue)}</span>
                    </div>
                  )}
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "7px 24px", fontSize: 13, color: C.grey, borderTop: `1px solid ${C.border}`, marginTop: 4 }}>
                    <span>TVA 8.1% {isPrivateTTC ? "(incluse)" : ""}</span><span>{fmt(tvaAmount)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 24px", background: C.blueBtn, borderRadius: "0 0 24px 24px", marginTop: 4 }}>
                    <span style={{ fontWeight: 700, fontSize: 15, color: "white" }}>TOTAL {isPrivateTTC ? "TTC" : "HT+TVA"}</span>
                    <span style={{ fontWeight: 700, fontSize: 20, color: "white", whiteSpace: "nowrap" }}>{fmt(finalTotal)}</span>
                  </div>
                </div>
              </Card>
            </div>

            {/* 7. Bloc signature — uniquement si offre en cours */}
            {isEnCours && isExpire && (
              <Card id="bloc-signature" style={{ padding: 28, background: "#FEF2F2", border: "1px solid #FECACA" }}>
                <div style={{ fontSize: 20, fontWeight: 600, color: "#991B1B", marginBottom: 16 }}>
                  ⚠️ Cette offre a expiré
                </div>
                <div style={{ fontSize: 15, color: "#7F1D1D", lineHeight: 1.8, marginBottom: 20 }}>
                  La durée de validité de cette offre ({validiteDuree}) est dépassée depuis le{" "}
                  <strong>{fmtDate(dateExpiration!.toISOString())}</strong>.
                  Les prix et disponibilités peuvent avoir changé.
                </div>
                <div style={{ background: "white", border: "1px solid #FECACA", borderRadius: 16, padding: "16px 20px", fontSize: 14, color: "#991B1B", lineHeight: 1.8 }}>
                  Pour réactiver cette offre ou obtenir une mise à jour des prix,<br />
                  veuillez contacter Jardin-Confort :
                  <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 12 }}>
                    <a href="tel:+41217913671"
                      style={{ display: "inline-flex", alignItems: "center", gap: 8, background: C.blueBtn, color: "white", padding: "10px 20px", borderRadius: 20, fontSize: 14, fontWeight: 600, textDecoration: "none" }}>
                      📞 +41 21 791 36 71
                    </a>
                    <a href={`mailto:info@jardin-confort.ch?subject=Réactivation offre ${offre.numero_affiche}&body=Bonjour, je souhaite réactiver l'offre ${offre.numero_affiche}.`}
                      style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "white", color: C.blueBtn, border: `1px solid ${C.blueBtn}`, padding: "10px 20px", borderRadius: 20, fontSize: 14, fontWeight: 600, textDecoration: "none" }}>
                      ✉️ Envoyer un email
                    </a>
                  </div>
                </div>
              </Card>
            )}
            {isEnCours && !isExpire && !isAcceptee && (
              <Card id="bloc-signature" style={{ padding: 28 }}>
                <div style={{ fontSize: 20, fontWeight: 600, color: C.blue, marginBottom: 20 }}>
                  Valider et signer votre offre
                </div>

                {/* Checkbox */}
                <label style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 24, fontSize: 15, cursor: "pointer", lineHeight: 1.5 }}>
                  <input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)}
                    style={{ marginTop: 3, transform: "scale(1.3)", accentColor: C.blueBtn, flexShrink: 0 }} />
                  Je confirme avoir lu le document ainsi que les{" "}
                  <a href="https://www.jardin-confort.ch/pages/conditions-generales" target="_blank" rel="noopener noreferrer"
                    style={{ color: C.blueBtn, textDecoration: "underline" }}>conditions générales</a>
                  {" "}et j&apos;accepte l&apos;offre telle que présentée.
                </label>

                {/* Canvas signature */}
                <div style={{ marginBottom: 20 }}>
                  <label style={{ display: "block", marginBottom: 8, fontWeight: 700, fontSize: 15 }}>Signature</label>
                  <div style={{ border: `1px solid ${C.border}`, borderRadius: 20, overflow: "hidden" }}>
                    <canvas ref={canvasRef}
                      style={{ width: "100%", height: 220, display: "block", background: "white", touchAction: "none", cursor: "crosshair" }}
                      onMouseDown={startDraw} onMouseMove={draw} onMouseUp={endDraw} onMouseLeave={endDraw}
                      onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={endDraw}
                    />
                    <div style={{ display: "flex", gap: 8, padding: 10, borderTop: `1px solid ${C.border}`, background: C.bg }}>
                      <button onClick={clearSignature}
                        style={{ border: `1px solid ${C.border}`, background: "white", color: C.text, borderRadius: 20, padding: "8px 16px", fontWeight: 700, cursor: "pointer", fontSize: 13, fontFamily: FONT }}>
                        Effacer la signature
                      </button>
                    </div>
                  </div>
                </div>

                {/* Signataire + date */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 220px", gap: 16, marginBottom: 20 }}>
                  <div>
                    <label style={{ display: "block", marginBottom: 6, fontWeight: 700, fontSize: 15 }}>Nom et prénom du signataire</label>
                    <input className="jc-input" type="text" value={signataire} onChange={e => setSignataire(e.target.value)} placeholder="Votre nom et prénom" />
                  </div>
                  <div>
                    <label style={{ display: "block", marginBottom: 6, fontWeight: 700, fontSize: 15 }}>Date de signature</label>
                    <input className="jc-input" type="text" value={todayStr()} readOnly />
                  </div>
                </div>

                {/* Erreur */}
                {submitError && (
                  <div style={{ background: "#FEF2F2", color: "#991B1B", border: "1px solid #FECACA", borderRadius: 16, padding: "12px 16px", marginBottom: 16, fontSize: 14 }}>
                    {submitError}
                  </div>
                )}
                {/* Succès */}
                {success && (
                  <div style={{ background: "#EEF7FF", color: C.blue, border: "1px solid #B7D8F0", borderRadius: 16, padding: 16, marginBottom: 16, fontSize: 14, lineHeight: 1.6 }}>
                    ✅ Merci ! Votre offre a été validée. Redirection en cours…
                  </div>
                )}

                {/* Bouton principal */}
                <button onClick={handleSubmit} disabled={submitting || success}
                  style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minHeight: 52, padding: "0 36px", borderRadius: 26, background: C.blueBtn, color: "white", border: "none", fontSize: 16, fontWeight: 600, cursor: submitting ? "not-allowed" : "pointer", fontFamily: FONT, opacity: submitting ? 0.7 : 1 }}>
                  {submitting ? "Validation en cours…" : "Valider mon offre"}
                </button>
              </Card>
            )}{/* fin !isExpire */}

          </div>{/* fin colonne droite */}
        </div>{/* fin two-col */}
      </div>{/* fin main */}

      {/* ── FOOTER ── */}
      <footer style={{ background: "white", borderTop: `1px solid ${C.border}`, fontFamily: FONT }}>
        <div style={{ maxWidth: 1260, margin: "0 auto", padding: "40px 24px 16px" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 32, marginBottom: 32, justifyContent: "space-between" }}>
            <div style={{ flex: "1 1 280px", maxWidth: 360 }}>
              <img src="https://www.jardin-confort.ch/cdn/shop/files/logo_JARDIN_CONFORT_shopify_51f35272-8a30-45a2-8718-36fb2af011c8.jpg?v=1736184411&width=480"
                alt="Jardin-Confort" style={{ height: 52, objectFit: "contain", marginBottom: 14 }} />
              <p style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 6 }}>LE MEILLEUR DU MOBILIER D&apos;EXTÉRIEUR DEPUIS 1960</p>
              <p style={{ fontSize: 13, color: C.grey, lineHeight: 1.7 }}>Plus de 40 grandes marques sur 1&apos;000m² d&apos;exposition à Lutry.</p>
            </div>
            <div style={{ flex: "0 1 160px" }}>
              <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 14, color: C.text }}>Liens</h3>
              {[["Accueil", "https://www.jardin-confort.ch"],
                ["Conditions générales", "https://www.jardin-confort.ch/pages/conditions-generales"],
                ["Contact", "https://www.jardin-confort.ch/pages/contact"],
              ].map(([l, h]) => <div key={l} style={{ marginBottom: 10 }}><a href={h} style={{ fontSize: 14, color: C.grey }}>{l}</a></div>)}
            </div>
            <div style={{ flex: "0 1 200px" }}>
              <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 14, color: C.text }}>JARDIN-CONFORT SA</h3>
              <div style={{ fontSize: 14, color: C.grey, lineHeight: 2 }}>
                <div>Route de Lavaux 425</div><div>CH-1095 Lutry</div>
                <div><a href="tel:+41217913671" style={{ color: C.grey }}>T : +41 21 791 36 71</a></div>
              </div>
            </div>
          </div>
          <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 14, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
            <span style={{ fontSize: 13, color: C.grey }}>© {new Date().getFullYear()} Jardin-Confort SA.</span>
          </div>
        </div>
      </footer>
    </>
  );
}