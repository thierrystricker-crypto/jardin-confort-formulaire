// app/api/brand-logos/upload/route.ts
// POST multipart/form-data
//   - file: File (image)
//   - mode: "library" (= ajoute aussi à la table brand_logos) | "ephemeral" (= upload direct, retourne juste l'URL)
//   - name?: string (requis si mode=library)
//   - search_terms?: string (CSV, optionnel)

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { normalizeSearchTerm } from "@/lib/media-line-types";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const BUCKET = "brand-logos";
const MAX_SIZE = 2 * 1024 * 1024; // 2 MB

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    const mode = (form.get("mode") as string) ?? "ephemeral";
    const name = (form.get("name") as string)?.trim() ?? "";
    const searchTermsCSV = (form.get("search_terms") as string) ?? "";

    if (!file) {
      return NextResponse.json({ error: "Fichier manquant" }, { status: 400 });
    }
    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ error: "Le fichier doit être une image" }, { status: 400 });
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: "Image trop lourde (max 2 MB)" }, { status: 400 });
    }
    if (mode === "library" && !name) {
      return NextResponse.json({ error: "Le nom est requis pour la bibliothèque" }, { status: 400 });
    }

    // Détermine le filename dans le bucket
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "png";
    const baseSlug = mode === "library" ? slugify(name) : `tmp-${Date.now()}`;
    const path =
      mode === "library"
        ? `library/${baseSlug}.${ext}`
        : `ephemeral/${baseSlug}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

    // Upload
    const arrayBuffer = await file.arrayBuffer();
    const { error: uploadErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, arrayBuffer, {
        contentType: file.type,
        upsert: mode === "library", // en library on remplace si même slug
      });

    if (uploadErr) {
      console.error("[brand-logos/upload] upload error:", uploadErr);
      return NextResponse.json({ error: uploadErr.message }, { status: 500 });
    }

    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
    const image_url = pub.publicUrl;

    // Mode library → ajoute aussi à la table brand_logos
    if (mode === "library") {
      const search_terms = searchTermsCSV
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      // Ajoute aussi des variantes auto du nom
      const autoTerms = [
        normalizeSearchTerm(name),
        ...name.split(/[-\s]+/).map((p) => normalizeSearchTerm(p)).filter((s) => s.length >= 3),
      ];
      const allTerms = Array.from(new Set([...search_terms, ...autoTerms]));

      const { data: row, error: dbErr } = await supabase
        .from("brand_logos")
        .upsert(
          {
            name,
            slug: baseSlug,
            search_terms: allTerms,
            image_url,
          },
          { onConflict: "slug" }
        )
        .select()
        .single();

      if (dbErr) {
        console.error("[brand-logos/upload] db error:", dbErr);
        return NextResponse.json({ error: dbErr.message }, { status: 500 });
      }
      return NextResponse.json({ logo: row, image_url });
    }

    // Mode ephemeral → on renvoie juste l'URL
    return NextResponse.json({ image_url });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Erreur inconnue";
    console.error("[brand-logos/upload] catch:", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// DELETE ?id=<uuid> — supprime un logo de la bibliothèque (et son fichier Storage)
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id manquant" }, { status: 400 });

  const { data: logo, error: getErr } = await supabase
    .from("brand_logos")
    .select("*")
    .eq("id", id)
    .single();

  if (getErr || !logo) {
    return NextResponse.json({ error: "Logo introuvable" }, { status: 404 });
  }

  // Extrait le path depuis l'URL publique
  const url = new URL(logo.image_url);
  const marker = `/object/public/${BUCKET}/`;
  const idx = url.pathname.indexOf(marker);
  if (idx >= 0) {
    const path = url.pathname.slice(idx + marker.length);
    await supabase.storage.from(BUCKET).remove([path]);
  }

  const { error: delErr } = await supabase.from("brand_logos").delete().eq("id", id);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}