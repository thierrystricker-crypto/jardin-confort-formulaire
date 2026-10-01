// app/api/listes-achat/borne/route.ts
// POST /api/listes-achat/borne  (chantier « Panier borne », 01.10.2026)
//
// Reçoit le panier Shopify d'une BORNE du magasin (jardin-confort.ch, page
// panier ou tiroir panier) et le dépose comme liste d'achat ouverte. Le
// vendeur la retrouve ensuite dans /dashboard/listes-achat (onglet Ouvertes) et
// la transforme en brouillon avec le circuit existant — rien de neuf côté vendeur.
//
// Route PUBLIQUE dans proxy.ts (la borne n'a pas le cookie), mais fermée :
//   1. IP d'origine ∈ BORNE_IPS (env Vercel, liste séparée par des virgules).
//      Env absente ou vide → tout est refusé (fermé par défaut).
//   2. Origin ∈ jardin-confort.ch (CORS) — pour le navigateur seulement,
//      le vrai verrou est l'IP.
//   3. Au plus 20 paniers borne par heure (compté en base).
//   4. Écriture seule : la réponse ne contient QUE le code. Aucune lecture.
//
// On ne fait PAS confiance au contenu envoyé : seuls variant_id et quantité
// sont lus, tout le reste (titre, SKU, marque, image) est relu chez Shopify.
// Aucun prix stocké (règle des listes d'achat) ; aucun stock exposé.
//
// Body (text/plain ou JSON) : { items: [{ variant_id: number|string, qty: number }] }
// Réponse : { code: "4821", nb: 3 }

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { shopifyAdminGraphQL } from "@/lib/shopify-stock";
import { normaliserLignes, nbArticles, type LigneListe } from "@/lib/listes-achat";

export const dynamic = "force-dynamic";

const PREFIXE_NOM = "🖥 Borne";
const MAX_PAR_HEURE = 20;
const MAX_ARTICLES = 100;

// ── CORS ──
function origineAutorisee(origin: string | null): string | null {
  if (!origin) return null;
  try {
    const h = new URL(origin).hostname;
    if (h === "jardin-confort.ch" || h === "www.jardin-confort.ch" || h.endsWith(".myshopify.com")) return origin;
  } catch {}
  return null;
}

function enTetesCors(origin: string | null): Record<string, string> {
  const o = origineAutorisee(origin);
  if (!o) return {};
  return {
    "Access-Control-Allow-Origin": o,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

function repondre(origin: string | null, body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: enTetesCors(origin) });
}

// ── IP ──
function ipClient(request: NextRequest): string {
  const reelle = request.headers.get("x-real-ip");
  if (reelle) return reelle.trim();
  const fwd = request.headers.get("x-forwarded-for") || "";
  return fwd.split(",")[0].trim();
}

function ipAutorisee(ip: string): boolean {
  const liste = (process.env.BORNE_IPS || "").split(",").map((s) => s.trim()).filter(Boolean);
  return liste.length > 0 && !!ip && liste.includes(ip);
}

// ── Shopify ──
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

function gid(id: string): string {
  return id.startsWith("gid://") ? id : `gid://shopify/ProductVariant/${id}`;
}

function heureZurich(): string {
  return new Date().toLocaleTimeString("fr-CH", { timeZone: "Europe/Zurich", hour: "2-digit", minute: "2-digit" });
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: enTetesCors(request.headers.get("origin")) });
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  try {
    // 1. IP du magasin uniquement
    const ip = ipClient(request);
    if (!ipAutorisee(ip)) {
      console.warn("Panier borne refusé — IP", ip);
      return repondre(origin, { error: "Fonction réservée aux bornes du magasin" }, 403);
    }

    // 2. Lecture du panier (text/plain accepté : évite le preflight CORS)
    const brut = await request.text();
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(brut || "{}"); } catch { return repondre(origin, { error: "Corps invalide" }, 400); }
    const items = Array.isArray(body.items) ? body.items.slice(0, MAX_ARTICLES) : [];
    const demandes = new Map<string, number>(); // gid → qty (variantes en double additionnées)
    for (const it of items) {
      if (!it || typeof it !== "object") continue;
      const o = it as Record<string, unknown>;
      const id = String(o.variant_id ?? "").trim();
      if (!/^(gid:\/\/shopify\/ProductVariant\/)?\d+$/.test(id)) continue;
      const qty = Math.max(1, Math.min(999, Math.round(Number(o.qty) || 1)));
      const g = gid(id);
      demandes.set(g, (demandes.get(g) || 0) + qty);
    }
    if (demandes.size === 0) return repondre(origin, { error: "Panier vide" }, 400);

    // 3. Plafond horaire
    const ilYaUneHeure = new Date(Date.now() - 3600_000).toISOString();
    const { count } = await supabaseAdmin
      .from("listes_achat")
      .select("id", { count: "exact", head: true })
      .like("nom", `${PREFIXE_NOM}%`)
      .gte("created_at", ilYaUneHeure);
    if ((count ?? 0) >= MAX_PAR_HEURE) {
      return repondre(origin, { error: "Trop de paniers transmis, appelez un conseiller" }, 429);
    }

    // 4. Relecture Shopify — seule source du titre, SKU, marque, image
    const data = await shopifyAdminGraphQL<{ nodes: NodeVariant[] }>(
      `query panierBorne($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on ProductVariant {
            id sku title
            image { url(transform: { maxWidth: 400, maxHeight: 400 }) }
            product { id title vendor status featuredMedia { preview { image { url(transform: { maxWidth: 400, maxHeight: 400 }) } } } }
          }
        }
      }`,
      { ids: [...demandes.keys()] }
    );

    const lignes: LigneListe[] = [];
    for (const n of data.nodes || []) {
      if (!n || !n.id || !n.product) continue;
      const numId = n.id.split("/").pop() || "";
      const vt = (n.title || "").trim();
      lignes.push({
        fournisseur: (n.product.vendor || "").trim() || "Shopify",
        sku: (n.sku || "").trim() || `VAR-${numId}`, // clé de dédoublonnage : jamais vide
        titre: n.product.title,
        variante_titre: vt && vt !== "Default Title" ? vt : null,
        variant_id: n.id,
        product_id: n.product.id,
        statut_fiche: n.product.status,
        qty: demandes.get(n.id) || 1,
        image_url: n.image?.url || n.product.featuredMedia?.preview?.image?.url || null,
        prix: null,
      });
    }
    const propres = normaliserLignes(lignes);
    if (propres.length === 0) return repondre(origin, { error: "Articles introuvables" }, 400);

    // 5. Code à 4 chiffres, unique parmi les paniers borne encore ouverts (7 j)
    const ilYa7j = new Date(Date.now() - 7 * 86400_000).toISOString();
    let code = "";
    for (let essai = 0; essai < 8; essai++) {
      const c = String(Math.floor(1000 + Math.random() * 9000));
      const { count: pris } = await supabaseAdmin
        .from("listes_achat")
        .select("id", { count: "exact", head: true })
        .like("nom", `${PREFIXE_NOM} · ${c} ·%`)
        .eq("statut", "ouverte")
        .gte("created_at", ilYa7j);
      if ((pris ?? 0) === 0) { code = c; break; }
    }
    if (!code) return repondre(origin, { error: "Réessayez dans un instant" }, 503);

    const heure = heureZurich();
    const { error } = await supabaseAdmin.from("listes_achat").insert({
      nom: `${PREFIXE_NOM} · ${code} · ${heure}`,
      cree_par: null,
      lignes: propres,
      nb_articles: nbArticles(propres),
      notes: `Panier transmis depuis une borne du magasin à ${heure}.`,
      est_modele: false,
    });
    if (error) {
      console.error("Panier borne — insert:", error.message);
      return repondre(origin, { error: "Enregistrement impossible" }, 500);
    }

    return repondre(origin, { code, nb: propres.length });
  } catch (err) {
    console.error("Panier borne error:", err);
    return repondre(origin, { error: "Erreur serveur" }, 500);
  }
}
