// app/api/claude/conversations/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// Historique du chat Claude du dashboard (14.08.2026).
// Table Supabase `claude_conversations` — RLS sans policy : seul ce serveur
// (service key) peut lire/écrire. Route protégée par proxy.ts + revérification
// du cookie de session (défense en profondeur).
//
// GET    /api/claude/conversations        → liste (sans les messages)
// GET    /api/claude/conversations?id=…   → une conversation complète
// POST   /api/claude/conversations        → { id?, messages, auteur? } (upsert)
// DELETE /api/claude/conversations?id=…   → suppression
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

type MessageStocke = {
  role: "user" | "assistant";
  content: string;
  outils?: string[];
};

function sessionValide(req: NextRequest): boolean {
  const secret = process.env.DASHBOARD_SESSION_SECRET;
  const cookie = req.cookies.get("jc_acces")?.value;
  return Boolean(secret && cookie === secret);
}

function estMessageValide(m: unknown): m is MessageStocke {
  if (typeof m !== "object" || m === null) return false;
  const o = m as Record<string, unknown>;
  if (o.role !== "user" && o.role !== "assistant") return false;
  if (typeof o.content !== "string") return false;
  if (
    o.outils !== undefined &&
    (!Array.isArray(o.outils) || !o.outils.every((x) => typeof x === "string"))
  ) {
    return false;
  }
  return true;
}

export async function GET(req: NextRequest) {
  if (!sessionValide(req)) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 401 });
  }

  const id = req.nextUrl.searchParams.get("id");
  if (id) {
    const { data, error } = await supabaseAdmin
      .from("claude_conversations")
      .select("id, titre, auteur, messages, updated_at")
      .eq("id", id)
      .single();
    if (error || !data) {
      return NextResponse.json({ error: "Conversation introuvable" }, { status: 404 });
    }
    return NextResponse.json({ conversation: data });
  }

  const { data, error } = await supabaseAdmin
    .from("claude_conversations")
    .select("id, titre, auteur, updated_at")
    .order("updated_at", { ascending: false })
    .limit(100);
  if (error) {
    console.error("claude_conversations GET :", error);
    return NextResponse.json({ error: "Erreur base de données" }, { status: 500 });
  }
  return NextResponse.json({ conversations: data ?? [] });
}

export async function POST(req: NextRequest) {
  if (!sessionValide(req)) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 401 });
  }

  let corps: unknown;
  try {
    corps = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }
  const { id, messages, auteur } = corps as {
    id?: unknown;
    messages?: unknown;
    auteur?: unknown;
  };

  if (!Array.isArray(messages) || messages.length === 0 || !messages.every(estMessageValide)) {
    return NextResponse.json({ error: "Format attendu : { messages: [...] }" }, { status: 400 });
  }
  if (JSON.stringify(messages).length > 400_000) {
    return NextResponse.json({ error: "Conversation trop longue pour être sauvegardée" }, { status: 413 });
  }

  const aut =
    typeof auteur === "string" && auteur.trim() ? auteur.trim().slice(0, 60) : null;

  // Mise à jour d'une conversation existante
  if (typeof id === "string" && id) {
    const { data, error } = await supabaseAdmin
      .from("claude_conversations")
      .update({
        messages,
        updated_at: new Date().toISOString(),
        ...(aut ? { auteur: aut } : {}),
      })
      .eq("id", id)
      .select("id")
      .single();
    if (error || !data) {
      return NextResponse.json({ error: "Conversation introuvable" }, { status: 404 });
    }
    return NextResponse.json({ id: data.id });
  }

  // Nouvelle conversation — titre dérivé du premier message utilisateur
  const premier = (messages as MessageStocke[]).find((m) => m.role === "user");
  const titre =
    (premier?.content ?? "").replace(/\s+/g, " ").trim().slice(0, 60) ||
    "Nouvelle conversation";

  const { data, error } = await supabaseAdmin
    .from("claude_conversations")
    .insert({ titre, auteur: aut, messages })
    .select("id")
    .single();
  if (error || !data) {
    console.error("claude_conversations POST :", error);
    return NextResponse.json({ error: "Erreur base de données" }, { status: 500 });
  }
  return NextResponse.json({ id: data.id });
}

export async function DELETE(req: NextRequest) {
  if (!sessionValide(req)) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 401 });
  }
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Paramètre id manquant" }, { status: 400 });
  }
  const { error } = await supabaseAdmin
    .from("claude_conversations")
    .delete()
    .eq("id", id);
  if (error) {
    console.error("claude_conversations DELETE :", error);
    return NextResponse.json({ error: "Erreur base de données" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
