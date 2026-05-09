# 📓 JOURNAL — jardin-confort-formulaire

> **Mémoire externe du projet pour reprendre rapidement après une session.**
> Quand tu démarres un nouveau chat avec Claude, colle le contenu de ce fichier (ou demande à Claude de le lire) pour qu'il ait tout le contexte.

---

## 🏗️ Architecture du projet

| Aspect | Détail |
|---|---|
| **Localisation locale** | `C:\Users\ezefi\jardin-confort-formulaire` |
| **URL de production** | `https://offres.jardin-confort.ch` |
| **Repo GitHub** | `thierrystricker-crypto/jardin-confort-formulaire` (branch `main`) |
| **Hébergement** | Vercel Hobby (build région Washington East) |
| **Framework** | Next.js 16.2.3 (Turbopack, App Router) |
| **Database** | Supabase (PostgreSQL + Storage) |
| **PDF** | pdf.co API |
| **Shopify** | Admin GraphQL API 2026-04 + Storefront API |
| **Webhook** | Make.com (notifications validation) |

### Variables Vercel actuelles
- `SHOPIFY_ADMIN_CLIENT_ID`, `SHOPIFY_ADMIN_CLIENT_SECRET` (search_motor-4)
- `SHOPIFY_STORE_DOMAIN` = `www.jardin-confort.ch`
- `SHOPIFY_STOREFRONT_ACCESS_TOKEN`
- `PDFCO_API_KEY`
- `NEXT_PUBLIC_APP_URL` = `https://offres.jardin-confort.ch`
- `NEXT_PUBLIC_SUPABASE_URL`
- `MAKE_WEBHOOK_VALIDATION_URL` = `https://hook.eu1.make.com/tqqhnrzkcwfhybguktd75drtmqv9ah49`

### Identifiants Shopify clés
- **Admin slug** : `le-meuble` (NOT `jardinconfort`)
- **URL admin commande** : `https://admin.shopify.com/store/le-meuble/orders/{legacy_id}`
- **Location ID** : `gid://shopify/Location/43228233863`

### Order Printer Pro Templates (URLs avec multiplicateurs sécurité)
| Template | ID | Multiplicateur |
|---|---|---|
| Fiche travail | `489824f8d4293a5ce7ed` | × 8779 |
| Bulletin livraison | `257da9a09628d859ee52` | × 4573 |
| Facture | `6ef74d9fb332bb591537` | × 3849 |

URL pattern : `https://www.jardin-confort.ch/apps/download-pdf/orders/{templateId}/{legacy_id*multiplier}/{handle}.pdf`

### Infos entreprise
- **Jardin-Confort SA**
- Route de Lavaux 425 · 1095 Lutry · Suisse
- Tél. : +41 21 791 36 71
- TVA : CHE-100.142.327 (Swiss VAT 2024 = 8.1%)
- IBAN : CH72 0076 7000 K033 3796 5 (BCV)

### Salespeople actuels
Brice Chappé · Alejandro Gallegos · Fabian Coquoz · Michel Gédéon · Sabrina Striberni · Team Jardin-Confort · Thierry Stricker

---

## 🗄️ Schemas Supabase clés

### Table `offres` (67 colonnes)
- **PK** : `id`
- **Slug unique** : `slug`
- **Type** : `type_document` (`Offre` | `Commande`)
- **Numérotation** :
  - `numero_offre` : `DEV-XXXXX`
  - `numero_commande` : `CMD-XXXXX`
  - `numero_affiche` : visible sur les documents
  - `offre_origine` : numéro de l'offre source si commande convertie
- **Statut** : `En cours` | `Envoyée` | `Convertie` | `Acceptée` | `Abandonnée` | `Refusée`
- **Données du formulaire** : `data` JSONB (contient lines, services, adresses, etc.)
- **PDFs** : `pdf_url`, `qr_url`, `fiche_travail_pdf_url`, `fiche_travail_initial_url`
- ⚠️ **Pas de `client_id`** — liaison via `client_numero_client` + email fallback + nom+npa

### Table `clients` (18 878 lignes)
- Sources : manuels + WinBiz + Shopify CSV
- `numero_client` : `CL-XXXXX`
- `>50%` n'ont pas d'email

### Table `factures_winbiz` (1 520 lignes)
- A `client_id` (figé à l'import WinBiz)

### Table `commandes_shopify` (10 244 lignes — Jan 2021 → Mai 2026)
- `shopify_order_id` UNIQUE
- `raw_data` JSONB (payload complet)
- 96.7% PAID · 150 annulées
- CHF 3 229 839 CA payé total
- **0 orphelines** (rattrapage SQL effectué)

### Table `shopify_sync_log`
- Logs des syncs Shopify (durée, nb commandes, erreurs)

### Table `stock_movements`
- Logs des décrémentations Shopify

### Table `notifications`
- Notifications dashboard

### Table `make_pings`
- Logs des appels webhook Make

---

## ✅ Fonctionnalités déjà implémentées

### 🔄 Système de stock & validation
- Stock movement system avec OAuth Client Credentials Flow
- Scope `write_inventory`
- `@idempotent` directive
- Sequenced PDFs **avant** Shopify decrement (sécurité)
- Overlay de chargement rassurant pendant la validation
- Stock + délai de livraison sur PDF commande
- **Internal vs Client conversion** : skip Make webhook si `internal: true`

### 📋 Documents générés
- PDF offre (preview + officiel)
- PDF commande
- QR paiement Suisse (TWINT/QR-bill)
- Fiche de travail (initiale figée + actuelle)
- 3 boutons PDF Order Printer Pro sur fiche client (fiche travail, bulletin livraison, facture)

### 🛒 Sync Shopify orders (10 244 commandes)
- Architecture chunked + bulk upsert + cache clients
- 21 chunks × ~20s = ~7 min total
- `lib/shopify-orders.ts` : OAuth autonome + cache Map by email/phone/nomNpa
- `app/api/shopify/sync-orders/route.ts` : POST chunked maxDuration 60
- `maxOrders: 500`, `pageSize: 50`, `timeoutMs: 50000`

### 🎯 Dashboard
- Filtre "Masquer abandonnées/refusées" persistant (localStorage)
- Filtres probabilité (forte/moyenne/faible/neutre)
- Lien "Mouvements de stock" violet
- Affichage commandes Shopify sur fiche client
- CA Shopify card

### 📦 Mode livraison
- Champ obligatoire (pas de valeur par défaut)
- Options : `Livraison à domicile` | `À l'emporter`
- Si "À l'emporter" :
  - Section adresse de livraison **cachée** dans le formulaire
  - Bandeau orange visible sur tous les PDFs
  - Adresse remplacée par "Jardin-Confort SA, Lutry"
  - Badge "À L'EMPORTER" sur fiche de travail (sans adresse perso client)

### 🏢 Champ "Accès livraison / étage"
- Caché si "À l'emporter"
- Code couleur fiche de travail :
  - 🟡 Jaune = remarques commerciales
  - 🟣 Violet = info logistique livreurs
  - 🟢 Vert = signature client
  - 🔵 Bleu = bandeau interne

### ✨ UX inputs formulaire
- Select-on-focus pour : qty, prix ligne, prix services, validité, service custom
- Téléphone international accepté
- Documents column avec smart matching (DocBadges)

### 🛡️ Sécurité commandes directes
- `isCommandeDirecte = type_document === "Commande" && !offre_origine`
- **Dashboard** : bouton "Page client" + section "Aperçu" cachés
- **Page client `/offre/[slug]`** : titre dynamique + bloc vert "Cette commande est confirmée" au lieu du formulaire signature
- Bouton "Accepter & signer" caché dans la sidebar

### 💰 Prix services (à jour)
| Service | Prix |
|---|---|
| Frais de montage | 0 |
| Livraison La Poste | 9 |
| Livraison franco trottoir | 59 |
| Livraison étage et déballage | 79 |
| Livraison étage, déballage et montage | 119 |
| Reprise et recyclage | 0 |

---

## 📂 Fichiers clés du projet

### Frontend
- `app/offres/nouveau/page.tsx` — Formulaire de création offre/commande
- `app/offre/[slug]/page.tsx` — Page client de validation
- `app/dashboard/page.tsx` — Dashboard liste
- `app/dashboard/[slug]/page.tsx` — Fiche détaillée offre/commande
- `app/dashboard/clients/page.tsx` — Liste clients
- `app/dashboard/clients/[id]/page.tsx` — Fiche client
- `app/dashboard/stock-movements/page.tsx` — Vue mouvements de stock

### Templates print (PDF)
- `app/print/offre/page.tsx` — Preview PDF
- `app/print/offre/[slug]/page.tsx` — PDF officiel
- `app/print/fiche-travail/[slug]/page.tsx` — Fiche de travail interne

### API routes clés
- `app/api/offres/[slug]/valider/route.ts` — Validation offre + webhook Make
- `app/api/offres/[slug]/pdf/route.ts` — Génération PDF
- `app/api/offres/[slug]/qr/route.ts` — Génération QR paiement
- `app/api/offres/[slug]/fiche-travail-pdf/route.ts` — Fiche de travail
- `app/api/shopify/sync-orders/route.ts` — Sync Shopify chunked

### Libraries
- `lib/shopify-orders.ts` — Sync Shopify (OAuth + bulk upsert + cache)
- `lib/shopify-stock.ts` — Décrémentation stock
- `lib/shopify-pdf-urls.ts` — URLs Order Printer Pro
- `lib/jc-print-types.ts` — Types partagés PrintData
- `lib/supabase.ts` — Clients Supabase
- `lib/notifications.ts` — Création notifications

---

## ⚙️ Workflow git habituel (PowerShell)

```powershell
cd C:\Users\ezefi\jardin-confort-formulaire
git add .
git commit -m "<descriptive message>"
git push
```

⚠️ **Notes PowerShell** :
- Toujours utiliser `git add .` (pas `git add <list>` pour éviter les soucis avec `[slug]`)
- Pour les chemins avec `[slug]` : utiliser `-LiteralPath`
- Encodage : les accents français peuvent casser `Select-String -Pattern "Récap..."` → utiliser `Select-Object -Skip N -First M` avec numéros de ligne

---

## 🐛 Bugs connus à fixer plus tard

### Bulk insert pending clients fails on duplicate email
- **Symptôme** : ~0.17% des commandes Shopify créent des doublons clients
- **Workaround actuel** : SQL cleanup post-sync
- **Fix futur** : dedupe `pendingClients` by lowercase email avant insert dans `lib/shopify-orders.ts`

---

## 📋 TODO / Prochaines sessions

### 🎯 Priorité 1 — Signature client (Storage + Make + Dashboard) — Option D
**Plan détaillé** :
1. **Setup bucket Supabase Storage** `signatures` (public, max 1 MB, image/png)
2. **Modifier `app/api/offres/[slug]/valider/route.ts`** :
   - Convertir `signature_base64` → Buffer → upload Storage
   - Récupérer `getPublicUrl` → ajouter `signature_url` au `update DB`
   - Ajouter `signature_url` au `webhookPayload` Make
3. **Affichage signature dans dashboard** sur fiche commande validée

### 🎯 Priorité 2 — Webhooks Shopify orders (automatique)
- Pour automatiser l'arrivée des nouvelles commandes Shopify (au lieu du bouton sync manuel)
- Endpoint à créer : `app/api/shopify/webhook/orders/route.ts`
- Configurer dans Shopify Admin : Settings → Notifications → Webhooks

### 🎯 Priorité 3 — Améliorations diverses
- Dedup emails dans bulk insert (cf. bug connu)
- Améliorer recherche clients (fuzzy matching nom+npa)
- Stats CA mensuel par commercial sur dashboard

---

## 🔐 Secrets sensibles (NE PAS committer)

```
MAKE_WEBHOOK_API_KEY = "jc_validation_2026_K9mP4xT7qL2vN8aR5wF1"
```

---

## 📅 Historique des sessions

### Session du 5-6 mai 2026 (~22h00 → 1h30) — 7h30 de dev
**Réalisations majeures** :
- ✅ Sync Shopify chunked complet (10 244 commandes importées)
- ✅ Cleanup test data (73 offres supprimées)
- ✅ Boutons PDF Order Printer Pro sur fiche client
- ✅ Mode livraison "À l'emporter" obligatoire avec gestion sur tous documents
- ✅ Champ "Accès livraison / étage" sur tous les documents
- ✅ Filtre "Masquer abandonnées" persistant
- ✅ Blocage validation pour commandes directes (côté client + dashboard)
- ✅ 3 fixes visuels page client (point manquant, spacing services, radius TOTAL TTC)
- ✅ Prix services mis à jour (9, 59, 79, 119)
- ✅ UX select-on-focus
- ✅ Bloc validation placeholder sur preview offre

---

## 💡 Comment utiliser ce JOURNAL

Quand tu démarres un nouveau chat Claude :

1. **Au début du chat**, colle ce message :
   ```
   Je continue le projet jardin-confort-formulaire.
   Voici le contenu de mon JOURNAL.md à la racine du projet :
   [colle le contenu de ce fichier]
   
   Aujourd'hui je veux faire :
   - [TON OBJECTIF]
   ```

2. **À la fin de chaque session importante**, demande à Claude :
   > "Mets à jour mon JOURNAL.md avec ce qu'on a fait aujourd'hui"

3. **Garde ce fichier versionné** dans ton repo git pour ne jamais le perdre.

---

### Session du 6 mai 2026 (suite) — Recherche multi-source + Badges Documents fiables
**Réalisations** :
- ✅ Recherche dashboard clients étendue à : DEV-XXXXX, CMD-XXXXX, n° facture WinBiz, n° commande Shopify (#65351, JAR12345, 152034 — tolère tous les préfixes historiques #, JAR, 6, 1)
- ✅ Détection automatique du type de query par regex en tête de `searchByDocumentNumber()`
- ✅ Fallback intelligent vers recherche classique si pas de match document
- ✅ Cohérence badges Documents avec fiche client : email matching en `ilike` (case-insensitive)
- ✅ Triple voie de matching offres : numero_client + email + fallback nom+npa
- ✅ Toutes les offres comptent dans les badges (statuts Refusée/Abandonnée inclus)
- ✅ Batches `.in()` parallélisés (Promise.all) avec taille 200 max + error logging Vercel
- ✅ Limite affichage liste : 100 résultats récents par défaut (vs 1000 avant) — cohérent avec 18 890 clients en base et croissant

**Bug racine identifié** :
- Les `.in()` Supabase de >500 IDs étaient silencieusement tronqués/échoués
- Cause manifeste : limite URL/PostgREST sur les querystrings longs
- Fix appliqué : chunks de 200 + parallélisation + `console.error` sur erreurs

**Fichiers modifiés** :
- `app/api/clients/route.ts` — recherche multi-source + `enrichWithCounts` robuste
- `app/dashboard/clients/page.tsx` — limit 100 + texte du compteur clarifié


### Session du 6 mai 2026 (suite) — Nouveaux templates print
- ✅ Bulletin de livraison sans prix : `/print/bulletin-livraison/[slug]`
  - Copie du template Commande sans prix/totaux/TVA/signature
  - Services listés sans prix
  - Bloc vert "Merci pour vos achats !" + message livraison partielle
- ✅ Page de garde colis : `/print/page-garde-colis/[slug]`
  - Logo Jardin-Confort vertical à gauche
  - Adresse client en grand à droite (style enveloppe)
  - Infos commande minimales (N°, date, expédition)
  - Sans QR ni code-barres (différent du Order Printer Pro Shopify)
- Uniquement pour les commandes internes CMD-XXXXX

### Session du 9 mai 2026 (~21h00 → 1h00) — Lignes média (logos / images)

**Réalisations majeures** :
- ✅ Nouvelle bibliothèque de logos de marques avec recherche fuzzy (cane, cane-line, caneline → tous matchent)
- ✅ Upload de logo "à la volée" pour images uniques non bibliothèquées
- ✅ 3 tailles d'affichage (Small 30px / Medium 50px / Large 80px, hauteur fixe largeur auto)
- ✅ Page admin `/dashboard/brand-logos` avec thème sombre cohérent
- ✅ Intégration dans le formulaire d'offre : bouton "🖼️ Logo / Image" dans la barre des lignes
- ✅ Rendu propre dans tous les templates print (preview, PDF officiel, fiche travail, bulletin livraison, page groupée /print/all)
- ✅ Saut de page contrôlé : bloc signature et totaux insécables (`page-break-inside: avoid`)
- ✅ UX fiche de travail : titre en casse normale, numéro de commande dans bandeau bleu, ronds Rès/cdé réduits

#### 🗄️ Setup Supabase

- **Bucket Storage** `brand-logos` — public, max 2 MB, MIME `image/*`
- **Table** `brand_logos` :
  - `id` UUID PK
  - `name` TEXT (ex: "Cane-line")
  - `slug` TEXT UNIQUE (ex: "cane-line")
  - `search_terms` TEXT[] avec index GIN (alias auto-générés depuis nom + variantes sans tirets)
  - `image_url` TEXT (URL publique Supabase Storage)
  - `created_at` TIMESTAMPTZ
- **Indexes** : `brand_logos_slug_idx`, `brand_logos_search_terms_idx` (GIN)
- **Variable Vercel ajoutée** : `SUPABASE_SERVICE_ROLE_KEY` (clé secrète, jamais commitée)

#### 📂 Nouveaux fichiers

- `lib/media-line-types.ts` — Types `MediaSize`, `MediaLine`, `BrandLogo` + helper `normalizeSearchTerm()` (lowercase + retrait accents/tirets/espaces pour fuzzy match)
- `app/api/brand-logos/route.ts` — `GET ?q=...` recherche fuzzy ou liste complète
- `app/api/brand-logos/upload/route.ts` — `POST multipart` mode `library` (ajout DB+storage) ou `ephemeral` (upload temporaire) + `DELETE ?id=...`
- `app/dashboard/brand-logos/page.tsx` — Page admin upload/gestion bibliothèque
- `app/offres/nouveau/MediaLinePicker.tsx` — Composant React avec recherche live debounced + upload à la volée + sélecteur S/M/L

#### 🔧 Fichiers modifiés

- `lib/jc-print-types.ts` — Type `QuoteLine` étendu avec `"media"` + champs `mediaUrl`, `mediaSize`, `mediaSource`. `computeTotals()` exclut médias du `subTotal`.
- `app/offres/nouveau/page.tsx` — Bouton "🖼️ Logo / Image", branche de rendu pour `kind === "media"`, exclusion média du subtotal et compteur d'articles, CSS `.tr-media`/`.td-media-cell`
- `app/print/offre/page.tsx` — CSS `.tr-media` + `.media-small/medium/large` + branche rendu colSpan=5
- `app/print/offre/[slug]/page.tsx` — Idem + bloc signature et totaux insécables (`page-break-inside: avoid`)
- `app/print/fiche-travail/[slug]/page.tsx` — Type `QuoteLine` local étendu, exclusion média de `subTotal` + `totalQty`, CSS `.tr-media` (avec barre violette à gauche pour distinguer des commentaires en bleu), branche rendu colSpan=7. Titre en casse normale, numéro dans bandeau, ronds Rès/cdé réduits 16→11px.
- `app/print/bulletin-livraison/[slug]/page.tsx` — CSS + branche rendu colSpan=3
- `app/print/all/[slug]/page.tsx` — Patches identiques sur les 3 templates internes (`.ft-`, `.cc-`, `.bl-`), totaux et signature insécables, mêmes ajustements UX que la fiche-travail standalone

#### 🎨 Logique de la recherche fuzzy

`normalizeSearchTerm("Cane-line")` → `"caneline"`. Le serveur compare avec `.includes()` sur le nom, slug et chaque `search_term` du logo, tous normalisés. Donc "cane", "Cane Line", "caneline", "cane-line" → tous matchent "Cane-line".

À l'upload mode `library`, des termes auto sont générés : nom complet normalisé + chaque mot ≥ 3 caractères. L'utilisateur peut en plus ajouter des alias custom en CSV.

#### 🐛 Pièges rencontrés

- **Confusion policy SQL bucket Storage** : avec toggle "Public bucket" activé, la policy SELECT est automatique. Pas besoin du SQL `create policy "Public read brand-logos"`.
- **Build Vercel coincé** sur un deployment "Initializing" pendant 5+ min — résolu via Cancel + commit vide pour forcer rebuild
- **Doublon `const isCustom`** dans `print/all/[slug]/page.tsx` après application du patch (Find & Replace mal calé) — corrigé en supprimant la ligne dupliquée
- **Cache PDF Supabase Storage** : les PDFs déjà générés ne reflètent pas les nouveaux templates tant qu'on ne régénère pas via `POST /api/offres/{slug}/pdf`

#### 💡 Patterns réutilisables pour la suite

- **Page-break-inside: avoid** pour tout bloc qu'on veut garder entier sur une page (signatures, totaux, encadrés importants)
- **Fuzzy search côté serveur** sans pg_trgm : `normalizeSearchTerm()` + filtrage JavaScript suffit pour tables < 200 lignes
- **Mode dual upload** : library (réutilisable) vs ephemeral (one-shot) — pattern utile pour autres types de médias futurs




### Session du 9 mai 2026 (suite) — Cards "Chiffre du jour/mois" + RPC stats

**Réalisations** :
- ✅ RPC SQL Supabase `stats_commandes_periode(date_from, date_to)` 
  - Filtre : `type_document = 'Commande'` (exclut offres acceptées pour éviter doublon)
  - Statut filtré : exclut Refusée/Abandonnée
  - Source montant : `o.total_ttc` (figé par computeTotals côté Next, source de vérité)
  - Source quantité : `o.nb_articles`
  - Groupement par commercial avec fallback "Non assigne"
- ✅ API route `/api/stats/summary` avec param `period` : today | month | year | exercice | custom
  - `exercice` calcule l'exercice comptable suisse 1.10 → 30.09 en cours
- ✅ Composant `<StatsCards />` dark theme
  - 2 mini-cards compactes calées en hauteur sur les 2 lignes de filtres (quick + probabilité)
  - Format CHF suisse uniforme : CHF 11'743.00
  - Top 3 commerciaux affichés avec barres de progression sky/emerald
  - "+ N autres" agrégé pour le reste
  - Lien latéral vers /dashboard/statistiques
- ✅ Placeholder `/dashboard/statistiques` pour livraison 2

**Pièges rencontrés** :
- v1 RPC : `value::TEXT::NUMERIC` sur jsonb_each → erreur "invalid input syntax for type numeric '\"9\"'" car les guillemets JSON étaient gardés. Fix : `jsonb_each_text` + `NULLIF(x, '')::NUMERIC`.
- v2 RPC : commentaires accentués + délimiteur `$$` cassaient le parser de Supabase Dashboard. Fix : `$func$` + zéro commentaire SQL.
- v2 RPC : recalculait le total à partir du JSONB → divergeait du `total_ttc` fi




# 📓 JOURNAL — Session du 9 mai 2026

## 🎯 Objectifs de la session

Grosse session axée sur la **fiabilité juridique** et la **clarté métier** :

1. ✅ Fix d'impression de la fiche bleue (margins A4)
2. ✅ Stats cards "Chiffre du jour / mois" sur le dashboard
3. ✅ **Figement du stock J0 pour les commandes** (preuve juridique)
4. ✅ Avertissement avant régénération fiche de travail "actuelle"
5. ✅ Bandeau date sur l'aperçu PDF de commande
6. ✅ **Page web dynamique** pour les offres (au lieu de PDF)
7. ✅ **Affichage stock affiné** : "Stock partiel (X/Y)" + délai dynamique depuis tags Shopify

---

## 1. 🖨️ Fix impression fiche bleue (page 5 du jeu d'archive)

### Problème
La page 5 (fiche bleue d'archive) sortait avec des marges incohérentes par rapport aux 4 autres pages lors de l'impression du jeu complet via `/print/all/[slug]`.

### Solution appliquée
**`app/print/all/[slug]/page.tsx`** :
- Ajout d'une règle `@page` nommée pour la fiche bleue : `@page fb-archive { size: A4 portrait; margin: 0; }`
- `.fb-page-wrap` utilise maintenant `page: fb-archive` + `width: 210mm; height: 297mm`
- Retrait de la classe `doc-wrap-all` du wrapper page 5 pour éviter le padding global
- Les 4 autres pages conservent `@page { margin: 14mm 16mm 14mm 14mm; }`

### Statut
✅ Pushé. Test papier validé.

---

## 2. 📊 Stats cards "Chiffre du jour / mois" sur le dashboard

### Décision métier
- Filtrage strict : `type_document = 'Commande'` uniquement
- Exclusion des offres "Acceptée" (évite double comptage)
- Exclusion des statuts `Refusée` / `Abandonnée`
- Pas de Shopify pour le moment (à intégrer plus tard via webhooks automatiques)

### Architecture technique

**Supabase RPC `stats_commandes_periode(date_from, date_to)` (v3 finale)**
- Source de vérité : `o.total_ttc` et `o.nb_articles` directement (pas de recalcul JSONB)
- Group by `commercial` avec fallback `'Non assigne'` (frontend convertit en `— Non assigné`)
- Calcul exercice comptable suisse (1.10 → 30.09) : `startYear = month >= 9 ? year : year-1`

**Itérations**
- v1 / v2 : bugs de cast jsonb_each + dollar-quote parsing + divergence avec `discountPercent` sur 2 commandes (CMD-80540 +196.02 CHF, CMD-80542 +403.92 CHF)
- v3 : alignement parfait avec le KPI dashboard (CHF 18'025.00)
- ⚠️ Rappel : éviter SQL avec accents français dans Supabase Dashboard, utiliser `$func$` au lieu de `$$` pour les delimiters

### Fichiers créés/modifiés

| Fichier | Rôle |
|---|---|
| `app/api/stats/summary/route.ts` | API endpoint (params: `period=today\|month\|year\|exercice\|custom`, `from`, `to`) |
| `app/dashboard/StatsCards.tsx` | Composant 2 mini-cards horizontales (sky-500 jour, emerald-500 mois) |
| `app/dashboard/statistiques/page.tsx` | Placeholder pour stats v2 (panier moyen, line chart, comparatif exercices, top 20 SKUs) |
| `app/dashboard/page.tsx` | Intégration : flex parent avec quick-filters à gauche + StatsCards à droite |

### Format CHF
```ts
"CHF\u00a0" + Intl.NumberFormat("de-CH", { 
  minimumFractionDigits: 2, 
  maximumFractionDigits: 2 
}).format(n)
// → "CHF 11'743.00"
```

### Statut
✅ Pushé. À enrichir lors de la **Livraison 2** : page `/dashboard/statistiques` complète.

---

## 3. 🔒 CRITIQUE — Figement du stock J0 pour les commandes

### Problème métier identifié
Avant ce fix, les pages `/print/*` d'une commande affichaient le stock Shopify **LIVE** au lieu du stock vu par le client à la commande. Risque légal majeur sur les documents imprimés plus tard (jeu de 5 pages, fiche bleue, etc.).

### Architecture du système avant fix

```
┌──────────────────────────────────────────────────────────────────┐
│ CONVERSION OFFRE → COMMANDE                                      │
│ ✅ Génère PDFs figés (T+0) AVANT décrémentation Shopify         │
│ ❌ Mais data.lines[].stock n'est jamais figé en base            │
├──────────────────────────────────────────────────────────────────┤
│ AFFICHAGE PAGE /print/* (ouverte plus tard)                      │
│ ❌ /api/offres/[slug] fait toujours refreshStock() Shopify      │
│ ❌ Stock affiché = stock du jour, PAS J0                        │
└──────────────────────────────────────────────────────────────────┘
```

### Solution appliquée — Option A (Single Source of Truth)

**Principe** : figer le stock dans `data.lines[].stock` à la conversion. Une seule source de vérité.
- Pour les **commandes** : `data` est figé pour toujours, l'API ne refresh PAS
- Pour les **offres** : `data` est complété en live par `refreshStock()` à chaque appel

### Modif 1 — `app/api/offres/[slug]/valider/route.ts`

Avant la création de `cmdRow`, on appelle l'API GET de l'offre originale (qui fait `refreshStock()` Shopify) et on extrait les lines avec stock à jour :

```tsx
// 🔒 FIGER LE STOCK AU MOMENT DE LA CONVERSION
let frozenLines = (offre.data as { lines?: unknown[] })?.lines || [];
let stockFreezeOk = false;
try {
  const refreshRes = await fetch(`${BASE_URL}/api/offres/${slug}`, { cache: "no-store" });
  if (refreshRes.ok) {
    const refreshJson = await refreshRes.json();
    const refreshedLines = refreshJson?.offre?.data?.lines;
    if (Array.isArray(refreshedLines) && refreshedLines.length > 0) {
      frozenLines = refreshedLines;
      stockFreezeOk = true;
      console.log("[valider] Stock figé pour", refreshedLines.length, "lignes");
    }
  }
} catch (e) {
  console.error("[valider] Stock freeze fail (using offer stock):", e);
}
```

Et injection dans `cmdRow.data` :
```tsx
data: {
  ...(offre.data as Record<string, unknown>),
  lines: frozenLines,                                              // 🔒 Stock figé
  formType: "Commande",
  // ...
  stock_frozen_at: stockFreezeOk ? new Date().toISOString() : null, // Audit
}
```

### Modif 2 — `app/api/offres/[slug]/route.ts` (GET)

```tsx
const dataLines = (offre.data as { lines?: ... })?.lines ?? [];
const isCommande = offre.type_document === "Commande";
const stockFrozen = isCommande && (offre.data as ...)?.stock_frozen_at;

const freshLines = isCommande
  ? dataLines                              // 🔒 Stock figé J0
  : await refreshStock(dataLines);         // 🔄 Stock live pour les offres
```

Et enrichissement du return :
```tsx
return NextResponse.json({
  offre: {
    ...offre,
    data: freshData,
    isSnapshot: false,
    stockFrozen: !!stockFrozen,
    stockFrozenAt: stockFrozen || null,
    stockRefreshedAt: isCommande ? null : new Date().toISOString(),
    numero_client: numeroClient,
  },
});
```

### Décisions métier

- ✅ **Pas de migration** des commandes existantes (acceptable : elles afficheront le stock du dernier `freshData` enregistré)
- ✅ **Architecture polyvalente** : aucune modif des pages `/print/*` nécessaire (elles passent par l'API qui retourne déjà le bon stock selon le `type_document`)
- ✅ **Robustesse** : fallback sur stock offre en cas d'échec Shopify
- ⏱️ **Fenêtre critique** ~11s entre lecture stock et décrémentation Shopify (acceptable vu volume ~5 cmd/jour)

### Audit SQL

```sql
SELECT 
  numero_affiche, 
  type_document,
  data->>'stock_frozen_at' AS stock_frozen_at,
  jsonb_path_query_array(data->'lines', '$[*].stock') AS stocks_figes
FROM offres
WHERE type_document = 'Commande'
ORDER BY created_at DESC
LIMIT 5;
```

### Statut
✅ Pushé. Tests OK : stock ne bouge plus après modif Shopify post-commande.

---

## 4. ⚠️ Avertissement avant régénération fiche de travail "actuelle"

### Problème métier
Risque qu'un commercial régénère par erreur la fiche initiale et écrase mentalement la "preuve" stock J0.

### Solution
**`app/dashboard/[slug]/page.tsx`** : ajout d'un `confirm()` strict avant le mode `current` :

```tsx
if (mode === "current") {
  const confirmed = confirm(
    "⚠️ ATTENTION — Fiche de travail ACTUELLE\n\n" +
    "Le nouveau document généré affichera le STOCK DU JOUR — donc " +
    "potentiellement différent de celui vu par le client au moment de la commande.\n\n" +
    "👉 Cette version sert pour la préparation et la livraison.\n\n" +
    "🔵 Pour conserver la preuve juridique du stock vendu, utilisez la " +
    "fiche INITIALE (figée à la commande), qui reste intacte.\n\n" +
    "Confirmer la génération avec le stock actuel ?"
  );
  if (!confirmed) return;
}
```

Bouton "Régénérer fiche actuelle" passé en couleur **amber** (au lieu d'emerald) pour le distinguer visuellement de la fiche initiale (verte/bleue).

### Statut
✅ Pushé.

---

## 5. 📅 Bandeau date sur l'aperçu PDF de commande

### Solution
Ajout d'un bandeau bleu identique à celui de la fiche initiale, au-dessus de l'iframe PDF de commande dans `/dashboard/[slug]` :

```tsx
{!isTypeOffre && offre.created_at && (
  <div className="mb-3 text-xs text-blue-300/80 bg-blue-500/5 border border-blue-500/20 rounded-lg px-3 py-2">
    🔵 Stock figé à la commande · {new Date(offre.created_at).toLocaleString("fr-CH")}
  </div>
)}
```

Source de la date : `offre.created_at` (timestamp PostgreSQL de création, précis à la seconde).

### Statut
✅ Pushé.

---

## 6. 🔄 Page web dynamique pour les offres (au lieu de PDF)

### Changement de logique métier

**Décision finale** :
- 📄 **PDF d'offre** : cache le stock (ne deviendra pas obsolète une fois figé)
- 🌐 **Page web d'offre** : affiche le stock LIVE Shopify (utile au client qui consulte le lien)
- 🔒 **PDF de commande** : affiche le stock figé J0 (déjà OK avant)
- 🌐 **Page web de commande** : affiche le stock figé J0 (grâce au fix #3)

### Stratégie technique : query param `?nostock=1`

**Modif A — `app/print/offre/[slug]/page.tsx`** :
- Ajout de l'import `useSearchParams`
- Lecture du param : `const hideStock = searchParams.get("nostock") === "1"`
- Condition d'affichage : `{!hideStock && (...)}` au lieu de `{data.formType === "Commande" && (...)}`

**Modif B — `app/api/offres/[slug]/pdf/route.ts`** :
```tsx
const isOffre = offre.type_document === "Offre"
const printUrl = `${APP_URL}/print/offre/${slug}${isOffre ? "?nostock=1" : ""}`
```

→ Seul le PDF d'offre passe `?nostock=1` à pdf.co. La page web normale affiche tout.

### Tableau récapitulatif

| Document | Stock affiché ? | Source |
|---|---|---|
| **PDF offre** (figé après envoi) | ❌ Non | — |
| **Page offre print** `/print/offre/[slug]` | ✅ Live Shopify | `refreshStock()` |
| **Page validation client** `/offre/[slug]` | ✅ Live Shopify | `refreshStock()` |
| **Page commande print** `/print/offre/cmd-XXX` | ✅ Figé J0 | `data.lines[].stock` |
| **PDF commande** | ✅ Figé J0 | `data.lines[].stock` |
| **Fiche travail initiale** (PDF) | ✅ Figé J0 | Généré à T+0 |
| **Fiche travail "actuelle"** (PDF, à la demande) | 🔄 Live au moment de la régen | Bordereau prépa |
| **Fiche bleue** (page 5 archive) | ✅ Figé J0 si commande | `data.lines[].stock` |

### Statut
✅ Pushé. Permet d'envoyer un lien web au client (stock toujours à jour) au lieu d'un PDF d'offre.

---

## 7. 🟠 Affichage stock affiné : "Stock partiel (X/Y)" + délai dynamique

### Problème métier identifié

L'affichage actuel était **trompeur** :
- "Stock limité (1 pce)" pour une commande de 3 pces avec stock 1 → manque non indiqué
- "Sur commande" générique sans délai estimé

### Solution : 3 cas distincts

```ts
if (stock >= qty)        → "✓ En stock (X pces)"             vert
else if (stock > 0)      → "🟠 Stock partiel (X / Y pces)"     orange
else                     → "📦 [Délai estimé selon tags]"      orange
```

### Mapping tags Shopify → délai (cohérent avec template Liquid Order Printer Pro)

| Tag | Label affiché |
|---|---|
| `1week` | 1–2 semaines |
| `2weeks` | 2–3 semaines |
| `3weeks` | 3–4 semaines |
| `4weeks` | 4–5 semaines |
| `5weeks` | 5–6 semaines |
| `6weeks` | 6–8 semaines |
| `8weeks` | 8–10 semaines |
| `10weeks` | 10–12 semaines |
| (aucun) | Sur commande (fallback) |

### Modif 1 — `app/api/offres/[slug]/route.ts` `refreshStock()`

**Ajouts à la query GraphQL** :
```graphql
productVariants(first: 50, query: $query) {
  nodes {
    sku
    product {
      tags          # ← nouveau
    }
    inventoryItem { ... }
  }
}
```

**Helper `getDelayFromTags()`** + **`skuMap` enrichi** avec `{ stock, delay }` au lieu d'un simple `stockMap`.

**Enrichissement de chaque ligne** :
```ts
return {
  ...line,
  stock: fresh.stock < 1 ? "sur_commande" : fresh.stock,
  delaiLivraison: fresh.delay,  // 🚚 Délai estimé depuis tags Shopify
};
```

### Modif 2 — `app/print/offre/[slug]/page.tsx`

Remplacement de `isLow` (seuil hardcodé `<= 2`) par `isPartial` (comparaison à `qty`) :
```tsx
const isSC = line.stock === "sur_commande" || (sn !== null && sn < 1);
const isPartial = sn !== null && sn > 0 && sn < qty;
const isOk = sn !== null && sn >= qty;
```

### Modif 3 — `app/offre/[slug]/page.tsx` (page client)

Même logique appliquée pour cohérence visuelle entre la page print et la page validation client.

### Effet métier

| Cas | Avant | Après |
|---|---|---|
| Cdé 1 / Stock 35 | ✓ En stock (35 pces) | ✓ En stock (35 pces) |
| Cdé 3 / Stock 1 | ⚠ Stock limité (1 pce) ❌ | 🟠 **Stock partiel (1 / 3 pces)** ✅ |
| Cdé 5 / Stock 0 (tag `4weeks`) | 📦 Sur commande ❌ | 📦 **4–5 semaines** ✅ |
| Cdé 1 / Stock 1 | ⚠ Stock limité (1 pce) ❌ | ✓ **En stock (1 pce)** ✅ |
| Cdé 5 / Stock 4 | ✓ En stock (4 pces) ❌ | 🟠 **Stock partiel (4 / 5 pces)** ✅ |

### Statut
✅ Pushé. Cohérence avec le template Liquid Order Printer Pro maintenue.

---

## 📋 Règles métier consolidées (à garder en mémoire)

### Stock visible vs stock figé

| Contexte | Type doc | Affichage | Pourquoi |
|---|---|---|---|
| Aperçu dashboard | Offre | Page dynamique (live) | Aide commercial avant validation |
| Aperçu dashboard | Commande | PDF figé | Preuve stock J0 |
| `/print/offre/[slug]` (web) | Offre | Live Shopify | Lien à envoyer au client |
| `/print/offre/[slug]` (web) | Commande | Figé J0 | Cohérence avec PDFs |
| `/print/offre/[slug]?nostock=1` | Offre | Caché | PDF d'offre (deviendrait obsolète) |
| Fiche travail "initiale" | Commande | PDF figé J0 | **Preuve juridique** |
| Fiche travail "actuelle" | Commande | PDF live (à la régen) | Bordereau prépa/livraison |
| Fiche bleue (jeu d'archive) | Commande | Figé J0 | Cohérence archive papier |

### Règle générale
> Tout document associé à une commande qui **engage juridiquement** (fait foi du stock vu par le client) reste figé. Seule l'offre, **avant validation**, bénéficie de l'affichage dynamique parce qu'elle n'engage rien tant que le client ne l'a pas signée.

### Affichage stock — 3 cas
1. **Sur commande** (stock = 0 ou `"sur_commande"`) → délai depuis tags Shopify
2. **Stock partiel** (0 < stock < qty) → indique combien manque
3. **En stock** (stock ≥ qty) → couvre la commande

---

## 🚧 Pending (Livraisons futures)

### Livraison 2 — Stats avancées
- Page `/dashboard/statistiques` complète :
  - Tableau commercial filtré par période + panier moyen
  - Line chart 30/90/365j (Recharts)
  - Comparatif exercices N vs N-1
  - Top 20 SKUs par CA

### Optionnel — Modif 3 du dashboard
Iframe page dynamique pour les commandes (au lieu de PDF figé) maintenant que le stock est garanti figé côté API. Cosmétique, pas urgent.

### Tags Shopify
S'assurer que tous les produits "sur commande" ont les tags adéquats (`1week`, `2weeks`, etc.) dans Shopify Admin. Sinon le fallback "Sur commande" générique s'applique (sûr mais moins informatif).

### Tests à faire
- [x] Test papier fiche bleue (validé)
- [x] Test stock figé J0 sur nouvelle commande (validé)
- [ ] Audit SQL régulier des nouvelles commandes (vérifier que `stock_frozen_at` est bien rempli)
- [ ] Vérifier les commandes existantes affichent un stock cohérent (à auditer ponctuellement)

---

## 🛠️ Commandes utiles (rappel)

### PowerShell
```powershell
# Crochets [slug] dans les paths : utiliser -LiteralPath
Get-Content -LiteralPath "app\api\offres\[slug]\route.ts"

# Recherche dans dossier avec crochets : Get-ChildItem -Recurse contourne le souci
Get-ChildItem -Path "app\print\offre" -Recurse -Filter "page.tsx" | Select-String -Pattern '...'
```

### Push standard
```powershell
cd C:\Users\ezefi\jardin-confort-formulaire
git add .
git commit -m "..."
git push
```

### SQL — vérification stock figé
```sql
SELECT 
  numero_affiche, 
  type_document,
  data->>'stock_frozen_at' AS stock_frozen_at,
  jsonb_path_query_array(data->'lines', '$[*].stock') AS stocks_figes
FROM offres
WHERE type_document = 'Commande'
ORDER BY created_at DESC
LIMIT 5;
```

### Logs Vercel à surveiller
- `[valider] Stock figé pour X lignes` → succès du figement
- `[valider] Stock freeze fail (using offer stock)` → fallback sur stock offre
- `[after] Stock movements err` → erreur décrémentation Shopify post-commande

---

## ✅ Résumé en 1 phrase

Cette session a sécurisé la **chaîne juridique de la commande** (figement stock J0 partout) tout en améliorant la **clarté métier** (affichage "partiel" + délai dynamique) et l'**ergonomie commerciale** (page web dynamique pour les offres, stats temps réel).

---

*Journal généré le 9 mai 2026 — sauvegarder dans `JOURNAL.md` à la racine du projet.*

*Dernière mise à jour : 9 mai 2026, 2h00 du matin (CET)* 🌙