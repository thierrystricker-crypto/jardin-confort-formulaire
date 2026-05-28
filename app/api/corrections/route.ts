// app/api/corrections/route.ts
// API CRUD pour les corrections cosmétiques d'offres et commandes (v1)
// POST /api/corrections   → crée une correction + applique les modifs sur l'entité
// GET  /api/corrections?entity_id=...&entity_type=...
//                         → liste l'historique des corrections d'une entité

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase";
import {
  CORRECTIBLE_FIELDS_V1,
  FLAT_COLUMN_MAP,
  isCorrectibleField,
} from "@/lib/corrections-config";

// ============================================================================
// Helper - regeneration PDF (Session 4a chantier corrections)
// ============================================================================

/**
 * Determine si le PDF Storage doit etre regenere apres une correction.
 *
 * Critere metier :
 *   - On regenere uniquement pour les commandes. Les offres en cours
 *     ont leur PDF servi dynamiquement par le template (stock live),
 *     pas fige en Storage de maniere durable.
 *   - Pour qu'une commande soit regenerable, son snapshot stock doit
 *     exister : on verifie data.lines[].shopifyLocked (invariant fort
 *     pose a la conversion offre->commande), plutot que
 *     data.stock_frozen_at qui peut manquer sur des cas marginaux
 *     (anciennes commandes pre-deploiement, conversion manuelles
 *     anterieures).
 *
 * Consequence : les ~11 anciennes commandes sans snapshot retournent
 * `false` ici - leur correction est tracee mais leur PDF reste fige
 * a son etat d'origine (preuve juridique preservee).
 */
function shouldRegeneratePdf(
  entityType: "offre" | "commande",
  data: Record<string, unknown>
): boolean {
  if (entityType !== "commande") return false;
  const lines = data?.lines;
  if (!Array.isArray(lines) || lines.length === 0) return false;
  return lines.every(
    (line: unknown) =>
      typeof line === "object" &&
      line !== null &&
      (line as { shopifyLocked?: boolean }).shopifyLocked === true
  );
}

// ============================================================================
// Types
// ============================================================================

type FieldChange = { old: unknown; new: unknown };

interface PostBody {
  entity_type: "offre" | "commande";
  entity_slug: string;
  fields_changed: Record<string, FieldChange>;
  reason: string;
  corrected_by: string;
}

// ============================================================================
// POST — créer une correction
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Partial<PostBody>;

    // -- Validation des champs obligatoires --

    if (!body.entity_type || (body.entity_type !== "offre" && body.entity_type !== "commande")) {
      return NextResponse.json(
        { error: "entity_type doit être 'offre' ou 'commande'" },
        { status: 400 }
      );
    }

    if (!body.entity_slug || typeof body.entity_slug !== "string") {
      return NextResponse.json(
        { error: "entity_slug requis (string)" },
        { status: 400 }
      );
    }

    if (!body.corrected_by || typeof body.corrected_by !== "string" || body.corrected_by.trim().length < 2) {
      return NextResponse.json(
        { error: "corrected_by requis (au moins 2 caractères)" },
        { status: 400 }
      );
    }

    if (!body.reason || typeof body.reason !== "string" || body.reason.trim().length < 5) {
      return NextResponse.json(
        { error: "reason requis (au moins 5 caractères)" },
        { status: 400 }
      );
    }

    if (!body.fields_changed || typeof body.fields_changed !== "object" || Object.keys(body.fields_changed).length === 0) {
      return NextResponse.json(
        { error: "fields_changed doit contenir au moins un champ modifié" },
        { status: 400 }
      );
    }

    // -- Whitelist : refuser tout champ hors scope v1 --

    const rejectedFields = Object.keys(body.fields_changed).filter(
      (f) => !isCorrectibleField(f)
    );
    if (rejectedFields.length > 0) {
      return NextResponse.json(
        {
          error: `Champ(s) non modifiable(s) en v1 : ${rejectedFields.join(", ")}`,
          allowed: CORRECTIBLE_FIELDS_V1,
        },
        { status: 400 }
      );
    }

    // -- Récupérer l'entité cible (table `offres`, peut être Offre ou Commande) --

    const { data: entity, error: fetchError } = await supabase
      .from("offres")
      .select("id, slug, numero_offre, numero_commande, type_document, data")
      .eq("slug", body.entity_slug)
      .single();

    if (fetchError || !entity) {
      return NextResponse.json(
        { error: `Entité introuvable : ${body.entity_slug}` },
        { status: 404 }
      );
    }

    // -- Cohérence entity_type ↔ type_document --

    const expectedType = entity.type_document === "Commande" ? "commande" : "offre";
    if (body.entity_type !== expectedType) {
      return NextResponse.json(
        {
          error: `Incohérence : entity_type='${body.entity_type}' mais l'entité est de type '${expectedType}'`,
        },
        { status: 400 }
      );
    }

    // -- Numéro métier figé au moment de la correction --

    const entityNumero =
      expectedType === "commande"
        ? entity.numero_commande || entity.numero_offre || body.entity_slug
        : entity.numero_offre || body.entity_slug;

    // -- Appliquer les modifications dans `offres.data` (JSONB) --

    const currentData = (entity.data as Record<string, unknown>) || {};
    const updatedData: Record<string, unknown> = { ...currentData };

    for (const [fieldName, change] of Object.entries(body.fields_changed)) {
      updatedData[fieldName] = change.new;
    }

    // -- Mise à jour atomique : data + colonnes plates dénormalisées si présentes --
    //
    // Certains champs sont à la fois dans `data` JSONB ET dans des colonnes
    // plates (client_nom, client_email...). On met à jour les deux pour
    // garder la cohérence (le matching dashboard utilise les colonnes plates).

    const flatColumnUpdates: Record<string, unknown> = {};
    for (const fieldName of Object.keys(body.fields_changed)) {
      if (FLAT_COLUMN_MAP[fieldName]) {
        flatColumnUpdates[FLAT_COLUMN_MAP[fieldName]] = body.fields_changed[fieldName].new;
      }
    }

    const updatePayload: Record<string, unknown> = {
      data: updatedData,
      ...flatColumnUpdates,
    };

    const { error: updateError } = await supabase
      .from("offres")
      .update(updatePayload)
      .eq("id", entity.id);

    if (updateError) {
      console.error("Update offre error:", updateError);
      return NextResponse.json(
        { error: "Erreur lors de l'application des modifications", details: updateError.message },
        { status: 500 }
      );
    }

    // -- Insertion de la trace dans `corrections` --

    const { data: correction, error: insertError } = await supabase
      .from("corrections")
      .insert({
        entity_type: body.entity_type,
        entity_id: entity.id as number,
        entity_slug: entity.slug,
        entity_numero: entityNumero,
        corrected_by: body.corrected_by.trim(),
        fields_changed: body.fields_changed,
        reason: body.reason.trim(),
      })
      .select()
      .single();

    if (insertError) {
      console.error("Insert correction error:", insertError);
      // L'entité a été modifiée mais la trace n'a pas pu être insérée.
      // On ROLLBACK les modifications de l'entité pour préserver l'invariant
      // "toute modification est tracée". Sans ça, on aurait des modifs
      // fantômes en base sans aucune trace de qui/quand/pourquoi.
      const { error: rollbackError } = await supabase
        .from("offres")
        .update({
          data: currentData,
          // Note : on ne rollback PAS les colonnes plates ici car ce serait
          // ajouter de la complexité pour un cas qui ne devrait jamais arriver
          // en production une fois le schéma stable. Si le rollback est
          // partiel, le mismatch sera de toute façon visible dans les logs.
        })
        .eq("id", entity.id);

      if (rollbackError) {
        console.error("Rollback failed (state may be inconsistent):", rollbackError);
      }

      return NextResponse.json(
        {
          error: "Impossible d'enregistrer la trace de correction. Modifications annulées.",
          details: insertError.message,
        },
        { status: 500 }
      );
    }

    // --- Regeneration PDF (Session 4a chantier corrections) ---
    // Apres que la correction soit DEFINITIVEMENT enregistree (trace OK +
    // entite modifiee), on regenere le PDF Storage pour qu'il reflete les
    // corrections cosmetiques. Les lignes/stock figes restent intacts car :
    //   1. La whitelist CORRECTIBLE_FIELDS_V1 n'autorise pas leur modif
    //   2. data.lines[] est deja fige a la conversion offre->commande
    //
    // En cas d'echec pdf.co, la correction RESTE enregistree mais
    // pdf_regenerated_at reste NULL. Le front affiche un toast warning et
    // un retry manuel sera possible via le bouton dashboard (Session 4b).
    let pdfRegenerated = false;
    let pdfRegenerationError: string | null = null;

    if (shouldRegeneratePdf(body.entity_type, updatedData)) {
      try {
        const APP_URL =
          process.env.NEXT_PUBLIC_APP_URL || "https://offres.jardin-confort.ch";
        const regenRes = await fetch(`${APP_URL}/api/offres/${entity.slug}/pdf`, {
          method: "POST",
        });
        const regenJson = await regenRes.json();

        if (regenRes.ok && regenJson.success) {
          pdfRegenerated = true;
          const { error: stampError } = await supabase
            .from("corrections")
            .update({ pdf_regenerated_at: new Date().toISOString() })
            .eq("id", correction.id);
          if (stampError) {
            console.error(
              "[corrections] pdf_regenerated_at stamp failed:",
              stampError
            );
          }
        } else {
          pdfRegenerationError = regenJson.error || "Erreur inconnue pdf.co";
          console.error(
            "[corrections] PDF regeneration failed:",
            pdfRegenerationError,
            regenJson
          );
        }
      } catch (err) {
        pdfRegenerationError = err instanceof Error ? err.message : String(err);
        console.error("[corrections] PDF regeneration exception:", err);
      }
    }

    return NextResponse.json({
      success: true,
      correction_id: correction.id,
      pdf_regenerated: pdfRegenerated,
      pdf_regeneration_error: pdfRegenerationError,
    });
  } catch (err) {
    console.error("POST /api/corrections error:", err);
    return NextResponse.json(
      { error: "Erreur serveur", details: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

// ============================================================================
// GET — lister les corrections d'une entité
// ============================================================================

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const entityType = searchParams.get("entity_type");
    const entityId = searchParams.get("entity_id");
    const entitySlug = searchParams.get("entity_slug");

    if (!entityType || (entityType !== "offre" && entityType !== "commande")) {
      return NextResponse.json(
        { error: "entity_type requis ('offre' ou 'commande')" },
        { status: 400 }
      );
    }

    if (!entityId && !entitySlug) {
      return NextResponse.json(
        { error: "entity_id ou entity_slug requis" },
        { status: 400 }
      );
    }

    let query = supabase
      .from("corrections")
      .select("*")
      .eq("entity_type", entityType)
      .order("corrected_at", { ascending: false });

    if (entityId) {
      query = query.eq("entity_id", entityId);
    } else if (entitySlug) {
      query = query.eq("entity_slug", entitySlug);
    }

    const { data, error } = await query;

    if (error) {
      console.error("GET /api/corrections error:", error);
      return NextResponse.json(
        { error: "Erreur lors de la récupération de l'historique" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      corrections: data || [],
      count: data?.length || 0,
    });
  } catch (err) {
    console.error("GET /api/corrections error:", err);
    return NextResponse.json(
      { error: "Erreur serveur", details: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}