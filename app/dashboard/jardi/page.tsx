// app/dashboard/jardi/page.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Chat Claude intégré au dashboard (13.08.2026). Usage interne uniquement.
//
// Composant client : fil de messages, streaming SSE depuis /api/claude/chat,
// rendu markdown minimal (liens cliquables tels quels — règles Jardi —, gras,
// code inline), historique des conversations (Supabase via
// /api/claude/conversations, 14.08.2026) dans une barre latérale.
// La page est protégée par proxy.ts comme le reste du dashboard.
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type React from "react";

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

type ConvResume = {
  id: string;
  titre: string;
  auteur: string | null;
  updated_at: string;
};

type EvenementStream = {
  type: string;
  content_block?: { type?: string; name?: string };
  delta?: { type?: string; text?: string };
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
      noeuds.push(<strong key={`g${cle++}`}>{m[4]}</strong>);
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

// ── Pièces jointes : préparation côté navigateur ────────────────────────────
// Le redimensionnement n'est PAS une optimisation, c'est une CONDITION DE
// FONCTIONNEMENT : une fonction Vercel refuse un corps au-delà de ~4,5 Mo — les
// 32 Mo annoncés par l'API Anthropic sont donc hors d'atteinte — et une photo de
// téléphone les dépasse vite. Côté long plafonné à 2000 px : très loin des
// 8000 px de l'API, et largement lisible pour du manuscrit sur A4 (les scans du
// pilote font ~750 Ko).
const COTE_MAX = 2000;
const QUALITE_JPEG = 0.85;
const TAILLE_MAX = 4 * 1024 * 1024;
const MAX_FICHIERS = 8;
// Durée de vie de la copie chez Anthropic (/api/cron/claude-files-purge).
// Au-delà, le `file_id` peut être mort : on l'exclut de l'historique envoyé
// plutôt que de laisser l'API répondre en erreur au milieu d'une conversation.
const TTL_FICHIER_MS = 24 * 3600 * 1000;

function estPerime(uploadedAt: string): boolean {
  const t = Date.parse(uploadedAt);
  return !Number.isFinite(t) || Date.now() - t > TTL_FICHIER_MS;
}

function nomEnJpg(nom: string): string {
  // L'extension change, le reste du nom NON : il porte le n° manuscrit
  // (« Scan_Copie_Commande_53864_… »), qui sert à retrouver le scan en base.
  return nom.replace(/\.[^.]+$/, "") + ".jpg";
}

async function preparerFichier(f: File): Promise<File> {
  if (f.type === "application/pdf") {
    if (f.size > TAILLE_MAX) {
      throw new Error("PDF trop lourd (max 4 Mo) — photographie les pages une à une");
    }
    return f;
  }
  if (!f.type.startsWith("image/")) {
    throw new Error("format non accepté (photo ou PDF)");
  }

  let bitmap: ImageBitmap;
  try {
    // `from-image` applique l'orientation EXIF. Sans elle, une photo prise en
    // portrait arrive couchée — et la lecture du manuscrit s'en ressent.
    const options = { imageOrientation: "from-image" } as unknown as ImageBitmapOptions;
    bitmap = await createImageBitmap(f, options);
  } catch {
    // Un HEIC d'iPhone atterrit ici hors de Safari : le navigateur ne sait pas
    // le décoder. iOS convertit normalement en JPEG à la prise de vue.
    throw new Error("image illisible par le navigateur — réessaie en JPEG");
  }

  const facteur = Math.min(1, COTE_MAX / Math.max(bitmap.width, bitmap.height));
  const largeur = Math.max(1, Math.round(bitmap.width * facteur));
  const hauteur = Math.max(1, Math.round(bitmap.height * facteur));
  const toile = document.createElement("canvas");
  toile.width = largeur;
  toile.height = hauteur;
  const ctx = toile.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("redimensionnement impossible");
  }
  // Sans fond blanc, `toBlob("image/jpeg")` aplatit la transparence en NOIR :
  // une capture PNG à fond transparent arrive en écriture noire sur noir, et la
  // lecture échoue sans qu'aucune erreur ne l'explique.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, largeur, hauteur);
  ctx.drawImage(bitmap, 0, 0, largeur, hauteur);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resoudre) =>
    toile.toBlob(resoudre, "image/jpeg", QUALITE_JPEG)
  );
  if (!blob) throw new Error("redimensionnement impossible");
  if (blob.size > TAILLE_MAX) throw new Error("image trop lourde même après réduction");
  return new File([blob], nomEnJpg(f.name || "photo"), { type: "image/jpeg" });
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
  if (texte) blocs.push({ type: "text", text: texte });
  return blocs;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("fr-CH", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
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

const EXEMPLES = [
  "mails Fermob de cette semaine",
  "dernier mail Dedon",
  "cherche le client Rochat à Pully",
  "stats de ventes de juillet",
];

export default function PageChatClaude() {
  const [messages, setMessages] = useState<MessageAffiche[]>([]);
  const [saisie, setSaisie] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [conversations, setConversations] = useState<ConvResume[]>([]);
  const [convId, setConvId] = useState<string | null>(null);
  const [panneauOuvert, setPanneauOuvert] = useState(true);
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
  const zoneRef = useRef<HTMLTextAreaElement>(null);
  const convIdRef = useRef<string | null>(null);
  convIdRef.current = convId;

  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  // ── Historique ─────────────────────────────────────────────────────────────
  const chargerListe = useCallback(async () => {
    try {
      const res = await fetch("/api/claude/conversations");
      if (!res.ok) return;
      const json = (await res.json()) as { conversations?: ConvResume[] };
      setConversations(json.conversations ?? []);
    } catch {
      /* liste indisponible — sans gravité */
    }
  }, []);

  useEffect(() => {
    chargerListe();
    // Sur petit écran, replier l'historique par défaut
    if (typeof window !== "undefined" && window.innerWidth < 700) {
      setPanneauOuvert(false);
    }
    // Dictée : bouton affiché seulement si le navigateur la supporte (Chrome/Edge)
    setDicteeDispo(constructeurVocal() !== null);
    // ⚠️ Un fichier lâché À CÔTÉ de la zone de dépôt fait naviguer le navigateur
    // VERS ce fichier : la page du chat disparaît, avec la saisie en cours et la
    // conversation elle-même si aucune réponse n'a encore été sauvegardée. Le
    // vendeur vise naturellement le fil de messages, pas la bande du bas.
    const bloquerDepot = (e: DragEvent) => e.preventDefault();
    window.addEventListener("dragover", bloquerDepot);
    window.addEventListener("drop", bloquerDepot);
    return () => {
      window.removeEventListener("dragover", bloquerDepot);
      window.removeEventListener("drop", bloquerDepot);
    };
  }, [chargerListe]);

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
        const auteur =
          (typeof window !== "undefined" && localStorage.getItem("corrections-author")) || undefined;
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
          if (!convIdRef.current) setConvId(json.id);
          chargerListe();
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
      if (!res.ok) return;
      const json = (await res.json()) as { conversation?: { messages?: MessageAffiche[] } };
      setMessages(Array.isArray(json.conversation?.messages) ? json.conversation.messages : []);
      setConvId(id);
      setFichiers([]);
      setErreurFichier(null);
      if (typeof window !== "undefined" && window.innerWidth < 700) setPanneauOuvert(false);
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
    zoneRef.current?.focus();
  };

  const supprimerConversation = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Supprimer cette conversation ?")) return;
    try {
      await fetch(`/api/claude/conversations?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    } catch {
      /* ignoré */
    }
    if (convIdRef.current === id) nouvelleConversation();
    chargerListe();
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
    setEnCours(true);

    try {
      const reponse = await fetch("/api/claude/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: historique }),
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
      `}</style>
      <div style={{ display: "flex", height: "100dvh", maxWidth: 1150, margin: "0 auto" }}>
        {/* Barre latérale — historique des conversations */}
        {panneauOuvert && (
          <div
            style={{
              width: 250,
              flexShrink: 0,
              borderRight: "1px solid rgba(255,255,255,0.08)",
              display: "flex",
              flexDirection: "column",
              padding: "14px 10px",
            }}
          >
            <button
              onClick={nouvelleConversation}
              style={{
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
            <div style={{ flex: 1, overflowY: "auto", marginTop: 10 }}>
              {conversations.map((c) => (
                <div
                  key={c.id}
                  onClick={() => ouvrirConversation(c.id)}
                  style={{
                    padding: "8px 10px",
                    borderRadius: 8,
                    cursor: "pointer",
                    background: convId === c.id ? "#2a2d31" : "transparent",
                    marginBottom: 2,
                    position: "relative",
                  }}
                >
                  <div
                    style={{
                      fontSize: 13,
                      color: "#e4e4e7",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      paddingRight: 18,
                    }}
                  >
                    {c.titre}
                  </div>
                  <div style={{ fontSize: 11, color: "#71717a" }}>
                    {fmtDate(c.updated_at)}
                    {c.auteur ? ` · ${c.auteur}` : ""}
                  </div>
                  <button
                    onClick={(e) => supprimerConversation(c.id, e)}
                    title="Supprimer"
                    style={{
                      position: "absolute",
                      right: 6,
                      top: 8,
                      background: "none",
                      border: "none",
                      color: "#71717a",
                      cursor: "pointer",
                      fontSize: 12,
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
              {conversations.length === 0 && (
                <div style={{ fontSize: 12, color: "#71717a", padding: 8 }}>
                  Aucune conversation enregistrée.
                </div>
              )}
            </div>
          </div>
        )}

        {/* Colonne principale */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            padding: "16px 16px 12px",
          }}
        >
          {/* En-tête */}
          <div style={{ flexShrink: 0, paddingBottom: 10, borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button
                onClick={() => setPanneauOuvert((o) => !o)}
                title="Historique des conversations"
                style={{
                  background: "none",
                  border: "1px solid rgba(255,255,255,0.15)",
                  borderRadius: 8,
                  color: "#a1a1aa",
                  cursor: "pointer",
                  padding: "2px 9px",
                  fontSize: 14,
                }}
              >
                ☰
              </button>
              <Link
                href="/dashboard"
                style={{ color: "#7dd3fc", fontSize: 13, textDecoration: "none" }}
              >
                ← Retour au dashboard
              </Link>
            </div>
            <h1 style={{ fontSize: 20, fontWeight: 800, color: "#f4f4f5", marginTop: 8, marginBottom: 2 }}>
              💬 Jardi
            </h1>
            <p style={{ color: "#a1a1aa", fontSize: 13, margin: 0 }}>
              Mails, clients, commandes, statistiques — usage interne. Lecture seule :
              Jardi ne peut rien envoyer, uniquement déposer des brouillons à relire
              dans Thunderbird.
            </p>
          </div>

          {/* Fil de messages */}
          <div style={{ flex: 1, overflowY: "auto", padding: "16px 4px" }}>
            {messages.length === 0 && (
              <div style={{ color: "#a1a1aa", fontSize: 14, marginTop: 24 }}>
                <p style={{ marginBottom: 12 }}>Quelques exemples pour démarrer :</p>
                {EXEMPLES.map((ex) => (
                  <button
                    key={ex}
                    onClick={() => envoyer(ex)}
                    style={{
                      display: "block",
                      marginBottom: 8,
                      padding: "8px 12px",
                      fontSize: 13,
                      color: "#7dd3fc",
                      background: "rgba(56,189,248,0.08)",
                      border: "1px solid rgba(56,189,248,0.25)",
                      borderRadius: 8,
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    {ex}
                  </button>
                ))}
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
                  style={{
                    maxWidth: "85%",
                    padding: "10px 14px",
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
                      <div style={{ marginTop: 6, textAlign: "right" }}>
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
                resize: "none",
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
    </div>
  );
}
