// app/api/stock-list/route.ts
// GET /api/stock-list?q=sunwing[&fournisseur=Glatz][&stockJC=1&stockFourn=1&masquerNonLivrables=1&actives=1&horsShopify=1]
//
// Page « Stock list » : recherche du délai de livraison d'un article au
// catalogue (texte sur SKU/titre dans la vue + variantes trouvées par la
// recherche Shopify Admin, pour les titres de variantes : couleur, taille…), y compris les fiches DRAFT et les SKU des relevés fournisseurs
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
import { shopifyAdminGraphQL } from "@/lib/shopify-stock";

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

    // Filtres rapides, appliqués AVANT la limite de 300 (sinon on filtrerait
    // seulement les 300 premiers SKU par ordre alphabétique).
    const sp = request.nextUrl.searchParams;
    function base() {
      let r = supabaseWebshop.from("v_recherche_delai").select("*");
      if (fournisseur) r = r.eq("fournisseur", fournisseur);
      if (sp.get("stockJC") === "1") r = r.gt("stock_jc", 0);
      if (sp.get("stockFourn") === "1") r = r.eq("dispo_fournisseur", "EN_STOCK");
      if (sp.get("masquerNonLivrables") === "1") r = r.or("dispo_fournisseur.neq.NON_LIVRABLE,dispo_fournisseur.is.null");
      if (sp.get("actives") === "1") r = r.eq("statut_fiche", "ACTIVE");
      if (sp.get("horsShopify") === "1") r = r.is("statut_fiche", null);
      // Fiches ARCHIVED sans stock JC : masquées par défaut (plus vendables, ni
      // réassortables) — sauf ?archivees=1. Une archivée avec stock reste visible.
      if (sp.get("archivees") !== "1") r = r.or("statut_fiche.is.null,statut_fiche.neq.ARCHIVED,stock_jc.gt.0");
      return r;
    }

    // ── 1. Recherche texte dans la vue (SKU, titre produit) ──
    const requetes: Promise<{ data: unknown; error: { message: string } | null }>[] = [];
    if (motif) {
      requetes.push(Promise.resolve(base().or(`sku.ilike.%${motif}%,titre.ilike.%${motif}%`).order("fournisseur").order("sku").limit(LIMITE + 1)));
    } else {
      requetes.push(Promise.resolve(base().order("fournisseur").order("sku").limit(LIMITE + 1)));
    }

    // ── 2. Recherche Shopify Admin sur les VARIANTES (titre produit + titre de
    // variante : « sfera 527 » trouve « Sfera … 527 Urban Chrome »), fiches DRAFT
    // comprises — la vue ne connaît pas le titre de variante. Les gid trouvés
    // sont ramenés dans la vue par variant_id, par paquets de 100 (longueur d'URL).
    if (q.length >= 2) {
      try {
        const rech = q.replace(/["\\]/g, " ").trim();
        const data = await shopifyAdminGraphQL<{ productVariants: { nodes: { id: string }[] } }>(
          `query stockListVariantes($q: String!) { productVariants(first: 250, query: $q) { nodes { id } } }`,
          { q: rech }
        );
        const gids = (data.productVariants?.nodes || []).map((n) => n.id);
        for (let i = 0; i < gids.length; i += 100) {
          requetes.push(Promise.resolve(base().in("variant_id", gids.slice(i, i + 100)).limit(LIMITE)));
        }
      } catch (e) {
        console.warn("Stock list : recherche Shopify indisponible, texte seul —", e);
      }
    }

    const resultats = await Promise.all(requetes);
    const erreur = resultats.find((r) => r.error);
    if (erreur?.error) {
      console.error("Stock list error:", erreur.error);
      return NextResponse.json({ error: erreur.error.message }, { status: 500 });
    }
    const vues = new Set<string>();
    const fusion: RechercheDelaiRow[] = [];
    for (const r of resultats) {
      for (const row of (r.data || []) as RechercheDelaiRow[]) {
        const cle = `${row.fournisseur}|${row.sku}`;
        if (vues.has(cle)) continue;
        vues.add(cle);
        fusion.push(row);
      }
    }
    fusion.sort((a, b) => a.fournisseur.localeCompare(b.fournisseur) || a.sku.localeCompare(b.sku));
    const data = fusion;

    const toutes = data;
    const rows = toutes.slice(0, LIMITE);

    return NextResponse.json({ rows, count: rows.length, tronque: toutes.length > LIMITE });
  } catch (err) {
    console.error("Stock list error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
