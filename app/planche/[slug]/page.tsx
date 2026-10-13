"use client";
// app/planche/[slug]/page.tsx
// Page PUBLIQUE « Vos couleurs et matières » d'un document (offre ou commande)
// — chantier moodboard, 13.10.2026.
//
// La planche seule, interactive (survol croisé pastilles ↔ palette), sans
// prix, sans nom ni adresse de client : seulement le numéro du document, déjà
// présent dans le lien. Réutilisable plus tard comme lien à envoyer (mail,
// commande…). Publique dans proxy.ts, comme /planner/partage/.
//
// Données : /api/offres/[slug]/matieres (publique, lecture seule).

import React, { useEffect, useState } from "react";
import MoodboardPlanche from "@/components/MoodboardPlanche";
import { lireReglagesMoodboard, type MatiereMoodboard, type ModeMoodboard, type SensMoodboard } from "@/lib/moodboard";

const THEME = "#2b8ad1";

type Reponse = {
  matieres: MatiereMoodboard[];
  couverture: { articles: number; representes: number };
  numero?: string | null;
  reglages?: { affichage?: string; actif: boolean; mode: ModeMoodboard; sens: SensMoodboard };
  error?: string;
};

export default function PlanchePublique({ params }: { params: Promise<{ slug: string }> }) {
  const [rep, setRep] = useState<Reponse | null>(null);
  const [introuvable, setIntrouvable] = useState(false);

  useEffect(() => {
    (async () => {
      const { slug } = await params;
      try {
        const res = await fetch(`/api/offres/${encodeURIComponent(slug)}/matieres`);
        if (res.status === 404) { setIntrouvable(true); return; }
        setRep((await res.json()) as Reponse);
      } catch {
        setRep({ matieres: [], couverture: { articles: 0, representes: 0 } });
      }
    })();
  }, [params]);

  return (
    <div style={{ minHeight: "100vh", background: "#f4f4f2", padding: "24px 12px", fontFamily: "'Raleway', 'Helvetica Neue', Arial, sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=Raleway:wght@400;700&display=swap" rel="stylesheet" />
      <div style={{ maxWidth: 880, margin: "0 auto", background: "#fff", padding: "24px 28px", boxShadow: "0 0 20px rgba(0,0,0,0.06)", color: "#333" }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 16, borderBottom: `2px solid ${THEME}`, paddingBottom: 12, marginBottom: 18 }}>
          <img
            style={{ maxWidth: 130, maxHeight: 50, objectFit: "contain" }}
            src="https://cdn.shopify.com/s/files/1/0360/3251/2135/files/logo_JARDIN_CONFORT_shopify.jpg?v=1614107698"
            alt="Jardin-Confort"
          />
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, color: THEME }}>
              Vos couleurs et matières{rep?.numero ? ` — ${rep.numero}` : ""}
            </div>
            <div style={{ fontSize: 12, color: "#999", marginTop: 2 }}>
              Survolez une pastille ou une couleur pour voir la matière en détail.
            </div>
          </div>
        </div>

        {introuvable ? (
          <p style={{ color: "#888", textAlign: "center", padding: 40 }}>Cette planche est introuvable.</p>
        ) : !rep ? (
          <p style={{ color: "#888", textAlign: "center", padding: 40 }}>Chargement…</p>
        ) : rep.matieres.length === 0 ? (
          <p style={{ color: "#888", textAlign: "center", padding: 40 }}>Aucune finition à présenter pour ce document.</p>
        ) : (
          <MoodboardPlanche
            matieres={rep.matieres}
            couverture={rep.couverture}
            mode={rep.reglages?.mode ?? "poids"}
            sens={rep.reglages?.sens ?? "clair-fonce"}
            decor={lireReglagesMoodboard(rep.reglages).affichage === "planche-decor"}
            interactif
          />
        )}

        <div style={{ textAlign: "center", fontSize: 11, color: "#999", marginTop: 18 }}>
          Jardin-Confort SA · Route de Lavaux 425 · 1095 Lutry ·{" "}
          <a href="https://www.jardin-confort.ch" style={{ color: THEME }}>jardin-confort.ch</a>
        </div>
      </div>
    </div>
  );
}
