// app/api/listes-achat/[id]/brouillon/route.ts
// POST → crée un brouillon DRA-xxx à partir d'une liste d'achat.
//
// Les prix sont relus chez Shopify À L'INSTANT (Admin GraphQL nodes) — la
// liste n'en stocke aucun. Variantes Shopify → lignes « product » (verrouillées,
// shopifyVariantId, stock et politique à jour) ; SKU hors Shopify → lignes
// « custom » à compléter par le vendeur (prix 0, titre fabricant + SKU).
//
// Le brouillon est créé par le handler existant de /api/drafts (importé, pas
// d'appel HTTP interne — pas de cookie à transporter). Une liste « modèle »
// n'est jamais marquée transformée : on part toujours d'une copie.
//
// Body : { cree_par?: string, qui devient le commercial du brouillon }
// Renvoie : { editUrl, dashboardUrl, numeroAffiche, slug, nbProduits, nbCustom }

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { supabaseAdmin } from "@/lib/supabase";
import { shopifyAdminGraphQL } from "@/lib/shopify-stock";
import { normaliserMembre } from "@/lib/jardi-equipe";
import type { ListeAchat, LigneListe } from "@/lib/listes-achat";
import type { QuoteLine } from "@/lib/jc-print-types";
import { POST as creerDraft } from "@/app/api/drafts/route";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type NodeVariant = {
  id: string;
  sku: string | null;
  title: string | null;
  price: string;
  inventoryQuantity: number | null;
  inventoryPolicy: "DENY" | "CONTINUE";
  image: { url: string } | null;
  product: {
    title: string;
    status: string;
    featuredMedia: { preview: { image: { url: string } | null } | null } | null;
  } | null;
} | null;

function gid(id: string): string {
  return id.startsWith("gid://") ? id : `gid://shopify/ProductVariant/${id}`;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!UUID.test(id)) return NextResponse.json({ error: "Id invalide" }, { status: 400 });
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const { data: liste, error } = await supabaseAdmin.from("listes_achat").select("*").eq("id", id).maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!liste) return NextResponse.json({ error: "Liste introuvable" }, { status: 404 });
    const l = liste as ListeAchat;
    if (!Array.isArray(l.lignes) || l.lignes.length === 0) {
      return NextResponse.json({ error: "Liste vide" }, { status: 400 });
    }

    // ── Prix et état Shopify à l'instant T ──
    const ids = l.lignes.filter((x) => x.variant_id).map((x) => gid(String(x.variant_id)));
    const infos = new Map<string, NonNullable<NodeVariant>>();
    for (let i = 0; i < ids.length; i += 250) {
      const data = await shopifyAdminGraphQL<{ nodes: NodeVariant[] }>(
        `query listeAchatBrouillon($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on ProductVariant {
              id sku title price inventoryQuantity inventoryPolicy
              image { url(transform: { maxWidth: 400, maxHeight: 400 }) }
              product { title status featuredMedia { preview { image { url(transform: { maxWidth: 400, maxHeight: 400 }) } } } }
            }
          }
        }`,
        { ids: ids.slice(i, i + 250) }
      );
      for (const n of data.nodes || []) if (n) infos.set(n.id, n);
    }

    // ── Lignes du brouillon (format QuoteLine du formulaire) ──
    const lines: QuoteLine[] = [];
    let nbProduits = 0, nbCustom = 0;
    for (const x of l.lignes as LigneListe[]) {
      const qty = Math.max(1, Number(x.qty) || 1);
      const info = x.variant_id ? infos.get(gid(String(x.variant_id))) : undefined;
      if (info) {
        const vt = (info.title || "").trim();
        const titre = info.product ? (vt && vt !== "Default Title" ? `${info.product.title} / ${vt}` : info.product.title) : (x.titre || x.sku);
        lines.push({
          id: randomUUID(),
          type: "product",
          image: info.image?.url || info.product?.featuredMedia?.preview?.image?.url || x.image_url || "",
          sku: info.sku || x.sku,
          title: titre,
          unitPrice: Number(info.price) || 0,
          qty,
          stock: info.inventoryQuantity ?? null,
          inventoryPolicy: info.inventoryPolicy,
          shopifyLocked: true,
          shopifyVariantId: info.id,
        });
        nbProduits++;
      } else {
        // Hors Shopify (ou variante disparue) : article à la volée, prix à compléter
        lines.push({
          id: randomUUID(),
          type: "custom",
          image: x.image_url || "",
          sku: x.sku,
          title: x.titre ? [x.titre, x.variante_titre].filter(Boolean).join(" / ") : `${x.fournisseur} — ${x.sku} (article à créer)`,
          unitPrice: 0,
          qty,
        });
        nbCustom++;
      }
    }

    const commercial = normaliserMembre(body.cree_par) ?? normaliserMembre(l.cree_par) ?? "";
    const aujourdhui = new Date().toISOString().slice(0, 10);
    const data = {
      formType: "Offre",
      clientType: "Privé (prix TTC)",
      paymentMode: "Acompte de 50% à la commande",
      offerStatus: "En cours",
      date: aujourdhui,
      commercial,
      reference: l.nom,
      societe: "", nom: "", prenom: "", rue: "", numero: "", npa: "", ville: "",
      telephone1: "", telephone2: "", email: "", customerNumber: "",
      livrDiff: false, livrSociete: "", livrNom: "", livrPrenom: "", livrTel: "", livrRue: "", livrNumero: "", livrNpa: "", livrVille: "",
      lines,
      discount: "0", discountPercent: "0", manualRounding: "",
      enabledServices: {}, servicePrices: {},
      remarks: "", leadTime: "",
      notesInternes: `Créé depuis la liste d'achat « ${l.nom} »${nbCustom > 0 ? ` — ${nbCustom} article(s) hors Shopify à compléter (prix à 0)` : ""}`,
      ambianceImages: [],
    };

    const reqDraft = new NextRequest(new URL("/api/drafts", request.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data }),
    });
    const resDraft = await creerDraft(reqDraft);
    const jsonDraft = (await resDraft.json()) as { success?: boolean; slug?: string; numeroAffiche?: string; editUrl?: string; dashboardUrl?: string; error?: string };
    if (!resDraft.ok || !jsonDraft.slug) {
      return NextResponse.json({ error: jsonDraft.error || "Création du brouillon impossible" }, { status: 500 });
    }

    // Une liste ordinaire est marquée transformée ; un modèle reste intact.
    if (!l.est_modele) {
      await supabaseAdmin
        .from("listes_achat")
        .update({ statut: "transformee", draft_slug: jsonDraft.slug, draft_numero: jsonDraft.numeroAffiche ?? null, updated_at: new Date().toISOString() })
        .eq("id", id);
    }

    return NextResponse.json({
      slug: jsonDraft.slug,
      numeroAffiche: jsonDraft.numeroAffiche,
      editUrl: jsonDraft.editUrl,
      dashboardUrl: jsonDraft.dashboardUrl,
      nbProduits,
      nbCustom,
    });
  } catch (err) {
    console.error("Liste d'achat → brouillon error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
