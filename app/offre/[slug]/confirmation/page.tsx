"use client";
// app/offre/[slug]/confirmation/page.tsx

import React, { useCallback, useEffect, useState } from "react";

const C = {
  blue:    "#0060A9",
  blueBtn: "#2B8AD1",
  text:    "#2A2B2A",
  grey:    "#6B7280",
  border:  "#E5E7EB",
  bg:      "#F8FAFC",
  green:   "#16a34a",
};
const FONT = "'DM Sans', system-ui, sans-serif";
const QR_SECOURS = "https://cdn.shopify.com/s/files/1/0360/3251/2135/files/Coordonnees_bancaires_Jardin-Confort_SA_avec_QR_Vierge_2023.pdf?v=1666176310";

type CmdData = {
  id: number;
  slug: string;
  numero_affiche: string;
  numero_commande: string;
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
  offre_origine: string | null;
  data: Record<string, unknown>;
};

function fmt(v: number) {
  return "CHF\u00a0" + new Intl.NumberFormat("de-CH", { minimumFractionDigits: 2 }).format(v);
}
function fmtDate(iso: string) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("fr-CH", { day: "2-digit", month: "2-digit", year: "numeric" });
}
function fmtDateTime(iso: string) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("fr-CH", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// ── Card cliquable pour copier ──
function CopyCard({ label, value, lines }: { label: string; value: string; lines?: string[] }) {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    const textToCopy = lines ? lines.join("\n") : value;
    navigator.clipboard.writeText(textToCopy).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }
  return (
    <div
      onClick={handleCopy}
      title="Cliquer pour copier"
      style={{
        background: copied ? "#f0fdf4" : C.bg,
        border: `1px solid ${copied ? "#86efac" : C.border}`,
        borderRadius: 16, padding: "14px 16px",
        cursor: "pointer", position: "relative",
        transition: "all 0.2s",
        userSelect: "none",
      }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.grey, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>{label}</div>
      {lines ? (
        lines.map((l, i) => (
          <div key={i} style={{ fontSize: i === 0 ? 15 : 13, color: i === 0 ? C.text : C.grey, fontWeight: i === 0 ? 500 : 400, lineHeight: 1.5 }}>{l}</div>
        ))
      ) : (
        <div style={{ fontSize: 15, color: C.text, fontWeight: 500 }}>{value}</div>
      )}
      <div style={{
        position: "absolute", top: 10, right: 12,
        fontSize: 11, fontWeight: 700,
        color: copied ? C.green : C.grey,
        opacity: copied ? 1 : 0.5,
        transition: "all 0.2s",
      }}>
        {copied ? "✓ Copié !" : "📋 Copier"}
      </div>
    </div>
  );
}

// ── Jauge ──
function ProgressBar({ progress }: { progress: number }) {
  return (
    <div style={{ width: "100%", marginTop: 6 }}>
      <div style={{ background: "#E5E7EB", borderRadius: 99, height: 6, overflow: "hidden" }}>
        <div style={{
          height: "100%", width: `${progress}%`,
          background: `linear-gradient(90deg, ${C.blueBtn}, #4aade8)`,
          borderRadius: 99, transition: "width 0.4s ease",
        }} />
      </div>
      <div style={{ fontSize: 11, color: C.grey, marginTop: 3, textAlign: "right" }}>{Math.round(progress)}% — patientez</div>
    </div>
  );
}

// ── Poller QR ──
function QrPoller({ slug, onReady }: { slug: string; onReady: (url: string) => void }) {
  const [attempts, setAttempts] = useState(0);
  const maxAttempts = 12;
  useEffect(() => {
    if (!slug || attempts >= maxAttempts) return;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/offres/${slug}/qr`);
        if (res.ok) {
          const json = await res.json();
          if (json.qr_url) { onReady(json.qr_url); return; }
        }
      } catch { /* ignore */ }
      setAttempts(a => a + 1);
    }, 5000);
    return () => clearTimeout(timer);
  }, [slug, attempts, onReady]);
  const progress = Math.min(95, (attempts / maxAttempts) * 100);
  return (
    <div style={{ padding: "32px 20px", textAlign: "center" }}>
      <div style={{ fontSize: 28, marginBottom: 12 }}>⏳</div>
      <div style={{ fontSize: 15, fontWeight: 600, color: C.text, marginBottom: 6 }}>Génération du QR paiement en cours…</div>
      <div style={{ fontSize: 13, color: C.grey, marginBottom: 20 }}>Cela peut prendre jusqu&apos;à 60 secondes. Cette page se met à jour automatiquement.</div>
      <div style={{ maxWidth: 360, margin: "0 auto" }}>
        <ProgressBar progress={progress} />
        <div style={{ fontSize: 12, color: C.grey, marginTop: 8 }}>Étape {attempts + 1} / {maxAttempts}</div>
      </div>
      <div style={{ marginTop: 20, fontSize: 13, color: C.grey }}>
        En attendant, vous pouvez utiliser le{" "}
        <a href={QR_SECOURS} target="_blank" rel="noopener noreferrer" style={{ color: C.blueBtn, fontWeight: 600, textDecoration: "underline" }}>
          bulletin de paiement de secours ↗
        </a>
      </div>
    </div>
  );
}

export default function ConfirmationPage({ params }: { params: Promise<{ slug: string }> }) {
  const [cmd, setCmd] = useState<CmdData | null>(null);
  const [loading, setLoading] = useState(true);
  const [slug, setSlug] = useState("");
  const [pdfUrl, setPdfUrl] = useState("");
  const [qrUrl, setQrUrl] = useState("");
  const [dateValidation, setDateValidation] = useState("");
  const [qrDownloading, setQrDownloading] = useState(false);
  const [qrProgress, setQrProgress] = useState(0);
  const [qrLoadError, setQrLoadError] = useState(false);

  useEffect(() => {
    async function load() {
      const { slug: s } = await params;
      setSlug(s);
      try {
        const res = await fetch(`/api/offres/${s}`);
        if (res.ok) {
          const json = await res.json();
          const offre = json.offre as CmdData;
          setCmd(offre);
          setPdfUrl(json.offre?.pdf_url || "");
          setQrUrl(json.offre?.qr_url || "");
          setDateValidation((offre.data?.date_validation as string) || "");
        }
      } catch { /* ignore */ }
      finally { setLoading(false); }
    }
    load();
  }, [params]);

  const handleQrDownload = useCallback(async () => {
    if (qrDownloading) return;
    if (qrUrl) { window.open(qrUrl, "_blank"); return; }
    setQrDownloading(true);
    setQrProgress(5);
    try {
      fetch(`/api/offres/${slug}/qr`, { method: "POST" }).catch(() => {});
      let elapsed = 0;
      const maxWait = 90;
      const interval = 5;
      while (elapsed < maxWait) {
        await new Promise(r => setTimeout(r, interval * 1000));
        elapsed += interval;
        setQrProgress(Math.min(90, 5 + (elapsed / maxWait) * 85));
        try {
          const res = await fetch(`/api/offres/${slug}/qr`);
          if (res.ok) {
            const json = await res.json();
            if (json.qr_url) {
              setQrUrl(json.qr_url);
              setQrProgress(100);
              setTimeout(() => { window.open(json.qr_url, "_blank"); setQrDownloading(false); setQrProgress(0); }, 400);
              return;
            }
          }
        } catch { /* ignore */ }
      }
      setQrDownloading(false); setQrProgress(0);
      alert("Le QR paiement prend plus de temps. Utilisez le bulletin de secours.");
    } catch { setQrDownloading(false); setQrProgress(0); }
  }, [slug, qrUrl, qrDownloading]);

  if (loading) return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", fontFamily: FONT }}>Chargement…</div>;
  if (!cmd) return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", fontFamily: FONT }}>Commande introuvable</div>;

  const payMode = (cmd.data?.paymentMode as string) || cmd.payment_mode || "Paiement d'avance à la commande";
  const nomComplet = `${cmd.client_prenom || ""} ${cmd.client_nom || ""}`.trim();
  const isAcompte = payMode.includes("50%");
  const montantAPayer = isAcompte ? Math.round(cmd.total_ttc * 0.5 * 100) / 100 : cmd.total_ttc;

  return (
    <>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet"/>
      <style>{`*{box-sizing:border-box;margin:0;padding:0}body{font-family:${FONT};background:#F3F5F6;color:${C.text};font-size:15px}a{color:${C.text};text-decoration:none}`}</style>

      {/* Header */}
      <div style={{ background: "#2B8AD1", padding: "6px 0" }}>
        <div style={{ maxWidth: 1260, margin: "0 auto", padding: "0 24px" }}>
          <span style={{ color: "white", fontSize: 12, letterSpacing: "0.06em", fontWeight: 500 }}>1&apos;000 M2 D&apos;EXPOSITION A LUTRY</span>
        </div>
      </div>
      <header style={{ background: "white", borderBottom: `1px solid ${C.border}`, marginBottom: 32 }}>
        <div style={{ maxWidth: 1260, margin: "0 auto", padding: "12px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <a href="https://www.jardin-confort.ch">
            <img src="https://www.jardin-confort.ch/cdn/shop/files/logo_JARDIN_CONFORT_shopify_51f35272-8a30-45a2-8718-36fb2af011c8.jpg?v=1736184411&width=480"
              alt="Jardin-Confort" style={{ height: 60, objectFit: "contain" }}/>
          </a>
          <a href="https://www.jardin-confort.ch" style={{ fontSize: 13, color: C.grey }}>← Retour à la boutique</a>
        </div>
      </header>

      <div style={{ maxWidth: 1260, margin: "0 auto", padding: "0 24px 48px" }}>

        {/* Breadcrumb */}
        <div style={{ fontSize: 14, color: C.grey, marginBottom: 20 }}>
          Commandes / <span style={{ color: C.text }}>{cmd.numero_commande}</span>
        </div>

        {/* ── Titre + ✔ vert + date validation ── */}
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: 36, fontWeight: 500, color: C.blue, letterSpacing: "-0.02em", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            Confirmation de commande
            <span style={{ color: C.green, fontSize: 32, fontWeight: 700 }}>✔</span>
          </h1>
          {dateValidation && (
            <div style={{ marginTop: 8, fontSize: 14, color: C.grey, display: "flex", alignItems: "center", gap: 6 }}>
              <span>🕐</span>
              <span>Validée le <strong style={{ color: C.text }}>{fmtDateTime(dateValidation)}</strong></span>
            </div>
          )}
        </div>

        {/* Montants + actions */}
        <div style={{
          display: "grid", gridTemplateColumns: "1fr 320px", gap: 24, marginBottom: 24,
          background: "white", border: `1px solid ${C.border}`, borderRadius: 26,
          padding: 24, boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
        }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 20, padding: "18px 20px" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.grey, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>Montant total de la commande</div>
              <div style={{ fontSize: 34, fontWeight: 700, color: C.text }}>{fmt(cmd.total_ttc)}</div>
            </div>
            <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 20, padding: "18px 20px" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.grey, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>
                {isAcompte ? "Acompte à payer de suite (50%)" : "Montant à payer de suite"}
              </div>
              <div style={{ fontSize: 34, fontWeight: 700, color: C.text }}>{fmt(montantAPayer)}</div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {pdfUrl ? (
              <a href={pdfUrl} target="_blank" rel="noopener noreferrer"
                style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 52, padding: "0 20px", borderRadius: 26, background: C.blueBtn, color: "white", fontWeight: 600, fontSize: 15 }}>
                📄 Télécharger la confirmation PDF
              </a>
            ) : (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 52, padding: "0 20px", borderRadius: 26, background: C.bg, color: C.grey, fontWeight: 600, fontSize: 14, border: `1px solid ${C.border}` }}>
                ⏳ Confirmation PDF en préparation…
              </div>
            )}

            <button onClick={handleQrDownload} disabled={qrDownloading}
              style={{
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4,
                minHeight: 52, padding: "10px 20px", borderRadius: 26,
                background: "white", color: qrDownloading ? C.grey : C.blueBtn, fontWeight: 600, fontSize: 15,
                border: `1px solid ${qrDownloading ? C.border : C.blueBtn}`,
                cursor: qrDownloading ? "wait" : "pointer", width: "100%", transition: "all 0.2s",
              }}>
              {qrDownloading ? (
                <>
                  <span style={{ fontSize: 13 }}>⏳ Génération en cours…</span>
                  <ProgressBar progress={qrProgress} />
                </>
              ) : (
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>📥 Télécharger le QR paiement</span>
              )}
            </button>

            <a href="mailto:contact@jardinconfort.ch"
              style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 52, padding: "0 20px", borderRadius: 26, background: "white", color: C.text, fontWeight: 600, fontSize: 15, border: `1px solid ${C.border}` }}>
              ✉️ Contacter Jardin-Confort
            </a>
          </div>
        </div>


{/* Message */}
        <div style={{ background: "#EEF7FF", border: "1px solid #B7D8F0", borderRadius: 22, padding: "22px 24px", marginBottom: 24, color: C.blue, lineHeight: 1.75, fontSize: 16 }}>
          <p style={{ marginBottom: 14 }}>Merci beaucoup <strong>{nomComplet}</strong> pour la validation de votre commande.</p>
          <p style={{ marginBottom: 14 }}>Notre équipe a été avertie de votre confirmation et va prendre contact avec vous au plus vite.</p>
          <p style={{ marginBottom: 14 }}>
            {isAcompte
              ? "Veuillez à présent procéder au paiement de l'acompte convenu (50%) sur notre compte bancaire selon les détails de paiement ci-dessous."
              : "Veuillez à présent procéder au paiement du montant convenu sur notre compte bancaire selon les détails de paiement ci-dessous."}
          </p>
          <p>Pour toute question : <a href="mailto:contact@jardinconfort.ch" style={{ color: C.blue, fontWeight: 700 }}>contact@jardinconfort.ch</a></p>
        </div>


        {/* Infos commande + client */}
        <div style={{ background: "white", border: `1px solid ${C.border}`, borderRadius: 26, padding: 28, marginBottom: 24, boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.blue, marginBottom: 14 }}>Informations sur la commande</div>
              {([
                ["Numéro de commande", cmd.numero_commande],
                ["Offre d'origine", cmd.offre_origine || "–"],
                ["Date de commande", fmtDate(cmd.date_document)],
                ...(dateValidation ? [["Validée le", fmtDateTime(dateValidation)]] : []),
                ["Mode de paiement", payMode],
                ["Votre conseiller", cmd.commercial],
              ] as [string, string][]).map(([k, v]) => (
                <div key={k} style={{ marginBottom: 8, fontSize: 15, lineHeight: 1.55 }}>
                  <strong style={{ display: "inline-block", minWidth: 200, fontWeight: 700 }}>{k} :</strong>
                  <span>{v}</span>
                </div>
              ))}
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.blue, marginBottom: 14 }}>Coordonnées client</div>
              {cmd.client_societe && (
                <div style={{ marginBottom: 8, fontSize: 15 }}>
                  <strong style={{ display: "inline-block", minWidth: 150, fontWeight: 700 }}>Société :</strong>
                  <span>{cmd.client_societe}</span>
                </div>
              )}
              {([
                ["Nom du client", nomComplet],
                ["Email", cmd.client_email || "–"],
                ["Téléphone", cmd.client_tel1 || "–"],
                ["Adresse", [cmd.client_rue, `${cmd.client_npa || ""} ${cmd.client_ville || ""}`].filter(Boolean).join(", ")],
              ] as [string, string][]).map(([k, v]) => (
                <div key={k} style={{ marginBottom: 8, fontSize: 15, lineHeight: 1.55 }}>
                  <strong style={{ display: "inline-block", minWidth: 150, fontWeight: 700 }}>{k} :</strong>
                  <span>{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        

        {/* ── QR Paiement ── */}
        <div style={{ background: "white", border: `1px solid ${C.border}`, borderRadius: 26, padding: 28, marginBottom: 24, boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
          <h2 style={{ fontSize: 24, fontWeight: 600, color: C.blue, marginBottom: 8 }}>QR Paiement</h2>
          <p style={{ fontSize: 14, color: C.grey, marginBottom: 20, lineHeight: 1.6 }}>
            Veuillez scanner le QR code ci-dessous ou utiliser les coordonnées bancaires indiquées.
            Le montant à inscrire est : <strong>{fmt(montantAPayer)}</strong>
          </p>

          {/* ── Viewer PDF — hauteur 820px pour que le QR en bas soit visible ── */}
          <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 20, overflow: "hidden", marginBottom: 16 }}>
            {qrUrl && !qrLoadError ? (
              <object
                data={`${qrUrl}#view=FitH`}
                type="application/pdf"
                style={{ width: "100%", height: 820, border: "none", display: "block" }}
                onError={() => setQrLoadError(true)}
              >
                <div style={{ padding: 32, textAlign: "center" }}>
                  <p style={{ marginBottom: 16, color: C.grey, fontSize: 14 }}>Votre navigateur ne peut pas afficher le PDF directement.</p>
                  <a href={qrUrl} target="_blank" rel="noopener noreferrer"
                    style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "12px 24px", borderRadius: 20, background: C.blueBtn, color: "white", fontWeight: 600, fontSize: 14 }}>
                    📥 Ouvrir le QR paiement
                  </a>
                </div>
              </object>
            ) : qrLoadError ? (
              <div style={{ padding: 32, textAlign: "center" }}>
                <div style={{ fontSize: 22, marginBottom: 12 }}>⚠️</div>
                <p style={{ marginBottom: 16, color: C.grey, fontSize: 14 }}>Le QR paiement personnalisé n&apos;a pas pu être affiché.</p>
                <a href={QR_SECOURS} target="_blank" rel="noopener noreferrer"
                  style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "12px 24px", borderRadius: 20, background: C.blueBtn, color: "white", fontWeight: 600, fontSize: 14 }}>
                  📄 Utiliser le bulletin de paiement de secours
                </a>
              </div>
            ) : (
              <QrPoller slug={slug} onReady={setQrUrl} />
            )}
          </div>

          {/* Liens de secours */}
          <div style={{ marginBottom: 20, fontSize: 13, color: C.grey, textAlign: "center" }}>
            Problème d&apos;affichage ?{" "}
            <a href={qrUrl || QR_SECOURS} target="_blank" rel="noopener noreferrer" style={{ color: C.blueBtn, fontWeight: 600, textDecoration: "underline" }}>
              Ouvrir dans un nouvel onglet ↗
            </a>
            {" · "}
            <a href={QR_SECOURS} target="_blank" rel="noopener noreferrer" style={{ color: C.grey, textDecoration: "underline" }}>
              Bulletin de secours ↗
            </a>
          </div>

          {/* ── Cards cliquables pour copier ── */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <CopyCard label="IBAN" value="CH72 0076 7000 K033 3796 5" />
            <CopyCard label="Référence" value={cmd.numero_commande} />
            <CopyCard
              label="Bénéficiaire"
              value="Jardin-Confort SA"
              lines={["Jardin-Confort SA", "Route de Lavaux 425", "1095 Lutry (Suisse)"]}
            />
            <CopyCard
              label="Banque"
              value="Banque Cantonale Vaudoise"
              lines={["Banque Cantonale Vaudoise", "Place St-François 14", "1002 Lausanne", "SWIFT/BIC : BCVLCH2LXXX"]}
            />
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: C.grey, textAlign: "center" }}>
            💡 Cliquez sur une carte pour copier les informations dans le presse-papiers
          </div>
        </div>

      </div>

      <footer style={{ background: "white", borderTop: `1px solid ${C.border}`, padding: "20px 24px", textAlign: "center", fontSize: 12, color: C.grey }}>
        © {new Date().getFullYear()} Jardin-Confort SA · Route de Lavaux 425 · 1095 Lutry ·{" "}
        <a href="tel:+41217913671" style={{ color: C.grey }}>+41 21 791 36 71</a>
      </footer>
    </>
  );
}
