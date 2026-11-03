"use client";
// components/AcompteWalleeBadge.tsx
// Pastille d'encaissement de la fiche commande. Ne s'affiche QUE si un paiement
// est connu : rien tant que l'argent n'est pas arrivé.
//
// 🔴 Règle, posée le 02.11.2026 : on n'affiche JAMAIS « non payé ». L'absence
// de badge signifie « nous ne savons pas », pas « le client n'a pas payé » — un
// acompte réglé en espèces au magasin, par TWINT au comptoir ou par virement QR
// n'est connu d'aucune de nos sources automatiques. Dire à un client qu'il n'a
// pas payé alors qu'il a payé serait pire que de ne rien dire.
//
// v3 (02.11.2026) : lit /api/acomptes, qui réunit les paiements Wallee (FULFILL)
// et les liens carte Saferpay (PAID). Le libellé suit la tranche et le moyen.
// Le nom du fichier reste `AcompteWalleeBadge` pour ne pas disperser le diff ;
// il sera renommé au chantier dashboard 2.0.

import React, { useEffect, useState } from "react";

type Encaissement = {
  id: string;
  source: "wallee" | "saferpay";
  moyen: string;
  tranche: string | null;
  montant: number | string | null;
  devise: string | null;
  paid_at: string | null;
  reference: string | null;
};

function fmtDateCourte(iso: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString("fr-CH", { day: "2-digit", month: "2-digit", timeZone: "Europe/Zurich" });
}
function fmtMontant(v: number | string | null, devise: string | null) {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return new Intl.NumberFormat("fr-CH", { style: "currency", currency: devise || "CHF", minimumFractionDigits: 2 }).format(n);
}
function libelle(tranche: string | null) {
  if (tranche === "solde") return "Solde reçu";
  if (tranche === "acompte") return "Acompte reçu";
  return "Paiement reçu";
}

export default function AcompteWalleeBadge({ numero }: { numero: string }) {
  const [encaissements, setEncaissements] = useState<Encaissement[] | null>(null);

  useEffect(() => {
    if (!numero) return;
    let actif = true;
    fetch(`/api/acomptes?numero=${encodeURIComponent(numero)}`)
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error || `Erreur ${r.status}`); return j; })
      .then(j => { if (actif) setEncaissements(j.encaissements || []); })
      .catch(() => { if (actif) setEncaissements([]); });
    return () => { actif = false; };
  }, [numero]);

  // Rien de connu (ou pas encore chargé) : aucun badge — l'absence ne doit pas
  // ressembler à une information.
  if (!encaissements || encaissements.length === 0) return null;

  return (
    <>
      {encaissements.map(e => {
        const date = fmtDateCourte(e.paid_at);
        const montant = fmtMontant(e.montant, e.devise);
        return (
          <span key={`${e.source}-${e.id}`}
            className="inline-flex items-center rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-medium text-emerald-300"
            title={`Paiement confirmé par ${e.source === "saferpay" ? "Saferpay" : "Wallee"} (${e.moyen}${e.reference ? `, réf. ${e.reference}` : ""})`}>
            ✅ {libelle(e.tranche)}{date ? ` le ${date}` : ""}{montant ? ` — ${montant}` : ""} · {e.moyen}
          </span>
        );
      })}
    </>
  );
}
