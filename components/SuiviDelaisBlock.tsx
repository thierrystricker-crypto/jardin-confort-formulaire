"use client";
// components/SuiviDelaisBlock.tsx
// Carte « Délais fournisseurs » de la page commande (chantier Arrivages,
// 23.08) : ce que le dashboard délais sait de CETTE commande — une ligne par
// marque, départ fournisseur brut ET arrivage calculé (toujours ensemble),
// étape, alarmes, promesse client. Lecture seule ; la saisie reste sur le
// dashboard délais et la page Arrivages. Source : GET /api/delais?numero=…

import React, { useEffect, useState } from "react";
import Link from "next/link";

type LigneSuivi = {
  id: string; marque: string; statut: string; etape: string
  date_depart_pilote: string|null; semaine_annoncee_pilote: string|null
  arrivage_calcule: string|null; arrivage_estime_reel: string|null
  preuve_depart: string|null; date_expedition_reelle: string|null
  regle_transit: string|null; delai_annonce_client: string|null
  date_reception: string|null; date_reception_partielle: string|null
  jours_retard: number; jours_avant_echeance: number|null
  alarme_retard: boolean; alarme_echeance_proche: boolean; alarme_delai_manquant: boolean
  nb_reports: number; nb_a_valider: number; marque_suivie: boolean
  nb_lignes: number|null; nb_lignes_couvertes: number|null; reception_partielle: boolean
};

const JOURS = ["di","lu","ma","me","je","ve","sa"];
function fmtCourte(iso: string|null|undefined) {
  if (!iso) return "—";
  const d = new Date(`${String(iso).slice(0,10)}T12:00:00Z`);
  if (isNaN(d.getTime())) return "—";
  return `${JOURS[d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2,"0")}.${String(d.getUTCMonth()+1).padStart(2,"0")}.${String(d.getUTCFullYear()).slice(2)}`;
}
const ETAPES: Record<string,{label: string; cls: string}> = {
  sans_delai:             { label: "Sans délai",       cls: "bg-zinc-500/15 text-zinc-300" },
  confirmee:              { label: "Confirmée",        cls: "bg-sky-500/15 text-sky-300" },
  partiellement_expediee: { label: "Part. expédiée",   cls: "bg-teal-500/15 text-teal-300" },
  facturee:               { label: "🚚 Facturée",      cls: "bg-emerald-500/15 text-emerald-300" },
  expediee:               { label: "🚚 Expédiée",      cls: "bg-emerald-500/15 text-emerald-300" },
  recue:                  { label: "✅ Reçue",          cls: "bg-emerald-500/25 text-emerald-200" },
  partiellement_recue:    { label: "📦 Part. reçue",    cls: "bg-lime-500/15 text-lime-200" },
  en_stock:               { label: "🏬 En stock",       cls: "bg-zinc-500/20 text-zinc-200" },
  marque_non_suivie:      { label: "Marque non suivie", cls: "bg-zinc-500/10 text-zinc-400" },
};

export default function SuiviDelaisBlock({ numero }: { numero: string }) {
  const [lignes, setLignes] = useState<LigneSuivi[]|null>(null);
  const [erreur, setErreur] = useState("");

  useEffect(() => {
    let actif = true;
    fetch(`/api/delais?numero=${encodeURIComponent(numero)}`)
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error || `Erreur ${r.status}`); return j; })
      .then(j => { if (actif) setLignes(j.lignes || []); })
      .catch(e => { if (actif) { setErreur((e as Error).message); setLignes([]); } });
    return () => { actif = false; };
  }, [numero]);

  // Pas de ligne de suivi (commande d'avant août, ou déjà clôturée) : rien à montrer.
  if (lignes && lignes.length === 0 && !erreur) return null;

  return (
    <section className="rounded-2xl border border-rose-500/20 bg-[#2a2d31] p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">⏱ Délais fournisseurs</h2>
          <p className="text-xs text-zinc-500">Départ fournisseur brut ET arrivage calculé, toujours ensemble — la réception se saisit sur la page Arrivages.</p>
        </div>
        <Link href={`/dashboard/delais?q=${encodeURIComponent(numero)}`}
          className="rounded-xl border border-rose-500/30 bg-rose-500/15 px-3 py-1.5 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/20">
          ⏱ Ouvrir le dashboard délais →
        </Link>
      </div>

      {!lignes && !erreur && <div className="text-sm text-zinc-500">Chargement…</div>}
      {erreur && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">{erreur}</div>}

      <div className="space-y-2">
        {(lignes || []).map(l => {
          const etape = ETAPES[l.etape] || ETAPES.sans_delai;
          const depart = l.semaine_annoncee_pilote
            ? `${l.semaine_annoncee_pilote.replace(/^\d{4}-/, "")} · dès le ${fmtCourte(l.arrivage_calcule)}`
            : l.date_depart_pilote ? fmtCourte(l.date_depart_pilote) : "—";
          return (
            <div key={l.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-white/5 bg-[#1f2125] px-4 py-3 text-sm">
              <span className="min-w-[110px] font-semibold text-zinc-100">{l.marque}</span>
              <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${etape.cls}`}>{etape.label}</span>
              <span className="text-zinc-400">Départ : <span className="text-zinc-200" title={l.regle_transit || ""}>{depart}</span></span>
              <span className="text-zinc-400">Arrivage :{" "}
                {l.preuve_depart
                  ? <span className="text-emerald-300" title={`Parti le ${fmtCourte(l.date_expedition_reelle)} (${l.preuve_depart})`}>{fmtCourte(l.arrivage_estime_reel)} <span className="text-xs text-emerald-400/70">réel</span></span>
                  : <span className="text-zinc-200" title={l.regle_transit || ""}>{l.arrivage_calcule ? fmtCourte(l.arrivage_calcule) : "—"}</span>}
              </span>
              {l.nb_lignes ? <span className="text-zinc-400">Reçu : <span className={Number(l.nb_lignes_couvertes) >= Number(l.nb_lignes) ? "text-emerald-300" : l.reception_partielle ? "text-lime-300" : "text-zinc-300"}>{l.nb_lignes_couvertes}/{l.nb_lignes}</span></span> : null}
              {l.delai_annonce_client && <span className="text-zinc-500 text-xs">promis client : {fmtCourte(l.delai_annonce_client)}</span>}
              {l.alarme_retard && <span className="inline-flex items-center rounded-full bg-rose-500/20 px-2.5 py-1 text-xs font-semibold text-rose-300">⚠️ {l.jours_retard} j de retard</span>}
              {!l.alarme_retard && l.alarme_echeance_proche && <span className="inline-flex items-center rounded-full bg-amber-500/15 px-2.5 py-1 text-xs text-amber-300">🔔 dans {l.jours_avant_echeance} j</span>}
              {!l.alarme_retard && !l.alarme_echeance_proche && l.alarme_delai_manquant && <span className="inline-flex items-center rounded-full bg-amber-500/15 px-2.5 py-1 text-xs text-amber-300">❓ délai manquant</span>}
              {l.nb_reports > 0 && <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-xs text-rose-300">{l.nb_reports} report{l.nb_reports > 1 ? "s" : ""}</span>}
              {l.nb_a_valider > 0 && <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-xs text-sky-300">{l.nb_a_valider} à valider</span>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
