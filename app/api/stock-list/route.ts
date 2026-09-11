// app/api/stock-list/route.ts
// GET /api/stock-list?q=sunwing[&fournisseur=Glatz]
//
// Page « Stock list » : recherche du délai de livraison d'un article au
// catalogue, y compris les fiches DRAFT et les SKU des relevés fournisseurs
// pas encore créés dans Shopify. Source : vue v_recherche_delai du Supabase
// WEBSHOP (lib/supabase-webshop.ts), qui calcule déjà le délai client.
//
// Lecture seule (vues v_recherche_delai + v_fournisseur_sync). Ne pas confondre avec /api/delais (suivi des délais des
// commandes en cours, Supabase de l'app).
//
// Renvoie : { rows: RechercheDelaiRow[], count, tronque }

import { NextRequest, NextResponse } from "next/server";
import { supabaseWebshop, webshopConfigure, type RechercheDelaiRow } from "@/lib/supabase-webshop";
import { supabaseAdmin } from "@/lib/supabase";

// Logo de marque (table brand_logos du Supabase de l'app) apparié au nom du
// fournisseur par slug : "Cane-line" → cane-line, "Les Jardins" → les-jardins.
function slugMarque(nom: string): string {
  return nom.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export const dynamic = "force-dynamic";

const LIMITE = 300;

export async function GET(request: NextRequest) {
  try {
    // Branche légère : ?fournisseurs=1 → fournisseurs synchronisés et date du
    // dernier relevé (bandeau en tête de page). Vue v_fournisseur_sync, hors ZZ-.
    if (request.nextUrl.searchParams.has("fournisseurs")) {
      if (!webshopConfigure) return NextResponse.json({ fournisseurs: [] });
      const [{ data, error }, logos] = await Promise.all([
        supabaseWebshop
          .from("v_fournisseur_sync")
          .select("fournisseur, actif, dernier_releve, nb_sku, dernier_verdict, dernier_motif")
          .order("fournisseur", { ascending: true }),
        supabaseAdmin.from("brand_logos").select("slug, image_url"),
      ]);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      const logoParSlug = new Map<string, string>();
      for (const l of logos.data || []) {
        if (l.slug && l.image_url) logoParSlug.set(String(l.slug), String(l.image_url));
      }
      return NextResponse.json({
        fournisseurs: (data || []).map((f) => ({
          nom: f.fournisseur as string,
          logoUrl: logoParSlug.get(slugMarque(String(f.fournisseur))) ?? null,
          actif: Boolean(f.actif),   // false = observation : relevé quotidien, mais rien n'est poussé vers Shopify
          dernierReleve: (f.dernier_releve as string | null) ?? null,
          nbSku: Number(f.nb_sku ?? 0),
          verdict: (f.dernier_verdict as string | null) ?? null,   // ok · observation · echec…
          motif: (f.dernier_motif as string | null) ?? null,
        })),
      });
    }

    const q = (request.nextUrl.searchParams.get("q") || "").trim();
    const fournisseur = (request.nextUrl.searchParams.get("fournisseur") || "").trim();

    // Moins de 2 caractères et pas de marque choisie : on ne cherche pas (trop de bruit)
    if (q.length < 2 && !fournisseur) {
      return NextResponse.json({ rows: [], count: 0, tronque: false });
    }

    if (!webshopConfigure) {
      return NextResponse.json(
        { error: "Supabase webshop non configuré (WEBSHOP_SUPABASE_URL / WEBSHOP_SUPABASE_SERVICE_KEY)" },
        { status: 500 }
      );
    }

    // Les virgules et parenthèses sont des séparateurs de la syntaxe .or() de
    // PostgREST ; % et _ sont des jokers ilike. On les neutralise.
    const motif = q.replace(/[,()%_]/g, " ").trim().replace(/\s+/g, "%");
    if (!motif && !fournisseur) {
      return NextResponse.json({ rows: [], count: 0, tronque: false });
    }

    let requete = supabaseWebshop.from("v_recherche_delai").select("*");
    if (motif) requete = requete.or(`sku.ilike.%${motif}%,titre.ilike.%${motif}%`);
    if (fournisseur) requete = requete.eq("fournisseur", fournisseur);

    const { data, error } = await requete
      .order("fournisseur", { ascending: true })
      .order("sku", { ascending: true })
      .limit(LIMITE + 1);

    if (error) {
      console.error("Stock list error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const toutes = (data || []) as RechercheDelaiRow[];
    const rows = toutes.slice(0, LIMITE);

    return NextResponse.json({ rows, count: rows.length, tronque: toutes.length > LIMITE });
  } catch (err) {
    console.error("Stock list error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
