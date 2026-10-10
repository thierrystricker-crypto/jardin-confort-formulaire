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
import { versV2 } from "./app/v2/_lib/routes";

const COOKIE_SESSION = "jc_acces";

// ── Dashboard 2.0 (10.10.2026) : rester dans la version choisie ──
// La v2 pose le cookie `jc_ui=v2` à chaque visite ; le bouton « Version
// actuelle » le repasse à `v1`. Avec `v2`, toute page /dashboard/… demandée
// (bouton « Dashboard » du formulaire d'offre, liens des mails Make, de Jardi,
// favoris…) est redirigée vers son équivalent /v2/… — même table de
// correspondance que la coquille v2 (app/v2/_lib/routes.ts, qui garde en v1
// la page de révision). Sans cookie : rien ne change, la v1 reste la v1.
// Pages uniquement (GET) ; les API ne sont jamais concernées.
const COOKIE_UI = "jc_ui";

function redirectionV2(req: NextRequest): NextResponse | null {
  if (req.method !== "GET") return null;
  if (req.cookies.get(COOKIE_UI)?.value !== "v2") return null;
  const { pathname } = req.nextUrl;
  if (pathname !== "/dashboard" && !pathname.startsWith("/dashboard/")) return null;
  const params = new URLSearchParams(req.nextUrl.search);
  params.delete("_rsc"); // paramètre technique des navigations Next
  const suite = params.toString();
  const cible = versV2(pathname + (suite ? "?" + suite : ""));
  if (!cible) return null;
  return NextResponse.redirect(new URL(cible, req.url));
}

// Routes accessibles SANS code : pages consultées par les clients + les seules
// API dont ces pages ont besoin (vérifié route par route, méthode par méthode).
function estRoutePublique(pathname: string, method: string): boolean {
  // Page d'accueil (template Next.js, aucune donnée) + page de saisie du code
  if (pathname === "/" || pathname === "/acces") return true;

  // Pages clients : /offre/[slug], /offre/[slug]/valider, /offre/[slug]/confirmation
  if (pathname.startsWith("/offre/")) return true;
  // Impression client — UNIQUEMENT l'offre (les autres prints sont internes)
  if (pathname.startsWith("/print/offre/")) return true;

  // Planner 3D — partage client en lecture seule (20.09.2026) : la page et
  // sa seule API, GET, identifiée par un jeton aléatoire révocable. Les
  // modèles GLB sont sur le CDN Shopify, déjà publics.
  if (pathname.startsWith("/planner/partage/")) return true;
  if (pathname.startsWith("/api/planner/partage/") && method === "GET") return true;
  // Fiche imprimable d'une version figée (jeton aléatoire, lecture seule) :
  // publique comme /print/offre/, pour l'envoyer au client ou la rendre par pdf.co.
  if (pathname.startsWith("/print/planner/")) return true;

  // API de connexion au verrou
  if (pathname === "/api/acces") return true;

  // Tâches planifiées Vercel (/api/cron/*) : appelées par l'infrastructure
  // Vercel, sans navigateur donc sans cookie. Elles ne sont PAS ouvertes pour
  // autant — chacune vérifie elle-même l'en-tête `Authorization: Bearer
  // $CRON_SECRET` que Vercel joint automatiquement, et refuse tout le reste.
  if (pathname.startsWith("/api/cron/")) return true;

  // Façade ThunderAI (19.08.2026) : appelée par l'extension ThunderAI depuis
  // les postes, sans navigateur donc sans cookie. Pas ouverte pour autant —
  // chaque route sous /api/thunderai/ vérifie elle-même l'en-tête
  // `Authorization: Bearer $THUNDERAI_SECRET` (secret dédié aux postes,
  // révocable indépendamment) et refuse tout le reste.
  if (pathname.startsWith("/api/thunderai/")) return true;

  // Panier borne (01.10.2026) : la borne du magasin n'a pas le cookie. Pas
  // ouverte pour autant — la route refuse toute IP hors BORNE_IPS (env Vercel,
  // fermée si absente), plafonne à 20/h, et n'écrit qu'une liste d'achat.
  if (pathname === "/api/listes-achat/borne" && (method === "POST" || method === "OPTIONS")) return true;

  // API lues par les pages clients (lecture seule)
  if (pathname === "/api/revisions" && method === "GET") return true;
  if (pathname === "/api/corrections" && method === "GET") return true;

  // Heartbeat Make : Make poste ici en fin de scénario pour signaler qu'il
  // tourne (service externe, pas de cookie possible). Bloqué par erreur depuis
  // le déploiement du verrou (30.07) → bandeau « Make n'a pas ping depuis 9 j ».
  // Le GET reste interne (consommé par le dashboard, qui a le cookie).
  if (pathname === "/api/make-health" && method === "POST") return true;

  // Webhook Wallee relayé par Make (chantier « Acompte payé visible », 03.09.2026) :
  // service externe, sans cookie. Pas ouvert pour autant : la route vérifie
  // elle-même `Authorization: Bearer $WALLEE_WEBHOOK_SECRET` et refuse tout le reste.
  if (pathname === "/api/wallee-webhook" && method === "POST") return true;

  // /api/offres/[slug] :
  //   • GET (racine)   → lecture de l'offre par le client         → PUBLIC
  //   • /valider       → validation de l'offre par le client      → PUBLIC
  //   • /qr            → QR de paiement affiché au client          → PUBLIC
  //   • /wallee-facture → QR-facture rendue par Wallee, servie au client
  //     depuis sa page de confirmation (05.09.2026). GET seul, lecture
  //     seule, 404 sans transaction Wallee — même exposition que /qr → PUBLIC
  //   • /signature     → tracé signé, lu par /print/offre/[slug]    → PUBLIC
  //     (GET seul. Public par nécessité : pdf.co rend la page print
  //      depuis ses serveurs, sans cookie — protégée, elle renverrait
  //      401 et le document sortirait sans signature, en silence.)
  //   • tout le reste (PATCH racine, /pdf, /statut, /notes,
  //     /reviser, /relance, /fiche-travail-pdf, /probabilite)      → INTERNE
  const m = pathname.match(/^\/api\/offres\/([^/]+)(\/[^/]*)?$/);
  if (m) {
    const sousChemin = m[2] || "";
    if (sousChemin === "" && method === "GET") return true;
    if (sousChemin === "/valider") return true;
    if (sousChemin === "/qr") return true;
    if (sousChemin === "/wallee-facture" && method === "GET") return true;
    if (sousChemin === "/signature" && method === "GET") return true;
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
    return redirectionV2(req) ?? NextResponse.next();
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

  // ── Accès Claude (serveur jardi-mail-mcp, 13.08.2026) ──
  // Secret DÉDIÉ à portée LIMITÉE : il n'autorise QUE la création de brouillons
  // (POST /api/drafts). Un brouillon est inerte tant qu'un humain ne le
  // transforme pas en offre. Même compromis, ce secret ne donne accès à rien
  // d'autre — révocable indépendamment du secret de session (env Vercel
  // CLAUDE_DRAFT_SECRET, présent aussi dans le projet Vercel jardi-mail-mcp).
  const secretClaude = process.env.CLAUDE_DRAFT_SECRET;
  const enTeteClaude = req.headers.get("x-jc-claude");
  if (
    secretClaude &&
    enTeteClaude &&
    enTeteClaude === secretClaude &&
    pathname === "/api/drafts" &&
    method === "POST"
  ) {
    return NextResponse.next();
  }

  // pdf.co doit pouvoir rendre les pages /print internes (fiche de travail)
  // pour générer les PDFs. Jeton passé en query par fiche-travail-pdf/route.ts.
  //
  // 02.09.2026 — même jeton accepté sur GET /api/bulletins-livraison/<id> :
  // la page /print/bulletin-livraison/[slug]?bulletin=<id>, rendue par pdf.co
  // sans cookie, relit le bulletin enregistré par cette API et lui transmet
  // le jc_token reçu. Lecture seule d'un uuid, aucun prix. Rien d'autre.
  const estLectureBulletin =
    method === "GET" && /^\/api\/bulletins-livraison\/[0-9a-f-]{36}$/i.test(pathname);
  if (secret && (pathname.startsWith("/print/") || estLectureBulletin)) {
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
