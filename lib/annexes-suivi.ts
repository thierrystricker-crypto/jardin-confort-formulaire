// lib/annexes-suivi.ts
// ─────────────────────────────────────────────────────────────────────────────
// Suivi des annexes dans la chaîne DRA → DEV → CMD (chantier annexes, bloc 2,
// étape 4 — décision doc 14 §7 : RECOPIE des lignes, jamais des fichiers).
//
// À chaque transformation (brouillon → offre) et validation (offre → commande),
// les lignes `pieces_jointes` du document source sont recopiées sur le nouveau
// document. Les fichiers ne sont PAS dupliqués : les nouvelles lignes pointent
// le même `chemin` dans le bucket `annexes`. Chaque document reste ainsi une
// preuve autonome (règle d'or n°2), comme le stock figé J0 et les snapshots.
//
// Garanties :
// - NON BLOQUANT par construction : la fonction ne lève jamais — elle journalise
//   et rend un compte-rendu. Une recopie manquée ne doit jamais faire échouer
//   une transformation, encore moins une validation client.
// - IDEMPOTENT par `content_hash` : une pièce déjà présente sur la cible (même
//   hash, non supprimée) n'est pas recopiée.
// - Ce qui est recopié : catégorie, nom, libellé, chemin, mime, taille, hash,
//   ajoute_par, visibilite, et `created_at` D'ORIGINE (la date de dépôt fait
//   partie de la preuve). Ce qui ne l'est PAS : `id` (nouvelle ligne),
//   `claude_file_id` (il pilote la purge de la copie Anthropic — il ne doit
//   exister que sur la ligne d'origine), `supprime_at` (les pièces retirées ne
//   suivent pas).
// - AUCUNE écriture sur `offres`/`drafts` : uniquement `pieces_jointes`.
// ─────────────────────────────────────────────────────────────────────────────

import { supabaseAdmin } from "@/lib/supabase";

type EntityType = "draft" | "offre" | "commande";

export type BilanRecopie = {
  copiees: number;
  ignorees: number; // déjà présentes sur la cible (même hash)
  erreur: string | null;
};

export async function recopierAnnexes(
  sourceType: EntityType,
  sourceSlug: string,
  cibleType: EntityType,
  cibleSlug: string
): Promise<BilanRecopie> {
  const bilan: BilanRecopie = { copiees: 0, ignorees: 0, erreur: null };
  try {
    // ── Pièces vivantes du document source ──
    const { data: sources, error: erreurSources } = await supabaseAdmin
      .from("pieces_jointes")
      .select(
        "categorie, nom_fichier, libelle, chemin, mime, taille_octets, content_hash, ajoute_par, visibilite, created_at"
      )
      .eq("entity_type", sourceType)
      .eq("entity_slug", sourceSlug)
      .is("supprime_at", null)
      .order("created_at", { ascending: true });
    if (erreurSources) throw new Error(erreurSources.message);
    if (!sources || sources.length === 0) return bilan;

    // ── Résolution de la cible (id) ──
    const table = cibleType === "draft" ? "drafts" : "offres";
    const { data: cible, error: erreurCible } = await supabaseAdmin
      .from(table)
      .select("id")
      .eq("slug", cibleSlug)
      .maybeSingle();
    if (erreurCible) throw new Error(erreurCible.message);
    if (!cible) throw new Error(`cible introuvable : ${cibleType}/${cibleSlug}`);

    // ── Idempotence : ce que la cible porte déjà ──
    const { data: existantes, error: erreurExistantes } = await supabaseAdmin
      .from("pieces_jointes")
      .select("content_hash, chemin")
      .eq("entity_type", cibleType)
      .eq("entity_slug", cibleSlug)
      .is("supprime_at", null);
    if (erreurExistantes) throw new Error(erreurExistantes.message);
    const dejaLa = new Set(
      (existantes || []).map((p) => p.content_hash || p.chemin)
    );

    const aCopier = sources.filter((p) => !dejaLa.has(p.content_hash || p.chemin));
    bilan.ignorees = sources.length - aCopier.length;
    if (aCopier.length === 0) return bilan;

    const lignes = aCopier.map((p) => ({
      entity_type: cibleType,
      entity_id: cible.id as number,
      entity_slug: cibleSlug,
      categorie: p.categorie,
      nom_fichier: p.nom_fichier,
      libelle: p.libelle,
      chemin: p.chemin, // même fichier, jamais dupliqué
      mime: p.mime,
      taille_octets: p.taille_octets,
      content_hash: p.content_hash,
      ajoute_par: p.ajoute_par,
      visibilite: p.visibilite,
      created_at: p.created_at, // la date de dépôt fait partie de la preuve
    }));

    const { error: erreurInsert } = await supabaseAdmin
      .from("pieces_jointes")
      .insert(lignes);
    if (erreurInsert) throw new Error(erreurInsert.message);

    bilan.copiees = lignes.length;
    console.log(
      `[annexes-suivi] ${sourceType}/${sourceSlug} → ${cibleType}/${cibleSlug} : ` +
        `${bilan.copiees} recopiée(s), ${bilan.ignorees} déjà présente(s)`
    );
    return bilan;
  } catch (err) {
    bilan.erreur = err instanceof Error ? err.message : String(err);
    console.error(
      `[annexes-suivi] Recopie ${sourceType}/${sourceSlug} → ${cibleType}/${cibleSlug} impossible :`,
      bilan.erreur
    );
    return bilan;
  }
}
