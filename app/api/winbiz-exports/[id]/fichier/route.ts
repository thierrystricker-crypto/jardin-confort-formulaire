// app/api/winbiz-exports/[id]/fichier/route.ts
// Téléchargement du fichier bizexdoc ARCHIVÉ d'un export (migration 012).
//
// On renvoie les octets déposés ce jour-là — jamais une régénération : si la
// commande a été révisée depuis, une régénération produirait un fichier
// différent de celui importé dans Winbiz, sans que rien ne le signale.
// Le sha256 est recontrôlé contre contenu_hash avant l'envoi.
//
// Lecture seule. Route INTERNE : protégée par le verrou proxy.ts.

import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!/^\d+$/.test(id)) return NextResponse.json({ error: "Identifiant invalide" }, { status: 400 });

    const { data, error } = await supabaseAdmin
      .from("winbiz_exports")
      .select("id, filename, contenu_hash, contenu_base64, created_at")
      .eq("id", Number(id))
      .single();

    if (error || !data) return NextResponse.json({ error: "Export introuvable" }, { status: 404 });
    const ligne = data as { id: number; filename: string; contenu_hash: string; contenu_base64: string | null; created_at: string };

    if (!ligne.contenu_base64) {
      return NextResponse.json(
        { error: "Cet export est antérieur à l'archivage des fichiers (migration 012) : le fichier n'est disponible que sur le Drive, ou via un ré-export." },
        { status: 404 }
      );
    }

    const octets = Buffer.from(ligne.contenu_base64, "base64");
    const hash = createHash("sha256").update(octets).digest("hex");
    if (hash !== ligne.contenu_hash) {
      return NextResponse.json(
        { error: "Archive corrompue : l'empreinte du fichier ne correspond plus à celle enregistrée à l'export." },
        { status: 500 }
      );
    }

    const nom = ligne.filename.replace(/[^\w.\-]/g, "_");
    return new NextResponse(new Uint8Array(octets), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=windows-1252",
        "Content-Disposition": `attachment; filename="${nom}"`,
        "Content-Length": String(octets.length),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
