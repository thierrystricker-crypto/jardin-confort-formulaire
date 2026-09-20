// app/api/planner/logo/route.ts  (interne)
// Sert le logo Jardin-Confort en same-origin pour pouvoir le dessiner dans le
// canvas de la capture PNG (l'image du CDN Shopify « tainterait » le canvas).

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const LOGO = "https://cdn.shopify.com/s/files/1/0360/3251/2135/files/logo_JARDIN_CONFORT_shopify.jpg?v=1614107698";

export async function GET() {
  const r = await fetch(LOGO, { next: { revalidate: 86400 } });
  if (!r.ok) return NextResponse.json({ error: `Logo : ${r.status}` }, { status: 502 });
  const img = await r.arrayBuffer();
  return new NextResponse(img, { headers: { "Content-Type": r.headers.get("content-type") || "image/jpeg", "Cache-Control": "private, max-age=86400" } });
}
