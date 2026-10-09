// app/v2/jardi/page.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Dashboard 2.0 — le chat Jardi dans la coquille v2 (10.10.2026).
//
// Copie RESTYLÉE de app/dashboard/jardi/page.tsx : toute la logique est reprise
// telle quelle (streaming SSE, pièces jointes + TTL 24 h, dictée, sauvegarde
// automatique, ?c= / ?s= / ?q= / ?source=, échanges ThunderAI en lecture,
// identité par appareil, panneau d'utilisation). Seuls changent :
//   - le design : jetons v2 (mode clair ET sombre), en-tête de conversation,
//     réponses sans bulle avec avatar Jardi, tableaux lisibles, zone de saisie
//     en carte avec barre d'outils, accueil avec modèles en cartes ;
//   - l'historique : ./historique-v2.tsx (tri, période, thèmes, épingles) ;
//   - des actions en plus : copier le lien de la conversation, l'exporter en
//     texte (.md), reprendre une question dans la zone de saisie ;
//   - la touche « / » ouvre la recherche de l'historique (Ctrl+K reste la
//     recherche globale de la v2).
// La page v1 /dashboard/jardi n'est PAS modifiée : même API, même base.
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import "./jardi.css";
import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";
import { preparerFichier } from "@/lib/preparer-fichier";
import { EQUIPE_JARDI, type MembreEquipe } from "@/lib/jardi-equipe";
import { BoutonLireAudio } from "../../dashboard/jardi/lecture-audio";
import {
  Avatar,
  apercuTexte,
  couleurMembre,
  fmtDateRelative,
  type ConvResume,
  type FiltreSource,
  type SourceConv,
} from "../../dashboard/jardi/historique";
import { PanneauUsage } from "../../dashboard/jardi/usage";
import { ChoixUtilisateur, ecrireUtilisateur, lireUtilisateur } from "../../dashboard/jardi/utilisateur";
import { HistoriqueV2 } from "./historique-v2";
import { libelleOutil, themeDe } from "./outils";

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
// on rend cliquable exactement ce que le texte contient. (Même logique que la
// v1 ; seule la mise en forme passe par les classes de jardi.css.)
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
      noeuds.push(
        <a key={`l${cle++}`} href={m[2]} target="_blank" rel="noopener noreferrer" className="vj-lien">
          {m[1]}
        </a>
      );
    } else if (m[3] !== undefined) {
      let url = m[3];
      let suite = "";
      while (url.length > 0 && ".,;:!?»".includes(url[url.length - 1])) {
        suite = url[url.length - 1] + suite;
        url = url.slice(0, -1);
      }
      const affichage = url.length > 60 ? url.slice(0, 57) + "…" : url;
      noeuds.push(
        <a key={`u${cle++}`} href={url} target="_blank" rel="noopener noreferrer" title={url} className="vj-lien">
          {affichage}
        </a>
      );
      if (suite) noeuds.push(suite);
    } else if (m[4] !== undefined) {
      // Récursif : `**[texte](url)**` doit garder son lien (cf. v1, 18.08).
      noeuds.push(<strong key={`g${cle++}`}>{renduInline(m[4])}</strong>);
    } else if (m[5] !== undefined) {
      noeuds.push(
        <code key={`c${cle++}`} className="vj-code">
          {m[5]}
        </code>
      );
    }
    curseur = debut + m[0].length;
  }
  if (curseur < texte.length) noeuds.push(texte.slice(curseur));
  return noeuds;
}

function decouperLigneTableau(l: string): string[] {
  let t = l.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|")) t = t.slice(0, -1);
  return t.split("|").map((c) => c.trim());
}

// Tableau → texte tabulé (collage propre dans Excel / mail).
function tableauEnTexte(entete: string[], corps: string[][]): string {
  return [entete, ...corps].map((r) => r.map((c) => texteBrut(c)).join("\t")).join("\n");
}

function BoutonCopierTableau({ texte }: { texte: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      className="vj-table-copier"
      title="Copier le tableau (colle proprement dans Excel)"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(texte);
          setOk(true);
          setTimeout(() => setOk(false), 1500);
        } catch {
          /* presse-papiers indisponible */
        }
      }}
    >
      {ok ? "✓ copié" : "⧉ Copier le tableau"}
    </button>
  );
}

function renduContenu(texte: string): React.ReactNode[] {
  const lignes = texte.split("\n");
  const blocs: React.ReactNode[] = [];
  let tampon: string[] = [];
  let cle = 0;

  const estLigneTableau = (l: string) => /^\s*\|.*\|\s*$/.test(l);
  const estSeparateur = (l: string) => /^\s*\|[\s:|-]+\|\s*$/.test(l) && l.includes("-");

  const viderTexte = () => {
    if (tampon.length) {
      // Lignes vides en bord de bloc retirées : l'espacement vient du CSS.
      while (tampon.length && !tampon[0].trim()) tampon.shift();
      while (tampon.length && !tampon[tampon.length - 1].trim()) tampon.pop();
      if (tampon.length) blocs.push(<div key={`t${cle++}`} className="vj-para">{renduInline(tampon.join("\n"))}</div>);
      tampon = [];
    }
  };

  let i = 0;
  while (i < lignes.length) {
    const ligne = lignes[i];
    const titre = ligne.match(/^(#{1,4})\s+(.*)$/);
    if (estLigneTableau(ligne) && i + 1 < lignes.length && estSeparateur(lignes[i + 1])) {
      viderTexte();
      const entete = decouperLigneTableau(ligne);
      i += 2;
      const corps: string[][] = [];
      while (i < lignes.length && estLigneTableau(lignes[i])) {
        corps.push(decouperLigneTableau(lignes[i]));
        i++;
      }
      blocs.push(
        <div key={`tab${cle++}`} className="vj-table-bloc">
          <div className="vj-table-wrap">
            <table className="vj-table">
              <thead>
                <tr>
                  {entete.map((c, j) => (
                    <th key={j}>{renduInline(c)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {corps.map((rangee, j) => (
                  <tr key={j}>
                    {rangee.map((c, k) => (
                      <td key={k}>{renduInline(c)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="vj-table-pied">
            <span>
              {corps.length} ligne{corps.length > 1 ? "s" : ""}
            </span>
            <BoutonCopierTableau texte={tableauEnTexte(entete, corps)} />
          </div>
        </div>
      );
    } else if (titre) {
      viderTexte();
      blocs.push(
        <div key={`h${cle++}`} className={`vj-titre vj-titre-${titre[1].length}`}>
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
const CLE_SOURCE = "jardi-source";

function lireSource(brut: string | null): FiltreSource {
  return brut === "thunderai" || brut === "tous" ? brut : "jardi";
}

function estMobile(): boolean {
  return typeof window !== "undefined" && window.innerWidth < LARGEUR_MOBILE;
}

// Indicateur d'activité — trois points qui pulsent.
function PointsAnimes() {
  return (
    <span className="vj-points">
      <i />
      <i />
      <i />
    </span>
  );
}

// Sélecteur « qui parle à Jardi » — même stockage que la v1 (lib/jardi-equipe,
// clé par appareil), habillé aux couleurs de la v2.
function SelecteurV2({ utilisateur, onChoix }: { utilisateur: MembreEquipe | null; onChoix: (m: MembreEquipe) => void }) {
  const [ouvert, setOuvert] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ouvert) return;
    const f = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOuvert(false);
    };
    document.addEventListener("mousedown", f);
    return () => document.removeEventListener("mousedown", f);
  }, [ouvert]);
  return (
    <div className="vj-selecteur" ref={ref}>
      <button type="button" className="v2-btn v2-btn-petit" onClick={() => setOuvert((o) => !o)} title="Qui parle à Jardi sur cet appareil">
        <Avatar nom={utilisateur} taille={20} />
        <span className="vj-masque-etroit">{utilisateur ?? "Qui es-tu ?"}</span>
        <span className="vj-chevron">▾</span>
      </button>
      {ouvert && (
        <div className="vj-menu" role="menu">
          <div className="vj-menu-titre">Je suis…</div>
          {EQUIPE_JARDI.map((m) => (
            <button
              key={m}
              type="button"
              role="menuitem"
              className={m === utilisateur ? "on" : undefined}
              onClick={() => {
                onChoix(m);
                setOuvert(false);
              }}
            >
              <Avatar nom={m} taille={20} />
              <span style={{ color: m === utilisateur ? couleurMembre(m) : undefined }}>{m}</span>
              {m === utilisateur && <span className="vj-coche">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Export d'une conversation en texte (.md) — pour la coller dans un mail, un
// ticket, ou l'archiver. Les pièces jointes sont citées par leur nom.
function exporterMarkdown(titre: string, messages: MessageAffiche[], auteur: string | null): string {
  const lignes = [`# ${titre}`, "", `Export du ${new Date().toLocaleString("fr-CH")}${auteur ? ` — ${auteur}` : ""}`, ""];
  for (const m of messages) {
    if (m.erreur) continue;
    lignes.push(m.role === "user" ? `## ${auteur ?? "Question"}` : "## Jardi", "");
    if (m.fichiers?.length) lignes.push(`Pièces jointes : ${m.fichiers.map((f) => f.nom).join(", ")}`, "");
    if (m.outils?.length) lignes.push(`_Outils : ${m.outils.join(", ")}_`, "");
    lignes.push(m.content, "");
  }
  return lignes.join("\n");
}

function nomFichier(titre: string): string {
  const base = titre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60)
    .toLowerCase();
  return `jardi-${base || "conversation"}.md`;
}

function salutation(): string {
  const h = new Date().getHours();
  return h < 5 ? "Bonsoir" : h < 18 ? "Bonjour" : "Bonsoir";
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

export default function JardiV2() {
  const [messages, setMessages] = useState<MessageAffiche[]>([]);
  const [saisie, setSaisie] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [conversations, setConversations] = useState<ConvResume[]>([]);
  const [chargementListe, setChargementListe] = useState(false);
  const [recentes, setRecentes] = useState<ConvResume[]>([]);
  const [recherche, setRecherche] = useState("");
  const [filtreAuteur, setFiltreAuteur] = useState("");
  const [source, setSource] = useState<FiltreSource>("jardi");
  const [convId, setConvId] = useState<string | null>(null);
  // Un échange ThunderAI ouvert dans le fil est en LECTURE : le premier message
  // qu'on y ajoute crée une conversation Jardi neuve (l'échange d'origine reste
  // intact dans `thunderai_echanges`).
  const [convSource, setConvSource] = useState<SourceConv>("jardi");
  const [panneauUsage, setPanneauUsage] = useState(false);
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
  // v2 : titre de la conversation ouverte (en-tête) et retour « lien copié ».
  const [convTitre, setConvTitre] = useState<string | null>(null);
  const [lienCopie, setLienCopie] = useState(false);
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
  const convSourceRef = useRef<SourceConv>("jardi");
  convSourceRef.current = convSource;
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
    // v2 : recalcul aussi quand la largeur change (volet d'historique ouvert /
    // fermé, passage mobile) — sinon la zone garde la hauteur calculée dans
    // une colonne étroite.
  }, [saisie, mobile, panneauOuvert]);

  // ── Historique ─────────────────────────────────────────────────────────────
  // La liste dépend de la recherche et du filtre ; le serveur fait le tri
  // (RPC jardi_conversations_lister). Un compteur de requête écarte les
  // réponses arrivées dans le désordre quand on tape vite.
  const requeteListeRef = useRef(0);
  const chargerListe = useCallback(async (q: string, auteur: string, src: FiltreSource) => {
    const n = ++requeteListeRef.current;
    setChargementListe(true);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (auteur) params.set("auteur", auteur);
      if (src !== "jardi") params.set("source", src);
      // v2 : la liste complète (plafond serveur 500) — le tri, la période et
      // les thèmes se font dans le navigateur sur cette liste.
      params.set("limite", "500");
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
    const t = setTimeout(() => chargerListe(recherche, filtreAuteur, source), recherche ? 250 : 0);
    return () => clearTimeout(t);
  }, [recherche, filtreAuteur, source, chargerListe]);

  useEffect(() => {
    chargerRecentes(utilisateur);
  }, [utilisateur, chargerRecentes]);

  // Adresse de la conversation ouverte : ?c=<id>. replaceState plutôt que le
  // routeur Next : aucune navigation, aucun rechargement, juste une adresse
  // qu'on peut copier ou retrouver dans l'historique du navigateur.
  const majUrl = (id: string | null, src: SourceConv = "jardi") => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("c", id);
    else url.searchParams.delete("c");
    if (id && src === "thunderai") url.searchParams.set("s", "thunderai");
    else url.searchParams.delete("s");
    url.searchParams.delete("source");
    window.history.replaceState(null, "", url.toString());
  };

  useEffect(() => {
    // Identité : mémorisée sur l'appareil, sinon on demande (bloquant, un clic).
    const u = lireUtilisateur();
    setUtilisateur(u);
    setDemanderUtilisateur(!u);
    // Filtre d'auteur et source mémorisés (« Tous » / « Jardi » par défaut :
    // l'historique est commun). `?source=thunderai` dans l'adresse (ancienne
    // page /dashboard/thunderai) force la source au chargement.
    const params = new URLSearchParams(window.location.search);
    try {
      setFiltreAuteur(localStorage.getItem(CLE_FILTRE_AUTEUR) ?? "");
      setSource(lireSource(params.get("source") ?? localStorage.getItem(CLE_SOURCE)));
    } catch {
      setSource(lireSource(params.get("source")));
    }
    // Mobile : historique en volet superposé, replié par défaut.
    const m = estMobile();
    setMobile(m);
    if (m) setPanneauOuvert(false);
    const surRedim = () => setMobile(estMobile());
    window.addEventListener("resize", surRedim);
    // Conversation désignée dans l'adresse (lien collé, retour arrière, reprise).
    const idUrl = params.get("c");
    if (idUrl) ouvrirConversation(idUrl, params.get("s") === "thunderai" ? "thunderai" : "jardi");
    // Dictée : bouton affiché seulement si le navigateur la supporte (Chrome/Edge)
    setDicteeDispo(constructeurVocal() !== null);
    // ⚠️ Un fichier lâché À CÔTÉ de la zone de dépôt fait naviguer le navigateur
    // VERS ce fichier : la page du chat disparaît, avec la saisie en cours et la
    // conversation elle-même si aucune réponse n'a encore été sauvegardée. Le
    // vendeur vise naturellement le fil de messages, pas la bande du bas.
    const bloquerDepot = (e: DragEvent) => e.preventDefault();
    window.addEventListener("dragover", bloquerDepot);
    window.addEventListener("drop", bloquerDepot);
    // « / » : la recherche de l'historique. (Ctrl+K reste la recherche
    // globale de la v2 — clients, documents, pages.)
    const raccourci = (e: KeyboardEvent) => {
      const cible = e.target as HTMLElement | null;
      const dansUnChamp =
        !!cible && (cible.tagName === "INPUT" || cible.tagName === "TEXTAREA" || cible.tagName === "SELECT" || cible.isContentEditable);
      if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey && !dansUnChamp) {
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

  const changerSource = (s: FiltreSource) => {
    setSource(s);
    try {
      localStorage.setItem(CLE_SOURCE, s);
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
            // Un échange ThunderAI continué devient une conversation Jardi NEUVE.
            id: convSourceRef.current === "jardi" ? convIdRef.current ?? undefined : undefined,
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
          if (!convIdRef.current || convSourceRef.current !== "jardi") {
            setConvId(json.id);
            setConvSource("jardi");
            majUrl(json.id);
          }
          chargerListe(recherche, filtreAuteur, source);
          chargerRecentes(utilisateurRef.current);
        }
      } catch {
        /* sauvegarde silencieuse */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enCours]);

  const ouvrirConversation = async (id: string, src: SourceConv = "jardi") => {
    if (enCours) return;
    try {
      const res = await fetch(
        `/api/claude/conversations?id=${encodeURIComponent(id)}${src === "thunderai" ? "&source=thunderai" : ""}`
      );
      if (!res.ok) {
        // Lien périmé (conversation supprimée) : on nettoie l'adresse.
        if (res.status === 404) majUrl(null);
        return;
      }
      const json = (await res.json()) as { conversation?: { messages?: MessageAffiche[]; titre?: string | null } };
      setMessages(Array.isArray(json.conversation?.messages) ? json.conversation.messages : []);
      setConvId(id);
      setConvSource(src);
      setConvTitre(json.conversation?.titre ?? null);
      majUrl(id, src);
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
    setConvSource("jardi");
    setConvTitre(null);
    majUrl(null);
    if (estMobile()) setPanneauOuvert(false);
    zoneRef.current?.focus();
  };

  const supprimerConversation = async (id: string, src: SourceConv = "jardi") => {
    if (!confirm(src === "thunderai" ? "Supprimer cet échange ThunderAI ?" : "Supprimer cette conversation ?")) return;
    try {
      await fetch(
        `/api/claude/conversations?id=${encodeURIComponent(id)}${src === "thunderai" ? "&source=thunderai" : ""}`,
        { method: "DELETE" }
      );
    } catch {
      /* ignoré */
    }
    if (convIdRef.current === id) nouvelleConversation();
    chargerListe(recherche, filtreAuteur, source);
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
        if (convIdRef.current === id) setConvTitre(titre);
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
        body: JSON.stringify({
          messages: historique,
          utilisateur: utilisateurRef.current,
          conversation_id: convSourceRef.current === "jardi" ? convIdRef.current : null,
        }),
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

  // Question passée dans l'adresse (?q=…) : le bouton « Préparer une réponse »
  // de la to-do ouvre Jardi avec la demande déjà écrite, et elle part seule.
  // Le ref garde le tir unique (StrictMode rejoue les effets en dev) et on
  // retire ?q= de l'adresse : un rafraîchissement ne doit pas relancer la
  // même demande.
  const questionUrlFaite = useRef(false);
  useEffect(() => {
    if (questionUrlFaite.current) return;
    const q = new URLSearchParams(window.location.search).get("q");
    if (!q) return;
    questionUrlFaite.current = true;
    const adresse = new URL(window.location.href);
    adresse.searchParams.delete("q");
    window.history.replaceState({}, "", adresse.toString());
    envoyer(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  // ── v2 : lien et export de la conversation ouverte ─────────────────────────
  const copierLien = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setLienCopie(true);
      setTimeout(() => setLienCopie(false), 1500);
    } catch {
      /* presse-papiers indisponible */
    }
  };

  const exporter = () => {
    const titre = titreConv || "Conversation Jardi";
    const blob = new Blob([exporterMarkdown(titre, messages, convCourante?.auteur ?? utilisateur)], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nomFichier(titre);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // Reprendre une question dans la zone de saisie (pour la corriger / relancer).
  const reprendreQuestion = (texte: string) => {
    setSaisie(texte);
    setTimeout(() => {
      const z = zoneRef.current;
      if (z) {
        z.focus();
        z.setSelectionRange(z.value.length, z.value.length);
      }
    }, 0);
  };

  const remplirModele = (texte: string) => reprendreQuestion(texte);

  // Conversation ouverte telle que la liste la connaît (auteur, date, outils).
  const convCourante: ConvResume | undefined = convId
    ? conversations.find((c) => c.id === convId) ?? recentes.find((c) => c.id === convId)
    : undefined;
  const premiereQuestion = messages.find((m) => m.role === "user")?.content ?? "";
  const titreConv =
    convCourante?.titre || convTitre || (messages.length ? apercuTexte(premiereQuestion, 70) || "Conversation" : "");
  const nbEchanges = Math.ceil(messages.filter((m) => !m.erreur).length / 2);

  const surTouche = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      envoyer();
    }
  };

  const derniereQuestionIndex = (() => {
    for (let k = messages.length - 1; k >= 0; k--) if (messages[k].role === "user") return k;
    return -1;
  })();

  return (
    <div className={"vj" + (mobile ? " vj-mobile" : "")}>
      {/* Voile derrière le volet (mobile) */}
      {mobile && panneauOuvert && <div className="vj-voile" onClick={() => setPanneauOuvert(false)} />}

      {/* Historique */}
      {panneauOuvert && (
        <aside className="vj-lateral">
          <HistoriqueV2
            conversations={conversations}
            chargement={chargementListe}
            convId={convId}
            utilisateur={utilisateur}
            filtreAuteur={filtreAuteur}
            source={source}
            recherche={recherche}
            onFiltreAuteur={changerFiltreAuteur}
            onSource={changerSource}
            onRecherche={setRecherche}
            onOuvrir={ouvrirConversation}
            onNouvelle={nouvelleConversation}
            onSupprimer={supprimerConversation}
            onRenommer={renommerConversation}
            onFermer={mobile ? () => setPanneauOuvert(false) : undefined}
            rechercheRef={rechercheRef}
          />
        </aside>
      )}

      {/* Colonne principale */}
      <section className="vj-colonne">
        {/* En-tête de la conversation */}
        <header className="vj-entete">
          <button
            type="button"
            className={"v2-btn v2-btn-icone v2-btn-petit" + (panneauOuvert ? " vj-on" : "")}
            onClick={() => setPanneauOuvert((o) => !o)}
            title="Historique des conversations (touche /)"
          >
            ☰
          </button>
          <div className="vj-entete-titre">
            {messages.length === 0 ? (
              <>
                <h1>
                  <span className="vj-logo">J</span> Jardi
                </h1>
                <p className="vj-masque-etroit">Mails, clients, commandes, stock, statistiques — brouillons à relire dans Thunderbird.</p>
              </>
            ) : (
              <>
                <h1 title={titreConv}>{titreConv}</h1>
                <p>
                  {convSource === "thunderai" ? (
                    <span className="vj-badge-tb">✉️ Thunderbird</span>
                  ) : (
                    <span className="vj-qui">
                      <Avatar nom={convCourante?.auteur ?? utilisateur} taille={16} />
                      {convCourante?.auteur ?? utilisateur ?? "—"}
                    </span>
                  )}
                  {convCourante && <span>· {fmtDateRelative(convCourante.updated_at)}</span>}
                  <span>
                    · {nbEchanges} échange{nbEchanges > 1 ? "s" : ""}
                  </span>
                  {!convId && <span className="vj-nonsauve">· pas encore enregistrée</span>}
                </p>
              </>
            )}
          </div>
          <div className="vj-entete-actions">
            {convId && (
              <button type="button" className="v2-btn v2-btn-petit" onClick={copierLien} title="Copier le lien de cette conversation">
                {lienCopie ? "✓ Lien copié" : "🔗"}
                <span className="vj-masque-etroit">{lienCopie ? "" : " Lien"}</span>
              </button>
            )}
            {messages.length > 0 && (
              <button type="button" className="v2-btn v2-btn-petit" onClick={exporter} title="Télécharger la conversation en texte (.md)">
                ⬇<span className="vj-masque-etroit"> Exporter</span>
              </button>
            )}
            <button type="button" className="v2-btn v2-btn-petit" onClick={() => setPanneauUsage(true)} title="Utilisation : requêtes, tokens, coût estimé">
              📊<span className="vj-masque-etroit"> Utilisation</span>
            </button>
            {messages.length > 0 && (
              <button type="button" className="v2-btn v2-btn-petit v2-btn-primaire" onClick={nouvelleConversation} disabled={enCours} title="Nouvelle conversation">
                ＋<span className="vj-masque-etroit"> Nouvelle</span>
              </button>
            )}
            <SelecteurV2 utilisateur={utilisateur} onChoix={choisirUtilisateur} />
          </div>
        </header>

        {/* Fil de messages */}
        <div className="vj-fil" ref={filRef} onScroll={surDefilement}>
          <div className="vj-fil-int">
            {messages.length === 0 && (
              <div className="vj-accueil">
                <div className="vj-accueil-logo">J</div>
                <h2>
                  {salutation()}
                  {utilisateur ? ` ${utilisateur}` : ""} 👋
                </h2>
                <p className="vj-accueil-sous">
                  Que veux-tu chercher ? Jardi lit les mails, les dossiers clients, les commandes, le stock et les
                  statistiques. Il prépare des brouillons — rien ne part sans toi.
                </p>

                {recentes.length > 0 && (
                  <>
                    <div className="vj-accueil-titre">Reprendre</div>
                    <div className="vj-grille vj-grille-reprise">
                      {recentes.map((c) => (
                        <button key={c.id} type="button" className="vj-carte-reprise" onClick={() => ouvrirConversation(c.id)}>
                          <b>{c.titre}</b>
                          <span className="vj-carte-apercu">{apercuTexte(c.reponse, 140) || "—"}</span>
                          <span className="vj-carte-meta">
                            <Avatar nom={c.auteur} taille={14} />
                            {fmtDateRelative(c.updated_at)} · {Math.ceil(c.nb_messages / 2)} {c.nb_messages > 2 ? "échanges" : "échange"}
                          </span>
                        </button>
                      ))}
                    </div>
                  </>
                )}

                <div className="vj-accueil-titre">Pour démarrer — un clic remplit la zone de saisie</div>
                <div className="vj-grille">
                  {MODELES.map((m) => {
                    const [icone, ...reste] = m.titre.split(" ");
                    return (
                      <button key={m.titre} type="button" className="vj-modele" onClick={() => remplirModele(m.texte)}>
                        <span className="vj-modele-icone">{icone}</span>
                        <span className="vj-modele-txt">
                          <b>{reste.join(" ")}</b>
                          <span>{m.texte.split("\n")[0]}…</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {convSource === "thunderai" && messages.length > 0 && (
              <div className="vj-bandeau-tb">
                ✉️ Échange passé par <strong>ThunderAI</strong> dans Thunderbird. Tu peux le continuer ici : ta prochaine
                question ouvrira une conversation Jardi à ton nom, l&apos;échange d&apos;origine reste tel quel.
              </div>
            )}

            {messages.map((m, i) => {
              const dernier = i === messages.length - 1;
              if (m.role === "user") {
                return (
                  <div key={i} className="vj-msg vj-msg-user">
                    <div className="vj-bulle">
                      {m.fichiers && m.fichiers.length > 0 && (
                        <div className="vj-pj-liste">
                          {m.fichiers.map((f) => {
                            const perime = estPerime(f.uploadedAt);
                            return (
                              <span
                                key={f.file_id}
                                className={"vj-pj" + (perime ? " perime" : "")}
                                title={perime ? "Scan effacé des serveurs Anthropic (24 h) — l'archive interne est conservée" : f.nom}
                              >
                                {perime ? "🚫" : f.media_type === "application/pdf" ? "📄" : "🖼"} {f.nom}
                                {perime ? " (purgé)" : ""}
                              </span>
                            );
                          })}
                        </div>
                      )}
                      {m.content}
                    </div>
                    {m.content && !enCours && (
                      <div className="vj-actions-msg vj-actions-user">
                        <button type="button" onClick={() => reprendreQuestion(m.content)} title="Remettre cette question dans la zone de saisie">
                          ✎ {i === derniereQuestionIndex ? "Reformuler" : "Reprendre"}
                        </button>
                      </div>
                    )}
                  </div>
                );
              }
              const enStream = enCours && dernier && !m.erreur;
              const outils = (m.outils ?? []).filter((o) => o !== "analyse");
              return (
                <div key={i} className="vj-msg vj-msg-jardi">
                  <span className={"vj-avatar" + (enStream ? " actif" : "")}>J</span>
                  <div className="vj-reponse">
                    <div className="vj-reponse-tete">
                      <b>Jardi</b>
                      {m.outils?.includes("analyse") && (
                        <span className="vj-outil vj-outil-analyse" title="Réflexion avant de répondre">
                          🧠 analyse
                        </span>
                      )}
                      {outils.map((o, k) => {
                        const t = themeDe(o);
                        return (
                          <span key={k} className="vj-outil" title={o}>
                            {t.icone} {libelleOutil(o)}
                          </span>
                        );
                      })}
                    </div>
                    {m.erreur ? (
                      <div className="vj-erreur">⚠️ {m.content}</div>
                    ) : (
                      <div className="vj-corps">
                        {renduContenu(m.content)}
                        {enStream &&
                          (m.content ? (
                            <span className="vj-curseur">▍</span>
                          ) : (
                            <span className="vj-reflechit">
                              <PointsAnimes />
                              {outils.length ? `consulte ${libelleOutil(outils[outils.length - 1])}…` : "Jardi réfléchit…"}
                            </span>
                          ))}
                      </div>
                    )}
                    {m.content && !m.erreur && !(enCours && dernier) && (
                      <div className="vj-actions-msg">
                        <button type="button" onClick={() => copierMessage(i, m.content)} title="Copier le message (sans mise en forme)" className={copieIndex === i ? "ok" : undefined}>
                          {copieIndex === i ? "✓ Copié" : "⧉ Copier"}
                        </button>
                        <span className="vj-audio">
                          <BoutonLireAudio texte={m.content} />
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            <div ref={finRef} />
          </div>
        </div>

        {/* Retour en bas */}
        {loinDuBas && messages.length > 0 && (
          <div className="vj-bas-ancre">
            <button type="button" onClick={allerEnBas} title="Aller en bas" className="vj-bas">
              ↓
            </button>
          </div>
        )}

        {/* Zone de saisie */}
        <div
          className="vj-saisie-zone"
          onDragOver={(e) => {
            e.preventDefault();
            if (!enCours && !enUpload) setSurvolDepot(true);
          }}
          onDragLeave={() => setSurvolDepot(false)}
          onDrop={surDepot}
        >
          <div className={"vj-composer" + (survolDepot ? " depot" : "") + (enCours ? " occupe" : "")}>
            {survolDepot && <div className="vj-depot-voile">📎 Dépose la photo ou le PDF ici</div>}
            {(fichiers.length > 0 || enUpload || erreurFichier) && (
              <div className="vj-pj-attente">
                {fichiers.map((f) => (
                  <span key={f.file_id} className="vj-pj-carte" title={f.taille ? `${f.nom} · ${Math.round(f.taille / 1024)} Ko` : f.nom}>
                    <span className="vj-pj-ic">{f.media_type === "application/pdf" ? "📄" : "🖼"}</span>
                    <span className="vj-pj-nom">{f.nom}</span>
                    <button type="button" onClick={() => setFichiers((p) => p.filter((x) => x.file_id !== f.file_id))} disabled={enCours} title="Retirer">
                      ✕
                    </button>
                  </span>
                ))}
                {enUpload && (
                  <span className="vj-pj-prep">
                    <PointsAnimes /> préparation…
                  </span>
                )}
                {erreurFichier && <span className="vj-pj-erreur">⚠️ {erreurFichier}</span>}
              </div>
            )}
            <textarea
              ref={zoneRef}
              value={saisie}
              onChange={(e) => setSaisie(e.target.value)}
              onKeyDown={surTouche}
              rows={2}
              placeholder={utilisateur ? `Écris à Jardi, ${utilisateur}…` : "Écris à Jardi…"}
              disabled={enCours}
            />
            <input
              ref={inputFichierRef}
              type="file"
              accept="image/*,application/pdf"
              multiple
              style={{ display: "none" }}
              onChange={(e) => {
                if (e.target.files) ajouterFichiers(e.target.files);
                // Remis à zéro : redéposer le MÊME fichier doit redéclencher onChange.
                e.target.value = "";
              }}
            />
            <div className="vj-barre">
              <button
                type="button"
                className="vj-outil-btn"
                onClick={() => inputFichierRef.current?.click()}
                disabled={enCours || enUpload}
                title="Joindre une photo ou un PDF (scan de commande magasin)"
              >
                📎<span className="vj-masque-etroit"> Joindre</span>
              </button>
              {dicteeDispo && (
                <button
                  type="button"
                  className={"vj-outil-btn" + (dicteeActive ? " dictee" : "")}
                  onClick={basculerDictee}
                  title={dicteeActive ? "Arrêter la dictée" : "Dicter au micro"}
                >
                  {dicteeActive ? "⏹" : "🎤"}
                  <span className="vj-masque-etroit">{dicteeActive ? " Arrêter" : " Dicter"}</span>
                </button>
              )}
              <span className="vj-astuce">
                <kbd>Entrée</kbd> envoyer · <kbd>Maj</kbd>+<kbd>Entrée</kbd> nouvelle ligne
              </span>
              <button type="button" className="vj-envoyer" onClick={() => envoyer()} disabled={!peutEnvoyer} title="Envoyer (Entrée)">
                {enCours ? <PointsAnimes /> : "↑"}
              </button>
            </div>
          </div>
          <div className="vj-mention">Jardi peut se tromper : vérifie les prix, les délais et les adresses avant d&apos;envoyer quoi que ce soit au client.</div>
        </div>
      </section>

      {demanderUtilisateur && <ChoixUtilisateur onChoix={choisirUtilisateur} />}
      {panneauUsage && <PanneauUsage onFermer={() => setPanneauUsage(false)} />}
    </div>
  );
}
