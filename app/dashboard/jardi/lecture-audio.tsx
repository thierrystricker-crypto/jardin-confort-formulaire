"use client";

// ── Lecture audio des réponses (Web Speech API) ─────────────────────────────
// Pendant de la dictée au micro : un bouton « écouter » sous chaque réponse.
// Jamais automatique — la lecture démarre au clic, ce qui satisfait au passage
// l'exigence iOS d'un geste utilisateur.
//
// Voix du navigateur : gratuite, aucune clé, aucune dépendance npm, aucun
// appel réseau. Pour passer plus tard à une voix API (tts d'OpenAI), écrire un
// second objet respectant le type `Lecteur` et changer la ligne
// `const LECTEUR = ...` — le bouton et le nettoyage du texte ne bougent pas.
// Le gabarit est en commentaire plus bas.

import { useEffect, useRef, useState } from "react";

// ── Markdown → texte écoutable ──────────────────────────────────────────────
// Volontairement plus agressif que `texteBrut` de page.tsx : la copie garde
// les URLs (« texte : url »), la voix doit les taire, sinon elle les épelle.
export function texteALire(markdown: string): string {
  let t = markdown;

  // Blocs de code : non lus.
  t = t.replace(/```[\s\S]*?```/g, " Bloc de code, à lire à l'écran. ");

  // Tableaux : non lus, on annonce seulement leur taille.
  t = t.replace(/(?:^[ \t]*\|.*\|[ \t]*$\n?)+/gm, (bloc) => {
    const lignes = bloc
      .trim()
      .split("\n")
      .filter((l) => !/^\s*\|[\s:|-]+\|\s*$/.test(l));
    const n = Math.max(lignes.length - 1, 0);
    return ` Tableau de ${n} ligne${n > 1 ? "s" : ""}, à lire à l'écran. `;
  });

  // Liens markdown : on garde le libellé, jamais l'URL.
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");

  // URLs nues et liens Thunderbird (mid:) : on ne les épelle pas.
  t = t.replace(/https?:\/\/\S+/g, " lien ");
  t = t.replace(/\bmid:\S+/g, " lien ");

  // Décorations markdown.
  t = t.replace(/^#{1,6}\s*/gm, "");
  t = t.replace(/\*\*([^*\n]+)\*\*/g, "$1");
  t = t.replace(/`([^`\n]+)`/g, "$1");
  t = t.replace(/^\s*[-•*]\s+/gm, "");
  t = t.replace(/^\s*\d+[.)]\s+/gm, "");

  // Emoji, pictogrammes et flèches : muets.
  t = t.replace(
    /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}]/gu,
    ""
  );

  return t.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

// Découpe en morceaux courts. Indispensable : au-delà d'une quinzaine de
// secondes, Chrome interrompt silencieusement une lecture d'un seul tenant.
function morceaux(texte: string, max = 220): string[] {
  const phrases = texte
    .replace(/([.!?…:])\s+/g, "$1\n")
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);

  const sortie: string[] = [];
  let courant = "";

  for (const p of phrases) {
    if (p.length > max) {
      if (courant) {
        sortie.push(courant);
        courant = "";
      }
      // Phrase très longue : on coupe aux virgules, puis en dur si besoin.
      let reste = p;
      while (reste.length > max) {
        const virgule = reste.lastIndexOf(",", max);
        const i = virgule > max / 2 ? virgule + 1 : max;
        sortie.push(reste.slice(0, i).trim());
        reste = reste.slice(i).trim();
      }
      if (reste) courant = reste;
    } else if ((courant + " " + p).trim().length <= max) {
      courant = (courant + " " + p).trim();
    } else {
      sortie.push(courant);
      courant = p;
    }
  }

  if (courant) sortie.push(courant);
  return sortie;
}

// ── Interface commune : navigateur aujourd'hui, API plus tard ───────────────
export type Lecteur = {
  disponible: () => boolean;
  lire: (texte: string, onFin: () => void) => void;
  stop: () => void;
};

function choisirVoix(): SpeechSynthesisVoice | null {
  const fr = window.speechSynthesis
    .getVoices()
    .filter((v) => v.lang.toLowerCase().startsWith("fr"));
  if (!fr.length) return null;

  const note = (v: SpeechSynthesisVoice) => {
    let n = 0;
    if (/natural|neural|premium|enhanced/i.test(v.name)) n += 4; // voix Windows récentes
    if (/google/i.test(v.name)) n += 3; // Chrome desktop
    const lang = v.lang.toLowerCase();
    if (lang === "fr-ch") n += 2;
    else if (lang === "fr-fr") n += 1;
    return n;
  };

  return [...fr].sort((a, b) => note(b) - note(a))[0];
}

const lecteurNavigateur: Lecteur = {
  disponible: () => typeof window !== "undefined" && "speechSynthesis" in window,

  lire(texte, onFin) {
    const synth = window.speechSynthesis;
    synth.cancel();

    const voix = choisirVoix();
    const bouts = morceaux(texte);
    let i = 0;

    const suivant = () => {
      if (i >= bouts.length) {
        onFin();
        return;
      }
      const u = new SpeechSynthesisUtterance(bouts[i++]);
      u.lang = voix?.lang || "fr-CH";
      if (voix) u.voice = voix;
      u.rate = 1.05;
      u.pitch = 1;
      u.onend = suivant;
      u.onerror = () => onFin();
      synth.speak(u);
    };

    suivant();
  },

  stop() {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  },
};

/*
 * Gabarit voix API, le jour où la voix du navigateur ne suffit plus.
 * Passe par une route serveur (app/api/claude/voix/route.ts) qui relaie le
 * texte vers le tts : la clé ne doit jamais partir côté client.
 * Puis : const LECTEUR: Lecteur = lecteurApi;
 *
 * let audioCourant: HTMLAudioElement | null = null;
 *
 * const lecteurApi: Lecteur = {
 *   disponible: () => true,
 *   lire(texte, onFin) {
 *     audioCourant?.pause();
 *     fetch("/api/claude/voix", {
 *       method: "POST",
 *       headers: { "Content-Type": "application/json" },
 *       body: JSON.stringify({ texte }),
 *     })
 *       .then((r) => r.blob())
 *       .then((b) => {
 *         audioCourant = new Audio(URL.createObjectURL(b));
 *         audioCourant.onended = onFin;
 *         void audioCourant.play();
 *       })
 *       .catch(onFin);
 *   },
 *   stop() {
 *     audioCourant?.pause();
 *     audioCourant = null;
 *   },
 * };
 */

const LECTEUR: Lecteur = lecteurNavigateur;

// Une seule lecture à la fois dans la page : le bouton précédent est remis au
// repos quand un autre démarre.
let arreterCourant: (() => void) | null = null;

// ── Le bouton ───────────────────────────────────────────────────────────────
export function BoutonLireAudio({ texte }: { texte: string }) {
  const [enLecture, setEnLecture] = useState(false);
  const [possible, setPossible] = useState(false);
  const monte = useRef(true);

  useEffect(() => {
    monte.current = true;
    setPossible(LECTEUR.disponible());
    // Sur Chrome la liste des voix arrive de façon asynchrone : on l'amorce.
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.getVoices();
    }
    return () => {
      monte.current = false;
    };
  }, []);

  if (!possible) return null;

  const repos = () => {
    if (monte.current) setEnLecture(false);
    if (arreterCourant === repos) arreterCourant = null;
  };

  const basculer = () => {
    if (enLecture) {
      LECTEUR.stop();
      repos();
      return;
    }
    const propre = texteALire(texte);
    if (!propre) return;
    arreterCourant?.();
    arreterCourant = repos;
    setEnLecture(true);
    LECTEUR.lire(propre, repos);
  };

  return (
    <button
      onClick={basculer}
      title={enLecture ? "Arrêter la lecture" : "Écouter la réponse"}
      style={{
        background: "none",
        border: "none",
        color: enLecture ? "#D97757" : "#71717a",
        cursor: "pointer",
        fontSize: 12,
        padding: 0,
      }}
    >
      {enLecture ? "⏹ arrêter" : "🔊 écouter"}
    </button>
  );
}
