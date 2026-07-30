// app/acces/page.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Verrou d'accès provisoire (couche 1) — page de saisie du code partagé.
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
        background: "#f4f4f5",
        fontFamily: "system-ui, -apple-system, sans-serif",
        padding: 16,
      }}
    >
      <form
        onSubmit={soumettre}
        style={{
          background: "white",
          padding: 32,
          borderRadius: 12,
          boxShadow: "0 2px 16px rgba(0,0,0,0.08)",
          width: "100%",
          maxWidth: 360,
        }}
      >
        <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0, marginBottom: 8, color: "#18181b" }}>
          Accès réservé
        </h1>
        <p style={{ fontSize: 14, color: "#71717a", margin: 0, marginBottom: 20 }}>
          Espace interne Jardin Confort. Entrez le code d&apos;accès.
        </p>
        <input
          type="password"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Code d'accès"
          autoFocus
          autoComplete="current-password"
          style={{
            width: "100%",
            padding: "10px 12px",
            fontSize: 15,
            border: "1px solid #d4d4d8",
            borderRadius: 8,
            marginBottom: 12,
            boxSizing: "border-box",
          }}
        />
        {erreur && (
          <p style={{ color: "#dc2626", fontSize: 13, margin: 0, marginBottom: 12 }}>{erreur}</p>
        )}
        <button
          type="submit"
          disabled={enCours || !code}
          style={{
            width: "100%",
            padding: "10px 12px",
            fontSize: 15,
            fontWeight: 600,
            color: "white",
            background: enCours || !code ? "#a1a1aa" : "#2563eb",
            border: "none",
            borderRadius: 8,
            cursor: enCours || !code ? "default" : "pointer",
          }}
        >
          {enCours ? "Vérification…" : "Entrer"}
        </button>
      </form>
    </div>
  );
}
