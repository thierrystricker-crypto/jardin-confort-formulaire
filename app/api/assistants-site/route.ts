// app/api/assistants-site/route.ts
// GET /api/assistants-site?source=chat|filtre[&jours=7][&q=texte][&repli=1]
//
// Page « Assistants du site » (/v2/assistants-site) : consultation des journaux
// anonymes des deux assistants de la vitrine jardin-confort.ch, stockés dans le
// Supabase WEBSHOP (client dédié, clé WEBSHOP_JOURNAUX_SECRET_KEY) :
//   • jardi-chat-public → table jardi_chat_public_echanges (1 ligne par question,
//     + lignes « événement » sans question : panier_ajoute / _refuse / _retire)
//   • jardi-filtre      → table jardi_filtre_recherches (1 ligne par recherche)
//
// LECTURE SEULE : aucun insert / update / delete. Route interne (cookie du
// verrou, proxy.ts) — jamais ajoutée à estRoutePublique.
//
// Renvoie : { source, depuis, lignes, tronque, stats }

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Client DÉDIÉ à cette page (20.11.2026) : les deux tables de journal ont la
// RLS active sans règle d'accès → seule une clé SECRÈTE les lit. On ne touche
// pas à WEBSHOP_SUPABASE_SERVICE_KEY (lib/supabase-webshop.ts, Stock list…) :
// cette page a sa propre variable, révocable seule.
//   WEBSHOP_SUPABASE_URL          (déjà présente)
//   WEBSHOP_JOURNAUX_SECRET_KEY   = clé sb_secret_ du projet webshop
const URL_WEBSHOP = process.env.WEBSHOP_SUPABASE_URL || "";
const CLE_JOURNAUX = process.env.WEBSHOP_JOURNAUX_SECRET_KEY || "";
const webshopConfigure = Boolean(URL_WEBSHOP && CLE_JOURNAUX);
const supabaseWebshop = createClient(
  URL_WEBSHOP || "https://webshop-non-configure.invalid",
  CLE_JOURNAUX || "non-configure",
  { auth: { persistSession: false, autoRefreshToken: false } },
);

export const dynamic = "force-dynamic";

const LIMITE = 1000;

const COLONNES_CHAT =
  "id, cree_le, conversation, langue, page, tour, question, reponse, outils, repli, liens_retires, concurrents, duree_ms, tokens_in, tokens_out, tokens_cache, modele";
const COLONNES_FILTRE =
  "id, cree_le, langue, contexte_type, contexte, texte, params, tri, note, affinage, conseiller, rejets, duree_ms, tokens_in, tokens_out, modele";

type Outil = { outil?: string; entree?: Record<string, unknown>; erreur?: boolean };

function motifIlike(q: string): string {
  // Virgules / parenthèses = séparateurs de .or() PostgREST ; % et _ = jokers.
  return q.replace(/[,()%_]/g, " ").trim().replace(/\s+/g, "%");
}

export async function GET(request: NextRequest) {
  try {
    if (!webshopConfigure) {
      return NextResponse.json(
        { error: "Clé des journaux non configurée (WEBSHOP_SUPABASE_URL / WEBSHOP_JOURNAUX_SECRET_KEY)" },
        { status: 500 },
      );
    }

    if (CLE_JOURNAUX.startsWith("sb_publishable_")) {
      return NextResponse.json(
        { error: "WEBSHOP_JOURNAUX_SECRET_KEY est une clé publique (sb_publishable_) : il faut une clé secrète sb_secret_, sinon les journaux paraissent vides." },
        { status: 500 },
      );
    }

    const sp = request.nextUrl.searchParams;
    const source = sp.get("source") === "filtre" ? "filtre" : "chat";
    const jours = Math.min(365, Math.max(1, Number(sp.get("jours")) || 7));
    const q = motifIlike((sp.get("q") || "").slice(0, 100));
    const seulementRepli = sp.get("repli") === "1";
    const depuis = new Date(Date.now() - jours * 86400000).toISOString();

    if (source === "filtre") {
      let req = supabaseWebshop
        .from("jardi_filtre_recherches")
        .select(COLONNES_FILTRE)
        .gte("cree_le", depuis)
        .order("cree_le", { ascending: false })
        .limit(LIMITE + 1);
      if (q) req = req.or(`texte.ilike.%${q}%,contexte.ilike.%${q}%,note.ilike.%${q}%`);
      const { data, error } = await req;
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });

      const lignes = (data || []).slice(0, LIMITE);
      const sansFiltre = lignes.filter((l) => !Array.isArray(l.params) || l.params.length === 0).length;
      const stats = {
        recherches: lignes.length,
        conseiller: lignes.filter((l) => l.conseiller).length,
        sansFiltre,
        avecRejets: lignes.filter((l) => Array.isArray(l.rejets) && l.rejets.length > 0).length,
        tokensIn: lignes.reduce((s, l) => s + (Number(l.tokens_in) || 0), 0),
        tokensOut: lignes.reduce((s, l) => s + (Number(l.tokens_out) || 0), 0),
      };
      return NextResponse.json({ source, depuis, lignes, tronque: (data || []).length > LIMITE, stats });
    }

    // ── jardi-chat-public ──
    // La recherche texte trouve les conversations concernées, puis on relit
    // TOUTES leurs lignes (questions + événements panier) pour les afficher en entier.
    let conversations: string[] | null = null;
    if (q || seulementRepli) {
      let rq = supabaseWebshop
        .from("jardi_chat_public_echanges")
        .select("conversation")
        .gte("cree_le", depuis)
        .limit(LIMITE);
      if (q) rq = rq.or(`question.ilike.%${q}%,reponse.ilike.%${q}%,page.ilike.%${q}%`);
      if (seulementRepli) rq = rq.eq("repli", true);
      const { data, error } = await rq;
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      conversations = Array.from(new Set((data || []).map((r) => String(r.conversation)).filter(Boolean))).slice(0, 200);
      if (conversations.length === 0) {
        return NextResponse.json({ source, depuis, lignes: [], tronque: false, stats: statsChat([]) });
      }
    }

    let req = supabaseWebshop
      .from("jardi_chat_public_echanges")
      .select(COLONNES_CHAT)
      .gte("cree_le", depuis)
      .order("cree_le", { ascending: false })
      .limit(LIMITE + 1);
    if (conversations) req = req.in("conversation", conversations);
    const { data, error } = await req;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const lignes = (data || []).slice(0, LIMITE);
    return NextResponse.json({
      source,
      depuis,
      lignes,
      tronque: (data || []).length > LIMITE,
      stats: statsChat(lignes),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || "Erreur" }, { status: 500 });
  }
}

type LigneChat = {
  conversation?: string | null;
  question?: string | null;
  repli?: boolean | null;
  outils?: Outil[] | null;
  tokens_in?: number | null;
  tokens_out?: number | null;
  tokens_cache?: number | null;
};

function statsChat(lignes: LigneChat[]) {
  const questions = lignes.filter((l) => (l.question || "").trim() !== "");
  const evenements = (nom: string) =>
    lignes.filter((l) => Array.isArray(l.outils) && l.outils.some((o) => o?.outil === nom)).length;
  return {
    questions: questions.length,
    conversations: new Set(questions.map((l) => l.conversation).filter(Boolean)).size,
    replis: questions.filter((l) => l.repli).length,
    propositions: evenements("panier_proposer"),
    ajouts: evenements("panier_ajoute"),
    retraits: evenements("panier_retire"),
    tokensIn: questions.reduce((s, l) => s + (Number(l.tokens_in) || 0), 0),
    tokensOut: questions.reduce((s, l) => s + (Number(l.tokens_out) || 0), 0),
    tokensCache: questions.reduce((s, l) => s + (Number(l.tokens_cache) || 0), 0),
  };
}
