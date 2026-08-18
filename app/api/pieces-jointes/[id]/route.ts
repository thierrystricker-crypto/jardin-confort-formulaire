// app/api/pieces-jointes/[id]/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// Annexes d'un dossier — édition et suppression douce (chantier annexes,
// 18.08.2026, doc 14 §5.3).
//
// PATCH  { libelle?, categorie? } — liste blanche STRICTE : rien d'autre n'est
//        modifiable (ni chemin, ni entity_*, ni mime). La catégorie
//        `scan_commande` est figée dans les deux sens : on ne l'attribue pas à
//        la main, et on ne la retire pas à un scan (c'est la preuve papier).
// DELETE suppression DOUCE partout (`supprime_at = now()`), brouillons compris.
//        Une annexe de commande participe de la preuve ; le fichier reste dans
//        le bucket (archive), seule la ligne est masquée.
//
// Route absente des listes publiques de proxy.ts → protégée par défaut ;
// cookie revérifié ici (défense en profondeur).
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

const CATEGORIES_MANUELLES = new Set(["plan_client", "photo", "document", "autre"]);
const UUID_FORME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function accesRefuse(req: NextRequest): boolean {
  const secretSession = process.env.DASHBOARD_SESSION_SECRET;
  const cookie = req.cookies.get("jc_acces")?.value;
  return !secretSession || cookie !== secretSession;
}

function nettoyer(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/[\u0000-\u001F\u007F]/g, "").trim();
  return t ? t.slice(0, max) : null;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (accesRefuse(req)) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 401 });
  }
  const { id } = await params;
  if (!UUID_FORME.test(id)) {
    return NextResponse.json({ error: "Identifiant invalide" }, { status: 400 });
  }

  let corps: Record<string, unknown>;
  try {
    corps = await req.json();
  } catch {
    return NextResponse.json({ error: "Corps illisible" }, { status: 400 });
  }

  const maj: Record<string, string | null> = {};

  if ("libelle" in corps) {
    // Libellé vidé volontairement → null (on retombe sur le nom de fichier).
    maj.libelle = nettoyer(corps.libelle, 120);
  }
  if ("categorie" in corps) {
    const cat = nettoyer(corps.categorie, 30);
    if (!cat || !CATEGORIES_MANUELLES.has(cat)) {
      return NextResponse.json(
        { error: "Catégorie invalide (plan_client, photo, document ou autre)" },
        { status: 400 }
      );
    }
    maj.categorie = cat;
  }

  if (Object.keys(maj).length === 0) {
    return NextResponse.json({ error: "Rien à modifier" }, { status: 400 });
  }

  // Un scan de commande garde sa catégorie : c'est le badge « preuve papier ».
  let requete = supabaseAdmin
    .from("pieces_jointes")
    .update(maj)
    .eq("id", id)
    .is("supprime_at", null);
  if ("categorie" in maj) {
    requete = requete.neq("categorie", "scan_commande");
  }
  const { data, error } = await requete
    .select("id, categorie, nom_fichier, libelle, mime, taille_octets, ajoute_par, created_at")
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: "Erreur base de données : " + error.message },
      { status: 500 }
    );
  }
  if (!data) {
    return NextResponse.json(
      { error: "Pièce introuvable, supprimée, ou catégorie protégée (scan)" },
      { status: 404 }
    );
  }
  return NextResponse.json({ success: true, piece: data });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (accesRefuse(req)) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 401 });
  }
  const { id } = await params;
  if (!UUID_FORME.test(id)) {
    return NextResponse.json({ error: "Identifiant invalide" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("pieces_jointes")
    .update({ supprime_at: new Date().toISOString() })
    .eq("id", id)
    .is("supprime_at", null)
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: "Erreur base de données : " + error.message },
      { status: 500 }
    );
  }
  if (!data) {
    return NextResponse.json({ error: "Pièce introuvable ou déjà supprimée" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
