// proxy.ts
// ─────────────────────────────────────────────────────────────────────────────
// Verrou d'accès provisoire (couche 1).
//
// Protège les routes INTERNES (dashboard, création, API de gestion) derrière un
// code partagé, tout en laissant OUVERTES les pages et API destinées aux clients.
//
// ⚠️ Invariant : aucune route publique n'est modifiée. Les anciens liens clients
// (avec leurs anciens slugs) continuent de fonctionner exactement comme avant.
//
// Note Next.js 16 : « Middleware » s'appelle désormais « Proxy » (proxy.ts à la
// racine, fonction exportée `proxy`, runtime Node.js par défaut). Cf.
// node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md
//
// Ce verrou est une vérification « optimiste » de présence de cookie (pattern
// recommandé pour le proxy). L'authentification par vendeur (Supabase) viendra
// en couche 4 et remplacera ce code partagé.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const COOKIE_SESSION = "jc_acces";

// Routes accessibles SANS code : pages consultées par les clients + les seules
// API dont ces pages ont besoin (vérifié route par route, méthode par méthode).
function estRoutePublique(pathname: string, method: string): boolean {
  // Page d'accueil (template Next.js, aucune donnée) + page de saisie du code
  if (pathname === "/" || pathname === "/acces") return true;

  // Pages clients : /offre/[slug], /offre/[slug]/valider, /offre/[slug]/confirmation
  if (pathname.startsWith("/offre/")) return true;
  // Impression client — UNIQUEMENT l'offre (les autres prints sont internes)
  if (pathname.startsWith("/print/offre/")) return true;

  // API de connexion au verrou
  if (pathname === "/api/acces") return true;

  // API lues par les pages clients (lecture seule)
  if (pathname === "/api/revisions" && method === "GET") return true;
  if (pathname === "/api/corrections" && method === "GET") return true;

  // Heartbeat Make : Make poste ici en fin de scénario pour signaler qu'il
  // tourne (service externe, pas de cookie possible). Bloqué par erreur depuis
  // le déploiement du verrou (30.07) → bandeau « Make n'a pas ping depuis 9 j ».
  // Le GET reste interne (consommé par le dashboard, qui a le cookie).
  if (pathname === "/api/make-health" && method === "POST") return true;

  // /api/offres/[slug] :
  //   • GET (racine)   → lecture de l'offre par le client         → PUBLIC
  //   • /valider       → validation de l'offre par le client      → PUBLIC
  //   • /qr            → QR de paiement affiché au client          → PUBLIC
  //   • tout le reste (PATCH racine, /pdf, /statut, /notes,
  //     /reviser, /relance, /fiche-travail-pdf, /probabilite)      → INTERNE
  const m = pathname.match(/^\/api\/offres\/([^/]+)(\/[^/]*)?$/);
  if (m) {
    const sousChemin = m[2] || "";
    if (sousChemin === "" && method === "GET") return true;
    if (sousChemin === "/valider") return true;
    if (sousChemin === "/qr") return true;
    return false;
  }

  return false;
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const method = req.method;

  if (estRoutePublique(pathname, method)) {
    return NextResponse.next();
  }

  const token = req.cookies.get(COOKIE_SESSION)?.value;
  const secret = process.env.DASHBOARD_SESSION_SECRET;

  if (secret && token && token === secret) {
    return NextResponse.next();
  }

  // ── Appels internes serveur→serveur (fix du 07.08.2026) ──
  // Les routes valider/save/transformer/corrections s'appellent elles-mêmes en
  // HTTP (génération PDF, fiche de travail, sortie de stock Shopify). Ces
  // requêtes ne portent pas le cookie navigateur → depuis le déploiement du
  // verrou (30.07), elles étaient rejetées en 401 : plus aucune décrémentation
  // Shopify ni fiche de travail initiale. Elles s'identifient désormais via un
  // en-tête secret (même valeur que le secret de session, env Vercel).
  const enTeteInterne = req.headers.get("x-jc-interne");
  if (secret && enTeteInterne && enTeteInterne === secret) {
    return NextResponse.next();
  }

  // pdf.co doit pouvoir rendre les pages /print internes (fiche de travail)
  // pour générer les PDFs. Jeton passé en query par fiche-travail-pdf/route.ts.
  if (secret && pathname.startsWith("/print/")) {
    const jcToken = req.nextUrl.searchParams.get("jc_token");
    if (jcToken && jcToken === secret) {
      return NextResponse.next();
    }
  }

  // Non authentifié → API : 401 JSON ; page : redirection vers /acces
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 401 });
  }

  const url = req.nextUrl.clone();
  url.pathname = "/acces";
  url.search = "";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  // Exécuté partout SAUF sur les fichiers statiques.
  // (Le proxy reste appelé sur /api/* — voulu.)
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|woff|woff2|ttf|otf)).*)",
  ],
};
