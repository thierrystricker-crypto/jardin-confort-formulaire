// app/api/traductions/appliquer/route.ts
//
// Sentinelle traductions (28.11.2026) — bouton « Appliquer » de la page
// /dashboard/traductions (route interne, cookie de session exigé par le proxy).
// Écrit dans Shopify la correction d'UNE anomalie validée par un humain :
//   • proposition de Claude → remplace l'extrait par la correction, à
//     l'identique, dans la traduction actuelle (refus si l'extrait n'y est
//     plus tel quel : on ne devine jamais) ;
//   • règle sûre (auto) → applique les corrections mécaniques au champ.
// Les autres règles (mots collés, doublés…) se corrigent à la main.
// Body : { id: string (uuid de seo_traductions_controles) }
// Droit Shopify requis : write_translations.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { appliquerCorrectionsSures } from "@/lib/traductions-regles";
import { lireRessources, ecrireTraductions, messageErreur, type Locale } from "@/lib/traductions-shopify";

export const dynamic = "force-dynamic";

type Controle = {
  id: string;
  ressource_id: string;
  ressource_type: "produit" | "collection";
  marque: string | null;
  langue: Locale;
  champ: string;
  regle: string;
  source: "regle" | "claude";
  extrait: string | null;
  correction_proposee: string | null;
  auto_corrigeable: boolean;
  statut: string;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { id?: unknown };
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });

    const { data, error } = await supabaseAdmin
      .from("seo_traductions_controles")
      .select("id, ressource_id, ressource_type, marque, langue, champ, regle, source, extrait, correction_proposee, auto_corrigeable, statut")
      .eq("id", id)
      .single();
    if (error || !data) return NextResponse.json({ error: "Anomalie introuvable" }, { status: 404 });
    const c = data as Controle;

    const [r] = await lireRessources([c.ressource_id]);
    const actuelle = r?.traductions[c.langue].get(c.champ)?.value;
    const fr = r?.contenu.get(c.champ);
    if (!r || !actuelle || !fr) {
      return NextResponse.json({ error: "Traduction ou texte français introuvable sur Shopify" }, { status: 404 });
    }

    let nouvelle: string;
    if (c.source === "claude") {
      if (!c.extrait || c.correction_proposee === null) {
        return NextResponse.json({ error: "Pas de correction proposée" }, { status: 422 });
      }
      // Déjà corrigé (par le rattrapage, à la main…) : on le constate, sans écrire.
      if (!actuelle.includes(c.extrait) && c.correction_proposee && actuelle.includes(c.correction_proposee)) {
        await supabaseAdmin
          .from("seo_traductions_controles")
          .update({ statut: "corrige", traite_at: new Date().toISOString() })
          .eq("id", id);
        return NextResponse.json({ success: true, deja_corrige: true });
      }
      if (!actuelle.includes(c.extrait)) {
        return NextResponse.json({
          error: "Le passage n'est plus (ou pas) dans la traduction tel quel (balises HTML, texte déjà modifié…) : à corriger à la main dans T Lab ou l'admin Shopify.",
        }, { status: 422 });
      }
      nouvelle = actuelle.replace(c.extrait, c.correction_proposee);
    } else if (c.auto_corrigeable) {
      nouvelle = appliquerCorrectionsSures(actuelle, c.langue, { marque: c.marque, fr: fr.value, collection: c.ressource_type === "collection" }).valeur;
    } else {
      return NextResponse.json({ error: "Cette règle se corrige à la main" }, { status: 422 });
    }

    if (nouvelle === actuelle) {
      await supabaseAdmin
        .from("seo_traductions_controles")
        .update({ statut: "corrige", traite_at: new Date().toISOString() })
        .eq("id", id);
      return NextResponse.json({ success: true, deja_corrige: true });
    }

    await ecrireTraductions(c.ressource_id, [{ locale: c.langue, key: c.champ, value: nouvelle, digest: fr.digest }]);
    const { error: errUpd } = await supabaseAdmin
      .from("seo_traductions_controles")
      .update({ statut: "corrige", traite_at: new Date().toISOString() })
      .eq("id", id);
    if (errUpd) throw new Error(errUpd.message);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[api/traductions/appliquer] erreur:", err);
    return NextResponse.json({ error: messageErreur(err) }, { status: 500 });
  }
}
