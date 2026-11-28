// app/api/traductions/rattrapage/route.ts
//
// Sentinelle traductions (28.11.2026) — RATTRAPAGE des règles sûres sur tout
// le catalogue (route interne, cookie de session exigé par le proxy).
// Le glossaire T Lab ne retraduit pas l'existant : cette route corrige les
// traductions déjà en ligne avec les seules corrections mécaniques et sûres
// de lib/traductions-regles.ts (ß → ss, Sthul, Bodenhülsel, Keramik,
// available to order, pouf hors Fatboy — produits seulement). Aucune IA ici.
//
// Un appel = un lot (curseur Shopify). La page enchaîne les lots.
// Body : { type: "produit" | "collection", apres?: string | null,
//          taille?: number (10 à 250, défaut 100), ecrire: boolean }
// ecrire=false → simulation : compte ce qui serait corrigé, n'écrit rien.
// ecrire=true  → écrit dans Shopify (droit write_translations requis) et
//                journalise le lot dans seo_traductions_runs.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { appliquerCorrectionsSures, CHAMPS } from "@/lib/traductions-regles";
import {
  pageRessources, lireRessources, ecrireTraductions, messageErreur,
  type Locale, type TraductionAEcrire,
} from "@/lib/traductions-shopify";
import { PREFIXE_RATTRAPAGE } from "@/lib/traductions-sentinelle";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      type?: unknown; apres?: unknown; taille?: unknown; ecrire?: unknown;
    };
    const type = body.type === "collection" ? "collection" : "produit";
    const apres = typeof body.apres === "string" && body.apres ? body.apres : null;
    const taille = Math.min(250, Math.max(10, Number(body.taille) || 100));
    const ecrire = body.ecrire === true;

    const { ressources, suivant } = await pageRessources(type, apres, taille);
    const contenus = await lireRessources(ressources.map((r) => r.id));
    const parId = new Map(ressources.map((r) => [r.id, r]));

    let ressourcesACorriger = 0;
    let champs = 0;
    let ecrits = 0;
    const parRegle: Record<string, number> = {};
    const exemples: Array<{ handle: string; langue: string; champ: string; regles: string[] }> = [];
    const erreurs: string[] = [];
    // Fiches sans plus rien à corriger sur les règles sûres après ce lot
    // (déjà propres, ou corrigées avec succès) : leurs anomalies « auto »
    // encore ouvertes sont résolues.
    const fichesPropres: string[] = [];

    for (const c of contenus) {
      const r = parId.get(c.resourceId);
      if (!r) continue;
      const items: TraductionAEcrire[] = [];
      for (const langue of ["de", "en"] as Locale[]) {
        for (const champ of CHAMPS) {
          const t = c.traductions[langue].get(champ);
          const fr = c.contenu.get(champ);
          if (!t || !fr) continue;
          const { valeur, regles } = appliquerCorrectionsSures(t.value, langue, { marque: r.marque, fr: fr.value, collection: r.type === "collection" });
          if (valeur === t.value) continue;
          items.push({ locale: langue, key: champ, value: valeur, digest: fr.digest });
          for (const rg of regles) parRegle[rg] = (parRegle[rg] ?? 0) + 1;
          if (exemples.length < 8) exemples.push({ handle: r.handle, langue, champ, regles });
        }
      }
      if (!items.length) { fichesPropres.push(c.resourceId); continue; }
      ressourcesACorriger++;
      champs += items.length;
      if (!ecrire) continue;
      try {
        await ecrireTraductions(c.resourceId, items);
        ecrits += items.length;
        fichesPropres.push(c.resourceId);
      } catch (e) {
        if (erreurs.length < 10) erreurs.push(`${r.handle} : ${messageErreur(e).slice(0, 200)}`);
        // Droit manquant : inutile de continuer le lot
        if (messageErreur(e).includes("write_translations")) break;
      }
    }

    if (ecrire && fichesPropres.length) {
      const { error: errMaj } = await supabaseAdmin
        .from("seo_traductions_controles")
        .update({ statut: "corrige", traite_at: new Date().toISOString() })
        .in("ressource_id", fichesPropres)
        .eq("statut", "nouveau")
        .eq("auto_corrigeable", true);
      if (errMaj && erreurs.length < 10) erreurs.push(`Mise à jour des anomalies : ${errMaj.message}`);
    }

    if (ecrire) {
      const resume = Object.entries(parRegle).map(([k, v]) => `${k} ${v}`).join(", ");
      await supabaseAdmin.from("seo_traductions_runs").insert({
        finished_at: new Date().toISOString(),
        nb_ressources: ressources.length,
        nb_anomalies: 0,
        nb_relues_claude: 0,
        notes: `${PREFIXE_RATTRAPAGE} règles sûres (${type}s) : ${ressources.length} fiches lues, ${ecrits} champ(s) corrigé(s)${resume ? ` — ${resume}` : ""}${erreurs.length ? ` · ${erreurs.length} erreur(s)` : ""}`,
        erreur: erreurs.length ? erreurs.join(" · ").slice(0, 1000) : null,
      });
    }

    return NextResponse.json({
      type, suivant, lues: ressources.length, ressources_a_corriger: ressourcesACorriger,
      champs, ecrits, par_regle: parRegle, exemples, erreurs,
    });
  } catch (err) {
    console.error("[api/traductions/rattrapage] erreur:", err);
    return NextResponse.json({ error: messageErreur(err) }, { status: 500 });
  }
}
