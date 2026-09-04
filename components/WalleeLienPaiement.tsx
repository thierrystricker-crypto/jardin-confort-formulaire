"use client";
// components/WalleeLienPaiement.tsx
// Bloc « Lien de paiement Wallee » de la fiche commande (chantier du 04.09.2026,
// amont de « Acompte payé visible »). Usage MANUEL pour l'instant : le vendeur
// crée la transaction, ouvre ou copie la page de paiement. Les flux client
// (validation, mail Make, mail pré-écrit) ne sont pas touchés.
//
// Même pattern que AcompteWalleeBadge : le composant fetch lui-même, la page
// ne porte qu'une ligne de JSX. Source : GET/POST /api/wallee-transactions.
//
// L'URL de page de paiement est tokenisée et temporaire : elle n'est jamais
// stockée, on la redemande à chaque ouverture / copie.

import React, { useCallback, useEffect, useState } from "react";

type Tx = {
  id: string; wallee_transaction_id: number; merchant_reference: string
  montant: number|string; devise: string; is_acompte: boolean; libelle: string|null
  state: string; state_checked_at: string|null; created_at: string
};
type Etat = {
  transactions: Tx[]; payment_page_url: string|null
  montant_document: number; wallee_configure: boolean
};

const ETATS_ECHEC = new Set(["FAILED", "VOIDED", "DECLINE"]);

function fmtMontant(v: number|string|null|undefined) {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("fr-CH", { style: "currency", currency: "CHF", minimumFractionDigits: 2 }).format(n);
}
function fmtDate(iso: string|null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("fr-CH", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Zurich" });
}
function libelleEtat(state: string): { texte: string; classe: string } {
  switch (state) {
    case "PENDING":    return { texte: "⏳ En attente — page pas encore ouverte", classe: "bg-amber-500/15 text-amber-300" };
    case "CONFIRMED":  return { texte: "👁 Ouverte par le client", classe: "bg-sky-500/15 text-sky-300" };
    case "PROCESSING": return { texte: "🔄 Paiement en cours", classe: "bg-sky-500/15 text-sky-300" };
    case "AUTHORIZED":
    case "COMPLETED":  return { texte: "🕓 Paiement annoncé — en attente de réconciliation", classe: "bg-sky-500/15 text-sky-300" };
    case "FULFILL":    return { texte: "✅ Payée (réconciliée par Wallee)", classe: "bg-emerald-500/15 text-emerald-300" };
    case "FAILED":     return { texte: "⚠️ Expirée / échouée", classe: "bg-rose-500/15 text-rose-300" };
    case "VOIDED":     return { texte: "⚠️ Annulée", classe: "bg-rose-500/15 text-rose-300" };
    case "DECLINE":    return { texte: "⚠️ Refusée", classe: "bg-rose-500/15 text-rose-300" };
    default:           return { texte: state, classe: "bg-zinc-500/15 text-zinc-300" };
  }
}

const BTN = "inline-flex items-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-50";
const BTN_LIGHT = "inline-flex items-center rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-2 text-sm text-emerald-300/80 transition hover:bg-emerald-500/15 disabled:opacity-50";

export default function WalleeLienPaiement({ slug }: { slug: string }) {
  const [etat, setEtat] = useState<Etat|null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>("");
  const [copie, setCopie] = useState(false);

  const charger = useCallback(async (): Promise<Etat|null> => {
    if (!slug) return null;
    try {
      const r = await fetch(`/api/wallee-transactions?slug=${encodeURIComponent(slug)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Erreur ${r.status}`);
      setEtat(j);
      return j as Etat;
    } catch (e) {
      setMessage(String((e as Error).message || e));
      return null;
    }
  }, [slug]);

  useEffect(() => { charger(); }, [charger]);

  // Création : on ouvre l'onglet AVANT l'appel (anti-popup-blocker), comme ouvrirQrAJour.
  async function creer(force = false) {
    if (!slug || busy) return;
    const onglet = window.open("", "_blank");
    if (onglet) {
      onglet.document.write(
        `<!doctype html><meta charset="utf-8"><title>Wallee…</title>` +
        `<body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;font-family:system-ui,sans-serif;color:#334;background:#f6f7f9">` +
        `<div style="text-align:center"><div style="font-size:15px">Création de la transaction Wallee…</div>` +
        `<div style="margin-top:8px;font-size:13px;color:#889">quelques secondes</div></div>`
      );
    }
    setBusy(true); setMessage("");
    try {
      const r = await fetch("/api/wallee-transactions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, force }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Erreur ${r.status}`);
      if (j.payment_page_url) {
        if (onglet) onglet.location.replace(j.payment_page_url); else window.open(j.payment_page_url, "_blank");
      } else {
        if (onglet) onglet.close();
        setMessage("Transaction créée, mais Wallee n'a pas rendu d'URL de page. Réessayez « Ouvrir ».");
      }
      await charger();
    } catch (e) {
      if (onglet) onglet.close();
      setMessage(String((e as Error).message || e));
    } finally { setBusy(false); }
  }

  // Ouvrir : URL FRAÎCHE à chaque fois (GET la régénère).
  async function ouvrir() {
    if (busy) return;
    const onglet = window.open("", "_blank");
    setBusy(true); setMessage("");
    try {
      const j = await charger();
      if (j?.payment_page_url) {
        if (onglet) onglet.location.replace(j.payment_page_url); else window.open(j.payment_page_url, "_blank");
      } else {
        if (onglet) onglet.close();
        setMessage("Aucune page de paiement disponible pour l'état actuel de la transaction.");
      }
    } finally { setBusy(false); }
  }

  async function copier() {
    if (busy) return;
    setBusy(true); setMessage("");
    try {
      const j = await charger();
      if (j?.payment_page_url) {
        await navigator.clipboard.writeText(j.payment_page_url);
        setCopie(true); window.setTimeout(() => setCopie(false), 2500);
      } else {
        setMessage("Aucune page de paiement disponible pour l'état actuel de la transaction.");
      }
    } catch (e) {
      setMessage(String((e as Error).message || e));
    } finally { setBusy(false); }
  }

  if (!etat) return null;
  if (!etat.wallee_configure) {
    return <span className="text-xs text-zinc-500">Wallee non configuré sur cet environnement.</span>;
  }

  const courante = etat.transactions[0] ?? null;

  // Aucune transaction : le bouton de création, et rien d'autre.
  if (!courante) {
    return (
      <>
        <button onClick={() => creer(false)} disabled={busy}
          title="Crée la transaction chez Wallee (montant de l'acompte du document, tous moyens de paiement du space, mails Wallee coupés) et ouvre la page de paiement"
          className={BTN}>
          {busy ? "⏳ Création Wallee…" : "💠 Créer lien de paiement Wallee"}
        </button>
        {message && <span className="text-xs text-rose-300">{message}</span>}
      </>
    );
  }

  const { texte, classe } = libelleEtat(courante.state);
  const enEchec = ETATS_ECHEC.has(courante.state);
  const payable = courante.state === "PENDING" || courante.state === "CONFIRMED";
  // La QR-facture Wallee existe dès que le client a validé le virement QR.
  const factureDisponible = ["AUTHORIZED", "COMPLETED", "FULFILL"].includes(courante.state);
  const montantTx = Number(courante.montant);
  const montantDiffere = Number.isFinite(montantTx) && Math.abs(montantTx - etat.montant_document) >= 0.005;
  const anciennes = etat.transactions.length - 1;

  return (
    <div className="flex w-full flex-wrap items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-emerald-400/70">Wallee</span>
      <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${classe}`}
        title={`Transaction ${courante.wallee_transaction_id} · créée le ${fmtDate(courante.created_at)}${courante.state_checked_at ? ` · état relu le ${fmtDate(courante.state_checked_at)}` : ""}`}>
        {texte}
      </span>
      <span className="text-xs text-zinc-400">
        {courante.libelle || (courante.is_acompte ? "Acompte 50%" : "Paiement d'avance")} · {fmtMontant(courante.montant)} · n° {courante.wallee_transaction_id}
      </span>

      {payable && (
        <>
          <button onClick={ouvrir} disabled={busy} className={BTN} title="Régénère une URL de page de paiement fraîche et l'ouvre">
            💠 Ouvrir la page de paiement
          </button>
          <button onClick={copier} disabled={busy} className={BTN_LIGHT}
            title="Copie une URL fraîche. Ce lien est temporaire : copiez-le juste avant de l'envoyer.">
            {copie ? "✓ Lien copié" : "🔗 Copier le lien"}
          </button>
        </>
      )}
      {factureDisponible && (
        <a href={`/api/wallee-transactions?slug=${encodeURIComponent(slug)}&document=facture`}
          target="_blank" rel="noopener noreferrer" className={BTN}
          title="Le PDF « Facture » rendu par Wallee, avec le bulletin QR suisse — à joindre au mail du client (les mails Wallee sont coupés)">
          📄 QR-facture Wallee
        </a>
      )}
      {enEchec && (
        <button onClick={() => creer(false)} disabled={busy} className={BTN} title="Crée une nouvelle transaction (l'ancienne reste dans l'historique)">
          {busy ? "⏳ Création Wallee…" : "🔁 Régénérer le lien"}
        </button>
      )}
      {!enEchec && montantDiffere && (
        <button onClick={() => creer(true)} disabled={busy} className={BTN_LIGHT}
          title={`Le document vaut aujourd'hui ${fmtMontant(etat.montant_document)} d'acompte, la transaction ${fmtMontant(courante.montant)}. Crée une nouvelle transaction au montant courant.`}>
          ⚠️ Montant modifié — nouvelle transaction
        </button>
      )}
      <button onClick={() => charger()} disabled={busy} className="text-xs text-zinc-500 hover:text-zinc-300" title="Relire l'état chez Wallee">↻</button>

      {anciennes > 0 && <span className="text-[11px] text-zinc-500">+{anciennes} transaction{anciennes > 1 ? "s" : ""} antérieure{anciennes > 1 ? "s" : ""}</span>}
      {message && <span className="w-full text-xs text-rose-300">{message}</span>}
    </div>
  );
}
