# JOURNAL — Sécurité / Authentification

**Projet** : jardin-confort-formulaire
**Localisation** : `C:\Users\ezefi\jardin-confort-formulaire`
**Stack** : Next.js 16.2.3 (App Router) + Supabase + Shopify Admin API
**Production** : `https://offres.jardin-confort.ch`
**Supabase URL** : `https://llkyzspixrbtoprtmvoh.supabase.co`
**Dernière mise à jour** : 30.07.2026

> ⚠️ Ce fichier est versionné (dépôt privé GitHub). **Aucun secret ici** :
> ni le code d'accès, ni le secret de session. Les valeurs vivent uniquement
> dans les variables d'environnement Vercel + `.env.local` (gitignoré).

---

## 🎯 Objectif du chantier

Fermer l'exposition publique de l'espace interne et durcir les liens clients,
**sans jamais casser la consultation client** : les anciens liens (avec leurs
anciens slugs) doivent continuer de fonctionner à l'identique.

---

## 🔴 Failles identifiées (audit du 30.07.2026)

1. **Aucune protection** — pas de proxy/middleware. `/dashboard/*`, la création
   d'offres, les API de gestion : tout est ouvert à qui connaît l'URL.
2. **Escalade triviale par changement d'URL** (la plus grave). Dans
   `app/api/offres/save/route.ts`, une même offre génère `publicUrl` (`/offre/<slug>`),
   `printUrl` (`/print/offre/<slug>`) **et** `dashboardUrl` (`/dashboard/<slug>`)
   avec **le même slug**. Un client qui a reçu son lien `/print/offre/...` n'a
   qu'à remplacer `print/offre` par `dashboard` pour voir la page interne de sa
   commande (notes internes, marges). Aucune devinette nécessaire.
3. **Token de slug faible.** `makeSlug()` utilise
   `Math.random().toString(36).slice(2, 7)` → 5 caractères, non cryptographique,
   parfois plus court. Et le `base` du slug est le numéro **séquentiel**
   (`cmd-80845`) : seule cette poignée de caractères protège une offre.
4. **Sur-exposition de l'API publique.** `GET /api/offres/[slug]` fait
   `select("*")` et renvoie **toute la ligne** (dont `notes_internes` et le blob
   `data`) au navigateur. La page ne les affiche pas, mais elles sont dans le JSON.
5. **RLS à vérifier.** La clé anon Supabase est exposée côté navigateur
   (`NEXT_PUBLIC_...`). Si le Row Level Security n'est pas actif sur `offres` /
   `clients`, toute la table est lisible directement avec cette clé.

---

## 🗺️ Cartographie public / interne (vérifiée route par route)

**Restent PUBLICS (intouchés — c'est ce qui garantit que rien ne casse) :**
- Pages : `/`, `/offre/[slug]` (+ `/valider`, `/confirmation`), `/print/offre/[slug]`
- API : `GET /api/offres/[slug]`, `/api/offres/[slug]/valider`,
  `/api/offres/[slug]/qr`, `GET /api/revisions`, `GET /api/corrections`
- Page du verrou : `/acces` + `POST /api/acces`

**Passent en INTERNE (protégés par le verrou) :**
- Pages : `/dashboard/*`, `/offres/nouveau`, `/drafts/*`, prints internes
  (`/print/all`, `/print/fiche-travail`, `/print/fiche-bleue`,
  `/print/bulletin-livraison`, `/print/draft`, `/print/page-garde-*`)
- API : `PATCH /api/offres/[slug]`, `POST /api/corrections`, `/api/offres/save`,
  `/api/clients/*`, `/api/dashboard/*`, `/api/stats/*`, `/api/stock-*`,
  `/api/shopify*`, `/api/notifications`, `/api/brand-logos*`, etc.

---

## ✅ Couche 1 — Verrou provisoire du dashboard (TERMINÉE, en prod le 30.07.2026)

Protège l'espace interne derrière **un code partagé** (allowlist inversée : les
routes clients passent, tout le reste exige une session). Provisoire assumé —
sera remplacé par un login par vendeur (couche 4).

**Fichiers ajoutés (aucun fichier existant modifié) :**
- `proxy.ts` (racine) — le verrou. Allowlist des routes publiques, sinon
  vérification du cookie de session ; API → 401, page → redirection `/acces`.
- `app/api/acces/route.ts` — `POST` vérifie le code (comparaison à temps
  constant) et pose le cookie `jc_acces` (HttpOnly, Secure, SameSite=Lax,
  30 jours) ; `DELETE` = déconnexion.
- `app/acces/page.tsx` — page de saisie, thème sombre assorti au dashboard.

**Variables d'environnement (Vercel + `.env.local`, valeurs NON consignées) :**
- `DASHBOARD_ACCESS_CODE` — le code que l'équipe saisit.
- `DASHBOARD_SESSION_SECRET` — secret aléatoire, valeur du cookie de session.

**Comportement :** *fail-secure* — si `DASHBOARD_SESSION_SECRET` manque, l'espace
interne se ferme (les clients ne sont jamais bloqués). Donc : variables dans
Vercel **avant** le déploiement.

**Déploiement :** commit sur `main` (cherry-pick depuis `fix/autosave-closure-perime`),
Vercel auto-déploie. Testé en prod : lien client OK sans code, dashboard demande
le code.

### ⚠️ Pièges rencontrés (à ne pas rejouer)
- **Next.js 16 : « middleware » s'appelle désormais `proxy`.** Fichier `proxy.ts`
  à la racine, fonction exportée `proxy`, runtime **Node.js par défaut**. Réf :
  `node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md`. Un
  `middleware.ts` classique aurait été ignoré/déprécié.
- **Commit parti sur la mauvaise branche.** Le commit a d'abord atterri sur
  `fix/autosave-closure-perime` (branche de travail en cours). Récupéré sur `main`
  via `git cherry-pick <hash>` pour ne prendre QUE le verrou, pas le reste de la
  branche inachevée.
- **Page d'accès blanc-sur-blanc.** `globals.css` bascule en sombre via
  `@media (prefers-color-scheme: dark)` (`--foreground: #ededed`). Le champ
  héritait de cette couleur claire → texte invisible. Corrigé en fixant toutes
  les couleurs en dur (thème sombre).

---

## ✅ Couche 2 — Durcir les tokens de slug (TERMINÉE, 30.07.2026)

**But :** remplacer le token faible (`Math.random()` / `md5(random())`, 5 car.)
par un token cryptographique. **Forward-only** : n'affecte QUE les nouveaux
documents. Aucun slug existant n'est régénéré → **aucun ancien lien cassé**.

⚠️ **Il y avait TROIS générateurs de token**, pas un (piège : découverts en
testant un brouillon `dra-699-8jnlh` dont le token était encore faible) :

1. **`app/api/offres/save/route.ts`** — offres/commandes directes (`DEV-`/`CMD-`).
   `makeSlug()` local. Corrigé.
2. **`app/api/drafts/route.ts`** — brouillons (`dra-`). Sa PROPRE copie de
   `makeSlug()`. Corrigé.
3. **Fonction SQL `transformer_draft`** (Supabase) — slug de l'offre lors de la
   transformation brouillon → offre. Token généré côté base. Corrigé par migration.

**Correctif code (fichiers 1 et 2)** — ajouter `import { randomBytes } from "crypto";`
puis remplacer :
```ts
  const token = Math.random().toString(36).slice(2, 7); // ex: "x7k2m"
```
par :
```ts
  const token = randomBytes(12).toString("hex"); // 24 car. hex, ~96 bits
```

**Correctif base (générateur 3)** — migration `transformer_draft_token_crypto`
appliquée en prod le 30.07.2026. Étape 4 de la fonction :
```sql
-- avant : v_token := substring(md5(random()::text || clock_timestamp()::text), 1, 5);
v_token := replace(gen_random_uuid()::text, '-', '');  -- 32 car. hex, CSPRNG
```

**Git (code) :**
```
npx tsc --noEmit
git add app/api/offres/save/route.ts app/api/drafts/route.ts journal-securite.md
git commit -m "Couche 2 : token de slug cryptographique (offres + brouillons, forward-only)"
git push origin main
```

> Note : le `base` du slug reste le numéro séquentiel, mais le token porte
> désormais ~96–128 bits d'entropie réelle → énumération infaisable. Découpler
> totalement l'URL publique du numéro séquentiel est possible plus tard, non
> nécessaire.
>
> ⚠️ Leçon : chercher **tous** les générateurs avant de conclure. Grep
> `Math.random`, `toString(36)`, `md5(random`, et inspecter les fonctions SQL
> (`transformer_draft`, `next_dev_numero`, `next_cmd_numero`).

---

## 🟡 Couche 3 — Filtrer la réponse de l'API publique (À FAIRE)

`GET /api/offres/[slug]` (`app/api/offres/[slug]/route.ts`) renvoie
`select("*")` + `...offre`. Retirer `notes_internes` et les champs internes du
JSON renvoyé (et nettoyer le blob `data` de `notesInternes`), sans casser ce dont
la page cliente a besoin (`data.lines`, totaux, coordonnées, `pdf_url`, `qr_url`,
`numero_affiche`, `numero_client`).

---

## 🟡 Couche 4 — Vraie auth par vendeur + RLS (À FAIRE — chantier propre)

Remplace le code partagé de la couche 1 par un **login Supabase par personne**
(comptes individuels, révocables, traçables). Supabase est déjà branché
(`lib/supabase.ts`, clés anon + service role). Le `proxy.ts` reste ; seule la
source de session change (cookie de code partagé → session Supabase).
Rejoint aussi la mise en place d'un serveur OAuth pour le connecteur mail
(projet `jardi-mail-mcp`) : même Supabase = socle d'identité partagé.

**+ Vérifier le RLS** sur `offres` et `clients` (faille n°5). Attention : l'API
serveur utilise la clé *service role* (bypass RLS) ; le RLS protège surtout les
lectures directes via la clé anon exposée au navigateur.

---

## 📌 Rappel opérationnel

- Diffuser le code d'accès à l'équipe : saisie **une fois par appareil** (cookie
  30 jours), **jamais sur un poste public/partagé**.
- Si le code fuite : le changer dans Vercel (`DASHBOARD_ACCESS_CODE`) → tout le
  monde resaisit. Pas de traçabilité par personne tant que couche 4 pas faite.
