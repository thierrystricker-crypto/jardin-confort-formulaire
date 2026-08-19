// app/api/thunderai/v1/chat/completions/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// Façade OpenAI-compatible pour ThunderAI (19.08.2026).
//
// ThunderAI (extension Thunderbird, intégration « OpenAI Compatible API »)
// appelle POST {host}/v1/chat/completions avec { model, messages, stream:true }
// et attend un flux SSE au format OpenAI (`choices[0].delta.content`, terminé
// par `data: [DONE]`). Cette route reçoit ce format, exécute le VRAI Jardi
// (Messages API Anthropic + règles Jardi partagées + outils MCP jardi-mail)
// et retraduit le flux Anthropic vers le format OpenAI à la volée.
//
// Sécurité :
// - Le proxy laisse passer /api/thunderai/* SANS cookie (l'extension n'a pas
//   de session navigateur) ; en échange la route exige
//   `Authorization: Bearer $THUNDERAI_SECRET` — secret DÉDIÉ aux postes,
//   révocable indépendamment de tout le reste.
// - ANTHROPIC_API_KEY et CLAUDE_CHAT_MCP_TOKEN ne vivent que côté serveur :
//   c'était tout l'intérêt de la façade — aucune clé dans les options de
//   ThunderAI sur les postes, seulement le jeton dédié.
// - Aucune capacité d'envoi : mêmes outils MCP lecture seule + brouillons que
//   le chat du dashboard. ThunderAI lui-même ne fait qu'afficher/insérer du
//   texte dans une fenêtre de rédaction.
//
// Différences avec la route du chat dashboard (app/api/claude/chat/route.ts) :
// - contenu des messages : chaînes UNIQUEMENT (pas de blocs fichiers — pas de
//   Files API côté ThunderAI) ;
// - un bloc système supplémentaire adapte Jardi au contexte ThunderAI ;
// - le flux sortant est traduit Anthropic → OpenAI au lieu d'être relayé brut.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { REGLES_JARDI, blocDate } from "../../../../claude/chat/regles-jardi";
import { supabaseAdmin } from "@/lib/supabase";

// Les enchaînements d'outils dépassent facilement les 10 s par défaut.
export const maxDuration = 300;

const URL_MCP =
  process.env.CLAUDE_CHAT_MCP_URL ?? "https://jardi-mail-mcp.vercel.app/api/mcp";

const MODELE = process.env.CLAUDE_CHAT_MODEL ?? "claude-sonnet-5";

// Nom de « modèle » affiché côté ThunderAI (liste /v1/models et chunks).
const MODELE_AFFICHE = "jardi";

// Adaptation au contexte ThunderAI — placée APRÈS le bloc mis en cache, comme
// le bloc de date : le préfixe (règles Jardi) reste identique à celui du chat
// dashboard, donc potentiellement déjà chaud dans le cache Anthropic.
const CONTEXTE_THUNDERAI =
  "Contexte d'affichage : tu réponds ici dans ThunderAI, l'extension installée " +
  "dans Thunderbird — pas dans le chat du dashboard. L'utilisateur est déjà DANS " +
  "Thunderbird, devant un mail. Conséquences pratiques : " +
  "1) Le corps du mail courant est souvent fourni directement dans le message " +
  "(précédé d'une consigne du type « réponds à ce mail », « résume », « traduis »). " +
  "Dans ce cas, travailler d'abord sur ce texte fourni ; les outils jardi-mail " +
  "servent au contexte complémentaire (dossier client, commandes, anciens mails). " +
  "2) Quand la demande est de produire un texte à insérer dans un mail (réponse, " +
  "reformulation, traduction), répondre avec le TEXTE SEUL, prêt à coller — sans " +
  "phrase d'introduction ni commentaire autour ; les règles métier (§3 à §8) " +
  "s'appliquent inchangées. " +
  "3) Le rendu de cette fenêtre supporte le markdown ; les règles d'affichage des " +
  "liens (lien Thunderbird, pièces jointes) restent valables pour les mails " +
  "provenant des outils. " +
  "4) Il n'y a pas d'envoi de fichiers ici : si un document est nécessaire, " +
  "orienter vers le chat du dashboard. " +
  "5) Destinataire et civilité : la réponse s'adresse à l'EXPÉDITEUR du message " +
  "le plus récent du fil — s'il est indiqué en tête du message fourni " +
  "(« Expéditeur », « De »), c'est LUI qui fait foi, pas le contenu du fil. Un " +
  "fil cité peut contenir plusieurs personnes : ne jamais mélanger les " +
  "interlocuteurs. Ne JAMAIS deviner « Monsieur » ou « Madame » (ni d'après le " +
  "prénom, ni d'après une signature du fil) : n'utiliser une civilité que si " +
  "elle est certaine — le client la donne lui-même, ou une réponse précédente " +
  "du fil s'adresse à CETTE personne avec cette civilité. Au moindre doute, " +
  "saluer sans civilité : « Bonjour, » ou « Bonjour Prénom Nom, ».";

// ── Contrat de message (format OpenAI, chaînes uniquement) ──────────────────
type MessageOpenAI = { role: "user" | "assistant"; content: string };

// Mêmes bornes que le chat dashboard.
const BUDGET_CARACTERES = 60_000;
const MAX_MESSAGES = 40;

function tronquerHistorique(messages: MessageOpenAI[]): MessageOpenAI[] {
  const gardes: MessageOpenAI[] = [];
  let total = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    total += messages[i].content.length;
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

// ThunderAI n'envoie que des rôles user/assistant à contenu chaîne. Tout le
// reste (rôle system d'un autre client, blocs structurés) est simplement
// ignoré : la façade RECONSTRUIT champ par champ, elle ne relaie jamais.
function extraireMessages(bruts: unknown): MessageOpenAI[] {
  if (!Array.isArray(bruts)) return [];
  const messages: MessageOpenAI[] = [];
  for (const m of bruts) {
    if (typeof m !== "object" || m === null) continue;
    const o = m as Record<string, unknown>;
    if ((o.role === "user" || o.role === "assistant") && typeof o.content === "string") {
      messages.push({ role: o.role, content: o.content });
    }
  }
  return messages;
}

// ── Historique (filet anti « clic trop rapide », 19.08.2026) ────────────────
// ThunderAI ne conserve rien : fenêtre fermée = réponse perdue. Chaque échange
// complet est donc enregistré dans `thunderai_echanges` (projet Supabase
// jardin-confort-database, RLS sans policy — service key uniquement) et
// consultable sur /dashboard/thunderai. Un échec d'enregistrement ne doit
// JAMAIS casser la réponse : tout est avalé et loggé.
async function enregistrerEchange(question: string, reponse: string): Promise<void> {
  if (!reponse.trim()) return;
  try {
    await supabaseAdmin.from("thunderai_echanges").insert({
      question: question.slice(0, 20_000),
      reponse: reponse.slice(0, 100_000),
    });
    // Purge au fil de l'eau : à leur volume, un DELETE indexé par insertion
    // coûte moins cher qu'un cron dédié.
    const limite = new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString();
    await supabaseAdmin.from("thunderai_echanges").delete().lt("cree_le", limite);
  } catch (erreur) {
    console.error("Façade ThunderAI : échec d'enregistrement de l'historique", erreur);
  }
}

// ── Format OpenAI sortant ────────────────────────────────────────────────────
function erreurOpenAI(message: string, status: number): NextResponse {
  // Le worker ThunderAI lit `errorJSON.error.message` : on parle sa langue.
  return NextResponse.json(
    { error: { message, type: "invalid_request_error" } },
    { status }
  );
}

export async function POST(req: NextRequest) {
  // Secret dédié aux postes ThunderAI — la route est publique côté proxy,
  // c'est donc CE contrôle qui ferme la porte.
  const secret = process.env.THUNDERAI_SECRET;
  const enTete = req.headers.get("authorization");
  if (!secret || enTete !== "Bearer " + secret) {
    return erreurOpenAI("Accès non autorisé.", 401);
  }

  const cleApi = process.env.ANTHROPIC_API_KEY;
  const jetonMcp = process.env.CLAUDE_CHAT_MCP_TOKEN;
  if (!cleApi || !jetonMcp) {
    console.error("Façade ThunderAI : ANTHROPIC_API_KEY ou CLAUDE_CHAT_MCP_TOKEN manquant");
    return erreurOpenAI("Configuration incomplète côté serveur.", 500);
  }

  let corps: unknown;
  try {
    corps = await req.json();
  } catch {
    return erreurOpenAI("JSON invalide.", 400);
  }
  const { messages: bruts, stream } = corps as { messages?: unknown; stream?: unknown };

  const messages = tronquerHistorique(extraireMessages(bruts));
  if (messages.length === 0) {
    return erreurOpenAI("Aucun message utilisateur exploitable.", 400);
  }

  const corps_envoye = JSON.stringify({
    model: MODELE,
    // Même budget que le chat dashboard : la boucle d'outils MCP compte dans
    // la sortie (cf. le « Réponse vide » du 19.08 sur le chat à 4096).
    max_tokens: 16384,
    // Toujours en flux côté Anthropic, même si le client demande une réponse
    // non streamée : on accumule alors ici. (Une réponse non streamée avec
    // outils MCP peut dépasser les délais HTTP simples.)
    stream: true,
    system: [
      {
        type: "text",
        text: REGLES_JARDI,
        cache_control: { type: "ephemeral" },
      },
      { type: "text", text: CONTEXTE_THUNDERAI },
      { type: "text", text: blocDate() },
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

  const reponse = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": cleApi,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "mcp-client-2025-11-20",
    },
    body: corps_envoye,
  });

  if (!reponse.ok || !reponse.body) {
    // Détail loggé côté serveur uniquement — jamais renvoyé aux postes.
    const detail = await reponse.text().catch(() => "(corps illisible)");
    console.error("Façade ThunderAI : erreur API Anthropic", reponse.status, detail);
    return erreurOpenAI(
      `Le service Jardi a répondu ${reponse.status}. Réessaie dans un instant.`,
      502
    );
  }

  const id = "chatcmpl-" + crypto.randomUUID();
  const created = Math.floor(Date.now() / 1000);

  // Pour l'historique : la question est le dernier message utilisateur.
  const question =
    [...messages].reverse().find((m) => m.role === "user")?.content ?? "";

  // Un chunk au format OpenAI, déjà sérialisé en ligne SSE.
  function ligneChunk(
    delta: Record<string, string>,
    finish: "stop" | null
  ): string {
    return (
      "data: " +
      JSON.stringify({
        id,
        object: "chat.completion.chunk",
        created,
        model: MODELE_AFFICHE,
        choices: [{ index: 0, delta, finish_reason: finish }],
      }) +
      "\n\n"
    );
  }

  // Traduction du flux : on ne retient que les deltas de TEXTE visibles
  // (`content_block_delta` / `text_delta`). Les appels d'outils MCP, leurs
  // résultats et la réflexion transitent dans le flux Anthropic mais ne
  // concernent pas ThunderAI — pendant ce temps, l'extension attend simplement
  // les prochains tokens.
  const lecteur = reponse.body.getReader();
  const decodeur = new TextDecoder("utf-8");
  const encodeur = new TextEncoder();

  const veutStream = stream !== false; // ThunderAI envoie toujours stream:true

  // Itère les événements SSE Anthropic et appelle `surTexte` pour chaque
  // fragment de texte visible. Retourne quand le flux est terminé.
  async function pomper(surTexte: (t: string) => void): Promise<void> {
    let tampon = "";
    for (;;) {
      const { done, value } = await lecteur.read();
      if (done) return;
      tampon += decodeur.decode(value, { stream: true });
      const lignes = tampon.split("\n");
      tampon = lignes.pop() ?? "";
      for (const ligne of lignes) {
        if (!ligne.startsWith("data: ")) continue; // ignore `event:`, vides, pings
        const brut = ligne.slice(6).trim();
        if (brut === "" || brut === "[DONE]") continue;
        let evenement: unknown;
        try {
          evenement = JSON.parse(brut);
        } catch {
          continue; // ligne partielle ou bruit — le tampon gère les coupures réelles
        }
        const e = evenement as {
          type?: string;
          delta?: { type?: string; text?: string };
          error?: { message?: string };
        };
        if (e.type === "content_block_delta" && e.delta?.type === "text_delta" && e.delta.text) {
          surTexte(e.delta.text);
        } else if (e.type === "error") {
          console.error("Façade ThunderAI : erreur dans le flux Anthropic", brut);
          surTexte("\n\n*(Le service Jardi a rencontré une erreur en cours de réponse. Réessaie.)*");
        }
      }
    }
  }

  if (!veutStream) {
    // Chemin non streamé (tests PowerShell/curl) : on accumule puis on répond
    // au format `chat.completion` classique.
    let texte = "";
    await pomper((t) => {
      texte += t;
    });
    await enregistrerEchange(question, texte);
    return NextResponse.json({
      id,
      object: "chat.completion",
      created,
      model: MODELE_AFFICHE,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: texte },
          finish_reason: "stop",
        },
      ],
    });
  }

  const fluxSortant = new ReadableStream<Uint8Array>({
    async start(controleur) {
      try {
        // Premier chunk : le rôle, comme le fait l'API OpenAI.
        controleur.enqueue(encodeur.encode(ligneChunk({ role: "assistant" }, null)));
        let texteComplet = "";
        await pomper((t) => {
          texteComplet += t;
          controleur.enqueue(encodeur.encode(ligneChunk({ content: t }, null)));
        });
        controleur.enqueue(encodeur.encode(ligneChunk({}, "stop")));
        controleur.enqueue(encodeur.encode("data: [DONE]\n\n"));
        // Après le [DONE] : ThunderAI a déjà tout reçu, l'enregistrement ne
        // retarde pas l'affichage. On attend quand même — sur Vercel, la
        // fonction peut être gelée dès que le flux se ferme.
        await enregistrerEchange(question, texteComplet);
      } catch (erreur) {
        console.error("Façade ThunderAI : flux interrompu", erreur);
      } finally {
        controleur.close();
        lecteur.cancel().catch(() => {});
      }
    },
    cancel() {
      // ThunderAI a un bouton « stop » : couper aussi le flux Anthropic.
      lecteur.cancel().catch(() => {});
    },
  });

  return new Response(fluxSortant, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
