"use client";
// components/MoodboardReglages.tsx
// Bloc « Planche couleurs et matières » du formulaire de brouillon
// (chantier moodboard, 12.10.2026).
//
// • Case « Ajouter la planche en fin d'offre » — DÉCOCHÉE par défaut.
// • Choix du rendu : par valeur, ou dégradé (clair → foncé / foncé → clair).
// • Aperçu miniature, pour que le commercial décide de cocher ou non selon le
//   rendu (« si c'est joli, il la met »).
// • Ligne d'information INTERNE : finitions trouvées, articles non reliés.
//   Jamais sur un document client.
//
// Les réglages vivent dans data.moodboard du brouillon ; transformer_draft
// recopie data tel quel → ils passent dans l'offre sans autre code.
// L'aperçu ne fait que LIRE (route /api/moodboard/apercu) : rien n'est écrit.

import React, { useEffect, useMemo, useRef, useState } from "react";
import MoodboardPlanche from "@/components/MoodboardPlanche";
import type { ReglagesMoodboard, ResultatMoodboard } from "@/lib/moodboard";

type LigneMin = {
  id?: string;
  type?: string;
  sku?: string;
  title?: string;
  qty?: number;
  unitPrice?: number;
  lineDiscountPerUnit?: number;
  shopifyLocked?: boolean;
  shopifyVariantId?: string;
};

type Props = {
  lines: LigneMin[];
  reglages: ReglagesMoodboard;
  onChange: (r: ReglagesMoodboard) => void;
  lectureSeule?: boolean;
};

// Délai avant de relancer l'aperçu après une modification des articles.
const DELAI_APERCU_MS = 1500;

export default function MoodboardReglages({ lines, reglages, onChange, lectureSeule = false }: Props) {
  const [ouvert, setOuvert] = useState(reglages.actif);
  const [resultat, setResultat] = useState<ResultatMoodboard | null>(null);
  const [chargement, setChargement] = useState(false);
  const requete = useRef(0);

  // Ne relancer l'aperçu que si ce qui compte pour la planche a changé :
  // variantes, quantités et prix (le poids des blocs).
  const signature = useMemo(
    () =>
      JSON.stringify(
        (lines || [])
          .filter((l) => l.type !== "comment" && l.type !== "media")
          .map((l) => [l.shopifyVariantId || l.sku || "", l.qty, l.unitPrice, l.lineDiscountPerUnit])
      ),
    [lines]
  );

  useEffect(() => {
    if (!ouvert) return;
    const n = ++requete.current;
    const t = setTimeout(async () => {
      setChargement(true);
      try {
        const res = await fetch("/api/moodboard/apercu", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lines }),
        });
        const json = (await res.json()) as ResultatMoodboard;
        if (n === requete.current) setResultat(json);
      } catch {
        if (n === requete.current) setResultat(null);
      } finally {
        if (n === requete.current) setChargement(false);
      }
    }, resultat ? DELAI_APERCU_MS : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ouvert, signature]);

  const maj = (p: Partial<ReglagesMoodboard>) => onChange({ ...reglages, ...p });

  const nb = resultat?.matieres.length ?? 0;
  const cv = resultat?.couverture;

  return (
    <section className="jc-card screenOnly">
      <div className="jc-section-title-row">
        <div className="jc-section-title">
          🎨 Planche couleurs et matières{" "}
          <span className="jc-label-hint" style={{ textTransform: "none", letterSpacing: 0 }}>(dernière page de l&apos;offre)</span>
        </div>
        <button type="button" className="jc-btn jc-btn-ghost" onClick={() => setOuvert((o) => !o)}>
          {ouvert ? "Masquer l'aperçu" : "Voir l'aperçu"}
        </button>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16, marginBottom: 10 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, cursor: lectureSeule ? "default" : "pointer" }}>
          <input
            type="checkbox"
            checked={reglages.actif}
            disabled={lectureSeule}
            onChange={(e) => {
              maj({ actif: e.target.checked });
              if (e.target.checked) setOuvert(true);
            }}
          />
          Ajouter la planche en fin d&apos;offre
        </label>

        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          Rendu
          <select
            value={reglages.mode}
            disabled={lectureSeule}
            onChange={(e) => maj({ mode: e.target.value === "degrade" ? "degrade" : "poids" })}
          >
            <option value="poids">Par valeur</option>
            <option value="degrade">Dégradé</option>
          </select>
        </label>

        {reglages.mode === "degrade" && (
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            Sens
            <select
              value={reglages.sens}
              disabled={lectureSeule}
              onChange={(e) => maj({ sens: e.target.value === "fonce-clair" ? "fonce-clair" : "clair-fonce" })}
            >
              <option value="clair-fonce">Clair → foncé</option>
              <option value="fonce-clair">Foncé → clair</option>
            </select>
          </label>
        )}
      </div>

      {ouvert && (
        <div>
          {/* Information interne — jamais sur le document client */}
          <div style={{ fontSize: 12, color: "#666", marginBottom: 8 }}>
            {chargement && !resultat
              ? "Recherche des finitions…"
              : cv
                ? <>
                    {nb} finition{nb > 1 ? "s" : ""} trouvée{nb > 1 ? "s" : ""} · {cv.representes} article{cv.representes > 1 ? "s" : ""} sur {cv.articles} représenté{cv.representes > 1 ? "s" : ""}
                    {chargement ? " · mise à jour…" : ""}
                  </>
                : "Aperçu indisponible."}
          </div>
          {cv && cv.nonRelies.length > 0 && (
            <div style={{ fontSize: 12, color: "#b45309", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 6, padding: "6px 10px", marginBottom: 10 }}>
              Sans finition dans la planche (usage interne) : {cv.nonRelies.join(" · ")}
            </div>
          )}

          {nb > 0 && resultat ? (
            <div style={{ maxWidth: 460, border: "1px solid #e5e7eb", borderRadius: 6, padding: 12, background: "#fff" }}>
              <MoodboardPlanche
                matieres={resultat.matieres}
                couverture={resultat.couverture}
                mode={reglages.mode}
                sens={reglages.sens}
                interactif
                compact
                mention={false}
              />
            </div>
          ) : !chargement && cv ? (
            <div style={{ fontSize: 12, color: "#999", fontStyle: "italic" }}>
              Aucune finition reconnue pour ces articles : la planche ne sera pas ajoutée, même cochée.
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
