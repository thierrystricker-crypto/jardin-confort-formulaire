# Journal — Chantier "Stock garde-fou" (articles Shopify inventoryPolicy DENY)

> **Pour reprendre dans un nouveau chat Claude :** colle ce fichier en premier
> message, accompagné si possible de `journal-brouillons.md` et
> `journal-corrections.md` pour le contexte projet global.

---

## 🎯 Contexte du chantier

**Projet :** `jardin-confort-formulaire` (Next.js + Supabase + Shopify, Vercel)
**Chemin local :** `C:\Users\ezefi\jardin-confort-formulaire`
**Démarrage :** 2026-06-10 (cadrage + Phase 1.A livrée le même soir)
**Branche active :** `feature/stock-garde-fou` (créée et poussée le 2026-06-10)
**Lié à :** chantier brouillons (terminé), chantier corrections (S1-S3 livré, S4 partiel)

### Problème métier

Quand un commercial ajoute un article Shopify dans un brouillon avec une **quantité supérieure au stock disponible**, l'application affiche actuellement juste le badge orange `🟠 Stock partiel (3 / 7 pces)`. Pas de blocage, pas d'alerte forte.

C'est **acceptable** pour les articles Shopify configurés avec `inventoryPolicy: "CONTINUE"` (continue selling when out of stock = activé). Le commercial peut commander le complément chez le fournisseur, l'usage Jardin-Confort est OK.

C'est **dangereux** pour les articles avec `inventoryPolicy: "DENY"` (continue selling = désactivé). Ces articles sont typiquement :
- Fins de série non-réassortables
- Produits exclusifs en exemplaires uniques
- Stocks épuisés définitivement

Si le commercial promet 4 chaises au client alors que Shopify n'en a que 2 et qu'aucun réassort n'est possible, on se retrouve coincé entre la promesse client et la réalité de stock.

### Décision de cadrage stratégique (10.06.2026)

Mettre en place un **garde-fou côté interne** (commercial) qui distingue les articles non-réassortables et alerte clairement quand `qty > stock`. **Aucun impact sur les documents client** : ni le PDF d'offre, ni la page web client ne mentionnent jamais la politique Shopify (risque commercial d'évoquer une "liquidation" ou "épuisement du stock" sur du mobilier premium).

---

## 🔒 Périmètre v1 verrouillé (validé 2026-06-10)

### Quand déclencher l'alerte ?

Quand **toutes** les conditions sont réunies :
- `line.type === "product"` ET `line.shopifyLocked === true` (ligne Shopify catalogue)
- `line.inventoryPolicy === "DENY"` (continue selling désactivé)
- `line.qty > line.stock` (qté demandée > stock disponible) OU `line.stock === 0`

### Niveau de strictness retenu

**Avertir, pas bloquer.** Le commercial peut toujours sauver / transformer un brouillon avec une qté > stock, mais doit :
1. Voir un badge rouge clair sur la ligne (vs le badge orange existant)
2. Lire un tooltip explicite (non-réassortable)
3. Cocher une checkbox de confirmation : `Je confirme avoir vérifié la disponibilité auprès du fournisseur`

Sans la coche, save / transformation bloqués avec popup d'avertissement détaillé.

### Source de stock retenue

**Stock brut Shopify uniquement.** Pas de gestion de réservations (offres en cours non encore commandées). Si plusieurs commerciaux travaillent en parallèle sur le même article, le système ne le détectera pas (limitation acceptée v1).

---

## ✅ Décisions verrouillées

| Décision | Choix retenu |
|---|---|
| **Source de vérité** | Champ `inventoryPolicy` du variant Shopify (GraphQL Admin API) |
| **Stockage** | Persisté dans `line.inventoryPolicy?: "DENY" \| "CONTINUE"` sur chaque ligne Shopify locked |
| **Récupération** | À l'ajout d'article Shopify (picker) ET à chaque `refreshStock` |
| **Périmètre UI commercial** | Formulaire brouillon (DraftFormulaire.tsx) : badge rouge + checkbox |
| **Périmètre UI interne** | Fiche de travail, fiche bleue, aperçu brouillon, dashboard lecture-seule : mention "🔒 Non-réassortable" sous le badge stock |
| **Périmètre UI client** | **Strictement rien**. PDF offre, page web client, bulletin livraison, page de garde colis : aucune mention de la politique Shopify |
| **Migration rétroactive** | Aucune. Les offres anciennes (sans `inventoryPolicy` stocké) restent en l'état. Feature transparente pour le passé. |
| **Helper partagé** | Nouvelle fonction `isNonReassortable(line)` dans `lib/jc-print-types.ts` |

---

## 🚫 Hors périmètre v1

- Gestion des réservations (qté immobilisée par d'autres offres en cours)
- Sync temps réel `inventoryPolicy` côté offres déjà acceptées / commandes (stock figé J0 par design)
- Notification email/Slack à un responsable
- Workflow de demande de confirmation au fournisseur intégré
- Mention "Jusqu'à épuisement du stock" ou équivalent sur les docs client (**refusée explicitement** — risque commercial)

### Pourquoi pas "Jusqu'à épuisement du stock" sur les docs client ?

Décision prise lors du cadrage : le risque est de signaler une **liquidation/déstockage** sur du mobilier premium :
- Dévalorise l'article ("c'est du déstockage ?")
- Crée une pression artificielle ("dépêche-toi avant que ce soit épuisé")
- Déclenche la question "j'aurai un rabais alors ?" alors que tu vends au prix catalogue
- Contredit le positionnement Jardin-Confort (1000m² d'expo, 40 marques premium, depuis 1960)

Le client n'a pas à savoir si Shopify a `inventoryPolicy: DENY` ou pas. C'est de la plomberie technique interne. Pour lui, tous les articles ont 2 statuts simples : **disponible maintenant** ou **à commander avec délai**.

---

## 📐 Architecture technique du code Shopify (audit 2026-06-10)

| Fichier | Rôle |
|---|---|
| `lib/shopify-stock.ts` | Helper central — token Admin + cache + utilitaires |
| `lib/shopify-orders.ts` | Sync des commandes Shopify (webhook + manuel) — sans rapport stock |
| `lib/shopify-pdf-urls.ts` | URLs PDF factures Shopify — sans rapport stock |
| `app/api/shopify-search/route.ts` | **Endpoint picker article** (ajout dans formulaire) — contient `getAdminAvailableBySku` |
| `app/api/offres/[slug]/route.ts` | **Endpoint offre/brouillon** — appelle `refreshStock` au load (lignes 70-150) |
| `app/api/stock-movements/process/route.ts` | Décrémentation Shopify à la conversion (hors scope v1) |

**Confirmé** : c'est du **GraphQL Admin API version 2026-04**, pas REST. Authentification OAuth Client Credentials Flow avec cache token 24h.

---

## ✅ Phase 1.A — Backend Shopify picker (LIVRÉE le 2026-06-10)

**Commit** : `8875e31` sur branche `feature/stock-garde-fou`
**Fichier patché** : `app/api/shopify-search/route.ts` (1 fichier, 17 insertions, 8 suppressions)
**Validation** : `npm run build` clean en 5.1s, 30 pages générées, 0 erreur TypeScript

### Détail des modifications appliquées

1. **Type `AdminInventoryResponse`** étendu pour accepter `inventoryPolicy?: "DENY" | "CONTINUE" | null` dans le node du variant
2. **Type `ResultItem`** étendu avec `inventoryPolicy: "DENY" | "CONTINUE" | null` (non optionnel, pour forcer l'initialisation explicite)
3. **Query GraphQL `VariantInventoryBySku`** : ajout du champ `inventoryPolicy` juste après `sku` dans le node
4. **Signature de map** changée de `Map<string, number>` à `Map<string, { qty: number; inventoryPolicy: "DENY" | "CONTINUE" }>` — **2 endroits** dans le fichier :
   - Le fallback `if (!skus.length) return new Map<string, number>();` ligne 190 (sinon TypeScript voit 2 signatures différentes et casse en cascade)
   - La création de la vraie map ligne ~209
5. **`buildStorefrontItems`** : initialise `inventoryPolicy: null` à côté de `stock: null` (le type `ResultItem` exige le champ)
6. **`GET` final** : `.map((item) => ...)` refactoré pour récupérer `adminData = adminAvailableMap.get(item.sku)` puis propager `qty` ET `inventoryPolicy` (fini le cast `as number` qui ne marchait plus)
7. **Branche catch** : ajout de `inventoryPolicy: null` dans le payload de fallback (cohérence)

### Piège rencontré pendant la livraison

Build cassé sur `Property 'qty' does not exist on type 'number | { qty, inventoryPolicy }'`. Cause : 2 signatures de retour dans la même fonction (l'ancienne dans le fallback empty, la nouvelle dans le corps). TypeScript faisait un union des 2 → l'accès `.qty` ne compilait pas.

**Leçon retenue** : quand on change la signature d'une map de retour, scanner tous les `new Map<...>` du même fichier avec :
```powershell
Get-ChildItem -Path .\app, .\lib -Filter "*.ts*" -Recurse | Select-String -Pattern "Map<string, number>"
```

---

## 🛠️ Phases restantes Phase 1 (Backend complet)

### Phase 1.B — `refreshStock` dans `app/api/offres/[slug]/route.ts` (À FAIRE)

L'endpoint qui charge une offre/brouillon refresh le stock à chaque load. Il doit maintenant aussi propager `inventoryPolicy` dans `line.inventoryPolicy`.

**Commande d'exploration à lancer en premier** :
```powershell
Get-Content .\app\api\offres\[slug]\route.ts | Select-Object -Skip 70 -First 80
```

**Modifications attendues** :
- Identifier l'appel `findVariantBySKU` (ou équivalent) qui interroge Shopify
- Modifier la query GraphQL pour inclure `inventoryPolicy`
- Propager la valeur dans `line.inventoryPolicy` au moment du refresh
- Préserver la valeur sur les lignes anciennes (pas écraser si Shopify ne renvoie rien)

### Phase 1.C — Helpers + type `QuoteLine` dans `lib/jc-print-types.ts` (À FAIRE)

**Étendre le type `QuoteLine`** :
```typescript
type QuoteLine = {
  // ... champs existants
  inventoryPolicy?: "DENY" | "CONTINUE";  // ← NOUVEAU
};
```

**Créer les 2 helpers** :
```typescript
/**
 * Détermine si une ligne Shopify est "non-réassortable" (vente bloquée à 0).
 * Source unique de vérité utilisée par toutes les UI internes.
 */
export function isNonReassortable(line: QuoteLine): boolean {
  return line.type === "product"
    && (line as { shopifyLocked?: boolean }).shopifyLocked === true
    && line.inventoryPolicy === "DENY";
}

/**
 * Détermine si une ligne est en rupture critique (non-réassortable + qté > stock).
 * Déclenche le badge rouge dans le formulaire.
 */
export function isStockCritical(line: QuoteLine): boolean {
  if (!isNonReassortable(line)) return false;
  const stock = typeof line.stock === "number" ? line.stock : null;
  if (stock === null) return false;
  const qty = line.qty || 0;
  return qty > stock;
}
```

### Phase 1.D — `addShopifyItem` dans `DraftFormulaire.tsx` (À FAIRE)

Quand le commercial clique sur un article dans le picker, propager `inventoryPolicy` dans la ligne créée. Le payload du picker contient maintenant `inventoryPolicy` (depuis Phase 1.A).

**Localisation à identifier** :
```powershell
Get-ChildItem -Path .\app\drafts -Filter "*.tsx" -Recurse | Select-String -Pattern "addShopifyItem|shopifyLocked: true" | Select-Object -First 10
```

---

## 📋 Découpage en sessions restantes

### Session 1 — Backend complet (reste : Phase 1.B + 1.C + 1.D, ~1h)
**Branche :** `feature/stock-garde-fou` (déjà créée, déjà commit Phase 1.A)

- [x] Phase 1.A — `app/api/shopify-search/route.ts` (livrée 10.06.2026, commit `8875e31`)
- [x] Phase 1.B — `refreshStock` dans `app/api/offres/[slug]/route.ts`
- [ ] Phase 1.C — type `QuoteLine` + helpers dans `lib/jc-print-types.ts`
- [ ] Phase 1.D — `addShopifyItem` dans `DraftFormulaire.tsx`
- [ ] Test : créer brouillon, ajouter article DENY, vérifier que `line.inventoryPolicy === "DENY"` est bien persisté dans JSONB
- [ ] Test non-régression : article CONTINUE, vérifier que rien ne change visuellement

### Session 2 — UI Formulaire brouillon (~1h30)
**Suite de la même branche `feature/stock-garde-fou`**

- [ ] Badge rouge dans `DraftFormulaire.tsx` sous le badge stock existant
- [ ] State `confirmedCritical` + checkbox par ligne
- [ ] Blocage save / transformation avec popup détaillé listant les SKUs non confirmés
- [ ] Test bout-en-bout :
  - Créer brouillon avec 1 ligne DENY en rupture → badge rouge visible, save bloqué
  - Cocher la case → save OK
  - Cocher la case puis dé-cocher → save re-bloqué
  - Créer brouillon avec 1 ligne CONTINUE en rupture → comportement actuel inchangé

### Session 3 — Affichage docs internes (~1h)
**Suite de la même branche**

- [ ] Patch `app/print/fiche-travail/[slug]/page.tsx` (standalone)
- [ ] Patch section `ft-` de `app/print/all/[slug]/page.tsx`
- [ ] Patch `app/print/fiche-bleue/[slug]/page.tsx` (standalone) — valider format compact avec Thierry
- [ ] Patch section `fb-` de `app/print/all/[slug]/page.tsx`
- [ ] Patch `app/print/draft/[slug]/page.tsx`
- [ ] Patch `app/dashboard/[slug]/page.tsx`
- [ ] **Vérifier** que ces fichiers ne sont JAMAIS modifiés :
  - `app/print/offre/[slug]/page.tsx`
  - `app/print/offre/page.tsx`
  - `app/offre/[slug]/page.tsx`
  - `app/print/bulletin-livraison/[slug]/page.tsx`
  - `app/print/page-garde-colis/[slug]/page.tsx`
- [ ] Smoke test sur offre cobaye

### Session 4 — Merge prod + smoke test (~30min)

- [ ] PR sur GitHub avec descriptif détaillé
- [ ] Preview Vercel : tester scénarios complets (DENY rupture / DENY OK / CONTINUE rupture)
- [ ] Merge sur main, smoke test prod
- [ ] Cleanup branches
- [ ] Mise à jour journal final

---

## ❓ Questions ouvertes à clarifier en début de Session 1 (suite)

1. **Format compact fiche bleue** : `🔒` seul, `NR` (Non-Réassortable), ou autre ?

2. **Comportement quand on copie un brouillon avec lignes critiques** : faut-il invalider les confirmations à la copie ? (Spoiler : oui, recommandé)

3. **Comportement pour les drafts ouverts depuis longtemps** : si `inventoryPolicy` a changé côté Shopify (passage DENY → CONTINUE ou inverse), le `refreshStock` doit le mettre à jour à chaque ouverture. À vérifier que c'est bien le comportement implémenté en Session 1.

---

## 🛠️ Méthodologie validée (héritée des chantiers précédents)

1. **Diagnostic SQL/lecture avant de toucher au code**
2. **Format `cherche / remplace par`** par blocs courts
3. **Branche dédiée + PR + Preview Vercel + smoke test avant merge** systématiquement
4. **`git --no-pager diff`** pour éviter le piège du pager less
5. **Journal mis à jour dans la foulée**
6. **Tester sur les 2 parcours** : création brouillon from scratch ET ouverture brouillon existant
7. **`Get-Process node | Stop-Process -Force` + suppression `.next`** au premier signe de 404 inexpliqué
8. **Après tout refactor de signature de map/type** : scanner les autres usages du même type pour éviter les unions de types involontaires

---

## 📦 État de départ du nouveau chat

- **Branche `feature/stock-garde-fou`** : poussée sur GitHub, commit `8875e31`
- **Build status** : ✅ propre, TypeScript clean, 30 pages générées
- **Fichiers modifiés non commités** : aucun (tout propre côté working dir)

---

## 🐛 Dette technique pré-identifiée pour ce chantier

| # | Sujet | Origine | Priorité | Statut |
|---|---|---|---|---|
| S1 | Si l'équipe travaille en parallèle sur le même article DENY (2 brouillons ouverts), pas de détection de conflit. Acceptable v1 (faible probabilité), à revoir si plaintes équipe. | Cadrage v1 | Basse | Ouvert |
| S2 | Migration rétroactive des offres anciennes pour stocker `inventoryPolicy` en backfill. Pas nécessaire en v1 (feature transparente). À considérer si on veut afficher l'info sur des offres anciennes. | Cadrage v1 | Basse | Ouvert |

---

## 🚦 Pour démarrer le nouveau chat

1. Coller ce fichier en premier message
2. Vérifier la branche active :
```powershell
   cd C:\Users\ezefi\jardin-confort-formulaire
   git status
   git branch --show-current   # doit afficher "feature/stock-garde-fou"
```
3. Lancer ces 2 commandes d'exploration et coller les résultats :
```powershell
   # Voir refreshStock dans l'endpoint offre/brouillon
   Get-Content .\app\api\offres\[slug]\route.ts | Select-Object -Skip 70 -First 80
   
   # Voir addShopifyItem dans DraftFormulaire
   Get-ChildItem -Path .\app\drafts -Filter "*.tsx" -Recurse | Select-String -Pattern "addShopifyItem|shopifyLocked: true" -Context 2,8 | Select-Object -First 50
```
4. Lancer "On enchaîne Phase 1.B (refreshStock) du chantier stock-garde-fou. Tout le contexte est en mémoire."

## ✅ Phase 1.B + 1.C helpers — LIVRÉE le 2026-06-10

**Commit** : `dbfa1b7` sur branche `feature/stock-garde-fou`
**Fichiers patchés** : `lib/jc-print-types.ts` + `app/api/offres/[slug]/route.ts` (2 fichiers, 30 insertions, 2 suppressions)
**Validation** : `npm run build` clean, 30 pages générées, 0 erreur TypeScript

### Phase 1.B — refreshStock (app/api/offres/[slug]/route.ts)
- Query GraphQL `productVariants` : ajout du champ `inventoryPolicy` après `sku`
- Type de réponse parsée étendu : `inventoryPolicy?: "DENY" | "CONTINUE" | null`
- `skuMap` : signature passée à `Map<string, { stock; delay; inventoryPolicy }>` (déclaration + `.set()` alignés)
- `.map()` final : propagation via spread conditionnel `...(fresh.inventoryPolicy ? { inventoryPolicy: fresh.inventoryPolicy } : {})`

**Arbitrage préservation** : sur SKU locked introuvable côté Shopify, on PRÉSERVE `line.inventoryPolicy` (pas d'écrasement), cohérent avec le filet `stock: null` existant. La politique est rafraîchie à chaque load si Shopify renvoie une valeur (gère le cas DENY → CONTINUE).

### Phase 1.C — helpers (lib/jc-print-types.ts)
- Type `QuoteLine` global étendu : `inventoryPolicy?: "DENY" | "CONTINUE"` + `shopifyLocked?: boolean`
- Helpers `isNonReassortable(line)` et `isStockCritical(line)` ajoutés avant `formatMoney`

### Piège rencontré
Build cassé sur `skuMap.set` : la déclaration (1.B.3a) exigeait `inventoryPolicy` mais le `.set()` (1.B.3b) n'était pas encore patché → `Property 'inventoryPolicy' is missing`. Appliquer les deux ensemble.

### Note harmonisation future (hors scope)
`isNonReassortable` pourrait réutiliser `isShopifyLine()` mais ce n'est PAS équivalent : `isShopifyLine` accepte le fallback `id "shopify-"` et `type === "custom"`, alors que le garde-fou restreint volontairement à `type === "product"`. Garder la version actuelle.

**Backend du garde-fou COMPLET** (1.A → 1.D + helpers). Reste Session 2 (UI formulaire), Session 3 (docs internes), Session 4 (merge prod).

---

## ✅ CLÔTURE — Chantier livré en prod (14.06.2026)

> Statut : ✅ Terminé et déployé en production
> PR #21 · merge commit `e14a43c` (main 751356d..e14a43c, fast-forward, 9 fichiers +734/-32)
> Prod : https://offres.jardin-confort.ch · smoke test OK sur cmd-80666-l8i6x

### Ce qui a été livré cette session

**Synchro branche** : merge de `main` dans `feature/stock-garde-fou` (commit `8a94932`) — la branche datait d'avant 2 fix prod du 11.06 (rabais ligne `c83b92c` + stock variant ID `bca2f26`). 4 fichiers en conflit résolus en adoptant l'architecture de main (matching stock par variant ID) et en y greffant `inventoryPolicy` : `app/api/shopify-search/route.ts`, `lib/jc-print-types.ts`, `app/drafts/_components/DraftFormulaire.tsx`, `app/api/offres/[slug]/route.ts`.

**Session 3 — badges sur docs internes** (commit `f4fa8d7`) : pattern non destructif (flag `isCritique*` calculé en amont + OVERRIDE en fin de cascade stock existante) sur 3 fichiers : `app/print/fiche-travail/[slug]/page.tsx`, `app/print/fiche-bleue/[slug]/page.tsx`, `app/print/all/[slug]/page.tsx` (sections `ft-` et `fb-`). La section `cc-` (commande, doc client) n'est PAS touchée.

**Badges chiffrés (X/Y)** (commit `6afb50b`) : libellés finaux — fiche-travail + print/all `ft-` → `🔴 Rupture · non réassort. (X / Y)` ; fiche-bleue + print/all `fb-` → `🔴 NR X/Y` (compact colonne 60px). Aligne le badge rouge sur le format du partiel orange `🟠 X/Y` déjà présent.

### Fichiers ÉCARTÉS après exploration
- `app/print/draft/[slug]/page.tsx` : n'affiche AUCUN stock par design (commentaires « brouillon ≠ stock live » lignes 14 + 466).
- `app/dashboard/[slug]/page.tsx` : ne liste pas les articles par ligne (aucun accès `data.lines`).

### Logique métier finale (validée)
Garde-fou à 2 niveaux : (1) formulaire/transformation = badge rouge + checkbox bloquante AU MOMENT DE LA DÉCISION (Session 2, commit `071ddb5`) ; (2) fiches internes print travail/bleue POUR L'ENTREPÔT. Badge 🔴 = article Shopify locked + `inventoryPolicy: "DENY"` + stock insuffisant (qty > stock, ou 0, ou sur_commande). Distingue 🟠 partiel réassortable (CONTINUE) de 🔴 rupture non-réassortable (DENY). Rien sur les docs client.

### Rétroactivité (de fait)
Pas de migration rétroactive par design, MAIS les commandes créées depuis la Phase 1 portent déjà `inventoryPolicy` figé J0 → le badge apparaît dessus. Seules les vraies anciennes commandes (avant Phase 1) n'ont pas de badge — comportement voulu.

### Piège récurrent à retenir
Sur `fiche-travail/[slug]/page.tsx` (~ligne 1141), la variable `snFT`/`snFTcrit` revenait 2× à une version cassée (ternaire `? 0 : null`) après réédition → erreur TS « comparison null/number ». Forme CORRECTE : `const snFTcrit = typeof line.stock === "number" ? line.stock : null;` puis condition `… || line.stock === 0 || snFTcrit === null || (line.qty || 0) > snFTcrit`.

### Reste à faire (différé)
Supprimer la branche après 1-2 semaines de stabilité :
```powershell
git branch -d feature/stock-garde-fou
git push origin --delete feature/stock-garde-fou
```

### Amélioration future notée
Bandeau de synthèse « ⚠ N article(s) non-réassortable(s) en rupture » en haut du dashboard `/dashboard/[slug]` (feature en soi : charger `data.lines` côté dashboard). Pas faite.

### SKUs de test DENY
`LFM2952.9311` (Lafuma Marsanne tapis, stock 0, critique dès qty 1) · `020301` (Höfats Cube, stock 3, critique qty 4+).