// app/dashboard/jardi/usage.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Panneau 📊 « Utilisation » du chat Jardi (27.08.2026).
//
// Lit /api/claude/usage?jours=N (table `jardi_usage`, alimentée par les routes
// chat et ThunderAI depuis le 27.08.2026) : requêtes, tokens, appels d'outils,
// coût ESTIMÉ — par jour, par personne, par source. Zéro dépendance : les
// barres sont des <div>.
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { useEffect, useState } from "react";
import { Avatar, couleurMembre } from "./historique";

type Totaux = {
  requetes: number;
  entree: number;
  sortie: number;
  cache_lecture: number;
  cache_creation: number;
  outils?: number;
  duree_moy_ms?: number;
  cout_usd: number;
};

type Usage = {
  periode_jours: number;
  depuis: string | null;
  tarifs: { entree: number; sortie: number };
  total: Totaux;
  aujourdhui: Totaux;
  par_auteur: (Totaux & { auteur: string | null })[];
  par_jour: (Totaux & { jour: string })[];
  par_source: (Totaux & { source: string })[];
};

const PERIODES = [7, 30, 90] as const;

function fmtN(n: number): string {
  return new Intl.NumberFormat("fr-CH").format(Math.round(n));
}

// 12 345 → « 12,3 k », 1 234 567 → « 1,23 M »
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toLocaleString("fr-CH", { maximumFractionDigits: 2 }) + " M";
  if (n >= 10_000) return (n / 1000).toLocaleString("fr-CH", { maximumFractionDigits: 1 }) + " k";
  return fmtN(n);
}

function fmtUsd(n: number): string {
  return n.toLocaleString("fr-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " $";
}

// Total des tokens lus par le modèle (entrée + cache) + écrits.
function tokensTotal(t: Totaux): number {
  return t.entree + t.cache_lecture + t.cache_creation + t.sortie;
}

function Tuile({ titre, valeur, detail }: { titre: string; valeur: string; detail?: string }) {
  return (
    <div
      style={{
        flex: "1 1 140px",
        background: "#1f2125",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 10,
        padding: "10px 12px",
      }}
    >
      <div style={{ fontSize: 11, color: "#a1a1aa", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {titre}
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color: "#f4f4f5", marginTop: 2 }}>{valeur}</div>
      {detail && <div style={{ fontSize: 11, color: "#71717a", marginTop: 2 }}>{detail}</div>}
    </div>
  );
}

function Titre({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 12,
        fontWeight: 700,
        color: "#e4e4e7",
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        margin: "18px 0 8px",
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      <span style={{ width: 3, height: 12, borderRadius: 2, background: "#2B8AD1" }} />
      {children}
    </div>
  );
}

export function PanneauUsage({ onFermer }: { onFermer: () => void }) {
  const [jours, setJours] = useState<(typeof PERIODES)[number]>(30);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    let annule = false;
    setUsage(null);
    setErreur(null);
    fetch(`/api/claude/usage?jours=${jours}`)
      .then((r) => {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json() as Promise<Usage>;
      })
      .then((u) => {
        if (!annule) setUsage(u);
      })
      .catch(() => {
        if (!annule) setErreur("Statistiques indisponibles pour l'instant.");
      });
    return () => {
      annule = true;
    };
  }, [jours]);

  useEffect(() => {
    const clavier = (e: KeyboardEvent) => {
      if (e.key === "Escape") onFermer();
    };
    document.addEventListener("keydown", clavier);
    return () => document.removeEventListener("keydown", clavier);
  }, [onFermer]);

  const maxJour = Math.max(1, ...(usage?.par_jour ?? []).map((j) => tokensTotal(j)));
  const maxAuteur = Math.max(1, ...(usage?.par_auteur ?? []).map((a) => a.requetes));

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onFermer}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 45,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "24px 12px",
        overflowY: "auto",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 820,
          background: "#2a2d31",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 16,
          padding: "18px 20px 16px",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
          color: "#e4e4e7",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#f4f4f5" }}>📊 Utilisation de Jardi</div>
          <div style={{ display: "flex", gap: 4, marginLeft: "auto" }}>
            {PERIODES.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setJours(p)}
                style={{
                  padding: "4px 10px",
                  fontSize: 12,
                  fontWeight: 600,
                  borderRadius: 999,
                  border: "1px solid rgba(255,255,255,0.14)",
                  background: jours === p ? "rgba(255,255,255,0.14)" : "transparent",
                  color: jours === p ? "#f4f4f5" : "#a1a1aa",
                  cursor: "pointer",
                }}
              >
                {p} j
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onFermer}
            title="Fermer"
            style={{
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.14)",
              borderRadius: 8,
              color: "#a1a1aa",
              cursor: "pointer",
              padding: "3px 9px",
              fontSize: 14,
            }}
          >
            ✕
          </button>
        </div>

        {erreur && <p style={{ color: "#fda4af", fontSize: 13, marginTop: 14 }}>{erreur}</p>}
        {!usage && !erreur && <p style={{ color: "#a1a1aa", fontSize: 13, marginTop: 14 }}>Chargement…</p>}

        {usage && (
          <>
            <Titre>Aujourd&apos;hui</Titre>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <Tuile titre="Requêtes" valeur={fmtN(usage.aujourdhui.requetes)} />
              <Tuile
                titre="Tokens"
                valeur={fmtTokens(tokensTotal(usage.aujourdhui))}
                detail={`${fmtTokens(usage.aujourdhui.sortie)} écrits`}
              />
              <Tuile titre="Outils appelés" valeur={fmtN(usage.aujourdhui.outils ?? 0)} />
              <Tuile titre="Coût estimé" valeur={fmtUsd(usage.aujourdhui.cout_usd)} />
            </div>

            <Titre>{usage.periode_jours} derniers jours</Titre>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <Tuile
                titre="Requêtes"
                valeur={fmtN(usage.total.requetes)}
                detail={
                  usage.total.duree_moy_ms
                    ? `${(usage.total.duree_moy_ms / 1000).toLocaleString("fr-CH", { maximumFractionDigits: 1 })} s en moyenne`
                    : undefined
                }
              />
              <Tuile
                titre="Tokens"
                valeur={fmtTokens(tokensTotal(usage.total))}
                detail={`${fmtTokens(usage.total.entree + usage.total.cache_lecture + usage.total.cache_creation)} lus · ${fmtTokens(usage.total.sortie)} écrits`}
              />
              <Tuile
                titre="Cache"
                valeur={
                  tokensTotal(usage.total) > 0
                    ? Math.round(
                        (usage.total.cache_lecture /
                          Math.max(1, usage.total.entree + usage.total.cache_lecture + usage.total.cache_creation)) *
                          100
                      ) + " %"
                    : "—"
                }
                detail="des tokens lus servis depuis le cache"
              />
              <Tuile
                titre="Coût estimé"
                valeur={fmtUsd(usage.total.cout_usd)}
                detail={
                  usage.total.requetes
                    ? `${(usage.total.cout_usd / usage.total.requetes).toLocaleString("fr-CH", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} $ / requête`
                    : undefined
                }
              />
            </div>

            {usage.par_jour.length > 0 && (
              <>
                <Titre>Par jour</Titre>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 90, padding: "0 2px" }}>
                  {usage.par_jour.map((j) => {
                    const h = Math.max(3, Math.round((tokensTotal(j) / maxJour) * 80));
                    const d = new Date(j.jour + "T12:00:00");
                    return (
                      <div
                        key={j.jour}
                        title={`${d.toLocaleDateString("fr-CH", { weekday: "short", day: "2-digit", month: "2-digit" })} · ${fmtN(j.requetes)} requêtes · ${fmtTokens(tokensTotal(j))} tokens · ${fmtUsd(j.cout_usd)}`}
                        style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, minWidth: 6 }}
                      >
                        <div style={{ width: "100%", height: h, borderRadius: 3, background: "#2B8AD1", opacity: 0.9 }} />
                        {usage.par_jour.length <= 31 && (
                          <div style={{ fontSize: 9, color: "#71717a" }}>{d.getDate()}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {usage.par_auteur.length > 0 && (
              <>
                <Titre>Par personne</Titre>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {usage.par_auteur.map((a) => (
                    <div key={a.auteur ?? "—"} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, width: 120, flexShrink: 0 }}>
                        {a.auteur ? <Avatar nom={a.auteur} taille={18} /> : <span style={{ color: "#D97757" }}>✉️</span>}
                        <span style={{ color: a.auteur ? couleurMembre(a.auteur) : "#a1a1aa", fontWeight: 600 }}>
                          {a.auteur ?? "ThunderAI"}
                        </span>
                      </div>
                      <div style={{ flex: 1, height: 10, background: "rgba(255,255,255,0.06)", borderRadius: 5, overflow: "hidden" }}>
                        <div
                          style={{
                            width: `${Math.round((a.requetes / maxAuteur) * 100)}%`,
                            height: "100%",
                            background: a.auteur ? couleurMembre(a.auteur) : "#D97757",
                            borderRadius: 5,
                          }}
                        />
                      </div>
                      <div style={{ width: 210, textAlign: "right", color: "#a1a1aa", fontSize: 12, flexShrink: 0 }}>
                        {fmtN(a.requetes)} req. · {fmtTokens(tokensTotal(a))} · {fmtUsd(a.cout_usd)}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {usage.par_source.length > 1 && (
              <>
                <Titre>Par source</Titre>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {usage.par_source.map((s) => (
                    <Tuile
                      key={s.source}
                      titre={s.source === "thunderai" ? "✉️ ThunderAI (Thunderbird)" : "💬 Chat du dashboard"}
                      valeur={`${fmtN(s.requetes)} req.`}
                      detail={`${fmtTokens(tokensTotal(s))} tokens · ${fmtUsd(s.cout_usd)}`}
                    />
                  ))}
                </div>
              </>
            )}

            <p style={{ fontSize: 11, color: "#71717a", marginTop: 16, lineHeight: 1.5 }}>
              Coût estimé sur la base de {usage.tarifs.entree} $ / M tokens lus et {usage.tarifs.sortie} $ / M
              tokens écrits (lecture de cache à 10 %, écriture de cache à 125 %) — réglable par les variables
              <code> CLAUDE_PRIX_ENTREE</code> / <code>CLAUDE_PRIX_SORTIE</code>. La facture qui fait foi est
              celle de la console Anthropic.
              {usage.depuis
                ? ` Comptage depuis le ${new Date(usage.depuis).toLocaleDateString("fr-CH")}.`
                : " Aucune requête comptée pour l'instant (le comptage commence au déploiement du 27.08.2026)."}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
