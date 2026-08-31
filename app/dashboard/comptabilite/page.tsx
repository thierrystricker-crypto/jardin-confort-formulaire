"use client";
// app/dashboard/comptabilite/page.tsx
// Page « Comptabilité » — pour la comptable : toutes les commandes exportées
// vers Winbiz, le fichier de chaque export (téléchargement de l'archive
// fidèle, migration 012), et le ré-export avec confirmation sur place.
//
// Garde-fous (identiques à la page commande) :
// - l'attribution client (code Winbiz ou 999) et la version de la commande
//   sont TOUJOURS affichées avant de confirmer un ré-export ;
// - un ré-export passe par la même route POST /api/offres/[slug]/export-winbiz :
//   aucune logique d'export ici, la page ne fait qu'afficher et déclencher ;
// - « Télécharger » renvoie les octets archivés, jamais une régénération.
//
// Point d'entrée unique pour la comptable : lien vers le chargement du
// fichier clients (/dashboard/winbiz-adresses) en haut de page.

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import WinbizAdressesCard from "@/components/WinbizAdressesCard";

type ExportRow = {
  id: number;
  created_at: string;
  commande_slug: string;
  numero_commande: string;
  numero_winbiz: string;
  version: number;
  commande_version: number | null;
  statut: string;
  erreur: string | null;
  client_code: string | null;
  match_type: string;
  match_detail: string | null;
  filename: string;
  run_id: string;
  montant: number;
  pro_ht: boolean;
  exercice_adresses: number | null;
  cree_par: string | null;
  client: string;
  fichier_archive: boolean;
};

type Attribution =
  | { type: "code"; code: string; source: string; libelle: string }
  | { type: "repli"; matchType: string; raison: string };

type EtatExport = {
  numero_commande: string | null;
  exercice: number;
  commande_version: number;
  attribution: Attribution;
  fichier_clients: { exercice: number; importe_le: string } | null;
  avertissements: string[];
  pro_ht: boolean;
  exports: Array<{ version: number; commande_version: number | null; created_at: string }>;
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

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("fr-CH", { day: "2-digit", month: "2-digit", year: "numeric" }) +
    " " + d.toLocaleTimeString("fr-CH", { hour: "2-digit", minute: "2-digit" });
}

function fmtChf(n: number): string {
  return n.toLocaleString("fr-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const LIBELLE_STATUT: Record<string, { texte: string; classe: string }> = {
  depose: { texte: "déposé", classe: "text-emerald-300" },
  genere: { texte: "généré, non déposé", classe: "text-amber-300" },
  erreur: { texte: "dépôt en erreur", classe: "text-rose-300" },
};

export default function ComptabilitePage() {
  const [q, setQ] = useState("");
  const [exports, setExports] = useState<ExportRow[] | null>(null);
  const [erreur, setErreur] = useState("");
  const [chargement, setChargement] = useState(false);
  const [derniersSeulement, setDerniersSeulement] = useState(true);
  const [fichierClientsOuvert, setFichierClientsOuvert] = useState(false);

  // Ré-export en cours : la ligne ciblée, son état (dry-run), le résultat.
  const [cible, setCible] = useState<ExportRow | null>(null);
  const [etatCible, setEtatCible] = useState<EtatExport | null>(null);
  const [erreurCible, setErreurCible] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [resultat, setResultat] = useState<ResultatPost | null>(null);

  const minuterie = useRef<ReturnType<typeof setTimeout> | null>(null);

  const charger = useCallback(async (texte: string) => {
    setChargement(true);
    try {
      const r = await fetch(`/api/winbiz-exports?q=${encodeURIComponent(texte)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Erreur ${r.status}`);
      setExports(j.exports as ExportRow[]);
      setErreur("");
    } catch (err) {
      setErreur(err instanceof Error ? err.message : String(err));
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => { charger(""); }, [charger]);

  // Recherche : petit délai pour ne pas interroger à chaque frappe.
  function surRecherche(texte: string) {
    setQ(texte);
    if (minuterie.current) clearTimeout(minuterie.current);
    minuterie.current = setTimeout(() => charger(texte), 300);
  }

  async function ouvrirReexport(ligne: ExportRow) {
    setCible(ligne); setEtatCible(null); setErreurCible(""); setResultat(null);
    try {
      const r = await fetch(`/api/offres/${ligne.commande_slug}/export-winbiz`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Erreur ${r.status}`);
      setEtatCible(j as EtatExport);
    } catch (err) {
      setErreurCible(err instanceof Error ? err.message : String(err));
    }
  }

  async function confirmerReexport() {
    if (!cible) return;
    setEnvoi(true); setErreurCible("");
    try {
      let creePar = "";
      try { creePar = localStorage.getItem("jardi-utilisateur") || localStorage.getItem("corrections-author") || ""; } catch { /* privé */ }
      const r = await fetch(`/api/offres/${cible.commande_slug}/export-winbiz`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cree_par: creePar }),
      });
      const j = await r.json();
      if (!r.ok && !j.run_id) throw new Error(j.error || `Erreur ${r.status}`);
      setResultat(j as ResultatPost);
      setEtatCible(null);
      await charger(q);
    } catch (err) {
      setErreurCible(err instanceof Error ? err.message : String(err));
    } finally {
      setEnvoi(false);
    }
  }

  function fermerReexport() {
    setCible(null); setEtatCible(null); setErreurCible(""); setResultat(null);
  }

  // Filtre « dernier export par commande » (côté page : la liste est déjà
  // triée du plus récent au plus ancien).
  const lignes = (exports ?? []).filter((l, _i, tous) =>
    !derniersSeulement || !tous.some((a) => a.commande_slug === l.commande_slug && a.version > l.version)
  );
  const nbCommandes = new Set((exports ?? []).map((l) => l.commande_slug)).size;

  const attribue = etatCible?.attribution.type === "code";

  return (
    <main className="min-h-screen bg-[#1f2125]">
      <div className="mx-auto max-w-6xl px-4 py-8 text-zinc-100">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">🧾 Comptabilité — exports Winbiz</h1>
            <p className="mt-1 text-sm text-zinc-400">
              Les commandes exportées vers Winbiz, leur fichier d&apos;import et le ré-export si nécessaire.
              Le fichier téléchargé ici est celui déposé le jour de l&apos;export, à l&apos;octet près.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => setFichierClientsOuvert((v) => !v)}
              className={`inline-flex items-center rounded-2xl border px-4 py-2 text-sm transition ${fichierClientsOuvert
                ? "border-sky-500/50 bg-sky-500/25 text-sky-200"
                : "border-sky-500/30 bg-sky-500/15 text-sky-300 hover:bg-sky-500/25"}`}
              title="Charger la liste d'adresses Winbiz de l'exercice — nécessaire à l'attribution des exports"
            >
              🏦 Fichier clients Winbiz {fichierClientsOuvert ? "▴" : "▾"}
            </button>
            <Link href="/dashboard" className="text-sm text-zinc-400 hover:text-zinc-200">← Dashboard</Link>
          </div>
        </div>

        {/* Chargement du fichier clients — même composant que /dashboard/winbiz-adresses */}
        {fichierClientsOuvert && (
          <div className="mb-6 rounded-2xl border border-sky-500/30 p-4">
            <p className="mb-4 text-sm text-zinc-400">
              Avant une séance d&apos;export : télécharger depuis Winbiz la « liste d&apos;adresses, étiquettes »
              (.xls) et la charger ici. Les codes adresse changent par exercice — un fichier d&apos;un autre
              exercice n&apos;est jamais utilisé.
            </p>
            <WinbizAdressesCard />
          </div>
        )}

        {/* Recherche */}
        <div className="mb-4 rounded-2xl border border-zinc-700 bg-zinc-800/60 p-4">
          <div className="flex flex-wrap items-center gap-4">
            <input
              type="search"
              value={q}
              onChange={(e) => surRecherche(e.target.value)}
              placeholder="Rechercher : n° de commande, nom, prénom, société, code client Winbiz, nom de fichier…"
              className="min-w-[280px] grow rounded-lg border border-zinc-600 bg-zinc-900 px-3 py-2 text-sm"
            />
            <label className="flex items-center gap-2 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={derniersSeulement}
                onChange={(e) => setDerniersSeulement(e.target.checked)}
              />
              Dernier export de chaque commande seulement
            </label>
          </div>
          <div className="mt-2 text-xs text-zinc-500">
            {chargement ? "Recherche…" : exports
              ? `${lignes.length} export${lignes.length > 1 ? "s" : ""} affiché${lignes.length > 1 ? "s" : ""} — ${nbCommandes} commande${nbCommandes > 1 ? "s" : ""}${exports.length >= 200 ? " (200 plus récents ; affine la recherche pour les autres)" : ""}`
              : ""}
          </div>
        </div>

        {erreur && (
          <div className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">{erreur}</div>
        )}

        {/* Panneau de ré-export — attribution et version affichées AVANT confirmation */}
        {cible && (
          <div className="mb-4 rounded-2xl border border-sky-500/40 bg-sky-500/10 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="text-sm">
                <div className="font-semibold">
                  Ré-exporter {cible.numero_commande}{cible.client ? ` — ${cible.client}` : ""}
                </div>
                {!etatCible && !erreurCible && !resultat && <div className="mt-1 text-zinc-400">Vérification de l&apos;attribution…</div>}
                {etatCible && (
                  <div className="mt-2 space-y-1">
                    <div className={attribue ? "text-emerald-200" : "text-zinc-300"}>
                      {attribue
                        ? <>Sera {(etatCible.attribution as { libelle: string }).libelle}</>
                        : <>Partira sur le <strong>client 999</strong> — {(etatCible.attribution as { raison: string }).raison}</>}
                    </div>
                    <div className="text-zinc-300">
                      Export {(etatCible.exports[0]?.version ?? 0) + 1} de la commande <strong>V{etatCible.commande_version}</strong>
                      {etatCible.exports[0] && (
                        <span className="text-zinc-500"> — précédent : export {etatCible.exports[0].version} du {fmtDate(etatCible.exports[0].created_at)}
                          {etatCible.exports[0].commande_version != null && <> (commande V{etatCible.exports[0].commande_version})</>}
                        </span>
                      )}
                    </div>
                    {etatCible.modifiee_depuis_export && (
                      <div className="text-amber-200">
                        ⚠️ Commande {etatCible.modifiee_depuis_export.type} le {fmtDate(etatCible.modifiee_depuis_export.date)}, après le dernier export.
                      </div>
                    )}
                    {etatCible.pro_ht && <div className="text-amber-300">Document Pro HT — import T9 à valider avant production.</div>}
                    {etatCible.avertissements.map((a, i) => <div key={i} className="text-xs text-amber-200">{a}</div>)}
                    {!etatCible.webhook_configure && <div className="text-rose-200">Dépôt Drive non configuré — export impossible.</div>}
                  </div>
                )}
                {erreurCible && <div className="mt-2 text-rose-200">{erreurCible}</div>}
                {resultat && (
                  <div className={`mt-2 ${resultat.statut === "depose" ? "text-emerald-200" : "text-rose-200"}`}>
                    {resultat.statut === "depose"
                      ? <>✅ Export {resultat.version} (commande V{resultat.commande_version}) déposé{resultat.test ? " dans le dossier de TEST" : ""} — {resultat.filename}</>
                      : <>⚠️ Export {resultat.version} généré mais dépôt en erreur : {resultat.erreur}</>}
                    {resultat.warnings.length > 0 && (
                      <ul className="mt-1 list-inside list-disc text-xs opacity-80">
                        {resultat.warnings.map((w, i) => <li key={i}>{w}</li>)}
                      </ul>
                    )}
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                {etatCible && !resultat && (
                  <button
                    onClick={confirmerReexport}
                    disabled={envoi || !etatCible.webhook_configure}
                    className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium hover:bg-emerald-500 disabled:opacity-50"
                  >
                    {envoi ? "Export…" : `✓ Confirmer — ${attribue ? `client ${(etatCible.attribution as { code: string }).code}` : "client 999"}`}
                  </button>
                )}
                <button
                  onClick={fermerReexport}
                  disabled={envoi}
                  className="rounded-xl border border-zinc-600 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-700/50"
                >
                  {resultat ? "Fermer" : "Annuler"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Liste */}
        <div className="overflow-x-auto rounded-2xl border border-zinc-700 bg-zinc-800/60">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-900/60 text-xs uppercase tracking-wide text-zinc-400">
              <tr>
                <th className="px-3 py-2">Export</th>
                <th className="px-3 py-2">Commande</th>
                <th className="px-3 py-2">Client</th>
                <th className="px-3 py-2">Client Winbiz</th>
                <th className="px-3 py-2 text-right">Montant</th>
                <th className="px-3 py-2">Statut</th>
                <th className="px-3 py-2">Fichier</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {exports === null && (
                <tr><td colSpan={8} className="px-3 py-6 text-center text-zinc-500">Chargement…</td></tr>
              )}
              {exports !== null && lignes.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-6 text-center text-zinc-500">
                  {q ? "Aucun export ne correspond." : "Aucune commande exportée pour l'instant."}
                </td></tr>
              )}
              {lignes.map((l) => {
                const st = LIBELLE_STATUT[l.statut] ?? { texte: l.statut, classe: "text-zinc-300" };
                const repli = l.client_code === "999";
                return (
                  <tr key={l.id} className="border-t border-zinc-700/60 align-top hover:bg-zinc-700/20">
                    <td className="whitespace-nowrap px-3 py-2">
                      <div>{fmtDate(l.created_at)}</div>
                      <div className="text-xs text-zinc-500">
                        export {l.version} — commande V{l.commande_version ?? "?"}
                        {l.cree_par && <> — {l.cree_par}</>}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <Link href={`/dashboard/${l.commande_slug}`} className="text-sky-300 hover:underline">{l.numero_commande}</Link>
                      {l.pro_ht && <div className="text-xs text-amber-300">Pro HT</div>}
                    </td>
                    <td className="px-3 py-2">{l.client || <span className="text-zinc-500">—</span>}</td>
                    <td className="px-3 py-2" title={l.match_detail ?? ""}>
                      <span className={repli ? "rounded-md bg-amber-500/20 px-2 py-0.5 text-amber-300" : "text-zinc-200"}>
                        {l.client_code ?? "—"}
                      </span>
                      {repli && <div className="mt-1 text-xs text-amber-300/80">à réassigner dans Winbiz</div>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">CHF {fmtChf(l.montant)}</td>
                    <td className={`px-3 py-2 ${st.classe}`} title={l.erreur ?? ""}>{st.texte}</td>
                    <td className="max-w-[320px] px-3 py-2">
                      <div className="break-all text-xs text-zinc-400">{l.filename}</div>
                      {l.fichier_archive ? (
                        <a
                          href={`/api/winbiz-exports/${l.id}/fichier`}
                          className="mt-1 inline-block rounded-lg border border-zinc-600 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-700/60"
                        >
                          ⬇ Télécharger
                        </a>
                      ) : (
                        <div className="mt-1 text-xs text-zinc-500" title="Export antérieur à l'archivage : fichier sur le Drive uniquement">
                          fichier sur le Drive
                        </div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <button
                        onClick={() => ouvrirReexport(l)}
                        disabled={envoi}
                        className="rounded-lg bg-sky-600/80 px-3 py-1 text-xs font-medium hover:bg-sky-500 disabled:opacity-50"
                      >
                        ↻ Ré-exporter
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="mt-4 text-xs text-zinc-500">
          Un ré-export ne modifie jamais la commande : il crée un nouveau fichier (export N+1) déposé sur le Drive
          et tracé ici. Rappel Winbiz : importer un numéro de document déjà présent ne remplace pas le document
          existant — le supprimer d&apos;abord dans Winbiz.
        </p>
      </div>
    </main>
  );
}
