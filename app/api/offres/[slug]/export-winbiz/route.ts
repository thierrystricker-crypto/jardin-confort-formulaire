// app/api/offres/[slug]/export-winbiz/route.ts
// Chantier « Export Winbiz » — étape 4 : générer le fichier bizexdoc d'une
// commande, l'attribuer au bon client Winbiz, le déposer sur Google Drive
// (webhook Make dédié), tracer dans winbiz_exports.
//
// GET  : état + attribution À BLANC (dry-run) — ce que le bouton affiche AVANT
//        confirmation : « sera attribuée à {code} {nom} » / « partira sur le
//        client 999 ({raison}) », les exports passés, et si la commande a été
//        révisée OU corrigée depuis le dernier export. Ne génère rien,
//        n'écrit rien.
// POST : génère (invariant bloquant), insère la trace, dépose via le webhook,
//        met à jour le statut (genere → depose | erreur).
//
// Garde-fous (cadrage + arbitrages du 29.08) :
// - l'export ne modifie JAMAIS la commande : lecture seule sur offres, les
//   seules écritures sont dans winbiz_exports ;
// - aucun appel Shopify, aucun mouvement de stock, aucun fichier sanctuarisé ;
// - jamais de choix silencieux d'attribution (lib/winbiz-match) ;
// - fichier clients d'un AUTRE exercice que la commande → repli 999
//   « sans fichier » : un fichier périmé attribuerait au mauvais client sans
//   erreur visible, le pire des modes de panne (cadrage §6.2.4) ;
// - webhook : URL ET clé en variables d'environnement, statut de réponse LU
//   (un 401 ne lève pas d'exception — leçon du chantier 2) ;
// - depuis une preview (VERCEL_ENV ≠ production), le payload part avec
//   test: true → le scénario Make range dans le dossier de TEST.
//
// Route INTERNE : protégée par le verrou proxy.ts.

import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { supabaseAdmin } from "@/lib/supabase";
import { buildWinbizCsv, genererRunId, type WinbizAttribution } from "@/lib/winbiz-export";
import { matchClient, type AdresseWinbiz, type MatchResultat } from "@/lib/winbiz-match";
import type { PrintData } from "@/lib/jc-print-types";

export const maxDuration = 60;

const WEBHOOK_URL = process.env.WINBIZ_DRIVE_WEBHOOK_URL || "";
const WEBHOOK_KEY = process.env.WINBIZ_DRIVE_API_KEY || "";
const EST_PROD = process.env.VERCEL_ENV === "production";

/** Fichier clients plus vieux que N jours → avertissement (non bloquant). */
const FRAICHEUR_JOURS = 30;

// ── Exercice comptable Jardin-Confort : 1er octobre → 30 septembre (doc 03) ──
function exerciceDeDate(iso: string): number {
  const d = new Date(iso);
  return d.getMonth() >= 9 ? d.getFullYear() + 1 : d.getFullYear();
}

type OffreRowMin = {
  id: number;
  slug: string;
  type_document: string;
  numero_commande: string | null;
  date_document: string | null;
  total_ttc: number | string | null;
  commercial: string | null;
  data: PrintData;
};

type Etat = {
  offre: OffreRowMin;
  exercice: number;
  /** version vivante de la commande : MAX(version_num des révisions) + 1 (doc 03 §2) */
  commandeVersion: number;
  attribution: MatchResultat;
  exerciceFichier: number | null;
  fichierImporteLe: string | null;
  avertissements: string[];
  exportsPasses: Array<{
    version: number; commande_version: number | null; created_at: string; statut: string;
    client_code: string | null; filename: string; run_id: string; montant: number; erreur: string | null;
  }>;
  modifieeDepuis: { type: "révision" | "correction"; date: string } | null;
};

async function chargerEtat(slug: string): Promise<Etat | { erreur: string; status: number }> {
  const { data: offre, error } = await supabaseAdmin
    .from("offres")
    .select("id, slug, type_document, numero_commande, date_document, total_ttc, commercial, data")
    .eq("slug", slug)
    .single();

  if (error || !offre) return { erreur: "Commande introuvable", status: 404 };
  const o = offre as OffreRowMin;
  if (o.type_document !== "Commande") {
    return { erreur: `Seules les commandes s'exportent vers Winbiz (document : ${o.type_document}).`, status: 400 };
  }

  const d = o.data;
  const dateDoc = o.date_document || d.date;
  const exercice = exerciceDeDate(dateDoc);
  const avertissements: string[] = [];

  // ── Le fichier clients : exercice couvert + fraîcheur ──
  const { data: fichiers } = await supabaseAdmin
    .from("winbiz_adresses")
    .select("exercice, importe_le")
    .eq("exercice", exercice)
    .order("importe_le", { ascending: false })
    .limit(1);
  const fichier = fichiers?.[0] as { exercice: number; importe_le: string } | undefined;

  let attribution: MatchResultat;
  if (!fichier) {
    attribution = {
      type: "repli",
      matchType: "repli_aucun",
      raison: `aucun fichier clients chargé pour l'exercice ${exercice} — charger un export Winbiz récent sur /dashboard/winbiz-adresses`,
    };
    avertissements.push(
      `Aucun fichier clients Winbiz pour l'exercice ${exercice} : l'export partira sur le client 999. ` +
      `Un fichier d'un autre exercice n'est jamais utilisé (codes par exercice — le pire des modes de panne est un match sur un fichier périmé).`
    );
  } else {
    const ageJours = Math.floor((Date.now() - new Date(fichier.importe_le).getTime()) / 86400000);
    if (ageJours > FRAICHEUR_JOURS) {
      avertissements.push(
        `Le fichier clients de l'exercice ${exercice} date de ${ageJours} jours — recharger un export Winbiz récent avant une séance d'import.`
      );
    }
    // Candidats du même NPA, le matcheur pur décide (jamais de choix silencieux).
    const npa = (d.npa || "").replace(/\s+/g, "").trim();
    const { data: candidats } = await supabaseAdmin
      .from("winbiz_adresses")
      .select("code, societe, nom, prenom, rue, npa, ville")
      .eq("exercice", exercice)
      .eq("npa", npa);
    attribution = matchClient(
      {
        societe: d.societe || "",
        nom: d.nom || "",
        prenom: d.prenom || "",
        rue: [d.rue, d.numero].filter(Boolean).join(" "),
        npa: d.npa || "",
      },
      (candidats ?? []) as AdresseWinbiz[]
    );
  }

  // ── Version vivante de la commande (le « · Vn » des révisions, doc 03 §2) ──
  const { data: revMax } = await supabaseAdmin
    .from("commandes_revisions")
    .select("version_num")
    .eq("commande_slug", slug)
    .order("version_num", { ascending: false })
    .limit(1);
  const commandeVersion = ((revMax?.[0] as { version_num?: number } | undefined)?.version_num ?? 0) + 1;

  // ── Exports passés ──
  const { data: exportsPasses } = await supabaseAdmin
    .from("winbiz_exports")
    .select("version, commande_version, created_at, statut, client_code, filename, run_id, montant, erreur")
    .eq("commande_slug", slug)
    .order("version", { ascending: false });

  // ── Révisée ou corrigée depuis le dernier export ? (arbitrage 29.08 : les DEUX) ──
  let modifieeDepuis: Etat["modifieeDepuis"] = null;
  const dernierExport = exportsPasses?.[0]?.created_at as string | undefined;
  if (dernierExport) {
    const [{ data: revs }, { data: corrs }] = await Promise.all([
      supabaseAdmin
        .from("commandes_revisions")
        .select("created_at")
        .eq("commande_slug", slug)
        .gt("created_at", dernierExport)
        .order("created_at", { ascending: false })
        .limit(1),
      supabaseAdmin
        .from("corrections")
        .select("corrected_at")
        .eq("entity_slug", slug)
        .gt("corrected_at", dernierExport)
        .order("corrected_at", { ascending: false })
        .limit(1),
    ]);
    const rev = (revs?.[0] as { created_at: string } | undefined)?.created_at;
    const corr = (corrs?.[0] as { corrected_at: string } | undefined)?.corrected_at;
    if (rev && (!corr || rev > corr)) modifieeDepuis = { type: "révision", date: rev };
    else if (corr) modifieeDepuis = { type: "correction", date: corr };
  }

  return {
    offre: o,
    exercice,
    commandeVersion,
    attribution,
    exerciceFichier: fichier?.exercice ?? null,
    fichierImporteLe: fichier?.importe_le ?? null,
    avertissements,
    exportsPasses: (exportsPasses ?? []) as Etat["exportsPasses"],
    modifieeDepuis,
  };
}

// ── GET : l'état pour le bouton (dry-run, aucune écriture) ──

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const etat = await chargerEtat(slug);
    if ("erreur" in etat) return NextResponse.json({ error: etat.erreur }, { status: etat.status });

    return NextResponse.json({
      numero_commande: etat.offre.numero_commande,
      exercice: etat.exercice,
      commande_version: etat.commandeVersion,
      attribution: etat.attribution,
      fichier_clients: etat.exerciceFichier
        ? { exercice: etat.exerciceFichier, importe_le: etat.fichierImporteLe }
        : null,
      avertissements: etat.avertissements,
      pro_ht: etat.offre.data.clientType === "Pro (prix HT)",
      exports: etat.exportsPasses,
      modifiee_depuis_export: etat.modifieeDepuis,
      webhook_configure: Boolean(WEBHOOK_URL && WEBHOOK_KEY),
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// ── POST : générer, tracer, déposer ──

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const body = await request.json().catch(() => ({}));
    const creePar = typeof body?.cree_par === "string" ? body.cree_par.slice(0, 100) : "";

    if (!WEBHOOK_URL || !WEBHOOK_KEY) {
      const manquantes = [!WEBHOOK_URL ? "WINBIZ_DRIVE_WEBHOOK_URL" : "", !WEBHOOK_KEY ? "WINBIZ_DRIVE_API_KEY" : ""]
        .filter(Boolean).join(", ");
      return NextResponse.json(
        { error: `Dépôt Drive non configuré (variables manquantes : ${manquantes}). Aucun fichier généré.` },
        { status: 500 }
      );
    }

    const etat = await chargerEtat(slug);
    if ("erreur" in etat) return NextResponse.json({ error: etat.erreur }, { status: etat.status });
    const o = etat.offre;

    // 1. Génération — module pur, invariant bloquant, jamais d'équilibrage.
    const attribution: WinbizAttribution =
      etat.attribution.type === "code"
        ? { type: "code", code: etat.attribution.code, source: etat.attribution.source, libelle: etat.attribution.libelle }
        : { type: "repli", raison: etat.attribution.raison };

    const runId = genererRunId(new Date(), 1000 + Math.floor(Math.random() * 9000));
    const resultat = buildWinbizCsv(
      {
        numeroCommande: o.numero_commande || "",
        dateDocument: o.date_document || o.data.date,
        totalTtcColonne: o.total_ttc == null ? null : Number(o.total_ttc),
        commandeVersion: etat.commandeVersion,
        data: o.data,
      },
      attribution,
      runId
    );

    if (!resultat.ok) {
      return NextResponse.json({ error: resultat.erreur, warnings: resultat.warnings }, { status: 422 });
    }

    const warnings = [...etat.avertissements, ...resultat.warnings];
    const matchType = etat.attribution.type === "code" ? etat.attribution.source : etat.attribution.matchType;
    const matchDetail =
      etat.attribution.type === "code"
        ? etat.attribution.libelle
        : `non attribuée → client 999, à réassigner (${etat.attribution.raison})`;

    // 2. Trace AVANT le dépôt : version = max + 1 ; l'UNIQUE(slug, version)
    //    ferme la course entre deux clics simultanés.
    const version = (etat.exportsPasses[0]?.version ?? 0) + 1;
    const contenuHash = createHash("sha256").update(resultat.contentCp1252).digest("hex");

    const { data: ligne, error: insError } = await supabaseAdmin
      .from("winbiz_exports")
      .insert({
        commande_slug: slug,
        numero_commande: o.numero_commande,
        numero_winbiz: resultat.numeroWinbiz,
        exercice_adresses: etat.exerciceFichier,
        run_id: runId,
        filename: resultat.filename,
        montant: resultat.montant,
        pro_ht: resultat.proHt,
        contenu_hash: contenuHash,
        version,
        commande_version: etat.commandeVersion,
        client_code: resultat.clientCode,
        match_type: matchType,
        match_detail: matchDetail,
        statut: "genere",
        cree_par: creePar || null,
      })
      .select("id")
      .single();

    if (insError || !ligne) {
      const doublon = insError?.message?.includes("winbiz_exports_commande_slug_version_key");
      return NextResponse.json(
        { error: doublon ? "Un export vient d'être créé par ailleurs — recharger la page." : `Trace impossible : ${insError?.message}` },
        { status: doublon ? 409 : 500 }
      );
    }

    // 3. Dépôt Drive via le webhook Make — statut de réponse LU, jamais ignoré.
    const contenuBase64 = Buffer.from(resultat.contentCp1252).toString("base64");
    let statutFinal: "depose" | "erreur" = "depose";
    let erreurDepot: string | null = null;
    try {
      const r = await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-make-apikey": WEBHOOK_KEY },
        body: JSON.stringify({
          filename: resultat.filename,
          contenu_base64: contenuBase64,
          run_id: runId,
          numero_commande: o.numero_commande,
          test: !EST_PROD, // preview → dossier de TEST, jamais le dossier de production
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (!r.ok) {
        statutFinal = "erreur";
        erreurDepot = `Le webhook Make a répondu ${r.status} — vérifier la clé x-make-apikey et le scénario « Dépôt Winbiz ».`;
      }
    } catch (err) {
      statutFinal = "erreur";
      erreurDepot = `Dépôt Drive injoignable : ${err instanceof Error ? err.message : String(err)}`;
    }

    await supabaseAdmin
      .from("winbiz_exports")
      .update({ statut: statutFinal, erreur: erreurDepot })
      .eq("id", ligne.id);

    return NextResponse.json(
      {
        run_id: runId,
        filename: resultat.filename,
        version,
        commande_version: etat.commandeVersion,
        statut: statutFinal,
        erreur: erreurDepot,
        attribution: matchDetail,
        client_code: resultat.clientCode,
        montant: resultat.montant,
        pro_ht: resultat.proHt,
        test: !EST_PROD,
        warnings,
      },
      { status: statutFinal === "depose" ? 200 : 502 }
    );
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
