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
import { supabaseAdmin } from "@/lib/supabase";
import { normaliserMembre } from "@/lib/jardi-equipe";
import type { ListeAchat, LigneListe } from "@/lib/listes-achat";
import { construireLignesBrouillon } from "@/lib/listes-achat-lignes";
import { POST as creerDraft } from "@/app/api/drafts/route";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

    // ── Lignes du brouillon, prix Shopify relus à l'instant ──
    const { lines, nbProduits, nbCustom } = await construireLignesBrouillon(l.lignes as LigneListe[]);

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
