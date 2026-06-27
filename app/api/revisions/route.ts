// app/api/revisions/route.ts
// Lecture seule de l'historique des revisions d'une commande (table commandes_revisions).
// Source unique pour : section "Articles retires" (fiche de travail),
// bandeau "revisee N fois" + historique (dashboard).
// L'historique est immuable -> GET uniquement.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase";

// Forme du diff lisible (cf. lib/revision-diff.ts -> RevisionDiff).
// Tout est optionnel a la lecture : on tolere les diffs anciens/partiels.
type RevisionDiffShape = {
  ajouts?: { sku: string; title: string; qty: number }[];
  retraits?: { sku: string; title: string; qty: number }[];
  qtyChanges?: { sku: string; title: string; avant: number; apres: number }[];
  prixChanges?: { sku: string; title: string; avant: number; apres: number }[];
  remiseChanges?: { sku: string; title: string; avant: number; apres: number }[];
  enteteChanges?: { champ: string; avant: string; apres: string }[];
};

type RevisionRow = {
  version_num: number;
  commercial: string | null;
  created_at: string;
  diff: RevisionDiffShape;
};

// Le diff peut etre stocke soit en jsonb (objet), soit en texte JSON (string
// avec \n echappes, vu sur les revisions reelles). On normalise en objet.
function parseDiff(raw: unknown): RevisionDiffShape {
  if (raw && typeof raw === "object") return raw as RevisionDiffShape;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? (parsed as RevisionDiffShape) : {};
    } catch {
      return {};
    }
  }
  return {};
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const commandeSlug = searchParams.get("commande_slug");

  if (!commandeSlug || typeof commandeSlug !== "string") {
    return NextResponse.json(
      { error: "commande_slug requis (string)" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("commandes_revisions")
    .select("version_num, commercial, created_at, diff")
    .eq("commande_slug", commandeSlug)
    .order("version_num", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const revisions: RevisionRow[] = (data || []).map((r) => ({
    version_num: r.version_num,
    commercial: r.commercial ?? null,
    created_at: r.created_at,
    diff: parseDiff(r.diff),
  }));

  // Snapshot de la V1 = etat d'origine de la commande (avant toute revision).
  // On en extrait juste les id de lignes -> permet a la fiche de travail de
  // distinguer une ligne AJOUTEE (id absent de l'origine) d'une ligne d'origine.
  // .maybeSingle() : null sans erreur si pas de V1 (commande jamais revisee).
  let idsOrigine: string[] = [];
  const { data: v1 } = await supabase
    .from("commandes_revisions")
    .select("data_avant")
    .eq("commande_slug", commandeSlug)
    .eq("version_num", 1)
    .maybeSingle();
  if (v1?.data_avant && typeof v1.data_avant === "object") {
    const lines = (v1.data_avant as { lines?: { id?: string }[] }).lines || [];
    idsOrigine = lines
      .map((l) => l.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
  }

  // count = nombre de revisions archivees ; version vivante = count + 1.
  return NextResponse.json({
    revisions,
    count: revisions.length,
    versionVivante: revisions.length + 1,
    idsOrigine,
  });
}