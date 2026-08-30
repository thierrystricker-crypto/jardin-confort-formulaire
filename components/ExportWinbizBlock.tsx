// components/ExportWinbizBlock.tsx
// Section « Export WinBiz » sur la page dashboard d'une COMMANDE.
// Consomme GET/POST /api/offres/[slug]/export-winbiz (chantier Export Winbiz).
//
// Les trois états du bouton (cadrage §7.7) :
//   - jamais exporté            → « Exporter vers WinBiz »
//   - déjà exporté              → « ✓ Exporté le {date} (v{n}) » + Ré-exporter avec confirmation
//   - révisée/corrigée depuis   → bandeau ⚠️ explicite (c'est le cas « mauvaise version »)
// L'attribution client est TOUJOURS affichée avant confirmation : « sera
// attribuée à {code} — {nom} » ou « partira sur le client 999 ({raison}) ».
//
// L'export ne modifie jamais la commande : le POST n'écrit que dans
// winbiz_exports et dépose le fichier sur le Drive (webhook Make).
//
// Monté sur app/dashboard/[slug]/page.tsx, uniquement si
// type_document === "Commande", à côté de RevisionsHistoryBlock.

"use client";

import React, { useCallback, useEffect, useState } from "react";

type Attribution =
  | { type: "code"; code: string; source: string; libelle: string }
  | { type: "repli"; matchType: string; raison: string };

type ExportRow = {
  version: number;
  commande_version: number | null;
  created_at: string;
  statut: string;
  client_code: string | null;
  filename: string;
  run_id: string;
  montant: number;
  erreur: string | null;
};

type EtatExport = {
  numero_commande: string | null;
  exercice: number;
  commande_version: number;
  attribution: Attribution;
  fichier_clients: { exercice: number; importe_le: string } | null;
  avertissements: string[];
  pro_ht: boolean;
  exports: ExportRow[];
  modifiee_depuis_export: { type: string; date: string } | null;
  webhook_configure: boolean;
};

type ResultatPost = {
  run_id: string;
  filename: string;
  version: number;
  commande_version: number;
  statut: string;
  erreur: string | null;
  attribution: string;
  client_code: string;
  montant: number;
  test: boolean;
  warnings: string[];
};

interface Props {
  commandeSlug: string;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("fr-CH", { day: "2-digit", month: "2-digit", year: "numeric" }) +
    " " + d.toLocaleTimeString("fr-CH", { hour: "2-digit", minute: "2-digit" });
}

export default function ExportWinbizBlock({ commandeSlug }: Props) {
  const [etat, setEtat] = useState<EtatExport | null>(null);
  const [erreurEtat, setErreurEtat] = useState<string>("");
  const [confirme, setConfirme] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [resultat, setResultat] = useState<ResultatPost | null>(null);
  const [erreurPost, setErreurPost] = useState<string>("");

  const charger = useCallback(async () => {
    try {
      const r = await fetch(`/api/offres/${commandeSlug}/export-winbiz`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Erreur ${r.status}`);
      setEtat(j as EtatExport);
      setErreurEtat("");
    } catch (err) {
      setErreurEtat(err instanceof Error ? err.message : String(err));
    }
  }, [commandeSlug]);

  useEffect(() => { charger(); }, [charger]);

  async function exporter() {
    setEnvoi(true); setErreurPost(""); setResultat(null);
    try {
      let creePar = "";
      try { creePar = localStorage.getItem("jardi-utilisateur") || localStorage.getItem("corrections-author") || ""; } catch { /* privé */ }
      const r = await fetch(`/api/offres/${commandeSlug}/export-winbiz`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cree_par: creePar }),
      });
      const j = await r.json();
      if (!r.ok && !j.run_id) throw new Error(j.error || `Erreur ${r.status}`);
      setResultat(j as ResultatPost);
      setConfirme(false);
      await charger();
    } catch (err) {
      setErreurPost(err instanceof Error ? err.message : String(err));
    } finally {
      setEnvoi(false);
    }
  }

  if (erreurEtat) {
    return (
      <section className="rounded-2xl border border-white/10 bg-[#2a2d31] p-6">
        <h2 className="text-xl font-semibold">Export WinBiz</h2>
        <div className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">{erreurEtat}</div>
      </section>
    );
  }
  if (!etat) {
    return (
      <section className="rounded-2xl border border-white/10 bg-[#2a2d31] p-6">
        <h2 className="text-xl font-semibold">Export WinBiz</h2>
        <div className="mt-2 text-sm text-zinc-500">Chargement…</div>
      </section>
    );
  }

  const dernier = etat.exports[0];
  const attribue = etat.attribution.type === "code";

  return (
    <section className="rounded-2xl border border-white/10 bg-[#2a2d31] p-6">
      <div className="mb-3 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold">Export WinBiz</h2>
          <p className="mt-1 text-xs text-zinc-500">
            Génère le fichier d&apos;import comptable et le dépose sur le Drive (Exports_Winbiz_App).
            Ne modifie jamais la commande.
          </p>
        </div>
        {etat.pro_ht && (
          <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs text-amber-300">
            Pro HT — import T9 à valider avant production
          </span>
        )}
      </div>

      {/* Bandeau « modifiée depuis le dernier export » — le cas mauvaise version */}
      {etat.modifiee_depuis_export && dernier && (
        <div className="mb-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
          ⚠️ Commande {etat.modifiee_depuis_export.type} le {fmtDate(etat.modifiee_depuis_export.date)},
          APRÈS l&apos;export {dernier.version} — le fichier déposé ne reflète plus le document.
        </div>
      )}

      {/* Attribution prévue — toujours visible avant confirmation */}
      <div className={`mb-3 rounded-xl border p-3 text-sm ${attribue
        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
        : "border-zinc-600 bg-zinc-800/60 text-zinc-300"}`}>
        {attribue
          ? <>Sera {(etat.attribution as { libelle: string }).libelle}</>
          : <>Partira sur le <strong>client 999</strong> — {(etat.attribution as { raison: string }).raison}</>}
        {etat.fichier_clients && (
          <span className="ml-2 text-xs text-zinc-400">
            (fichier clients exercice {etat.fichier_clients.exercice}, chargé le {fmtDate(etat.fichier_clients.importe_le)})
          </span>
        )}
      </div>

      {etat.avertissements.map((a, i) => (
        <div key={i} className="mb-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">{a}</div>
      ))}

      {!etat.webhook_configure && (
        <div className="mb-3 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
          Dépôt Drive non configuré (WINBIZ_DRIVE_WEBHOOK_URL / WINBIZ_DRIVE_API_KEY) — export impossible.
        </div>
      )}

      {/* Le bouton et ses états */}
      <div className="flex flex-wrap items-center gap-3">
        {!confirme ? (
          <button
            onClick={() => setConfirme(true)}
            disabled={!etat.webhook_configure || envoi}
            className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-medium hover:bg-sky-500 disabled:opacity-50"
          >
            {dernier ? `↻ Ré-exporter (export ${dernier.version + 1})` : "Exporter vers WinBiz"}
          </button>
        ) : (
          <>
            <span className="text-sm text-zinc-300">
              Confirmer l&apos;export {dernier ? `${dernier.version + 1}` : ""} de la commande V{etat.commande_version} —{" "}
              {attribue
                ? `client ${(etat.attribution as { code: string }).code}`
                : "client 999"} ?
            </span>
            <button
              onClick={exporter}
              disabled={envoi}
              className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium hover:bg-emerald-500 disabled:opacity-50"
            >
              {envoi ? "Export…" : "✓ Confirmer"}
            </button>
            <button
              onClick={() => setConfirme(false)}
              disabled={envoi}
              className="rounded-xl border border-zinc-600 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-700/50"
            >
              Annuler
            </button>
          </>
        )}
        {dernier && !confirme && (
          <span className="text-sm text-zinc-400">
            ✓ Export {dernier.version} le {fmtDate(dernier.created_at)}
            {dernier.commande_version != null && <> — commande V{dernier.commande_version}</>}
            {dernier.statut !== "depose" && <> — {dernier.statut === "erreur" ? "⚠️ dépôt en erreur" : dernier.statut}</>}
          </span>
        )}
      </div>

      {/* Résultat du POST */}
      {resultat && (
        <div className={`mt-3 rounded-xl border p-3 text-sm ${resultat.statut === "depose"
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
          : "border-rose-500/30 bg-rose-500/10 text-rose-200"}`}>
          {resultat.statut === "depose" ? (
            <>✅ Export {resultat.version} (commande V{resultat.commande_version}) déposé{resultat.test ? " dans le dossier de TEST" : ""} — {resultat.filename} — {resultat.attribution}</>
          ) : (
            <>⚠️ Export {resultat.version} généré mais dépôt en erreur : {resultat.erreur}</>
          )}
          {resultat.warnings.length > 0 && (
            <ul className="mt-2 list-inside list-disc text-xs opacity-80">
              {resultat.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}
        </div>
      )}
      {erreurPost && (
        <div className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">{erreurPost}</div>
      )}

      {/* Historique */}
      {etat.exports.length > 0 && (
        <div className="mt-4 border-t border-white/10 pt-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Exports précédents</div>
          <ul className="space-y-1 text-xs text-zinc-400">
            {etat.exports.map((e) => (
              <li key={e.version}>
                Export {e.version} — {fmtDate(e.created_at)} — {e.statut}
                {" — "}{e.commande_version != null ? `commande V${e.commande_version}` : "commande V?"}
                {e.client_code && <> — client {e.client_code}</>} — CHF {Number(e.montant).toFixed(2)}
                {e.erreur && <span className="text-rose-300"> — {e.erreur}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
