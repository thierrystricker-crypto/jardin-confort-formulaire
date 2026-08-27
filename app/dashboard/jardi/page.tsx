// app/dashboard/jardi/page.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Chat Claude intégré au dashboard (13.08.2026). Usage interne uniquement.
//
// Composant client : fil de messages, streaming SSE depuis /api/claude/chat,
// rendu markdown minimal (liens cliquables tels quels — règles Jardi —, gras,
// code inline), historique des conversations (Supabase via
// /api/claude/conversations, 14.08.2026) dans une barre latérale.
// La page est protégée par proxy.ts comme le reste du dashboard.
//
// Refonte 27.08.2026 — l'historique est devenu central (mobile → bureau) :
// - pleine largeur (plus de plafond 1150 px), barre latérale 320 px, fil
//   jusqu'à 1500 px centré, bulles de réponse jusqu'à 96 % ;
// - historique riche : ./historique.tsx (aperçus, groupes par date, puces par
//   utilisateur, recherche serveur, renommage) ;
// - identité : ./utilisateur.tsx — prénom mémorisé par appareil, envoyé à la
//   sauvegarde (auteur) ET au chat (Jardi sait à qui il parle) ;
// - URL ?c=<id> : une conversation ouverte a une adresse, le bouton retour et
//   le partage de lien marchent ; « Reprendre » au démarrage.
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type React from "react";
import { preparerFichier } from "@/lib/preparer-fichier";
import type { MembreEquipe } from "@/lib/jardi-equipe";
import { BoutonLireAudio } from "./lecture-audio";
import {
  Avatar,
  Historique,
  apercuTexte,
  fmtDateRelative,
  type ConvResume,
} from "./historique";
import {
  ChoixUtilisateur,
  SelecteurUtilisateur,
  ecrireUtilisateur,
  lireUtilisateur,
} from "./utilisateur";

// Un fichier soumis au chat vit en MÉTADONNÉE, jamais en contenu : `content`
// reste une string partout — dans le state React comme dans
// `claude_conversations`. Les blocs de message ne sont fabriqués qu'à l'envoi
// (construireContenu). Aucun octet de fichier ne transite par le state : ce qui
// circule, c'est un `file_id` d'une trentaine de caractères.
type FichierJoint = {
  file_id: string;
  media_type: string;
  nom: string;
  taille?: number;
  uploadedAt: string;
  piece_id?: string;
};

type BlocEnvoye =
  | { type: "text"; text: string }
  | { type: "image" | "document"; source: { type: "file"; file_id: string } };

type MessageChat = { role: "user" | "assistant"; content: string | BlocEnvoye[] };
type MessageAffiche = {
  role: "user" | "assistant";
  content: string;
  outils?: string[];
  erreur?: boolean;
  fichiers?: FichierJoint[];
};

type EvenementStream = {
  type: string;
  content_block?: { type?: string; name?: string };
  delta?: { type?: string; text?: string; stop_reason?: string };
  error?: { message?: string };
};

// ── Dictée vocale (Web Speech API, Chrome/Edge) ─────────────────────────────
// Types minimaux : l'API n'est pas dans les définitions TypeScript standard.
type ResultatVocal = { isFinal: boolean; 0: { transcript: string } };
type EvenementVocal = { results: ArrayLike<ResultatVocal> };
type ReconnaissanceVocale = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: EvenementVocal) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};
type FenetreAvecVocal = {
  SpeechRecognition?: new () => ReconnaissanceVocale;
  webkitSpeechRecognition?: new () => ReconnaissanceVocale;
};

function constructeurVocal(): (new () => ReconnaissanceVocale) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as FenetreAvecVocal;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// ── Rendu markdown minimal ───────────────────────────────────────────────────
// Liens [texte](url), URLs nues, **gras**, `code`. Les retours à la ligne sont
// préservés par white-space: pre-wrap. Aucun lien n'est fabriqué ni modifié :
// on rend cliquable exactement ce que le texte contient.
const MOTIF_INLINE =
  /\[([^\]]+)\]\(([a-z][a-z0-9+.-]*:[^\s)]+)\)|(https?:\/\/[^\s<>"')]+)|\*\*([^*\n]+)\*\*|`([^`\n]+)`/g;

function renduInline(texte: string): React.ReactNode[] {
  const noeuds: React.ReactNode[] = [];
  let curseur = 0;
  let cle = 0;
  for (const m of texte.matchAll(MOTIF_INLINE)) {
    const debut = m.index ?? 0;
    if (debut > curseur) noeuds.push(texte.slice(curseur, debut));
    if (m[1] !== undefined && m[2] !== undefined) {
      // [texte](url)
      noeuds.push(
        <a
          key={`l${cle++}`}
          href={m[2]}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "#7dd3fc", textDecoration: "underline", wordBreak: "break-all" }}
        >
          {m[1]}
        </a>
      );
    } else if (m[3] !== undefined) {
      // URL nue — retirer la ponctuation finale du texte courant
      let url = m[3];
      let suite = "";
      while (url.length > 0 && ".,;:!?»".includes(url[url.length - 1])) {
        suite = url[url.length - 1] + suite;
        url = url.slice(0, -1);
      }
      // URL très longue (pièces jointes signées, etc.) : affichage tronqué,
      // le lien lui-même reste complet.
      const affichage = url.length > 60 ? url.slice(0, 57) + "…" : url;
      noeuds.push(
        <a
          key={`u${cle++}`}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          title={url}
          style={{ color: "#7dd3fc", textDecoration: "underline", wordBreak: "break-all" }}
        >
          {affichage}
        </a>
      );
      if (suite) noeuds.push(suite);
    } else if (m[4] !== undefined) {
      // Récursif, et non `{m[4]}` : l'alternance de MOTIF_INLINE retient ce qui
      // commence le plus à GAUCHE, donc `**[texte](url)**` fait matcher le gras
      // en premier — il avale le lien, qui s'affiche en markdown brut. Vu en
      // production le 18.08 sur un lien Thunderbird. Pas de récursion infinie :
      // `[^*\n]+` interdit déjà un `*` à l'intérieur du gras.
      noeuds.push(<strong key={`g${cle++}`}>{renduInline(m[4])}</strong>);
    } else if (m[5] !== undefined) {
      noeuds.push(
        <code
          key={`c${cle++}`}
          style={{
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: "0.92em",
            background: "rgba(255,255,255,0.12)",
            borderRadius: 4,
            padding: "1px 4px",
          }}
        >
          {m[5]}
        </code>
      );
    }
    curseur = debut + m[0].length;
  }
  if (curseur < texte.length) noeuds.push(texte.slice(curseur));
  return noeuds;
}

// ── Rendu par blocs : tableaux markdown + titres + texte ────────────────────
// Les tableaux `| a | b |` (avec ligne séparatrice `|---|`) deviennent de
// vrais <table> ; les lignes `## Titre` deviennent des titres ; le reste passe
// par renduInline (les retours à la ligne restent gérés par pre-wrap).
function decouperLigneTableau(l: string): string[] {
  let t = l.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|")) t = t.slice(0, -1);
  return t.split("|").map((c) => c.trim());
}

function renduContenu(texte: string): React.ReactNode[] {
  const lignes = texte.split("\n");
  const blocs: React.ReactNode[] = [];
  let tampon: string[] = [];
  let cle = 0;

  const estLigneTableau = (l: string) => /^\s*\|.*\|\s*$/.test(l);
  const estSeparateur = (l: string) =>
    /^\s*\|[\s:|-]+\|\s*$/.test(l) && l.includes("-");

  const viderTexte = () => {
    if (tampon.length) {
      blocs.push(<span key={`t${cle++}`}>{renduInline(tampon.join("\n"))}</span>);
      tampon = [];
    }
  };

  let i = 0;
  while (i < lignes.length) {
    const ligne = lignes[i];
    const titre = ligne.match(/^(#{1,4})\s+(.*)$/);

    if (
      estLigneTableau(ligne) &&
      i + 1 < lignes.length &&
      estSeparateur(lignes[i + 1])
    ) {
      viderTexte();
      const entete = decouperLigneTableau(ligne);
      i += 2;
      const corps: string[][] = [];
      while (i < lignes.length && estLigneTableau(lignes[i])) {
        corps.push(decouperLigneTableau(lignes[i]));
        i++;
      }
      blocs.push(
        <div key={`tab${cle++}`} style={{ overflowX: "auto", margin: "8px 0" }}>
          <table style={{ borderCollapse: "collapse", fontSize: 13, whiteSpace: "normal", minWidth: "60%" }}>
            <thead>
              <tr>
                {entete.map((c, j) => (
                  <th
                    key={j}
                    style={{
                      textAlign: "left",
                      padding: "6px 10px",
                      borderBottom: "1px solid rgba(255,255,255,0.18)",
                      color: "#a1a1aa",
                      fontWeight: 600,
                    }}
                  >
                    {renduInline(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {corps.map((rangee, j) => (
                <tr key={j} style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                  {rangee.map((c, k) => (
                    <td key={k} style={{ padding: "5px 10px", color: "#e4e4e7", verticalAlign: "top" }}>
                      {renduInline(c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    } else if (titre) {
      viderTexte();
      blocs.push(
        <div key={`h${cle++}`} style={{ fontWeight: 700, fontSize: 15, color: "#f4f4f5", margin: "8px 0 2px" }}>
          {renduInline(titre[2])}
        </div>
      );
      i++;
    } else {
      tampon.push(ligne);
      i++;
    }
  }
  viderTexte();
  return blocs;
}

// ── Copie sans mise en forme ────────────────────────────────────────────────
// Markdown → texte brut : gras/code nettoyés, liens en « texte : url »,
// tableaux en colonnes séparées par tabulations (collage propre dans
// Excel / Sheets / mail, sans emporter les couleurs du thème sombre).
function texteBrut(texte: string): string {
  const sortie: string[] = [];
  for (const ligne of texte.split("\n")) {
    // Ligne séparatrice de tableau |---|---| → ignorée
    if (/^\s*\|[\s:|-]+\|\s*$/.test(ligne) && ligne.includes("-")) continue;
    // Ligne de tableau → cellules séparées par tabulations
    if (/^\s*\|.*\|\s*$/.test(ligne)) {
      sortie.push(decouperLigneTableau(ligne).join("\t"));
      continue;
    }
    let l = ligne.replace(/^#{1,4}\s+/, "");
    l = l.replace(/\[([^\]]+)\]\(([a-z][a-z0-9+.-]*:[^\s)]+)\)/g, "$1 : $2");
    l = l.replace(/\*\*([^*\n]+)\*\*/g, "$1");
    l = l.replace(/`([^`\n]+)`/g, "$1");
    sortie.push(l);
  }
  return sortie.join("\n");
}

// ── Pièces jointes ──────────────────────────────────────────────────────────
// La préparation côté navigateur (redimensionnement 2000 px, EXIF, fond blanc,
// plafond 4 Mo) vit dans lib/preparer-fichier.ts depuis le chantier annexes
// (18.08.2026) — partagée avec la carte Annexes du dashboard.
const MAX_FICHIERS = 8;
// Durée de vie de la copie chez Anthropic (/api/cron/claude-files-purge).
// Au-delà, le `file_id` peut être mort : on l'exclut de l'historique envoyé
// plutôt que de laisser l'API répondre en erreur au milieu d'une conversation.
const TTL_FICHIER_MS = 24 * 3600 * 1000;

function estPerime(uploadedAt: string): boolean {
  const t = Date.parse(uploadedAt);
  return !Number.isFinite(t) || Date.now() - t > TTL_FICHIER_MS;
}

// Les blocs ne sont fabriqués QU'ICI, au moment de l'envoi — jamais stockés.
// Le document ou l'image passe AVANT le texte : c'est l'ordre attendu quand la
// consigne porte sur la pièce jointe.
const EPOQUE = "1970-01-01T00:00:00.000Z";

function construireContenu(texte: string, fichiers?: FichierJoint[]): string | BlocEnvoye[] {
  const joints = fichiers ?? [];
  const vivants = joints.filter((f) => !estPerime(f.uploadedAt));
  if (vivants.length === 0) {
    // ⚠️ Un message qui ne portait QUE des fichiers — la photo prise au comptoir,
    // sans un mot — deviendrait VIDE une fois la copie de travail purgée, et
    // serait retiré de l'historique. La réponse de Jardi, elle, resterait : deux
    // messages `assistant` d'affilée, et un modèle qui commente un document dont
    // l'énoncé a disparu. On garde le tour, avec ce qui reste vrai.
    if (!texte && joints.length > 0) {
      const noms = joints.map((f) => f.nom).join(", ");
      return joints.length > 1
        ? `[${joints.length} scans joints : ${noms} — copie de travail expirée, plus lisibles]`
        : `[Scan joint : ${noms} — copie de travail expirée, plus lisible]`;
    }
    return texte;
  }
  const blocs: BlocEnvoye[] = vivants.map((f) => ({
    type: f.media_type === "application/pdf" ? ("document" as const) : ("image" as const),
    source: { type: "file" as const, file_id: f.file_id },
  }));
  // Le modèle ne voit que les file_id (copies de travail Anthropic) : sans
  // cette ligne, il ne peut pas NOMMER les archives à rattacher au brouillon.
  // Les piece_id sont les lignes pieces_jointes, attendus par
  // offre_draft_creer (pieces_jointes_ids) et posés sur le DRA par
  // POST /api/drafts (chantier annexes, étape 5).
  const archives = vivants.filter((f) => f.piece_id);
  if (archives.length) {
    blocs.push({
      type: "text",
      text:
        "[Archives des fichiers joints — à la création d'un brouillon, passer ces identifiants à offre_draft_creer via pieces_jointes_ids : " +
        archives.map((f) => `${f.nom} → ${f.piece_id}`).join(" ; ") +
        "]",
    });
  }
  if (texte) blocs.push({ type: "text", text: texte });
  return blocs;
}

// Point de bascule mobile / bureau : sous cette largeur, l'historique est un
// volet superposé (et replié par défaut), au-dessus il est une colonne fixe.
const LARGEUR_MOBILE = 900;
const CLE_FILTRE_AUTEUR = "jardi-filtre-auteur";

function estMobile(): boolean {
  return typeof window !== "undefined" && window.innerWidth < LARGEUR_MOBILE;
}

// Indicateur d'activité — trois points orange qui pulsent (animation maison,
// dans l'esprit de claude.ai sans reprendre la marque d'Anthropic).
function PointsAnimes() {
  return (
    <span style={{ display: "inline-flex", gap: 3, alignItems: "center" }}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "#D97757",
            animation: `jcPulse 1.2s ease-in-out ${i * 0.18}s infinite`,
          }}
        />
      ))}
    </span>
  );
}

// Modèles de départ (20.08.2026) : un clic REMPLIT la zone de saisie avec un
// début de demande à compléter (curseur en fin de texte), il n'envoie rien —
// contrairement aux anciens exemples qui partaient tels quels. L'utilisateur
// complète puis Entrée.
const MODELES: { titre: string; texte: string }[] = [
  {
    titre: "🔎 Articles — prix, stock, liens",
    texte:
      "Recherche les articles suivants et indique pour chacun le prix, le stock et le lien article :\n- ",
  },
  {
    titre: "👤 Retrouver un client",
    texte:
      "Retrouve le client suivant dans la base (nom, société, ville, e-mail ou téléphone) et montre son dossier : ",
  },
  {
    titre: "📝 Brouillon d'offre",
    texte:
      "Crée un brouillon d'offre avec ces indications (client, articles + quantités, rabais et services éventuels) :\n",
  },
  {
    titre: "📬 Mails d'un expéditeur",
    texte: "Montre les mails de cette semaine de : ",
  },
  {
    titre: "✉️ Dernier mail",
    texte: "dernier mail ",
  },
  {
    titre: "📊 Stats de ventes",
    texte: "Stats de ventes de ",
  },
];

export default function PageChatClaude() {
  const [messages, setMessages] = useState<MessageAffiche[]>([]);
  const [saisie, setSaisie] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [conversations, setConversations] = useState<ConvResume[]>([]);
  const [chargementListe, setChargementListe] = useState(false);
  const [recentes, setRecentes] = useState<ConvResume[]>([]);
  const [recherche, setRecherche] = useState("");
  const [filtreAuteur, setFiltreAuteur] = useState("");
  const [convId, setConvId] = useState<string | null>(null);
  const [panneauOuvert, setPanneauOuvert] = useState(true);
  const [mobile, setMobile] = useState(false);
  const [utilisateur, setUtilisateur] = useState<MembreEquipe | null>(null);
  const [demanderUtilisateur, setDemanderUtilisateur] = useState(false);
  const [loinDuBas, setLoinDuBas] = useState(false);
  const [copieIndex, setCopieIndex] = useState<number | null>(null);
  const [dicteeDispo, setDicteeDispo] = useState(false);
  const [dicteeActive, setDicteeActive] = useState(false);
  const [fichiers, setFichiers] = useState<FichierJoint[]>([]);
  const [enUpload, setEnUpload] = useState(false);
  const [erreurFichier, setErreurFichier] = useState<string | null>(null);
  const [survolDepot, setSurvolDepot] = useState(false);
  const inputFichierRef = useRef<HTMLInputElement>(null);
  const verrouUploadRef = useRef(false);
  const vocalRef = useRef<ReconnaissanceVocale | null>(null);
  const baseSaisieRef = useRef("");
  const finRef = useRef<HTMLDivElement>(null);
  const filRef = useRef<HTMLDivElement>(null);
  const zoneRef = useRef<HTMLTextAreaElement>(null);
  const rechercheRef = useRef<HTMLInputElement>(null);
  const convIdRef = useRef<string | null>(null);
  convIdRef.current = convId;
  const utilisateurRef = useRef<MembreEquipe | null>(null);
  utilisateurRef.current = utilisateur;

  // Défilement automatique — SEULEMENT si on est déjà en bas. Quelqu'un qui
  // remonte relire un tableau pendant que Jardi écrit ne doit pas être ramené
  // de force en bas à chaque mot reçu.
  useEffect(() => {
    if (!loinDuBas) finRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  const surDefilement = () => {
    const fil = filRef.current;
    if (!fil) return;
    setLoinDuBas(fil.scrollHeight - fil.scrollTop - fil.clientHeight > 160);
  };

  const allerEnBas = () => {
    finRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    setLoinDuBas(false);
  };

  // ── Zone de saisie auto-extensible (20.08.2026) ────────────────────────────
  // La hauteur suit le contenu, plafonnée à 240 px (~10 lignes) puis défilement
  // interne. Effet sur `saisie` plutôt que onChange : la dictée vocale et le
  // vidage après envoi passent aussi par setSaisie, la hauteur suit donc dans
  // tous les cas (y compris le retour à 2 lignes après envoi).
  useEffect(() => {
    const zone = zoneRef.current;
    if (!zone) return;
    zone.style.height = "auto";
    zone.style.height = Math.min(zone.scrollHeight, 240) + "px";
  }, [saisie]);

  // ── Historique ─────────────────────────────────────────────────────────────
  // La liste dépend de la recherche et du filtre ; le serveur fait le tri
  // (RPC jardi_conversations_lister). Un compteur de requête écarte les
  // réponses arrivées dans le désordre quand on tape vite.
  const requeteListeRef = useRef(0);
  const chargerListe = useCallback(async (q: string, auteur: string) => {
    const n = ++requeteListeRef.current;
    setChargementListe(true);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (auteur) params.set("auteur", auteur);
      const res = await fetch(`/api/claude/conversations?${params.toString()}`);
      if (!res.ok || n !== requeteListeRef.current) return;
      const json = (await res.json()) as { conversations?: ConvResume[] };
      if (n === requeteListeRef.current) setConversations(json.conversations ?? []);
    } catch {
      /* liste indisponible — sans gravité */
    } finally {
      if (n === requeteListeRef.current) setChargementListe(false);
    }
  }, []);

  // Les 3 dernières conversations de la personne : la section « Reprendre »
  // de l'écran d'accueil — c'est là que le mobile → bureau se joue.
  const chargerRecentes = useCallback(async (nom: MembreEquipe | null) => {
    if (!nom) {
      setRecentes([]);
      return;
    }
    try {
      const res = await fetch(`/api/claude/conversations?auteur=${encodeURIComponent(nom)}&limite=3`);
      if (!res.ok) return;
      const json = (await res.json()) as { conversations?: ConvResume[] };
      setRecentes(json.conversations ?? []);
    } catch {
      /* sans gravité */
    }
  }, []);

  // Rechargement à chaque changement de recherche (léger délai) ou de filtre.
  useEffect(() => {
    const t = setTimeout(() => chargerListe(recherche, filtreAuteur), recherche ? 250 : 0);
    return () => clearTimeout(t);
  }, [recherche, filtreAuteur, chargerListe]);

  useEffect(() => {
    chargerRecentes(utilisateur);
  }, [utilisateur, chargerRecentes]);

  // Adresse de la conversation ouverte : ?c=<id>. replaceState plutôt que le
  // routeur Next : aucune navigation, aucun rechargement, juste une adresse
  // qu'on peut copier ou retrouver dans l'historique du navigateur.
  const majUrl = (id: string | null) => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("c", id);
    else url.searchParams.delete("c");
    window.history.replaceState(null, "", url.toString());
  };

  useEffect(() => {
    // Identité : mémorisée sur l'appareil, sinon on demande (bloquant, un clic).
    const u = lireUtilisateur();
    setUtilisateur(u);
    setDemanderUtilisateur(!u);
    // Filtre d'auteur mémorisé (« Tous » par défaut : l'historique est commun).
    try {
      setFiltreAuteur(localStorage.getItem(CLE_FILTRE_AUTEUR) ?? "");
    } catch {
      /* ignoré */
    }
    // Mobile : historique en volet superposé, replié par défaut.
    const m = estMobile();
    setMobile(m);
    if (m) setPanneauOuvert(false);
    const surRedim = () => setMobile(estMobile());
    window.addEventListener("resize", surRedim);
    // Conversation désignée dans l'adresse (lien collé, retour arrière, reprise).
    const idUrl = new URLSearchParams(window.location.search).get("c");
    if (idUrl) ouvrirConversation(idUrl);
    // Dictée : bouton affiché seulement si le navigateur la supporte (Chrome/Edge)
    setDicteeDispo(constructeurVocal() !== null);
    // ⚠️ Un fichier lâché À CÔTÉ de la zone de dépôt fait naviguer le navigateur
    // VERS ce fichier : la page du chat disparaît, avec la saisie en cours et la
    // conversation elle-même si aucune réponse n'a encore été sauvegardée. Le
    // vendeur vise naturellement le fil de messages, pas la bande du bas.
    const bloquerDepot = (e: DragEvent) => e.preventDefault();
    window.addEventListener("dragover", bloquerDepot);
    window.addEventListener("drop", bloquerDepot);
    // Ctrl+K (ou ⌘K) : la recherche de l'historique, comme partout ailleurs.
    const raccourci = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPanneauOuvert(true);
        setTimeout(() => rechercheRef.current?.focus(), 0);
      }
    };
    window.addEventListener("keydown", raccourci);
    return () => {
      window.removeEventListener("dragover", bloquerDepot);
      window.removeEventListener("drop", bloquerDepot);
      window.removeEventListener("resize", surRedim);
      window.removeEventListener("keydown", raccourci);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const choisirUtilisateur = (m: MembreEquipe) => {
    ecrireUtilisateur(m);
    setUtilisateur(m);
    setDemanderUtilisateur(false);
  };

  const changerFiltreAuteur = (a: string) => {
    setFiltreAuteur(a);
    try {
      localStorage.setItem(CLE_FILTRE_AUTEUR, a);
    } catch {
      /* ignoré */
    }
  };

  // ── Dictée vocale ──────────────────────────────────────────────────────────
  const basculerDictee = () => {
    if (dicteeActive) {
      vocalRef.current?.stop();
      return;
    }
    const Ctor = constructeurVocal();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = "fr-CH";
    rec.continuous = true;
    rec.interimResults = true;
    baseSaisieRef.current = saisie.trim() ? saisie.trimEnd() + " " : "";
    rec.onresult = (e) => {
      let definitif = "";
      let provisoire = "";
      for (let j = 0; j < e.results.length; j++) {
        const r = e.results[j];
        if (r.isFinal) definitif += r[0].transcript;
        else provisoire += r[0].transcript;
      }
      setSaisie(baseSaisieRef.current + definitif + provisoire);
    };
    rec.onend = () => setDicteeActive(false);
    rec.onerror = () => setDicteeActive(false);
    vocalRef.current = rec;
    rec.start();
    setDicteeActive(true);
  };

  // Sauvegarde automatique à la fin de chaque réponse (enCours true → false).
  useEffect(() => {
    if (enCours) return;
    const utiles = messages.filter(
      (m) =>
        !m.erreur &&
        (m.content || (m.outils && m.outils.length) || (m.fichiers && m.fichiers.length))
    );
    if (utiles.length < 2 || utiles[utiles.length - 1].role !== "assistant") return;
    (async () => {
      try {
        // L'auteur est le prénom choisi dans le sélecteur — plus le champ libre
        // « corrections-author » (qui donnait « thierry », « TS », « brice c »
        // ou rien du tout sur mobile).
        const auteur = utilisateurRef.current ?? undefined;
        const res = await fetch("/api/claude/conversations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id: convIdRef.current ?? undefined,
            auteur,
            messages: utiles.map(({ role, content, outils, fichiers: pj }) => ({
              role,
              content,
              ...(outils && outils.length ? { outils } : {}),
              ...(pj && pj.length ? { fichiers: pj } : {}),
            })),
          }),
        });
        const json = (await res.json().catch(() => null)) as { id?: string } | null;
        if (res.ok && json?.id) {
          if (!convIdRef.current) {
            setConvId(json.id);
            majUrl(json.id);
          }
          chargerListe(recherche, filtreAuteur);
          chargerRecentes(utilisateurRef.current);
        }
      } catch {
        /* sauvegarde silencieuse */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enCours]);

  const ouvrirConversation = async (id: string) => {
    if (enCours) return;
    try {
      const res = await fetch(`/api/claude/conversations?id=${encodeURIComponent(id)}`);
      if (!res.ok) {
        // Lien périmé (conversation supprimée) : on nettoie l'adresse.
        if (res.status === 404) majUrl(null);
        return;
      }
      const json = (await res.json()) as { conversation?: { messages?: MessageAffiche[] } };
      setMessages(Array.isArray(json.conversation?.messages) ? json.conversation.messages : []);
      setConvId(id);
      majUrl(id);
      setFichiers([]);
      setErreurFichier(null);
      setLoinDuBas(false);
      if (estMobile()) setPanneauOuvert(false);
    } catch {
      /* ignoré */
    }
  };

  const nouvelleConversation = () => {
    if (enCours) return;
    setMessages([]);
    setFichiers([]);
    setErreurFichier(null);
    setConvId(null);
    majUrl(null);
    if (estMobile()) setPanneauOuvert(false);
    zoneRef.current?.focus();
  };

  const supprimerConversation = async (id: string) => {
    if (!confirm("Supprimer cette conversation ?")) return;
    try {
      await fetch(`/api/claude/conversations?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    } catch {
      /* ignoré */
    }
    if (convIdRef.current === id) nouvelleConversation();
    chargerListe(recherche, filtreAuteur);
    chargerRecentes(utilisateurRef.current);
  };

  const renommerConversation = async (id: string, titre: string) => {
    try {
      const res = await fetch("/api/claude/conversations", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, titre }),
      });
      if (res.ok) {
        // Mise à jour locale immédiate, sans attendre le rechargement.
        setConversations((p) => p.map((c) => (c.id === id ? { ...c, titre } : c)));
        setRecentes((p) => p.map((c) => (c.id === id ? { ...c, titre } : c)));
      }
    } catch {
      /* ignoré */
    }
  };

  // ── Envoi et streaming ─────────────────────────────────────────────────────
  // Met à jour le dernier message (celui de l'assistant en cours de streaming).
  const majDernier = (fn: (m: MessageAffiche) => MessageAffiche) => {
    setMessages((prec) =>
      prec.map((m, i) => (i === prec.length - 1 ? fn(m) : m))
    );
  };

  // ── Pièces jointes ─────────────────────────────────────────────────────────
  // UN fichier par appel : le plafond de corps de Vercel (~4,5 Mo) porte sur la
  // requête entière, pas sur le fichier. Chaque échec est nommé — un envoi qui
  // disparaît sans un mot est pire qu'un refus.
  const ajouterFichiers = async (liste: FileList | File[]) => {
    // Garde en ref, pas en state : deux glissers rapprochés passeraient tous
    // deux `if (enUpload)` avant le rendu suivant, liraient le même
    // `fichiers.length`, et dépasseraient MAX_FICHIERS.
    if (enCours || verrouUploadRef.current) return;
    verrouUploadRef.current = true;
    setSurvolDepot(false);
    setErreurFichier(null);
    setEnUpload(true);
    const ajoutes: FichierJoint[] = [];
    const soucis: string[] = [];
    for (const brut of Array.from(liste)) {
      if (fichiers.length + ajoutes.length >= MAX_FICHIERS) {
        soucis.push(`maximum ${MAX_FICHIERS} fichiers par message`);
        break;
      }
      try {
        const pret = await preparerFichier(brut);
        const corps = new FormData();
        corps.append("file", pret);
        const res = await fetch("/api/claude/upload", { method: "POST", body: corps });
        const json = (await res.json().catch(() => null)) as {
          piece_id?: string;
          file_id?: string;
          media_type?: string;
          nom?: string;
          taille?: number;
          error?: string;
        } | null;
        if (!res.ok || !json?.file_id) {
          soucis.push(`${brut.name} : ${json?.error ?? "envoi refusé"}`);
          continue;
        }
        ajoutes.push({
          file_id: json.file_id,
          media_type: json.media_type ?? pret.type,
          nom: json.nom ?? pret.name,
          taille: json.taille,
          uploadedAt: new Date().toISOString(),
          piece_id: json.piece_id,
        });
      } catch (err) {
        soucis.push(`${brut.name} : ${(err as Error).message}`);
      }
    }
    // Plafond réappliqué dans la forme fonctionnelle : `p` est la valeur à jour.
    if (ajoutes.length) setFichiers((p) => [...p, ...ajoutes].slice(0, MAX_FICHIERS));
    if (soucis.length) setErreurFichier(soucis.join(" · "));
    setEnUpload(false);
    verrouUploadRef.current = false;
  };

  const surDepot = (e: React.DragEvent) => {
    e.preventDefault();
    setSurvolDepot(false);
    if (enCours || verrouUploadRef.current) return;
    if (e.dataTransfer?.files?.length) ajouterFichiers(e.dataTransfer.files);
  };

  // Un message peut n'être QUE des fichiers : la photo prise au comptoir, sans
  // un mot. C'est l'usage principal du chantier.
  const peutEnvoyer =
    !enCours && !enUpload && (Boolean(saisie.trim()) || fichiers.length > 0);

  const envoyer = async (texteForce?: string) => {
    const texte = (texteForce ?? saisie).trim();
    // Un exemple cliqué n'emporte pas les pièces jointes en attente.
    const joints = texteForce ? [] : fichiers;
    if ((!texte && joints.length === 0) || enCours || enUpload) return;
    if (dicteeActive) vocalRef.current?.stop();
    setSaisie("");
    if (!texteForce) setFichiers([]);
    setErreurFichier(null);

    // Historique envoyé au serveur (les erreurs affichées n'en font pas partie ;
    // la troncature fine est faite côté serveur). Les blocs ne sont construits
    // QU'ICI : `content` reste une string partout ailleurs — dans le state comme
    // dans `claude_conversations`.
    const historique: MessageChat[] = [
      ...messages
        .filter((m) => !m.erreur)
        .map((m) => ({ role: m.role, content: construireContenu(m.content, m.fichiers) }))
        // Un message dont le texte est vide ET dont tous les fichiers ont été
        // purgés n'a plus de contenu : l'API refuse un message vide.
        .filter((m) => m.content.length > 0),
      { role: "user", content: construireContenu(texte, joints) },
    ];

    setMessages((prec) => [
      ...prec,
      { role: "user", content: texte, ...(joints.length ? { fichiers: joints } : {}) },
      { role: "assistant", content: "", outils: [] },
    ]);
    setLoinDuBas(false);
    setEnCours(true);
    if (estMobile()) setPanneauOuvert(false);

    try {
      const reponse = await fetch("/api/claude/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // `utilisateur` : Jardi sait à qui il parle (bloc système non caché).
        body: JSON.stringify({ messages: historique, utilisateur: utilisateurRef.current }),
      });

      if (!reponse.ok || !reponse.body) {
        let detail = "Erreur inattendue. Réessaie dans un instant.";
        if (reponse.status === 401) {
          detail = "Session expirée — recharge la page pour saisir le code d'accès.";
        } else if (reponse.status === 502 && historique.some((m) => typeof m.content !== "string")) {
          // Un `file_id` mort fait répondre 400 en amont, et le message qui le
          // porte repartirait IDENTIQUE à chaque tentative : la conversation
          // serait bloquée jusqu'à « Nouvelle conversation ». On périme les
          // pièces jointes plutôt que de laisser boucler — le tour survit grâce
          // au texte de substitution de construireContenu().
          setMessages((prec) =>
            prec.map((m) =>
              m.fichiers?.length
                ? { ...m, fichiers: m.fichiers.map((f) => ({ ...f, uploadedAt: EPOQUE })) }
                : m
            )
          );
          detail =
            "Les scans joints ont peut-être expiré (24 h) : ils ont été retirés " +
            "de la conversation. Réessaie, ou joins-les à nouveau.";
        } else {
          try {
            const corps = (await reponse.json()) as { error?: string };
            if (corps.error) detail = corps.error;
          } catch {
            /* corps non JSON */
          }
        }
        majDernier((m) => ({ ...m, content: detail, erreur: true }));
        return;
      }

      const lecteur = reponse.body.getReader();
      const decodeur = new TextDecoder();
      let tampon = "";

      const traiter = (evt: EvenementStream) => {
        if (evt.type === "content_block_start" && evt.content_block) {
          if (evt.content_block.type === "mcp_tool_use" && evt.content_block.name) {
            const nom = evt.content_block.name;
            majDernier((m) => ({ ...m, outils: [...(m.outils ?? []), nom] }));
          } else if (evt.content_block.type === "thinking") {
            // La réflexion étendue est invisible sinon : l'écran reste vide
            // pendant des dizaines de secondes, et un flux qui meurt là
            // s'affichait « Réponse vide ». La puce « analyse » rend la phase
            // visible — sans exposer le contenu de la réflexion.
            majDernier((m) =>
              m.outils?.includes("analyse")
                ? m
                : { ...m, outils: [...(m.outils ?? []), "analyse"] }
            );
          } else if (evt.content_block.type === "text") {
            // Nouveau bloc de texte après un appel d'outil → saut de paragraphe.
            majDernier((m) =>
              m.content ? { ...m, content: m.content + "\n\n" } : m
            );
          }
        } else if (
          evt.type === "content_block_delta" &&
          evt.delta?.type === "text_delta" &&
          evt.delta.text
        ) {
          const morceau = evt.delta.text;
          majDernier((m) => ({ ...m, content: m.content + morceau }));
        } else if (
          evt.type === "message_delta" &&
          evt.delta?.stop_reason === "max_tokens"
        ) {
          // Le plafond de sortie est tombé en plein vol : le dire, plutôt que
          // de laisser une réponse tronquée passer pour complète — ou pour
          // vide si rien n'avait encore été émis.
          majDernier((m) => ({
            ...m,
            content:
              (m.content ? m.content + "\n\n" : "") +
              "⚠️ Réponse interrompue — limite de longueur atteinte. Écris « continue » pour reprendre.",
          }));
        } else if (evt.type === "error") {
          const msg = evt.error?.message ?? "Erreur du service Jardi.";
          majDernier((m) => ({
            ...m,
            content: m.content ? m.content + "\n\n⚠️ " + msg : "⚠️ " + msg,
            erreur: !m.content,
          }));
        }
      };

      for (;;) {
        const { done, value } = await lecteur.read();
        if (done) break;
        tampon += decodeur.decode(value, { stream: true });
        const blocs = tampon.split(/\r?\n\r?\n/);
        tampon = blocs.pop() ?? "";
        for (const bloc of blocs) {
          for (const ligne of bloc.split(/\r?\n/)) {
            if (!ligne.startsWith("data:")) continue;
            const brut = ligne.slice(5).trim();
            if (!brut) continue;
            try {
              traiter(JSON.parse(brut) as EvenementStream);
            } catch {
              /* fragment non JSON — ignoré */
            }
          }
        }
      }

      majDernier((m) =>
        m.content || (m.outils && m.outils.length)
          ? m
          : { ...m, content: "Réponse vide — réessaie.", erreur: true }
      );
    } catch {
      majDernier((m) => ({
        ...m,
        content: "Connexion interrompue. Réessaie dans un instant.",
        erreur: true,
      }));
    } finally {
      setEnCours(false);
      zoneRef.current?.focus();
    }
  };

  const copierMessage = async (i: number, contenu: string) => {
    try {
      await navigator.clipboard.writeText(texteBrut(contenu));
      setCopieIndex(i);
      setTimeout(() => setCopieIndex(null), 1500);
    } catch {
      /* presse-papiers indisponible */
    }
  };

  const surTouche = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      envoyer();
    }
  };

  return (
    // Fond sombre forcé, comme le dashboard principal (bg-[#1f2125]) — ne
    // dépend pas du thème clair/sombre du navigateur.
    <div style={{ background: "#1f2125", minHeight: "100dvh", color: "#ededed" }}>
      <style>{`
        @keyframes jcPulse {
          0%, 80%, 100% { opacity: 0.25; transform: scale(0.85); }
          40% { opacity: 1; transform: scale(1); }
        }
        @keyframes jcClignote {
          50% { opacity: 0; }
        }
        /* Mobile (24.08.2026) — la rangee de saisie mangeait la moitie de
           l'ecran en boutons et debordait a droite. Le champ prend toute la
           largeur, les boutons descendent d'une ligne. Le 16px du textarea
           n'est pas cosmetique : en dessous, iOS zoome tout seul au focus et
           casse la mise en page. */
        @media (max-width: 620px) {
          .jcColonne { padding: 10px 10px 10px !important; }
          .jcSaisie { flex-wrap: wrap; justify-content: flex-end; }
          .jcSaisie > textarea { flex: 1 1 100% !important; font-size: 16px !important; }
          .jcBulle { max-width: 96% !important; }
          .jcSousTitre { display: none; }
        }
        /* Pleine largeur (27.08.2026) : la barre latérale est une colonne
           fixe de 320 px au-dessus de 900 px, un volet superposé en dessous. */
        .jcLateral {
          width: 320px;
          flex-shrink: 0;
          border-right: 1px solid rgba(255,255,255,0.08);
          background: #1f2125;
          min-height: 0;
        }
        @media (max-width: 900px) {
          .jcLateral {
            position: fixed;
            inset: 0 auto 0 0;
            width: min(92vw, 380px);
            z-index: 40;
            box-shadow: 0 0 60px rgba(0,0,0,0.6);
          }
        }
        .jcFil { width: 100%; max-width: 1500px; margin: 0 auto; }
        .jcCarteReprise {
          flex: 1 1 280px;
          max-width: 420px;
          padding: 10px 12px;
          text-align: left;
          background: #2a2d31;
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 10px;
          cursor: pointer;
          color: #e4e4e7;
          font-family: inherit;
        }
        .jcCarteReprise:hover { border-color: rgba(56,189,248,0.45); }
      `}</style>
      <div style={{ display: "flex", height: "100dvh" }}>
        {/* Voile derrière le volet (mobile) */}
        {mobile && panneauOuvert && (
          <div
            onClick={() => setPanneauOuvert(false)}
            style={{ position: "fixed", inset: 0, zIndex: 39, background: "rgba(0,0,0,0.5)" }}
          />
        )}

        {/* Barre latérale — historique des conversations */}
        {panneauOuvert && (
          <div className="jcLateral">
            <Historique
              conversations={conversations}
              chargement={chargementListe}
              convId={convId}
              utilisateur={utilisateur}
              filtreAuteur={filtreAuteur}
              recherche={recherche}
              onFiltreAuteur={changerFiltreAuteur}
              onRecherche={setRecherche}
              onOuvrir={ouvrirConversation}
              onNouvelle={nouvelleConversation}
              onSupprimer={supprimerConversation}
              onRenommer={renommerConversation}
              onFermer={mobile ? () => setPanneauOuvert(false) : undefined}
              rechercheRef={rechercheRef}
            />
          </div>
        )}

        {/* Colonne principale */}
        <div
          className="jcColonne"
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            padding: "12px 20px 12px",
          }}
        >
          {/* En-tête — une seule ligne : historique, titre, retour, utilisateur */}
          <div
            style={{
              flexShrink: 0,
              paddingBottom: 8,
              borderBottom: "1px solid rgba(255,255,255,0.1)",
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <button
              onClick={() => setPanneauOuvert((o) => !o)}
              title="Historique des conversations (Ctrl+K pour chercher)"
              style={{
                background: panneauOuvert ? "rgba(255,255,255,0.08)" : "none",
                border: "1px solid rgba(255,255,255,0.15)",
                borderRadius: 8,
                color: "#a1a1aa",
                cursor: "pointer",
                padding: "3px 10px",
                fontSize: 15,
              }}
            >
              ☰
            </button>
            <h1 style={{ fontSize: 19, fontWeight: 800, color: "#f4f4f5", margin: 0 }}>
              💬 Jardi
            </h1>
            <p className="jcSousTitre" style={{ color: "#71717a", fontSize: 12, margin: 0, flex: 1, minWidth: 0 }}>
              Mails, clients, commandes, statistiques — lecture seule, brouillons
              à relire dans Thunderbird.
            </p>
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
              <Link
                href="/dashboard"
                style={{ color: "#7dd3fc", fontSize: 13, textDecoration: "none", whiteSpace: "nowrap" }}
              >
                ← Dashboard
              </Link>
              <SelecteurUtilisateur utilisateur={utilisateur} onChoix={choisirUtilisateur} />
            </div>
          </div>

          {/* Fil de messages */}
          <div
            ref={filRef}
            onScroll={surDefilement}
            style={{ flex: 1, overflowY: "auto", padding: "16px 4px", position: "relative" }}
          >
            <div className="jcFil">
            {messages.length === 0 && (
              <div style={{ color: "#a1a1aa", fontSize: 14, marginTop: 16 }}>
                {recentes.length > 0 && (
                  <div style={{ marginBottom: 22 }}>
                    <p style={{ marginBottom: 10, color: "#e4e4e7", fontWeight: 600 }}>
                      Reprendre{utilisateur ? `, ${utilisateur}` : ""} :
                    </p>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {recentes.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          className="jcCarteReprise"
                          onClick={() => ouvrirConversation(c.id)}
                        >
                          <span
                            style={{
                              display: "block",
                              fontSize: 13,
                              fontWeight: 600,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {c.titre}
                          </span>
                          <span
                            style={{
                              display: "block",
                              fontSize: 12,
                              color: "#a1a1aa",
                              marginTop: 3,
                              lineHeight: 1.35,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {apercuTexte(c.reponse, 140) || "—"}
                          </span>
                          <span
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 6,
                              fontSize: 11,
                              color: "#71717a",
                              marginTop: 6,
                            }}
                          >
                            <Avatar nom={c.auteur} taille={14} />
                            {fmtDateRelative(c.updated_at)} · {Math.ceil(c.nb_messages / 2)}{" "}
                            {c.nb_messages > 2 ? "échanges" : "échange"}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <p style={{ marginBottom: 12 }}>
                  Modèles pour démarrer — un clic remplit la zone de saisie, tu
                  complètes, puis Entrée :
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {MODELES.map((m) => (
                    <button
                      key={m.titre}
                      onClick={() => {
                        setSaisie(m.texte);
                        // Après le re-rendu : focus + curseur en fin de modèle,
                        // prêt à compléter.
                        setTimeout(() => {
                          const z = zoneRef.current;
                          if (z) {
                            z.focus();
                            z.setSelectionRange(z.value.length, z.value.length);
                          }
                        }, 0);
                      }}
                      style={{
                        flex: "1 1 260px",
                        maxWidth: 360,
                        padding: "10px 12px",
                        fontSize: 13,
                        color: "#7dd3fc",
                        background: "rgba(56,189,248,0.08)",
                        border: "1px solid rgba(56,189,248,0.25)",
                        borderRadius: 8,
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      <span style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>
                        {m.titre}
                      </span>
                      <span
                        style={{
                          display: "block",
                          color: "#a1a1aa",
                          fontSize: 12,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {m.texte.split("\n")[0]}…
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  justifyContent: m.role === "user" ? "flex-end" : "flex-start",
                  marginBottom: 12,
                }}
              >
                <div
                  className="jcBulle"
                  style={{
                    // Les réponses prennent (presque) toute la largeur : c'est
                    // là que vivent les tableaux. Les questions restent des
                    // bulles à droite.
                    maxWidth: m.role === "user" ? "78%" : "96%",
                    padding: m.role === "user" ? "10px 14px" : "12px 18px",
                    borderRadius: 14,
                    fontSize: 14,
                    lineHeight: 1.55,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    background: m.role === "user" ? "#2B8AD1" : m.erreur ? "rgba(244,63,94,0.12)" : "#2a2d31",
                    color: m.role === "user" ? "#fff" : m.erreur ? "#fda4af" : "#e4e4e7",
                    border: m.erreur
                      ? "1px solid rgba(244,63,94,0.35)"
                      : m.role === "assistant"
                      ? "1px solid rgba(255,255,255,0.06)"
                      : "none",
                  }}
                >
                  {m.outils && m.outils.length > 0 && (
                    <div style={{ fontSize: 12, color: "#9ca3af", fontStyle: "italic", marginBottom: m.content ? 6 : 0 }}>
                      🔧 {m.outils.join(" · ")}
                    </div>
                  )}
                  {m.role === "assistant" ? (
                    renduContenu(m.content)
                  ) : (
                    <>
                      {m.fichiers && m.fichiers.length > 0 && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: m.content ? 6 : 0 }}>
                          {m.fichiers.map((f) => {
                            const perime = estPerime(f.uploadedAt);
                            return (
                              <span
                                key={f.file_id}
                                title={perime ? "Scan effacé des serveurs Anthropic (24 h) — l'archive interne est conservée" : f.nom}
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 5,
                                  maxWidth: 220,
                                  padding: "3px 7px",
                                  fontSize: 12,
                                  borderRadius: 7,
                                  background: "rgba(255,255,255,0.14)",
                                  color: perime ? "rgba(255,255,255,0.55)" : "#fff",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {perime ? "🚫" : f.media_type === "application/pdf" ? "📄" : "🖼"} {f.nom}
                                {perime ? " (purgé)" : ""}
                              </span>
                            );
                          })}
                        </div>
                      )}
                      {m.content}
                    </>
                  )}
                  {m.role === "assistant" &&
                    enCours &&
                    i === messages.length - 1 &&
                    !m.erreur &&
                    (m.content ? (
                      // Streaming en cours → curseur clignotant
                      <span style={{ color: "#D97757", animation: "jcClignote 1s step-end infinite" }}>
                        {" "}▍
                      </span>
                    ) : (
                      // Rien encore reçu → Claude réfléchit / consulte un outil
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 8,
                          color: "#a1a1aa",
                          fontSize: 13,
                        }}
                      >
                        <PointsAnimes />
                        {m.outils && m.outils.length
                          ? `consulte ${m.outils[m.outils.length - 1]}…`
                          : "Jardi réfléchit…"}
                      </span>
                    ))}
                  {m.role === "assistant" &&
                    m.content &&
                    !m.erreur &&
                    !(enCours && i === messages.length - 1) && (
                      <div
                        style={{
                          marginTop: 6,
                          display: "flex",
                          justifyContent: "flex-end",
                          gap: 14,
                        }}
                      >
                        <BoutonLireAudio texte={m.content} />
                        <button
                          onClick={() => copierMessage(i, m.content)}
                          title="Copier le message (sans mise en forme)"
                          style={{
                            background: "none",
                            border: "none",
                            color: copieIndex === i ? "#4ade80" : "#71717a",
                            cursor: "pointer",
                            fontSize: 12,
                            padding: 0,
                          }}
                        >
                          {copieIndex === i ? "✓ copié" : "📋 copier"}
                        </button>
                      </div>
                    )}
                </div>
              </div>
            ))}
            <div ref={finRef} />
            </div>
          </div>

          {/* Retour en bas — n'apparaît que si on a remonté le fil */}
          {loinDuBas && messages.length > 0 && (
            <div style={{ position: "relative", height: 0, flexShrink: 0 }}>
              <button
                type="button"
                onClick={allerEnBas}
                title="Aller en bas"
                style={{
                  position: "absolute",
                  right: 16,
                  bottom: 10,
                  zIndex: 5,
                  width: 36,
                  height: 36,
                  borderRadius: "50%",
                  background: "#2a2d31",
                  border: "1px solid rgba(255,255,255,0.18)",
                  color: "#e4e4e7",
                  cursor: "pointer",
                  fontSize: 16,
                  boxShadow: "0 6px 20px rgba(0,0,0,0.4)",
                }}
              >
                ↓
              </button>
            </div>
          )}

          {/* Zone de saisie */}
          <div
            style={{ flexShrink: 0 }}
            onDragOver={(e) => {
              e.preventDefault();
              if (!enCours && !enUpload) setSurvolDepot(true);
            }}
            onDragLeave={() => setSurvolDepot(false)}
            onDrop={surDepot}
          >
            {(fichiers.length > 0 || enUpload || erreurFichier) && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8, alignItems: "center" }}>
                {fichiers.map((f) => (
                  <span
                    key={f.file_id}
                    title={f.taille ? `${f.nom} · ${Math.round(f.taille / 1024)} Ko` : f.nom}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      maxWidth: 240,
                      padding: "4px 8px",
                      fontSize: 12,
                      color: "#e4e4e7",
                      background: "#2a2d31",
                      border: "1px solid rgba(255,255,255,0.12)",
                      borderRadius: 8,
                    }}
                  >
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {f.media_type === "application/pdf" ? "📄" : "🖼"} {f.nom}
                    </span>
                    <button
                      onClick={() => setFichiers((p) => p.filter((x) => x.file_id !== f.file_id))}
                      disabled={enCours}
                      title="Retirer"
                      style={{ background: "none", border: "none", color: "#71717a", cursor: "pointer", fontSize: 12, padding: 0 }}
                    >
                      ✕
                    </button>
                  </span>
                ))}
                {enUpload && (
                  <span style={{ fontSize: 12, color: "#a1a1aa", display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <PointsAnimes /> préparation…
                  </span>
                )}
                {erreurFichier && (
                  <span style={{ fontSize: 12, color: "#fda4af" }}>⚠️ {erreurFichier}</span>
                )}
              </div>
            )}
          <div
            className="jcSaisie"
            style={{
              display: "flex",
              gap: 8,
              alignItems: "flex-end",
              outline: survolDepot ? "2px dashed rgba(56,189,248,0.6)" : "none",
              outlineOffset: 4,
              borderRadius: 10,
            }}
          >
            <textarea
              ref={zoneRef}
              value={saisie}
              onChange={(e) => setSaisie(e.target.value)}
              onKeyDown={surTouche}
              rows={2}
              placeholder="Écris à Jardi… (Entrée pour envoyer, Maj+Entrée pour une nouvelle ligne)"
              disabled={enCours}
              style={{
                flex: 1,
                minWidth: 0,
                resize: "none",
                // Hauteur pilotée par l'effet auto-extensible (plafond 240 px,
                // puis défilement interne).
                maxHeight: 240,
                overflowY: "auto",
                padding: "10px 12px",
                fontSize: 14,
                fontFamily: "inherit",
                border: "1px solid rgba(255,255,255,0.15)",
                borderRadius: 10,
                outline: "none",
                background: enCours ? "#26292d" : "#2a2d31",
                color: "#ededed",
              }}
            />
            <input
              ref={inputFichierRef}
              type="file"
              accept="image/*,application/pdf"
              multiple
              style={{ display: "none" }}
              onChange={(e) => {
                if (e.target.files) ajouterFichiers(e.target.files);
                // Remis a zero : sans ca, redeposer le MEME fichier ne declenche
                // aucun onChange et le vendeur croit que son clic n'a pas pris.
                e.target.value = "";
              }}
            />
            <button
              onClick={() => inputFichierRef.current?.click()}
              disabled={enCours || enUpload}
              title="Joindre une photo ou un PDF (scan de commande magasin)"
              style={{
                padding: "10px 12px",
                fontSize: 16,
                lineHeight: 1,
                background: "#2a2d31",
                color: enCours || enUpload ? "#52525b" : "#a1a1aa",
                border: "1px solid rgba(255,255,255,0.15)",
                borderRadius: 10,
                cursor: enCours || enUpload ? "default" : "pointer",
              }}
            >
              📎
            </button>
            {dicteeDispo && (
              <button
                onClick={basculerDictee}
                title={dicteeActive ? "Arrêter la dictée" : "Dicter au micro"}
                style={{
                  padding: "10px 12px",
                  fontSize: 16,
                  lineHeight: 1,
                  background: dicteeActive ? "rgba(244,63,94,0.15)" : "#2a2d31",
                  color: dicteeActive ? "#f87171" : "#a1a1aa",
                  border: dicteeActive
                    ? "1px solid rgba(244,63,94,0.4)"
                    : "1px solid rgba(255,255,255,0.15)",
                  borderRadius: 10,
                  cursor: "pointer",
                  animation: dicteeActive ? "jcClignote 1.2s ease-in-out infinite" : "none",
                }}
              >
                {dicteeActive ? "⏹" : "🎤"}
              </button>
            )}
            <button
              onClick={() => envoyer()}
              disabled={!peutEnvoyer}
              style={{
                padding: "10px 18px",
                fontSize: 14,
                fontWeight: 600,
                color: "#fff",
                background: peutEnvoyer ? "#2B8AD1" : "#3f4348",
                border: "none",
                borderRadius: 10,
                cursor: peutEnvoyer ? "pointer" : "default",
              }}
            >
              {enCours ? "…" : "Envoyer"}
            </button>
            </div>
          </div>
        </div>
      </div>
      {demanderUtilisateur && <ChoixUtilisateur onChoix={choisirUtilisateur} />}
    </div>
  );
}
