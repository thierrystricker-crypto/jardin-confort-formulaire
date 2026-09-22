// lib/planner-ambiances.ts
// Images d'ambiance IA du planner (table planner_ambiances, SQL 027) —
// fonctions partagées par les routes /ambiance (génération) et /ambiances
// (galerie, retenir, supprimer). Un fichier route.ts ne peut exporter que
// des handlers HTTP, d'où ce module.

import { supabaseAdmin } from "@/lib/supabase";

export type AmbianceIA = {
  id: string; url: string; prompt: string | null; modele: string | null; cree_le: string;
  version_id: string; numero: number | null;
};

// Toutes les images de la scène, la plus récente d'abord, avec le numéro de
// la version sur laquelle chacune a été générée.
export async function listerScene(sceneId: string): Promise<AmbianceIA[]> {
  const { data } = await supabaseAdmin
    .from("planner_ambiances")
    .select("id, url, prompt, modele, cree_le, version_id, planner_scenes_versions(numero)")
    .eq("scene_id", sceneId)
    .order("cree_le", { ascending: false });
  type Ligne = { id: string; url: string; prompt: string | null; modele: string | null; cree_le: string; version_id: string; planner_scenes_versions: { numero: number } | { numero: number }[] | null };
  return ((data || []) as unknown as Ligne[]).map((a) => {
    const v = a.planner_scenes_versions;
    const numero = Array.isArray(v) ? v[0]?.numero : v?.numero;
    return { id: a.id, url: a.url, prompt: a.prompt, modele: a.modele, cree_le: a.cree_le, version_id: a.version_id, numero: numero ?? null };
  });
}

