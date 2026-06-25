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
**Branche active :** `feature/revision-commandes` (créée + poussée, commit `a296f8d`)
**PR (à ne PAS merger avant Session 5) :**
`https://github.com/thierrystricker-crypto/jardin-confort-formulaire/pull/new/feature/revision-commandes`
**Lié à :** chantier brouillons (clôturé), chantier corrections (S1-S3), chantier
stock garde-fou (clôturé, PR #21)

### Problème métier

Aujourd'hui, une commande validée est **immuable**. Seuls l'**adresse** et le
**mode de paiement** sont modifiables via le dashboard — ces changements
apparaissent en **note rouge** (mécanisme `appendTs`, voir Session 1).

Besoin : pouvoir aussi modifier **prix, rabais, quantité et articles** d'une
commande déjà validée, **proprement et avec une piste d'audit complète**,
sans casser la cohérence stock Shopify / WinBiz / fiches de travail entrepôt.

---

## 🔒 Cadrage verrouillé (2026-06-23)

### Versionnement — deux plans séparés

**Plan IDENTITÉ (technique, stable)**
- La commande garde son numéro `CMD-xxxxx` à vie : en base, dans WinBiz, dans
  le lien client, dans les URLs.
- WinBiz n'accepte que des **chiffres** dans son champ numéro → il ne voit
  jamais le marqueur de version. Aucun impact sur le pipeline existant.

**Plan VERSION (documentaire, visible sur le papier)**
- Marqueur `· V2`, `· V3`… affiché **à côté du numéro sur les documents
  imprimés** (« Commande CMD-80661 · V2 »).
- Calculé depuis le compteur de révisions. La version vivante affichée =
  `MAX(version_num archivé) + 1`.
- **Rien affiché tant qu'il n'y a pas eu de révision** (commande jamais touchée
  = `CMD-80661` propre). Dès la 1re modif → vivante = `· V2`, snapshot archivé
  = V1.
- **Raison d'être** : éviter que plusieurs versions papier soient
  indiscernables à l'entrepôt/bureau.
- Affiché sur **fiche de travail + fiche commande interne**. **PAS sur le
  document client**.

### Stockage des versions

- **Table dédiée `commandes_revisions`** (PAS un tableau JSONB `data.revisions[]`,
  à cause des `ambianceImages` base64 lourdes qui alourdiraient le `data`
  vivant et chaque `refreshStock`).
- Chaque ligne archive le `data` complet **d'avant modification**, horodatage,
  commercial, et un **diff lisible** (audit + fiche de travail).

### Stock — règle d'or

**JAMAIS de remise en stock automatique sur Shopify.** Un article commandé mais
jamais réceptionné se verrait incrémenté à tort. C'est le piège central.

- **Ajout d'un article OU augmentation de qté** → décrémentation Shopify du
  **delta uniquement**, à la validation de la révision. (Voir Session 1 pour la
  stratégie technique exacte — on n'utilise PAS `process`.)
- **Suppression / réduction de qté** → table dédiée **`stock_remises_attente`**
  (statuts `a_remettre` / `remis` / `ignore`). Alimente un **tableau visuel**
  (Session 3) calqué sur `/dashboard/stock-movements`. Validation **manuelle**
  par un responsable. La « notification parallèle » = ce tableau + badge
  compteur.

### Documents

| Document | Comportement |
|---|---|
| Page web client `/offre/[slug]` | Articles **restants seulement**, propre, zéro trace |
| PDF offre, bulletin livraison, page garde colis | Idem — propre |
| **Fiche de travail** (interne) | Articles actifs en haut + **section basse « Articles retirés »** fond rougeâtre, légèrement barrés, qté + date. **Cumulatif** : retraits de V2, V3… empilés |
| Fiche bleue | **Reste dynamique** → montrera l'état révisé. Décision assumée. |
| Marqueur version `· Vn` | Fiche de travail + fiche commande interne uniquement |
| Offre signée DEV | **Intouchée** = preuve contractuelle. La commande **diverge** (modèle Shopify) |
| Dashboard `/dashboard/[slug]` | Bandeau « révisée N fois » + historique |

### Garde-fous hérités

- Le **garde-fou stock DENY** (PR #21) s'applique **aussi en mode révision** :
  ajouter un article non-réassortable en rupture → badge rouge + checkbox
  bloquante.
- Workflow : branche dédiée + PR + Preview Vercel + smoke test.

---

## ✅ Points ouverts — TRANCHÉS en cours de chantier

1. **Articles retirés cumulatifs** → tableau dénormalisé sur le `data` vivant,
   enrichi à chaque révision, affiché uniquement sur la fiche de travail.
   *(Implémentation détaillée à finaliser Session 4 — le helper de diff fournit
   déjà la liste des retraits par révision.)*

2. **Notes rouges existantes** → mécanisme `appendTs` (fonction front dans
   `app/dashboard/[slug]/page.tsx`) qui append « — JJ.MM.AAAA HH:MM » à la
   dernière ligne non vide des notes. Route notes = POST
   `/api/offres/[slug]/notes` `{note_commerciale, notes_internes}` (simple
   update). Les notes de révision seront gérées côté front/route, pas en SQL.

3. **stock_movements vs table séparée** → **registres totalement
   indépendants**. `stock_remises_attente` (remises manuelles +) et
   `stock_movements` (décréments auto −) restent séparés → **2 dashboards
   distincts**. Confirmé par l'utilisateur.

4. **Delta stock à l'ajout** → voir Session 1 : on ne peut PAS réutiliser
   `process` tel quel (il traite TOUTES les lignes du data, pas le delta, et
   son idempotence porte sur slug+sku+reason). **Stratégie retenue (Option 1)** :
   la route `reviser` insère elle-même les `stock_movements` du delta et appelle
   `findVariantBySKU` + `adjustInventory` directement.

5. **Retraits : Shopify seulement, ou tous les articles ?** → **TOUS les
   articles retirés** (Shopify ET à la volée) apparaissent dans
   `stock_remises_attente`. Raison utilisateur : un article « à la volée » à la
   commande initiale a pu être créé depuis dans Shopify ; et un article spécial
   retiré doit être visible pour décision. La distinction = colonne `is_shopify`
   (attribut **visuel**), pas un critère d'inclusion.

---

## 🗄️ Session 0 — SQL — ✅ LIVRÉE (2026-06-23)

Deux tables créées en base (100% additif, idempotent, ne touche rien
d'existant). Confirmé présentes dans Supabase.

### Table `commandes_revisions`
```
id (bigint identity PK), commande_slug (text), numero_affiche (text),
version_num (int), data_avant (jsonb), diff (jsonb), commercial (text),
created_at (timestamptz)
```
- Index unique `(commande_slug, version_num)` + index `(commande_slug,
  version_num DESC)`.

### Table `stock_remises_attente`
```
id, commande_slug, numero_affiche, version_num, sku, product_title,
variant_id, inventory_item_id, location_id, quantity, inventory_policy,
is_shopify (bool, DEFAULT false), status (DEFAULT 'a_remettre'),
retire_par, traite_par, note, created_at, traite_at
```
- **CHECK** `status IN ('a_remettre','remis','ignore')` (validé : garde-fou
  anti-faute-de-frappe).
- Index `(status, created_at DESC)` + `(commande_slug)`.
- Colonne `is_shopify` ajoutée après coup (décision point ouvert n°5).

### Conventions confirmées (depuis le schéma réel de `offres`)
- FK = `commande_slug` (text), cohérent avec `stock_movements.offre_slug`. Pas
  de FK stricte REFERENCES (comme `stock_movements`).
- `offres.id` = bigint PK, `offres.slug` = text, `offres.commercial` = text
  libre (« Michel »).
- `offres` possède DÉJÀ `version`, `data_snapshot`, `snapshot_at`,
  `fiche_travail_initial_url`, `fiche_travail_initial_at` → le concept de
  snapshot pré-existe, on s'y aligne.
- Les lignes de `data.lines` ont un `id` **stable et préfixé** : `shopify-XXX`,
  `custom-XXX`. Le diff matche par cet `id`.

---

## ⚙️ Session 1 — Backend — ✅ LIVRÉE (compile clean, 2026-06-23, commit `a296f8d`)

> **Statut : compile (`npx tsc --noEmit` = 0 erreur), mais PAS encore testé en
> runtime** (pas d'UI pour déclencher). Validation runtime prévue en Session 2.

### Architecture retenue
- **Route dédiée** `app/api/offres/[slug]/reviser/route.ts` (isolée, PAS greffée
  dans `save/route.ts`). Cohérent avec le choix RPC dédiée des brouillons.
- **Atomicité par RPC SQL** `reviser_commande` (comme `transformer_draft`).

### RPC SQL `reviser_commande(p_slug, p_new_data, p_diff, p_commercial, p_retraits)`
Exécutée en base. Dans **une seule transaction** (avec `FOR UPDATE` sur la
ligne commande = anti-révisions-concurrentes) :
1. Calcule `version_num = MAX(version_num) + 1` pour ce slug.
2. Snapshote le `data` ACTUEL dans `commandes_revisions` (version_num).
3. Écrit le nouveau `data` dans `offres` + `updated_at`.
4. Insère les retraits dans `stock_remises_attente` (statut `a_remettre`).
Retourne `{ version_num, revision_id }`.
- **Le stock Shopify est HORS transaction** (appel réseau externe) → géré côté
  Next.js après succès RPC.
- Numérotation : 1re révision archive l'état initial sous `version_num = 1`.

### Helper `lib/revision-diff.ts`
`computeRevisionDiff(before, after)` — matche les lignes par `id`. Retourne :
- `diff` : objet lisible `{ ajouts, retraits, qtyChanges, prixChanges,
  remiseChanges }` (audit + fiche de travail).
- `retraits[]` : pour `stock_remises_attente` — **tous types** d'articles
  (flag `is_shopify` calculé via `isShopifyLine` de `lib/jc-print-types`).
- `ajouts[]` : delta à décrémenter sur Shopify.
- `hasChanges` : bool.
Règles : qty réduite → retrait du delta ; qty augmentée → ajout du delta
(décrément Shopify) ; lignes commentaire/media ignorées pour le stock.
- `isShopifyLine` signature : `{type?, sku?, shopifyLocked?, id?} → boolean`
  (pas de cast nécessaire).

### Route `app/api/offres/[slug]/reviser/route.ts`
POST `{ data: newData, commercial }`. Flux :
1. Charge l'état actuel (vérifie `type_document === "Commande"`).
2. `computeRevisionDiff(oldLines, newLines)`. Si `!hasChanges` → 400.
3. Appelle la RPC `reviser_commande`.
4. **APRÈS succès**, dans `after()` (non bloquant) : décrémente Shopify le
   **delta des ajouts Shopify uniquement**.

### ⚠️ STRATÉGIE STOCK AJOUTS — Option 1 (point clé, ne PAS réintroduire `process`)
On **n'appelle PAS** `stock-movements/process` pour les ajouts de révision.
Raison : `process` lit `offre.data` et traite **TOUTES** les lignes (pas le
delta), et son idempotence porte sur `(slug, sku, reason)`. Le rappeler
**re-décrémenterait les lignes initiales**.
→ La route `reviser` **insère elle-même** les `stock_movements` du delta et
appelle `findVariantBySKU` + `adjustInventory` (de `lib/shopify-stock`),
pattern `pending → completed/failed` identique à `process`.
- `reason = "revision_ajout_v{N}"` (inclut la version) → ne collisionne jamais
  l'idempotence, ni avec l'initial, ni entre révisions.
- `SHOPIFY_LOCATION_ID = gid://shopify/Location/43228233863`.

### ⚠️ PAS de `createNotification` pour les erreurs stock
L'enum `NotificationType` ne contient que **4 types métier**
(`commande_validee`, `commande_convertie_manuelle`, `commande_directe`,
`offre_abandonnee`) — pas de type « warning » générique. Donc la route
`reviser` **n'importe PAS** `createNotification`. Les échecs Shopify vivent
dans `stock_movements` (`status: "failed"` + `error_message`) et sont **déjà
visibles** dans le dashboard `/dashboard/stock-movements` (KPI « ❌ En erreur »).

### Note : `createNotification` (pour info, signature réelle)
`createNotification(input: CreateNotificationInput)` où le champ titre s'appelle
`titre` (pas `title`) et `type` est un `NotificationType` (enum 4 valeurs
ci-dessus). À garder en tête si on doit notifier un événement *métier* plus tard.

---

## 🔜 Session 2 — UI formulaire de révision (PROCHAINE, ~1h30)

- [ ] Bouton **« Réviser »** sur le dashboard de la commande
      (`app/dashboard/[slug]/page.tsx`), à côté du bouton de correction
      cosmétique existant.
- [ ] **Copie adaptée du formulaire** (sur le modèle de `DraftFormulaire.tsx`
      pour les brouillons) → probable `RevisionFormulaire.tsx`. Permet
      d'éditer prix / rabais / qté / articles d'une commande validée.
- [ ] **Garde-fou stock DENY** appliqué (badge rouge + checkbox bloquante,
      réutilise `isNonReassortable` / `isStockCritical` de `lib/jc-print-types`).
- [ ] **Écran de récap « voici ce qui va changer »** avant sauvegarde
      (ajouts / retraits / changements qté-prix + remises stock générées +
      delta Shopify). Appelle POST `/api/offres/[slug]/reviser`.
- [ ] **VALIDATION RUNTIME** de tout le backend Session 1 : première vraie
      révision → vérifier en SQL le snapshot dans `commandes_revisions`, les
      lignes `stock_remises_attente`, le décrément Shopify (un `stock_movements`
      `revision_ajout_vN`).

**SKU de test DENY** : `LFM2952.9311` (tapis Lafuma, non-réassortable) — présent
sur la commande `cmd-80666-l8i6x`.

---

## 📋 Sessions suivantes

### Session 3 — Tableau remises en stock (~1h)
- [ ] Dashboard des articles à remettre, calqué sur `/dashboard/stock-movements`.
- [ ] Validation manuelle (`a_remettre` → `remis` / `ignore`), badge `is_shopify`
      pour distinguer remise possible vs article spécial à vérifier.
- [ ] Badge compteur.

### Session 4 — Documents + dashboard (~1h30)
- [ ] Section « Articles retirés » (fond rougeâtre, barré, **cumulatif**) sur la
      fiche de travail uniquement.
- [ ] Marqueur version `· Vn` sur fiche de travail + fiche commande interne.
- [ ] Bandeau « révisée N fois » + historique sur `/dashboard/[slug]`.
- [ ] **Vérifier** que ces fichiers ne montrent JAMAIS de trace de révision :
  - `app/print/offre/[slug]/page.tsx`
  - `app/print/offre/page.tsx`
  - `app/offre/[slug]/page.tsx`
  - `app/print/bulletin-livraison/[slug]/page.tsx`
  - `app/print/page-garde-colis/[slug]/page.tsx`

### Session 5 — Merge prod + smoke test (~30 min)
- [ ] Preview Vercel : scénarios complets (ajout / suppression / réduction qté /
      révisions multiples V2→V3 / garde-fou DENY).
- [ ] Merge main + smoke test prod. Cleanup branche. Journal final.

---

## 🛠️ Méthodologie validée (héritée des chantiers précédents)

1. Diagnostic SQL/lecture avant de toucher au code.
2. Format `cherche / remplace par` par blocs courts copiables dans VS Code.
3. Branche dédiée + PR + Preview Vercel + smoke test avant merge.
4. `git --no-pager diff` pour éviter le pager `less`.
5. Journal mis à jour dans la foulée.
6. `Get-Process node | Stop-Process -Force` + suppression `.next` au premier
   404 inexpliqué ou build périmé.
7. **`-LiteralPath`** pour tout chemin contenant `[slug]` en PowerShell
   (Get-Content le refuse sinon).
8. **SQL → Supabase SQL Editor, JAMAIS PowerShell** (sinon « le mot clé from
   n'est pas pris en charge »).
9. **Ne PAS recoller la sortie du terminal dans PowerShell** (ça déclenche une
   avalanche d'erreurs de parsing — anodin, ignorer).
10. `git status` juste après `git checkout` pour confirmer la bonne branche.

---

## 🚦 Workflow git

```powershell
cd C:\Users\ezefi\jardin-confort-formulaire
git status                      # confirmer "On branch feature/revision-commandes"
# ... modifs ...
git add .
git commit -m "<message>"
git push                        # upstream déjà configuré
```

---

## 🛑 Fichiers À NE PAS TOUCHER (rappel)

- `app/api/offres/[slug]/qr/route.ts` — Swiss QR-bill réglementaire
- `lib/shopify-orders.ts`, `lib/shopify-pdf-urls.ts`
- `lib/shopify-stock.ts` — on l'IMPORTE (findVariantBySKU, adjustInventory,
  SHOPIFY_LOCATION_ID) mais on ne le MODIFIE pas
- `app/api/stock-movements/process/route.ts` — on ne le modifie PAS (la route
  reviser gère son propre décrément delta)
- Matcher WinBiz
- Tous les **documents client** ne doivent JAMAIS exposer la moindre trace de
  révision

---

## 📦 Statut

| Session | Statut | Date |
|---|---|---|
| Cadrage | ✅ Verrouillé | 2026-06-23 |
| Session 0 — SQL | ✅ Livrée (2 tables + is_shopify créées) | 2026-06-23 |
| Session 1 — Backend | ✅ Livrée, compile (tsc clean), commit `a296f8d` — PAS testée runtime | 2026-06-23 |
| Session 2 — UI formulaire | ⬜ Prochaine | — |
| Session 3 — Tableau remises | ⬜ | — |
| Session 4 — Documents | ⬜ | — |
| Session 5 — Merge prod | ⬜ | — |

**Reprise :** brancher `git status` (confirmer `feature/revision-commandes`),
puis « on enchaîne Session 2, UI formulaire de révision ».

---

## 🔬 Session 2 — Analyse d'intégration UI (faite 2026-06-23, AVANT les patches)

> Exploration terminée. Les 5 points d'ancrage sont identifiés. Reste à
> APPLIQUER les patches (pas encore fait — repris frais en début de session).

### Décision d'architecture : réutiliser DraftFormulaire, PAS le copier
`app/drafts/_components/DraftFormulaire.tsx` fait **3777 lignes / 198 Ko**.
Le copier serait une dette ingérable. À la place : **2 props optionnels**
(défaut inactif = zéro régression sur brouillons/offres existants) + une page
fine qui monte le formulaire en mode révision.

Le composant accepte DÉJÀ `initialSlug` pour le mode édition (fetch GET
`/api/drafts/[slug]` au mount → hydrate). Une commande a le MÊME format de
`data` ({formType, lines, services, discount, discountPercent,
enabledServices, servicePrices, ...}) → on réutilise la même hydratation, juste
en changeant la SOURCE du fetch.

### Page déjà créée
`app/dashboard/[slug]/reviser/page.tsx` (server component) :
```tsx
import DraftFormulaire from "@/app/drafts/_components/DraftFormulaire";
export default async function ReviserCommandePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <DraftFormulaire revisionMode commandeSlug={slug} />;
}
```
⚠️ Ne compile PAS tant que les props revisionMode/commandeSlug ne sont pas
ajoutés au composant (patches 1-2 ci-dessous).

### Les 5 patches à appliquer dans DraftFormulaire.tsx (ordre important)

**Patch 1 — Type des props.** Ancre :
```ts
type DraftFormulaireProps = {
  initialSlug?: string;
};
```
→ ajouter `revisionMode?: boolean;` et `commandeSlug?: string;`

**Patch 2 — Signature de fonction.** Ancre :
```ts
export default function DraftFormulaire({ initialSlug }: DraftFormulaireProps) {
```
→ destructurer `{ initialSlug, revisionMode = false, commandeSlug }`

**Patch 3 — Init de initialLoadStatus.** Ancre :
```ts
>(initialSlug ? "loading" : "ready");
```
→ devient `>((initialSlug || (revisionMode && commandeSlug)) ? "loading" : "ready");`
(idem pour currentSlug si besoin : initialiser à commandeSlug en mode révision)

**Patch 4 — useEffect d'hydratation.** Le useEffect commence par
`if (!initialSlug) return;` puis `const res = await fetch(`/api/drafts/${initialSlug}`);`
et lit `const d = json.draft;`. L'hydratation se fait via `data = d.data || {}`,
les setters (setFormType, setClientType, ..., `setLines(cloneLines(data.lines))`,
setDiscount, setDiscountPercent, setEnabledServices, setServicePrices) et finit
par `setInitialLoadStatus("ready")`.
→ En mode révision : `if (!initialSlug && !(revisionMode && commandeSlug)) return;`
puis fetcher `/api/offres/${commandeSlug}` au lieu de drafts. La réponse offre
renvoie probablement `{offre: {...}}` ou la commande directement (À VÉRIFIER le
shape de GET /api/offres/[slug] — il fait refreshStock). Le `data` à hydrater =
`offre.data`. Réutiliser EXACTEMENT la même logique de setters (le format est
identique). Gérer 404. Pas de notion `transformed_at` pour une commande.

**Patch 5 — saveDraft.** Ancre :
```ts
const isCreate = currentSlug === null;
const url = isCreate ? "/api/drafts" : `/api/drafts/${currentSlug}`;
const method = isCreate ? "POST" : "PUT";
const res = await fetch(url, {
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ data: snap }),
```
→ En mode révision : court-circuiter vers
`fetch(`/api/offres/${commandeSlug}/reviser`, { method: "POST", body:
JSON.stringify({ data: snap, commercial }) })`. IDÉALEMENT afficher un écran de
récap du diff AVANT (la route /reviser renvoie déjà le diff calculé, mais pour
un récap AVANT save il faudrait soit un appel preview, soit calculer le diff
côté front — à décider : le plus simple = montrer le récap APRÈS via la réponse,
ou une modal de confirmation simple « réviser la commande ? »).

### Reste aussi à faire en Session 2
- Bandeau visuel « Révision de CMD-XXX » en haut du formulaire en mode révision
- Bouton « 🔄 Réviser » sur le dashboard commande `app/dashboard/[slug]/page.tsx`,
  à placer à côté du bouton « ✏️ Corriger » existant (qui ouvre un drawer via
  `onClick={() => setCorrectionDrawerOpen(true)}`, classe sky-500). Le bouton
  Réviser = `<a href={`/dashboard/${slug}/reviser`}>` visible uniquement si
  `type_document === "Commande"`.
- Garde-fou stock DENY : déjà présent dans le formulaire (le composant a
  inventoryPolicy sur QuoteLine + le garde-fou de la PR #21). Vérifier qu'il
  s'active bien en mode révision (devrait, c'est le même tableau de lignes).
- VALIDATION RUNTIME : première vraie révision sur cmd-80666-l8i6x → vérifier en
  SQL commandes_revisions (snapshot), stock_remises_attente (retraits), et
  stock_movements revision_ajout_vN (décrément ajout).

### À vérifier en début de Session 2 (commande d'exploration)
Le shape exact de la réponse GET /api/offres/[slug] (clé `offre` ? `data` à la
racine ?) pour brancher l'hydratation du Patch 4 :
```
Get-Content -LiteralPath ".\app\api\offres\[slug]\route.ts" | Select-String -Pattern "NextResponse.json|return.*json" -Context 0,2 | Select-Object -First 5
```

---

## ⚠️ RAFFINEMENT MÉTIER CRITIQUE — Stock figé & lignes existantes (23.06.2026)

> Découvert par l'utilisateur après l'analyse Session 2. Corrige un défaut de
> conception du backend Session 1. À intégrer en Session 2 (UI) ET en correction
> du helper revision-diff.ts (déjà committé).

### Le problème
Le stock d'une commande est **figé au jour J** (snapshot du moment de décision
client) — c'est volontaire (preuve de ce qui était dispo). Les pages print
affichent ce stock figé pour une commande (dynamique seulement pour offres/
brouillons).

Si on AUGMENTE la qté sur une **ligne existante** (ex 4 → 5), cette ligne porte
toujours le `stock: 8` figé du jour J. Mais ces 8 pièces n'existent peut-être
plus (un autre client a acheté entre-temps). La ligne afficherait « en stock
8/5 » = **MENSONGE**, alors que l'ajout réel est peut-être en rupture.

Exemple : J0 = 8 chaises en stock, client commande 4 → fiche « en stock 8/4 ».
Qq jours après, autre client achète les 4 restantes → stock réel = 0. Si le 1er
client veut +1 chaise (total 5), le temps réel dirait « sur commande 0 » mais la
ligne figée dirait toujours « 8 ».

### La règle métier retenue (asymétrique)
- **Réduction de qté sur ligne existante** : AUTORISÉE directement sur la ligne.
  Safe car on réduit du déjà-promis/déjà-compté. La photo « 8 dispo » reste
  vraie, on en livre moins. Le delta retiré → stock_remises_attente.
- **Augmentation de qté sur ligne existante** : INTERDITE. Le champ qté est
  **bridé** : max = valeur d'origine (baisse ou égal seulement) + message qui
  invite à passer par le picker pour le supplément.
- **Tout ajout (même SKU déjà présent)** : le picker Shopify crée TOUJOURS une
  **nouvelle ligne** (nouvel id), avec son **stock temps réel** au moment de la
  révision. Donc 4 chaises figées (stock 8) + 1 chaise neuve (stock réel 0)
  COEXISTENT, chacune disant la vérité de son moment.

Principe : chaque ligne = une **photo datée**. Lignes d'origine = photo J0
(stock figé). Lignes neuves de révision = photo du jour de révision (stock
frais). Aucune ligne ne ment jamais. Un même article peut apparaître 2× avec 2
stocks différents — c'est CORRECT (2 décisions, 2 moments).

### Impacts à implémenter
1. **lib/revision-diff.ts (déjà committé a296f8d) — À CORRIGER** : RETIRER la
   branche « qty augmentée → ajout du delta / décrément Shopify ». Une ligne
   existante ne peut que voir sa qty BAISSER (→ retrait du delta) ou rester.
   Plus aucun cas d'augmentation sur ligne existante. Les `ajouts[]` ne sont QUE
   des lignes neuves (id absent dans `before`). Simplification du code.
2. **UI Session 2** : brider le champ qté des lignes HÉRITÉES de la commande
   (`max` = valeur d'origine) + message d'invite picker. Nécessite de
   distinguer ligne « héritée » vs « ajoutée dans cette révision » → marquer les
   lignes d'origine à l'hydratation (flag type `_fromCommande: true` OU mémoriser
   le Set des id initiaux) et brider qté seulement pour celles-là. Les lignes
   neuves du picker portent déjà leur stock temps réel (comportement actuel du
   picker, rien à changer).
3. Le décrément Shopify (Option 1) ne concerne donc QUE les lignes neuves
   (ajouts via picker), jamais une augmentation sur ligne existante. Cohérent
   avec l'existant.


   ## ✅ Session 2 — UI formulaire de révision — LIVRÉE + VALIDÉE RUNTIME (24-25.06.2026)

**Commits :** `ed5cd8f` (UI) · `64bce48` (fix auto-save) · `82f8d31` (libellés)

### Réalisé
- Réutilisation de `DraftFormulaire.tsx` via 2 props (`revisionMode`, `commandeSlug`) — pas de copie.
  Page `app/dashboard/[slug]/reviser/page.tsx` monte `<DraftFormulaire revisionMode commandeSlug={slug} />`.
- 5 patches dans `DraftFormulaire.tsx` : type props, signature, init `initialLoadStatus`,
  useEffect révision séparé (fetch `GET /api/offres/[slug]` → `{offre:{...}}`, hydrate `o.data`),
  `saveDraft` court-circuité → `POST /api/offres/[slug]/reviser`.
- Bridage qté lignes héritées via `Map inheritedQty` (baisse OK, hausse bloquée + invite picker).
- Bandeau ambre « Révision de commande » + bouton « 🔄 Réviser » sur le dashboard commande.
- Libellés mode révision (eyebrow, titre, onglet, bouton vert, infobulle) conditionnés sur `revisionMode`.

### 🛑 BUG AUTO-SAVE découvert au 1er test runtime (corrigé `64bce48`)
L'auto-save 2 min du `DraftFormulaire` (inoffensif sur brouillons → table `drafts`) déclenchait
en mode révision le court-circuit vers `/reviser` → **versions fantômes + décréments Shopify
sur états transitoires non validés**. Signature : 2 révisions à 2 min d'écart, double décrément.
**Fix :** `if (revisionMode) return;` en tête du `setInterval` auto-save + `&& !silent` sur la
condition du court-circuit `saveDraft`. Une révision ne se déclenche QUE sur clic explicite.
**Règle générale retenue :** un décrément stock ne suit qu'un acte délibéré, jamais un timer.

### Finitions S2 (toutes faites)
- Message d'alerte bridage : déjà correct (faux négatif de recherche dû à l'encodage PowerShell).
- Libellés « Révision » : commit `82f8d31`.
- **RPC `reviser_commande` corrigée** : elle ne resynchronisait AUCUNE colonne dénormalisée
  (`nb_articles`, `sous_total`, `total_ttc`, `tva_montant`, etc. restaient figées → dashboard
  affichait l'ancien total). Corrigée pour relire depuis `p_new_data->'_totals'` + `nb_articles`
  = COUNT des lignes `type NOT IN (comment, media)`. Validé runtime (révision-prix → colonnes suivent).

### Test runtime (cmd-80666-l8i6x) — 2 sens validés
- Ajout via picker → 1 seul décrément `stock_movements` (`revision_ajout_vN`), version archivée, PDF figé préservé.
- Retrait → 1 ligne `stock_remises_attente` (`a_remettre`), AUCUNE remise Shopify auto.
- Garde-fou DENY OK sur la fiche de travail.

---

## ✅ Session 3 — Dashboard « Remise en stock » — LIVRÉE + VALIDÉE RUNTIME (25.06.2026)

**Commit :** `60673fb` (3 fichiers, +369)

### Décisions de cadrage
- **Vocabulaire** : pas de « remise » seul (= rabais dans le métier). Terme = **« Remise en stock »**.
- **Règle d'or** : l'app ne fait QUE des désincrémentations, **JAMAIS d'incrémentation** (ni auto,
  ni manuelle via l'app). Toute remise réelle (+) se fait à la main dans Shopify par un responsable,
  en voyant le vrai stock. Le dashboard = liste de supervision + lien direct vers l'inventaire Shopify.

### Réalisé
- **Route** `app/api/stock-remises/route.ts` : GET (liste + stock live Shopify via `findVariantBySKU`
  pour les lignes `is_shopify` + `a_remettre`, dédupliqué par SKU ; génère le lien inventaire Shopify
  par SKU — le query Shopify accepte le SKU, pas besoin de l'EAN) ; PATCH (marquage `remis`/`ignore`
  avec garde-fou `.eq status a_remettre`, **aucune** incrémentation Shopify).
- **Page** `app/dashboard/stock-remises/page.tsx` : KPIs cliquables (filtres), tableau article + SKU
  + badges (Shopify / À la volée / 🔒 Non-réassort.), qté, stock live, lien « Ouvrir Shopify »,
  boutons « ✅ Remis » / « 🚫 Ignorer ».
- **Lien + badge** dans `app/dashboard/page.tsx` : « 📦 Remise en stock » ambre + badge compteur
  (`remisesCount`, fetch `?status=a_remettre`).
  ⚠️ Piège vécu : `remisesCount` doit être dans `DashboardPage`, PAS dans le sous-composant
  `NotificationsButton` (sinon `TS2304 Cannot find name`).

### Fix `is_shopify`
`isShopifyLine` est correct. Le `is_shopify=false` observé sur la chaise `410192` était un **résidu
du bug auto-save** (la ligne archivée a bien `shopifyLocked=true`). Corrigé par UPDATE manuel sur la
ligne de test. À re-confirmer un jour qu'un retrait propre post-`64bce48` produit `is_shopify=true`.

### Test runtime OK (25.06)
Badge compteur, page, KPIs filtres, stock live, lien Shopify SKU, bouton « Remis » → `status remis`
+ `traite_at` rempli, **aucun mouvement Shopify créé** (règle d'or respectée).
Détail mineur : `traite_par` null si `localStorage["corrections-author"]` vide (non bloquant).

---

## 📦 État du chantier au 25.06.2026

| Session | Statut |
|---|---|
| S0 SQL | ✅ |
| S1 Backend | ✅ validé runtime |
| S2 UI + finitions | ✅ validé runtime |
| S3 Dashboard Remise en stock | ✅ validé runtime |
| S4 Documents | ⬜ à faire |
| S5 Merge prod | ⬜ à faire |

**Branche** `feature/revision-commandes` à `60673fb`. **NE PAS merger avant S5.**

**Reprise S4 :** section « Articles retirés » (cumulative) sur la fiche de travail uniquement ·
marqueur version `· Vn` sur fiche travail + fiche commande interne · bandeau « révisée N fois »
+ historique sur `/dashboard/[slug]` · **vérifier** que `print/offre`, `offre/[slug]`,
`bulletin-livraison`, `page-garde-colis` ne montrent JAMAIS de trace de révision.