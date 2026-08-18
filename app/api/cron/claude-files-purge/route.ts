// app/api/cron/claude-files-purge/route.ts
//
// Tâche planifiée : efface des serveurs d'Anthropic les fichiers soumis au chat
// Jardi il y a plus de 24 h (chantier Scan, Lot 2 — 18.08.2026).
//
// Un fichier confié à la Files API persiste jusqu'à suppression explicite et
// n'est pas éligible ZDR ; nos scans portent des données client nominatives.
// 24 h couvre la journée de travail du vendeur, conversation multi-tours
// comprise, et borne la rétention à une valeur simple à énoncer.
//
// ⚠️ La purge est pilotée par NOTRE table, pas par `GET /v1/files` :
//   - on ne supprime que ce dont on détient une copie archivée (bucket
//     `annexes` + ligne `pieces_jointes`) ;
//   - on ne touche jamais un fichier déposé dans le workspace de la clé par un
//     autre usage — un balayage aveugle du workspace, lui, le ferait.
//   - l'archive locale, elle, n'est JAMAIS purgée. Seule la copie de travail
//     chez Anthropic disparaît.
//
// Vercel appelle en GET et joint `Authorization: Bearer $CRON_SECRET`. La route
// porte son authentification, le proxy la laisse simplement passer
// (`/api/cron/*` est déjà prévu par proxy.ts — rien à y changer).

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TTL_HEURES = 24;
const LOT_MAX = 200;
// Marge sous maxDuration : chaque ligne coûte un DELETE distant + un UPDATE.
// On préfère rendre la main avec `reste_a_traiter` que se faire couper au
// milieu d'une ligne — la cadence horaire rattrape le reste.
const BUDGET_MS = 45_000;

function autorise(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron/claude-files-purge] CRON_SECRET absent des variables d'environnement");
    return false;
  }
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: NextRequest) {
  if (!autorise(request)) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const cleApi = process.env.ANTHROPIC_API_KEY;
  if (!cleApi) {
    console.error("[cron/claude-files-purge] ANTHROPIC_API_KEY manquant");
    return NextResponse.json({ error: "Configuration incomplète" }, { status: 500 });
  }

  const limite = new Date(Date.now() - TTL_HEURES * 3600_000).toISOString();

  const { data: aPurger, error } = await supabaseAdmin
    .from("pieces_jointes")
    .select("id, claude_file_id")
    .not("claude_file_id", "is", null)
    .lt("created_at", limite)
    // Du plus ancien au plus récent : sans tri, quelques lignes en échec
    // permanent (identifiant invalide → 400, jamais 404) occuperaient une part
    // fixe de chaque lot et retarderaient indéfiniment les fichiers récents.
    .order("created_at", { ascending: true })
    .limit(LOT_MAX);

  if (error) {
    console.error("[cron/claude-files-purge] Lecture impossible :", error.message);
    return NextResponse.json({ success: false, error: "Erreur base de données" }, { status: 500 });
  }

  let supprimes = 0;
  let deja = 0;
  let interrompu = false;
  const echecs: string[] = [];
  const depart = Date.now();

  for (const ligne of aPurger ?? []) {
    if (Date.now() - depart > BUDGET_MS) {
      interrompu = true;
      break;
    }
    const fileId = ligne.claude_file_id as string;
    let effacee = false;

    try {
      const r = await fetch(`https://api.anthropic.com/v1/files/${encodeURIComponent(fileId)}`, {
        method: "DELETE",
        headers: {
          "x-api-key": cleApi,
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "files-api-2025-04-14",
        },
      });
      if (r.ok) {
        effacee = true;
        supprimes++;
      } else if (r.status === 404) {
        // Déjà absent chez Anthropic. Il FAUT quand même remettre la colonne à
        // NULL : sans ça la ligne resterait éternellement dans la file de purge
        // et masquerait les vrais échecs à chaque passage.
        effacee = true;
        deja++;
      } else {
        echecs.push(`${fileId} (${r.status})`);
      }
    } catch (err) {
      echecs.push(`${fileId} (${(err as Error).message})`);
    }

    if (effacee) {
      // La colonne repasse à NULL : la copie chez Anthropic n'existe plus.
      // La ligne, le chemin Storage et le fichier archivé restent intacts.
      const { error: erreurMaj } = await supabaseAdmin
        .from("pieces_jointes")
        .update({ claude_file_id: null })
        .eq("id", ligne.id);
      if (erreurMaj) {
        // Le fichier est bien parti : la prochaine passe retombera sur un 404
        // et refermera la ligne. Signalé, pas bloquant.
        console.error(
          `[cron/claude-files-purge] claude_file_id non remis a NULL sur ${ligne.id} :`,
          erreurMaj.message
        );
      }
    }
  }

  const reste = interrompu || (aPurger?.length ?? 0) === LOT_MAX;

  console.log(
    `[cron/claude-files-purge] ${supprimes} supprime(s), ${deja} deja absent(s), ` +
    `${echecs.length} echec(s), interrompu=${interrompu}, reste_a_traiter=${reste}`
  );
  if (echecs.length > 0) {
    console.error("[cron/claude-files-purge] Echecs :", echecs.join(" · ").slice(0, 500));
  }

  return NextResponse.json({
    success: echecs.length === 0,
    examines: aPurger?.length ?? 0,
    supprimes,
    deja_absents: deja,
    echecs,
    reste_a_traiter: reste,
  });
}
