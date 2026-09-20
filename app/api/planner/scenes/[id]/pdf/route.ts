// app/api/planner/scenes/[id]/pdf/route.ts  (interne)
// POST {prix: boolean, capture?, dims?} → fige la version (ou la réutilise),
// fait rendre /print/planner/<token>?prix=0|1 par pdf.co (même circuit que
// les offres : jc_token en query pour passer le verrou proxy.ts), stocke le
// PDF dans le bucket « pdfs » (planner/<token>-avec-prix.pdf | -sans-prix.pdf)
// et l'URL sur la version → { pdf_url, numero, token }.
// Un PDF déjà généré pour cette version est renvoyé tel quel (le contenu
// d'une version ne change jamais).

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { BUCKET, figerVersion, urlPublique } from "@/lib/planner-versions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PDFCO_API_KEY = process.env.PDFCO_API_KEY || "";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://offres.jardin-confort.ch";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!PDFCO_API_KEY) return NextResponse.json({ error: "PDFCO_API_KEY non configurée" }, { status: 500 });
  let body: { prix?: boolean; capture?: string | null; dims?: Record<string, { l: number; p: number; h: number }> } = {};
  try { body = await req.json(); } catch { /* corps vide */ }
  const avecPrix = body.prix !== false;

  const v = await figerVersion(id, avecPrix ? "pdf" : "pdf-sans-prix", { capture: body.capture, dims: body.dims });
  if ("error" in v) return NextResponse.json({ error: v.error }, { status: v.status });

  const colonne = avecPrix ? "pdf_url" : "pdf_sans_prix_url";
  const existant = avecPrix ? v.pdf_url : v.pdf_sans_prix_url;
  if (existant) return NextResponse.json({ pdf_url: existant, numero: v.numero, token: v.token, reutilise: true });

  const jcToken = encodeURIComponent(process.env.DASHBOARD_SESSION_SECRET || "");
  const printUrl = `${APP_URL}/print/planner/${v.token}?prix=${avecPrix ? 1 : 0}&jc_token=${jcToken}`;
  const nomFichier = `planner-${v.token}-${avecPrix ? "avec-prix" : "sans-prix"}.pdf`;

  const pdfcoRes = await fetch("https://api.pdf.co/v1/pdf/convert/from/url", {
    method: "POST",
    headers: { "x-api-key": PDFCO_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      url: printUrl,
      name: nomFichier,
      async: false,
      printBackground: true,
      mediaType: "print",
      paperSize: "A4",
      orientation: "Portrait",
      margins: "10mm 10mm 10mm 10mm",
    }),
  });
  const pdfco = await pdfcoRes.json();
  if (pdfco.error || !pdfco.url) {
    console.error("[planner pdf] pdf.co:", pdfco);
    return NextResponse.json({ error: "Erreur génération PDF", details: pdfco.message || pdfco.error }, { status: 500 });
  }
  const pdfRes = await fetch(pdfco.url);
  if (!pdfRes.ok) return NextResponse.json({ error: "Impossible de télécharger le PDF" }, { status: 500 });
  const buf = await pdfRes.arrayBuffer();

  const chemin = `planner/${v.token}-${avecPrix ? "avec-prix" : "sans-prix"}.pdf`;
  const { error: up } = await supabaseAdmin.storage.from(BUCKET).upload(chemin, buf, { contentType: "application/pdf", upsert: true });
  if (up) return NextResponse.json({ error: `Stockage PDF : ${up.message}` }, { status: 500 });
  const pdfUrl = urlPublique(chemin);
  await supabaseAdmin.from("planner_scenes_versions").update({ [colonne]: pdfUrl }).eq("id", v.id);

  return NextResponse.json({ pdf_url: pdfUrl, numero: v.numero, token: v.token, reutilise: false });
}
