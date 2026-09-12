"use client";
// app/dashboard/listes-achat/page.tsx
// Listes d'achat (12.09.2026) — paniers préparés depuis la page Stock list :
// listes ouvertes, modèles réutilisables (combos socle + poids + tube +
// parasol…), listes transformées en brouillon, archivées.
//
// Depuis ici : ouvrir une liste dans Stock list (pour la compléter), créer le
// brouillon directement, marquer / démarquer modèle, archiver, réouvrir.

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { EQUIPE_JARDI, CLE_UTILISATEUR, normaliserMembre } from "@/lib/jardi-equipe";
import type { ListeAchat, LigneListe } from "@/lib/listes-achat";
import ListeAchatLignes from "@/components/ListeAchatLignes";
import RetourDashboard from "@/components/RetourDashboard";

type Onglet = "ouverte" | "modeles" | "transformee" | "archivee";

function fmtDateHeure(iso: string) {
  return new Date(iso).toLocaleString("fr-CH", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function ListesAchatPage() {
  const [onglet, setOnglet] = useState<Onglet>("ouverte");
  const [listes, setListes] = useState<ListeAchat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [utilisateur, setUtilisateur] = useState("");
  const [ouverte, setOuverte] = useState<string | null>(null); // détail déplié
  const [edition, setEdition] = useState<{ id: string; lignes: LigneListe[] } | null>(null); // lignes modifiées, pas encore enregistrées

  useEffect(() => {
    try { const u = normaliserMembre(window.localStorage.getItem(CLE_UTILISATEUR)); if (u) setUtilisateur(u); } catch { /* ignore */ }
  }, []);

  const charger = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/listes-achat?statut=toutes");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Erreur ${res.status}`);
      setListes(json.listes || []);
    } catch (e) { setError(String(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { charger(); }, [charger]);

  const visibles = listes.filter((l) =>
    onglet === "modeles" ? l.est_modele && l.statut !== "archivee"
    : onglet === "ouverte" ? l.statut === "ouverte" && !l.est_modele
    : l.statut === onglet
  );
  const nb = {
    ouverte: listes.filter((l) => l.statut === "ouverte" && !l.est_modele).length,
    modeles: listes.filter((l) => l.est_modele && l.statut !== "archivee").length,
    transformee: listes.filter((l) => l.statut === "transformee").length,
    archivee: listes.filter((l) => l.statut === "archivee").length,
  };

  async function patch(id: string, corps: Record<string, unknown>) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/listes-achat/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Erreur ${res.status}`);
      await charger();
    } catch (e) { alert(String(e)); } finally { setBusyId(null); }
  }

  async function creerBrouillon(l: ListeAchat) {
    if (!utilisateur) { alert("Choisis qui tu es (en haut à droite)."); return; }
    if (l.est_modele && !confirm(`Créer un brouillon à partir du modèle « ${l.nom} » ? Le modèle reste intact.`)) return;
    setBusyId(l.id);
    try {
      const res = await fetch(`/api/listes-achat/${l.id}/brouillon`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cree_par: utilisateur }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Erreur ${res.status}`);
      window.open(json.editUrl, "_blank", "noopener,noreferrer");
      await charger();
    } catch (e) { alert(String(e)); } finally { setBusyId(null); }
  }

  const onglets: [Onglet, string][] = [["ouverte", "Ouvertes"], ["modeles", "⭐ Modèles"], ["transformee", "Transformées"], ["archivee", "Archivées"]];

  return (
    <main className="min-h-screen bg-[#1f2125]">
      <div className="mx-auto max-w-6xl px-4 py-8 text-zinc-100">
        <RetourDashboard />
        <div className="mb-6 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold">🛒 Listes d&apos;achat</h1>
            <p className="mt-1 text-sm text-zinc-400">
              Paniers préparés depuis la <Link href="/dashboard/stock-list" className="text-sky-300 hover:underline">Stock list</Link> — à compléter, à transformer en brouillon, ou à garder comme modèle pour les combos qu&apos;on revend souvent.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select value={utilisateur} onChange={(e) => { setUtilisateur(e.target.value); try { window.localStorage.setItem(CLE_UTILISATEUR, e.target.value); } catch { /* ignore */ } }} className="rounded-lg border border-white/10 bg-[#2a2d31] px-2 py-1.5 text-xs text-zinc-200">
              <option value="">Qui es-tu ?</option>
              {EQUIPE_JARDI.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          {onglets.map(([cle, libelle]) => (
            <button key={cle} type="button" onClick={() => setOnglet(cle)} className={`rounded-full border px-3 py-1 text-sm transition ${onglet === cle ? "border-sky-400 bg-sky-500/20 text-sky-200" : "border-white/10 bg-white/5 text-zinc-400 hover:text-zinc-200"}`}>
              {libelle} <span className="text-xs opacity-60">{nb[cle]}</span>
            </button>
          ))}
        </div>

        {error && <div className="mb-4 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>}

        {loading ? (
          <div className="rounded-2xl border border-white/10 bg-[#2a2d31] p-8 text-center text-zinc-400">Chargement…</div>
        ) : visibles.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-[#2a2d31] p-8 text-center text-zinc-400">
            Aucune liste ici. {onglet === "ouverte" && <>Ajoute des articles depuis la <Link href="/dashboard/stock-list" className="text-sky-300 hover:underline">Stock list</Link>.</>}
          </div>
        ) : (
          <div className="space-y-2">
            {visibles.map((l) => {
              const deplie = ouverte === l.id;
              return (
                <div key={l.id} className="rounded-2xl border border-white/10 bg-[#2a2d31]">
                  <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <button type="button" onClick={() => setOuverte(deplie ? null : l.id)} className="text-left">
                      <div className="font-medium text-zinc-100">{l.est_modele && "⭐ "}{l.nom}</div>
                      <div className="text-xs text-zinc-500">
                        {l.cree_par || "?"} · {l.lignes.length} réf. · {l.nb_articles} pièce{l.nb_articles > 1 ? "s" : ""} · màj {fmtDateHeure(l.updated_at)}
                        {l.draft_numero && <> · brouillon <Link href={`/dashboard/draft/${l.draft_slug}`} className="text-sky-300 hover:underline">{l.draft_numero}</Link></>}
                      </div>
                    </button>
                    <div className="ml-auto flex flex-wrap items-center gap-2 text-xs">
                      {l.statut !== "archivee" && (
                        <Link href={`/dashboard/stock-list?liste=${l.id}`} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-white/10 bg-[#34383d] px-3 py-1.5 text-zinc-200 hover:bg-[#40454b]">
                          {l.est_modele ? "Utiliser dans Stock list" : "Compléter dans Stock list"}
                        </Link>
                      )}
                      {l.statut !== "archivee" && (
                        <button type="button" disabled={busyId === l.id} onClick={() => creerBrouillon(l)} className="rounded-lg border border-emerald-500/40 bg-emerald-500/20 px-3 py-1.5 font-medium text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-50">
                          {busyId === l.id ? "…" : "Créer un brouillon →"}
                        </button>
                      )}
                      {l.statut !== "archivee" && (
                        <button type="button" disabled={busyId === l.id} onClick={() => patch(l.id, { est_modele: !l.est_modele })} className="text-zinc-400 hover:text-zinc-200" title={l.est_modele ? "Ne plus traiter comme modèle" : "Garder comme modèle réutilisable"}>
                          {l.est_modele ? "Retirer des modèles" : "Marquer modèle"}
                        </button>
                      )}
                      {l.statut === "archivee"
                        ? <button type="button" disabled={busyId === l.id} onClick={() => patch(l.id, { statut: "ouverte" })} className="text-zinc-400 hover:text-zinc-200">Réouvrir</button>
                        : <button type="button" disabled={busyId === l.id} onClick={() => { if (confirm(`Archiver « ${l.nom} » ?`)) patch(l.id, { statut: "archivee" }); }} className="text-zinc-500 hover:text-rose-300">Archiver</button>}
                    </div>
                  </div>
                  {deplie && (
                    <div className="border-t border-white/5 px-4 py-3">
                      <ListeAchatLignes
                        lignes={edition?.id === l.id ? edition.lignes : l.lignes}
                        onChange={(lignes) => setEdition({ id: l.id, lignes })}
                        hauteur="max-h-[50vh]"
                      />
                      <div className="mt-2 flex items-center justify-between text-xs">
                        <span className="text-zinc-500">{l.notes || "Réordonne (flèches ou glisser), ajuste les quantités, ajoute un article à la volée — puis enregistre."}</span>
                        {edition?.id === l.id && (
                          <div className="flex gap-2">
                            <button type="button" onClick={() => setEdition(null)} className="text-zinc-400 hover:text-zinc-200">Annuler</button>
                            <button type="button" disabled={busyId === l.id} onClick={async () => { await patch(l.id, { lignes: edition.lignes }); setEdition(null); }} className="rounded-lg border border-sky-500/40 bg-sky-500/20 px-3 py-1.5 font-medium text-sky-200 hover:bg-sky-500/30 disabled:opacity-50">
                              {busyId === l.id ? "…" : "Enregistrer les modifications"}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
