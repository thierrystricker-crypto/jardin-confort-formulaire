"use client";
// components/AcompteWalleeBadge.tsx
// Pastille « ✅ Acompte reçu » de la fiche commande (chantier « Acompte payé
// visible », 03.09.2026). Ne s'affiche QUE si Wallee a réconcilié un paiement
// (état FULFILL) pour ce numéro : rien tant que l'argent n'est pas arrivé.
// Lecture seule. Source : GET /api/acomptes-wallee?numero=…
// Même pattern que SuiviDelaisBlock / ArrivagesBlock : le composant fetch
// lui-même, la page ne porte qu'une ligne de JSX.
//
// v2 (05.09.2026) : une commande peut recevoir PLUSIEURS paiements (acompte
// puis solde, par QR ou par TWINT/PostFinance/PayPal). Le libellé suit la
// tranche relue dans transactions_wallee : « Acompte reçu », « Solde reçu »,
// ou « Paiement reçu » si la transaction n'est pas connue de l'app.

import React, { useEffect, useState } from "react";

type Acompte = {
  id: string; wallee_transaction_id: number; merchant_reference: string|null
  montant: number|string|null; devise: string|null; state: string
  commande_slug: string|null; paid_at: string|null; created_at: string
  mode: string|null; tranche: string|null
};

function fmtDateCourte(iso: string|null) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString("fr-CH", { day: "2-digit", month: "2-digit", timeZone: "Europe/Zurich" });
}
function fmtMontant(v: number|string|null, devise: string|null) {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return new Intl.NumberFormat("fr-CH", { style: "currency", currency: devise || "CHF", minimumFractionDigits: 2 }).format(n);
}
function libelle(tranche: string|null) {
  if (tranche === "solde") return "Solde reçu";
  if (tranche === "acompte") return "Acompte reçu";
  return "Paiement reçu";
}
function nomMode(mode: string|null) {
  if (mode === "qr") return "virement QR";
  if (mode === "twint") return "TWINT / PostFinance / PayPal";
  return "moyen inconnu de l'app";
}

export default function AcompteWalleeBadge({ numero }: { numero: string }) {
  const [acomptes, setAcomptes] = useState<Acompte[]|null>(null);

  useEffect(() => {
    if (!numero) return;
    let actif = true;
    fetch(`/api/acomptes-wallee?numero=${encodeURIComponent(numero)}`)
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error || `Erreur ${r.status}`); return j; })
      .then(j => { if (actif) setAcomptes(j.acomptes || []); })
      .catch(() => { if (actif) setAcomptes([]); });
    return () => { actif = false; };
  }, [numero]);

  // Rien reçu (ou pas encore chargé) : aucun badge — l'absence ne doit pas
  // ressembler à une information.
  if (!acomptes || acomptes.length === 0) return null;

  return (
    <>
      {acomptes.map(a => {
        const date = fmtDateCourte(a.paid_at);
        const montant = fmtMontant(a.montant, a.devise);
        return (
          <span key={a.id}
            className="inline-flex items-center rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-medium text-emerald-300"
            title={`Paiement réconcilié par Wallee (transaction ${a.wallee_transaction_id}, ${nomMode(a.mode)})`}>
            ✅ {libelle(a.tranche)}{date ? ` le ${date}` : ""}{montant ? ` — ${montant}` : ""}
          </span>
        );
      })}
    </>
  );
}
