// app/api/stock-list/route.ts
// GET /api/stock-list?q=sunwing
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

export const dynamic = "force-dynamic";

const LIMITE = 300;

export async function GET(request: NextRequest) {
  try {
    // Branche légère : ?fournisseurs=1 → fournisseurs synchronisés et date du
    // dernier relevé (bandeau en tête de page). Vue v_fournisseur_sync, hors ZZ-.
    if (request.nextUrl.searchParams.has("fournisseurs")) {
      if (!webshopConfigure) return NextResponse.json({ fournisseurs: [] });
      const { data, error } = await supabaseWebshop
        .from("v_fournisseur_sync")
        .select("fournisseur, actif, dernier_releve, nb_sku")
        .order("fournisseur", { ascending: true });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({
        fournisseurs: (data || []).map((f) => ({
          nom: f.fournisseur as string,
          actif: Boolean(f.actif),   // false = observation : relevé quotidien, mais rien n'est poussé vers Shopify
          dernierReleve: (f.dernier_releve as string | null) ?? null,
          nbSku: Number(f.nb_sku ?? 0),
        })),
      });
    }

    const q = (request.nextUrl.searchParams.get("q") || "").trim();

    // Moins de 2 caractères : on ne cherche pas (trop de bruit)
    if (q.length < 2) {
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
    if (!motif) {
      return NextResponse.json({ rows: [], count: 0, tronque: false });
    }

    const { data, error } = await supabaseWebshop
      .from("v_recherche_delai")
      .select("*")
      .or(`sku.ilike.%${motif}%,titre.ilike.%${motif}%`)
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
