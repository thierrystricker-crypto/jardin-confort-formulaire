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

// Empreinte du contenu d'un plan : ce qui compte pour le client. Les cotes
// mesurées (dims) sont ajoutées par le canvas et ignorées ; position au cm,
// rotation au degré (rot et rot_fix sont déjà en degrés).
function empreinte(nom: unknown, terrasse: unknown, sol: unknown, items: unknown): string {
  const its = (Array.isArray(items) ? (items as SceneItem[]) : [])
    .map((it) => [it.product_id, it.variant_id || "", it.sku || "", it.url || "", Math.round(it.x * 100), Math.round(it.z * 100), Math.round((it.rot || 0) + (it.rot_fix || 0))].join("|"))
    .sort();
  return JSON.stringify([String(nom || ""), terrasse, sol || "bois", its]);
}

export async function figerVersion(
  sceneId: string,
  motif: string,
  extras: { capture?: string | null; dims?: Record<string, { l: number; p: number; h: number }>; forcerCapture?: boolean } = {},
): Promise<VersionFigee | { error: string; status: number }> {
  const { data: s, error } = await supabaseAdmin
    .from("planner_scenes")
    .select("id, nom, terrasse, sol, items, mode, vue, cree_par, updated_at, camera")
    .eq("id", sceneId)
    .maybeSingle();
  if (error) return { error: error.message, status: 500 };
  if (!s) return { error: "Scène introuvable", status: 404 };

  const { data: derniere } = await supabaseAdmin
    .from("planner_scenes_versions")
    .select("id, scene_id, numero, token, cree_le, capture_url, pdf_url, pdf_sans_prix_url, nom, terrasse, sol, items, ambiance_url")
    .eq("scene_id", sceneId)
    .order("numero", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Réutilisation si le CONTENU n'a pas bougé (terrasse, sol, articles, nom) —
  // pas l'horodatage : basculer Plan/3D ou Couleurs/Maquette ré-enregistre la
  // scène sans rien changer au plan, et ça empilait des versions identiques.
  // La capture est REMPLACÉE par la vue du moment (même version, même
  // fichier) : l'angle de la fiche doit être celui que le conseiller vient de
  // choisir. SAUF si une ambiance IA est retenue sur cette version : le rendu
  // IA a été fait depuis la capture existante, on la garde pour que plan et
  // rendu montrent le même angle (extras.forcerCapture = true pour passer
  // outre, utilisé par la génération d'ambiance qui repart de la vue du
  // moment). Les PDF déjà générés sont invalidés pour être refaits.
  const identique = derniere
    && empreinte(s.nom, s.terrasse, s.sol, s.items) === empreinte(derniere.nom, derniere.terrasse, derniere.sol, derniere.items);
  if (derniere && identique) {
    let captureUrl = derniere.capture_url as string | null;
    const figee = Boolean(derniere.ambiance_url) && !extras.forcerCapture;
    if (extras.capture && (!captureUrl || !figee)) {
      const nouvelle = await deposerCapture(derniere.token as string, extras.capture);
      if (nouvelle) {
        captureUrl = nouvelle;
        await supabaseAdmin.from("planner_scenes_versions")
          .update({ capture_url: captureUrl, pdf_url: null, pdf_sans_prix_url: null, camera: s.camera || null })
          .eq("id", derniere.id);
      }
    }
    return { ...(derniere as Omit<VersionFigee, "reutilisee">), capture_url: captureUrl, pdf_url: captureUrl !== derniere.capture_url ? null : derniere.pdf_url, pdf_sans_prix_url: captureUrl !== derniere.capture_url ? null : derniere.pdf_sans_prix_url, reutilisee: true };
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
      cree_par: s.cree_par, capture_url: captureUrl, camera: s.camera || null,
    })
    .select("id, scene_id, numero, token, cree_le, capture_url, pdf_url, pdf_sans_prix_url")
    .single();
  if (e2) return { error: e2.message, status: 500 };
  return { ...(v as Omit<VersionFigee, "reutilisee">), reutilisee: false };
}
