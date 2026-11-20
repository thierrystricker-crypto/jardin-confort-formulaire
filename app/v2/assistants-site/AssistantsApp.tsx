"use client";
// app/v2/assistants-site/AssistantsApp.tsx
// ─────────────────────────────────────────────────────────────────────────────
// « Assistants du site » : ce que les visiteurs de jardin-confort.ch demandent
//   • au chat IA (jardi-chat-public) — regroupé par conversation, chaque tour
//     avec question, réponse, outils appelés et événements panier ;
//   • au filtre intelligent (jardi-filtre) — une ligne par recherche, avec les
//     filtres posés, la note affichée et les rejets.
//
// Lecture seule. Les e-mails / téléphones sont déjà masqués à l'écriture par
// les deux projets. Tout le texte vient des visiteurs : affiché en texte brut
// (React échappe), aucun HTML interprété ; seuls les liens vers
// www.jardin-confort.ch sont rendus cliquables.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";

type Source = "chat" | "filtre";
type Outil = { outil?: string; entree?: Record<string, unknown>; erreur?: boolean };

type LigneChat = {
  id: number;
  cree_le: string;
  conversation: string | null;
  langue: string | null;
  page: string | null;
  tour: number | null;
  question: string | null;
  reponse: string | null;
  outils: Outil[] | null;
  repli: boolean | null;
  liens_retires: number | null;
  concurrents: string[] | null;
  duree_ms: number | null;
  tokens_in: number | null;
  tokens_out: number | null;
  tokens_cache: number | null;
  modele: string | null;
};

type LigneFiltre = {
  id: number;
  cree_le: string;
  langue: string | null;
  contexte_type: string | null;
  contexte: string | null;
  texte: string | null;
  params: unknown;
  tri: string | null;
  note: string | null;
  affinage: unknown;
  conseiller: boolean | null;
  rejets: unknown;
  duree_ms: number | null;
};

type StatsChat = {
  questions: number;
  conversations: number;
  replis: number;
  propositions: number;
  ajouts: number;
  retraits: number;
  tokensIn: number;
  tokensOut: number;
  tokensCache: number;
};
type StatsFiltre = {
  recherches: number;
  conseiller: number;
  sansFiltre: number;
  avecRejets: number;
  tokensIn: number;
  tokensOut: number;
};

type Reponse = {
  source: Source;
  lignes: (LigneChat | LigneFiltre)[];
  tronque: boolean;
  stats: StatsChat | StatsFiltre;
  error?: string;
};

const PERIODES = [
  { j: 1, l: "24 h" },
  { j: 7, l: "7 jours" },
  { j: 30, l: "30 jours" },
  { j: 90, l: "90 jours" },
  { j: 365, l: "12 mois" },
];

const LIBELLE_OUTIL: Record<string, string> = {
  catalogue_chercher: "🔎 catalogue",
  fiche_article: "📄 fiche",
  variantes_chercher: "🎛 variantes",
  disponibilite_article: "⏱ dispo",
  lien_resultats: "🔗 lien filtres",
  panier_proposer: "🛒 proposition",
  configurateur_parasol: "☂ configurateur",
};

// ─── utilitaires ───
function dateHeure(iso: string) {
  return new Date(iso).toLocaleString("fr-CH", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function heure(iso: string) {
  return new Date(iso).toLocaleTimeString("fr-CH", { hour: "2-digit", minute: "2-digit" });
}
function estLienSite(u: string | null | undefined): u is string {
  return !!u && /^https:\/\/www\.jardin-confort\.ch\//.test(u);
}
function cheminCourt(u: string | null | undefined): string {
  if (!u) return "—";
  try {
    const p = new URL(u).pathname.replace(/^\/(de|en)\//, "/");
    return p === "/" ? "accueil" : decodeURIComponent(p);
  } catch {
    return u.slice(0, 60);
  }
}
function nb(n: number) {
  return n.toLocaleString("fr-CH");
}

// Texte avec URL jardin-confort.ch cliquables, le reste en texte brut.
function TexteAvecLiens({ texte }: { texte: string }) {
  const morceaux = texte.split(/(https:\/\/www\.jardin-confort\.ch\/[^\s)\]"'<>]*)/g);
  return (
    <>
      {morceaux.map((m, i) =>
        i % 2 === 1 ? (
          <a key={i} href={m} target="_blank" rel="noopener noreferrer" style={{ color: "var(--v2-accent)", wordBreak: "break-all" }}>
            {cheminCourt(m)}
          </a>
        ) : (
          <React.Fragment key={i}>{m}</React.Fragment>
        ),
      )}
    </>
  );
}

// ─── styles communs (variables de la coquille v2 : clair / sombre) ───
const carte: CSSProperties = {
  background: "var(--v2-surface)",
  border: "1px solid var(--v2-bord)",
  borderRadius: "var(--v2-rayon)",
  boxShadow: "var(--v2-ombre)",
};
const badge = (fond: string, texte: string): CSSProperties => ({
  display: "inline-block",
  fontSize: 11.5,
  fontWeight: 600,
  padding: "1px 8px",
  borderRadius: 999,
  background: `var(${fond})`,
  color: `var(${texte})`,
  whiteSpace: "nowrap",
});
const attenue: CSSProperties = { color: "var(--v2-attenue)", fontSize: 12.5 };

function Kpi({ label, valeur, ton }: { label: string; valeur: string; ton?: "warn" | "bad" | "ok" }) {
  const couleur = ton ? `var(--v2-${ton})` : "var(--v2-texte)";
  return (
    <div style={{ ...carte, padding: "12px 14px", minWidth: 120, flex: "1 1 120px" }}>
      <div style={attenue}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: couleur, marginTop: 2 }}>{valeur}</div>
    </div>
  );
}

// ─── Chat : regroupement par conversation ───
type Conversation = {
  id: string;
  lignes: LigneChat[]; // ordre chronologique
  debut: string;
  fin: string;
  questions: number;
  repli: boolean;
  ajout: boolean;
  proposition: boolean;
  concurrents: string[];
  langue: string;
  page: string | null;
};

function regrouper(lignes: LigneChat[]): Conversation[] {
  const parId = new Map<string, LigneChat[]>();
  for (const l of lignes) {
    const id = l.conversation || `seule-${l.id}`;
    const t = parId.get(id);
    if (t) t.push(l);
    else parId.set(id, [l]);
  }
  const res: Conversation[] = [];
  for (const [id, ls] of parId) {
    ls.sort((a, b) => a.cree_le.localeCompare(b.cree_le) || a.id - b.id);
    const qs = ls.filter((l) => (l.question || "").trim() !== "");
    const outils = ls.flatMap((l) => (Array.isArray(l.outils) ? l.outils : []));
    const derniere = qs[qs.length - 1] || ls[ls.length - 1];
    res.push({
      id,
      lignes: ls,
      debut: ls[0].cree_le,
      fin: ls[ls.length - 1].cree_le,
      questions: qs.length,
      repli: qs.some((l) => l.repli),
      ajout: outils.some((o) => o?.outil === "panier_ajoute"),
      proposition: outils.some((o) => o?.outil === "panier_proposer"),
      concurrents: Array.from(new Set(ls.flatMap((l) => l.concurrents || []))),
      langue: (qs[0]?.langue || ls[0].langue || "").toUpperCase(),
      page: derniere?.page ?? null,
    });
  }
  return res.sort((a, b) => b.fin.localeCompare(a.fin));
}

function LigneEvenement({ l }: { l: LigneChat }) {
  const o = (l.outils || [])[0];
  const e = (o?.entree || {}) as { quantite?: unknown; statut?: unknown };
  const q = typeof e.quantite === "number" ? ` × ${e.quantite}` : "";
  const txt =
    o?.outil === "panier_ajoute"
      ? `✓ Ajouté au panier${q}`
      : o?.outil === "panier_retire"
        ? `↩ Retiré du panier depuis${q}`
        : o?.outil === "panier_refuse"
          ? `⚠ Ajout refusé par Shopify${e.statut ? ` (${String(e.statut)})` : ""}`
          : `• ${o?.outil || "événement"}`;
  const ton = o?.outil === "panier_ajoute" ? ["--v2-ok-bg", "--v2-ok"] : o?.outil === "panier_refuse" ? ["--v2-bad-bg", "--v2-bad"] : ["--v2-neutre-bg", "--v2-neutre"];
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "6px 0" }}>
      <span style={{ ...attenue, width: 42 }}>{heure(l.cree_le)}</span>
      <span style={badge(ton[0], ton[1])}>{txt}</span>
    </div>
  );
}

function Tour({ l }: { l: LigneChat }) {
  const outils = (Array.isArray(l.outils) ? l.outils : []).filter((o) => o?.outil);
  return (
    <div style={{ borderTop: "1px solid var(--v2-bord)", padding: "10px 0" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
        <span style={{ ...attenue, width: 42 }}>{heure(l.cree_le)}</span>
        <span style={{ fontWeight: 600, whiteSpace: "pre-wrap", flex: 1, minWidth: 200 }}>🙋 {l.question}</span>
        {estLienSite(l.page) && (
          <a href={l.page} target="_blank" rel="noopener noreferrer" style={{ ...attenue, color: "var(--v2-accent)" }} title={l.page}>
            {cheminCourt(l.page)} ↗
          </a>
        )}
      </div>
      <div
        style={{
          marginTop: 6,
          marginLeft: 50,
          padding: "8px 12px",
          borderRadius: 10,
          background: l.repli ? "var(--v2-bad-bg)" : "var(--v2-surface-2)",
          whiteSpace: "pre-wrap",
          fontSize: 13.5,
          lineHeight: 1.45,
        }}
      >
        {l.repli && <div style={{ ...badge("--v2-bad-bg", "--v2-bad"), marginBottom: 4 }}>Réponse de secours (erreur / délai)</div>}
        <TexteAvecLiens texte={l.reponse || "—"} />
      </div>
      <div style={{ marginLeft: 50, marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {outils.map((o, i) => (
          <span
            key={i}
            title={JSON.stringify(o.entree || {})}
            style={o.erreur ? badge("--v2-bad-bg", "--v2-bad") : badge("--v2-info-bg", "--v2-info")}
          >
            {LIBELLE_OUTIL[o.outil!] || o.outil}
            {o.erreur ? " ✗" : ""}
          </span>
        ))}
        {(l.concurrents || []).length > 0 && <span style={badge("--v2-warn-bg", "--v2-warn")}>concurrent : {(l.concurrents || []).join(", ")}</span>}
        {(l.liens_retires || 0) > 0 && <span style={badge("--v2-warn-bg", "--v2-warn")}>{l.liens_retires} lien(s) retiré(s)</span>}
        <span style={attenue}>
          {l.duree_ms != null ? `${(l.duree_ms / 1000).toFixed(1)} s` : ""}
          {l.tokens_in != null ? ` · ${nb(l.tokens_in)} in / ${nb(l.tokens_out || 0)} out / ${nb(l.tokens_cache || 0)} cache` : ""}
        </span>
      </div>
    </div>
  );
}

function CarteConversation({ c, ouverte, basculer }: { c: Conversation; ouverte: boolean; basculer: () => void }) {
  const premiere = c.lignes.find((l) => (l.question || "").trim() !== "");
  return (
    <div style={{ ...carte, marginBottom: 10 }}>
      <button
        type="button"
        onClick={basculer}
        style={{
          all: "unset",
          cursor: "pointer",
          display: "flex",
          gap: 10,
          alignItems: "center",
          flexWrap: "wrap",
          width: "100%",
          boxSizing: "border-box",
          padding: "10px 14px",
        }}
      >
        <span style={{ ...attenue, minWidth: 92 }}>{dateHeure(c.fin)}</span>
        <span style={badge("--v2-neutre-bg", "--v2-neutre")}>{c.langue || "?"}</span>
        <span style={{ flex: 1, minWidth: 200, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {premiere?.question || "(événements seuls)"}
        </span>
        <span style={attenue}>
          {c.questions} question{c.questions > 1 ? "s" : ""}
        </span>
        {c.repli && <span style={badge("--v2-bad-bg", "--v2-bad")}>secours</span>}
        {c.ajout ? (
          <span style={badge("--v2-ok-bg", "--v2-ok")}>🛒 ajouté</span>
        ) : c.proposition ? (
          <span style={badge("--v2-violet-bg", "--v2-violet")}>🛒 proposé</span>
        ) : null}
        {c.concurrents.length > 0 && <span style={badge("--v2-warn-bg", "--v2-warn")}>concurrent</span>}
        <span style={{ ...attenue, width: 14 }}>{ouverte ? "▾" : "▸"}</span>
      </button>
      {ouverte && (
        <div style={{ padding: "0 14px 8px" }}>
          <div style={{ ...attenue, marginBottom: 4 }}>
            Conversation {c.id.slice(0, 8)} · {dateHeure(c.debut)} → {heure(c.fin)}
          </div>
          {c.lignes.map((l) => ((l.question || "").trim() !== "" ? <Tour key={l.id} l={l} /> : <LigneEvenement key={l.id} l={l} />))}
        </div>
      )}
    </div>
  );
}

// ─── Filtre : mise en forme des filtres posés ───
function valeurFiltre(v: unknown): string {
  const s = String(v ?? "");
  if (/^gid:\/\/shopify\/FilterSettingGroup\//.test(s)) return "(groupe de valeurs)";
  if (/^gid:\/\/shopify\/Metaobject\//.test(s)) return "(couleur)";
  return s;
}
function cleFiltre(k: unknown): string {
  return String(k ?? "")
    .replace(/^filter\.p\.m\.custom\./, "")
    .replace(/^filter\.p\.m\./, "")
    .replace(/^filter\.v\./, "")
    .replace(/^filter\.p\./, "");
}
function filtresPoses(params: unknown): { k: string; v: string }[] {
  if (!Array.isArray(params)) return [];
  return params
    .filter((p): p is unknown[] => Array.isArray(p) && p.length >= 2)
    .map((p) => ({ k: cleFiltre(p[0]), v: valeurFiltre(p[1]) }));
}
function nbRejets(r: unknown): number {
  return Array.isArray(r) ? r.length : 0;
}

function TableFiltre({ lignes }: { lignes: LigneFiltre[] }) {
  const th: CSSProperties = { textAlign: "left", padding: "8px 10px", fontWeight: 600, color: "var(--v2-attenue)", fontSize: 12.5, whiteSpace: "nowrap" };
  const td: CSSProperties = { padding: "8px 10px", verticalAlign: "top", borderTop: "1px solid var(--v2-bord)", fontSize: 13.5 };
  return (
    <div style={{ ...carte, overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={th}>Quand</th>
            <th style={th}>Recherche du visiteur</th>
            <th style={th}>Où</th>
            <th style={th}>Filtres posés</th>
            <th style={th}>Note affichée</th>
          </tr>
        </thead>
        <tbody>
          {lignes.map((l) => {
            const f = filtresPoses(l.params);
            const r = nbRejets(l.rejets);
            return (
              <tr key={l.id}>
                <td style={{ ...td, whiteSpace: "nowrap", color: "var(--v2-attenue)" }}>
                  {dateHeure(l.cree_le)}
                  <div>
                    <span style={badge("--v2-neutre-bg", "--v2-neutre")}>{(l.langue || "?").toUpperCase()}</span>
                  </div>
                </td>
                <td style={{ ...td, fontWeight: 600, whiteSpace: "pre-wrap", minWidth: 180 }}>
                  {l.texte}
                  <div style={{ marginTop: 4, display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {l.conseiller && <span style={badge("--v2-warn-bg", "--v2-warn")}>→ conseiller</span>}
                    {f.length === 0 && <span style={badge("--v2-bad-bg", "--v2-bad")}>aucun filtre</span>}
                    {r > 0 && (
                      <span style={badge("--v2-warn-bg", "--v2-warn")} title={JSON.stringify(l.rejets)}>
                        {r} rejet{r > 1 ? "s" : ""}
                      </span>
                    )}
                    {l.tri && <span style={badge("--v2-info-bg", "--v2-info")}>tri : {l.tri}</span>}
                  </div>
                </td>
                <td style={{ ...td, color: "var(--v2-attenue)", minWidth: 120 }}>
                  {l.contexte_type || "—"}
                  {l.contexte ? <div style={{ color: "var(--v2-texte)" }}>{l.contexte}</div> : null}
                </td>
                <td style={{ ...td, minWidth: 180 }}>
                  {f.length === 0
                    ? "—"
                    : f.map((x, i) => (
                        <div key={i}>
                          <span style={{ color: "var(--v2-attenue)" }}>{x.k} :</span> {x.v}
                        </div>
                      ))}
                </td>
                <td style={{ ...td, color: "var(--v2-attenue)", whiteSpace: "pre-wrap", minWidth: 180 }}>{l.note || "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Page ───
export default function AssistantsApp() {
  const [source, setSource] = useState<Source>("chat");
  const [jours, setJours] = useState(7);
  const [saisie, setSaisie] = useState("");
  const [q, setQ] = useState("");
  const [repli, setRepli] = useState(false);
  const [donnees, setDonnees] = useState<Reponse | null>(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");
  const [ouvertes, setOuvertes] = useState<Set<string>>(new Set());
  const [toutOuvrir, setToutOuvrir] = useState(false);

  // Recherche différée (400 ms)
  useEffect(() => {
    const t = setTimeout(() => setQ(saisie.trim()), 400);
    return () => clearTimeout(t);
  }, [saisie]);

  const charger = useCallback(async () => {
    setChargement(true);
    setErreur("");
    try {
      const p = new URLSearchParams({ source, jours: String(jours) });
      if (q) p.set("q", q);
      if (source === "chat" && repli) p.set("repli", "1");
      const res = await fetch(`/api/assistants-site?${p}`, { cache: "no-store" });
      const j = (await res.json()) as Reponse;
      if (!res.ok || j.error) throw new Error(j.error || `Erreur ${res.status}`);
      setDonnees(j);
    } catch (e) {
      setErreur((e as Error).message);
      setDonnees(null);
    } finally {
      setChargement(false);
    }
  }, [source, jours, q, repli]);

  useEffect(() => {
    void charger();
  }, [charger]);

  const conversations = useMemo(
    () => (donnees?.source === "chat" ? regrouper(donnees.lignes as LigneChat[]) : []),
    [donnees],
  );

  const basculer = (id: string) =>
    setOuvertes((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const onglet = (s: Source, label: string) => (
    <button
      type="button"
      className="v2-btn"
      onClick={() => {
        setSource(s);
        setOuvertes(new Set());
      }}
      style={
        source === s
          ? { background: "var(--v2-accent)", color: "#fff", borderColor: "var(--v2-accent)" }
          : undefined
      }
    >
      {label}
    </button>
  );

  const champ: CSSProperties = {
    padding: "7px 10px",
    borderRadius: 8,
    border: "1px solid var(--v2-bord)",
    background: "var(--v2-surface)",
    color: "var(--v2-texte)",
    fontSize: 14,
  };

  const s = donnees?.stats;

  return (
    <div style={{ padding: "1rem 1.25rem 3rem", maxWidth: 1200 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap", marginBottom: ".75rem" }}>
        <div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0 }}>🤖 Assistants du site</h1>
          <p style={{ margin: ".25rem 0 0", color: "var(--v2-attenue)", fontSize: ".92rem" }}>
            Ce que les visiteurs de jardin-confort.ch demandent au chat et au filtre intelligent. Journaux anonymes (e-mails et téléphones masqués), lecture seule.
          </p>
        </div>
        <div style={{ display: "flex", gap: ".5rem" }}>
          {onglet("chat", "💬 Chat client")}
          {onglet("filtre", "🎛 Filtre intelligent")}
        </div>
      </div>

      <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap", alignItems: "center", marginBottom: "1rem" }}>
        <select value={jours} onChange={(e) => setJours(Number(e.target.value))} style={champ}>
          {PERIODES.map((p) => (
            <option key={p.j} value={p.j}>
              {p.l}
            </option>
          ))}
        </select>
        <input
          value={saisie}
          onChange={(e) => setSaisie(e.target.value)}
          placeholder={source === "chat" ? "Chercher dans les questions, réponses, pages…" : "Chercher dans les recherches, contextes, notes…"}
          style={{ ...champ, flex: "1 1 260px" }}
        />
        {source === "chat" && (
          <>
            <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 14 }}>
              <input type="checkbox" checked={repli} onChange={(e) => setRepli(e.target.checked)} />
              Seulement les réponses de secours
            </label>
            <button
              type="button"
              className="v2-btn"
              onClick={() => {
                const t = !toutOuvrir;
                setToutOuvrir(t);
                setOuvertes(t ? new Set(conversations.map((c) => c.id)) : new Set());
              }}
            >
              {toutOuvrir ? "Tout replier" : "Tout déplier"}
            </button>
          </>
        )}
        <button type="button" className="v2-btn" onClick={() => void charger()}>
          ↻ Actualiser
        </button>
      </div>

      {s && donnees?.source === "chat" && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: "1rem" }}>
          <Kpi label="Conversations" valeur={nb((s as StatsChat).conversations)} />
          <Kpi label="Questions" valeur={nb((s as StatsChat).questions)} />
          <Kpi label="Réponses de secours" valeur={nb((s as StatsChat).replis)} ton={(s as StatsChat).replis > 0 ? "bad" : undefined} />
          <Kpi label="Propositions panier" valeur={nb((s as StatsChat).propositions)} />
          <Kpi label="Ajoutés au panier" valeur={nb((s as StatsChat).ajouts)} ton={(s as StatsChat).ajouts > 0 ? "ok" : undefined} />
          <Kpi label="Retirés ensuite" valeur={nb((s as StatsChat).retraits)} />
          <Kpi
            label="Tokens (in / out)"
            valeur={`${Math.round((s as StatsChat).tokensIn / 1000)}k / ${Math.round((s as StatsChat).tokensOut / 1000)}k`}
          />
        </div>
      )}
      {s && donnees?.source === "filtre" && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: "1rem" }}>
          <Kpi label="Recherches" valeur={nb((s as StatsFiltre).recherches)} />
          <Kpi label="Sans aucun filtre" valeur={nb((s as StatsFiltre).sansFiltre)} ton={(s as StatsFiltre).sansFiltre > 0 ? "warn" : undefined} />
          <Kpi label="Avec rejets" valeur={nb((s as StatsFiltre).avecRejets)} ton={(s as StatsFiltre).avecRejets > 0 ? "warn" : undefined} />
          <Kpi label="Renvoi conseiller" valeur={nb((s as StatsFiltre).conseiller)} />
          <Kpi
            label="Tokens (in / out)"
            valeur={`${Math.round((s as StatsFiltre).tokensIn / 1000)}k / ${Math.round((s as StatsFiltre).tokensOut / 1000)}k`}
          />
        </div>
      )}

      {erreur && (
        <div style={{ background: "var(--v2-bad-bg)", color: "var(--v2-bad)", borderRadius: 8, padding: ".8rem 1rem", marginBottom: "1rem" }}>
          {erreur}{" "}
          <button type="button" className="v2-btn" onClick={() => void charger()}>
            Réessayer
          </button>
        </div>
      )}
      {donnees?.tronque && (
        <div style={{ background: "var(--v2-warn-bg)", color: "var(--v2-warn)", borderRadius: 8, padding: ".6rem 1rem", marginBottom: "1rem", fontSize: 13.5 }}>
          Plus de 1 000 lignes sur la période : seules les plus récentes sont affichées. Réduisez la période ou cherchez un mot.
        </div>
      )}

      {chargement && !donnees ? (
        <p style={{ color: "var(--v2-attenue)" }}>Chargement…</p>
      ) : donnees?.source === "chat" ? (
        conversations.length === 0 ? (
          <div style={{ ...carte, padding: 24, textAlign: "center", color: "var(--v2-attenue)" }}>Aucune conversation sur la période.</div>
        ) : (
          <div style={{ opacity: chargement ? 0.6 : 1 }}>
            {conversations.map((c) => (
              <CarteConversation key={c.id} c={c} ouverte={ouvertes.has(c.id)} basculer={() => basculer(c.id)} />
            ))}
          </div>
        )
      ) : donnees?.source === "filtre" ? (
        (donnees.lignes as LigneFiltre[]).length === 0 ? (
          <div style={{ ...carte, padding: 24, textAlign: "center", color: "var(--v2-attenue)" }}>Aucune recherche sur la période.</div>
        ) : (
          <div style={{ opacity: chargement ? 0.6 : 1 }}>
            <TableFiltre lignes={donnees.lignes as LigneFiltre[]} />
          </div>
        )
      ) : null}
    </div>
  );
}
