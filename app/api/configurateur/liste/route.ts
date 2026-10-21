// app/api/configurateur/liste/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// POST /api/configurateur/liste  (21.10.2026)
//
// Bouton « Créer une liste d'achat » du configurateur parasol (page /v2/configurateur).
// Dépose la configuration comme liste d'achat ouverte (table listes_achat) →
// circuit existant : « Créer le brouillon » (DRA) ou onglet « Liste d'achat » du formulaire.
//
// On ne fait PAS confiance au contenu envoyé par l'app (code venu du thème Shopify) :
//   • articles de la boutique : seuls variant_id + quantité sont lus ; titre, SKU, marque,
//     image et statut sont relus chez Shopify (Admin API) — comme le panier borne ;
//   • articles « sur offre » (pas dans Shopify) : SKU, titre et prix catalogue Glatz TTC
//     contrôlés (format, longueur, bornes) → lignes « custom » du brouillon, à vérifier.
// Aucun prix Shopify stocké (règle des listes d'achat).
//
// Body : { ref, recap?, cree_par?, lignes: [{ vid, q } | { sku, t, q, p }] }
// Réponse : { id, nom, nb }
//
// Interne : non listée dans proxy.ts → protégée par le code d'équipe.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { shopifyAdminGraphQL } from "@/lib/shopify-stock";
import { normaliserLignes, nbArticles, type LigneListe } from "@/lib/listes-achat";
import { normaliserMembre } from "@/lib/jardi-equipe";

export const dynamic = "force-dynamic";

const PREFIXE_NOM = "☂ Configurateur";
const MAX_LIGNES = 60;

type NodeVariant = {
  id: string;
  sku: string | null;
  title: string | null;
  image: { url: string } | null;
  product: {
    id: string;
    title: string;
    vendor: string | null;
    status: "ACTIVE" | "DRAFT" | "ARCHIVED";
    featuredMedia: { preview: { image: { url: string } | null } | null } | null;
  } | null;
} | null;

function texte(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max) : "";
}

function heureZurich(): string {
  return new Date().toLocaleTimeString("fr-CH", { timeZone: "Europe/Zurich", hour: "2-digit", minute: "2-digit" });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const brut = Array.isArray(body.lignes) ? body.lignes.slice(0, MAX_LIGNES) : [];

    const shop = new Map<string, number>(); // gid variante → qté
    const horsShop = new Map<string, { titre: string; qty: number; prix: number | null }>(); // SKU → ligne
    for (const x of brut) {
      if (!x || typeof x !== "object") continue;
      const o = x as Record<string, unknown>;
      const qty = Math.max(1, Math.min(99, Math.round(Number(o.q) || 1)));
      const vid = String(o.vid ?? "").trim();
      if (/^\d{1,20}$/.test(vid)) {
        const g = `gid://shopify/ProductVariant/${vid}`;
        shop.set(g, (shop.get(g) || 0) + qty);
        continue;
      }
      const sku = String(o.sku ?? "").trim();
      if (!/^[A-Za-z0-9.\-]{3,30}$/.test(sku)) continue;
      const p = o.p === null || o.p === undefined ? null : Number(o.p);
      const prix = p === null || !isFinite(p) || p < 0 || p > 200000 ? null : Math.round(p * 100) / 100;
      const deja = horsShop.get(sku);
      if (deja) deja.qty += qty;
      else horsShop.set(sku, { titre: texte(o.t, 200) || `Glatz ${sku}`, qty, prix });
    }
    if (shop.size === 0 && horsShop.size === 0) return NextResponse.json({ error: "Configuration vide" }, { status: 400 });

    // Relecture Shopify des articles de la boutique
    const lignes: LigneListe[] = [];
    if (shop.size) {
      const data = await shopifyAdminGraphQL<{ nodes: NodeVariant[] }>(
        `query configurateurListe($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on ProductVariant {
              id sku title
              image { url(transform: { maxWidth: 400, maxHeight: 400 }) }
              product { id title vendor status featuredMedia { preview { image { url(transform: { maxWidth: 400, maxHeight: 400 }) } } } }
            }
          }
        }`,
        { ids: [...shop.keys()] },
      );
      for (const n of data.nodes || []) {
        if (!n || !n.id || !n.product) continue;
        const numId = n.id.split("/").pop() || "";
        const vt = (n.title || "").trim();
        lignes.push({
          fournisseur: (n.product.vendor || "").trim() || "Shopify",
          sku: (n.sku || "").trim() || `VAR-${numId}`,
          titre: n.product.title,
          variante_titre: vt && vt !== "Default Title" ? vt : null,
          variant_id: n.id,
          product_id: n.product.id,
          statut_fiche: n.product.status,
          qty: shop.get(n.id) || 1,
          image_url: n.image?.url || n.product.featuredMedia?.preview?.image?.url || null,
          prix: null,
        });
      }
    }
    // Articles « sur offre » (hors boutique) → lignes custom du brouillon, prix catalogue Glatz TTC
    for (const [sku, l] of horsShop) {
      lignes.push({
        fournisseur: "Glatz",
        sku,
        titre: `${l.titre} (sur offre)`,
        variante_titre: null,
        variant_id: null,
        product_id: null,
        statut_fiche: null,
        qty: l.qty,
        image_url: null,
        prix: l.prix,
      });
    }
    const propres = normaliserLignes(lignes);
    if (propres.length === 0) return NextResponse.json({ error: "Articles introuvables" }, { status: 400 });

    const ref = texte(body.ref, 80) || "Parasol Glatz";
    const nom = `${PREFIXE_NOM} · ${ref} · ${heureZurich()}`.slice(0, 120);
    // Récapitulatif texte de l'app (sauts de ligne gardés) → notes de la liste
    const recap = typeof body.recap === "string" ? body.recap.replace(/[\u0000-\u0009\u000b-\u001f]/g, " ").slice(0, 1800) : "";
    const { data: liste, error } = await supabaseAdmin
      .from("listes_achat")
      .insert({
        nom,
        cree_par: normaliserMembre(body.cree_par),
        lignes: propres,
        nb_articles: nbArticles(propres),
        notes: recap || `Configuration ${ref}`,
        est_modele: false,
      })
      .select("id, nom")
      .single();
    if (error || !liste) {
      console.error("Configurateur → liste d'achat :", error?.message);
      return NextResponse.json({ error: "Enregistrement impossible" }, { status: 500 });
    }
    return NextResponse.json({ id: liste.id, nom: liste.nom, nb: nbArticles(propres) });
  } catch (err) {
    console.error("Configurateur → liste d'achat error:", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
