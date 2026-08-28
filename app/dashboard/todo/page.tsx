"use client";
// app/dashboard/todo/page.tsx
// Page « To-do du jour » — consomme /api/todo.
// Spec : claude/chantier-todo-digest.md
//
// Principes tenus ici :
//  - une section vide s'affiche « à jour », elle n'est JAMAIS masquée :
//    l'absence est une information ;
//  - chaque section montre son PÉRIMÈTRE (ce qu'elle a regardé) ;
//  - une section bornée le dit dans son compteur (« 10 sur 158 »).

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type Ligne = {
  id: string;
  titre: string;
  detail: string;
  url: string | null;
  badge: string | null;
  apercu?: string | null;
  mail?: { boite: string; dossier: string; uid: number };
  // Conseillers en destinataire ou en copie, quand le mail leur est adressé
  // nommément. Purement indicatif : on n'en trie rien.
  pour?: string[];
};

// Longueur affichée tant que la ligne n'est pas dépliée. Au-delà, le bouton
// « ▾ plus » montre tout ce que l'index a gardé (jusqu'à 1200 caractères).
const APERCU_COURT = 160;

// Demande envoyée à Jardi par le bouton « Préparer une réponse ». Elle nomme
// le message par sa boîte/dossier/UID et rappelle la règle : Jardi propose,
// il ne dépose le brouillon qu'après validation. Aucun envoi n'est possible.
function questionBrouillon(
  m: { boite: string; dossier: string; uid: number },
  direction?: string
) {
  const base = `Prépare une proposition de réponse à ce mail : boîte ${m.boite}, dossier ${m.dossier}, UID ${m.uid}. Lis-le d'abord avec mail_lire, puis rédige la réponse selon les règles Jardi. Ne dépose le brouillon qu'après ma validation.`;
  const d = (direction || "").trim();
  // La direction passe APRÈS la consigne et est annoncée comme prioritaire :
  // c'est elle qui doit décider du fond de la réponse, pas Jardi tout seul.
  return d ? `${base}\n\nDirection à suivre, elle prime sur ton interprétation du mail : ${d}` : base;
}
type Section = {
  cle: string;
  titre: string;
  compteur: number;
  total: number;
  borne: boolean;
  perimetre: string;
  lignes: Ligne[];
  // Renseigné quand la section n'a pas pu être calculée (connecteur mail
  // injoignable, par exemple). On ne dit JAMAIS « à jour » dans ce cas.
  indisponible?: string | null;
};
type Reponse = {
  genere_le: string;
  total_a_traiter: number;
  sections: Section[];
};

// Ouvertes d'emblée : le mail, c'est le gros du travail quotidien. Le reste
// est replié — voir quatre listes déployées d'un coup décourage avant d'avoir
// commencé (retour de Thierry, 28.08).
const SECTIONS_OUVERTES = ["mails_non_lus", "sav", "formulaires"];

const STYLES: Record<string, { icone: string; badge: string; accent: string }> = {
  mails_non_lus:            { icone: "✉️", badge: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30", accent: "border-indigo-500/30" },
  sav:                      { icone: "🛠", badge: "bg-orange-500/15 text-orange-300 border-orange-500/30", accent: "border-orange-500/30" },
  formulaires:              { icone: "📝", badge: "bg-teal-500/15 text-teal-300 border-teal-500/30",       accent: "border-teal-500/30" },
  retards:                  { icone: "🔴", badge: "bg-rose-500/15 text-rose-300 border-rose-500/30",     accent: "border-rose-500/30" },
  echeances_proches:        { icone: "⏱",  badge: "bg-amber-500/15 text-amber-300 border-amber-500/30",  accent: "border-amber-500/25" },
  confirmations_manquantes: { icone: "❓", badge: "bg-amber-500/15 text-amber-300 border-amber-500/30",  accent: "border-amber-500/25" },
  offres_a_relancer:        { icone: "💰", badge: "bg-sky-500/15 text-sky-300 border-sky-500/30",        accent: "border-sky-500/25" },
};
const DEFAUT = { icone: "•", badge: "bg-white/5 text-zinc-300 border-white/10", accent: "border-white/10" };

function fmtHeure(iso: string) {
  return new Date(iso).toLocaleString("fr-CH", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export default function TodoPage() {
  const [data, setData] = useState<Reponse | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [chargement, setChargement] = useState(true);
  const [replies, setReplies] = useState<Record<string, boolean>>({});
  const [deplies, setDeplies] = useState<Record<string, boolean>>({});
  // Panneau « direction » ouvert, et texte saisi, par ligne.
  const [consignes, setConsignes] = useState<Record<string, boolean>>({});
  const [directions, setDirections] = useState<Record<string, string>>({});

  const charger = useCallback(async () => {
    try {
      const res = await fetch("/api/todo");
      const json = await res.json();
      if (!res.ok) { setErreur(json.error || `Erreur ${res.status}`); return; }
      setErreur(null);
      setData(json as Reponse);
    } catch (e) {
      setErreur(String(e));
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => { charger(); }, [charger]);

  // Les sections mail sont lues EN DIRECT sur IMAP à chaque appel — il n'y a
  // aucun cache et aucun cron de 3 h là-dedans (le cron ne sert qu'à l'aperçu).
  // Si une ligne persiste après avoir répondu dans Thunderbird, c'est
  // simplement que la page n'a pas été rechargée. On rafraîchit donc au retour
  // sur l'onglet — le geste naturel quand on revient de Thunderbird — et
  // toutes les 5 minutes tant qu'il reste visible.
  useEffect(() => {
    const auRetour = () => { if (document.visibilityState === "visible") charger(); };
    document.addEventListener("visibilitychange", auRetour);
    window.addEventListener("focus", auRetour);
    const minuterie = setInterval(auRetour, 5 * 60 * 1000);
    return () => {
      document.removeEventListener("visibilitychange", auRetour);
      window.removeEventListener("focus", auRetour);
      clearInterval(minuterie);
    };
  }, [charger]);

  const sections = data?.sections || [];

  return (
    <main className="min-h-screen bg-[#1f2125] px-6 py-8 text-zinc-100">
      <div className="mx-auto max-w-[1200px] space-y-6">

        {/* HEADER */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="inline-flex items-center rounded-xl border border-white/10 bg-[#34383d] px-4 py-2 text-sm text-zinc-100 transition hover:bg-[#40454b]">← Dashboard</Link>
            <h1 className="flex items-center gap-3 text-2xl font-semibold">
              ☑️ To-do du jour
              {data && data.total_a_traiter > 0 && (
                <span className="inline-flex items-center justify-center rounded-full border border-sky-500/40 bg-sky-500/20 px-3 py-0.5 text-sm font-bold text-sky-300">
                  {data.total_a_traiter} à traiter
                </span>
              )}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            {data && <span className="text-xs text-zinc-500">au {fmtHeure(data.genere_le)}</span>}
            <button onClick={() => { setChargement(true); charger(); }}
              className="rounded-xl border border-white/10 bg-[#34383d] px-4 py-2 text-sm text-zinc-100 transition hover:bg-[#40454b] disabled:opacity-50"
              disabled={chargement}>
              ↻ Rafraîchir
            </button>
          </div>
        </div>

        {/* RÉSUMÉ */}
        {sections.length > 0 && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
            {sections.map(s => {
              const st = STYLES[s.cle] || DEFAUT;
              return (
                <a key={s.cle} href={`#${s.cle}`}
                  className={`rounded-2xl border bg-[#2a2d31] p-4 transition hover:bg-[#31353a] ${s.compteur > 0 ? st.accent : "border-white/10"}`}>
                  <div className="text-xs uppercase tracking-wide text-zinc-500">{st.icone} {s.titre}</div>
                  <div className={`mt-1 text-2xl font-semibold ${
                    s.indisponible ? "text-amber-300" : s.compteur > 0 ? "text-zinc-100" : "text-zinc-500"}`}>
                    {s.indisponible ? "?" : s.borne ? `${s.compteur} / ${s.total}` : s.total}
                  </div>
                </a>
              );
            })}
          </div>
        )}

        {/* ERREUR */}
        {erreur && (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-5 text-sm text-rose-200">
            Impossible de charger la to-do : {erreur}
          </div>
        )}

        {/* CHARGEMENT */}
        {chargement && !data && (
          <div className="rounded-2xl border border-white/10 bg-[#2a2d31] p-12 text-center text-zinc-400">Chargement…</div>
        )}

        {/* SECTIONS */}
        {sections.map(s => {
          const st = STYLES[s.cle] || DEFAUT;
          const replie = replies[s.cle] ?? !SECTIONS_OUVERTES.includes(s.cle);
          return (
            <section key={s.cle} id={s.cle}
              className={`rounded-2xl border bg-[#2a2d31] ${s.compteur > 0 ? st.accent : "border-white/10"}`}>
              <button
                onClick={() => setReplies(r => ({ ...r, [s.cle]: !replie }))}
                className="flex w-full items-start justify-between gap-4 px-6 py-5 text-left">
                <div>
                  <div className="flex items-center gap-3 text-lg font-semibold">
                    <span className="text-xl">{st.icone}</span>
                    <span>{s.titre}</span>
                    <span className={`inline-flex items-center rounded-full border px-3 py-0.5 text-xs font-bold ${
                      s.indisponible ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                      : s.compteur > 0 ? st.badge
                      : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"}`}>
                      {s.indisponible ? "indisponible" : s.compteur === 0 ? "à jour" : s.borne ? `${s.compteur} affichées sur ${s.total}` : s.total}
                    </span>
                  </div>
                  {/* Le périmètre, toujours visible : un compteur sans son périmètre
                      se lit comme un inventaire. */}
                  <div className="mt-2 max-w-3xl text-xs leading-relaxed text-zinc-500">{s.perimetre}</div>
                </div>
                <span className="mt-1 flex-shrink-0 text-zinc-500">{replie ? "▸" : "▾"}</span>
              </button>

              {!replie && (
                s.indisponible ? (
                  <div className="px-6 pb-6 text-sm text-amber-300/90">
                    Section non calculée : {s.indisponible}. Ce n&apos;est PAS « rien à traiter » — on ne sait pas.
                  </div>
                ) : s.lignes.length === 0 ? (
                  <div className="px-6 pb-6 text-sm text-zinc-500">Rien à traiter ici — c&apos;est à jour.</div>
                ) : (
                  <ul className="border-t border-white/5 pb-2">
                    {s.lignes.map(l => {
                      const ouvert = deplies[l.id] ?? false;
                      const long = (l.apercu?.length ?? 0) > APERCU_COURT;
                      const contenu = (
                        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                          <div className="min-w-0">
                            <div className="truncate font-medium text-zinc-100">{l.titre}</div>
                            <div className="truncate text-xs text-zinc-400">{l.detail}</div>
                          </div>
                          <div className="flex flex-shrink-0 items-center gap-2">
                            {l.pour?.map(p => (
                              <span key={p} className="inline-flex items-center rounded-full border border-violet-500/30 bg-violet-500/15 px-2.5 py-0.5 text-xs font-medium text-violet-300"
                                title="Ce message lui est adressé nommément (destinataire ou copie)">
                                {p}
                              </span>
                            ))}
                            {l.badge && (
                              <span className={`inline-flex items-center rounded-full border px-3 py-0.5 text-xs font-medium ${st.badge}`}>
                                {l.badge}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                      const consigneOuverte = consignes[l.id] ?? false;
                      return (
                        // Chaque mail est une carte à part : la fine ligne de
                        // séparation ne suffisait plus une fois l'aperçu et les
                        // boutons ajoutés (retour de Thierry, 28.08).
                        <li key={l.id} className="mx-3 my-2 rounded-xl border border-white/10 bg-[#31353a]/50 p-4 transition hover:border-white/20">
                          {l.url ? <Link href={l.url} className="block" target={l.url.startsWith("http") ? "_blank" : undefined}>{contenu}</Link> : contenu}

                          {l.apercu && (
                            <div className={`mt-3 rounded-lg bg-black/25 px-3 py-2 text-xs leading-relaxed text-zinc-400 ${ouvert ? "whitespace-pre-line" : ""}`}>
                              {ouvert ? l.apercu : l.apercu.slice(0, APERCU_COURT) + (long ? "…" : "")}
                            </div>
                          )}

                          {(l.mail || long) && (
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              {long && (
                                <button
                                  onClick={() => setDeplies(d => ({ ...d, [l.id]: !ouvert }))}
                                  className="rounded-lg border border-white/10 bg-[#34383d] px-3 py-1 text-xs text-zinc-300 transition hover:bg-[#40454b]">
                                  {ouvert ? "▴ moins" : "▾ plus"}
                                </button>
                              )}
                              {l.mail && (
                                <button
                                  onClick={() => setConsignes(c => ({ ...c, [l.id]: !consigneOuverte }))}
                                  className="rounded-lg border border-sky-500/30 bg-sky-500/15 px-3 py-1 text-xs text-sky-300 transition hover:bg-sky-500/25">
                                  ✍️ Préparer une réponse avec Jardi
                                </button>
                              )}
                              {l.url && (
                                <a href={l.url} target="_blank" rel="noopener noreferrer"
                                  className="rounded-lg border border-white/10 bg-[#34383d] px-3 py-1 text-xs text-zinc-300 transition hover:bg-[#40454b]">
                                  📧 Ouvrir dans Thunderbird
                                </a>
                              )}
                            </div>
                          )}

                          {/* Direction donnée AVANT que Jardi ne réfléchisse :
                              une réponse préparée sans consigne part souvent
                              dans la mauvaise direction, et on la jette. */}
                          {l.mail && consigneOuverte && (
                            <div className="mt-3 rounded-lg border border-sky-500/20 bg-sky-500/5 p-3">
                              <label className="block text-xs text-zinc-400" htmlFor={`dir-${l.id}`}>
                                Une direction pour Jardi — facultatif, mais elle prime sur son interprétation du mail.
                              </label>
                              <textarea
                                id={`dir-${l.id}`}
                                value={directions[l.id] ?? ""}
                                onChange={e => setDirections(d => ({ ...d, [l.id]: e.target.value }))}
                                rows={2}
                                placeholder="ex. : article en rupture jusqu'en octobre, propose le modèle gris en remplacement"
                                className="mt-2 w-full resize-y rounded-lg border border-white/10 bg-[#1f2125] px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-sky-500/40 focus:outline-none"
                              />
                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                <Link
                                  href={`/dashboard/jardi?q=${encodeURIComponent(questionBrouillon(l.mail, directions[l.id]))}`}
                                  target="_blank" rel="noopener noreferrer"
                                  className="rounded-lg border border-sky-500/40 bg-sky-500/20 px-3 py-1 text-xs font-medium text-sky-200 transition hover:bg-sky-500/30">
                                  Envoyer à Jardi →
                                </Link>
                                <span className="text-xs text-zinc-500">
                                  Laisse vide pour le laisser décider. Jardi propose, il ne dépose le brouillon qu&apos;après ta validation.
                                </span>
                              </div>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )
              )}
            </section>
          );
        })}

      </div>
    </main>
  );
}
