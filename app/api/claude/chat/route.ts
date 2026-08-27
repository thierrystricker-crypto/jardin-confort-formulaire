// app/api/claude/chat/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// Chat Claude intégré au dashboard (13.08.2026).
//
// POST { messages: [{ role, content }] } — `content` est une chaîne OU une liste
//   blanche stricte de blocs (texte, image ou document par `file_id`).
// → relaie le stream SSE de la Messages API Anthropic (connecteur MCP branché
//   sur jardi-mail-mcp, lecture seule + brouillons).
//
// Sécurité :
// - La route est INTERNE : proxy.ts la protège déjà (cookie de session), et la
//   même vérification est refaite ici (défense en profondeur).
// - ANTHROPIC_API_KEY et CLAUDE_CHAT_MCP_TOKEN ne vivent que côté serveur ;
//   rien de sensible ne part au navigateur.
// - Le jeton MCP est un secret DÉDIÉ (MCP_SECRET_CHAT côté jardi-mail-mcp),
//   révocable indépendamment du secret principal.
// - Aucune capacité d'envoi : le serveur MCP reste lecture seule + brouillons.
//
// La boucle agentique (enchaînement des appels d'outils) est gérée par l'API
// elle-même (beta mcp-client-2025-11-20) : la route n'a pas à reboucler.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { REGLES_JARDI, blocDate } from "./regles-jardi";
import { normaliserMembre } from "@/lib/jardi-equipe";

// Les enchaînements d'outils dépassent facilement les 10 s par défaut.
export const maxDuration = 300;

const URL_MCP =
  process.env.CLAUDE_CHAT_MCP_URL ?? "https://jardi-mail-mcp.vercel.app/api/mcp";

const MODELE = process.env.CLAUDE_CHAT_MODEL ?? "claude-sonnet-5";


// ── Contrat de message ───────────────────────────────────────────────────────
// `content` est soit une chaîne (cas historique, strictement inchangé), soit une
// LISTE BLANCHE de blocs. Trois formes, et trois seulement :
//   { type: "text",     text: string }
//   { type: "image",    source: { type: "file", file_id: string } }
//   { type: "document", source: { type: "file", file_id: string } }
//
// ⚠️ `source.type: "base64"` est REFUSÉ, et c'est tout le dispositif. Un PDF de
// 2 Mo en base64 pèse ~2,7 millions de caractères — 45 fois le budget
// d'historique — et serait renvoyé À CHAQUE TOUR. Le rendre impossible à faire
// entrer vaut mieux que s'imposer de ne pas le faire : le piège cesse d'être une
// question de discipline. Les fichiers passent par /api/claude/upload, donc par
// une référence d'une trentaine d'octets.

type BlocTexte = { type: "text"; text: string };
type BlocFichier = {
  type: "image" | "document";
  source: { type: "file"; file_id: string };
};
type BlocMessage = BlocTexte | BlocFichier;
type ContenuMessage = string | BlocMessage[];
type MessageChat = { role: "user" | "assistant"; content: ContenuMessage };

// ── Troncature d'historique ──────────────────────────────────────────────────
// La fenêtre de contexte est gérée ici : on garde les derniers messages dans un
// budget de caractères, et l'historique envoyé commence toujours par un message
// utilisateur (exigence de l'API).
const BUDGET_CARACTERES = 60_000;
const MAX_MESSAGES = 40;
// Un message ne porte pas un nombre arbitraire de blocs : une commande magasin
// tient en quelques pages, et vingt références dans un seul tour signaleraient
// une boucle côté front plutôt qu'un usage réel.
const MAX_BLOCS = 20;

// Seul le TEXTE compte dans le budget. Un bloc fichier ne pèse qu'un `file_id`,
// quelle que soit la taille du document derrière — c'est exactement ce qui rend
// la reprise d'un scan tenable sur plusieurs tours.
function poidsTexte(contenu: ContenuMessage): number {
  if (typeof contenu === "string") return contenu.length;
  let total = 0;
  for (const bloc of contenu) {
    if (bloc.type === "text") total += bloc.text.length;
  }
  return total;
}

function tronquerHistorique(messages: MessageChat[]): MessageChat[] {
  const gardes: MessageChat[] = [];
  let total = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    total += poidsTexte(messages[i].content);
    if (gardes.length > 0 && (total > BUDGET_CARACTERES || gardes.length >= MAX_MESSAGES)) {
      break;
    }
    gardes.unshift(messages[i]);
  }
  while (gardes.length > 0 && gardes[0].role !== "user") {
    gardes.shift();
  }
  return gardes;
}

// ⚠️ La validation contrôle la FORME d'un bloc, pas ses clés en trop. Relayer
// l'objet reçu tel quel rouvrirait le piège en grand : un
// `{ type: "image", source: { type: "file", file_id: "…", data: "<2,7 Mo>" } }`
// passe estBlocValide, pèse ZÉRO au budget (poidsTexte ne compte que le texte),
// et repart à chaque tour. On ne relaie donc jamais — on RECONSTRUIT, champ par
// champ. C'est ça qui ferme la branche, pas la liste blanche seule.
function projeter(contenu: ContenuMessage): ContenuMessage {
  if (typeof contenu === "string") return contenu;
  return contenu.map((b) =>
    b.type === "text"
      ? { type: "text" as const, text: b.text }
      : { type: b.type, source: { type: "file" as const, file_id: b.source.file_id } }
  );
}

function estBlocValide(b: unknown): b is BlocMessage {
  if (typeof b !== "object" || b === null) return false;
  const o = b as Record<string, unknown>;
  if (o.type === "text") return typeof o.text === "string";
  if (o.type === "image" || o.type === "document") {
    if (typeof o.source !== "object" || o.source === null) return false;
    const src = o.source as Record<string, unknown>;
    // Le point de refus : SEULE la référence Files API passe.
    return src.type === "file" && typeof src.file_id === "string" && src.file_id.length > 0;
  }
  return false;
}

function estContenuValide(c: unknown): c is ContenuMessage {
  if (typeof c === "string") return true;
  return Array.isArray(c) && c.length > 0 && c.length <= MAX_BLOCS && c.every(estBlocValide);
}

function estMessageValide(m: unknown): m is MessageChat {
  if (typeof m !== "object" || m === null) return false;
  const objet = m as Record<string, unknown>;
  return (
    (objet.role === "user" || objet.role === "assistant") &&
    estContenuValide(objet.content)
  );
}

export async function POST(req: NextRequest) {
  // Défense en profondeur : proxy.ts protège déjà, on revérifie le cookie.
  const secretSession = process.env.DASHBOARD_SESSION_SECRET;
  const cookie = req.cookies.get("jc_acces")?.value;
  if (!secretSession || cookie !== secretSession) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 401 });
  }

  const cleApi = process.env.ANTHROPIC_API_KEY;
  const jetonMcp = process.env.CLAUDE_CHAT_MCP_TOKEN;
  if (!cleApi || !jetonMcp) {
    console.error("Chat Claude : ANTHROPIC_API_KEY ou CLAUDE_CHAT_MCP_TOKEN manquant");
    return NextResponse.json({ error: "Configuration incomplète" }, { status: 500 });
  }

  let corps: unknown;
  try {
    corps = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }
  const bruts = (corps as { messages?: unknown })?.messages;
  if (!Array.isArray(bruts) || !bruts.every(estMessageValide)) {
    return NextResponse.json({ error: "Format attendu : { messages: [...] }" }, { status: 400 });
  }
  // Qui parle (27.08.2026) : prénom choisi dans le sélecteur de la page,
  // normalisé contre la liste fermée de l'équipe — une valeur inconnue est
  // simplement tue. Va dans le bloc système NON caché, à côté de la date :
  // le bloc des règles reste identique d'un utilisateur à l'autre, donc le
  // cache de prompt est conservé.
  const utilisateur = normaliserMembre((corps as { utilisateur?: unknown })?.utilisateur);

  const messages = tronquerHistorique(bruts).map((m) => ({
    role: m.role,
    content: projeter(m.content),
  }));
  if (messages.length === 0) {
    return NextResponse.json({ error: "Aucun message utilisateur" }, { status: 400 });
  }

  const corps_envoye = JSON.stringify({
    model: MODELE,
    // ⚠️ La réflexion étendue et TOUTE la boucle d'outils MCP comptent dans la
    // sortie. À 4096, le régime reprise de document (§12 : réflexion + 10-15
    // appels d'outils) tombait sur `stop_reason: "max_tokens"` — parfois avant
    // le premier mot visible, d'où des « Réponse vide » intermittents
    // (constaté au flux le 19.08, chantier annexes).
    max_tokens: 16384,
    stream: true,
    // cache_control : amortit le prompt système (règles Jardi) entre requêtes.
    system: [
      {
        type: "text",
        text: REGLES_JARDI,
        cache_control: { type: "ephemeral" },
      },
      {
        type: "text",
        text:
          blocDate() +
          (utilisateur
            ? `\n\nLa personne qui te parle est ${utilisateur}, de l'équipe Jardin Confort. ` +
              `Tutoie-la et utilise son prénom quand c'est naturel (jamais dans les ` +
              `brouillons destinés aux clients : la signature de la boîte fait foi).`
            : ""),
      },
    ],
    messages,
    mcp_servers: [
      {
        type: "url",
        url: URL_MCP,
        name: "jardi-mail",
        authorization_token: jetonMcp,
      },
    ],
    tools: [{ type: "mcp_toolset", mcp_server_name: "jardi-mail" }],
  });

  // Dernier filet. Le budget d'historique et la projection des blocs devraient
  // suffire ; si une requête arrive quand même à ce volume, c'est qu'un chemin
  // nous a échappé — mieux vaut le voir dans les journaux qu'à la facture.
  if (corps_envoye.length > 1_000_000) {
    console.error("Chat Claude : corps anormalement volumineux", corps_envoye.length);
    return NextResponse.json(
      { error: "Conversation trop lourde. Ouvre une nouvelle conversation." },
      { status: 413 }
    );
  }

  const reponse = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": cleApi,
      "anthropic-version": "2023-06-01",
      // AJOUT, jamais substitution : le connecteur MCP a besoin du sien, la
      // Files API du sien. Remplacer l'un par l'autre couperait les outils.
      "anthropic-beta": "mcp-client-2025-11-20,files-api-2025-04-14",
    },
    body: corps_envoye,
  });

  if (!reponse.ok || !reponse.body) {
    // Détail loggé côté serveur uniquement — jamais renvoyé au navigateur.
    const detail = await reponse.text().catch(() => "(corps illisible)");
    console.error("Chat Claude : erreur API Anthropic", reponse.status, detail);
    return NextResponse.json(
      { error: `Le service Jardi a répondu ${reponse.status}. Réessaie dans un instant.` },
      { status: 502 }
    );
  }

  // Relais direct du stream SSE au navigateur.
  return new Response(reponse.body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
