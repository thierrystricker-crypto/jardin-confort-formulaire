// app/api/claude/upload/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// Dépôt d'un fichier destiné au chat Jardi (chantier Scan, Lot 2 — 18.08.2026).
//
// POST multipart, UN fichier par appel :
//   champ `file` → { piece_id, file_id, media_type, nom, taille }
//
// ── L'ordre d'écriture est la garantie de confidentialité ────────────────────
// Un fichier confié à la Files API d'Anthropic persiste jusqu'à suppression
// explicite et n'est pas éligible ZDR ; nos scans portent des données client
// nominatives. La purge à 24 h (/api/cron/claude-files-purge) est donc
// CONDITIONNÉE à l'existence d'une archive chez nous :
//
//   1. Storage Supabase (bucket `annexes`)   ← l'archive, jamais purgée
//   2. ligne `pieces_jointes`                 ← ce qui pilote la purge
//   3. API Files d'Anthropic                  ← la copie de travail, TTL 24 h
//   4. `claude_file_id` posé sur la ligne     ← ce qui la rend purgeable
//
// Si (1) ou (2) échoue, RIEN ne part chez Anthropic — la condition est
// structurelle, pas une discipline (doc 04 : « ne rien écrire vaut mieux
// qu'écrire à moitié »).
//
// Si (4) échoue alors que (3) a réussi, la copie Anthropic serait invisible de
// la purge — donc INEFFAÇABLE. On la supprime immédiatement et on refuse
// l'upload. Une archive locale orpheline (`claude_file_id NULL`) est sans
// conséquence ; une copie non purgeable chez un tiers en a une.
//
// Sécurité :
// - `/api/claude/upload` n'est dans aucune liste publique de proxy.ts : il est
//   protégé par défaut (cookie `jc_acces`). La vérification est refaite ici,
//   même motif que /api/claude/chat et /api/claude/conversations.
// - ANTHROPIC_API_KEY ne vit que côté serveur.
// - Liste blanche de types, plafond de taille : Vercel refuse un corps au-delà
//   de ~4,5 Mo, le plafond de 32 Mo de l'API Anthropic est hors d'atteinte.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase";

export const maxDuration = 60;

const BUCKET = "annexes";

// Types acceptés à l'entrée. Le bucket accepte aussi image/heic (doc 14 §4),
// mais le navigateur ré-encode toute image en JPEG avant l'envoi : un HEIC ne
// devrait jamais arriver ici. On ne l'ouvre pas côté route — l'API Anthropic ne
// le lit pas non plus.
const TYPES_AUTORISES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

// Vercel plafonne le corps d'une requête de fonction à ~4,5 Mo — PAS les 32 Mo
// de l'API Anthropic. On borne en dessous pour rendre l'erreur lisible plutôt
// que de laisser la plateforme couper.
const TAILLE_MAX = 4 * 1024 * 1024;

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

// Le nom d'origine ne sert QU'À l'affichage et au téléchargement : il ne va
// jamais dans le chemin Storage (le photocopieur écrit « …53864_RAPPAZ__MAXIME… »
// dans ses noms de fichier — inutile que ça se promène dans les URL et les
// journaux Vercel). On retire seulement les caractères de contrôle.
function nomLisible(brut: string): string {
  const propre = brut
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return propre.slice(0, 200) || "fichier";
}

async function supprimerChezAnthropic(fileId: string, cleApi: string): Promise<void> {
  try {
    const r = await fetch(`https://api.anthropic.com/v1/files/${encodeURIComponent(fileId)}`, {
      method: "DELETE",
      headers: {
        "x-api-key": cleApi,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "files-api-2025-04-14",
      },
    });
    if (!r.ok && r.status !== 404) {
      console.error(
        `[claude/upload] Rattrapage impossible : ${fileId} reste chez Anthropic (${r.status})`
      );
    }
  } catch (err) {
    console.error(`[claude/upload] Rattrapage impossible : ${fileId}`, err);
  }
}

export async function POST(req: NextRequest) {
  // Défense en profondeur : proxy.ts protège déjà, on revérifie le cookie.
  const secretSession = process.env.DASHBOARD_SESSION_SECRET;
  const cookie = req.cookies.get("jc_acces")?.value;
  if (!secretSession || cookie !== secretSession) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 401 });
  }

  const cleApi = process.env.ANTHROPIC_API_KEY;
  if (!cleApi) {
    console.error("[claude/upload] ANTHROPIC_API_KEY manquant");
    return NextResponse.json({ error: "Configuration incomplète" }, { status: 500 });
  }

  // ── 0. Lecture du fichier ──────────────────────────────────────────────────
  let formulaire: FormData;
  try {
    formulaire = await req.formData();
  } catch {
    return NextResponse.json({ error: "Envoi illisible" }, { status: 400 });
  }

  const champ = formulaire.get("file");
  if (!(champ instanceof File)) {
    return NextResponse.json({ error: "Aucun fichier reçu" }, { status: 400 });
  }

  const mime = champ.type;
  if (!TYPES_AUTORISES.has(mime)) {
    return NextResponse.json(
      { error: "Format non accepté. Photo (JPEG, PNG, WebP) ou PDF uniquement." },
      { status: 415 }
    );
  }
  if (champ.size === 0) {
    return NextResponse.json({ error: "Fichier vide" }, { status: 400 });
  }
  if (champ.size > TAILLE_MAX) {
    return NextResponse.json(
      {
        error:
          "Fichier trop lourd (max 4 Mo). Pour un PDF multipage du photocopieur, " +
          "photographie les pages une à une.",
      },
      { status: 413 }
    );
  }

  const octets = Buffer.from(await champ.arrayBuffer());
  const nom = nomLisible(champ.name || "fichier");
  const empreinte = createHash("sha256").update(octets).digest("hex");

  const pieceId = randomUUID();
  const chemin = `chat/${pieceId}.${EXTENSIONS[mime]}`;

  // ── 1. Archive : Supabase Storage ──────────────────────────────────────────
  const { error: erreurStorage } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(chemin, octets, { contentType: mime, upsert: false });

  if (erreurStorage) {
    console.error("[claude/upload] Échec Storage :", erreurStorage.message);
    return NextResponse.json(
      { error: "Archivage impossible — le fichier n'a pas été transmis." },
      { status: 502 }
    );
  }

  // ── 2. Archive : ligne pieces_jointes ──────────────────────────────────────
  // `entity_id` reste NULL : le rattachement au DRA appartient au chantier
  // annexes (doc 14 §6, étapes 3 à 5), pas au Lot 2. Le scan reste retrouvable
  // par `categorie = 'scan_commande'` et par le n° manuscrit dans `nom_fichier`.
  const { error: erreurLigne } = await supabaseAdmin.from("pieces_jointes").insert({
    id: pieceId,
    categorie: "scan_commande",
    nom_fichier: nom,
    chemin,
    mime,
    taille_octets: octets.length,
    content_hash: empreinte,
    ajoute_par: "Claude",
  });

  if (erreurLigne) {
    console.error("[claude/upload] Échec pieces_jointes :", erreurLigne.message);
    // L'objet Storage sans sa ligne serait invisible : on le retire.
    const { error: erreurRetrait } = await supabaseAdmin.storage.from(BUCKET).remove([chemin]);
    if (erreurRetrait) {
      // Objet sans ligne : invisible de tout inventaire, jamais nettoyé.
      console.error(`[claude/upload] OBJET ORPHELIN dans ${BUCKET} : ${chemin}`, erreurRetrait.message);
    }
    return NextResponse.json(
      { error: "Archivage impossible — le fichier n'a pas été transmis." },
      { status: 502 }
    );
  }

  // ── 3. Copie de travail : API Files d'Anthropic ────────────────────────────
  let fileId: string;
  try {
    const envoi = new FormData();
    envoi.append("file", new Blob([new Uint8Array(octets)], { type: mime }), nom);

    const reponse = await fetch("https://api.anthropic.com/v1/files", {
      method: "POST",
      headers: {
        "x-api-key": cleApi,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "files-api-2025-04-14",
      },
      body: envoi,
    });

    if (!reponse.ok) {
      const detail = await reponse.text().catch(() => "(corps illisible)");
      console.error("[claude/upload] Erreur API Files", reponse.status, detail);
      if (reponse.status >= 500) {
        // Un 5xx ne dit pas si le fichier a été créé avant l'erreur.
        console.error(
          `[claude/upload] ORPHELIN POSSIBLE piece=${pieceId} nom=${nom} — ` +
          `rapprocher GET /v1/files avec pieces_jointes.claude_file_id`
        );
      }
      return NextResponse.json(
        { error: `Le service a répondu ${reponse.status}. Réessaie dans un instant.` },
        { status: 502 }
      );
    }

    const json = (await reponse.json()) as { id?: unknown };
    if (typeof json.id !== "string" || !json.id) {
      // Le fichier existe peut-être chez Anthropic sans qu'on sache le nommer :
      // la purge, pilotée par notre table, ne pourra jamais l'atteindre.
      console.error(
        `[claude/upload] ORPHELIN POSSIBLE piece=${pieceId} nom=${nom} — ` +
        `réponse API Files sans identifiant exploitable`
      );
      return NextResponse.json({ error: "Réponse inattendue du service" }, { status: 502 });
    }
    fileId = json.id;
  } catch (err) {
    // Coupure, RST, fin de maxDuration : le POST a PU aboutir côté Anthropic.
    // C'est le seul chemin qui produit une copie que la purge ne verra jamais.
    console.error("[claude/upload] Appel API Files impossible :", err);
    console.error(
      `[claude/upload] ORPHELIN POSSIBLE piece=${pieceId} nom=${nom} — ` +
      `rapprocher GET /v1/files avec pieces_jointes.claude_file_id`
    );
    return NextResponse.json({ error: "Service indisponible" }, { status: 502 });
  }

  // ── 4. Rendre la copie purgeable ───────────────────────────────────────────
  // Tant que `claude_file_id` n'est pas posé, la purge ignore ce fichier : il
  // resterait chez Anthropic indéfiniment. Si l'écriture échoue, on retire la
  // copie tout de suite plutôt que de laisser un fichier ineffaçable.
  const { error: erreurMaj } = await supabaseAdmin
    .from("pieces_jointes")
    .update({ claude_file_id: fileId })
    .eq("id", pieceId);

  if (erreurMaj) {
    console.error("[claude/upload] Échec claude_file_id :", erreurMaj.message);
    await supprimerChezAnthropic(fileId, cleApi);
    return NextResponse.json(
      { error: "Transmission annulée — réessaie dans un instant." },
      { status: 502 }
    );
  }

  return NextResponse.json({
    piece_id: pieceId,
    file_id: fileId,
    media_type: mime,
    nom,
    taille: octets.length,
  });
}
