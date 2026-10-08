// app/v2/_lib/routes.ts
// ─────────────────────────────────────────────────────────────────────────────
// Dashboard 2.0 — correspondance des URLs de la version actuelle (/dashboard/…)
// vers la v2 (/v2/…). Sert à garder le vendeur DANS la v2 quand une page v1,
// montée telle quelle dans la coquille v2, contient un lien vers /dashboard.
//
// Tout ce qui vit sous app/v2 et app/api/v2 est le « plan B » : supprimer ces
// deux dossiers suffit à revenir exactement à l'état d'avant (09.10.2026).
// ─────────────────────────────────────────────────────────────────────────────

/** Pages v1 qui restent en v1, même depuis la v2. */
const RESTENT_EN_V1: RegExp[] = [
  /^\/dashboard\/jardi(\/|$)/, // chat plein écran, ouvert dans son onglet
  /^\/dashboard\/thunderai(\/|$)/, // simple redirection vers Jardi
  /^\/dashboard\/[^/]+\/reviser\/?$/, // formulaire de révision (DraftFormulaire)
];

/**
 * `chemin` = pathname + search + hash, relatif à l'origine.
 * Rend l'équivalent v2, ou `null` si le lien doit rester tel quel.
 */
export function versV2(chemin: string): string | null {
  const m = /^([^?#]*)(.*)$/.exec(chemin);
  if (!m) return null;
  const [, pathname, suite] = m;
  if (pathname !== "/dashboard" && !pathname.startsWith("/dashboard/")) return null;
  if (RESTENT_EN_V1.some((r) => r.test(pathname))) return null;
  const reste = pathname.slice("/dashboard".length);
  return "/v2" + (reste === "/" ? "" : reste) + suite;
}

/** L'inverse : la page v1 équivalente à la page v2 affichée (bouton « version actuelle »). */
export function versV1(chemin: string): string {
  const m = /^([^?#]*)(.*)$/.exec(chemin);
  const pathname = m?.[1] ?? "/v2";
  const suite = m?.[2] ?? "";
  if (pathname !== "/v2" && !pathname.startsWith("/v2/")) return "/dashboard";
  return "/dashboard" + pathname.slice("/v2".length) + suite;
}
