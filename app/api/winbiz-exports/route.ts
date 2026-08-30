// app/api/winbiz-exports/route.ts
// Page comptabilité (/dashboard/comptabilite) : liste des exports Winbiz,
// toutes commandes confondues, avec recherche.
//
// GET ?q=texte&limit=200
//   La recherche porte sur : n° de commande, nom de fichier, code client
//   Winbiz (winbiz_exports) ET nom / prénom / société du client (offres.data).
//   Lecture seule. Le contenu archivé n'est jamais rapatrié ici (10 Ko par
//   ligne) : seule contenu_taille (colonne générée, migration 012) dit si le
//   téléchargement est possible.
//
// Route INTERNE : protégée par le verrou proxy.ts (tout /api/* non listé
// public l'est par défaut).

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

const LIMITE_DEFAUT = 200;
const LIMITE_MAX = 500;

const COLONNES =
  "id, created_at, commande_slug, numero_commande, numero_winbiz, version, commande_version, " +
  "statut, erreur, client_code, match_type, match_detail, filename, run_id, montant, pro_ht, " +
  "exercice_adresses, cree_par, contenu_taille";

type ExportRow = {
  id: number;
  created_at: string;
  commande_slug: string;
  numero_commande: string;
  numero_winbiz: string;
  version: number;
  commande_version: number | null;
  statut: string;
  erreur: string | null;
  client_code: string | null;
  match_type: string;
  match_detail: string | null;
  filename: string;
  run_id: string;
  montant: number | string;
  pro_ht: boolean;
  exercice_adresses: number | null;
  cree_par: string | null;
  contenu_taille: number | null;
};

type ClientMin = { slug: string; nom: string | null; prenom: string | null; societe: string | null };

/** PostgREST : dans un filtre .or(), virgules, parenthèses et % cassent la syntaxe. */
function motifSur(q: string): string {
  const propre = q.replace(/[,()%\\]/g, " ").replace(/\s+/g, " ").trim();
  return `%${propre}%`;
}

export async function GET(request: NextRequest) {
  try {
    const q = (request.nextUrl.searchParams.get("q") || "").trim().slice(0, 80);
    const limiteDemandee = Number(request.nextUrl.searchParams.get("limit") || LIMITE_DEFAUT);
    const limite = Math.min(Math.max(1, Number.isFinite(limiteDemandee) ? limiteDemandee : LIMITE_DEFAUT), LIMITE_MAX);

    let lignes: ExportRow[] = [];

    if (!q) {
      const { data, error } = await supabaseAdmin
        .from("winbiz_exports")
        .select(COLONNES)
        .order("created_at", { ascending: false })
        .limit(limite);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      lignes = (data ?? []) as unknown as ExportRow[];
    } else {
      const motif = motifSur(q);

      // 1. Sur les champs propres à l'export.
      const { data: directs, error: e1 } = await supabaseAdmin
        .from("winbiz_exports")
        .select(COLONNES)
        .or(`numero_commande.ilike.${motif},filename.ilike.${motif},client_code.ilike.${motif}`)
        .order("created_at", { ascending: false })
        .limit(limite);
      if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });

      // 2. Sur le client de la commande (offres.data) → slugs → exports.
      const { data: offresMatch, error: e2 } = await supabaseAdmin
        .from("offres")
        .select("slug")
        .eq("type_document", "Commande")
        .or(`data->>nom.ilike.${motif},data->>prenom.ilike.${motif},data->>societe.ilike.${motif}`)
        .limit(limite);
      if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });

      const slugs = (offresMatch ?? []).map((r) => (r as { slug: string }).slug);
      let parClient: ExportRow[] = [];
      if (slugs.length > 0) {
        const { data, error: e3 } = await supabaseAdmin
          .from("winbiz_exports")
          .select(COLONNES)
          .in("commande_slug", slugs)
          .order("created_at", { ascending: false })
          .limit(limite);
        if (e3) return NextResponse.json({ error: e3.message }, { status: 500 });
        parClient = (data ?? []) as unknown as ExportRow[];
      }

      const vus = new Set<number>();
      lignes = [...((directs ?? []) as unknown as ExportRow[]), ...parClient]
        .filter((l) => (vus.has(l.id) ? false : (vus.add(l.id), true)))
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
        .slice(0, limite);
    }

    // Nom du client pour l'affichage (lecture seule sur offres.data).
    const slugsUniques = Array.from(new Set(lignes.map((l) => l.commande_slug)));
    const clients = new Map<string, ClientMin>();
    for (let i = 0; i < slugsUniques.length; i += 200) {
      const lot = slugsUniques.slice(i, i + 200);
      const { data } = await supabaseAdmin
        .from("offres")
        .select("slug, nom:data->>nom, prenom:data->>prenom, societe:data->>societe")
        .in("slug", lot);
      for (const c of (data ?? []) as unknown as ClientMin[]) clients.set(c.slug, c);
    }

    const exports = lignes.map((l) => {
      const c = clients.get(l.commande_slug);
      const personne = [c?.prenom, c?.nom].filter(Boolean).join(" ");
      const client = [c?.societe, personne].filter(Boolean).join(" — ") || "";
      return {
        id: l.id,
        created_at: l.created_at,
        commande_slug: l.commande_slug,
        numero_commande: l.numero_commande,
        numero_winbiz: l.numero_winbiz,
        version: l.version,
        commande_version: l.commande_version,
        statut: l.statut,
        erreur: l.erreur,
        client_code: l.client_code,
        match_type: l.match_type,
        match_detail: l.match_detail,
        filename: l.filename,
        run_id: l.run_id,
        montant: Number(l.montant),
        pro_ht: l.pro_ht,
        exercice_adresses: l.exercice_adresses,
        cree_par: l.cree_par,
        client,
        fichier_archive: (l.contenu_taille ?? 0) > 0,
      };
    });

    return NextResponse.json({ q, total: exports.length, limite, exports });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
