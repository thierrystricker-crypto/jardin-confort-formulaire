// app/api/pieces-jointes/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// Annexes d'un dossier — dépôt manuel depuis le dashboard (chantier annexes,
// 18.08.2026, doc 14 §9 étapes 2-3).
//
// POST  multipart, UN fichier par appel :
//         file, entity_type (draft|offre|commande), entity_slug,
//         libelle?, categorie?, ajoute_par?
//       → { success, piece }
// GET   ?entity_type=…&entity_slug=… → { pieces, count } (non supprimées,
//       scan épinglé en tête puis date de dépôt croissante)
//
// - La table `pieces_jointes` et le bucket `annexes` existent depuis le Lot 2
//   du chantier scan (migration docs/sql/009). AUCUNE écriture sur `offres`,
//   `drafts` ou leur `data` : on ne fait que LIRE id/slug pour résoudre la
//   cible. Les 5 RPC du connecteur ne sont pas concernées.
// - Le chemin Storage est `<entity_type>/<uuid>.<ext>` — jamais le nom
//   d'origine (le photocopieur écrit « …53864_RAPPAZ__MAXIME… » dans ses noms).
//   Le nom d'origine ne vit qu'en base, pour l'affichage et le téléchargement.
// - `scan_commande` est RÉSERVÉ au flux du chat (/api/claude/upload) : c'est ce
//   qui garde au badge « preuve papier » son sens dans la carte.
// - Ordre d'écriture : Storage PUIS ligne ; si la ligne échoue, on retire
//   l'objet (même motif que /api/claude/upload — ne rien écrire vaut mieux
//   qu'écrire à moitié).
// - Route absente des listes publiques de proxy.ts → protégée par défaut.
//   Le cookie est revérifié ici (défense en profondeur, même motif que
//   /api/claude/upload). L'URL publique du fichier n'apparaît que dans ces
//   réponses internes, jamais sur une page publique.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase";

export const maxDuration = 60;

const BUCKET = "annexes";

const ENTITES = new Set(["draft", "offre", "commande"]);

// Catégories déposables À LA MAIN — scan_commande exclu, réservé au chat.
const CATEGORIES_MANUELLES = new Set(["plan_client", "photo", "document", "autre"]);

// Types acceptés à l'entrée. Le bucket accepte aussi image/heic, mais le
// navigateur ré-encode toute image en JPEG avant l'envoi (lib/preparer-fichier).
const TYPES_AUTORISES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

// Vercel plafonne le corps d'une requête de fonction à ~4,5 Mo — le 20 Mo du
// bucket est un garde-fou natif, pas une capacité. On borne en dessous pour
// rendre l'erreur lisible plutôt que de laisser la plateforme couper.
const TAILLE_MAX = 4 * 1024 * 1024;

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

function nomLisible(brut: string): string {
  const propre = brut
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return propre.slice(0, 200) || "fichier";
}

function texteCourt(v: FormDataEntryValue | null, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/[\u0000-\u001F\u007F]/g, "").trim();
  return t ? t.slice(0, max) : null;
}

function urlPublique(chemin: string): string | null {
  const { data } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(chemin);
  return data?.publicUrl || null;
}

function accesRefuse(req: NextRequest): boolean {
  const secretSession = process.env.DASHBOARD_SESSION_SECRET;
  const cookie = req.cookies.get("jc_acces")?.value;
  return !secretSession || cookie !== secretSession;
}

// Résout la cible (id + slug canonique) et vérifie la cohérence du type.
async function resoudreCible(
  entityType: string,
  entitySlug: string
): Promise<{ id: number } | { erreur: string; statut: number }> {
  if (entityType === "draft") {
    const { data, error } = await supabaseAdmin
      .from("drafts")
      .select("id")
      .eq("slug", entitySlug)
      .maybeSingle();
    if (error) return { erreur: "Erreur base de données : " + error.message, statut: 500 };
    if (!data) return { erreur: "Brouillon introuvable", statut: 404 };
    return { id: data.id as number };
  }
  const { data, error } = await supabaseAdmin
    .from("offres")
    .select("id, type_document")
    .eq("slug", entitySlug)
    .maybeSingle();
  if (error) return { erreur: "Erreur base de données : " + error.message, statut: 500 };
  if (!data) return { erreur: "Document introuvable", statut: 404 };
  const attendu = entityType === "commande" ? "Commande" : "Offre";
  if (data.type_document !== attendu) {
    return {
      erreur: `Type incohérent : ${entitySlug} est « ${data.type_document} », pas « ${attendu} »`,
      statut: 400,
    };
  }
  return { id: data.id as number };
}

// ── POST : dépôt d'une pièce ─────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  if (accesRefuse(req)) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 401 });
  }

  let formulaire: FormData;
  try {
    formulaire = await req.formData();
  } catch {
    return NextResponse.json({ error: "Envoi illisible" }, { status: 400 });
  }

  const entityType = texteCourt(formulaire.get("entity_type"), 20) || "";
  const entitySlug = texteCourt(formulaire.get("entity_slug"), 120) || "";
  if (!ENTITES.has(entityType) || !entitySlug) {
    return NextResponse.json(
      { error: "Cible invalide (entity_type draft|offre|commande + entity_slug requis)" },
      { status: 400 }
    );
  }

  const categorie = texteCourt(formulaire.get("categorie"), 30) || "document";
  if (!CATEGORIES_MANUELLES.has(categorie)) {
    return NextResponse.json(
      { error: "Catégorie invalide (plan_client, photo, document ou autre)" },
      { status: 400 }
    );
  }

  const libelle = texteCourt(formulaire.get("libelle"), 120);
  const ajoutePar = texteCourt(formulaire.get("ajoute_par"), 60) || "Dashboard";

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
      { error: "Fichier trop lourd (max 4 Mo). Pour un gros PDF, découpe-le ou photographie les pages." },
      { status: 413 }
    );
  }

  // ── Cible ──
  const cible = await resoudreCible(entityType, entitySlug);
  if ("erreur" in cible) {
    return NextResponse.json({ error: cible.erreur }, { status: cible.statut });
  }

  const octets = Buffer.from(await champ.arrayBuffer());
  const nom = nomLisible(champ.name || "fichier");
  const empreinte = createHash("sha256").update(octets).digest("hex");

  // ── Déduplication : même contenu, même dossier, non supprimé → refus ──
  const { data: doublon, error: erreurDoublon } = await supabaseAdmin
    .from("pieces_jointes")
    .select("id, nom_fichier, libelle, categorie, created_at")
    .eq("entity_type", entityType)
    .eq("entity_slug", entitySlug)
    .eq("content_hash", empreinte)
    .is("supprime_at", null)
    .limit(1)
    .maybeSingle();
  if (erreurDoublon) {
    return NextResponse.json(
      { error: "Erreur base de données : " + erreurDoublon.message },
      { status: 500 }
    );
  }
  if (doublon) {
    return NextResponse.json(
      {
        error: `Ce fichier est déjà dans le dossier (« ${doublon.libelle || doublon.nom_fichier} », déposé le ${new Date(doublon.created_at as string).toLocaleDateString("fr-CH")}).`,
        deja: doublon,
      },
      { status: 409 }
    );
  }

  const pieceId = randomUUID();
  const chemin = `${entityType}/${pieceId}.${EXTENSIONS[mime]}`;

  // ── 1. Storage ──
  const { error: erreurStorage } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(chemin, octets, { contentType: mime, upsert: false });
  if (erreurStorage) {
    console.error("[pieces-jointes] Échec Storage :", erreurStorage.message);
    return NextResponse.json(
      { error: "Dépôt impossible — le fichier n'a pas été enregistré." },
      { status: 502 }
    );
  }

  // ── 2. Ligne pieces_jointes ──
  const ligne = {
    id: pieceId,
    entity_type: entityType,
    entity_id: cible.id,
    entity_slug: entitySlug,
    categorie,
    nom_fichier: nom,
    libelle,
    chemin,
    mime,
    taille_octets: octets.length,
    content_hash: empreinte,
    ajoute_par: ajoutePar,
  };
  const { data: inseree, error: erreurLigne } = await supabaseAdmin
    .from("pieces_jointes")
    .insert(ligne)
    .select("id, entity_type, entity_slug, categorie, nom_fichier, libelle, mime, taille_octets, ajoute_par, created_at")
    .single();

  if (erreurLigne || !inseree) {
    console.error("[pieces-jointes] Échec insertion :", erreurLigne?.message);
    // L'objet Storage sans sa ligne serait invisible : on le retire.
    const { error: erreurRetrait } = await supabaseAdmin.storage.from(BUCKET).remove([chemin]);
    if (erreurRetrait) {
      console.error(`[pieces-jointes] OBJET ORPHELIN dans ${BUCKET} : ${chemin}`, erreurRetrait.message);
    }
    return NextResponse.json(
      { error: "Dépôt impossible — le fichier n'a pas été enregistré." },
      { status: 502 }
    );
  }

  return NextResponse.json({
    success: true,
    piece: { ...inseree, url: urlPublique(chemin) },
  });
}

// ── GET : pièces d'un dossier ────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  if (accesRefuse(req)) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const entityType = searchParams.get("entity_type") || "";
  const entitySlug = searchParams.get("entity_slug") || "";
  if (!ENTITES.has(entityType) || !entitySlug) {
    return NextResponse.json(
      { error: "Cible invalide (entity_type draft|offre|commande + entity_slug requis)" },
      { status: 400 }
    );
  }

  const { data, error } = await supabaseAdmin
    .from("pieces_jointes")
    .select("id, categorie, nom_fichier, libelle, chemin, mime, taille_octets, ajoute_par, created_at")
    .eq("entity_type", entityType)
    .eq("entity_slug", entitySlug)
    .is("supprime_at", null)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json(
      { error: "Erreur base de données : " + error.message },
      { status: 500 }
    );
  }

  // Le scan (preuve papier) est épinglé en tête, le reste suit par date de
  // dépôt. Le `chemin` ne sort pas de la réponse — l'URL publique suffit.
  const lignes = (data || []).slice().sort((a, b) => {
    const sa = a.categorie === "scan_commande" ? 0 : 1;
    const sb = b.categorie === "scan_commande" ? 0 : 1;
    if (sa !== sb) return sa - sb;
    return String(a.created_at).localeCompare(String(b.created_at));
  });

  const pieces = lignes.map(({ chemin, ...reste }) => ({
    ...reste,
    url: urlPublique(chemin as string),
  }));

  return NextResponse.json({ pieces, count: pieces.length });
}
