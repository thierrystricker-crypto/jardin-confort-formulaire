"use client";

// app/dashboard/thunderai/page.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Historique des échanges Jardi via ThunderAI (19.08.2026).
// Filet anti « clic trop rapide » : une réponse perdue dans Thunderbird se
// retrouve ici et se recopie d'un clic. Alimenté par la façade, purge auto
// 60 jours. Thème sombre forcé, zéro dépendance — même esprit que
// /dashboard/jardi.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from "react";

type Echange = {
  id: string;
  cree_le: string;
  question: string;
  reponse: string;
};

const FOND = "#1f2125";
const CARTE = "#2a2d31";
const BORD = "#3a3d42";
const ACCENT = "#2B8AD1";
const ORANGE = "#D97757";

function dateSuisse(iso: string): string {
  try {
    return new Intl.DateTimeFormat("fr-CH", {
      timeZone: "Europe/Zurich",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export default function PageHistoriqueThunderai() {
  const [echanges, setEchanges] = useState<Echange[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [filtre, setFiltre] = useState("");
  const [recherche, setRecherche] = useState("");
  const [copieId, setCopieId] = useState<string | null>(null);
  const [ouvertId, setOuvertId] = useState<string | null>(null);

  useEffect(() => {
    let annule = false;
    setEchanges(null);
    setErreur(null);
    const url =
      "/api/claude/thunderai-historique" +
      (recherche ? "?q=" + encodeURIComponent(recherche) : "");
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then((d) => {
        if (!annule) setEchanges(d.echanges ?? []);
      })
      .catch(() => {
        if (!annule) setErreur("Impossible de charger l'historique. Recharge la page.");
      });
    return () => {
      annule = true;
    };
  }, [recherche]);

  async function copier(e: Echange) {
    try {
      await navigator.clipboard.writeText(e.reponse);
      setCopieId(e.id);
      setTimeout(() => setCopieId(null), 1500);
    } catch {
      setErreur("Copie impossible dans ce navigateur.");
    }
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        background: FOND,
        color: "#e6e6e6",
        padding: "24px 16px 60px",
        fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
      }}
    >
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <h1 style={{ fontSize: 22, margin: "0 0 4px" }}>
          Historique ThunderAI <span style={{ color: ORANGE }}>· Jardi</span>
        </h1>
        <p style={{ color: "#9aa0a6", fontSize: 13, margin: "0 0 20px" }}>
          Les 100 derniers échanges passés par ThunderAI dans Thunderbird.
          Réponse fermée trop vite ? Elle est ici — bouton copier, puis colle-la
          dans ton mail. Conservation : 60 jours.
        </p>

        <form
          onSubmit={(ev) => {
            ev.preventDefault();
            setRecherche(filtre.trim());
          }}
          style={{ display: "flex", gap: 8, marginBottom: 20 }}
        >
          <input
            value={filtre}
            onChange={(ev) => setFiltre(ev.target.value)}
            placeholder="Filtrer (client, sujet, mot de la réponse…)"
            style={{
              flex: 1,
              background: CARTE,
              border: `1px solid ${BORD}`,
              borderRadius: 8,
              color: "#e6e6e6",
              padding: "10px 12px",
              fontSize: 14,
              outline: "none",
            }}
          />
          <button
            type="submit"
            style={{
              background: ACCENT,
              border: "none",
              borderRadius: 8,
              color: "#fff",
              padding: "10px 18px",
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Chercher
          </button>
          {recherche && (
            <button
              type="button"
              onClick={() => {
                setFiltre("");
                setRecherche("");
              }}
              style={{
                background: "transparent",
                border: `1px solid ${BORD}`,
                borderRadius: 8,
                color: "#9aa0a6",
                padding: "10px 14px",
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              Effacer
            </button>
          )}
        </form>

        {erreur && (
          <p style={{ color: ORANGE, fontSize: 14 }}>{erreur}</p>
        )}
        {echanges === null && !erreur && (
          <p style={{ color: "#9aa0a6", fontSize: 14 }}>Chargement…</p>
        )}
        {echanges !== null && echanges.length === 0 && (
          <p style={{ color: "#9aa0a6", fontSize: 14 }}>
            {recherche ? "Aucun échange ne correspond." : "Aucun échange enregistré pour l'instant."}
          </p>
        )}

        {(echanges ?? []).map((e) => {
          const ouvert = ouvertId === e.id;
          const apercu =
            e.reponse.length > 400 && !ouvert
              ? e.reponse.slice(0, 400) + "…"
              : e.reponse;
          return (
            <div
              key={e.id}
              style={{
                background: CARTE,
                border: `1px solid ${BORD}`,
                borderRadius: 10,
                padding: "14px 16px",
                marginBottom: 14,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  alignItems: "baseline",
                  marginBottom: 8,
                }}
              >
                <span style={{ color: "#9aa0a6", fontSize: 12 }}>
                  {dateSuisse(e.cree_le)}
                </span>
                <button
                  onClick={() => copier(e)}
                  style={{
                    background: copieId === e.id ? "#2f7d4f" : "transparent",
                    border: `1px solid ${copieId === e.id ? "#2f7d4f" : BORD}`,
                    borderRadius: 6,
                    color: copieId === e.id ? "#fff" : "#cfd3d7",
                    padding: "4px 10px",
                    fontSize: 12,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  {copieId === e.id ? "Copié !" : "📋 Copier la réponse"}
                </button>
              </div>
              <div
                style={{
                  color: "#cfd3d7",
                  fontSize: 13,
                  marginBottom: 10,
                  whiteSpace: "pre-wrap",
                  overflowWrap: "anywhere",
                }}
              >
                <span style={{ color: ACCENT, fontWeight: 600 }}>Demande : </span>
                {e.question.length > 260 ? e.question.slice(0, 260) + "…" : e.question}
              </div>
              <div
                style={{
                  fontSize: 14,
                  lineHeight: 1.5,
                  whiteSpace: "pre-wrap",
                  overflowWrap: "anywhere",
                  borderTop: `1px solid ${BORD}`,
                  paddingTop: 10,
                }}
              >
                {apercu}
              </div>
              {e.reponse.length > 400 && (
                <button
                  onClick={() => setOuvertId(ouvert ? null : e.id)}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#7dd3fc",
                    fontSize: 13,
                    cursor: "pointer",
                    padding: "8px 0 0",
                  }}
                >
                  {ouvert ? "Réduire" : "Afficher la réponse complète"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </main>
  );
}
