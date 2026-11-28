// app/api/traductions/proposer/route.ts
//
// Sentinelle traductions (28.11.2026) — bouton « Proposer une correction »
// de la page /dashboard/traductions (route interne, cookie de session exigé
// par le proxy), pour les anomalies des règles fixes qui ne se corrigent pas
// mécaniquement (mots collés, mots doublés, mot resté en français, marque
// perdue…). Claude lit le français et la traduction ACTUELLE (HTML brut) et
// renvoie le passage exact à remplacer + son remplacement.
// N'ÉCRIT RIEN : la page affiche l'avant / après, puis l'humain clique
// « Appliquer » (route /api/traductions/appliquer avec extrait + correction).
// Body : { id: string (uuid de seo_traductions_controles) }

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { lireRessources, messageErreur, type Locale } from "@/lib/traductions-shopify";
import { appelerClaude } from "@/lib/traductions-sentinelle";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LANGUE: Record<Locale, string> = { de: "allemand de Suisse (ss, jamais ß ; vouvoiement Sie)", en: "anglais" };

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { id?: unknown };
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });

    const { data, error } = await supabaseAdmin
      .from("seo_traductions_controles")
      .select("id, ressource_id, ressource_type, handle, marque, langue, champ, regle, extrait, correction_proposee")
      .eq("id", id)
      .single();
    if (error || !data) return NextResponse.json({ error: "Anomalie introuvable" }, { status: 404 });
    const c = data as {
      ressource_id: string; ressource_type: string; handle: string | null; marque: string | null;
      langue: Locale; champ: string; regle: string; extrait: string | null; correction_proposee: string | null;
    };

    const [r] = await lireRessources([c.ressource_id]);
    const actuelle = r?.traductions[c.langue].get(c.champ)?.value;
    const fr = r?.contenu.get(c.champ)?.value;
    if (!actuelle || fr === undefined) {
      return NextResponse.json({ error: "Traduction ou texte français introuvable sur Shopify" }, { status: 404 });
    }

    const couper = (s: string) => (s.length > 9000 ? s.slice(0, 9000) + " […]" : s);
    const consigne = `Tu corriges une traduction ${LANGUE[c.langue]} d'un webshop suisse de mobilier de jardin (jardin-confort.ch).
Fiche : ${c.ressource_type} « ${c.handle ?? ""} » — marque : ${c.marque ?? "—"} — champ : ${c.champ}.
Un contrôle automatique a relevé ce problème : « ${c.regle} » — passage : « ${c.extrait ?? ""} » — piste : « ${c.correction_proposee ?? ""} ».

FRANÇAIS (fait foi) :
${couper(fr)}

TRADUCTION ACTUELLE (texte brut, peut contenir du HTML) :
${couper(actuelle)}

Propose la correction MINIMALE de ce problème précis (ne réécris rien d'autre). Les noms de marques, de collections et de modèles ne se traduisent pas.
Réponds UNIQUEMENT avec un objet JSON :
{"extrait":"passage à remplacer","correction":"passage corrigé"}
- « extrait » doit être copié EXACTEMENT, caractère pour caractère, depuis la TRADUCTION ACTUELLE ci-dessus (HTML compris s'il y en a dans le passage), le plus court possible ;
- « correction » remplace exactement « extrait ».
Si ce n'est en fait pas une erreur (faux positif), réponds : {"aucune":true,"raison":"…"}`;

    const texte = await appelerClaude(consigne, 1000);
    const debut = texte.indexOf("{");
    const fin = texte.lastIndexOf("}");
    if (debut < 0 || fin <= debut) return NextResponse.json({ error: "Réponse de Claude illisible" }, { status: 502 });
    let rep: { extrait?: unknown; correction?: unknown; aucune?: unknown; raison?: unknown };
    try { rep = JSON.parse(texte.slice(debut, fin + 1)); } catch {
      return NextResponse.json({ error: "Réponse de Claude illisible" }, { status: 502 });
    }
    if (rep.aucune === true) {
      return NextResponse.json({ aucune: true, raison: String(rep.raison ?? "") });
    }
    const extrait = typeof rep.extrait === "string" ? rep.extrait : "";
    const correction = typeof rep.correction === "string" ? rep.correction : "";
    if (!extrait || !actuelle.includes(extrait)) {
      return NextResponse.json({ error: "Claude n'a pas trouvé le passage exact dans la traduction : à corriger à la main." }, { status: 422 });
    }
    return NextResponse.json({ extrait, correction });
  } catch (err) {
    console.error("[api/traductions/proposer] erreur:", err);
    return NextResponse.json({ error: messageErreur(err) }, { status: 500 });
  }
}
