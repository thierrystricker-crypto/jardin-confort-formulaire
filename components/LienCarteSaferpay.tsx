"use client";
// components/LienCarteSaferpay.tsx
// Bloc « Lien carte » de la fiche commande — chantier « Lien carte Saferpay »,
// 02.11.2026. Jumeau de WalleeLienPaiement, pour le prestataire CARTE.
//
// Usage MANUEL et sur demande : le client reçoit le QR par défaut ; le lien
// carte ne part que s'il le réclame (décision du 02.11 — on ne paie les 1,7 %
// que quand c'est nécessaire). Le vendeur crée le lien, le copie, l'envoie.
//
// Contrairement à Wallee, le lien Saferpay est STABLE jusqu'à son expiration
// (+30 jours) : on l'affiche et on le copie tel quel, sans le régénérer.
//
// Source : GET/POST /api/saferpay-transactions. Le composant fetch lui-même,
// la page ne porte qu'une ligne de JSX — même patron que les autres blocs.

import React, { useCallback, useEffect, useState } from "react";

type Tranche = "acompte" | "solde";
type Statut = "OPEN" | "PAID" | "EXPIRED" | "DISABLED";

type Tx = {
  id: string; offer_id: string; merchant_reference: string
  montant: number|string; devise: string; tranche: Tranche; libelle: string|null
  statut: Statut; transaction_id: string|null; payment_link: string
  expiration_date: string|null; paid_at: string|null; environnement: string
  created_at: string
};
type Etat = {
  transactions: Tx[]; montant_acompte: number; montant_solde: number|null
  solde_applicable: boolean; est_commande: boolean
  saferpay_configure: boolean; environnement: string|null
};

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
function libelleStatut(s: Statut): { texte: string; classe: string } {
  switch (s) {
    case "OPEN":     return { texte: "⏳ Lien actif — en attente de paiement", classe: "bg-amber-500/15 text-amber-300" };
    case "PAID":     return { texte: "✅ Payé par carte", classe: "bg-emerald-500/15 text-emerald-300" };
    case "EXPIRED":  return { texte: "⌛ Lien expiré", classe: "bg-rose-500/15 text-rose-300" };
    case "DISABLED": return { texte: "⚠️ Lien désactivé", classe: "bg-rose-500/15 text-rose-300" };
    default:         return { texte: s, classe: "bg-zinc-500/15 text-zinc-300" };
  }
}
function nomTranche(t: Tranche) { return t === "solde" ? "Solde" : "Acompte"; }

const BTN = "inline-flex items-center rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-2 text-sm text-sky-300 transition hover:bg-sky-500/20 disabled:opacity-50";
const BTN_SMALL = "inline-flex items-center rounded-lg border border-sky-500/20 bg-sky-500/5 px-3 py-1 text-xs text-sky-300/80 transition hover:bg-sky-500/15 disabled:opacity-50";

export default function LienCarteSaferpay({ slug }: { slug: string }) {
  const [etat, setEtat] = useState<Etat|null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>("");
  const [copie, setCopie] = useState<string>("");

  // 03.11.2026 — après une relecture, le badge d'encaissement en haut de fiche
  // restait périmé : il se charge à son montage et ignorait ce composant. Le ↻
  // mettait donc à jour le bloc carte et la base, mais pas la ligne que le
  // vendeur regarde en premier. Un événement de fenêtre suffit à les relier,
  // sans remonter d'état dans une page de 120 Ko.
  const charger = useCallback(async (notifier = false): Promise<Etat|null> => {
    if (!slug) return null;
    try {
      const r = await fetch(`/api/saferpay-transactions?slug=${encodeURIComponent(slug)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Erreur ${r.status}`);
      setEtat(j);
      setMessage("");
      if (notifier) window.dispatchEvent(new CustomEvent("jc:encaissements-maj"));
      return j as Etat;
    } catch (e) {
      // On AFFICHE l'erreur au lieu de disparaître : une fonction en panne qui
      // se cache nous a déjà coûté deux mois sur le bloc Wallee.
      setMessage(String((e as Error).message || e));
      return null;
    }
  }, [slug]);

  useEffect(() => { charger(); }, [charger]);

  async function creer(tranche: Tranche) {
    if (!slug || busy) return;
    setBusy(true); setMessage("");
    try {
      const r = await fetch("/api/saferpay-transactions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, tranche }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Erreur ${r.status}`);
      await charger(true);
    } catch (e) {
      setMessage(String((e as Error).message || e));
    } finally { setBusy(false); }
  }

  async function copier(tx: Tx) {
    try {
      await navigator.clipboard.writeText(tx.payment_link);
      setCopie(tx.id); window.setTimeout(() => setCopie(""), 2500);
    } catch (e) {
      setMessage(String((e as Error).message || e));
    }
  }

  // Erreur avant tout chargement : on le dit, on ne s'efface pas.
  if (!etat) {
    return message
      ? <span className="text-xs text-rose-300">Lien carte indisponible — {message}</span>
      : null;
  }
  if (!etat.est_commande) return null;
  if (!etat.saferpay_configure) {
    return <span className="text-xs text-zinc-500">Saferpay non configuré sur cet environnement.</span>;
  }

  const courantes = new Map<Tranche, Tx>();
  for (const t of etat.transactions) if (!courantes.has(t.tranche)) courantes.set(t.tranche, t);
  const tranches: Tranche[] = etat.solde_applicable ? ["acompte", "solde"] : ["acompte"];
  const montantTranche = (t: Tranche) => t === "solde" ? (etat.montant_solde ?? 0) : etat.montant_acompte;

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-sky-400/70">
          Carte {etat.environnement === "test" && <span className="ml-1 rounded bg-amber-500/20 px-1.5 py-0.5 text-amber-300">TEST</span>}
        </span>
        {tranches.map(tranche => {
          const courante = courantes.get(tranche);
          // Un lien ouvert ou déjà payé : pas de bouton de création.
          if (courante && (courante.statut === "OPEN" || courante.statut === "PAID")) return null;
          return (
            <button key={tranche} onClick={() => creer(tranche)} disabled={busy} className={BTN}
              title={`Crée un lien de paiement par carte de ${fmtMontant(montantTranche(tranche))} (${nomTranche(tranche).toLowerCase()}), valable 30 jours. À envoyer au client qui demande à payer par carte.`}>
              {busy ? "⏳ Création…" : `💳 ${courante ? "Nouveau lien" : "Créer lien"} carte ${tranche === "solde" ? "solde" : "acompte"}`}
            </button>
          );
        })}
        <button onClick={() => charger(true)} disabled={busy} className="text-xs text-zinc-500 hover:text-zinc-300" title="Relire le statut chez Saferpay">↻</button>
      </div>

      {Array.from(courantes.values())
        .sort((a, b) => (a.tranche === b.tranche ? 0 : a.tranche === "acompte" ? -1 : 1))
        .map(tx => {
          const { texte, classe } = libelleStatut(tx.statut);
          const montantDiffere = tx.statut === "OPEN"
            && Number.isFinite(Number(tx.montant))
            && Math.abs(Number(tx.montant) - montantTranche(tx.tranche)) >= 0.005;
          return (
            <div key={tx.id} className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-zinc-300">💳 {nomTranche(tx.tranche)}</span>
              <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${classe}`}
                title={`Offre ${tx.offer_id}${tx.transaction_id ? ` · transaction ${tx.transaction_id}` : ""} · créée le ${fmtDate(tx.created_at)}`}>
                {texte}
              </span>
              <span className="text-xs text-zinc-400">
                {fmtMontant(tx.montant)}
                {tx.statut === "OPEN" && tx.expiration_date ? ` · valable jusqu'au ${fmtDate(tx.expiration_date)}` : ""}
                {tx.statut === "PAID" && tx.paid_at ? ` · le ${fmtDate(tx.paid_at)}` : ""}
              </span>

              {tx.statut === "OPEN" && (
                <>
                  <button onClick={() => copier(tx)} className={BTN_SMALL}
                    title="Copie le lien à envoyer au client. Il reste valable jusqu'à sa date d'expiration.">
                    {copie === tx.id ? "✓ Lien copié" : "🔗 Copier le lien"}
                  </button>
                  <a href={tx.payment_link} target="_blank" rel="noopener noreferrer" className={BTN_SMALL}
                    title="Ouvre la page de paiement telle que la verra le client">
                    Ouvrir
                  </a>
                </>
              )}
              {montantDiffere && (
                <span className="text-[11px] text-amber-300"
                  title={`Le document vaut aujourd'hui ${fmtMontant(montantTranche(tx.tranche))} pour cette tranche.`}>
                  ⚠️ Montant du document modifié depuis
                </span>
              )}
            </div>
          );
        })}

      {message && <span className="w-full text-xs text-rose-300">{message}</span>}
    </div>
  );
}
