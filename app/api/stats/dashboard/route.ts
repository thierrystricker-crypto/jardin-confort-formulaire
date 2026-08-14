// app/api/stats/dashboard/route.ts
//
// Alimente /dashboard/statistiques.
//
// GET /api/stats/dashboard?source=app|shopify|total
//                         &periode=jour|semaine|mois|trimestre|semestre|annee|exercice
//                         &ancre=YYYY-MM-DD        (défaut : aujourd'hui)
//                         &prorata=1|0             (défaut : 1)
//
// Deux sources qui ne se recoupent pas :
//   app     → commandes saisies dans le formulaire (depuis mai 2026, avec conseiller)
//   shopify → commandes Shopify (depuis 2021, web + caisse, sans conseiller)
//
// Tout le calcul est fait en base (fonctions stats_*), en heure suisse.
// Cette route se contente d'orchestrer les appels et d'aligner les séries
// de comparaison sur la période courante, index par index.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type Source = "app" | "shopify" | "total";
type Periode = "jour" | "semaine" | "mois" | "trimestre" | "semestre" | "annee" | "exercice";

const PERIODES: Periode[] = ["jour", "semaine", "mois", "trimestre", "semestre", "annee", "exercice"];
const SOURCES: Source[] = ["app", "shopify", "total"];

// Granularité de la courbe selon l'amplitude de la période
function granularite(p: Periode): "day" | "week" | "month" {
  if (p === "trimestre" || p === "semestre") return "week";
  if (p === "annee" || p === "exercice") return "month";
  return "day";
}

type Borne = { scope: string; dfrom: string; dto: string; libelle: string; partielle: boolean };
type Totaux = { ca: number; nb_commandes: number; nb_articles: number; panier_moyen: number };
type PointSerie = { periode: string; ca: number; nb_commandes: number };

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normTotaux(row: unknown): Totaux {
  const r = (row || {}) as Record<string, unknown>;
  return {
    ca: num(r.ca),
    nb_commandes: num(r.nb_commandes),
    nb_articles: num(r.nb_articles),
    panier_moyen: num(r.panier_moyen),
  };
}

// Liste des buckets d'une plage, au pas demandé — sert de squelette pour que
// les trois séries aient exactement le même nombre de points et s'alignent.
function buckets(from: string, to: string, pas: "day" | "week" | "month"): string[] {
  const out: string[] = [];
  const start = new Date(from);
  const end = new Date(to);
  // On raisonne en date civile suisse : on prend la date locale du début de plage
  const cur = new Date(Date.UTC(
    Number(start.toLocaleString("en-CA", { timeZone: "Europe/Zurich", year: "numeric" })),
    Number(start.toLocaleString("en-CA", { timeZone: "Europe/Zurich", month: "numeric" })) - 1,
    Number(start.toLocaleString("en-CA", { timeZone: "Europe/Zurich", day: "numeric" })),
  ));
  if (pas === "week") {
    // aligner sur le lundi
    const jour = (cur.getUTCDay() + 6) % 7;
    cur.setUTCDate(cur.getUTCDate() - jour);
  }
  if (pas === "month") cur.setUTCDate(1);

  let garde = 0;
  while (cur.getTime() < end.getTime() && garde++ < 800) {
    out.push(cur.toISOString().slice(0, 10));
    if (pas === "day") cur.setUTCDate(cur.getUTCDate() + 1);
    else if (pas === "week") cur.setUTCDate(cur.getUTCDate() + 7);
    else cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  return out;
}

export async function GET(request: NextRequest) {
  try {
    const sp = new URL(request.url).searchParams;

    const source = (SOURCES.includes(sp.get("source") as Source) ? sp.get("source") : "total") as Source;
    const periode = (PERIODES.includes(sp.get("periode") as Periode) ? sp.get("periode") : "mois") as Periode;
    const ancre = /^\d{4}-\d{2}-\d{2}$/.test(sp.get("ancre") || "") ? sp.get("ancre") : null;
    const prorata = sp.get("prorata") !== "0";
    const pas = granularite(periode);

    // ─── 1) Bornes des trois périodes ───
    const { data: bornesData, error: errBornes } = await supabaseAdmin.rpc("stats_bornes", {
      p_periode: periode,
      p_ancre: ancre,
      p_prorata: prorata,
    });
    if (errBornes) throw new Error("stats_bornes: " + errBornes.message);

    const bornes = Object.fromEntries(
      ((bornesData || []) as Borne[]).map(b => [b.scope, b])
    ) as Record<"courant" | "precedent" | "an_dernier", Borne>;

    if (!bornes.courant) throw new Error("Période inconnue");

    // Pour la vue « jour », une courbe d'un seul point n'apprend rien :
    // on affiche les 30 derniers jours en contexte, les KPI restent sur le jour.
    const fenetreCourbe = (b: Borne): { from: string; to: string } => {
      if (periode !== "jour") return { from: b.dfrom, to: b.dto };
      const to = new Date(b.dto);
      const from = new Date(to);
      from.setUTCDate(from.getUTCDate() - 30);
      return { from: from.toISOString(), to: to.toISOString() };
    };

    // ─── 2) Tous les agrégats en parallèle ───
    const scopes = ["courant", "precedent", "an_dernier"] as const;

    // Le détail par conseiller n'existe que côté app : inutile d'interroger
    // la base quand la source est Shopify.
    const commerciauxPromise = source === "shopify"
      ? Promise.resolve<[unknown[], unknown[]]>([[], []])
      : Promise.all([
          supabaseAdmin.rpc("stats_commerciaux", { p_from: bornes.courant.dfrom, p_to: bornes.courant.dto })
            .then(r => (r.data || []) as unknown[]),
          supabaseAdmin.rpc("stats_commerciaux", { p_from: bornes.precedent.dfrom, p_to: bornes.precedent.dto })
            .then(r => (r.data || []) as unknown[]),
        ]);

    const [totauxRes, serieRes, commerciauxRes, articlesRes, marquesRes, metaRes] = await Promise.all([
      Promise.all(scopes.map(s =>
        supabaseAdmin.rpc("stats_totaux", { p_source: source, p_from: bornes[s].dfrom, p_to: bornes[s].dto })
      )),
      Promise.all(scopes.map(s => {
        const f = fenetreCourbe(bornes[s]);
        return supabaseAdmin.rpc("stats_serie", { p_source: source, p_from: f.from, p_to: f.to, p_granularite: pas });
      })),
      commerciauxPromise,
      supabaseAdmin.rpc("stats_articles", {
        p_source: source, p_from: bornes.courant.dfrom, p_to: bornes.courant.dto, p_limit: 30,
      }),
      Promise.all([
        supabaseAdmin.rpc("stats_marques", { p_source: source, p_from: bornes.courant.dfrom, p_to: bornes.courant.dto }),
        supabaseAdmin.rpc("stats_marques", { p_source: source, p_from: bornes.precedent.dfrom, p_to: bornes.precedent.dto }),
      ]),
      // Fraîcheur des données : l'import Shopify peut avoir du retard
      Promise.all([
        supabaseAdmin.from("commandes_shopify").select("created_at_shopify").order("created_at_shopify", { ascending: false }).limit(1).maybeSingle(),
        supabaseAdmin.from("offres").select("created_at").eq("type_document", "Commande").order("created_at", { ascending: true }).limit(1).maybeSingle(),
      ]),
    ]);

    // ─── 3) Totaux ───
    const totaux = {
      courant:    normTotaux((totauxRes[0].data || [])[0]),
      precedent:  normTotaux((totauxRes[1].data || [])[0]),
      an_dernier: normTotaux((totauxRes[2].data || [])[0]),
    };

    // ─── 4) Séries alignées index par index ───
    // Chaque comparatif est recalé sur la position du point courant, pas sur
    // sa date : le 3ᵉ jour du mois se compare au 3ᵉ jour du mois précédent.
    const serieBrute = scopes.map((s, i) => {
      const f = fenetreCourbe(bornes[s]);
      const points = new Map<string, PointSerie>();
      for (const p of ((serieRes[i].data || []) as PointSerie[])) {
        points.set(String(p.periode).slice(0, 10), p);
      }
      return { squelette: buckets(f.from, f.to, pas), points };
    });

    const nbPoints = serieBrute[0].squelette.length;
    const serie = Array.from({ length: nbPoints }, (_, i) => {
      const val = (k: 0 | 1 | 2) => {
        const d = serieBrute[k].squelette[i];
        if (!d) return null;
        const p = serieBrute[k].points.get(d);
        return { date: d, ca: num(p?.ca), nb: num(p?.nb_commandes) };
      };
      const c = val(0), p = val(1), a = val(2);
      return {
        i,
        date: c?.date || "",
        ca: c?.ca ?? 0,
        nb: c?.nb ?? 0,
        ca_precedent: p?.ca ?? null,
        date_precedent: p?.date ?? null,
        ca_an_dernier: a?.ca ?? null,
        date_an_dernier: a?.date ?? null,
      };
    });

    // ─── 5) Conseillers : courant + précédent fusionnés ───
    type LigneCom = { commercial: string; ca: number; nb_commandes: number; nb_articles: number; panier_moyen: number };
    const comCourant = (commerciauxRes[0] || []) as LigneCom[];
    const comPrec = new Map(
      ((commerciauxRes[1] || []) as LigneCom[]).map(r => [r.commercial, num(r.ca)])
    );
    const commerciaux = comCourant.map(r => ({
      commercial: r.commercial,
      ca: num(r.ca),
      nb_commandes: num(r.nb_commandes),
      nb_articles: num(r.nb_articles),
      panier_moyen: num(r.panier_moyen),
      ca_precedent: comPrec.get(r.commercial) ?? 0,
    }));

    // ─── 6) Marques : courant + précédent fusionnés ───
    type LigneMarque = { marque: string; qty: number; valeur: number; nb_commandes: number };
    const marqPrec = new Map(
      ((marquesRes[1].data || []) as LigneMarque[]).map(r => [r.marque, num(r.valeur)])
    );
    const marques = ((marquesRes[0].data || []) as LigneMarque[]).map(r => ({
      marque: r.marque,
      qty: num(r.qty),
      valeur: num(r.valeur),
      nb_commandes: num(r.nb_commandes),
      valeur_precedent: marqPrec.get(r.marque) ?? 0,
    }));

    // ─── 7) Articles ───
    type LigneArticle = {
      sku: string; titre: string; marque: string | null; marque_presumee: string | null;
      qty: number; valeur: number; nb_commandes: number;
    };
    const articles = ((articlesRes.data || []) as LigneArticle[]).map(r => ({
      sku: r.sku,
      titre: r.titre,
      marque: r.marque,
      // Déduite du libellé pour les articles saisis à la volée : affichée à
      // titre indicatif, jamais comptée dans la répartition par marque.
      marque_presumee: r.marque_presumee,
      qty: num(r.qty),
      valeur: num(r.valeur),
      nb_commandes: num(r.nb_commandes),
    }));

    return NextResponse.json({
      source,
      periode,
      granularite: pas,
      prorata,
      bornes,
      totaux,
      serie,
      commerciaux,
      articles,
      marques,
      meta: {
        shopify_derniere_commande: metaRes[0]?.data?.created_at_shopify ?? null,
        app_premiere_commande: metaRes[1]?.data?.created_at ?? null,
        commerciaux_disponibles: source !== "shopify",
      },
    });
  } catch (err) {
    console.error("[stats/dashboard]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
