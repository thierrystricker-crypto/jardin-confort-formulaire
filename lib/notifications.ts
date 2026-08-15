// lib/notifications.ts
// Helper pour créer des notifications internes depuis les routes API

import { supabaseAdmin } from "@/lib/supabase";

type NotificationType = "commande_validee" | "commande_convertie_manuelle" | "commande_directe" | "offre_abandonnee" | "stock_erreur" | "shopify_sync_erreur" | "webhook_make_echec";

type CreateNotificationInput = {
  type: NotificationType;
  offre_slug?: string | null;
  numero_affiche?: string | null;
  type_document?: string | null;
  client_nom?: string | null;
  client_prenom?: string | null;
  client_societe?: string | null;
  commercial?: string | null;
  total_ttc?: number | null;
  payment_mode?: string | null;
  titre?: string | null;
  message?: string | null;
};

const DEFAULT_TITRES: Record<NotificationType, string> = {
  commande_validee: "🎉 Nouvelle commande validée online",
  commande_convertie_manuelle: "🔄 Commande créée par conversion manuelle",
  commande_directe: "📋 Nouvelle commande créée directement",
  offre_abandonnee: "❌ Offre marquée comme abandonnée",
  stock_erreur: "⚠️ Erreur de sortie de stock Shopify",
  shopify_sync_erreur: "⚠️ Import des commandes Shopify en défaut",
  webhook_make_echec: "⚠️ Webhook Make en échec — mails de confirmation non envoyés",
};

/**
 * Crée une notification seulement s'il n'en existe pas déjà une du même type,
 * non lue, dans la fenêtre indiquée. Évite qu'une tâche planifiée horaire
 * n'empile 24 alertes identiques par jour tant que le problème dure.
 */
export async function createNotificationUnique(
  input: CreateNotificationInput,
  fenetreHeures = 12
): Promise<boolean> {
  try {
    const depuis = new Date(Date.now() - fenetreHeures * 3600 * 1000).toISOString();
    const { count } = await supabaseAdmin
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("type", input.type)
      .eq("vue", false)
      .gte("created_at", depuis);

    if ((count || 0) > 0) return false;  // déjà signalé, on n'en rajoute pas
    await createNotification(input);
    return true;
  } catch (err) {
    console.error("createNotificationUnique exception:", err);
    return false;
  }
}

/**
 * Crée une notification dans la base. Non bloquant : si erreur, log et continue.
 * Utilisé typiquement après création/conversion de commande.
 */
export async function createNotification(input: CreateNotificationInput): Promise<void> {
  try {
    const titre = input.titre || DEFAULT_TITRES[input.type];

    // Message par défaut : nom client + montant
    const nomComplet = [input.client_prenom, input.client_nom].filter(Boolean).join(" ");
    const message = input.message
      || (input.total_ttc
          ? `${nomComplet} · CHF ${new Intl.NumberFormat("de-CH", { minimumFractionDigits: 2 }).format(input.total_ttc)}`
          : nomComplet);

    const { error } = await supabaseAdmin
      .from("notifications")
      .insert({
        type: input.type,
        offre_slug: input.offre_slug || null,
        numero_affiche: input.numero_affiche || null,
        type_document: input.type_document || null,
        client_nom: input.client_nom || null,
        client_prenom: input.client_prenom || null,
        client_societe: input.client_societe || null,
        commercial: input.commercial || null,
        total_ttc: input.total_ttc ?? null,
        payment_mode: input.payment_mode || null,
        titre,
        message,
      });

    if (error) {
      console.error("createNotification error:", error);
    }
  } catch (err) {
    // Ne jamais faire échouer le flow appelant à cause d'une notif
    console.error("createNotification exception:", err);
  }
}