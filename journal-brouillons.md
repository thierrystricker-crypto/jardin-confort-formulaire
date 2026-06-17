# Journal — Chantier "Brouillons" (drafts)

> **Pour reprendre dans un nouveau chat Claude :** colle ce fichier en première
> message. Il contient tout le contexte nécessaire pour reprendre où on s'est
> arrêté.

---

## 🔧 Post-S9 — UI boutons + Transformer sur édition (PR #6, 2026-05-17)

**Premier matin de prod avec l'équipe.** Deux bugs UI remontés au démarrage :

### Bug 1 — Boutons obsolètes Charger/Local/Nouveau brouillon

Sur `/drafts/nouveau` et `/drafts/[slug]/editer`, 3 boutons faisaient résidu
du parcours pré-chantier :
- 📂 **Charger** : vestige de l'ancien parcours localStorage (avant chantier
  brouillons, la persistance se faisait via `STORAGE_KEY = "jc-draft-v1-local"`)
- 💾 **Local** : idem, pour sauvegarder le draft en local navigateur
- 🔄 **Nouveau brouillon** sur `/drafts/nouveau` : pointait vers la page
  courante → no-op silencieux

**Décision** : retirer les 3 boutons. Garder "Nouveau brouillon" uniquement
en mode édition (`currentSlug !== null`) où il sert de raccourci utile
(créer un autre brouillon vierge sans passer par le dashboard).

### Bug 2 — Bouton "Transformer en offre" manquant sur l'édition

Trou UX évident : après avoir enregistré son brouillon, le commercial restait
sur `/drafts/[slug]/editer` **sans aucun bouton pour transformer**. Il devait
faire 3 clics inutiles (Dashboard → cliquer sur le brouillon → bouton
Transformer sur `/dashboard/draft/[slug]`).

**Solution** : ajouter le bouton "⚡ Transformer en offre" directement sur la
page d'édition, à côté de "💾 Enregistrer".

### Architecture livrée

1 commit (`2ae036f`) sur branche `fix/drafts-ui-boutons-et-transformation`,
mergé via PR #6 (merge commit **`b807d15`**).

3 fichiers modifiés, 174 insertions / 79 suppressions :

1. **`components/TransformerModal.tsx`** (renommé depuis
   `app/dashboard/draft/[slug]/TransformerModal.tsx` via `git mv`)
   Le composant existait déjà depuis Session 5 mais était co-localisé dans
   la page lecture-seule du dashboard. Maintenant utilisé par 2 pages
   (lecture-seule dashboard + édition formulaire), il a sa place dans
   `components/` partagé.

   Ajout de **`createPortal(...)` (React Portal)** pour monter la modal
   dans `document.body` plutôt que dans l'arbre du composant parent. Évite
   les conflits de stacking context et c'est la bonne pratique React 2025+
   pour les modals (alignée avec Radix, Headless UI, etc.).

2. **`app/dashboard/draft/[slug]/page.tsx`** : 1 ligne — mise à jour du chemin
   d'import de TransformerModal après le `git mv`.

3. **`app/drafts/_components/DraftFormulaire.tsx`** (la grosse partie) :
   - Import de TransformerModal
   - State `showTransformModal`
   - Handler `handleTransformClick()` qui sauve d'abord les modifs en
     attente (avec validation stricte), puis ouvre la modal
   - Boutons toolbar refactorés : suppression de Charger/Local, masquage
     conditionnel de "Nouveau brouillon" en mode création
   - Nouveau bouton "⚡ Transformer en offre" entre Enregistrer et Aperçu,
     grisé avec tooltip si brouillon déjà transformé en offre
   - Mount du `<TransformerModal />` à la fin du JSX
   - Nettoyage code mort : `STORAGE_KEY`, `saveLocalSnapshot()`,
     `loadDraftLocal()`, bloc try/catch localStorage dans `saveDraft()`,
     lecture localStorage dans le useEffect du titre

### Le piège du jour : CSS global vs Tailwind

**Découverte gênante en cours de PR** : la modal Tailwind, parfaitement
fonctionnelle sur `/dashboard/draft/[slug]`, était **complètement cassée
visuellement** sur `/drafts/[slug]/editer` :
- Texte des checkboxes rejeté à droite hors de la modal
- Layout flex écrasé
- Cases à cocher étirées sur toute la largeur

Cause racine : le bloc `<style jsx global>` de `DraftFormulaire.tsx` (1500+
lignes de CSS pour styler le formulaire en mode sombre/clair) contient des
règles **agressives** :
```css
input, select, textarea {
  width: 100%; background: var(--card-2); border: 1px solid ...
}
*, *::before, *::after { margin: 0; padding: 0; }
```

Ces règles sont **injectées dans `<head>` avec portée globale**, donc
elles s'appliquent **partout dans le document** — y compris à la modal
portée via `createPortal(..., document.body)`. Le portal échappe au DOM
parent mais pas au CSS global.

**Fix en 2 volets** dans le bloc `<style jsx global>` :

```css
/* Volet 1 : checkboxes/radios à taille native dans la modal */
[role="dialog"][aria-modal="true"] input[type="checkbox"],
[role="dialog"][aria-modal="true"] input[type="radio"] {
  width: auto !important;
  background: transparent !important;
  border: 0 !important;
  padding: 0 !important;
  border-radius: 0 !important;
}

/* Volet 2 : restaurer les espacements Tailwind via revert-layer */
[role="dialog"][aria-modal="true"],
[role="dialog"][aria-modal="true"] * {
  margin: revert-layer;
  padding: revert-layer;
}
[role="dialog"][aria-modal="true"] [class*="p-"], ... {
  margin: revert-layer;
  padding: revert-layer;
}
```

Le sélecteur sémantique `[role="dialog"][aria-modal="true"]` (convention
W3C standard pour toute modal) cible précisément les modals sans matcher
quoi que ce soit d'autre dans le formulaire.

**Effet de bord positif** : le popup d'onboarding `OnboardingDraftPopup`
de la PR #5 (qui utilise les mêmes attributs ARIA) a aussi vu son layout
se réparer "gratuitement". Avant : compressé, illisible. Après : aéré et
beau. Pas prévu, mais ravi.

### Pièges techniques retenus

- **Tester sur les 2 parcours** : créer brouillon from scratch
  (`/drafts/nouveau` → save → `/drafts/[slug]/editer`) **ET** ouvrir un
  brouillon existant depuis le dashboard. Les 2 parcours produisent
  visuellement la même page mais ont un cycle de mount React différent
  qui peut révéler des bugs distincts.

- **React Portal ne suffit pas contre `<style jsx global>`** : le portal
  échappe à l'arbre React parent mais pas au DOM-global CSS. Pour vraiment
  isoler un composant, il faut aussi un override CSS scoped au composant
  ou un Shadow DOM. À retenir pour de futures modals.

- **Backticks dans les commentaires JSX** : à l'intérieur d'un template
  literal JSX `` <style jsx>{` ... `} ``, les backticks de markdown style
  (\`padding\`, \`margin\`) **ferment prématurément le template literal**
  et provoquent une erreur de parsing SWC. Toujours utiliser des
  apostrophes ou pas de délimiteur dans ces commentaires.

- **VS Code peut ouvrir un fichier hors-projet** : si on a une copie
  `DraftFormulaire.tsx` dans `Downloads/` (typiquement après l'avoir
  envoyée comme document à Claude), Ctrl+P peut la proposer en premier.
  **Toujours vérifier le chemin complet de l'onglet** (`app > drafts >
  _components > ...`) avant de modifier. Sinon les changements s'écrivent
  sur le mauvais fichier et `git status` ne montre rien de modifié.

- **`revert-layer` CSS** : valeur moderne (Chrome 99+, Firefox 97+,
  Safari 15.4+, ~99% des navigateurs en 2026). Indique "ignore les styles
  de cette couche et utilise ceux de la couche précédente". Parfait pour
  neutraliser un reset global sans toucher au code Tailwind.

### Mise à jour de la dette technique

- ✅ **D11** (popup onboarding) — Toujours résolu (la PR #5 reste valable).
  Bonus inattendu : la PR #6 améliore visuellement aussi le popup grâce
  à la mutualisation des règles CSS sur `[role="dialog"]`.

Pas de nouvelle dette technique créée.

---

## 🎉 Chantier brouillons — OFFICIELLEMENT CLÔTURÉ le 2026-05-16

**Sessions 1 à 9 toutes validées.** Le système de brouillons est en production
sur `https://offres.jardin-confort.ch/dashboard` depuis le merge commit
**`bdc9840`** sur `main` (2026-05-15).

**4 PR post-S9 mergées sur main le 2026-05-16** :
- **PR #2** (`6aeb5ca`) — Fix critique stock dynamique
- **PR #3** (`16e1e31`) — Statut `skipped_not_shopify` + backfill 13 lignes
- **PR #4** (`b892ec7`) — 4 boutons "Nouvelle offre" du dashboard → `/drafts/nouveau`
- **PR #5** (`e5ddd20`) — Popup d'onboarding pour l'équipe (jusqu'au 2026-05-21)

### Récap des 9 sessions du chantier
- **S1** (14/05) — Table `drafts` + branche `feature/brouillons`
- **S2** (14/05) — 5 routes API CRUD + RPC `next_dra_numero()`
- **S3** (14/05) — Pages `/drafts/nouveau` + `/drafts/[slug]/editer`
- **S4** (14/05) — Page `/dashboard/draft/[slug]` lecture-seule
- **S5** (14/05) — Transformation atomique via RPC SQL + modal
- **S6** (15/05) — Section "Brouillons" sur dashboard + 5ème KpiCard
- **S7** (15/05) — Aperçu print avec filigrane "BROUILLON"
- **S8** (15/05) — Refonte des 4 boutons de copie + traçabilité Option A
- **S9** (15/05) — Tests E2E + rotation clés Supabase + merge prod

### État des branches
- `main` à `e5ddd20` (HEAD, merge PR #5 popup onboarding)
- `feature/brouillons` à `5666649` — **gardée localement + remote quelques jours
  par précaution**. À supprimer après une période de stabilité confirmée
  (~1-2 semaines) :
  ```powershell
  cd C:\Users\ezefi\jardin-confort-formulaire
  git branch -d feature/brouillons        # locale
  git push origin --delete feature/brouillons   # distante (ou via UI GitHub)
  ```
- Toutes les autres branches de fix post-S9 : supprimées (local + remote)

### Smoke test prod effectué le 2026-05-15 (chantier initial)
- Création brouillon DRA-XXX "TEST PROD" ✅
- Aperçu print avec filigrane ✅
- Transformation modal + cases à cocher ✅
- Brouillon archivé + lien `→ DEV-2026-XXX` cliquable ✅
- Filtre "Masquer transformés" fonctionnel ✅
- 73 offres existantes intactes ✅

**Quelques bugs métiers mineurs repérés pendant le smoke test prod, notés
hors journal. À traiter dans des sessions dédiées.**

---

## 🔧 Post-S9 — Fix stock lignes à la volée (PR #2, 2026-05-16)

**Bug en prod découvert après merge S9** : sur l'offre `dev-2026-055-uczkq`
(et toute offre/brouillon copié depuis elle), TOUTES les lignes affichaient
"⚠ Stock à vérifier" sur la page client, même les lignes Shopify locked.

### Cause racine

Dans `app/api/offres/[slug]/route.ts`, fonction `refreshStock()`, le filtre
des SKUs incluait toutes les lignes avec un SKU non-vide — **y compris les
lignes "à la volée" (custom)**. Une seule ligne custom avec un SKU contenant
des espaces (ex : `350 01 221 504`) générait une query GraphQL invalide
côté Shopify (`sku:350 01 221 504` interprété comme `sku:350` + termes
parasites) → réponse vide ou erreur → toutes les lignes Shopify locked
tombaient sur le filet "⚠ Stock à vérifier" de la Session 14/05.

Bug pré-existant indépendant du chantier brouillons, mais révélé par la
combinaison "copie d'offre → brouillon → transformation → offre" qui a
multiplié les cas où des lignes custom à syntaxe libre se mélangeaient
avec des lignes Shopify dans le même `data.lines`.

### Bug futur identifié au passage

Dans `app/api/stock-movements/process/route.ts`, le même problème existe
côté **écriture** : à la conversion offre → commande, le mécanisme tente
de décrémenter Shopify pour les lignes à la volée → Shopify ne trouve pas
le SKU → mouvement `failed` + notification parasite. **Volontairement NON
traité dans cette PR** car il a une dimension produit (le user veut garder
la visibilité métier "quelles lignes sont synchronisées vs non"). Réservé
à une PR séparée avec un statut dédié `skipped_not_shopify` (Option C).

### Architecture livrée

3 commits sur la branche `fix/stock-shopify-lignes-volee`, mergés via PR #2
(merge commit **`6aeb5ca`**) :

1. **`14ae17e`** — Helper `isShopifyLine()` dans `lib/jc-print-types.ts`
   Source unique de vérité pour distinguer "ligne Shopify catalogue" (locked
   + sku) vs "ligne à la volée" (custom, comment, media). Fallback rétroactif
   via `id.startsWith("shopify-")` pour les offres pré-Session 14/05.

2. **`428b8fe`** — Filtrage `refreshStock` avec `isShopifyLine`
   `app/api/offres/[slug]/route.ts` ne consulte plus Shopify pour les lignes
   à la volée. Leur stock manuel (ou `null`) est conservé tel quel.

3. **`c8f5524`** — Échappement SKUs dans query GraphQL
   Ceinture-bretelles : les SKUs sont entourés de guillemets dans la query.
   Couvre le cas futur où un fournisseur Shopify introduirait un SKU à
   espaces côté catalogue.

### Validation

- ✅ Preview Vercel testée sur `dev-2026-055-uczkq` → stocks affichés
  correctement (au lieu de "Stock à vérifier" partout)
- ✅ Merge sur main effectué, déploiement prod auto-Vercel OK
- ✅ Smoke test prod sur même URL → stocks affichés en prod

### Pièges techniques retenus

- **Pager `git log`** : sous PowerShell, `git log` lance le pager `less` qui
  bloque le terminal sur `(END)`. Sortie : appuyer sur `q`. Pour éviter :
  utiliser `git --no-pager log`.
- **`git diff` pager** : même piège, même remède (`git --no-pager diff`).
- **Scripts PowerShell avec `exit 1`** : un `exit 1` dans un script lancé
  via copier-coller dans le terminal VS Code **ferme tout le terminal**.
  Préférer la modification manuelle via Ctrl+F / Ctrl+V dans VS Code pour
  les modifs ciblées de quelques lignes.
- **Format de prompt Claude pour les modifs ciblées** : `cherche: ...
  remplace par: ...` (par blocs courts copiables) plutôt que des scripts
  PowerShell longs qui peuvent crasher le terminal.

### Pour la suite

PR #3 réalisée dans la foulée — cf. section suivante.

---

## 🔧 Post-S9 — Statut `skipped_not_shopify` (PR #3, 2026-05-16)

**Bug parallèle traité** (identifié pendant la PR #2) : à la conversion offre →
commande, le mécanisme `app/api/stock-movements/process/route.ts` envoyait
**toutes** les lignes avec un SKU non vide à Shopify, y compris les lignes
custom à la volée. Shopify ne trouvait pas ces SKUs → ligne `stock_movements`
créée avec `status: 'failed'` + notification "⚠️ Sortie stock partielle"
envoyée systématiquement à chaque commande contenant au moins une ligne à
la volée.

### Conséquences gênantes du bug

- Notifs rouges parasites alors qu'il n'y avait pas de vraie erreur Shopify
- KPI "❌ En erreur" pollué par des lignes qui n'étaient pas censées être synchronisées
- Impossible de distinguer "vraie erreur Shopify à investiguer" (rouge) de
  "ligne hors-Shopify normale" (info) → bruit qui masquait les vraies erreurs

### Décision design : préserver la visibilité métier

Solution naïve = filtrer les lignes à la volée en silence (aucune trace).
**Refusé** parce que le commercial veut pouvoir voir au coup d'œil quelles
lignes de la commande sont synchronisées avec Shopify et lesquelles sont
custom (utile pour vérifier qu'on n'a rien oublié).

Solution retenue = nouveau statut dédié **`skipped_not_shopify`** :
- Créé sans aucun appel API Shopify (pas de tentative `findVariantBySKU`)
- N'incrémente pas le compteur `failed`
- Ne déclenche pas la notification d'erreur (qui reste conditionnée à `failed > 0`)
- Apparaît proprement dans le dashboard (violet, libellé "📝 À la volée")

### Migration SQL — aucune

La colonne `stock_movements.status` est `text` libre sans CHECK constraint
(vérifié avant fix). On peut écrire `'skipped_not_shopify'` directement,
zéro risque de timing entre déploiement code et schéma DB.

### Architecture livrée

4 commits sur la branche `feat/stock-movements-skipped-not-shopify`,
mergés via PR #3 (merge commit **`16e1e31`**) :

1. **`974a949`** — `process/route.ts` : séparation en 2 passes
   Pass A = lignes Shopify (via `isShopifyLine`) → API Shopify comme avant.
   Pass B = lignes à la volée → insertion directe `status: skipped_not_shopify`,
   idempotente, sans appel Shopify.

2. **`3d71c6a`** — API `/stock-movements` : `stats.skippedNotShopify`
   Exposition du compteur dans la réponse JSON pour les KPIs dashboard.

3. **`62ef671`** — `StockMovementsBlock` : libellé violet + compteur
   Ajout du cas dans `getStatusStyle`, élargissement du type union,
   compteur "X à la volée" dans le header du tableau.

4. **`9e05cd2`** — Page `/dashboard/stock-movements` : KPI + onglet
   4ème KPI violet "📝 À la volée (hors-Shopify)" à côté des 3 existants
   (Total / Réussis / En erreur). 5ème onglet de filtre dédié.
   Grille KPIs passée de `md:grid-cols-3` à `md:grid-cols-2 lg:grid-cols-4`
   pour rester responsive.

### Backfill historique (2026-05-16)

À la livraison, **13 lignes historiques** étaient en `status: 'failed'` avec
`error_message: 'SKU introuvable dans Shopify'` (faux positifs du bug avant
fix). Décision : les requalifier en masse pour repartir d'une base propre
où le KPI "❌ En erreur" reflète UNIQUEMENT de vraies erreurs Shopify.

Procédure suivie :
1. SELECT de dry-run pour identifier les 13 lignes (date min : 2026-05-06,
   date max : 2026-05-13)
2. SELECT GROUP BY pour vérifier les SKUs concernés (5 SKUs Glatz à espaces,
   3 SKUs Fermob, 2 SKUs Hunn descriptifs, etc. — tous clairement
   non-Shopify d'origine)
3. UPDATE en masse :
```sql
   UPDATE stock_movements
   SET status = 'skipped_not_shopify', error_message = NULL
   WHERE status = 'failed' AND error_message = 'SKU introuvable dans Shopify';
```
4. Vérification post-update :
   - `completed`: 22 (inchangé)
   - `skipped_not_shopify`: 13 (les requalifiées)
   - `failed`: 0

### Validation

- ✅ Preview Vercel testée : KPI "À la volée" rempli, KPI erreur à 0
- ✅ Merge sur main + déploiement prod auto-Vercel OK
- ✅ Smoke test prod : 4 KPIs corrects, lignes historiques affichées en violet

### Pièges techniques retenus

- **Helper réutilisé entre lecture et écriture** : `isShopifyLine` introduit
  en PR #2 fait office de source unique de vérité pour les 2 sens (refresh
  côté offre client + décrémentation côté conversion). Garantit la cohérence
  des frontières "Shopify vs hors-Shopify" dans tout le code.
- **Tolérance frontale au nouveau statut** : le `default` du `switch` dans
  `getStatusStyle` faisait office de filet pendant le déploiement
  progressif des commits, le front n'a jamais cassé même quand le backend
  envoyait déjà des `skipped_not_shopify` non encore stylés.
- **Backfill séparé du code** : aucune migration SQL automatique côté
  application. Le UPDATE manuel via Supabase SQL Editor reste sous contrôle
  du développeur. Bonne pratique à reconduire si on doit nettoyer d'autres
  données historiques un jour.

### Mise à jour de la dette technique

- ✅ Dette **D10** (du journal précédent post-S9 PR #2) → **Résolue**

---

## 🔧 Post-S9 — Boutons "Nouvelle offre" du dashboard (PR #4, 2026-05-16)

**Trouvé juste avant la prod équipe de demain matin** : 4 boutons "Nouvelle
offre" du dashboard pointaient encore vers `/offres/nouveau` (ancien
parcours), au lieu de `/drafts/nouveau`. Conséquence : un commercial qui
cliquait l'un de ces boutons contournait silencieusement le nouveau système
de brouillon.

La PR #1 (chantier brouillons) avait bien refondu les 4 boutons de copie
sur `app/dashboard/[slug]/page.tsx` (Session 8), mais les 4 boutons "création
neuve" sur les autres pages dashboard n'avaient pas été identifiés à
l'époque.

### Boutons corrigés

| Fichier | Ancien label | Nouveau label |
|---|---|---|
| `app/dashboard/page.tsx` | `+ Nouvelle offre` | `+ Nouvelle offre (brouillon)` |
| `app/dashboard/clients/page.tsx` | `+ Offre` | `+ Offre (brouillon)` |
| `app/dashboard/clients/[id]/page.tsx` (header) | `+ Nouvelle offre` | `+ Nouvelle offre (brouillon)` |
| `app/dashboard/clients/[id]/page.tsx` (état vide) | `+ Créer une offre` | `+ Créer une offre (brouillon)` |

Le mécanisme `?prefill=...` (utilisé par 3 des 4 boutons pour pré-remplir
les champs client depuis la fiche) est **déjà supporté à l'identique** par
`/drafts/nouveau` via `DraftFormulaire` depuis Session 3. Donc 0 modification
côté drafts pour faire fonctionner les prefills.

### Choix design des libellés

Garder le mot "offre" et ajouter `(brouillon)` en parenthèse, plutôt que
remplacer "offre" par "brouillon" :
- Continuité visuelle avec l'ancien système pour ne pas surprendre l'équipe
- Le `(brouillon)` clarifie le nouveau parcours sans ambiguïté
- Évite la confusion avec "brouillon de commande" (qui n'existe pas)

### Architecture livrée

1 commit (`052f5af`) sur branche `fix/dashboard-bouton-nouvelle-offre-vers-draft`,
mergé via PR #4 (merge commit **`b892ec7`**).

3 fichiers, 7 insertions, 7 suppressions. Très petit fix mais critique pour
la cohérence du parcours utilisateur en production.

### Bug transitoire observé pendant les tests

Lors d'un test de création de brouillon en preview, une fois sur N essais
le popup d'erreur "Le numéro n'a pas pu être récupéré. Rechargez la page
et réessayez." est apparu. Rééssai immédiat → OK.

Cause probable : timeout RPC Supabase `next_dra_numero` ou cold-start
Vercel. **Aucun lien avec la PR #4** (qui ne touche que des `<Link href=...>`).
Bug pré-existant depuis le déploiement initial du chantier brouillons.

**Décision** : ne pas traiter dans la fenêtre de prod équipe. Noté en
dette technique D12 pour traitement dans une session dédiée (retry
automatique côté front + log côté API).

### Note pour la prochaine session

Le bouton "+ Nouvelle offre (brouillon)" du dashboard principal aura un
**popup d'onboarding** lors des premiers clics, pour expliquer à l'équipe
le nouveau parcours (brouillon → modification → transformation en offre).
Réalisé immédiatement après en PR #5 — cf. section suivante.

---

## 🎓 Post-S9 — Popup d'onboarding (PR #5, 2026-05-16)

**Contexte** : équipe découvre demain (2026-05-17) le nouveau système de
création de brouillons en prod. Pour éviter les questions du type
"pourquoi je tombe sur un brouillon au lieu d'une offre", un popup
d'onboarding s'affiche à chaque ouverture de `/drafts/nouveau`.

### Comportement choisi

- **Apparait** : à chaque ouverture de `/drafts/nouveau` (création de brouillon)
- **Disparait automatiquement** : après le 2026-05-21 (5 jours d'onboarding)
- **Fermable** : bouton "Compris", touche Escape, clic overlay, bouton ✕
- **Pas de localStorage** : volontairement simple, ré-affiché à chaque visite
  jusqu'à la date butoir hardcodée
- **Pas affiché en édition** : `/drafts/[slug]/editer` n'est pas concerné

### Architecture livrée

1 commit (`36fa1cf`) sur branche `feat/popup-onboarding-drafts`, mergé via
PR #5 (merge commit **`e5ddd20`**).

- **Nouveau** : `components/OnboardingDraftPopup.tsx` (composant autonome, ~110 lignes)
- **Modifié** : `app/drafts/nouveau/page.tsx` (3 lignes : import + fragment React + utilisation)
- **Aucun** changement à `DraftFormulaire.tsx` (le composant partagé reste intact)

### Choix design

- **Pas de "Ne plus afficher"** : décision Thierry — l'équipe voit le popup à
  chaque ouverture pendant 5 jours, ça force la lecture en cas de doute, puis
  disparait pour toujours sans intervention.
- **Date butoir hardcodée** plutôt que durée relative : pas de calcul, pas de
  premier-affichage à stocker, pas de timezone à gérer. Date `SHOW_UNTIL`
  fixée à `2026-05-22T00:00:00Z` (exclusif) = popup actif jusqu'au 21 mai inclus.
- **Rollback chirurgical** : si bug visuel ou comportemental, désactivable
  instantanément en commentant 2 lignes dans `app/drafts/nouveau/page.tsx`.

### Texte affiché

> 🎉 Bienvenue dans le nouveau système de création d'offres
>
> À partir de maintenant, vous rédigez d'abord un **brouillon** (DRA-XXX) que
> vous pouvez modifier et dupliquer à volonté.
>
> Quand votre brouillon est prêt, vous le **transformez en offre** définitive
> (DEV-XXXX) — l'offre est non modifiable et peut être partagée au client
> comme d'habitude.
>
> **Bonus** : n'importe quelle offre, commande ou autre brouillon peut être
> **dupliquée en nouveau brouillon** depuis son dashboard.

### Pour la suite

Ce popup peut servir de **template** pour de futurs onboardings de feature.
Si une nouvelle feature débarque et qu'on veut alerter l'équipe pendant
quelques jours, on peut soit :
- Dupliquer `OnboardingDraftPopup.tsx` et changer le texte/date
- OU refactorer en composant générique `<TemporaryAnnouncementPopup ... />`
  paramétré (à voir si on a 3+ cas d'usage à l'avenir)

---

## 🎉 Récap final session 2026-05-16

**Énorme journée.** 4 PRs mergées en prod, 0 régression, équipe prête pour
demain matin.

| PR | Commit merge | Description |
|---|---|---|
| **PR #2** | `6aeb5ca` | Fix critique stock dynamique (lignes à la volée n'invalident plus la query Shopify) |
| **PR #3** | `16e1e31` | Statut `skipped_not_shopify` + backfill 13 lignes historiques |
| **PR #4** | `b892ec7` | 4 boutons "Nouvelle offre" dashboard redirigent vers `/drafts/nouveau` |
| **PR #5** | `e5ddd20` | Popup d'onboarding pour l'équipe (jusqu'au 2026-05-21) |

### Méthodologie validée pour les sessions futures

1. **Diagnostic SQL/lecture avant de toucher au code** — on évite de coder à
   l'aveugle
2. **Format `cherche / remplace par`** par blocs courts à appliquer dans
   VS Code via Ctrl+F + Ctrl+V
3. **Pas de scripts PowerShell avec `exit 1`** dans le terminal VS Code
   (ils crashent le shell)
4. **`git --no-pager diff`** pour éviter d'être bloqué dans `less`
5. **Branche dédiée + PR + Preview Vercel + smoke test avant merge** systématiquement
6. **Journal mis à jour dans la foulée** pendant que c'est frais en tête

---

## 🎯 Contexte du projet

**Projet :** `jardin-confort-formulaire`
**Stack :** Next.js (App Router) + Supabase + Shopify, hébergé sur Vercel
**Chemin local :** `C:\Users\ezefi\jardin-confort-formulaire`
**Branche active :** `main` à `e5ddd20`
**URL prod :** `https://offres.jardin-confort.ch/dashboard`

**Workflow git (PowerShell) après chaque modification :**
```powershell
cd C:\Users\ezefi\jardin-confort-formulaire
git add .
git commit -m ""
git push
```

**Pour tester en local :**
```powershell
cd C:\Users\ezefi\jardin-confort-formulaire
npm run dev
# → http://localhost:3000
```

Si "Another next dev server is already running" : `Get-Process node | Stop-Process -Force` puis relancer.

---

## ⚠️ Pièges Windows transverses (Session 9 a confirmé)

### Piège 1 — Crochets `[ ]` dans les chemins PowerShell

**Tous les Cmdlets PowerShell** qui acceptent un paramètre `-Path` interprètent les crochets `[ ]` comme un **wildcard de classe de caractères**. Sans `-LiteralPath`, le chemin `app\drafts\[slug]\page.tsx` est lu comme "n'importe quel caractère parmi s, l, u, g", ce qui retourne silencieusement zéro résultat (ou `False` pour `Test-Path`) au lieu d'une erreur explicite.

**Toujours utiliser `-LiteralPath`** sur les chemins contenant `[slug]`.

### Piège 2 — Heredocs PowerShell `@"..."@` fragiles aux fins de ligne

**Découvert en Session 9.** Les heredocs PowerShell ne matchent pas toujours du multi-ligne contenant du code (CRLF vs LF, indentation invisible). Si on doit modifier un fichier via PowerShell :
- ✅ Préférer un script avec **comptage d'occurrences via `IndexOf` en boucle** comme garde-fou
- ✅ Utiliser `[System.IO.File]::ReadAllText()` + `WriteAllText()` avec `UTF8Encoding($false)`
- ❌ Éviter `Get-Content -Raw` / `Set-Content` (encodage Windows-1252 par défaut → corruption des accents)

### Piège 3 — VS Code et chemins contenant `[slug]`

**Découvert en Session 9.** La commande `code "app\dashboard\draft\[slug]\page.tsx"` depuis PowerShell crée parfois un **buffer vide** dans VS Code (les crochets interprétés comme wildcard). Le fichier disque reste intact, mais VS Code affiche un onglet vide → **si Ctrl+S est fait, le fichier disque est écrasé par le vide**.

**Solution** : ouvrir le fichier via **Ctrl+P** dans VS Code et taper le nom du fichier, ou via **Fichier → Ouvrir**. **Ne jamais utiliser `code` en CLI** pour ces chemins.

**Si ça arrive** : fermer l'onglet via croix X et choisir **"Ne pas enregistrer"** (jamais Ctrl+S sur un buffer vide).

### Piège 4 — VS Code indicateur "UTF-8 with BOM" incohérent

**Découvert en Session 9.** L'indicateur d'encodage en bas à droite de VS Code peut afficher "UTF-8 with BOM" même quand le fichier disque n'a PAS de BOM (vérifié via `[System.IO.File]::ReadAllBytes()` → bytes initiaux `22 75 73 65` au lieu de `EF BB BF`).

**Si l'indicateur dit "UTF-8 with BOM"** : faire "Reopen with Encoding" → "UTF-8" (sans BOM) **avant** de modifier. Ne pas faire "Save with Encoding" qui modifierait potentiellement le fichier disque.

### Piège 5 — Redirection PowerShell sur chemin `C:\...`

**Découvert en Session 9.** Si un copier-coller PowerShell perd les backslashes (`\` interprété comme caractère d'échappement à un moment), une commande type `git log > C:\Users\ezefi\jardin-confort-formulaire` crée un **fichier au nom tronqué** comme `ezefijardin-confort-formulaire` dans le répertoire courant. À nettoyer manuellement.

**Bonne pratique** : utiliser `Out-File -LiteralPath "..."` au lieu de `>` pour les redirections.

### Piège 6 — UI Supabase changeante : pas de "Reset" individuel sur clés JWT legacy

**Découvert en Session 9 Phase C.** L'UI Supabase 2026 a supprimé le bouton
"Reset" individuel sur les clés legacy `service_role` et `anon` (le bouton
dont parlent encore beaucoup de tutos / réponses Stack Overflow). Les deux
seules options disponibles aujourd'hui pour régénérer une clé legacy fuitée
sont :
- **Rotate JWT secret** (Settings → JWT Keys) : invalide simultanément `anon`
  ET `service_role`. Il faut alors **redéployer en mettant à jour les deux**.
- **Migrer vers les nouvelles API keys** `sb_publishable_...` / `sb_secret_...`
  (Settings → API Keys → onglet "Publishable and secret API keys") puis
  cliquer "Disable JWT-based API keys" dans l'onglet legacy. C'est la voie
  recommandée par Supabase aujourd'hui.

Les nouvelles clés sont auto-créées par Supabase sur les projets existants
et coexistent avec les legacy jusqu'à désactivation explicite.

### Piège 7 — Diff `git` partiellement lisible : valider avant de conclure

**Découvert post-S9 PR #4 (2026-05-16).** Un diff `git --no-pager diff` qui
contient plusieurs hunks dans le même fichier peut induire en erreur si on
lit trop vite. Exemple concret : sur `app/dashboard/clients/[id]/page.tsx`,
Claude a affirmé "le 4ème label n'a pas été modifié" en lisant seulement les
2 premiers hunks visibles, alors que le 3ème hunk (plus bas dans la sortie)
contenait bien le changement attendu.

**Bonne pratique** : avant de conclure qu'un changement manque, demander
`git --no-pager diff -- <fichier_unique>` et vérifier **tous** les `@@ ... @@`
hunks. Si plusieurs hunks dans le même fichier, ils peuvent être séparés
par des dizaines de lignes invisibles dans la sortie tronquée.

---

## 🐛 Problème métier (rappel)

Aujourd'hui, dès qu'une offre est enregistrée, elle est **immuable**. Conséquence : pour corriger la moindre faute de frappe ou ajuster un prix, le commercial doit créer une nouvelle offre avec un nouveau numéro. La base contient des doublons quasi-identiques et les statistiques sont faussées.

**Solution livrée :** notion de **brouillon (draft)** modifiable à volonté, transformable en offre définitive par action explicite du commercial. **Aucune offre n'est plus créée directement** depuis l'application — toute création passe par un brouillon, l'offre n'existe que via transformation.

---

## 📋 Modèle métier livré

### Brouillon (`drafts`)

- Créé via "Nouveau" ou copie d'une offre/commande/brouillon existant
- **Modifiable indéfiniment** par le commercial
- Numérotation `DRA-001`, `DRA-002`...
- **Aperçu** filigrané "BROUILLON" (page print dynamique)
- **Template** = devis actuel sans bloc signature + sans lien validation
- **Pas de lien public partageable** (sécurité confirmée en Session 9)
- Listé dans une section dédiée "Brouillons" en bas du dashboard

### Offre (`offres`)

- Créée uniquement par action "Transformer en offre" depuis un brouillon
- **Immuable** dès la transformation
- Numéro d'offre définitif attribué à ce moment
- Lien public de signature
- Aperçu/PDF sans filigrane

### Traçabilité bidirectionnelle 3 niveaux
```
DEV-2026-047 (offre source originelle)
│
│ Copier offre → brouillon
▼
DRA-019 (brouillon)
│ data.copiedFromOffreSlug = "dev-2026-047-l321a"   ← Session 8 + fix 604ff42
│
│ Modifications + saves multiples
│
│ Transformer en offre (RPC SQL atomique)
▼
DEV-2026-058 (nouvelle offre)
│ data.fromDraftSlug = "dra-019-ama4u"               ← Session 5
│
DRA-019 archivé avec :
- archived = true
- transformed_at = même timestamp que offre.created_at (atomicité)
- transformed_into_offre_slug = "dev-2026-058-63a24"
- data.copiedFromOffreSlug PRÉSERVÉ = "dev-2026-047-l321a"
```

**Test bout-en-bout effectué en Session 9 sur DRA-019 → DEV-2026-058.** Tous les liens validés en SQL.

---

## ✅ Décisions validées (récap)

| Décision | Choix retenu |
|---|---|
| Stockage | Nouvelle table `drafts` |
| Après transformation | **Conservé indéfiniment** (pas de purge auto) |
| Filtre dashboard | "Masquer brouillons transformés" (coché par défaut, persistance localStorage) |
| Numérotation | `DRA-XXX` |
| Dashboard | Section "Brouillons" en bas (collapsible, ouverte par défaut) |
| Confirmation transformation | Modal avec récap détaillé + 2 cases à cocher |
| Mode de transformation | **RPC SQL atomique** `transformer_draft(p_slug)` |
| Transformation multiple | **Non** — un brouillon = 1 transformation max |
| Bouton "📋 Dupliquer en brouillon" | Disponible **même** sur brouillons transformés (cas variantes), s'ouvre en **nouvel onglet** |
| Boutons de copie depuis offre/commande | **Tous deviennent des brouillons** (Session 8). Aucun bouton ne crée plus directement une offre. |
| Boutons "Nouvelle offre" du dashboard | **Tous redirigent vers `/drafts/nouveau`** (PR #4 post-S9). Label "Nouvelle offre (brouillon)" pour clarifier le parcours. |
| Mécanisme de copie | **POST direct `/api/drafts`** (Session 8 — Option A). Plus de localStorage. |
| Aperçu brouillon | Page print dynamique avec filigrane "BROUILLON — DRA-XXX" |
| Récap modal de transformation | Détail complet (Sous-total, Remise (X%), Services inclus, Arrondi, TVA, Total) — Session 9 fix `3cb1db6` |
| Lien public sur brouillon | **Bloqué** (vérifié Session 9 : `/offre/dra-XXX-XXXXX` retourne "introuvable") |
| Sauvegarde brouillon | Manuelle + auto-save 2 min |
| URL d'édition | Route dynamique `/drafts/[slug]/editer` |
| Filigrane | SVG inline data-URI, ambre `#f59e0b`, opacité 0.11, rotation -30° |
| Auto-print | **Aucun** nulle part |
| Onboarding équipe | Popup hardcodé jusqu'au 2026-05-21, sans localStorage (PR #5 post-S9) |
| Clés Supabase | **Nouvelles API keys** `sb_publishable_...` / `sb_secret_...` (depuis Session 9 Phase C). Plus les anciennes JWT `eyJ...` legacy. |

---

## 🗒️ Notes par session (résumé)

Pour les détails complets des Sessions 1 à 8, voir versions précédentes du journal. Récap rapide :

- **Session 1 (2026-05-14)** — Table `drafts` créée + branche feature/brouillons (commit `11b4c36`)
- **Session 2 (2026-05-14)** — 5 routes API CRUD + RPC `next_dra_numero()` (commit `268b2fb`)
- **Session 3 (2026-05-14)** — Pages `/drafts/nouveau` + `/drafts/[slug]/editer` + composant partagé `DraftFormulaire.tsx` (commit `e72e2bc`)
- **Session 4 (2026-05-14)** — Page `/dashboard/draft/[slug]` lecture-seule (commit `J4VKQq9yD`)
- **Session 5 (2026-05-14)** — Transformation atomique via RPC SQL + modal (commit `c831bdf`)
- **Session 6 (2026-05-15)** — Section "Brouillons" sur dashboard + 5ème KpiCard
- **Session 7 (2026-05-15)** — Aperçu print brouillon avec filigrane (page autonome)
- **Session 8 (2026-05-15)** — Refonte des 4 boutons de copie + traçabilité Option A (commit `5b5956b`)

### Session 9 — Phase B (tests E2E) — Terminée le 2026-05-15

**16 tests E2E validés** en local sur la branche `feature/brouillons` :

**B1. CRUD brouillon** (4 tests)
- ✅ Création vide (DRA-016)
- ✅ Modification + persistance F5
- ✅ Suppression brouillon actif (confirm + DELETE)
- ✅ Suppression brouillon transformé bloquée (bouton grisé front)

**B2. Copies et duplications** (5 tests)
- ✅ Copie offre complète → brouillon (DRA-017)
- ✅ Copie offre sans client → brouillon (DRA-019)
- ✅ Libellés "commande" dynamiques (testé sur `cmd-80550-y1o2c`)
- ✅ Duplication brouillon actif (DRA-022, après fix `9e15263`)
- ✅ Duplication brouillon transformé (DRA-023 — cas variantes critique)

**B3. Traçabilité Supabase** (1 test multi-volet)
- ✅ `data.copiedFromOffreSlug` / `copiedFromDraftSlug` correctement persistés
- ✅ **Bug détecté + fix** : la traçabilité était écrasée au premier save → fix `604ff42` (préservation côté serveur dans PUT)
- ✅ Idempotence : la traçabilité survit à des saves successifs

**B4. Aperçu print + sécurité** (2 tests)
- ✅ Filigrane visible, pas de signature, pas de QR
- ✅ **Fix UX** : `TOTAL TTC (indicatif)` → `TOTAL TTC` (commit `9e40fd2`) car les chiffres sont identiques entre brouillon et offre
- ✅ Lien public `/offre/[slug-brouillon]` → "introuvable" (sécurité OK)

**B5. Transformation** (2 tests)
- ✅ Modal récap avec cases à cocher (garde-fou)
- ✅ **Bug UX détecté + fix** : la modal n'affichait pas le détail des totaux → fix `3cb1db6` (ajout Remise (X%), Services, Arrondi). Évite la confusion visuelle "calculs faux"
- ✅ Transformation effective DRA-019 → DEV-2026-058 validée bout-en-bout en SQL

**B6. Dashboard et régressions** (3 tests)
- ✅ Filtre "Masquer transformés" + lien `→ DEV-2026-XXX` cliquable
- ✅ Persistance localStorage (collapse + checkbox)
- ✅ 73 offres existantes accessibles + DEV-2026-011 (7 images d'ambiance lourdes) charge correctement

**4 fixes UX commités en Phase B** (chacun découvert par un test) :

| Commit | Description |
|---|---|
| `9e15263` | Duplication brouillon ouvre dans nouvel onglet (cohérence Session 8) |
| `604ff42` | Préserver clés traçabilité `copiedFrom*` lors du PUT (régression Session 8) |
| `9e40fd2` | Retirer mention "(indicatif)" du total dans aperçu brouillon |
| `3cb1db6` | Afficher détail des totaux (remise, services, arrondi) sur récap modal et page brouillon |

**Données de test résiduelles en base après Phase B :**
- DRA-016 supprimé (test B1.3)
- DRA-017, DRA-019 (transformé en DEV-2026-058), DRA-022, DRA-023 conservés
- DEV-2026-058 créé (transformation de DRA-019, client "Test Fix Tracabilite", montant 6441.80 CHF)

### Session 9 — Phase C (sécurité) — Terminée le 2026-05-15

**Objectif** : régénérer la `SUPABASE_SERVICE_ROLE_KEY` fuitée en Session 2.

**Situation initiale découverte** : projet utilisait encore les clés Supabase
**JWT legacy** (`eyJ...`). L'UI Supabase 2026 a supprimé le bouton "Reset"
individuel sur ces clés. Deux nouvelles options sont proposées par Supabase :
les "Publishable / Secret API keys" (nouveau système non-JWT, recommandé) et
la rotation du JWT secret (invalide tout en bloc).

**Stratégie retenue** : migration vers les nouvelles API keys
(`sb_publishable_...` et `sb_secret_...`) en coexistence avec les legacy,
puis désactivation des legacy une fois la migration validée.

**Pourquoi cette stratégie** :
- Coexistence pendant la migration → zéro downtime
- Validation prod + local avant le clic irréversible
- Alignement avec la direction du produit Supabase
- Pas de nouveau format de variable côté code (mêmes noms d'env vars, juste les valeurs changent)

**Étapes effectuées dans l'ordre** :
1. Identification des clés actuellement utilisées (`eyJ...` legacy en local et en prod)
2. Récupération des nouvelles clés `sb_secret_...` et `sb_publishable_...` (déjà auto-créées par Supabase)
3. Mise à jour Vercel : `SUPABASE_SERVICE_ROLE_KEY` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` sur les 3 envs (Production, Preview, Development)
4. Redéploiement Vercel main → smoke test prod OK
5. Mise à jour `.env.local` + smoke test local OK
6. **"Disable JWT-based API keys"** cliqué dans l'onglet legacy de Supabase
7. Smoke test final post-désactivation : prod + local OK

**Effet de bord majeur découvert** : ~50 scripts ad-hoc à la racine de
`C:\Users\ezefi\` contiennent la clé legacy `eyJ...` hardcodée (familles
`import-factures-*`, `fix-factures-*`, `match-factures-*`,
`verifier-clients-*`, `creer-*`, `reassigner-*`, `audit-*`, `diagnostic-*`).
**Décision lucide** : ne pas étendre le scope de Phase C. Ces scripts cassent
au profit de la rotation effective (401 Supabase). À traiter dans un commit
dédié plus tard quand un script sera réellement nécessaire — avec lecture
d'un `.env`, **pas de re-hardcoding** de la nouvelle clé.

**Aucun commit git** créé pendant Phase C (rotation = env vars + Supabase
console, pas de modification du code source).

### Session 9 — Phase D (merge prod) — Terminée le 2026-05-15

**Objectif** : merger `feature/brouillons` → `main` et déployer en prod.

**Étapes effectuées** :
1. Création de la PR `#1` sur GitHub : `feature/brouillons` → `main`
   - Titre : `feat(drafts): système de brouillons (DRA-XXX) avec transformation atomique en offre`
   - 41 commits, 18 fichiers, +7270/-67 lignes
2. Vérification du Preview Deployment Vercel : **Ready** ✅
3. Smoke test rapide sur l'URL preview (création brouillon + transformation) : OK ✅
4. Merge de la PR via **"Create a merge commit"** (préservation de l'historique des 9 sessions)
   - **Merge commit : `bdc9840`**
5. Auto-deploy Vercel sur `main` : **Ready** ✅
6. Smoke test prod sur `https://offres.jardin-confort.ch/dashboard` :
   - Dashboard charge correctement avec section "Brouillons" + 5 KpiCards ✅
   - 73 offres existantes intactes ✅
   - Création brouillon DRA-XXX "TEST PROD" ✅
   - Aperçu print avec filigrane ✅
   - Transformation modal + cases à cocher ✅
   - Brouillon archivé + lien `→ DEV-2026-XXX` cliquable ✅
   - Filtre "Masquer transformés" fonctionnel ✅

**Bugs métiers mineurs repérés pendant le smoke test prod** : notés hors
journal (suivi séparé). À traiter dans des sessions dédiées post-S9. Aucun
n'est bloquant pour l'usage en prod.

**Aucun rollback nécessaire.** La branche `feature/brouillons` reste
disponible localement et sur l'origin pendant ~1-2 semaines par précaution.

---

## 🐛 Dette technique identifiée

À traiter dans des sessions dédiées. Aucun n'est bloquant pour la prod.

| # | Sujet | Origine | Priorité | Statut |
|---|---|---|---|---|
| D1 | `client_numero_client` reste NULL sur offres créées par transformation | Session 5 | Basse | Ouvert |
| D2 | Mécanisme de création de fiche `clients` non reproduit côté transformation | Session 5 | Moyenne | Ouvert |
| D3 | Affichage "Type cible" cosmétique à nettoyer dans `app/dashboard/draft/[slug]/page.tsx` | Session 5 | Basse | Ouvert |
| D4 | `save/route.ts` utilise des URLs absolues avec fallback prod | Session 5 | Moyenne | Ouvert |
| D5a | Bug `ambianceImages` trop lourdes pour localStorage | Pré-chantier | — | ✅ **Résolu Session 8** |
| D5b | Aperçu offre en création/modification n'affiche pas badges stock (côté drafts `/drafts/[slug]/editer`) | Session 7 (pré-chantier) | Moyenne | Ouvert (porter `refreshStock` dans `GET /api/drafts/[slug]`) |
| D6 | Code mort `?from_copy=1` + `localStorage["jc-offre-copy"]` dans `DraftFormulaire.tsx` (useEffect ~ligne 1145) et `app/offres/nouveau/page.tsx` | Session 8 | Basse | Ouvert |
| D7 | Affichage du pourcentage de remise manquant sur aperçu print offre et page brouillon (seul le montant CHF est affiché) — fix appliqué uniquement sur modal de transformation Session 9 | Session 9 | Moyenne | Ouvert |
| D8 | Fichier parasite `ezefijardin-confort-formulaire` tracké depuis commit `310d262` (chemin Windows mal échappé historique). Inerte. À supprimer dans un commit dédié `chore: cleanup historical garbage` | Pré-chantier (découvert Session 9) | Basse | Ouvert |
| D9 | Créer un `.env.example` versionné dans le repo pour documenter les noms des env vars Supabase requises (`SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_URL`) | Session 9 Phase C | Basse | Ouvert |
| D10 | Décrémentation Shopify à la conversion (`stock-movements/process`) inclut les lignes à la volée → mouvements `failed` parasites + notification "Sortie stock partielle" injustifiée. | Post-S9 PR #2 | — | ✅ **Résolu Post-S9 PR #3** (statut `skipped_not_shopify` + backfill 13 lignes historiques) |
| D11 | Popup d'onboarding pour expliquer à l'équipe le nouveau parcours brouillon → offre lors des premiers clics sur "+ Nouvelle offre (brouillon)". Affichage à durée limitée (quelques jours) ou avec checkbox "Ne plus afficher". | Post-S9 PR #4 | — | ✅ **Résolu Post-S9 PR #5** (popup actif jusqu'au 2026-05-21, sans localStorage) |
| D12 | Bug transitoire observé une fois en prod le 2026-05-16 sur `POST /api/drafts` : popup "Le numéro n'a pas pu être récupéré. Rechargez la page et réessayez." apparu une fois, rééssai immédiat OK. Cause probable : timeout RPC Supabase `next_dra_numero` ou cold-start Vercel. **À traiter dans une session dédiée** avec retry automatique côté front (2-3 tentatives avec backoff) + log côté API pour mesurer la fréquence. | Post-S9 PR #4 | Faible (workaround utilisateur OK : recharger + réessayer) | Ouvert |
| R1 | Script d'import factures non versionné (~50 scripts à `C:\Users\ezefi\` avec clé legacy `eyJ...` hardcodée — **tous cassés depuis désactivation Phase C**). À refactor avec lecture `.env` au moment de réutilisation | Audit Storage + Session 9 Phase C | **Critique** | Ouvert |
| R2 | Google Drive perso sans backup tiers (10 ans de factures) | Audit Storage | Importante | Ouvert |
| R3 | Bucket `brand-logos` non régénérable | Audit Storage | Basse | Ouvert |

---

## 🗄️ Audit Supabase Storage

**Plan Supabase :** Pro (backups DB automatiques activés).

**⚠️ Important :** Les backups DB Supabase **n'incluent pas** les fichiers du Storage.

### Buckets actifs

| Bucket | Utilisé par | Régénérable ? |
|---|---|---|
| `brand-logos` | `app/api/brand-logos/upload/route.ts` | ❌ Non |
| `pdfs` | `app/api/offres/[slug]/pdf/route.ts`, `qr/route.ts` | ✅ Oui (pipeline HTML → pdf.co → pdf4me) |
| `factures` | Script d'import local depuis Google Drive | ✅ Oui (script idempotent) |
| `fiche-travail-pdf` | `app/api/offres/[slug]/fiche-travail-pdf/route.ts` | ✅ Probablement oui |

### Plan de mitigation

- [ ] **R1** : déplacer le(s) script(s) d'import dans le repo (refactor `.env`), commit sur `main`
- [ ] **R2** : Google Takeout one-shot sur "Factures Winbiz"
- [ ] **R3** : backup manuel des logos via dashboard Supabase

### Impact sur le chantier brouillons

✅ **Aucun.** La table `drafts` stocke les `ambianceImages` en base64 dans JSONB, 100% couvert par backups DB.

---

## 🆘 En cas de problème post-déploiement

1. **Régression sur la prod détectée** : `git revert <commit-merge-fautif>` + push → Vercel redéploie l'état antérieur. La table `drafts` peut rester vide en base sans impact.
2. **Erreur 401 Supabase quelque part** : la rotation Phase C a tué les clés legacy `eyJ...`. Vérifier que la prod et le local utilisent bien les nouvelles `sb_secret_...` / `sb_publishable_...` (Vercel Env Vars + `.env.local`). Si nécessaire récupérer les nouvelles clés via Supabase Dashboard → Settings → API Keys → onglet "Publishable and secret API keys".
3. **Un des ~50 scripts à `C:\Users\ezefi\` doit être relancé** : il renverra 401 Supabase (clé legacy désactivée Phase C). Le refactorer alors avec lecture depuis un `.env` (créer `C:\Users\ezefi\.env` avec la nouvelle `SUPABASE_SERVICE_ROLE_KEY=sb_secret_...`, et faire que le script lise `process.env.SUPABASE_SERVICE_ROLE_KEY` via un `require("dotenv").config()`). Ne **pas** re-hardcoder la nouvelle clé.
4. **Le popup d'onboarding pose problème** : désactivable instantanément en commentant 2 lignes dans `app/drafts/nouveau/page.tsx` (import + utilisation). Rollback chirurgical sans toucher au reste.

---

## 📦 Commit du journal mis à jour

```powershell
cd C:\Users\ezefi\jardin-confort-formulaire
git add journal-brouillons.md
git commit -m "docs(journal): post-S9 PR #4 + PR #5 - cloture officielle chantier brouillons"
git push
```


---

## ✅ CLÔTURE D5b — Fix stock dynamique dans les brouillons (14.06.2026)

> Statut : ✅ Terminé et déployé en production
> PR #22 · merge commit `8b957c7` (main e14a43c..8b957c7, fast-forward, 3 fichiers +245/-221)
> Prod : https://offres.jardin-confort.ch

### Le bug (dette D5b)
Quand on copie une offre/commande → brouillon, l'inventaire des articles était copié depuis l'état FIGÉ du document original au lieu d'être dynamique (ex : stock d'une commande d'il y a 2 semaines au lieu du temps réel). Visible dans `/drafts/[slug]/editer`, `/drafts/nouveau`, et `/print/draft`.

### Cause
`app/api/drafts/[slug]/route.ts` (GET) ne contenait AUCUN `refreshStock` (renvoyait `{draft: data}` brut). `app/api/drafts/route.ts` (POST/copie) stocke `data` brut avec stock figé embarqué. L'API offres rafraîchissait, l'API drafts non → incohérence.

### Solution : extraction d'un helper partagé (vs duplication)
Choix d'extraire `refreshStock` dans `lib/shopify-refresh-stock.ts` = une seule source de vérité (fonction critique qui bouge souvent : réécrite au fix stock variant ID, puis au merge inventoryPolicy). 3 fichiers :

| Fichier | Changement |
|---|---|
| `lib/shopify-refresh-stock.ts` (NOUVEAU) | Helper autonome exporté : `getAdminToken` + `refreshStock` (avec inventoryPolicy, matching variant ID + fallback SKU, préservation si introuvable). Constantes SHOP/ADMIN_CLIENT_ID/SECRET + cache token dedans |
| `app/api/offres/[slug]/route.ts` | Importe le helper, supprime la copie locale (−221 lignes ; STOREFRONT_TOKEN était déjà mort). Conditions `isCommande`/`isOffreConvertie` INTACTES |
| `app/api/drafts/[slug]/route.ts` | GET appelle `refreshStock` sur `data.data.lines` avant de renvoyer. Pas de condition isCommande (brouillon toujours dynamique) |

### Règle stock par document (préservée, vérifiée en prod)
- Brouillon → dynamique (le fix)
- Offre en cours → dynamique (`stockFrozen:false`, `stockRefreshedAt` horodaté)
- Offre signée / Commande → figé J0 (`stockFrozen:true`, `stockRefreshedAt:null`, jamais rafraîchi)

C'est l'APPELANT qui décide d'appeler `refreshStock` ; le helper ne fait que rafraîchir.

### Validation complète (preview + prod)
1. Brouillon dynamique — `dra-334-ezy7q` article `28023.3002` passe de `stock:1` figé à `"sur_commande"` live, badge « Rupture » cohérent avec le picker.
2. NON-RÉGRESSION offre `dev-2026-314-73b9b` = `stockFrozen:false` + `stockRefreshedAt` horodaté, stocks live.
3. NON-RÉGRESSION commande `cmd-80661-ct8sm` = `stockFrozen:true` + `stockRefreshedAt:null`, article `28023.3002` garde `stock:1` figé (pas écrasé par le live).

### Pièges retenus
- **Build périmé** : `npm run start` servait un ancien build (ancien serveur node encore actif sur port 3000, EADDRINUSE silencieux). Le fix semblait ne pas marcher. → `Get-Process node | Stop-Process -Force` puis rebuild. Toujours tuer node + rebuild avant de tester.
- **Preview Vercel** : `print/offre` s'ouvre sur l'URL PROD même depuis la preview → tester la non-régression via `/api/offres/[slug]` (JSON brut, reste sur preview), marqueurs `stockFrozen` + `stockRefreshedAt`.

### Reste à faire (différé)
Supprimer la branche après stabilité :
```powershell
git branch -d fix/draft-stock-dynamique
git push origin --delete fix/draft-stock-dynamique
```