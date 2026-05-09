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

*Dernière mise à jour : 9 mai 2026, 2h00 du matin (CET)* 🌙