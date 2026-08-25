"use client";

// ── Lecture audio des réponses ──────────────────────────────────────────────
// Pendant de la dictée au micro : un bouton « écouter » sous chaque réponse.
// Jamais automatique — la lecture démarre au clic, ce qui satisfait au passage
// l'exigence iOS d'un geste utilisateur.
//
// Deux lecteurs derrière la même interface :
//   • voix AI (OpenAI tts) via /api/claude/voix — la clé reste côté serveur,
//     le navigateur ne parle qu'à notre propre domaine ;
//   • voix du navigateur (Web Speech API) — gratuite, sans réseau, utilisée
//     comme REPLI automatique si la route échoue (quota, panne, hors ligne).
// La ligne `const LECTEUR = ...` désigne le lecteur principal.

import { useEffect, useRef, useState } from "react";

// ── Markdown → texte écoutable ──────────────────────────────────────────────
// Volontairement plus agressif que `texteBrut` de page.tsx : la copie garde
// les URLs (« texte : url »), la voix doit les taire, sinon elle les épelle.
// Accessoirement, tout ce qui est retiré ici n'est pas facturé par le tts.
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

// Découpe en morceaux. Deux raisons, une par lecteur :
//   • voix navigateur : au-delà d'une quinzaine de secondes, Chrome interrompt
//     silencieusement une lecture d'un seul tenant ;
//   • voix AI : l'API speech plafonne l'entrée à 4096 caractères, et des
//     morceaux courts permettent de commencer à parler sans attendre que tout
//     le texte soit synthétisé.
function morceaux(texte: string, max: number): string[] {
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

// ── Interface commune aux deux lecteurs ─────────────────────────────────────
// `onDebut` est appelé quand le son sort vraiment : avec la voix AI il s'écoule
// une à deux secondes de synthèse avant, que le bouton signale par « … ».
export type Lecteur = {
  disponible: () => boolean;
  lire: (texte: string, onFin: () => void, onDebut?: () => void) => void;
  stop: () => void;
};

// ── Lecteur 1 : voix du navigateur ──────────────────────────────────────────
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

  lire(texte, onFin, onDebut) {
    const synth = window.speechSynthesis;
    synth.cancel();

    const voix = choisirVoix();
    const bouts = morceaux(texte, 220);
    let i = 0;
    onDebut?.();

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

// ── Lecteur 2 : voix AI (OpenAI tts via /api/claude/voix) ───────────────────
// La clé vit sur Vercel, pas ici : le navigateur ne connaît que notre route.
// Le morceau suivant est synthétisé PENDANT que le précédent se joue, sinon on
// entend un blanc de deux secondes à chaque coupure.
let audioCourant: HTMLAudioElement | null = null;
let annule = false;

// Confortablement sous le plafond de 4096 caractères de l'API.
const TAILLE_MORCEAU_API = 1200;

// Démarrage progressif. Un premier bloc de 1200 caractères, c'est près d'une
// minute d'audio à synthétiser avant le moindre son : cinq à six secondes de
// silence au clic. On commence donc très court — le temps de parler ces
// 250 caractères (une quinzaine de secondes), les blocs suivants, plus longs,
// sont déjà prêts. Le préchargement couvre la suite, pas le démarrage.
const PLAFONDS_DEBUT = [250, 600];

function morceauxProgressifs(texte: string): string[] {
  const fins = morceaux(texte, PLAFONDS_DEBUT[0]);
  const sortie: string[] = [];
  let i = 0;
  while (i < fins.length) {
    const plafond =
      sortie.length < PLAFONDS_DEBUT.length
        ? PLAFONDS_DEBUT[sortie.length]
        : TAILLE_MORCEAU_API;
    let bloc = fins[i++];
    while (i < fins.length && (bloc + " " + fins[i]).length <= plafond) {
      bloc += " " + fins[i++];
    }
    sortie.push(bloc);
  }
  return sortie;
}

async function synthetiser(texte: string): Promise<Blob | null> {
  try {
    const r = await fetch("/api/claude/voix", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texte }),
    });
    if (!r.ok) {
      console.error("[voix] /api/claude/voix a répondu", r.status);
      return null;
    }
    return await r.blob();
  } catch (e) {
    console.error("[voix] appel impossible", e);
    return null;
  }
}

const lecteurApi: Lecteur = {
  disponible: () => typeof window !== "undefined" && typeof Audio !== "undefined",

  lire(texte, onFin, onDebut) {
    annule = false;
    const bouts = morceauxProgressifs(texte);
    if (!bouts.length) {
      onFin();
      return;
    }

    let i = 0;
    let premierSonEmis = false;
    let enVol: Promise<Blob | null> | null = synthetiser(bouts[0]);

    // Repli : si la synthèse échoue (quota, panne, hors ligne), on termine la
    // lecture avec la voix du navigateur plutôt que de rester muet.
    const replier = (depuis: number) => {
      const reste = bouts.slice(depuis).join(" ");
      if (annule || !reste || !lecteurNavigateur.disponible()) {
        onFin();
        return;
      }
      console.warn("[voix] repli sur la voix du navigateur");
      lecteurNavigateur.lire(reste, onFin, premierSonEmis ? undefined : onDebut);
    };

    const jouer = async () => {
      if (annule) {
        onFin();
        return;
      }
      if (i >= bouts.length) {
        onFin();
        return;
      }

      const attendu = enVol;
      const indexJoue = i;
      i += 1;
      // Le morceau suivant part en synthèse pendant que celui-ci se joue.
      enVol = i < bouts.length ? synthetiser(bouts[i]) : null;

      const blob = attendu ? await attendu : null;
      if (annule) {
        onFin();
        return;
      }
      if (!blob) {
        replier(indexJoue);
        return;
      }

      const url = URL.createObjectURL(blob);
      const a = new Audio(url);
      audioCourant = a;
      a.onended = () => {
        URL.revokeObjectURL(url);
        void jouer();
      };
      a.onerror = () => {
        URL.revokeObjectURL(url);
        replier(indexJoue + 1);
      };
      try {
        await a.play();
        if (!premierSonEmis) {
          premierSonEmis = true;
          onDebut?.();
        }
      } catch {
        URL.revokeObjectURL(url);
        replier(indexJoue);
      }
    };

    void jouer();
  },

  stop() {
    annule = true;
    audioCourant?.pause();
    audioCourant = null;
    lecteurNavigateur.stop(); // coupe aussi un éventuel repli en cours
  },
};

// Lecteur principal. Repasser à `lecteurNavigateur` ici suffit à couper les
// frais OpenAI sans rien retirer d'autre.
const LECTEUR: Lecteur = lecteurApi;

// Une seule lecture à la fois dans la page : le bouton précédent est remis au
// repos quand un autre démarre.
let arreterCourant: (() => void) | null = null;

// ── Le bouton ───────────────────────────────────────────────────────────────
export function BoutonLireAudio({ texte }: { texte: string }) {
  const [etat, setEtat] = useState<"repos" | "attente" | "lecture">("repos");
  const [possible, setPossible] = useState(false);
  const monte = useRef(true);

  useEffect(() => {
    monte.current = true;
    setPossible(LECTEUR.disponible());
    // Sur Chrome la liste des voix arrive de façon asynchrone : on l'amorce
    // pour que le repli soit prêt s'il doit servir.
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.getVoices();
    }
    return () => {
      monte.current = false;
    };
  }, []);

  if (!possible) return null;

  const repos = () => {
    if (monte.current) setEtat("repos");
    if (arreterCourant === repos) arreterCourant = null;
  };

  const basculer = () => {
    if (etat !== "repos") {
      LECTEUR.stop();
      repos();
      return;
    }
    const propre = texteALire(texte);
    if (!propre) return;
    arreterCourant?.();
    arreterCourant = repos;
    setEtat("attente");
    LECTEUR.lire(propre, repos, () => {
      if (monte.current) setEtat("lecture");
    });
  };

  const libelle =
    etat === "lecture" ? "⏹ arrêter" : etat === "attente" ? "⏳ …" : "🔊 écouter";

  return (
    <button
      onClick={basculer}
      title={etat === "repos" ? "Écouter la réponse" : "Arrêter la lecture"}
      style={{
        background: "none",
        border: "none",
        color: etat === "repos" ? "#71717a" : "#D97757",
        cursor: "pointer",
        fontSize: 12,
        padding: 0,
      }}
    >
      {libelle}
    </button>
  );
}
