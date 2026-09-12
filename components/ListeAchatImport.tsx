"use client";
// components/ListeAchatImport.tsx
// Onglet « Liste d'achat » du formulaire de brouillon (/drafts/nouveau et
// édition) : choisir une liste ou un modèle enregistré, et AJOUTER ses lignes à
// la suite de celles déjà présentes — sans toucher au client ni au reste du
// document. Les prix sont relus chez Shopify par l'API au moment de l'ajout.

import React, { useEffect, useState } from "react";
import type { QuoteLine } from "@/lib/jc-print-types";
import type { ListeAchat } from "@/lib/listes-achat";

type Props = { onAjouter: (lines: QuoteLine[]) => void };

export default function ListeAchatImport({ onAjouter }: Props) {
  const [listes, setListes] = useState<ListeAchat[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filtre, setFiltre] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch("/api/listes-achat?statut=ouverte")
      .then((r) => r.json())
      .then((j) => setListes(j.listes || []))
      .catch(() => setMessage("Listes d'achat indisponibles."))
      .finally(() => setLoading(false));
  }, []);

  async function ajouter(l: ListeAchat) {
    setBusyId(l.id); setMessage("");
    try {
      const res = await fetch(`/api/listes-achat/${l.id}/lignes`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Erreur ${res.status}`);
      const lines = (json.lines || []) as QuoteLine[];
      onAjouter(lines);
      setMessage(`${lines.length} ligne(s) de « ${l.nom } » ajoutée(s)${json.nbCustom > 0 ? ` — ${json.nbCustom} article(s) libre(s) à compléter` : ""}.`);
    } catch (e) {
      setMessage(String(e));
    } finally { setBusyId(null); }
  }

  const f = filtre.trim().toLowerCase();
  const visibles = listes.filter((l) => !f || l.nom.toLowerCase().includes(f) || (l.cree_par || "").toLowerCase().includes(f));

  return (
    <div className="mt12">
      <div className="jc-field">
        <label>Liste ou modèle enregistré</label>
        <input value={filtre} onChange={(e) => setFiltre(e.target.value)} placeholder="Filtrer par nom ou par vendeur…" />
      </div>
      {message && <div style={{ fontSize: 12, marginTop: 6, opacity: 0.85 }}>{message}</div>}
      {loading ? (
        <div style={{ fontSize: 13, opacity: 0.7, marginTop: 8 }}>Chargement…</div>
      ) : visibles.length === 0 ? (
        <div style={{ fontSize: 13, opacity: 0.7, marginTop: 8 }}>
          Aucune liste. Prépare-les depuis la <a href="/dashboard/stock-list" target="_blank" rel="noopener noreferrer">Stock list</a>.
        </div>
      ) : (
        <div style={{ marginTop: 8, maxHeight: 360, overflowY: "auto", display: "grid", gap: 6 }}>
          {visibles.map((l) => (
            <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{l.est_modele ? "⭐ " : ""}{l.nom}</div>
                <div style={{ fontSize: 11, opacity: 0.65 }}>
                  {l.cree_par || "?"} · {l.lignes.length} réf. · {l.nb_articles} pièce{l.nb_articles > 1 ? "s" : ""}
                  {" · "}{l.lignes.slice(0, 3).map((x) => x.titre || x.sku).join(", ")}{l.lignes.length > 3 ? "…" : ""}
                </div>
              </div>
              <button type="button" className="jc-btn jc-btn-primary" disabled={busyId === l.id} onClick={() => ajouter(l)}>
                {busyId === l.id ? "…" : "+ Ajouter à l'offre"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
