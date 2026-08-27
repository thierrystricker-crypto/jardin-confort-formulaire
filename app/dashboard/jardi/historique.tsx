// app/dashboard/jardi/historique.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Barre latérale de l'historique du chat Jardi (27.08.2026).
//
// Sorti de page.tsx (55 Ko). L'historique est devenu un outil central : une
// conversation commencée sur le mobile se reprend au bureau, et il faut la
// RETROUVER — d'où : aperçu riche (question complète + début de réponse +
// nombre d'échanges + outils), classement par utilisateur (puces), recherche
// plein texte côté serveur (tous les mots, sans accents), groupes par date,
// renommage en place.
//
// Composant « bête » : l'état (liste, recherche, filtre) vit dans page.tsx, qui
// sait quand recharger (fin de réponse, suppression…). Zéro dépendance.
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { useEffect, useRef, useState } from "react";
import type React from "react";
import { EQUIPE_JARDI, type MembreEquipe } from "@/lib/jardi-equipe";

export type ConvResume = {
  id: string;
  titre: string;
  auteur: string | null;
  created_at: string;
  updated_at: string;
  nb_messages: number;
  question: string | null;
  reponse: string | null;
  outils: string[] | null;
  extrait: string | null;
  // « jardi » = chat du dashboard ; « thunderai » = échange passé par
  // l'extension ThunderAI dans Thunderbird (même Jardi, autre fenêtre).
  source: SourceConv;
};

export type SourceConv = "jardi" | "thunderai";
export type FiltreSource = "jardi" | "thunderai" | "tous";

// Une couleur par personne : l'œil trie avant de lire.
export const COULEURS_EQUIPE: Record<MembreEquipe, string> = {
  Thierry: "#38bdf8",
  Michel: "#fb923c",
  Brice: "#4ade80",
  Fabian: "#a78bfa",
  Sabrina: "#f472b6",
  Alejandro: "#facc15",
};

export function couleurMembre(nom: string | null): string {
  return (nom && (COULEURS_EQUIPE as Record<string, string>)[nom]) || "#71717a";
}

// ── Aperçus ─────────────────────────────────────────────────────────────────
// Markdown → une ligne de texte lisible : titres, gras, code, liens, tableaux
// et puces nettoyés. Sert aux cartes (2 lignes) — pas à la copie.
export function apercuTexte(md: string | null | undefined, max = 220): string {
  if (!md) return "";
  let t = md;
  t = t.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  t = t.replace(/https?:\/\/\S+/g, "lien");
  t = t.replace(/\|[\s:|-]+\|/g, " "); // lignes séparatrices |---|---|
  t = t.replace(/(^|[\s…])#{1,4}\s+/g, "$1"); // titres, même après aplatissement
  t = t.replace(/\*\*([^*\n]+)\*\*/g, "$1");
  t = t.replace(/`([^`\n]+)`/g, "$1");
  t = t.replace(/(^|\n)\s*[-*•]\s+/g, "$1");
  t = t.replace(/\s*\|\s*/g, " · ");
  t = t.replace(/(\s·\s)+/g, " · ");
  t = t.replace(/\s+/g, " ").trim();
  t = t.replace(/^(…\s*)?(·\s*)+/, "$1").replace(/(\s*·)+\s*(…)?$/, "$2");
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
}

// Met en évidence les mots cherchés dans un aperçu (sans accents ni casse).
function surligner(texte: string, mots: string[]): React.ReactNode {
  const propres = mots.map((m) => m.trim()).filter(Boolean);
  if (!propres.length) return texte;
  const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const n = norm(texte);
  // Positions de chaque occurrence (sur la version normalisée : mêmes offsets
  // que l'original, les diacritiques décomposés ayant été retirés).
  const zones: [number, number][] = [];
  for (const m of propres) {
    const nm = norm(m);
    let i = n.indexOf(nm);
    while (i !== -1 && nm.length) {
      zones.push([i, i + nm.length]);
      i = n.indexOf(nm, i + nm.length);
    }
  }
  if (!zones.length) return texte;
  zones.sort((a, b) => a[0] - b[0]);
  const sortie: React.ReactNode[] = [];
  let curseur = 0;
  zones.forEach(([d, f], k) => {
    if (d < curseur) return;
    if (d > curseur) sortie.push(texte.slice(curseur, d));
    sortie.push(
      <mark key={k} style={{ background: "rgba(250,204,21,0.35)", color: "inherit", borderRadius: 2, padding: "0 1px" }}>
        {texte.slice(d, f)}
      </mark>
    );
    curseur = f;
  });
  if (curseur < texte.length) sortie.push(texte.slice(curseur));
  return sortie;
}

// « aujourd'hui 15:55 », « hier 09:31 », « mar. 25.08 », « 12.03.2025 »
export function fmtDateRelative(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const jour = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const ecartJours = Math.round((jour(now) - jour(d)) / 86_400_000);
  const heure = d.toLocaleTimeString("fr-CH", { hour: "2-digit", minute: "2-digit" });
  if (ecartJours === 0) return `aujourd'hui ${heure}`;
  if (ecartJours === 1) return `hier ${heure}`;
  if (ecartJours < 7) {
    return d.toLocaleDateString("fr-CH", { weekday: "short", day: "2-digit", month: "2-digit" });
  }
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString("fr-CH", { day: "2-digit", month: "2-digit" });
  }
  return d.toLocaleDateString("fr-CH", { day: "2-digit", month: "2-digit", year: "numeric" });
}

type Groupe = { titre: string; items: ConvResume[] };

function grouperParDate(liste: ConvResume[]): Groupe[] {
  const now = new Date();
  const jour = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const aujourdhui = jour(now);
  const groupes: Record<string, ConvResume[]> = {};
  const ordre = ["Aujourd'hui", "Hier", "Cette semaine", "Ce mois", "Plus ancien"];
  for (const c of liste) {
    const d = new Date(c.updated_at);
    const ecart = Math.round((aujourdhui - jour(d)) / 86_400_000);
    let cle = "Plus ancien";
    if (ecart <= 0) cle = "Aujourd'hui";
    else if (ecart === 1) cle = "Hier";
    else if (ecart < 7) cle = "Cette semaine";
    else if (d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()) cle = "Ce mois";
    (groupes[cle] ??= []).push(c);
  }
  return ordre.filter((k) => groupes[k]?.length).map((k) => ({ titre: k, items: groupes[k] }));
}

// ── Avatar ──────────────────────────────────────────────────────────────────
export function Avatar({ nom, taille = 20 }: { nom: string | null; taille?: number }) {
  const couleur = couleurMembre(nom);
  return (
    <span
      title={nom ?? "Auteur inconnu"}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: taille,
        height: taille,
        borderRadius: "50%",
        background: nom ? couleur : "rgba(255,255,255,0.08)",
        color: nom ? "#1f2125" : "#a1a1aa",
        fontSize: Math.round(taille * 0.55),
        fontWeight: 700,
        flexShrink: 0,
        lineHeight: 1,
      }}
    >
      {nom ? nom[0] : "?"}
    </span>
  );
}

// ── Carte d'une conversation ────────────────────────────────────────────────
function Carte({
  c,
  active,
  enRecherche,
  motsRecherche,
  onOuvrir,
  onSupprimer,
  onRenommer,
}: {
  c: ConvResume;
  active: boolean;
  enRecherche: boolean;
  motsRecherche: string[];
  onOuvrir: (id: string, source: SourceConv) => void;
  onSupprimer: (id: string, source: SourceConv) => void;
  onRenommer: (id: string, titre: string) => Promise<void> | void;
}) {
  const thunderai = c.source === "thunderai";
  const [edition, setEdition] = useState(false);
  const [brouillon, setBrouillon] = useState(c.titre);
  const champRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (edition) {
      champRef.current?.focus();
      champRef.current?.select();
    }
  }, [edition]);

  const valider = async () => {
    const t = brouillon.replace(/\s+/g, " ").trim();
    setEdition(false);
    if (t && t !== c.titre) await onRenommer(c.id, t);
    else setBrouillon(c.titre);
  };

  // En recherche : l'extrait autour du mot cherché remplace l'aperçu de la
  // réponse — c'est lui qui dit POURQUOI la conversation sort.
  const sousTexte = enRecherche && c.extrait ? apercuTexte(c.extrait, 260) : apercuTexte(c.reponse);
  const outils = (c.outils ?? []).filter((o) => o !== "analyse");
  const nbEchanges = Math.ceil((c.nb_messages ?? 0) / 2);

  return (
    <div
      className={"jcCarte" + (active ? " jcCarteActive" : "")}
      onClick={() => !edition && onOuvrir(c.id, c.source)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (!edition && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onOuvrir(c.id, c.source);
        }
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {edition ? (
            <input
              ref={champRef}
              value={brouillon}
              onChange={(e) => setBrouillon(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") valider();
                if (e.key === "Escape") {
                  setBrouillon(c.titre);
                  setEdition(false);
                }
              }}
              onBlur={valider}
              maxLength={120}
              style={{
                width: "100%",
                fontSize: 13,
                fontWeight: 600,
                padding: "3px 6px",
                borderRadius: 6,
                border: "1px solid rgba(56,189,248,0.6)",
                background: "#1f2125",
                color: "#f4f4f5",
                outline: "none",
                fontFamily: "inherit",
              }}
            />
          ) : (
            <div className="jcCarteTitre" title={c.question ?? c.titre}>
              {enRecherche ? surligner(c.titre, motsRecherche) : c.titre}
            </div>
          )}
          {sousTexte && (
            <div className="jcCarteApercu" title={sousTexte}>
              {enRecherche ? surligner(sousTexte, motsRecherche) : sousTexte}
            </div>
          )}
        </div>
        <div className="jcCarteActions" onClick={(e) => e.stopPropagation()}>
          {!thunderai && (
            <button
              type="button"
              title="Renommer"
              onClick={() => {
                setBrouillon(c.titre);
                setEdition(true);
              }}
            >
              ✎
            </button>
          )}
          <button type="button" title="Supprimer" onClick={() => onSupprimer(c.id, c.source)}>
            ✕
          </button>
        </div>
      </div>
      <div className="jcCarteMeta">
        {thunderai ? (
          <span className="jcBadgeTb" title="Échange passé par ThunderAI dans Thunderbird">
            ✉️ Thunderbird
          </span>
        ) : (
          <>
            <Avatar nom={c.auteur} taille={16} />
            <span style={{ color: couleurMembre(c.auteur), fontWeight: 600 }}>
              {c.auteur ?? "—"}
            </span>
          </>
        )}
        <span>·</span>
        <span className="jcCarteDate">{fmtDateRelative(c.updated_at)}</span>
        {!thunderai && (
          <>
            <span>·</span>
            <span title={`${c.nb_messages} messages`}>
              {nbEchanges} {nbEchanges > 1 ? "échanges" : "échange"}
            </span>
          </>
        )}
        {outils.length > 0 && (
          <span
            title={"Outils : " + outils.join(", ")}
            style={{ marginLeft: "auto", color: "#71717a", whiteSpace: "nowrap" }}
          >
            🔧 {outils.length}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Barre latérale ──────────────────────────────────────────────────────────
export function Historique({
  conversations,
  chargement,
  convId,
  utilisateur,
  filtreAuteur,
  source,
  recherche,
  onFiltreAuteur,
  onSource,
  onRecherche,
  onOuvrir,
  onNouvelle,
  onSupprimer,
  onRenommer,
  onFermer,
  rechercheRef,
}: {
  conversations: ConvResume[];
  chargement: boolean;
  convId: string | null;
  utilisateur: MembreEquipe | null;
  filtreAuteur: string; // "" = tous
  source: FiltreSource;
  recherche: string;
  onFiltreAuteur: (a: string) => void;
  onSource: (s: FiltreSource) => void;
  onRecherche: (q: string) => void;
  onOuvrir: (id: string, source: SourceConv) => void;
  onNouvelle: () => void;
  onSupprimer: (id: string, source: SourceConv) => void;
  onRenommer: (id: string, titre: string) => Promise<void> | void;
  onFermer?: () => void;
  rechercheRef?: React.RefObject<HTMLInputElement | null>;
}) {
  const enRecherche = recherche.trim().length > 0;
  const motsRecherche = recherche.trim().split(/\s+/).filter(Boolean);
  const groupes = enRecherche ? null : grouperParDate(conversations);

  // Les puces : « Tous », puis l'utilisateur courant en premier, puis le reste.
  const membres: MembreEquipe[] = utilisateur
    ? [utilisateur, ...EQUIPE_JARDI.filter((m) => m !== utilisateur)]
    : [...EQUIPE_JARDI];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        padding: "12px 10px 10px",
      }}
    >
      <style>{`
        .jcCarte {
          padding: 9px 10px;
          border-radius: 10px;
          cursor: pointer;
          margin-bottom: 3px;
          border: 1px solid transparent;
          transition: background 0.12s;
        }
        .jcCarte:hover { background: rgba(255,255,255,0.05); }
        .jcCarte:focus-visible { outline: 2px solid rgba(56,189,248,0.6); outline-offset: -2px; }
        .jcCarteActive, .jcCarteActive:hover {
          background: #2a2d31;
          border-color: rgba(56,189,248,0.35);
        }
        .jcCarteTitre {
          font-size: 13px;
          font-weight: 600;
          color: #e4e4e7;
          line-height: 1.3;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
          word-break: break-word;
        }
        .jcCarteApercu {
          margin-top: 3px;
          font-size: 12px;
          color: #a1a1aa;
          line-height: 1.35;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
          word-break: break-word;
        }
        .jcCarteMeta {
          margin-top: 6px;
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: 11.5px;
          color: #8b8b93;
          white-space: nowrap;
          overflow: hidden;
        }
        .jcCarteDate { color: #e4e4e7; font-weight: 600; }
        .jcBadgeTb {
          color: #D97757;
          font-weight: 600;
        }
        .jcSegment {
          display: flex;
          margin-top: 8px;
          border: 1px solid rgba(255,255,255,0.14);
          border-radius: 9px;
          overflow: hidden;
        }
        .jcSegment button {
          flex: 1;
          padding: 5px 4px;
          font-size: 12px;
          font-weight: 600;
          background: transparent;
          border: none;
          color: #a1a1aa;
          cursor: pointer;
          white-space: nowrap;
        }
        .jcSegment button + button { border-left: 1px solid rgba(255,255,255,0.14); }
        .jcSegment button:hover { background: rgba(255,255,255,0.06); color: #e4e4e7; }
        .jcSegment button.actif { background: rgba(255,255,255,0.14); color: #f4f4f5; }
        .jcCarteActions {
          display: flex;
          gap: 2px;
          flex-shrink: 0;
          opacity: 0.35;
          transition: opacity 0.12s;
        }
        .jcCarte:hover .jcCarteActions, .jcCarteActive .jcCarteActions { opacity: 1; }
        .jcCarteActions button {
          background: none;
          border: none;
          color: #a1a1aa;
          cursor: pointer;
          font-size: 13px;
          padding: 0 4px;
          line-height: 1.2;
          border-radius: 4px;
        }
        .jcCarteActions button:hover { color: #f4f4f5; background: rgba(255,255,255,0.1); }
        @media (hover: none) { .jcCarteActions { opacity: 0.7; } }
        .jcPuce {
          padding: 3px 9px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 600;
          border: 1px solid rgba(255,255,255,0.14);
          background: transparent;
          color: #a1a1aa;
          cursor: pointer;
          line-height: 1.4;
          white-space: nowrap;
        }
        .jcPuce:hover { background: rgba(255,255,255,0.06); color: #e4e4e7; }
        .jcGroupe {
          position: sticky;
          top: 0;
          z-index: 1;
          background: #1f2125;
          font-size: 12px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: #e4e4e7;
          padding: 12px 10px 5px;
          margin-bottom: 3px;
          border-bottom: 1px solid rgba(255,255,255,0.14);
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .jcGroupe::before {
          content: "";
          width: 3px;
          height: 12px;
          border-radius: 2px;
          background: #2B8AD1;
        }
        .jcRecherche {
          width: 100%;
          padding: 8px 30px 8px 32px;
          font-size: 13px;
          font-family: inherit;
          border-radius: 10px;
          border: 1px solid rgba(255,255,255,0.14);
          background: #2a2d31;
          color: #ededed;
          outline: none;
        }
        .jcRecherche:focus { border-color: rgba(56,189,248,0.6); }
        .jcRecherche::placeholder { color: #71717a; }
      `}</style>

      {/* En-tête : nouvelle conversation + fermeture (mobile) */}
      <div style={{ display: "flex", gap: 6, alignItems: "stretch" }}>
        <button
          type="button"
          onClick={onNouvelle}
          style={{
            flex: 1,
            padding: "9px 12px",
            fontSize: 13,
            fontWeight: 600,
            color: "#fff",
            background: "#2B8AD1",
            border: "none",
            borderRadius: 10,
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          + Nouvelle conversation
        </button>
        {onFermer && (
          <button
            type="button"
            onClick={onFermer}
            title="Fermer l'historique"
            style={{
              padding: "0 12px",
              fontSize: 16,
              color: "#a1a1aa",
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.14)",
              borderRadius: 10,
              cursor: "pointer",
            }}
          >
            ✕
          </button>
        )}
      </div>

      {/* Recherche */}
      <div style={{ position: "relative", marginTop: 10 }}>
        <span
          style={{
            position: "absolute",
            left: 10,
            top: "50%",
            transform: "translateY(-50%)",
            fontSize: 14,
            color: "#71717a",
            pointerEvents: "none",
          }}
        >
          🔍
        </span>
        <input
          ref={rechercheRef}
          className="jcRecherche"
          value={recherche}
          onChange={(e) => onRecherche(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onRecherche("");
          }}
          placeholder="Rechercher (client, article, mot…)"
          spellCheck={false}
        />
        {recherche && (
          <button
            type="button"
            onClick={() => onRecherche("")}
            title="Effacer"
            style={{
              position: "absolute",
              right: 6,
              top: "50%",
              transform: "translateY(-50%)",
              background: "none",
              border: "none",
              color: "#a1a1aa",
              cursor: "pointer",
              fontSize: 14,
              padding: "2px 6px",
            }}
          >
            ✕
          </button>
        )}
      </div>

      {/* Filtre par utilisateur */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 8 }}>
        <button
          type="button"
          className="jcPuce"
          onClick={() => onFiltreAuteur("")}
          style={
            filtreAuteur === ""
              ? { background: "rgba(255,255,255,0.14)", color: "#f4f4f5", borderColor: "rgba(255,255,255,0.3)" }
              : undefined
          }
        >
          Tous
        </button>
        {membres.map((m) => {
          const actif = filtreAuteur === m;
          const couleur = COULEURS_EQUIPE[m];
          return (
            <button
              key={m}
              type="button"
              className="jcPuce"
              onClick={() => onFiltreAuteur(actif ? "" : m)}
              title={m === utilisateur ? `${m} (moi)` : m}
              style={
                actif
                  ? { background: couleur, color: "#1f2125", borderColor: couleur }
                  : { color: couleur, borderColor: couleur + "55" }
              }
            >
              {m}
            </button>
          );
        })}
      </div>

      {/* Source : chat du dashboard, échanges ThunderAI, ou les deux */}
      <div className="jcSegment" role="tablist" aria-label="Source">
        {(
          [
            ["jardi", "💬 Jardi"],
            ["thunderai", "✉️ Thunderbird"],
            ["tous", "Tous"],
          ] as [FiltreSource, string][]
        ).map(([val, lib]) => (
          <button
            key={val}
            type="button"
            role="tab"
            aria-selected={source === val}
            className={source === val ? "actif" : undefined}
            onClick={() => onSource(val)}
          >
            {lib}
          </button>
        ))}
      </div>

      {/* Liste */}
      <div style={{ flex: 1, overflowY: "auto", marginTop: 8, marginRight: -4, paddingRight: 4 }}>
        {chargement && conversations.length === 0 && (
          <div style={{ fontSize: 12, color: "#71717a", padding: 10 }}>Chargement…</div>
        )}
        {!chargement && conversations.length === 0 && (
          <div style={{ fontSize: 12, color: "#71717a", padding: 10, lineHeight: 1.5 }}>
            {enRecherche
              ? "Aucune conversation ne contient tous ces mots. Essaie un mot plus court."
              : filtreAuteur && source === "thunderai"
              ? "Les échanges ThunderAI n'ont pas d'auteur : retire le filtre par personne."
              : filtreAuteur
              ? `Aucune conversation de ${filtreAuteur}.`
              : source === "thunderai"
              ? "Aucun échange ThunderAI (conservation 60 jours)."
              : "Aucune conversation enregistrée."}
          </div>
        )}
        {enRecherche && conversations.length > 0 && (
          <div className="jcGroupe">
            {conversations.length} résultat{conversations.length > 1 ? "s" : ""}
          </div>
        )}
        {enRecherche &&
          conversations.map((c) => (
            <Carte
              key={c.id}
              c={c}
              active={convId === c.id}
              enRecherche
              motsRecherche={motsRecherche}
              onOuvrir={onOuvrir}
              onSupprimer={onSupprimer}
              onRenommer={onRenommer}
            />
          ))}
        {groupes?.map((g) => (
          <div key={g.titre}>
            <div className="jcGroupe">{g.titre}</div>
            {g.items.map((c) => (
              <Carte
                key={c.id}
                c={c}
                active={convId === c.id}
                enRecherche={false}
                motsRecherche={[]}
                onOuvrir={onOuvrir}
                onSupprimer={onSupprimer}
                onRenommer={onRenommer}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
