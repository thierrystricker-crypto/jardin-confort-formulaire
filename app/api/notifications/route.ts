// app/api/notifications/route.ts
// GET    : liste les notifications (avec filtres)
// PATCH  : marquer une ou plusieurs notifications comme vues

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

// ─── GET /api/notifications?status=unread&limit=50 ───
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const status = url.searchParams.get("status") || "all";  // 'all' | 'unread' | 'read'
    const limit = Math.min(Number(url.searchParams.get("limit") || 100), 500);
    const since = url.searchParams.get("since"); // ISO date pour ne lire que les + récentes

    let query = supabaseAdmin
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (status === "unread") query = query.eq("vue", false);
    else if (status === "read") query = query.eq("vue", true);

    if (since) query = query.gt("created_at", since);

    const { data, error } = await query;

    if (error) {
      console.error("Notifications GET error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Compteur global non lues (pour le badge sidebar)
    const { count: unreadCount } = await supabaseAdmin
      .from("notifications")
      .select("*", { count: "exact", head: true })
      .eq("vue", false);

    return NextResponse.json({
      notifications: data || [],
      unread_count: unreadCount || 0,
    });

  } catch (err) {
    console.error("Notifications GET error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// ─── PATCH /api/notifications ───
// Body : { ids: number[], vue: boolean, vue_par?: string }
//   - Marquer comme vue : { ids: [123], vue: true, vue_par: "Brice Chappé" }
//   - Marquer toutes comme vues : { all: true, vue: true, vue_par: "..." }
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { ids, vue, vue_par, all } = body;

    const updateData: Record<string, unknown> = {
      vue: vue ?? true,
      vue_at: vue === false ? null : new Date().toISOString(),
      vue_par: vue === false ? null : (vue_par || null),
    };

    let query = supabaseAdmin.from("notifications").update(updateData);

    if (all === true) {
      // Marquer toutes les non-lues comme lues
      query = query.eq("vue", false);
    } else if (Array.isArray(ids) && ids.length > 0) {
      query = query.in("id", ids);
    } else {
      return NextResponse.json({ error: "ids ou all=true requis" }, { status: 400 });
    }

    const { error, count } = await query.select("id", { count: "exact" });

    if (error) {
      console.error("Notifications PATCH error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, updated: count || 0 });

  } catch (err) {
    console.error("Notifications PATCH error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}