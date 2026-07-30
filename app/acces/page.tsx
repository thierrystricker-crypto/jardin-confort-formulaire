// app/acces/page.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Verrou d'accès provisoire (couche 1) — page de saisie du code partagé.
// Thème sombre, assorti au dashboard. Toutes les couleurs sont explicites pour
// ne pas hériter du thème global (évite le texte blanc sur champ blanc).
// Envoie le code à /api/acces ; en cas de succès, redirige vers la page demandée.
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { useState } from "react";

export default function AccesPage() {
  const [code, setCode] = useState("");
  const [erreur, setErreur] = useState("");
  const [enCours, setEnCours] = useState(false);

  async function soumettre(e: React.FormEvent) {
    e.preventDefault();
    setErreur("");
    setEnCours(true);
    try {
      const res = await fetch("/api/acces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (res.ok) {
        const params = new URLSearchParams(window.location.search);
        const next = params.get("next");
        // Rechargement complet pour que le proxy relise le cookie fraîchement posé
        window.location.href = next && next.startsWith("/") ? next : "/dashboard";
      } else {
        setErreur("Code incorrect.");
      }
    } catch {
      setErreur("Erreur réseau, réessayez.");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0a0a0a",
        fontFamily: "system-ui, -apple-system, Arial, sans-serif",
        padding: 16,
      }}
    >
      {/* Couleur du placeholder (impossible en style inline) */}
      <style>{`.acces-input::placeholder { color: #6b7280; }`}</style>

      <form
        onSubmit={soumettre}
        style={{
          background: "#18181b",
          border: "1px solid #27272a",
          padding: 32,
          borderRadius: 14,
          boxShadow: "0 8px 40px rgba(0,0,0,0.5)",
          width: "100%",
          maxWidth: 360,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: 0.5, color: "#4ea3e0", marginBottom: 18, textTransform: "uppercase" }}>
          Jardin Confort
        </div>
        <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0, marginBottom: 8, color: "#fafafa" }}>
          Accès réservé
        </h1>
        <p style={{ fontSize: 14, lineHeight: 1.5, color: "#a1a1aa", margin: 0, marginBottom: 22 }}>
          Espace interne. Entrez le code d&apos;accès de l&apos;équipe.
        </p>
        <input
          className="acces-input"
          type="password"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Code d'accès"
          autoFocus
          autoComplete="current-password"
          style={{
            width: "100%",
            padding: "11px 13px",
            fontSize: 15,
            color: "#fafafa",
            background: "#0f0f11",
            border: "1px solid #3f3f46",
            borderRadius: 9,
            marginBottom: 14,
            boxSizing: "border-box",
            outline: "none",
          }}
        />
        {erreur && (
          <p style={{ color: "#f87171", fontSize: 13, margin: 0, marginBottom: 14 }}>{erreur}</p>
        )}
        <button
          type="submit"
          disabled={enCours || !code}
          style={{
            width: "100%",
            padding: "11px 13px",
            fontSize: 15,
            fontWeight: 600,
            color: "#ffffff",
            background: enCours || !code ? "#3f3f46" : "#2563eb",
            border: "none",
            borderRadius: 9,
            cursor: enCours || !code ? "default" : "pointer",
            transition: "background 0.15s",
          }}
        >
          {enCours ? "Vérification…" : "Entrer"}
        </button>
      </form>
    </div>
  );
}
