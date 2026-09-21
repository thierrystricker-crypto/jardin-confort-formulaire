"use client";
// components/WalleeLienPaiement.tsx
// Bloc « Liens de paiement Wallee » de la fiche commande (chantier du 04.09.2026,
// v2 le 05.09.2026). Usage MANUEL : le vendeur crée les transactions, ouvre ou
// copie les pages de paiement, télécharge la QR-facture. Les flux client
// (validation, mail Make, mail pré-écrit) ne sont pas touchés — seule la page
// de confirmation client sert désormais le PDF Wallee quand il existe.
//
// v2 : une commande porte plusieurs liens EN PARALLÈLE, un par (mode, tranche) :
//   - 💠 QR acompte          (mode 'qr',    tranche 'acompte')
//   - 💠 QR solde            (mode 'qr',    tranche 'solde')  — si « Acompte de 50 % »
//   - 📱 TWINT / PostFinance / PayPal  (mode 'twint', tranche 'acompte' ou 'solde')
// Le client choisit ; un lien QR reste actif même si un lien TWINT existe.
//
// Même pattern que AcompteWalleeBadge : le composant fetch lui-même, la page
// ne porte qu'une ligne de JSX. Source : GET/POST /api/wallee-transactions.
//
// L'URL de page de paiement est tokenisée et temporaire : elle n'est jamais
// stockée, on la redemande à chaque ouverture / copie.

import React, { useCallback, useEffect, useState } from "react";

type Mode = "qr" | "twint";
type Tranche = "acompte" | "solde";
type Tx = {
  id: string; wallee_transaction_id: number; merchant_reference: string
  montant: number|string; devise: string; is_acompte: boolean; libelle: string|null
  state: string; state_checked_at: string|null; created_at: string
  mode: Mode; tranche: Tranche; payment_page_url: string|null
};
type Etat = {
  transactions: Tx[]; montant_acompte: number; montant_solde: number|null
  solde_applicable: boolean; wallee_configure: boolean
};

const ETATS_ECHEC = new Set(["FAILED", "VOIDED", "DECLINE"]);
const ETATS_PAYABLES = new Set(["PENDING", "CONFIRMED"]);
const ETATS_FACTURE = new Set(["AUTHORIZED", "COMPLETED", "FULFILL"]);

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
function libelleEtat(state: string, mode: Mode): { texte: string; classe: string } {
  switch (state) {
    case "PENDING":    return { texte: "⏳ En attente — page pas encore ouverte", classe: "bg-amber-500/15 text-amber-300" };
    case "CONFIRMED":  return { texte: "👁 Ouverte par le client", classe: "bg-sky-500/15 text-sky-300" };
    case "PROCESSING": return { texte: "🔄 Paiement en cours", classe: "bg-sky-500/15 text-sky-300" };
    case "AUTHORIZED":
    case "COMPLETED":  return mode === "qr"
      ? { texte: "🧾 QR-facture émise — en attente du virement", classe: "bg-sky-500/15 text-sky-300" }
      : { texte: "🕓 Paiement annoncé — en attente de confirmation", classe: "bg-sky-500/15 text-sky-300" };
    case "FULFILL":    return { texte: "✅ Payée (confirmée par Wallee)", classe: "bg-emerald-500/15 text-emerald-300" };
    case "FAILED":     return { texte: "⚠️ Expirée / échouée", classe: "bg-rose-500/15 text-rose-300" };
    case "VOIDED":     return { texte: "⚠️ Annulée", classe: "bg-rose-500/15 text-rose-300" };
    case "DECLINE":    return { texte: "⚠️ Refusée", classe: "bg-rose-500/15 text-rose-300" };
    default:           return { texte: state, classe: "bg-zinc-500/15 text-zinc-300" };
  }
}
function nomMode(mode: Mode) { return mode === "qr" ? "QR-facture" : "TWINT / PostFinance / PayPal"; }
function nomTranche(tranche: Tranche) { return tranche === "solde" ? "Solde" : "Acompte"; }
function icone(mode: Mode) { return mode === "qr" ? "💠" : "📱"; }

const BTN = "inline-flex items-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-50";
const BTN_LIGHT = "inline-flex items-center rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-2 text-sm text-emerald-300/80 transition hover:bg-emerald-500/15 disabled:opacity-50";
const BTN_SMALL = "inline-flex items-center rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-1 text-xs text-emerald-300/80 transition hover:bg-emerald-500/15 disabled:opacity-50";

// Ouvre un onglet AVANT l'appel réseau (anti-popup-blocker), comme ouvrirQrAJour.
function ongletAttente(titre: string): Window | null {
  const onglet = window.open("", "_blank");
  if (onglet) {
    onglet.document.write(
      `<!doctype html><meta charset="utf-8"><title>${titre}</title>` +
      `<body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;font-family:system-ui,sans-serif;color:#334;background:#f6f7f9">` +
      `<div style="text-align:center"><div style="font-size:15px">${titre}</div>` +
      `<div style="margin-top:8px;font-size:13px;color:#889">quelques secondes</div></div>`
    );
  }
  return onglet;
}

export default function WalleeLienPaiement({ slug }: { slug: string }) {
  const [etat, setEtat] = useState<Etat|null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>("");
  const [copie, setCopie] = useState<string>("");

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

  async function creer(mode: Mode, tranche: Tranche, force = false) {
    if (!slug || busy) return;
    const onglet = ongletAttente("Création de la transaction Wallee…");
    setBusy(true); setMessage("");
    try {
      const r = await fetch("/api/wallee-transactions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, mode, tranche, force }),
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
  async function ouvrir(tx: Tx) {
    if (busy) return;
    const onglet = ongletAttente("Page de paiement Wallee…");
    setBusy(true); setMessage("");
    try {
      const j = await charger();
      const url = j?.transactions.find(t => t.id === tx.id)?.payment_page_url || null;
      if (url) {
        if (onglet) onglet.location.replace(url); else window.open(url, "_blank");
      } else {
        if (onglet) onglet.close();
        setMessage("Aucune page de paiement disponible pour l'état actuel de la transaction.");
      }
    } finally { setBusy(false); }
  }

  async function copier(tx: Tx) {
    if (busy) return;
    setBusy(true); setMessage("");
    try {
      const j = await charger();
      const url = j?.transactions.find(t => t.id === tx.id)?.payment_page_url || null;
      if (url) {
        await navigator.clipboard.writeText(url);
        setCopie(tx.id); window.setTimeout(() => setCopie(""), 2500);
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

  // Ligne courante de chaque (mode, tranche) — transactions triées de la plus récente à la plus ancienne.
  const courantes = new Map<string, Tx>();
  for (const t of etat.transactions) {
    const cle = `${t.mode}:${t.tranche}`;
    if (!courantes.has(cle)) courantes.set(cle, t);
  }
  const tranches: Tranche[] = etat.solde_applicable ? ["acompte", "solde"] : ["acompte"];
  const modes: Mode[] = ["qr", "twint"];
  const montantTranche = (tranche: Tranche) => tranche === "solde" ? (etat.montant_solde ?? 0) : etat.montant_acompte;

  // Aucune transaction : uniquement les boutons de création, sur une ligne.
  const aucune = courantes.size === 0;

  return (
    <div className="flex w-full flex-col gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-emerald-400/70">Wallee</span>
        {tranches.map(tranche => modes.map(mode => {
          const courante = courantes.get(`${mode}:${tranche}`);
          // Bouton de création : s'il n'y a pas de transaction vivante pour ce (mode, tranche).
          if (courante && !ETATS_ECHEC.has(courante.state)) return null;
          const libelle = `${icone(mode)} ${courante ? "Régénérer" : "Créer"} ${mode === "qr" ? "QR" : "TWINT / PostFinance / PayPal"} ${tranche === "solde" ? "solde" : "acompte"}`;
          return (
            <button key={`${mode}:${tranche}`} onClick={() => creer(mode, tranche)} disabled={busy}
              className={aucune && mode === "qr" && tranche === "acompte" ? BTN : BTN_LIGHT}
              title={mode === "qr"
                ? `Crée chez Wallee une transaction « virement bancaire avec QR-facture » de ${fmtMontant(montantTranche(tranche))} (${nomTranche(tranche).toLowerCase()}), mails Wallee coupés, et ouvre la page de paiement`
                : `Crée chez Wallee une transaction de ${fmtMontant(montantTranche(tranche))} (${nomTranche(tranche).toLowerCase()}) limitée à TWINT, PostFinance Pay / e-finance / Carte PostFinance et PayPal — jamais « Facture » — et ouvre la page de paiement`}>
              {busy ? "⏳ Wallee…" : libelle}
            </button>
          );
        }))}
        <button onClick={() => charger()} disabled={busy} className="text-xs text-zinc-500 hover:text-zinc-300" title="Relire l'état chez Wallee">↻</button>
      </div>

      {Array.from(courantes.values())
        .sort((a, b) => (a.tranche === b.tranche ? (a.mode === "qr" ? -1 : 1) : a.tranche === "acompte" ? -1 : 1))
        .map(tx => {
          const { texte, classe } = libelleEtat(tx.state, tx.mode);
          const enEchec = ETATS_ECHEC.has(tx.state);
          const payable = ETATS_PAYABLES.has(tx.state);
          const factureDisponible = tx.mode === "qr" && ETATS_FACTURE.has(tx.state);
          const montantTx = Number(tx.montant);
          const montantDiffere = !enEchec && Number.isFinite(montantTx) && Math.abs(montantTx - montantTranche(tx.tranche)) >= 0.005;
          const anciennes = etat.transactions.filter(t => t.mode === tx.mode && t.tranche === tx.tranche).length - 1;
          return (
            <div key={tx.id} className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-zinc-300">{icone(tx.mode)} {nomTranche(tx.tranche)} · {nomMode(tx.mode)}</span>
              <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${classe}`}
                title={`Transaction ${tx.wallee_transaction_id} · créée le ${fmtDate(tx.created_at)}${tx.state_checked_at ? ` · état relu le ${fmtDate(tx.state_checked_at)}` : ""}`}>
                {texte}
              </span>
              <span className="text-xs text-zinc-400">{fmtMontant(tx.montant)} · n° {tx.wallee_transaction_id}</span>

              {payable && (
                <>
                  <button onClick={() => ouvrir(tx)} disabled={busy} className={BTN_SMALL} title="Régénère une URL de page de paiement fraîche et l'ouvre">
                    Ouvrir
                  </button>
                  <button onClick={() => copier(tx)} disabled={busy} className={BTN_SMALL}
                    title="Copie une URL fraîche. Ce lien est temporaire : copiez-le juste avant de l'envoyer.">
                    {copie === tx.id ? "✓ Lien copié" : "🔗 Copier le lien"}
                  </button>
                </>
              )}
              {factureDisponible && (
                <a href={`/api/wallee-transactions?slug=${encodeURIComponent(slug)}&document=facture&tranche=${tx.tranche}`}
                  target="_blank" rel="noopener noreferrer" className={BTN_SMALL}
                  title="Le PDF « Facture » rendu par Wallee, avec le bulletin QR suisse — le client le trouve aussi sur sa page de confirmation">
                  📄 QR-facture Wallee
                </a>
              )}
              {montantDiffere && (
                <button onClick={() => creer(tx.mode, tx.tranche, true)} disabled={busy} className={BTN_SMALL}
                  title={`Le document vaut aujourd'hui ${fmtMontant(montantTranche(tx.tranche))} pour cette tranche, la transaction ${fmtMontant(tx.montant)}. Crée une nouvelle transaction au montant courant (l'ancienne reste dans l'historique).`}>
                  ⚠️ Montant modifié — nouvelle transaction
                </button>
              )}
              {anciennes > 0 && <span className="text-[11px] text-zinc-500">+{anciennes} antérieure{anciennes > 1 ? "s" : ""}</span>}
            </div>
          );
        })}

      {message && <span className="w-full text-xs text-rose-300">{message}</span>}
    </div>
  );
}
