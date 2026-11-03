// app/api/cron/saferpay-statuts/route.ts
//
// Tâche planifiée : relit chez Saferpay le statut des liens carte encore
// ouverts, pour que le badge « Acompte reçu » s'allume sans que personne
// n'ouvre la fiche commande.
//
// Pourquoi un cron et pas (encore) un webhook : Saferpay sait notifier un
// serveur après chaque paiement (case « Notifiez votre serveur une fois le
// paiement effectué » des paramètres Secure PayGate), mais la forme exacte de
// sa charge utile n'a pas été observée. Tant qu'on ne l'a pas vue passer, on
// ne code pas à l'aveugle : le cron suffit, et il restera ensuite comme filet
// derrière le webhook. Une offre expire au bout de 30 jours, donc la boucle se
// termine toujours.
//
// Authentification : Vercel joint `Authorization: Bearer $CRON_SECRET`, la
// route refuse tout le reste ; le proxy laisse passer /api/cron/*.
// Planification dans vercel.json.
//
// N'écrit QUE dans transactions_saferpay. Aucun impact stock, aucun mail.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { configSaferpay, lireLienPaiement } from "@/lib/saferpay";
import type { StatutSaferpay } from "@/lib/saferpay";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Garde-fou : on ne relit jamais plus que ça en un passage.
const MAX_PAR_PASSAGE = 50;

function autorise(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron/saferpay-statuts] CRON_SECRET absent des variables d'environnement");
    return false;
  }
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: NextRequest) {
  if (!autorise(request)) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const cfg = configSaferpay();
  if (!cfg) {
    console.error("[cron/saferpay-statuts] configuration Saferpay incomplète");
    return NextResponse.json({ error: "Configuration Saferpay incomplète" }, { status: 500 });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from("transactions_saferpay")
      .select("id, offer_id, statut, paid_at, environnement")
      .eq("statut", "OPEN")
      .eq("environnement", cfg.environnement)
      .order("created_at", { ascending: true })
      .limit(MAX_PAR_PASSAGE);
    if (error) throw new Error(error.message);

    const ouvertes = (data || []) as Array<{ id: string; offer_id: string; statut: StatutSaferpay; paid_at: string | null }>;
    let relues = 0, payees = 0, erreurs = 0;

    for (const l of ouvertes) {
      try {
        const o = await lireLienPaiement(cfg, l.offer_id);
        const statut = (o.Status || l.statut) as StatutSaferpay;
        const maintenant = new Date().toISOString();
        relues++;
        if (statut === l.statut) {
          await supabaseAdmin
            .from("transactions_saferpay")
            .update({ statut_checked_at: maintenant })
            .eq("id", l.id);
          continue;
        }
        if (statut === "PAID") payees++;
        const { error: errUpd } = await supabaseAdmin
          .from("transactions_saferpay")
          .update({
            statut,
            transaction_id: o.TransactionId ?? null,
            paid_at: statut === "PAID" ? (l.paid_at ?? maintenant) : l.paid_at,
            statut_checked_at: maintenant,
            updated_at: maintenant,
            raw: o as unknown as Record<string, unknown>,
          })
          .eq("id", l.id);
        if (errUpd) { erreurs++; console.error("[cron/saferpay-statuts] update:", errUpd.message); }
      } catch (err) {
        erreurs++;
        console.error(`[cron/saferpay-statuts] offre ${l.offer_id}:`, err);
      }
    }

    console.log(`[cron/saferpay-statuts] ouvertes=${ouvertes.length} relues=${relues} payées=${payees} erreurs=${erreurs}`);
    return NextResponse.json({ ouvertes: ouvertes.length, relues, payees, erreurs });
  } catch (err) {
    console.error("[cron/saferpay-statuts] erreur:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
