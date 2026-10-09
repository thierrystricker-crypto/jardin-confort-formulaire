"use client";
// app/v2/jardi/historique-v2.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Dashboard 2.0 — historique du chat Jardi, avec TRI et FILTRES (10.10.2026).
//
// Ce que fait le serveur (inchangé, RPC jardi_conversations_lister) :
//   recherche plein texte, filtre par personne, source Jardi / Thunderbird.
// Ce qui s'ajoute ici, côté navigateur, sur la liste reçue (jusqu'à 500) :
//   - tri : activité récente, plus anciennes, date de création, plus
//     d'échanges, titre A→Z ;
//   - période : aujourd'hui, 7 jours, 30 jours, 3 mois ;
//   - thèmes : les conversations où Jardi a utilisé tel type d'outil (mails,
//     clients, brouillons d'offre, stock…), avec le nombre par thème ;
//   - épingles : 📌 garde une conversation en haut (mémorisé sur l'appareil).
// Tri / période / thème sont mémorisés sur l'appareil. Aucune écriture en base.
// Composant « bête » : la liste et les actions viennent de la page.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { EQUIPE_JARDI, type MembreEquipe } from "@/lib/jardi-equipe";
import {
  Avatar,
  COULEURS_EQUIPE,
  apercuTexte,
  couleurMembre,
  fmtDateRelative,
  type ConvResume,
  type FiltreSource,
  type SourceConv,
} from "../../dashboard/jardi/historique";
import { THEMES, themesDe } from "./outils";

export type Tri = "recentes" | "anciennes" | "creation" | "echanges" | "titre";
export type Periode = "tout" | "jour" | "7j" | "30j" | "90j";

const LIB_TRI: Record<Tri, string> = {
  recentes: "Activité récente",
  anciennes: "Plus anciennes d'abord",
  creation: "Date de création",
  echanges: "Plus d'échanges",
  titre: "Titre A → Z",
};
const LIB_PERIODE: Record<Periode, string> = {
  tout: "Tout",
  jour: "Aujourd'hui",
  "7j": "7 jours",
  "30j": "30 jours",
  "90j": "3 mois",
};

const CLE_REGLAGES = "jardi-v2-historique";
const CLE_EPINGLES = "jardi-v2-epingles";

type Reglages = { tri: Tri; periode: Periode; theme: string };
const DEFAUT: Reglages = { tri: "recentes", periode: "tout", theme: "" };

function lireReglages(): Reglages {
  try {
    const r = JSON.parse(localStorage.getItem(CLE_REGLAGES) || "{}") as Partial<Reglages>;
    return {
      tri: r.tri && r.tri in LIB_TRI ? r.tri : DEFAUT.tri,
      periode: r.periode && r.periode in LIB_PERIODE ? r.periode : DEFAUT.periode,
      theme: typeof r.theme === "string" ? r.theme : "",
    };
  } catch {
    return DEFAUT;
  }
}

function lireEpingles(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(CLE_EPINGLES) || "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function debutPeriode(p: Periode): number {
  if (p === "tout") return 0;
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const jours = p === "jour" ? 0 : p === "7j" ? 6 : p === "30j" ? 29 : 89;
  return d.getTime() - jours * 86_400_000;
}

function grouperParDate(liste: ConvResume[]): { titre: string; items: ConvResume[] }[] {
  const now = new Date();
  const jour = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const aujourdhui = jour(now);
  const groupes: Record<string, ConvResume[]> = {};
  const ordre: string[] = [];
  for (const c of liste) {
    const d = new Date(c.updated_at);
    const ecart = Math.round((aujourdhui - jour(d)) / 86_400_000);
    let cle: string;
    if (ecart <= 0) cle = "Aujourd'hui";
    else if (ecart === 1) cle = "Hier";
    else if (ecart < 7) cle = "Cette semaine";
    else if (d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()) cle = "Ce mois";
    else cle = d.toLocaleDateString("fr-CH", { month: "long", year: "numeric" });
    if (!groupes[cle]) {
      groupes[cle] = [];
      ordre.push(cle);
    }
    groupes[cle].push(c);
  }
  return ordre.map((k) => ({ titre: k.charAt(0).toUpperCase() + k.slice(1), items: groupes[k] }));
}

function surligner(texte: string, mots: string[]): React.ReactNode {
  const propres = mots.map((m) => m.trim()).filter(Boolean);
  if (!propres.length) return texte;
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const n = norm(texte);
  const zones: [number, number][] = [];
  for (const m of propres) {
    const nm = norm(m);
    let i = n.indexOf(nm);
    while (i !== -1 && nm.length) {
      zones.push([i, i + nm.length]);
      i = n.indexOf(nm, i + nm.length);
    }
  }
  if (!zones.length || n.length !== texte.length) return texte;
  zones.sort((a, b) => a[0] - b[0]);
  const sortie: React.ReactNode[] = [];
  let curseur = 0;
  zones.forEach(([d, f], k) => {
    if (d < curseur) return;
    if (d > curseur) sortie.push(texte.slice(curseur, d));
    sortie.push(<mark key={k}>{texte.slice(d, f)}</mark>);
    curseur = f;
  });
  if (curseur < texte.length) sortie.push(texte.slice(curseur));
  return sortie;
}

// ── Carte ───────────────────────────────────────────────────────────────────
function Carte({
  c,
  active,
  epinglee,
  mots,
  onOuvrir,
  onSupprimer,
  onRenommer,
  onEpingler,
}: {
  c: ConvResume;
  active: boolean;
  epinglee: boolean;
  mots: string[];
  onOuvrir: (id: string, source: SourceConv) => void;
  onSupprimer: (id: string, source: SourceConv) => void;
  onRenommer: (id: string, titre: string) => Promise<void> | void;
  onEpingler: (id: string) => void;
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

  const sousTexte = mots.length && c.extrait ? apercuTexte(c.extrait, 220) : apercuTexte(c.reponse, 180);
  const themes = themesDe(c.outils);
  const nbEchanges = Math.ceil((c.nb_messages ?? 0) / 2);

  return (
    <div
      className={"vjh-carte" + (active ? " actif" : "")}
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
      <div className="vjh-carte-haut">
        {edition ? (
          <input
            ref={champRef}
            className="vjh-renommer"
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
          />
        ) : (
          <div className="vjh-titre" title={c.question ?? c.titre}>
            {epinglee && <span className="vjh-pin-marque">📌 </span>}
            {mots.length ? surligner(c.titre, mots) : c.titre}
          </div>
        )}
        <div className="vjh-actions" onClick={(e) => e.stopPropagation()}>
          <button type="button" title={epinglee ? "Désépingler" : "Épingler en haut de la liste"} onClick={() => onEpingler(c.id)} className={epinglee ? "on" : ""}>
            📌
          </button>
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
            🗑
          </button>
        </div>
      </div>
      {sousTexte && <div className="vjh-apercu">{mots.length ? surligner(sousTexte, mots) : sousTexte}</div>}
      <div className="vjh-meta">
        {thunderai ? (
          <span className="vjh-tb">✉️ Thunderbird</span>
        ) : (
          <>
            <Avatar nom={c.auteur} taille={16} />
            <span style={{ color: couleurMembre(c.auteur) }} className="vjh-auteur">
              {c.auteur ?? "—"}
            </span>
          </>
        )}
        <span className="vjh-sep">·</span>
        <span>{fmtDateRelative(c.updated_at)}</span>
        {!thunderai && (
          <>
            <span className="vjh-sep">·</span>
            <span title={`${c.nb_messages} messages`}>
              {nbEchanges} éch.
            </span>
          </>
        )}
        {themes.length > 0 && (
          <span className="vjh-themes" title={"Outils : " + themes.map((t) => t.libelle).join(", ")}>
            {themes.slice(0, 4).map((t) => (
              <span key={t.cle}>{t.icone}</span>
            ))}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Barre latérale ──────────────────────────────────────────────────────────
export function HistoriqueV2({
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
  filtreAuteur: string;
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
  const [reglages, setReglages] = useState<Reglages>(DEFAUT);
  const [epingles, setEpingles] = useState<string[]>([]);
  const [panneau, setPanneau] = useState(false);

  useEffect(() => {
    setReglages(lireReglages());
    setEpingles(lireEpingles());
  }, []);

  const majReglages = (r: Partial<Reglages>) => {
    setReglages((p) => {
      const n = { ...p, ...r };
      try {
        localStorage.setItem(CLE_REGLAGES, JSON.stringify(n));
      } catch {}
      return n;
    });
  };
  const basculerEpingle = (id: string) => {
    setEpingles((p) => {
      const n = p.includes(id) ? p.filter((x) => x !== id) : [id, ...p];
      try {
        localStorage.setItem(CLE_EPINGLES, JSON.stringify(n));
      } catch {}
      return n;
    });
  };

  const enRecherche = recherche.trim().length > 0;
  const mots = enRecherche ? recherche.trim().split(/\s+/).filter(Boolean) : [];

  // Période d'abord (les compteurs de thèmes en dépendent), puis thème, puis tri.
  const dansPeriode = useMemo(() => {
    const t0 = debutPeriode(reglages.periode);
    return t0 ? conversations.filter((c) => Date.parse(c.updated_at) >= t0) : conversations;
  }, [conversations, reglages.periode]);

  const compteThemes = useMemo(() => {
    const n: Record<string, number> = {};
    for (const c of dansPeriode) for (const t of themesDe(c.outils)) n[t.cle] = (n[t.cle] ?? 0) + 1;
    return n;
  }, [dansPeriode]);

  const liste = useMemo(() => {
    const th = THEMES.find((t) => t.cle === reglages.theme);
    let l = th ? dansPeriode.filter((c) => themesDe(c.outils).some((x) => x.cle === th.cle)) : dansPeriode;
    // En recherche, « Activité récente » garde l'ordre du serveur (pertinence).
    if (!(enRecherche && reglages.tri === "recentes")) {
      const t = (s: string) => Date.parse(s) || 0;
      const cmp: Record<Tri, (a: ConvResume, b: ConvResume) => number> = {
        recentes: (a, b) => t(b.updated_at) - t(a.updated_at),
        anciennes: (a, b) => t(a.updated_at) - t(b.updated_at),
        creation: (a, b) => t(b.created_at) - t(a.created_at),
        echanges: (a, b) => (b.nb_messages ?? 0) - (a.nb_messages ?? 0) || t(b.updated_at) - t(a.updated_at),
        titre: (a, b) => a.titre.localeCompare(b.titre, "fr", { sensitivity: "base" }),
      };
      l = [...l].sort(cmp[reglages.tri]);
    }
    return l;
  }, [dansPeriode, reglages.theme, reglages.tri, enRecherche]);

  const epinglees = liste.filter((c) => epingles.includes(c.id));
  const autres = liste.filter((c) => !epingles.includes(c.id));
  const grouper = !enRecherche && (reglages.tri === "recentes" || reglages.tri === "anciennes");
  const groupes = grouper ? grouperParDate(autres) : null;

  const nbFiltres = (filtreAuteur ? 1 : 0) + (reglages.periode !== "tout" ? 1 : 0) + (reglages.theme ? 1 : 0);
  const reinitialiser = () => {
    onFiltreAuteur("");
    majReglages({ periode: "tout", theme: "" });
  };
  const themeActif = THEMES.find((t) => t.cle === reglages.theme);

  const membres: MembreEquipe[] = utilisateur
    ? [utilisateur, ...EQUIPE_JARDI.filter((m) => m !== utilisateur)]
    : [...EQUIPE_JARDI];

  const carte = (c: ConvResume) => (
    <Carte
      key={c.id}
      c={c}
      active={convId === c.id}
      epinglee={epingles.includes(c.id)}
      mots={mots}
      onOuvrir={onOuvrir}
      onSupprimer={onSupprimer}
      onRenommer={onRenommer}
      onEpingler={basculerEpingle}
    />
  );

  return (
    <div className="vjh">
      <div className="vjh-haut">
        <div className="vjh-ligne">
          <button type="button" className="v2-btn v2-btn-primaire vjh-nouveau" onClick={onNouvelle}>
            ＋ Nouvelle conversation
          </button>
          {onFermer && (
            <button type="button" className="v2-btn v2-btn-icone" onClick={onFermer} title="Fermer l'historique">
              ✕
            </button>
          )}
        </div>

        <div className="vjh-recherche">
          <span className="vjh-loupe">🔍</span>
          <input
            ref={rechercheRef}
            value={recherche}
            onChange={(e) => onRecherche(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onRecherche("");
            }}
            placeholder="Rechercher (client, article, mot…)"
            spellCheck={false}
          />
          {recherche ? (
            <button type="button" onClick={() => onRecherche("")} title="Effacer">
              ✕
            </button>
          ) : (
            <kbd title="Touche / pour chercher">/</kbd>
          )}
        </div>

        <div className="vjh-segment" role="tablist" aria-label="Source">
          {(
            [
              ["jardi", "💬 Jardi"],
              ["thunderai", "✉️ Thunderbird"],
              ["tous", "Tous"],
            ] as [FiltreSource, string][]
          ).map(([val, lib]) => (
            <button key={val} type="button" role="tab" aria-selected={source === val} className={source === val ? "actif" : undefined} onClick={() => onSource(val)}>
              {lib}
            </button>
          ))}
        </div>

        <div className="vjh-ligne">
          <label className="vjh-tri" title="Trier la liste">
            <span>⇅</span>
            <select value={reglages.tri} onChange={(e) => majReglages({ tri: e.target.value as Tri })}>
              {(Object.keys(LIB_TRI) as Tri[]).map((k) => (
                <option key={k} value={k}>
                  {LIB_TRI[k]}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className={"vjh-bouton-filtres" + (panneau || nbFiltres ? " on" : "")} onClick={() => setPanneau((o) => !o)} aria-expanded={panneau}>
            ⚙ Filtres{nbFiltres > 0 && <b>{nbFiltres}</b>}
            <span className="vjh-chevron">{panneau ? "▴" : "▾"}</span>
          </button>
        </div>

        {panneau && (
          <div className="vjh-panneau">
            <div className="vjh-p-titre">Personne</div>
            <div className="vjh-puces">
              <button type="button" className={"vjh-puce" + (filtreAuteur === "" ? " on" : "")} onClick={() => onFiltreAuteur("")}>
                Tous
              </button>
              {membres.map((m) => {
                const actif = filtreAuteur === m;
                const couleur = COULEURS_EQUIPE[m];
                return (
                  <button
                    key={m}
                    type="button"
                    className={"vjh-puce" + (actif ? " on" : "")}
                    onClick={() => onFiltreAuteur(actif ? "" : m)}
                    title={m === utilisateur ? `${m} (moi)` : m}
                    style={actif ? { background: couleur, borderColor: couleur, color: "#1f2125" } : { borderColor: couleur + "88" }}
                  >
                    <i style={{ background: couleur }} />
                    {m}
                    {m === utilisateur ? " (moi)" : ""}
                  </button>
                );
              })}
            </div>

            <div className="vjh-p-titre">Période</div>
            <div className="vjh-segment vjh-segment-petit">
              {(Object.keys(LIB_PERIODE) as Periode[]).map((p) => (
                <button key={p} type="button" className={reglages.periode === p ? "actif" : undefined} onClick={() => majReglages({ periode: p })}>
                  {LIB_PERIODE[p]}
                </button>
              ))}
            </div>

            <div className="vjh-p-titre">Thème — ce que Jardi a consulté</div>
            <div className="vjh-puces">
              {THEMES.map((t) => {
                const n = compteThemes[t.cle] ?? 0;
                const actif = reglages.theme === t.cle;
                return (
                  <button
                    key={t.cle}
                    type="button"
                    className={"vjh-puce" + (actif ? " on" : "") + (n === 0 && !actif ? " vide" : "")}
                    onClick={() => majReglages({ theme: actif ? "" : t.cle })}
                  >
                    {t.icone} {t.libelle} <small>{n}</small>
                  </button>
                );
              })}
            </div>
            {nbFiltres > 0 && (
              <button type="button" className="vjh-reinit" onClick={reinitialiser}>
                ↺ Réinitialiser les filtres
              </button>
            )}
          </div>
        )}

        {!panneau && nbFiltres > 0 && (
          <div className="vjh-actifs">
            {filtreAuteur && (
              <button type="button" onClick={() => onFiltreAuteur("")} title="Retirer ce filtre">
                <i style={{ background: couleurMembre(filtreAuteur) }} />
                {filtreAuteur} ✕
              </button>
            )}
            {reglages.periode !== "tout" && (
              <button type="button" onClick={() => majReglages({ periode: "tout" })} title="Retirer ce filtre">
                🗓 {LIB_PERIODE[reglages.periode]} ✕
              </button>
            )}
            {themeActif && (
              <button type="button" onClick={() => majReglages({ theme: "" })} title="Retirer ce filtre">
                {themeActif.icone} {themeActif.libelle} ✕
              </button>
            )}
          </div>
        )}
        <div className="vjh-compteur">
          {chargement && !conversations.length
            ? "Chargement…"
            : `${liste.length} conversation${liste.length > 1 ? "s" : ""}${liste.length !== conversations.length ? ` sur ${conversations.length}` : ""}${enRecherche ? " trouvée" + (liste.length > 1 ? "s" : "") : ""}`}
          {!grouper && !enRecherche && <span> · {LIB_TRI[reglages.tri].toLowerCase()}</span>}
        </div>
      </div>

      <div className="vjh-liste">
        {!chargement && liste.length === 0 && (
          <div className="vjh-vide">
            {enRecherche
              ? "Aucune conversation ne contient tous ces mots. Essaie un mot plus court."
              : nbFiltres > 0
              ? "Rien avec ces filtres."
              : source === "thunderai"
              ? "Aucun échange ThunderAI (conservation 60 jours)."
              : "Aucune conversation enregistrée."}
            {nbFiltres > 0 && (
              <button type="button" className="vjh-reinit" onClick={reinitialiser}>
                ↺ Réinitialiser les filtres
              </button>
            )}
            {filtreAuteur && source === "thunderai" && <div>Les échanges ThunderAI n&apos;ont pas d&apos;auteur : retire le filtre par personne.</div>}
          </div>
        )}
        {epinglees.length > 0 && (
          <div>
            <div className="vjh-groupe">📌 Épinglées</div>
            {epinglees.map(carte)}
          </div>
        )}
        {groupes
          ? groupes.map((g) => (
              <div key={g.titre}>
                <div className="vjh-groupe">
                  {g.titre} <small>{g.items.length}</small>
                </div>
                {g.items.map(carte)}
              </div>
            ))
          : autres.length > 0 && (
              <div>
                {epinglees.length > 0 && <div className="vjh-groupe">Autres</div>}
                {autres.map(carte)}
              </div>
            )}
      </div>
    </div>
  );
}
