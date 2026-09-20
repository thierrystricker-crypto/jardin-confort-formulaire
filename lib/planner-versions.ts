// lib/planner-versions.ts  (serveur)
// Figer une version d'une scène du planner (V1, V2…) avec son jeton propre.
// Utilisé par POST /api/planner/scenes/[id]/versions (fiche à l'écran) et
// POST /api/planner/scenes/[id]/pdf (fiche PDF via pdf.co).
//
// Règles :
//   - la version copie la scène TELLE QU'ENREGISTRÉE en base ;
//   - si la scène n'a pas bougé depuis la dernière version, on réutilise
//     celle-ci (pas de V1, V2, V3 identiques) ;
//   - la capture (PNG de la vue, envoyée par le navigateur) et les cotes 3D
//     mesurées (dims par uid) sont rattachées à la version : le PDF est rendu
//     côté serveur, sans WebGL, à partir de ces données.

import { randomBytes } from "crypto";
import { supabaseAdmin } from "@/lib/supabase";
import type { SceneItem } from "@/lib/planner-types";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
export const BUCKET = "pdfs";              // bucket public existant (offres, commandes)

export type VersionFigee = {
  id: string;
  scene_id: string;
  numero: number;
  token: string;
  cree_le: string;
  capture_url: string | null;
  pdf_url: string | null;
  pdf_sans_prix_url: string | null;
  reutilisee: boolean;
};

export function urlPublique(chemin: string): string {
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${chemin}`;
}

// PNG data URL → Storage. Renvoie l'URL publique ou null.
export async function deposerCapture(token: string, dataUrl: string): Promise<string | null> {
  const m = /^data:image\/png;base64,(.+)$/.exec(dataUrl || "");
  if (!m) return null;
  const buf = Buffer.from(m[1], "base64");
  if (buf.length > 8_000_000) return null;
  const chemin = `planner/${token}.png`;
  const { error } = await supabaseAdmin.storage.from(BUCKET).upload(chemin, buf, { contentType: "image/png", upsert: true });
  if (error) { console.error("[planner] capture:", error.message); return null; }
  return `${urlPublique(chemin)}?v=${Date.now()}`;
}

export async function figerVersion(
  sceneId: string,
  motif: string,
  extras: { capture?: string | null; dims?: Record<string, { l: number; p: number; h: number }> } = {},
): Promise<VersionFigee | { error: string; status: number }> {
  const { data: s, error } = await supabaseAdmin
    .from("planner_scenes")
    .select("id, nom, terrasse, sol, items, mode, vue, cree_par, updated_at")
    .eq("id", sceneId)
    .maybeSingle();
  if (error) return { error: error.message, status: 500 };
  if (!s) return { error: "Scène introuvable", status: 404 };

  const { data: derniere } = await supabaseAdmin
    .from("planner_scenes_versions")
    .select("id, scene_id, numero, token, cree_le, capture_url, pdf_url, pdf_sans_prix_url")
    .eq("scene_id", sceneId)
    .order("numero", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Réutilisation si rien n'a bougé ; on complète la capture si elle manque.
  if (derniere && s.updated_at && new Date(derniere.cree_le as string) >= new Date(s.updated_at as string)) {
    let captureUrl = derniere.capture_url as string | null;
    if (!captureUrl && extras.capture) {
      captureUrl = await deposerCapture(derniere.token as string, extras.capture);
      if (captureUrl) await supabaseAdmin.from("planner_scenes_versions").update({ capture_url: captureUrl }).eq("id", derniere.id);
    }
    return { ...(derniere as Omit<VersionFigee, "reutilisee">), capture_url: captureUrl, reutilisee: true };
  }

  const numero = ((derniere?.numero as number) || 0) + 1;
  const token = randomBytes(16).toString("hex");
  const items = ((s.items as SceneItem[]) || []).map((it) => {
    const d = extras.dims?.[it.uid];
    return d ? { ...it, dims: { l: d.l, p: d.p, h: d.h } } : it;
  });
  const captureUrl = extras.capture ? await deposerCapture(token, extras.capture) : null;
  const { data: v, error: e2 } = await supabaseAdmin
    .from("planner_scenes_versions")
    .insert({
      scene_id: sceneId, numero, token, motif: motif.slice(0, 20),
      nom: s.nom, terrasse: s.terrasse, sol: s.sol || "bois", items, mode: s.mode, vue: s.vue,
      cree_par: s.cree_par, capture_url: captureUrl,
    })
    .select("id, scene_id, numero, token, cree_le, capture_url, pdf_url, pdf_sans_prix_url")
    .single();
  if (e2) return { error: e2.message, status: 500 };
  return { ...(v as Omit<VersionFigee, "reutilisee">), reutilisee: false };
}
