// app/dashboard/jardi/utilisateur.tsx
// ─────────────────────────────────────────────────────────────────────────────
// « Qui parle à Jardi ? » (27.08.2026).
//
// - `lireUtilisateur()` : prénom mémorisé sur CET appareil (localStorage), avec
//   repli sur l'ancien champ libre « corrections-author » normalisé.
// - `ChoixUtilisateur` : écran de présentation, un clic par prénom. Bloquant à
//   la première visite : sans lui, la conversation part sans auteur et ne se
//   retrouve plus (49 conversations orphelines avant la refonte).
// - `SelecteurUtilisateur` : la puce de l'en-tête, pour changer de personne
//   sur le poste partagé du magasin.
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { useEffect, useRef, useState } from "react";
import {
  CLE_UTILISATEUR,
  EQUIPE_JARDI,
  normaliserMembre,
  type MembreEquipe,
} from "@/lib/jardi-equipe";
import { Avatar, COULEURS_EQUIPE } from "./historique";

export function lireUtilisateur(): MembreEquipe | null {
  if (typeof window === "undefined") return null;
  try {
    return (
      normaliserMembre(localStorage.getItem(CLE_UTILISATEUR)) ??
      normaliserMembre(localStorage.getItem("corrections-author"))
    );
  } catch {
    return null;
  }
}

export function ecrireUtilisateur(nom: MembreEquipe) {
  try {
    localStorage.setItem(CLE_UTILISATEUR, nom);
  } catch {
    /* stockage indisponible — la session courante garde la valeur en state */
  }
}

export function ChoixUtilisateur({ onChoix }: { onChoix: (m: MembreEquipe) => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        background: "rgba(31,33,37,0.92)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 460,
          background: "#2a2d31",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 16,
          padding: "22px 22px 18px",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        }}
      >
        <div style={{ fontSize: 20, fontWeight: 800, color: "#f4f4f5" }}>💬 Jardi</div>
        <div style={{ fontSize: 14, color: "#a1a1aa", marginTop: 6, lineHeight: 1.5 }}>
          Qui es-tu ? Tes conversations seront classées à ton nom, et tu les
          retrouveras sur ton téléphone comme au bureau.
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))",
            gap: 8,
            marginTop: 16,
          }}
        >
          {EQUIPE_JARDI.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onChoix(m)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "12px 12px",
                fontSize: 15,
                fontWeight: 600,
                color: "#f4f4f5",
                background: "#1f2125",
                border: `1px solid ${COULEURS_EQUIPE[m]}66`,
                borderRadius: 12,
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <Avatar nom={m} taille={28} />
              {m}
            </button>
          ))}
        </div>
        <div style={{ fontSize: 12, color: "#71717a", marginTop: 14 }}>
          Mémorisé sur cet appareil — modifiable à tout moment en haut de la page.
        </div>
      </div>
    </div>
  );
}

export function SelecteurUtilisateur({
  utilisateur,
  onChoix,
}: {
  utilisateur: MembreEquipe | null;
  onChoix: (m: MembreEquipe) => void;
}) {
  const [ouvert, setOuvert] = useState(false);
  const boiteRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ouvert) return;
    const fermer = (e: MouseEvent) => {
      if (boiteRef.current && !boiteRef.current.contains(e.target as Node)) setOuvert(false);
    };
    const clavier = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOuvert(false);
    };
    document.addEventListener("mousedown", fermer);
    document.addEventListener("keydown", clavier);
    return () => {
      document.removeEventListener("mousedown", fermer);
      document.removeEventListener("keydown", clavier);
    };
  }, [ouvert]);

  return (
    <div ref={boiteRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOuvert((o) => !o)}
        title="Changer d'utilisateur"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          padding: "4px 10px 4px 5px",
          fontSize: 13,
          fontWeight: 600,
          color: "#e4e4e7",
          background: "#2a2d31",
          border: "1px solid rgba(255,255,255,0.14)",
          borderRadius: 999,
          cursor: "pointer",
        }}
      >
        <Avatar nom={utilisateur} taille={22} />
        {utilisateur ?? "Qui es-tu ?"}
        <span style={{ fontSize: 10, color: "#a1a1aa" }}>▼</span>
      </button>
      {ouvert && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 6px)",
            zIndex: 30,
            minWidth: 170,
            background: "#2a2d31",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 12,
            padding: 6,
            boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
          }}
        >
          {EQUIPE_JARDI.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                onChoix(m);
                setOuvert(false);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                width: "100%",
                padding: "7px 9px",
                fontSize: 13,
                fontWeight: m === utilisateur ? 700 : 500,
                color: "#e4e4e7",
                background: m === utilisateur ? "rgba(255,255,255,0.08)" : "transparent",
                border: "none",
                borderRadius: 8,
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <Avatar nom={m} taille={20} />
              {m}
              {m === utilisateur && <span style={{ marginLeft: "auto", color: "#4ade80" }}>✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
