// app/api/stock-movements/process/route.ts
// POST { offre_slug } → traite tous les articles de la commande et fait les sorties Shopify
//
// Idempotent : si on rappelle, les lignes déjà "completed" sont ignorées (contrainte unique).
// Non bloquant : les erreurs créent une notif mais n'empêchent pas le flow principal.

import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { findVariantBySKU, adjustInventory, SHOPIFY_LOCATION_ID } from "@/lib/shopify-stock"
import { createNotification } from "@/lib/notifications"
import { isShopifyLine } from "@/lib/jc-print-types"

type LineItem = {
  id?: string
  type?: "product" | "custom" | "comment"
  sku?: string
  title?: string
  qty?: number
  unitPrice?: number
  shopifyLocked?: boolean
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const offre_slug: string = body.offre_slug
    const reason: string = body.reason || "commande_validee"

    if (!offre_slug) {
      return NextResponse.json({ error: "offre_slug requis" }, { status: 400 })
    }

    // 1. Charger la commande
    const { data: offre, error: readErr } = await supabaseAdmin
      .from("offres")
      .select("slug, type_document, numero_affiche, data, client_nom, client_prenom")
      .eq("slug", offre_slug)
      .single()

    if (readErr || !offre) {
      return NextResponse.json({ error: "Commande non trouvée" }, { status: 404 })
    }

    if (offre.type_document !== "Commande") {
      return NextResponse.json({ error: "Pas une commande" }, { status: 400 })
    }

    const lines: LineItem[] = (offre.data?.lines as LineItem[]) || []

    // 2. Séparation en deux passes (cf. PR #3 stock-movements-skipped-not-shopify) :
    //   Pass A — lignes Shopify (catalogue) : décrémentation réelle via API Shopify
    //   Pass B — lignes "à la volée" (custom hors-Shopify) : marqueur informatif
    //            "skipped_not_shopify" pour préserver la visibilité métier ("quelles
    //            lignes de la commande sont synchronisées vs non") sans polluer
    //            les notifications d'erreur Shopify.
    // Le critère unique de distinction est isShopifyLine() (cf. lib/jc-print-types.ts).
    const shopifyLines = lines.filter(l =>
      isShopifyLine(l) && (l.qty || 0) > 0
    )
    const skippedLines = lines.filter(l =>
      !isShopifyLine(l)
      && l.type !== "comment"
      && l.sku && l.sku.trim().length > 0
      && (l.qty || 0) > 0
    )

    if (shopifyLines.length === 0 && skippedLines.length === 0) {
      return NextResponse.json({
        success: true,
        message: "Aucun article éligible (pas de SKU)",
        results: [],
      })
    }

    // 3. Pour chaque ligne, créer/exécuter le mouvement
    const results: Array<{
      sku: string
      title: string
      qty: number
      status: "completed" | "skipped" | "failed" | "skipped_not_shopify"
      error?: string
      newQuantity?: number
    }> = []

    let firstErrorMsg: string | null = null
    const ledgerUri = (numeroAffiche: string | null) =>
      `gid://offres-jardin-confort/StockMovement/${numeroAffiche || offre_slug}`

    // ─── Pass B : lignes "à la volée" → marqueur skipped_not_shopify (pas d'appel Shopify) ───
    for (const line of skippedLines) {
      const sku = line.sku!.trim()
      const qty = Math.abs(line.qty || 0)
      const title = line.title || "Article"

      // Idempotence : si déjà marqué pour cette commande+sku+raison, on saute
      const { data: existing } = await supabaseAdmin
        .from("stock_movements")
        .select("id, status")
        .eq("offre_slug", offre_slug)
        .eq("sku", sku)
        .eq("reason", reason)
        .in("status", ["pending", "completed", "skipped_not_shopify"])
        .maybeSingle()

      if (existing) {
        results.push({ sku, title, qty, status: "skipped", error: "Déjà tracé" })
        continue
      }

      // Insertion directe avec status "skipped_not_shopify" + executed_at
      const { error: insertErr } = await supabaseAdmin
        .from("stock_movements")
        .insert({
          offre_slug,
          numero_affiche: offre.numero_affiche,
          sku,
          product_title: title,
          location_id: SHOPIFY_LOCATION_ID,
          quantity_change: -qty,
          reason,
          status: "skipped_not_shopify",
          executed_at: new Date().toISOString(),
        })

      if (insertErr) {
        // Race condition possible (contrainte unique) → on skippe, c'est OK
        results.push({ sku, title, qty, status: "skipped", error: "Race condition" })
        continue
      }

      results.push({ sku, title, qty, status: "skipped_not_shopify" })
    }

    // ─── Pass A : lignes Shopify → décrémentation réelle via Shopify Admin ───
    for (const line of shopifyLines) {
      const sku = line.sku!.trim()
      const qty = Math.abs(line.qty || 0)
      const title = line.title || "Article"

      // ─── Vérification idempotence : déjà sorti pour cette commande+sku+raison ? ───
      const { data: existing } = await supabaseAdmin
        .from("stock_movements")
        .select("id, status")
        .eq("offre_slug", offre_slug)
        .eq("sku", sku)
        .eq("reason", reason)
        .in("status", ["pending", "completed"])
        .maybeSingle()

      if (existing) {
        results.push({ sku, title, qty, status: "skipped", error: "Déjà sorti" })
        continue
      }

      // ─── Insérer la ligne en "pending" pour tracer la tentative ───
      const { data: movement, error: insertErr } = await supabaseAdmin
        .from("stock_movements")
        .insert({
          offre_slug,
          numero_affiche: offre.numero_affiche,
          sku,
          product_title: title,
          location_id: SHOPIFY_LOCATION_ID,
          quantity_change: -qty,
          reason,
          status: "pending",
        })
        .select("id")
        .single()

      if (insertErr || !movement) {
        // Probablement une violation de la contrainte unique → race condition, on skippe
        results.push({ sku, title, qty, status: "skipped", error: "Mouvement déjà en cours" })
        continue
      }

      // ─── Lookup du variant Shopify ───
      try {
        const variant = await findVariantBySKU(sku)
        if (!variant) {
          await supabaseAdmin.from("stock_movements").update({
            status: "failed",
            error_message: "SKU introuvable dans Shopify",
            executed_at: new Date().toISOString(),
          }).eq("id", movement.id)

          results.push({ sku, title, qty, status: "failed", error: "SKU introuvable dans Shopify" })
          firstErrorMsg = firstErrorMsg || `SKU ${sku} introuvable dans Shopify`
          continue
        }

        const before = variant.available

        // ─── Ajustement de l'inventaire ───
        // changeFromQuantity=null en interne → pas de blocage en cas de race condition
        const adj = await adjustInventory(
          variant.inventoryItemId,
          -qty,
          ledgerUri(offre.numero_affiche),
        )

        if (!adj.success) {
          await supabaseAdmin.from("stock_movements").update({
            status: "failed",
            error_message: adj.error || "Erreur Shopify inconnue",
            variant_id: variant.variantId,
            inventory_item_id: variant.inventoryItemId,
            quantity_before: before,
            shopify_response: adj.raw as object | null,
            executed_at: new Date().toISOString(),
          }).eq("id", movement.id)

          results.push({ sku, title, qty, status: "failed", error: adj.error })
          firstErrorMsg = firstErrorMsg || `${sku}: ${adj.error}`
          continue
        }

        // ─── Succès : compléter la ligne ───
        await supabaseAdmin.from("stock_movements").update({
          status: "completed",
          variant_id: variant.variantId,
          inventory_item_id: variant.inventoryItemId,
          quantity_before: before,
          quantity_after: adj.newQuantity ?? (before - qty),
          shopify_response: adj.raw as object | null,
          executed_at: new Date().toISOString(),
        }).eq("id", movement.id)

        results.push({ sku, title, qty, status: "completed", newQuantity: adj.newQuantity })

      } catch (err) {
        await supabaseAdmin.from("stock_movements").update({
          status: "failed",
          error_message: (err as Error).message,
          executed_at: new Date().toISOString(),
        }).eq("id", movement.id)

        results.push({ sku, title, qty, status: "failed", error: (err as Error).message })
        firstErrorMsg = firstErrorMsg || `${sku}: ${(err as Error).message}`
      }
    }

    // 4. Résumé
    const completed = results.filter(r => r.status === "completed").length
    const failed = results.filter(r => r.status === "failed").length
    const skipped = results.filter(r => r.status === "skipped").length
    const skippedNotShopify = results.filter(r => r.status === "skipped_not_shopify").length

    // 5. Si erreurs → notification
    if (failed > 0) {
      const nomComplet = [offre.client_prenom, offre.client_nom].filter(Boolean).join(" ")
      await createNotification({
        type: "commande_validee",  // on réutilise le type, le titre fait la distinction
        offre_slug: offre.slug,
        numero_affiche: offre.numero_affiche,
        type_document: "Commande",
        client_nom: offre.client_nom,
        client_prenom: offre.client_prenom,
        titre: `⚠️ Sortie stock partielle pour ${offre.numero_affiche}`,
        message: `${completed} OK · ${failed} en erreur${skipped ? ` · ${skipped} déjà sortis` : ""} — ${firstErrorMsg || ""}\nClient: ${nomComplet}`,
      })
    }

    return NextResponse.json({
      success: failed === 0,
      summary: { completed, failed, skipped, skippedNotShopify, total: results.length },
      results,
    })

  } catch (err) {
    console.error("Stock movements process error:", err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}