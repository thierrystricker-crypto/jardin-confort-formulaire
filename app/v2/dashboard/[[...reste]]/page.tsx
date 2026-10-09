// app/v2/dashboard/[[...reste]]/page.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Dashboard 2.0 — filet de sécurité (10.10.2026) : quelqu'un qui remplace
// « offres.jardin-confort.ch/dashboard » par « …/v2/dashboard » dans un favori
// tombait sur la fiche document « dashboard » (introuvable). On renvoie vers
// l'équivalent v2 : /v2/dashboard → /v2, /v2/dashboard/clients → /v2/clients…
// (les paramètres de l'adresse sont conservés : ?c=, ?q=, ?source=…).
// ─────────────────────────────────────────────────────────────────────────────

import { redirect } from "next/navigation";

export default async function RedirectionDashboard({
  params,
  searchParams,
}: {
  params: Promise<{ reste?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { reste } = await params;
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (Array.isArray(v)) v.forEach((x) => qs.append(k, x));
    else if (v != null) qs.set(k, v);
  }
  const chemin = "/v2" + (reste?.length ? "/" + reste.map(encodeURIComponent).join("/") : "");
  const suite = qs.toString();
  redirect(chemin + (suite ? "?" + suite : ""));
}
