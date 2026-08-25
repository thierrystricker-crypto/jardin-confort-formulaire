// app/api/claude/voix/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// Lecture audio des réponses de Jardi — voix AI (25.08.2026).
//
// POST { texte: string } → audio/mpeg.
//
// Sécurité, mêmes principes que /api/claude/chat :
// - Route INTERNE : proxy.ts protège déjà, le cookie de session est revérifié
//   ici (défense en profondeur).
// - OPENAI_API_KEY ne vit que côté serveur. Le navigateur ne parle jamais à
//   api.openai.com : il ne connaît que cette route, sur son propre domaine.
// - Aucun CORS ouvert, donc pas d'URL publique capable de faire tourner la clé
//   aux frais de la maison.
//
// Pas de SDK `openai` : fetch direct, conformément au zéro-dépendance du projet
// (le chat appelle déjà l'API Anthropic de la même façon).
//
// Le plafond d'entrée de l'API speech est de 4096 caractères. Le découpage est
// fait côté client (lecture-audio.tsx), qui envoie des morceaux courts et
// précharge le suivant pendant la lecture du précédent — sans quoi on entend un
// blanc à chaque coupure. Le contrôle ci-dessous n'est qu'un garde-fou.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export const maxDuration = 60;

const MODELE = process.env.OPENAI_TTS_MODELE ?? "gpt-4o-mini-tts";
// alloy = celle d'autoscan-tts. Pour essayer une autre voix (nova, shimmer,
// onyx, echo, fable…), poser OPENAI_TTS_VOIX sur Vercel : aucun code à toucher.
const VOIX = process.env.OPENAI_TTS_VOIX ?? "alloy";

const MAX_CARACTERES = 4000;

// `instructions` n'existe que sur les modèles gpt-4o-*-tts. Envoyé à tts-1, il
// ferait échouer la requête.
//
// Sans consigne ferme, gpt-4o-mini-tts JOUE le texte : intonation appuyée,
// enthousiasme de speaker. Pour de la lecture d'information consultée dix fois
// par jour, c'est vite fatigant — d'où le ton délibérément plat demandé ici.
// Ajustable sans toucher au code par la variable OPENAI_TTS_TON.
const TON_PAR_DEFAUT =
  "Lis ce texte d'une voix neutre, calme et sobre, comme un collègue qui lit " +
  "une note de service à voix haute. Aucune emphase, aucun enthousiasme, pas " +
  "d'intonation appuyée en fin de phrase. Débit régulier et posé, français de " +
  "Suisse romande. Les montants en francs et les références d'articles se " +
  "lisent normalement, sans les épeler.";

const INSTRUCTIONS = process.env.OPENAI_TTS_TON ?? TON_PAR_DEFAUT;

export async function POST(req: NextRequest) {
  // Défense en profondeur : proxy.ts protège déjà, on revérifie le cookie.
  const secretSession = process.env.DASHBOARD_SESSION_SECRET;
  const cookie = req.cookies.get("jc_acces")?.value;
  if (!secretSession || cookie !== secretSession) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 401 });
  }

  const cleApi = process.env.OPENAI_API_KEY;
  if (!cleApi) {
    console.error("Voix Jardi : OPENAI_API_KEY manquant");
    return NextResponse.json({ error: "Configuration incomplète" }, { status: 500 });
  }

  let corps: unknown;
  try {
    corps = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }

  const brut = (corps as { texte?: unknown } | null)?.texte;
  const texte = typeof brut === "string" ? brut.trim() : "";
  if (!texte) {
    return NextResponse.json({ error: "Format attendu : { texte: string }" }, { status: 400 });
  }
  if (texte.length > MAX_CARACTERES) {
    return NextResponse.json(
      { error: `Texte trop long (${texte.length} caractères, plafond ${MAX_CARACTERES})` },
      { status: 400 }
    );
  }

  const charge: Record<string, unknown> = {
    model: MODELE,
    voice: VOIX,
    input: texte,
    response_format: "mp3",
  };
  if (MODELE.startsWith("gpt-4o")) charge.instructions = INSTRUCTIONS;

  let reponse: Response;
  try {
    reponse = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cleApi}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(charge),
    });
  } catch (e) {
    console.error("Voix Jardi : appel OpenAI injoignable", e);
    return NextResponse.json({ error: "Service vocal injoignable" }, { status: 502 });
  }

  if (!reponse.ok) {
    // Le corps d'erreur d'OpenAI est du JSON : on le journalise côté serveur et
    // on ne renvoie qu'un message neutre au navigateur.
    const detail = await reponse.text().catch(() => "");
    console.error("Voix Jardi : OpenAI a répondu", reponse.status, detail.slice(0, 500));
    return NextResponse.json(
      { error: "Le service vocal a refusé la demande" },
      { status: 502 }
    );
  }

  const audio = await reponse.arrayBuffer();
  return new NextResponse(audio, {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Content-Length": String(audio.byteLength),
      "Cache-Control": "no-store",
    },
  });
}
