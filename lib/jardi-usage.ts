// lib/jardi-usage.ts
// ─────────────────────────────────────────────────────────────────────────────
// Comptage de l'utilisation de Jardi (27.08.2026).
//
// Le flux SSE de la Messages API porte les compteurs : `message_start` donne
// les tokens d'entrée (et le cache), `message_delta` les tokens de sortie
// (cumulés) et le `stop_reason`, `content_block_start` de type `mcp_tool_use`
// chaque appel d'outil. On les lit AU PASSAGE, dans un TransformStream qui
// relaie les octets tels quels : la réponse au navigateur (ou à ThunderAI)
// n'est ni retardée ni modifiée. À la fermeture du flux, une ligne part dans
// `jardi_usage`. Un échec d'enregistrement ne casse jamais la réponse.
//
// Avec la boucle d'outils MCP côté API, le flux peut porter plusieurs
// `message_start` : on additionne segment par segment.
// ─────────────────────────────────────────────────────────────────────────────

import { supabaseAdmin } from "@/lib/supabase";

export type SourceUsage = "chat" | "thunderai";

type Segment = {
  entree: number;
  sortie: number;
  cacheLecture: number;
  cacheCreation: number;
};

type UsageApi = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
};

type Evenement = {
  type?: string;
  message?: { usage?: UsageApi };
  usage?: UsageApi;
  delta?: { stop_reason?: string };
  content_block?: { type?: string };
};

export type Contexte = {
  source: SourceUsage;
  auteur?: string | null;
  modele: string;
  conversationId?: string | null;
};

export function compteurUsage(ctx: Contexte): TransformStream<Uint8Array, Uint8Array> {
  const debut = Date.now();
  const decodeur = new TextDecoder("utf-8");
  const segments: Segment[] = [];
  let tampon = "";
  let outils = 0;
  let stopReason: string | null = null;

  const courant = (): Segment => {
    if (segments.length === 0) segments.push({ entree: 0, sortie: 0, cacheLecture: 0, cacheCreation: 0 });
    return segments[segments.length - 1];
  };

  const absorber = (s: Segment, u: UsageApi | undefined) => {
    if (!u) return;
    // Les compteurs d'un message sont cumulatifs : on garde le maximum vu.
    if (typeof u.input_tokens === "number") s.entree = Math.max(s.entree, u.input_tokens);
    if (typeof u.output_tokens === "number") s.sortie = Math.max(s.sortie, u.output_tokens);
    if (typeof u.cache_read_input_tokens === "number") {
      s.cacheLecture = Math.max(s.cacheLecture, u.cache_read_input_tokens);
    }
    if (typeof u.cache_creation_input_tokens === "number") {
      s.cacheCreation = Math.max(s.cacheCreation, u.cache_creation_input_tokens);
    }
  };

  const traiterLigne = (ligne: string) => {
    if (!ligne.startsWith("data:")) return;
    const brut = ligne.slice(5).trim();
    if (!brut || brut === "[DONE]") return;
    let e: Evenement;
    try {
      e = JSON.parse(brut) as Evenement;
    } catch {
      return;
    }
    if (e.type === "message_start") {
      segments.push({ entree: 0, sortie: 0, cacheLecture: 0, cacheCreation: 0 });
      absorber(courant(), e.message?.usage);
    } else if (e.type === "message_delta") {
      absorber(courant(), e.usage);
      if (e.delta?.stop_reason) stopReason = e.delta.stop_reason;
    } else if (e.type === "content_block_start" && e.content_block?.type === "mcp_tool_use") {
      outils++;
    }
  };

  const enregistrer = async () => {
    const total = segments.reduce(
      (t, s) => ({
        entree: t.entree + s.entree,
        sortie: t.sortie + s.sortie,
        cacheLecture: t.cacheLecture + s.cacheLecture,
        cacheCreation: t.cacheCreation + s.cacheCreation,
      }),
      { entree: 0, sortie: 0, cacheLecture: 0, cacheCreation: 0 }
    );
    // Rien reçu du tout (erreur avant le premier événement) : rien à compter.
    if (segments.length === 0) return;
    try {
      await supabaseAdmin.from("jardi_usage").insert({
        source: ctx.source,
        auteur: ctx.auteur ?? null,
        modele: ctx.modele,
        conversation_id: ctx.conversationId ?? null,
        tokens_entree: total.entree,
        tokens_sortie: total.sortie,
        tokens_cache_lecture: total.cacheLecture,
        tokens_cache_creation: total.cacheCreation,
        nb_outils: outils,
        duree_ms: Date.now() - debut,
        stop_reason: stopReason,
      });
    } catch (erreur) {
      console.error("jardi_usage : échec d'enregistrement", erreur);
    }
  };

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(morceau, controleur) {
      // Relais immédiat, comptage ensuite.
      controleur.enqueue(morceau);
      tampon += decodeur.decode(morceau, { stream: true });
      const lignes = tampon.split(/\r?\n/);
      tampon = lignes.pop() ?? "";
      for (const l of lignes) traiterLigne(l);
    },
    async flush() {
      if (tampon) traiterLigne(tampon);
      // Attendu AVANT la fermeture du flux : sur Vercel, la fonction peut être
      // gelée dès que la réponse est terminée.
      await enregistrer();
    },
  });
}

// ── Coût estimé ─────────────────────────────────────────────────────────────
// Tarifs en USD par million de tokens, surchargés par variables Vercel :
//   CLAUDE_PRIX_ENTREE, CLAUDE_PRIX_SORTIE (défaut 3 / 15 — classe Sonnet).
// Lecture de cache = 10 % du prix d'entrée, écriture de cache = 125 %.
// C'est une ESTIMATION : la facture qui fait foi est celle de la console
// Anthropic (console.anthropic.com → Usage).
export function tarifs(): { entree: number; sortie: number } {
  const e = Number(process.env.CLAUDE_PRIX_ENTREE);
  const s = Number(process.env.CLAUDE_PRIX_SORTIE);
  return {
    entree: Number.isFinite(e) && e > 0 ? e : 3,
    sortie: Number.isFinite(s) && s > 0 ? s : 15,
  };
}

export function coutUsd(t: {
  entree: number;
  sortie: number;
  cache_lecture: number;
  cache_creation: number;
}): number {
  const p = tarifs();
  return (
    (t.entree * p.entree +
      t.cache_lecture * p.entree * 0.1 +
      t.cache_creation * p.entree * 1.25 +
      t.sortie * p.sortie) /
    1_000_000
  );
}
