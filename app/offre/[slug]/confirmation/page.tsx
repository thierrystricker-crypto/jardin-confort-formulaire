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
};
const FONT = "'DM Sans', system-ui, sans-serif";

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

// ── Jauge de progression animée ──
function ProgressBar({ label, progress }: { label: string; progress: number }) {
  return (
    <div style={{ width: "100%", padding: "4px 0" }}>
      <div style={{ fontSize: 13, color: C.grey, marginBottom: 6 }}>{label}</div>
      <div style={{ background: "#E5E7EB", borderRadius: 99, height: 8, overflow: "hidden" }}>
        <div style={{
          height: "100%",
          width: `${progress}%`,
          background: `linear-gradient(90deg, ${C.blueBtn}, #4aade8)`,
          borderRadius: 99,
          transition: "width 0.4s ease",
        }} />
      </div>
      <div style={{ fontSize: 12, color: C.grey, marginTop: 4, textAlign: "right" }}>{Math.round(progress)}%</div>
    </div>
  );
}

// ── Poller QR avec jauge ──
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
      <div style={{ fontSize: 15, fontWeight: 600, color: C.text, marginBottom: 6 }}>
        Génération du QR paiement en cours…
      </div>
      <div style={{ fontSize: 13, color: C.grey, marginBottom: 20 }}>
        Cela peut prendre jusqu'à 60 secondes. Patientez, cette page se met à jour automatiquement.
      </div>
      <div style={{ maxWidth: 360, margin: "0 auto" }}>
        <ProgressBar label={`Étape ${attempts + 1} / ${maxAttempts}`} progress={progress} />
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

  // État bouton QR téléchargement
  const [qrDownloading, setQrDownloading] = useState(false);
  const [qrProgress, setQrProgress] = useState(0);

  useEffect(() => {
    async function load() {
      const { slug: s } = await params;
      setSlug(s);
      try {
        const res = await fetch(`/api/offres/${s}`);
        if (res.ok) {
          const json = await res.json();
          setCmd(json.offre as CmdData);
          setPdfUrl(json.offre?.pdf_url || "");
          setQrUrl(json.offre?.qr_url || "");
        }
      } catch { /* ignore */ }
      finally { setLoading(false); }
    }
    load();
  }, [params]);

  const handleQrDownload = useCallback(async () => {
    if (qrDownloading) return;

    // Si déjà disponible, télécharger directement
    if (qrUrl) {
      window.open(qrUrl, "_blank");
      return;
    }

    // Sinon : déclencher génération + poll avec jauge
    setQrDownloading(true);
    setQrProgress(5);

    try {
      // Lancer la génération
      fetch(`/api/offres/${slug}/qr`, { method: "POST" }).catch(() => {});

      // Poll toutes les 5s avec jauge
      let elapsed = 0;
      const maxWait = 90; // secondes max
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
              setTimeout(() => {
                window.open(json.qr_url, "_blank");
                setQrDownloading(false);
                setQrProgress(0);
              }, 400);
              return;
            }
          }
        } catch { /* ignore */ }
      }

      // Timeout
      setQrDownloading(false);
      setQrProgress(0);
      alert("Le QR paiement prend plus de temps que prévu. Réessayez dans quelques instants.");
    } catch {
      setQrDownloading(false);
      setQrProgress(0);
    }
  }, [slug, qrUrl, qrDownloading]);

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", fontFamily: FONT }}>
      Chargement…
    </div>
  );

  if (!cmd) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", fontFamily: FONT, flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: C.blue }}>Commande introuvable</div>
    </div>
  );

  const payMode = (cmd.data?.paymentMode as string) || cmd.payment_mode || "Paiement d'avance à la commande";
  const nomComplet = `${cmd.client_prenom || ""} ${cmd.client_nom || ""}`.trim();
  const isAcompte = payMode.includes("50%");
  const montantAPayer = isAcompte ? Math.round(cmd.total_ttc * 0.5 * 100) / 100 : cmd.total_ttc;

  return (
    <>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet"/>
      <style>{`
        *{box-sizing:border-box;margin:0;padding:0}
        body{font-family:${FONT};background:#F3F5F6;color:${C.text};font-size:15px}
        a{color:${C.text};text-decoration:none}
      `}</style>

      {/* ── HEADER — sans "Français" ── */}
      <div style={{ background: "#2B8AD1", padding: "6px 0" }}>
        <div style={{ maxWidth: 1260, margin: "0 auto", padding: "0 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ color: "white", fontSize: 12, letterSpacing: "0.06em", fontWeight: 500 }}>1&apos;000 M2 D&apos;EXPOSITION A LUTRY</span>
        </div>
      </div>
      <header style={{ background: "white", borderBottom: `1px solid ${C.border}`, marginBottom: 32 }}>
        <div style={{ maxWidth: 1260, margin: "0 auto", padding: "12px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <a href="https://www.jardin-confort.ch">
            <img src="https://www.jardin-confort.ch/cdn/shop/files/logo_JARDIN_CONFORT_shopify_51f35272-8a30-45a2-8718-36fb2af011c8.jpg?v=1736184411&width=480"
              alt="Jardin-Confort" style={{ height: 60, objectFit: "contain" }}/>
          </a>
          <a href="https://www.jardin-confort.ch" style={{ fontSize: 13, color: C.grey }}>
            ← Retour à la boutique
          </a>
        </div>
      </header>

      <div style={{ maxWidth: 1260, margin: "0 auto", padding: "0 24px 48px" }}>

        {/* Breadcrumb */}
        <div style={{ fontSize: 14, color: C.grey, marginBottom: 20 }}>
          Commandes / <span style={{ color: C.text }}>{cmd.numero_commande}</span>
        </div>

        {/* Titre */}
        <h1 style={{ fontSize: 36, fontWeight: 500, color: C.blue, letterSpacing: "-0.02em", marginBottom: 28 }}>
          Confirmation de commande
        </h1>

        {/* Bloc montants + actions */}
        <div style={{
          display: "grid", gridTemplateColumns: "1fr 320px", gap: 24, marginBottom: 24,
          background: "white", border: `1px solid ${C.border}`, borderRadius: 26,
          padding: 24, boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
        }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 20, padding: "18px 20px" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.grey, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>
                Montant total de la commande
              </div>
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

            {/* ── Bouton PDF confirmation — toujours ouvre le PDF direct, jamais la page print ── */}
            {pdfUrl ? (
              <a href={pdfUrl} target="_blank" rel="noopener noreferrer"
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  minHeight: 52, padding: "0 20px", borderRadius: 26,
                  background: C.blueBtn, color: "white", fontWeight: 600, fontSize: 15,
                }}>
                <svg width="16" height="16" fill="none" stroke="white" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                📄 Télécharger la confirmation PDF
              </a>
            ) : (
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                minHeight: 52, padding: "0 20px", borderRadius: 26,
                background: C.bg, color: C.grey, fontWeight: 600, fontSize: 14,
                border: `1px solid ${C.border}`,
              }}>
                ⏳ Confirmation PDF en préparation…
              </div>
            )}

            {/* ── Bouton QR paiement avec jauge ── */}
            <button
              onClick={handleQrDownload}
              disabled={qrDownloading}
              style={{
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6,
                minHeight: 52, padding: "10px 20px", borderRadius: 26,
                background: "white", color: qrDownloading ? C.grey : C.blueBtn,
                fontWeight: 600, fontSize: 15,
                border: `1px solid ${qrDownloading ? C.border : C.blueBtn}`,
                cursor: qrDownloading ? "wait" : "pointer",
                transition: "all 0.2s",
                width: "100%",
              }}>
              {qrDownloading ? (
                <>
                  <span style={{ fontSize: 13 }}>⏳ Génération en cours…</span>
                  <div style={{ width: "100%", background: "#E5E7EB", borderRadius: 99, height: 6, overflow: "hidden" }}>
                    <div style={{
                      height: "100%",
                      width: `${qrProgress}%`,
                      background: `linear-gradient(90deg, ${C.blueBtn}, #4aade8)`,
                      borderRadius: 99,
                      transition: "width 0.4s ease",
                    }} />
                  </div>
                  <span style={{ fontSize: 11, color: C.grey }}>{Math.round(qrProgress)}% — patientez</span>
                </>
              ) : (
                <>
                  <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                  📥 Télécharger le QR paiement
                </>
              )}
            </button>

            <a href="mailto:contact@jardinconfort.ch"
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                minHeight: 52, padding: "0 20px", borderRadius: 26,
                background: "white", color: C.text, fontWeight: 600, fontSize: 15,
                border: `1px solid ${C.border}`,
              }}>
              ✉️ Contacter Jardin-Confort
            </a>
          </div>
        </div>

        {/* Infos commande + client */}
        <div style={{ background: "white", border: `1px solid ${C.border}`, borderRadius: 26, padding: 28, marginBottom: 24, boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.blue, marginBottom: 14 }}>Informations sur la commande</div>
              {[
                ["Numéro de commande", cmd.numero_commande],
                ["Offre d'origine", cmd.offre_origine || "–"],
                ["Date de commande", fmtDate(cmd.date_document)],
                ["Mode de paiement", payMode],
                ["Votre conseiller", cmd.commercial],
              ].map(([k, v]) => (
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
              {[
                ["Nom du client", nomComplet],
                ["Email", cmd.client_email || "–"],
                ["Téléphone", cmd.client_tel1 || "–"],
                ["Adresse", [cmd.client_rue, `${cmd.client_npa || ""} ${cmd.client_ville || ""}`].filter(Boolean).join(", ")],
              ].map(([k, v]) => (
                <div key={k} style={{ marginBottom: 8, fontSize: 15, lineHeight: 1.55 }}>
                  <strong style={{ display: "inline-block", minWidth: 150, fontWeight: 700 }}>{k} :</strong>
                  <span>{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Message de confirmation */}
        <div style={{
          background: "#EEF7FF", border: "1px solid #B7D8F0", borderRadius: 22,
          padding: "22px 24px", marginBottom: 24, color: C.blue, lineHeight: 1.75, fontSize: 16,
        }}>
          <p style={{ marginBottom: 14 }}>
            Merci beaucoup <strong>{nomComplet}</strong> pour la validation de votre commande.
          </p>
          <p style={{ marginBottom: 14 }}>
            Notre équipe a été avertie de votre confirmation et va prendre contact avec vous au plus vite.
          </p>
          <p style={{ marginBottom: 14 }}>
            {isAcompte
              ? "Veuillez à présent procéder au paiement de l'acompte convenu (50%) sur notre compte bancaire selon les détails de paiement ci-dessous."
              : "Veuillez à présent procéder au paiement du montant convenu sur notre compte bancaire selon les détails de paiement ci-dessous."
            }
          </p>
          <p>
            Vous pouvez télécharger votre confirmation de commande à l&apos;aide du bouton prévu à cet effet.
            Pour toute question : <a href="mailto:contact@jardinconfort.ch" style={{ color: C.blue, fontWeight: 700 }}>contact@jardinconfort.ch</a>
          </p>
        </div>

        {/* ── QR Paiement — affiché via <object> pour PDF, pas <img> ── */}
        <div style={{ background: "white", border: `1px solid ${C.border}`, borderRadius: 26, padding: 28, marginBottom: 24, boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
          <h2 style={{ fontSize: 24, fontWeight: 600, color: C.blue, marginBottom: 8 }}>QR Paiement</h2>
          <p style={{ fontSize: 14, color: C.grey, marginBottom: 20, lineHeight: 1.6 }}>
            Veuillez scanner le QR code ci-dessous ou utiliser les coordonnées bancaires indiquées.
            Le montant à inscrire est : <strong>{fmt(montantAPayer)}</strong>
          </p>

          <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 20, padding: 20, marginBottom: 20, textAlign: "center", minHeight: 200 }}>
            {qrUrl ? (
              /* <object> affiche le PDF inline correctement sur tous les navigateurs */
              <object
                data={qrUrl}
                type="application/pdf"
                style={{ width: "100%", height: 560, borderRadius: 8, border: "none" }}
              >
                {/* Fallback si le navigateur ne supporte pas l'affichage inline */}
                <div style={{ padding: 24, textAlign: "center" }}>
                  <p style={{ marginBottom: 12, color: C.grey, fontSize: 14 }}>
                    Votre navigateur ne peut pas afficher le PDF directement.
                  </p>
                  <a href={qrUrl} target="_blank" rel="noopener noreferrer"
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 8,
                      padding: "10px 20px", borderRadius: 20,
                      background: C.blueBtn, color: "white", fontWeight: 600, fontSize: 14,
                    }}>
                    📥 Ouvrir le QR paiement
                  </a>
                </div>
              </object>
            ) : (
              <QrPoller slug={slug} onReady={setQrUrl} />
            )}
          </div>

          {/* Coordonnées bancaires */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            {[
              ["IBAN", "CH72 0076 7000 K033 3796 5"],
              ["Référence", cmd.numero_commande],
              ["Bénéficiaire", "Jardin-Confort SA"],
              ["Banque", "BCV – Banque Cantonale Vaudoise"],
            ].map(([label, value]) => (
              <div key={label} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 16, padding: "14px 16px" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.grey, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>{label}</div>
                <div style={{ fontSize: 15, color: C.text, fontWeight: 500 }}>{value}</div>
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* Footer */}
      <footer style={{ background: "white", borderTop: `1px solid ${C.border}`, padding: "20px 24px", textAlign: "center", fontSize: 12, color: C.grey }}>
        © {new Date().getFullYear()} Jardin-Confort SA · Route de Lavaux 425 · 1095 Lutry ·{" "}
        <a href="tel:+41217913671" style={{ color: C.grey }}>+41 21 791 36 71</a>
      </footer>
    </>
  );
}