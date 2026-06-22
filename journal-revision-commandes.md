# Journal — Chantier "Révision de commandes validées"

> **Pour reprendre dans un nouveau chat Claude :** colle ce fichier en premier
> message, accompagné si possible de `journal-brouillons.md`,
> `journal-corrections.md` et `journal-stock-garde-fou.md` pour le contexte
> projet global.

---

## 🎯 Contexte du chantier

**Projet :** `jardin-confort-formulaire` (Next.js 16.2.3 + Supabase + Shopify, Vercel)
**Chemin local :** `C:\Users\ezefi\jardin-confort-formulaire`
**Prod :** `https://offres.jardin-confort.ch`
**Démarrage :** 2026-06-23 (cadrage)
**Branche active :** *(à créer)* `feature/revision-commandes`
**Lié à :** chantier brouillons (clôturé), chantier corrections (S1-S3), chantier
stock garde-fou (clôturé, PR #21)

### Problème métier

Aujourd'hui, une commande validée est **immuable**. Seuls l'**adresse** et le
**mode de paiement** sont modifiables via le dashboard — ces changements
apparaissent en **note rouge** sur le dashboard ET sur les documents internes
(mécanisme existant, à réutiliser/étendre).

Besoin : pouvoir aussi modifier **prix, rabais, quantité et articles** d'une
commande déjà validée, **proprement et avec une piste d'audit complète**,
sans casser la cohérence stock Shopify / WinBiz / fiches de travail entrepôt.

---

## 🔒 Cadrage verrouillé (2026-06-23)

### Versionnement — deux plans séparés

**Plan IDENTITÉ (technique, stable)**
- La commande garde son numéro `CMD-xxxxx` à vie : en base, dans WinBiz, dans
  le lien client, dans les URLs.
- WinBiz n'accepte que des **chiffres** dans son champ numéro de
  facture/commande → il ne voit jamais le marqueur de version, il continue de
  matcher sur le numéro pur. Aucun impact sur le pipeline existant.

**Plan VERSION (documentaire, visible sur le papier)**
- Marqueur `· V2`, `· V3`… affiché **à côté du numéro sur les documents
  imprimés** (« Commande CMD-80661 · V2 »).
- Calculé depuis le compteur de révisions (`nb lignes commandes_revisions + 1`).
- **Rien affiché tant qu'il n'y a pas eu de révision** (commande jamais touchée
  = `CMD-80661` propre). Dès la 1re modif → version vivante = `· V2`, et le
  snapshot archivé est la V1.
- **Raison d'être** : éviter que plusieurs versions papier imprimées soient
  indiscernables à l'entrepôt/bureau. Le papier le plus récent porte le plus
  grand numéro de version → « quelle est la dernière ? » se répond d'un coup
  d'œil.
- Affiché sur **fiche de travail + fiche commande interne**. **PAS sur le
  document client** (le client n'a pas à savoir que sa commande a été révisée).

### Stockage des versions

- **Table dédiée `commandes_revisions`** (PAS un tableau JSONB `data.revisions[]`).
  Raison : les commandes portent des `ambianceImages` en base64 lourdes dans le
  JSONB ; empiler des snapshots complets dans le même blob ferait exploser la
  taille de ligne et ralentirait chaque `refreshStock`. Table séparée = `data`
  vivant léger.
- Chaque ligne archive le `data` complet **d'avant modification**, horodatage,
  commercial, et un **diff lisible** (+1 article, −2 qté sur SKU X, prix A→B)
  pour l'affichage dashboard et fiche de travail.

### Stock — règle d'or

**JAMAIS de remise en stock automatique sur Shopify.** Un article commandé mais
jamais réceptionné se verrait incrémenté à tort (stock positif alors que pas
reçu). C'est le piège central à éviter.

- **Ajout d'un article** → décrémentation Shopify du **delta uniquement** (le
  nouvel article ajouté), au moment de la **validation de la révision**.
  Réutilise le pipeline `stock-movements/process` existant. On ne retouche pas
  les lignes déjà décrémentées à la commande initiale (sinon double
  décrément).
- **Suppression / réduction de qté** → **nouvelle table dédiée
  `stock_remises_attente`** avec statut (`a_remettre` / `remis` / `ignore`).
  Alimente un **tableau visuel calqué sur le dashboard `/dashboard/stock-movements`
  actuel** (même grammaire visuelle). Un responsable voit « 2× chaise Fermob
  SKU X à remettre — CMD-80661 — retiré le 23.06 par Michel » et valide
  **manuellement** (ou ignore si jamais réceptionné). La « notification
  parallèle » = ce tableau + un badge compteur.

### Documents

| Document | Comportement |
|---|---|
| Page web client `/offre/[slug]` | Articles **restants seulement**, propre, zéro trace |
| PDF offre, bulletin livraison, page garde colis | Idem — propre |
| **Fiche de travail** (interne) | Articles actifs en haut + **section basse « Articles retirés »** fond rougeâtre, légèrement barrés, qté + date. **Cumulatif** : les retraits de V2, V3… s'empilent (chacun daté) |
| Fiche bleue | **Reste dynamique** (générée à la demande depuis `data.lines` vivant). On la laisse telle quelle → elle montrera l'état révisé. Décision assumée. |
| Marqueur version `· Vn` | Sur fiche de travail + fiche commande interne uniquement |
| Offre signée DEV | **Intouchée** = preuve contractuelle figée. La commande **diverge librement** (modèle Shopify) |
| Dashboard `/dashboard/[slug]` | Bandeau « révisée N fois » + accès historique des révisions |

### Garde-fous hérités

- Le **garde-fou stock DENY** (chantier stock-garde-fou, PR #21) s'applique
  **aussi en mode révision** : ajouter un article non-réassortable en rupture →
  badge rouge + checkbox bloquante.
- Workflow : branche dédiée + PR + Preview Vercel + smoke test systématique.

---

## ❓ Points ouverts à trancher en cours de chantier

1. **Articles retirés cumulatifs — implémentation** : recalcul à la volée en
   comparant chaque snapshot `commandes_revisions` au suivant (zéro
   duplication, calcul à chaque affichage) **OU** tableau dénormalisé
   `data.articlesRetires[]` enrichi à chaque révision (lecture directe, donnée
   à garder cohérente). *Recommandation provisoire : la 2e pour la simplicité
   d'affichage. À trancher en Session 1 avec le code sous les yeux.*

2. **Mécanisme de notes rouges existant** : étudier en Session 1 comment les
   changements d'adresse/paiement s'inscrivent actuellement en note rouge
   (dashboard + documents internes) pour que les révisions prix/articles
   s'intègrent à la même logique visuelle plutôt que d'en créer une nouvelle.

3. **Réutiliser `stock_movements` vs table séparée pour les remises** : décidé =
   **table séparée `stock_remises_attente`**. Mais vérifier en Session 0 s'il
   faut un statut miroir dans `stock_movements` pour la cohérence des KPIs, ou
   si les deux registres restent totalement indépendants.

4. **Delta stock à l'ajout** : confirmer en Session 1 qu'on ne décrémente QUE
   les lignes Shopify nettes nouvellement ajoutées, en réutilisant
   `isShopifyLine()` (helper existant lib/jc-print-types.ts) pour exclure les
   lignes à la volée / custom / media.

---

## 📋 Découpage en sessions

### Session 0 — Migrations SQL + schéma (~45 min) — EN COURS
**Branche :** `feature/revision-commandes` (à créer)

- [ ] Migration `commandes_revisions` (colonnes, contraintes, index)
- [ ] Migration `stock_remises_attente` (colonnes, statuts, index)
- [ ] Décider indépendance vs lien avec `stock_movements`
- [ ] Aucun code front

### Session 1 — Backend révision (~1h30)
- [ ] Étudier le mécanisme de notes rouges existant (adresse/paiement)
- [ ] Route API : ouvrir commande en mode révision
- [ ] À la sauvegarde : calcul du diff, snapshot de l'ancienne version dans
      `commandes_revisions`, incrément du compteur de version
- [ ] Gestion delta stock : ajouts → décrément Shopify (delta, via
      `isShopifyLine`) ; retraits → lignes `a_remettre` dans
      `stock_remises_attente`
- [ ] Trancher l'implémentation des articles retirés cumulatifs

### Session 2 — UI formulaire de révision (~1h30)
- [ ] Permettre l'édition prix/rabais/qté/articles sur une commande validée
- [ ] Garde-fou stock DENY appliqué
- [ ] Récap « voici ce qui va changer » avant sauvegarde (snapshot + delta
      stock + remises générées)

### Session 3 — Tableau remises en stock (~1h)
- [ ] Dashboard des articles à remettre, calqué visuellement sur
      `/dashboard/stock-movements`
- [ ] Validation manuelle (`a_remettre` → `remis` / `ignore`)
- [ ] Badge compteur

### Session 4 — Documents + dashboard (~1h30)
- [ ] Section « Articles retirés » (fond rougeâtre, barré, cumulatif) sur fiche
      de travail uniquement
- [ ] Marqueur version `· Vn` sur fiche de travail + fiche commande interne
- [ ] Bandeau « révisée N fois » + historique sur `/dashboard/[slug]`
- [ ] **Vérifier** que ces fichiers ne montrent JAMAIS de trace de révision :
  - `app/print/offre/[slug]/page.tsx`
  - `app/print/offre/page.tsx`
  - `app/offre/[slug]/page.tsx`
  - `app/print/bulletin-livraison/[slug]/page.tsx`
  - `app/print/page-garde-colis/[slug]/page.tsx`

### Session 5 — Merge prod + smoke test (~30 min)
- [ ] PR GitHub descriptif
- [ ] Preview Vercel : scénarios complets (ajout article / suppression /
      réduction qté / révisions multiples V2→V3 / garde-fou DENY)
- [ ] Merge main + smoke test prod
- [ ] Cleanup branche
- [ ] Journal final

---

## 🛠️ Méthodologie validée (héritée des chantiers précédents)

1. **Diagnostic SQL/lecture avant de toucher au code**
2. **Format `cherche / remplace par`** par blocs courts copiables dans VS Code
3. **Branche dédiée + PR + Preview Vercel + smoke test avant merge**
4. **`git --no-pager diff`** pour éviter le pager `less`
5. **Journal mis à jour dans la foulée**
6. **Tester sur les 2 parcours** quand pertinent
7. **`Get-Process node | Stop-Process -Force` + suppression `.next`** au premier
   404 inexpliqué ou build périmé
8. **Après tout refactor de signature de map/type** : scanner les autres usages
9. **`-LiteralPath`** pour tout chemin contenant `[slug]` en PowerShell
10. **Toujours `git status` juste après `git checkout -b`** pour confirmer la
    bonne branche avant de toucher au code

---

## 🚦 Workflow git

```powershell
cd C:\Users\ezefi\jardin-confort-formulaire
git checkout -b feature/revision-commandes
git status   # confirmer "On branch feature/revision-commandes"
# ... modifs ...
git add .
git commit -m "<message>"
git push
```

---

## 🛑 Fichiers À NE PAS TOUCHER (rappel)

- `app/api/offres/[slug]/qr/route.ts` — Swiss QR-bill réglementaire
- `lib/shopify-orders.ts`, `lib/shopify-stock.ts`, `lib/shopify-pdf-urls.ts`
- Matcher WinBiz
- Tous les **documents client** ne doivent JAMAIS exposer la moindre trace de
  révision

---

## 📦 Statut

| Session | Statut | Date |
|---|---|---|
| Cadrage | ✅ Verrouillé | 2026-06-23 |
| Session 0 — SQL | ⏳ En cours | — |
| Session 1 — Backend | ⬜ | — |
| Session 2 — UI formulaire | ⬜ | — |
| Session 3 — Tableau remises | ⬜ | — |
| Session 4 — Documents | ⬜ | — |
| Session 5 — Merge prod | ⬜ | — |