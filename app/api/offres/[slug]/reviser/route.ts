// app/api/offres/[slug]/reviser/route.ts
// POST /api/offres/[slug]/reviser
// Révise une commande validée :
//   1. Charge l'état actuel
//   2. Calcule le diff (ancien data.lines vs nouveau, matching par id)
//   3. Appelle la RPC atomique reviser_commande (snapshot + nouveau data + retraits)
//   4. APRÈS succès RPC : décrémente Shopify pour le DELTA des ajouts uniquement
//      (insertion directe des stock_movements, sans rappeler process → pas de
//       double-décrément des lignes initiales). Best-effort, non bloquant.
//
// NE crée PAS de nouvelle ligne offres. La commande garde son slug et son numéro.

import { NextRequest, NextResponse, after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { computeTotals } from "@/lib/jc-print-types";
import { computeRevisionDiff, RevisionLine } from "@/lib/revision-diff";
import {
  findVariantBySKU,
  adjustInventory,
  SHOPIFY_LOCATION_ID,
} from "@/lib/shopify-stock";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const body = await request.json();
    const { data: newData, commercial } = body;

    if (!newData || !Array.isArray(newData.lines)) {
      return NextResponse.json(
        { error: "Données de révision manquantes ou invalides" },
        { status: 400 }
      );
    }

    // 1. Charger l'état ACTUEL de la commande
    const { data: offre, error: readErr } = await supabaseAdmin
      .from("offres")
      .select("slug, type_document, numero_affiche, data, statut")
      .eq("slug", slug)
      .single();

    if (readErr || !offre) {
      return NextResponse.json({ error: "Commande introuvable" }, { status: 404 });
    }
    if (offre.type_document !== "Commande") {
      return NextResponse.json(
        { error: "Ce document n'est pas une commande" },
        { status: 400 }
      );
    }

    const oldLines: RevisionLine[] = (offre.data?.lines as RevisionLine[]) || [];
    const newLines: RevisionLine[] = newData.lines as RevisionLine[];

    // 2. Calcul du diff (lignes + en-tête : tout changement crée une version)
    const { diff, retraits, ajouts, hasChanges } = computeRevisionDiff(
      oldLines,
      newLines,
      (offre.data as Record<string, unknown>) || {},
      (newData as Record<string, unknown>) || {}
    );

    if (!hasChanges) {
      return NextResponse.json(
        { error: "Aucun changement détecté", noChanges: true },
        { status: 400 }
      );
    }

    // Cohérence des totaux sur le nouveau data
    const totals = computeTotals(newData);
    const enrichedData = { ...newData, _totals: totals };

    // 3. RPC atomique : snapshot + nouveau data + retraits + version
    const { data: rpcResult, error: rpcErr } = await supabaseAdmin.rpc(
      "reviser_commande",
      {
        p_slug: slug,
        p_new_data: enrichedData,
        p_diff: diff,
        p_commercial: commercial || null,
        p_retraits: retraits,
      }
    );

    if (rpcErr) {
      return NextResponse.json(
        { error: "Échec de la révision: " + rpcErr.message },
        { status: 500 }
      );
    }

    const versionNum =
      (rpcResult as { version_num?: number })?.version_num ?? null;

    // 4. APRÈS succès : décrément Shopify du DELTA des ajouts Shopify uniquement.
    //    On insère nous-mêmes les mouvements (reason "revision_ajout") et on
    //    ajuste Shopify ligne par ligne. On NE rappelle PAS process (qui
    //    traiterait toutes les lignes → double-décrément).
    const shopifyAjouts = ajouts.filter((a) => a.is_shopify && a.quantity > 0);

    if (shopifyAjouts.length > 0) {
      const ledgerUri = `gid://offres-jardin-confort/StockMovement/${
        offre.numero_affiche || slug
      }`;

      after(async () => {
        for (const aj of shopifyAjouts) {
          const sku = (aj.sku || "").trim();
          const qty = Math.abs(aj.quantity);
          if (!sku || qty <= 0) continue;

          // Insérer le mouvement en "pending" (reason dédié révision +
          // version_num dans la raison pour ne jamais collisionner l'idempotence)
          const reason = `revision_ajout_v${versionNum ?? "x"}`;

          // Idempotence : déjà traité pour cette commande+sku+raison ?
          const { data: existing } = await supabaseAdmin
            .from("stock_movements")
            .select("id")
            .eq("offre_slug", slug)
            .eq("sku", sku)
            .eq("reason", reason)
            .in("status", ["pending", "completed"])
            .maybeSingle();
          if (existing) continue;

          const { data: movement, error: insertErr } = await supabaseAdmin
            .from("stock_movements")
            .insert({
              offre_slug: slug,
              numero_affiche: offre.numero_affiche,
              sku,
              product_title: aj.title || "Article",
              location_id: SHOPIFY_LOCATION_ID,
              quantity_change: -qty,
              reason,
              status: "pending",
            })
            .select("id")
            .single();

          if (insertErr || !movement) continue;

          try {
            const variant = await findVariantBySKU(sku);
            if (!variant) {
              await supabaseAdmin
                .from("stock_movements")
                .update({
                  status: "failed",
                  error_message: "SKU introuvable dans Shopify",
                  executed_at: new Date().toISOString(),
                })
                .eq("id", movement.id);
              continue;
            }

            const before = variant.available;
            const adj = await adjustInventory(
              variant.inventoryItemId,
              -qty,
              ledgerUri
            );

            if (!adj.success) {
              await supabaseAdmin
                .from("stock_movements")
                .update({
                  status: "failed",
                  error_message: adj.error || "Erreur Shopify inconnue",
                  variant_id: variant.variantId,
                  inventory_item_id: variant.inventoryItemId,
                  quantity_before: before,
                  shopify_response: (adj.raw as object) || null,
                  executed_at: new Date().toISOString(),
                })
                .eq("id", movement.id);
              continue;
            }

            await supabaseAdmin
              .from("stock_movements")
              .update({
                status: "completed",
                variant_id: variant.variantId,
                inventory_item_id: variant.inventoryItemId,
                quantity_before: before,
                quantity_after: adj.newQuantity ?? null,
                shopify_response: (adj.raw as object) || null,
                executed_at: new Date().toISOString(),
              })
              .eq("id", movement.id);
          } catch (e) {
            await supabaseAdmin
              .from("stock_movements")
              .update({
                status: "failed",
                error_message: String(e),
                executed_at: new Date().toISOString(),
              })
              .eq("id", movement.id);
          }
        }
      });
    }

    // 5. Documents de la commande : PDF + QR de paiement.
    //    Chantier « PDF de commande toujours a jour » (23.08.2026).
    //    Une revision change le contenu ET le total. Sans cette etape, le PDF
    //    Storage reste celui d'avant la revision et le QR reclame l'ancien
    //    montant - c'etait le cas pour 60 commandes revisees.
    //    Acte utilisateur explicite (l'enregistrement de la revision), jamais
    //    un timer. Best-effort : la revision reste valide si pdf.co echoue.
    //    Aucun risque sur le stock : /api/offres/[slug] renvoie pour une
    //    commande les lignes figees de data, jamais Shopify en direct.
    //    Le fichier sanctuarise api/offres/[slug]/qr n'est pas modifie, il est
    //    seulement appele - son POST relit total_ttc a l'instant.
    after(async () => {
      const BASE_URL =
        process.env.NEXT_PUBLIC_APP_URL || "https://offres.jardin-confort.ch";
      const EN_TETE_INTERNE = {
        "x-jc-interne": process.env.DASHBOARD_SESSION_SECRET || "",
      };
      await Promise.allSettled([
        fetch(`${BASE_URL}/api/offres/${slug}/pdf`, {
          method: "POST",
          headers: EN_TETE_INTERNE,
        }).catch((err) => console.error("[after] PDF revision err:", err)),
        fetch(`${BASE_URL}/api/offres/${slug}/qr`, {
          method: "POST",
          headers: EN_TETE_INTERNE,
        }).catch((err) => console.error("[after] QR revision err:", err)),
      ]);
    });

    return NextResponse.json({
      success: true,
      version_num: versionNum,
      diff,
      retraits_count: retraits.length,
      ajouts_shopify_count: shopifyAjouts.length,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}