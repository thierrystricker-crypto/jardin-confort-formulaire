// app/api/dashboard/offres/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from("offres_dashboard")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Dashboard offres error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data || []);
  } catch (err) {
    console.error("Dashboard error:", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}