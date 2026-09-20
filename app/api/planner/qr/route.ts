// app/api/planner/qr/route.ts  (interne)
// GET ?data=<url>&size=<px> → PNG du QR code, servi en same-origin pour
// pouvoir être dessiné dans le canvas de capture sans « tainter » celui-ci.
// Générateur : api.qrserver.com, le même que /print/offre. Sans dépendance.

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  const data = (sp.get("data") || "").slice(0, 500);
  const size = Math.max(60, Math.min(600, Number(sp.get("size")) || 160));
  if (!data) return NextResponse.json({ error: "data manquant" }, { status: 400 });
  const r = await fetch(`https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=0&data=${encodeURIComponent(data)}`);
  if (!r.ok) return NextResponse.json({ error: `Générateur QR : ${r.status}` }, { status: 502 });
  const png = await r.arrayBuffer();
  return new NextResponse(png, { headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=3600" } });
}
