@AGENTS.md

# CLAUDE.md — jardin-confort-formulaire

Application interne de **Jardin-Confort SA** (mobilier de jardin premium, Lutry VD) :
brouillons → offres signables → commandes, impressions, suivi client, délais fournisseurs,
planner 3D, Stock list, listes d'achat, planche couleurs et matières.

- Prod : https://offres.jardin-confort.ch (Vercel, auto-deploy sur `main`)
- Stack : Next.js 16.2.3 (App Router), React 19.2.4, TypeScript strict, Tailwind 4,
  supabase-js, pdf-lib, three.js. Aucune librairie UI, **aucun test automatisé**.
- Catalogue et stock : Shopify (Admin GraphQL 2026-04 + Storefront). Mails : Make.
- Poste : Windows, **PowerShell 5.1**, VS Code. `gh` installé et authentifié.
- Répondre **en français**, ton informel.

> La documentation de référence (docs 00 à 21 : architecture, modèle de données,
> règles métier, pièges, backlog, décisions) vit dans le **Projet claude.ai
> « jardin-confort-formulaire projet »**, pas dans ce dépôt. Les journaux `.md` à la
> racine du dépôt donnent le détail session par session. En cas de doute sur une
> règle métier, **demander** plutôt que deviner.

---

## 🔴 Le dépôt GitHub est PUBLIC

- Aucun secret, aucune clé, aucun `.env` dans un commit.
- Dans le code, les commentaires et les journaux : illustrer avec un **numéro de
  document** (`CMD-80666`, `DEV-2026-421`), **jamais** un nom, une adresse ou un
  e-mail de client.

## 🔴 Deux projets Supabase — ne pas les confondre

- base app (`NEXT_PUBLIC_SUPABASE_URL`) = **la base de l'application** (partagée avec le connecteur
  MCP `jardi-mail-mcp`).
- base webshop (`WEBSHOP_SUPABASE_URL`, `lib/supabase-webshop.ts`) = base du webshop. L'app la lit
  **en lecture seule**, deux vues seulement (`v_recherche_delai`,
  `v_fournisseur_sync`) via `lib/supabase-webshop.ts`. **Jamais d'écriture.**

---

## Règles absolues

1. **Aucune information de stock ou de rareté sur un document client.**
   Seule exception assumée : les mentions « Expo » / « Soldes » (conditions de vente).
   Ne pas s'en servir comme précédent.
2. **Offre signée et commande = preuves.** Modification uniquement par **correction**
   tracée (table `corrections`) ou **révision** versionnée (`commandes_revisions`).
   Jamais de réécriture silencieuse.
3. **Le stock n'est figé QUE sur les commandes** (`type_document === "Commande"`).
   Une offre garde un stock dynamique, même acceptée ou convertie.
4. **Une promesse client ne se recalcule jamais** (`delai_annonce_client`).
5. **L'app ne fait que des décréments de stock Shopify, jamais d'incrément.**
6. **Un décrément ne suit qu'un acte utilisateur explicite**, jamais un timer ni un
   auto-save.
7. **Fichiers sanctuarisés — ne pas modifier sans demande explicite :**
   - `app/api/offres/[slug]/qr/route.ts` (QR-facture suisse)
   - `lib/shopify-orders.ts`, `lib/shopify-stock.ts`, `lib/shopify-pdf-urls.ts`
   - `app/api/stock-movements/process/route.ts`
   - le matcher WinBiz (hors dépôt)
8. **Avant toute modification de colonne** sur `offres`, `clients`,
   `commandes_shopify` ou `factures_winbiz` : signaler qu'il faut vérifier les 5 RPC
   du connecteur (`chercher_clients`, `dossier_client`, `chercher_commandes_magasin`,
   `chercher_mails`, `chercher_pj`). Elles ne sont dans **aucune migration** et
   casseraient en silence.
9. **Multi-marques** : la boutique suit la boîte mail du client (jardinconfort →
   jardin-confort.ch, lumi-shop → lumi-shop.ch, amook → amook.ch). Ne jamais lier
   une autre boutique du groupe à un client.
10. Une adresse client commençant par `sans-email.` est **générée** : jamais affichée
    sur un document client, jamais utilisée pour écrire.

---

## Méthode de travail

1. **Cadrage écrit avant le code** : ce qu'on fait, ce qu'on ne fait pas.
2. **Lire le code réel** avant de proposer quoi que ce soit. Ne jamais supposer
   l'état d'un fichier d'après un journal.
3. **SQL** : je n'exécute **aucune requête** en base. Je rédige le SQL, Thierry le
   lance dans le **SQL Editor Supabase**. Jamais de SQL via PowerShell.
4. **Branche dédiée**, jamais de commit sur `main`.
   - `git status` **avant** chaque `checkout` (un fichier modifié suit le changement
     de branche) et **juste après** `checkout -b`.
5. **Avant de proposer un push** : `npx tsc --noEmit` doit passer. Le type-check
   Vercel est bloquant ; une relecture ne le remplace pas.
6. **Demander avant** `git push`, avant tout merge, et avant toute commande qui
   écrit hors du dépôt. Merge via PR (`gh pr create`, puis
   `gh pr merge --merge --delete-branch`).
7. Après chaque modification, donner la séquence git complète, **une commande par
   ligne** :
   ```
   cd C:\Users\ezefi\jardin-confort-formulaire
   git add <fichiers>
   git commit -m "<message descriptif>"
   git push
   ```
8. **Preview Vercel = vraie base + vrai stock Shopify.** Jamais de commande réelle
   comme cobaye. Commande de test : `CMD-80666` (`cmd-80666-l8i6x`).
   Une transaction Wallee de test est un **engagement de facturation** : jamais sur
   une vraie commande.
9. Un chantier **n'écrit pas** dans les docs du Projet claude.ai : il rend un bilan
   de passation en fin de session.

---

## Pièges qui ont déjà coûté cher

**Environnement / PowerShell 5.1**
- Le vrai formulaire est `app/drafts/_components/DraftFormulaire.tsx`.
  `/offres/nouveau` est du **code mort**.
- Chemins avec crochets `[slug]` : toujours `-LiteralPath`, et quoter.
- `&&` / `||` n'existent pas en PowerShell 5.1 : une commande par ligne.
- Pas de `Get-Content -Raw` / `Set-Content` (accents corrompus) ; pas de `>`.
- Cache `.next` douteux : `Get-Process node | Stop-Process -Force`, puis
  `Remove-Item .\.next -Recurse -Force`, puis `npm run dev`.
- `git --no-pager log` / `diff`, sinon blocage dans `less`.

**Fins de ligne / encodage**
- Le dépôt est stocké en **LF** ; `core.autocrlf` présente les fichiers en CRLF.
  Préserver les fins de ligne et l'encodage (UTF-8 **sans BOM**) de chaque fichier.
- Un `\r` isolé fait réécrire tout le fichier au commit : vérifier
  `git diff --stat` — un nombre de lignes disproportionné est la signature.
  `app/print/offre/[slug]/page.tsx` porte déjà un `}\r` isolé en fin de fichier.

**TypeScript / React / Supabase**
- `select()` supabase-js : **littéral simple** ou cast explicite, sinon
  `GenericStringError` et build cassé.
- En supprimant un état React, chercher aussi le setter (`setX`), sans casse.
- Après tout refactor, revérifier les garde-fous métier (ex. `if (revisionMode) return;`
  dans l'auto-save de `DraftFormulaire`).
- **PostgREST tronque à 1000 lignes sans le dire** : paginer avec `.range()` ou
  passer par une RPC pour toute lecture « tout charger ».
- `computeTotals` lit `lineDiscount` (pas `lineDiscountPerUnit`) : écrire les deux,
  `lineDiscount = qty × lineDiscountPerUnit`.
- Toute route qui écrit `total_ttc` passe par `computeTotals`, sans raccourci.
- Écrire un `jsonb` : préférer la fusion `||` à l'écrasement.
- Une comparaison de révision traite `undefined`, `null` et `""` comme équivalents.

**Shopify**
- `stock` ne se lit jamais sans `inventoryPolicy` (`CONTINUE` ≠ `DENY`).
- Les SKU ne sont pas uniques : matcher par `shopifyVariantId`, SKU en repli ;
  quoter les SKU dans les requêtes GraphQL.
- Le délai (`fournisseur.delai_semaines`) est un métachamp de **variante**.
- Ne jamais relire Shopify en direct pour le stock ou le délai d'une commande déjà
  passée : lire les valeurs figées du document.
- `variants(first: N)` tronque en silence : regarder `variantsCount`.

**Rendu et PDF**
- `NEXT_PUBLIC_APP_URL` vaut la **prod** sur toutes les cibles Vercel : pdf.co rend
  la page d'impression de **prod** même depuis une preview. En preview on teste
  `/print/...`, pas le PDF.
- pdf.co rend sans cookie : toute API appelée pendant le rendu doit l'accepter.
- Date du jour : en heure locale, jamais `toISOString().slice(0,10)`.
- Toute case à cocher ajoutée à `DraftFormulaire` porte la classe `jc-check-label`.
- `white-space: nowrap` est posé sur `.td-stock` et `.td-money` : l'annuler sur
  l'élément ajouté, pas sur la cellule.

**proxy.ts**
- Toute route neuve est fermée par défaut. Un webhook entrant se déclare dans
  `estRoutePublique()` **et** vérifie son propre secret (`Authorization: Bearer`).
- Après tout changement de `proxy.ts`, tester les flux serveur → serveur
  (en-tête `x-jc-interne`).
