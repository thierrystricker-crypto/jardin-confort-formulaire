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
- `SUPABASE_SERVICE_ROLE_KEY` (clé secrète, jamais commitée)

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

### Exercices comptables
**Du 1er octobre au 30 septembre** (chevauche les années civiles)
- Exercice 2024 : 1.10.2023 → 30.09.2024
- Exercice 2025 : 1.10.2024 → 30.09.2025
- Exercice 2026 : 1.10.2025 → 30.09.2026

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

### Table `clients` (~22 000 lignes au 9 mai 2026)
**Schéma complet** :
| Colonne | Type | Notes |
|---|---|---|
| `id` | bigint | PK |
| `numero_client` | text | Format `CL-XXXXX` |
| `nom` | text NOT NULL | |
| `prenom` | text | |
| `societe` | text | |
| `email` | text | |
| `tel1`, `tel2` | text | |
| `rue`, `numero_rue`, `rue2` | text | |
| `npa`, `ville`, `pays` | text | `pays` = code ISO (CH, FR, etc.) |
| `notes` | text | |
| `source` | text | `shopify` \| `winbiz` \| `offre` \| `manuel` |
| `created_at`, `updated_at` | timestamptz | |
| `livr_*` (10 colonnes) | text | Adresse de livraison alternative |

**Répartition par source au 9 mai 2026** :
- `shopify` : 10 630 (56%)
- `winbiz` : 8 256 (44%)
- `offre` : 9
- `manuel` : 6

**⚠️ Règle CRITIQUE — "ID bas = client Shopify enrichi"** (vérifiée empiriquement) :
- Les imports Shopify ont été faits **AVANT** les imports WinBiz → IDs bas = Shopify
- Lors de l'import WinBiz, fusion automatique si adresse identique
- Conséquence : pour un même client, l'**ID le plus bas** a souvent **email + tel** (origine Shopify enrichie de l'adresse postale WinBiz)
- En cas de doublon dû aux accents (ex. Engelhard Loic vs Loïc), prendre l'ID le plus bas

**Adresses partiellement écrasées par Shopify** : certaines adresses WinBiz "sales" (typos, formats divers) ont été remplacées par les versions Shopify "propres" lors de la fusion. Le matching par rue ne peut donc pas être strict — les adresses dans les PDFs WinBiz peuvent différer de l'adresse en base.

### Table `factures_winbiz` (~2 300 lignes au 10 mai 2026)
- **A `client_id`** (figé à l'import)
- `numero_facture` (TEXT) — **unique par construction WinBiz** (pas de doublons possibles côté source)
- `date_facture` (DATE)
- `nom_fichier` (TEXT) — nom brut du PDF
- `pdf_url` (TEXT) — URL Supabase Storage publique
- `montant` (NUMERIC)
- `match_auto` (BOOL) — true si match automatique, false si correction manuelle
- `match_confiance` (TEXT) — `"auto"` ou `"manuel"`

### Table `commandes_shopify` (10 244 lignes — Jan 2021 → Mai 2026)
- `shopify_order_id` UNIQUE
- `raw_data` JSONB (payload complet)
- 96.7% PAID · 150 annulées
- CHF 3 229 839 CA payé total
- **0 orphelines** (rattrapage SQL effectué)

### Table `shopify_sync_log`, `stock_movements`, `notifications`, `make_pings`, `brand_logos`
Voir sections dédiées plus bas.

### Bucket Storage Supabase `factures`
Structure : `factures/{exercice}/facture_{numeroFacture}_{clientId}.pdf`
- `factures/2024/` — exercice 2024 (721 factures importées)
- `factures/2025/` — exercice 2025 (importé fin avril 2026)
- `factures/2026/` — exercice 2026 en cours (premiers imports + 65 factures du 10 mai 2026)

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
- `app/print/bulletin-livraison/[slug]/page.tsx` — Bulletin de livraison sans prix
- `app/print/page-garde-colis/[slug]/page.tsx` — Page de garde pour colis

### API routes clés
- `app/api/offres/[slug]/valider/route.ts` — Validation offre + webhook Make
- `app/api/offres/[slug]/pdf/route.ts` — Génération PDF
- `app/api/offres/[slug]/qr/route.ts` — Génération QR paiement
- `app/api/offres/[slug]/fiche-travail-pdf/route.ts` — Fiche de travail
- `app/api/shopify/sync-orders/route.ts` — Sync Shopify chunked
- `app/api/stats/summary/route.ts` — Stats Chiffre du jour/mois

### Libraries
- `lib/shopify-orders.ts` — Sync Shopify (OAuth + bulk upsert + cache)
- `lib/shopify-stock.ts` — Décrémentation stock
- `lib/shopify-pdf-urls.ts` — URLs Order Printer Pro
- `lib/jc-print-types.ts` — Types partagés PrintData
- `lib/supabase.ts` — Clients Supabase
- `lib/notifications.ts` — Création notifications
- `lib/media-line-types.ts` — Types lignes média/logos

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

### Doublons clients identifiés au cours des imports factures
À fusionner manuellement un jour :
- Engelhard Loic (7173) / Loïc (16245)
- Demaurex Gaétan (4117) / Gaetan (15780)
- Grobéty (6700) / Grobety (17129)
- Iacobelli (8842) / Iacibelli (15732)
- Capobianco (14967) / Copobianco (15397)

Pattern de fusion :
1. Identifier le client_id à conserver (ID bas, src=shopify)
2. Mettre à jour toutes les FK qui pointent vers le doublon (`factures_winbiz.client_id`, etc.)
3. Supprimer le doublon

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

### 🎯 Priorité 3 — Page Stats v2 (`/dashboard/statistiques`)
- Tableau commercial filtré par période + panier moyen
- Line chart 30/90/365j (Recharts)
- Comparatif exercices N vs N-1
- Top 20 SKUs par CA

### 🎯 Priorité 4 — Améliorations diverses
- Dedup emails dans bulk insert (cf. bug connu)
- Améliorer recherche clients (fuzzy matching nom+npa)
- Stats CA mensuel par commercial sur dashboard
- Fusion des doublons clients (Engelhard, Demaurex, Grobéty, Iacobelli, Capobianco...)

### 🎯 Priorité 5 — Import incrémental clients WinBiz
Voir section dédiée plus bas — outil à créer pour rafraîchir périodiquement les adresses sans créer de doublons.

---

## 🔐 Secrets sensibles (NE PAS committer)

```
MAKE_WEBHOOK_API_KEY = "jc_validation_2026_K9mP4xT7qL2vN8aR5wF1"
SUPABASE_SERVICE_ROLE_KEY = (dans Vercel uniquement)
```

---

## 📅 Historique des sessions

### Session du 5-6 mai 2026 — Sync Shopify + Mode livraison + UX
- ✅ Sync Shopify chunked complet (10 244 commandes importées)
- ✅ Cleanup test data (73 offres supprimées)
- ✅ Boutons PDF Order Printer Pro sur fiche client
- ✅ Mode livraison "À l'emporter" obligatoire
- ✅ Champ "Accès livraison / étage"
- ✅ Filtre "Masquer abandonnées" persistant
- ✅ Blocage validation pour commandes directes
- ✅ Prix services mis à jour (9, 59, 79, 119)
- ✅ UX select-on-focus

### Session du 6 mai 2026 (suite) — Recherche multi-source + Templates print
- ✅ Recherche dashboard clients étendue à : DEV-XXXXX, CMD-XXXXX, n° facture WinBiz, n° commande Shopify
- ✅ Cohérence badges Documents avec fiche client
- ✅ Bulletin de livraison sans prix : `/print/bulletin-livraison/[slug]`
- ✅ Page de garde colis : `/print/page-garde-colis/[slug]`

### Session du 9 mai 2026 — Lignes média + Stats + Stock J0 + Garde-fou offres signées
- ✅ Bibliothèque de logos avec recherche fuzzy + upload à la volée
- ✅ Stats cards "Chiffre du jour/mois" sur le dashboard
- ✅ **Figement du stock J0** pour les commandes (preuve juridique)
- ✅ Avertissement avant régénération fiche de travail "actuelle"
- ✅ Bandeau date sur l'aperçu PDF de commande
- ✅ Page web dynamique pour les offres (au lieu de PDF)
- ✅ Affichage stock affiné : "Stock partiel (X/Y)" + délai dynamique
- ✅ Écran "déjà validée" sur lien d'offre signée
- ✅ Stock J0 + PDF + QR de la commande liée pour offres signées
- ✅ Migration `numero_commande` au niveau colonne (9 offres signées)
- ✅ Fix formule `numero_affiche` (respecte `type_document`)

### Session du 10 mai 2026 — Import factures WinBiz exercice 2026 (2e moitié)
- ✅ 65 factures du dossier `2026-2` importées (numéros 53706 à 80162)
- ✅ Score parfait : 65/65 (100%) en 0 erreur
- ✅ 1 client créé en base (Fondation Asile des Aveugles, CL-22088)
- ✅ Pipeline match → fix → import éprouvé et documenté
- ✅ Anti-doublon double niveau implémenté (match + import)
- ✅ Mode `--dry-run` ajouté pour simulation sécurisée
- 📖 Voir section dédiée **"Import factures WinBiz"** ci-dessous

---

# 📥 Import factures WinBiz — Documentation complète

> Cette section documente le système d'import des factures PDF WinBiz vers Supabase (Storage + table `factures_winbiz`). Elle est volontairement détaillée car le pipeline est ré-utilisé périodiquement (typiquement par exercice ou par batch).

## 🎯 Vue d'ensemble

**Objectif** : prendre des PDFs de factures WinBiz exportés sur Google Drive, les uploader dans Supabase Storage, et insérer les métadonnées (n° facture, date, montant, lien client) dans la table `factures_winbiz`.

**Volumétrie historique** :
- Exercice 2024 : 721 factures importées (mai 2026)
- Exercice 2025 : ~600 factures importées (fin avril 2026)
- Exercice 2026 : en cours, dont 65 factures du batch `2026-2` (10 mai 2026)

**Localisation des PDFs** : `G:\Mon Drive\Factures_winbiz\<dossier>\`

**Format des noms de fichier WinBiz** :
```
CLIENT-{civilité}  {NOM Prénom}  {Rue n°}  {NPA Ville}  codex  {champs supplémentaires}__FACTURE-{n°}__DATE-{DD.MM.YYYY}__TOTAL_CHF-{montant}.pdf
```
Séparateur principal : **double espace**. Métadonnées en suffixe : `__FACTURE-XXXXX__DATE-DD.MM.YYYY__TOTAL_CHF-X'XXX.XX`.

---

## 🔄 Pipeline en 3-4 étapes

### Étape 0 (optionnelle) — Création de clients manquants
Si tu sais déjà qu'un client n'est pas en base (ex. nouvelle entreprise non encore importée via Shopify ou WinBiz), il faut le créer avant le matching pour qu'il soit reconnu.

**Script type** : `creer-{nom-court}.js`

**Pattern** :
1. Vérifier qu'aucun client similaire n'existe (anti-doublon par société/nom)
2. Trouver le `numero_client` suivant disponible (`CL-XXXXX`)
3. INSERT dans `clients` avec `source: "winbiz"` (ou `"manuel"` selon le cas)
4. Retourner l'ID + une ligne JSON prête à coller dans le fix

**Exemples historiques** :
- `creer-leffondre.js` (Karl Leffondre, MENETREY SA, 2024) → CL-21937, ID 21939
- `creer-fondation-asile.js` (Fondation Asile des Aveugles, 2026-2) → CL-22088, ID 22089

### Étape 1 — Matching (lecture seule)
**Script** : `match-factures-{exercice}.js`

**Ce qu'il fait** :
1. Liste tous les PDFs du dossier source
2. Parse chaque nom de fichier (NPA, ville, rue, nom, n° facture, date, montant)
3. Pour chaque facture :
   - **Anti-doublon niveau 1** : check si `numero_facture` existe déjà dans `factures_winbiz` → catégorie `alreadyImported`
   - Recherche en cascade dans `clients` :
     - Tentative 1 : NPA + ville + rue strict
     - Tentative 2 : NPA + ville (fallback)
     - Tentative 3 (si 0 candidat ou >30 candidats sans nom matchant) : recherche par nom seul (cas adresse changée)
   - Scoring nom+prénom sur les candidats multiples → résolution auto si 1 seul score haut
   - En cas de tie : prendre l'**ID le plus bas** (= client Shopify enrichi)
4. Classe en : `matched` / `multiple` / `notFound` / `errors` / `alreadyImported`
5. Écrit `factures_results_{exercice}.json`

**Stratégies de match (output enrichi)** :
| Strategy | Signification |
|---|---|
| `unique` | 1 seul candidat sur l'adresse |
| `score_unique` | Plusieurs candidats mais un seul a un score nom+prénom > 0 |
| `score_clear` | Plusieurs candidats, le top dépasse le 2e de >30 points |
| `tie_lowest_id` | Plusieurs candidats à égalité parfaite, ID bas pris |
| `name_only` | Adresse introuvable → match par nom seul (1 résultat) |

### Étape 2 — Corrections manuelles
**Script** : `fix-factures-{exercice}.js`

**Ce qu'il fait** :
1. Lit le JSON brut du match
2. Applique les corrections manuelles définies dans 2 dictionnaires :
   - `CORRECTIONS = { "numero_facture": { id, numero_client, ... } }` pour les `multiple`
   - `NOT_FOUND_CORRECTIONS = { ... }` pour les `notFound`
3. Écrit `factures_results_{exercice}_corrected.json`

**Workflow humain** :
- Inspecter les sections `multiple` et `notFound` du JSON brut
- Pour chaque cas, identifier le bon client en base (ou décider de le créer via étape 0)
- Remplir les dictionnaires
- Re-run jusqu'à 0 multiple / 0 notFound

### Étape 3 — Import (écriture)
**Script** : `import-factures-{exercice}.js`

**Ce qu'il fait** :
1. Lit le JSON corrigé (`*_corrected.json`)
2. Pour chaque facture matched :
   - **Anti-doublon niveau 2** : recheck `numero_facture` dans `factures_winbiz` (paranoid)
   - Upload PDF vers Storage : `factures/{exercice}/facture_{numeroFacture}_{clientId}.pdf` (avec `x-upsert: true`)
   - INSERT dans `factures_winbiz` avec `client_id`, `numero_facture`, `date_facture`, `nom_fichier`, `pdf_url`, `montant`, `match_auto`, `match_confiance`
3. Écrit log dans `factures_import_log_{exercice}.json`

**Mode `--dry-run`** (depuis 2026-2) :
- Simule tout sans rien écrire
- Vérifie l'existence des PDFs en local
- Recommandé avant le vrai run

---

## 📦 Sécurités intégrées

| Niveau | Mécanisme | Étape |
|---|---|---|
| 1 | Anti-doublon SQL au match | match (skip silencieux dans `alreadyImported`) |
| 2 | **Recheck `numero_facture` avant chaque INSERT** | import |
| 3 | `x-upsert: true` côté Storage | import (uploads idempotents) |
| 4 | `match_confiance: "auto" \| "manuel"` en base | import (trace persistante) |
| 5 | Mode `--dry-run` | import (test à blanc) |
| 6 | `numero_facture` unique par construction WinBiz | source (pas de doublons possibles côté WinBiz) |

→ **Tu peux Ctrl+C un import en plein milieu et le relancer sans risque de doublon.**

---

## 🎯 Améliorations du parser au fil des sessions

### Améliorations apportées dans le `match-factures-2026-2.js`

| # | Amélioration | Effet |
|---|---|---|
| 1 | **Anti-doublon SQL** | Skip silencieux des factures déjà en base |
| 2 | **Préfixe pays** (`CH \| F \| D \| I \| A \| FL \| FR \| DE \| IT \| AT \| LI`) | Strip avant test NPA — cas "CH - 1180 Aubonne" |
| 3 | **Civilités étendues** : "Madame et Monsieur", "Messieurs", "Mesdames" | Nom client mieux extrait |
| 4 | **Compléments d'adresse ignorés** (Case postale, Villa, Bât., Étage, App.) | Vraie rue retrouvée même avec ces intercalaires |
| 5 | **Scoring nom+prénom intégré au match** | Résolution auto des cas où 1 seul candidat a un score haut |
| 6 | **Règle "ID le plus bas en cas de tie"** | Privilégie le client Shopify enrichi |
| 7 | **Cap "trop de candidats"** (>30 sans nom matchant + recherche par nom seul en fallback) | Évite la pollution massive sur un homonyme inexistant |
| 8 | **Recherche par nom seul** si rue introuvable ou aucun candidat | Récupère les cas "adresse changée" |
| 9 | **Output enrichi** : `matchStrategy` + `bestGuess` sur chaque entrée | Facilite l'inspection du JSON |

### Statistiques d'évolution
- **Exercice 2024** (parser v1) : 90% auto, 10% à corriger manuellement (72 multiple + 1 notFound sur 721)
- **Exercice 2026-2** (parser v2 amélioré) : 95% auto, 5% à corriger (3 multiple sur 65) — le scoring intégré a remonté ~5 points

---

## 🐛 Pièges connus & cas tordus rencontrés

### 1. Adresse PDF différente de la base (fusion Shopify)
**Cause** : Lors de l'import WinBiz, fusion automatique avec un client Shopify existant à la même adresse → l'adresse Shopify "propre" écrase l'adresse WinBiz "sale". Le PDF WinBiz garde la version originale.

**Exemples concrets** :
- MENEGALLI Orlando : PDF dit "Rjue des Alpes 8, 1006 Lausanne" / base dit "Avenue de Provence 10, 1007 Lausanne" (déménagement)
- VENETZ-SUTTER Laurent : PDF dit "Chemin de Bellecombe 22B" / base dit "Route de la Conversion 308" (déménagement ou 2e résidence)

**Solution** : la recherche par nom seul (étape 3 du matching) récupère ces cas.

### 2. Doublons clients dus aux accents
Documenté dans la section "Bugs connus".

### 3. Adresses tronquées (ancien format de fichier WinBiz)
Sur l'exercice 2025, certains noms de fichiers étaient coupés (Windows / WinBiz limit). Exemples :
- `...Faubourg de l'Hôpit__FACTURE-...`
- `...Avenue des Bains 9 __FACTURE-...`

→ **Résolu** : depuis 2026, WinBiz inclut une partie de la description article dans le titre, le rendant beaucoup plus long. Plus de troncatures.

### 4. Sociétés multi-contacts
Une société peut avoir plusieurs contacts en base (ex. MENETREY SA avait Brossard 18735, Kurzen 18736, Matthey-Doret 18738). Le PDF nomme parfois un autre contact (Karl Leffondre) qui n'existe pas en base.

**Solution** : créer le contact manquant via script `creer-XXX.js` et l'utiliser pour le matching.

### 5. Clients étrangers (1% des cas)
Préfixes pays (`CH - `, `FR - `, etc.) gérés par la regex `stripCountryPrefix`. Pour les NPA français à 5 chiffres ou autres formats, le parser tombe en `errors` → traitement manuel via le fix.

### 6. Faux positif numéro avant NPA
Cas exotique : `Service des Finances  107.00 Service des Resources Humaines  Faubourg de l'Hôpit...`. Le `107.00` n'est pas un NPA mais peut perturber. La regex `^(\d{4})\s+(.+)$` filtre correctement (4 chiffres puis espace + texte) — pas de faux positif observé.

---

## 📋 Workflow type pour un futur batch

Pour ton prochain run (ex: `2026-3` dans 1 mois) :

```powershell
# 1. Place les nouveaux PDFs dans G:\Mon Drive\Factures_winbiz\2026-3
# 2. Adapte les chemins en haut des 3 scripts :
#    PDF_FOLDER, OUTPUT_FILE / RESULTS_FILE / LOG_FILE → "2026-3"
#    (le bucket Storage reste sur "2026" — pas besoin de le changer)

cd C:\Users\ezefi

# 3. Match (lecture seule)
node match-factures-2026-2.js
# → Produit factures_results_2026-3.json

# 4. Inspecte les "multiple" et "notFound" dans le JSON
#    Si nouveau client à créer → étape 4a
#    Sinon → étape 5

# 4a. (si nécessaire) Crée les clients manquants
# Adapte un script du type creer-XXX.js

# 5. Remplis fix-factures-2026-2.js avec les corrections
node fix-factures-2026-2.js
# → Produit factures_results_2026-3_corrected.json

# 6. Dry-run (recommandé)
node import-factures-2026-2.js --dry-run

# 7. Import réel
node import-factures-2026-2.js
# → Upload Storage + INSERT factures_winbiz + log

# 8. Vérification SQL
# SELECT COUNT(*) FROM factures_winbiz WHERE created_at > NOW() - INTERVAL '1 hour';
```

---

## 📖 Tableau récapitulatif des scripts

| Script | Rôle | Réutilisable ? |
|---|---|---|
| `match-factures-{ex}.js` | Parsing PDFs + matching client + anti-doublon niveau 1 | ✅ Oui (changer chemins en haut) |
| `fix-factures-{ex}.js` | Corrections manuelles des multiples/notFound | ⚠️ Spécifique à chaque batch (corrections différentes) |
| `import-factures-{ex}.js` | Upload Storage + INSERT + anti-doublon niveau 2 + dry-run | ✅ Oui (changer chemins) |
| `creer-XXX.js` | Création one-shot d'un client manquant | ❌ One-shot, à dupliquer pour chaque cas |
| `verifier-clients.js` | Inspection BDD (colonnes, doublons connus, recherches ciblées) | ✅ Oui (modifier les recherches) |
| `verifier-2-clients.js` | Recherches client ad-hoc | ✅ Oui (modifier les filtres) |

**Tous ces scripts vivent dans `C:\Users\ezefi\`** (pas dans le repo Next.js).
**Pas de git push à faire après leur exécution.**

---

## 🧹 Limites du système actuel & recommandations

### Limite 1 — Le titre PDF ne contient ni email ni tel
Quand on crée un client à la volée (cas Leffondre, Fondation Asile), il aura `email = null` et `tel1 = null`. Si ce même client existe dans Shopify avec un email, on rate l'opportunité de fusion riche.

**Recommandation** : faire un **import incrémental WinBiz tous les 3-6 mois** pour rafraîchir les adresses et chopper les nouveaux clients sans les créer à la volée. Ça évite l'accumulation de "clients orphelins" à créer un par un.

### Limite 2 — Pas de numéro client WinBiz d'origine en base
Quand on crée un client à la volée, il reçoit un nouveau `numero_client` Supabase (ex. CL-22088). Mais WinBiz a son propre numéro client interne. Si plus tard on réimporte WinBiz "proprement", on peut avoir des doublons.

**Recommandation future** : ajouter une colonne `winbiz_client_id` à `clients` pour stocker le n° WinBiz d'origine et éviter les doublons lors de futurs réimports.

### Limite 3 — Le `fix-factures` est manuel et fastidieux pour les gros volumes
Sur 2024 : 72 corrections manuelles. Sur 2026-2 : 3. Le scoring intégré au match a beaucoup réduit le besoin, mais il reste des cas tordus (sociétés multi-contacts, adresses changées) qui requièrent une décision humaine.

**Recommandation** : pas d'amélioration urgente, le pipeline tient bien la route. À surveiller seulement si un batch génère >10% de multiples.

### TODO futur — Script d'import incrémental WinBiz
Si ça devient utile, écrire un `import-clients-winbiz-incremental.js` qui :
- Lit l'export WinBiz CSV/Excel
- Pour chaque client : check si déjà en base (par nom+npa+ville)
- Si oui : update les champs vides (email, tel) avec les infos WinBiz si plus riches
- Si non : crée
- Sort un rapport `created` / `updated` / `skipped`

---

## 🛠️ Commandes utiles (rappel)

### PowerShell — exécution scripts
```powershell
cd C:\Users\ezefi
node match-factures-2026-2.js
node fix-factures-2026-2.js
node import-factures-2026-2.js --dry-run
node import-factures-2026-2.js
```

### PowerShell — vérification taille fichier
```powershell
Get-Item C:\Users\ezefi\fix-factures-2026-2.js | Select-Object Name, Length
# ❌ ~3 ko = squelette vide
# ✅ ~10-16 ko = corrections remplies
```

### SQL — vérification import
```sql
-- Compter les factures importées récemment
SELECT COUNT(*) FROM factures_winbiz
WHERE created_at > NOW() - INTERVAL '1 hour';

-- Compter par exercice
SELECT
  CASE
    WHEN date_facture BETWEEN '2023-10-01' AND '2024-09-30' THEN '2024'
    WHEN date_facture BETWEEN '2024-10-01' AND '2025-09-30' THEN '2025'
    WHEN date_facture BETWEEN '2025-10-01' AND '2026-09-30' THEN '2026'
    ELSE 'autre'
  END as exercice,
  COUNT(*)
FROM factures_winbiz
GROUP BY 1
ORDER BY 1;

-- Vérifier répartition match auto vs manuel
SELECT match_confiance, COUNT(*)
FROM factures_winbiz
GROUP BY 1;

-- Trouver les factures d'un client spécifique
SELECT numero_facture, date_facture, montant, pdf_url
FROM factures_winbiz
WHERE client_id = <ID>
ORDER BY date_facture DESC;
```

### SQL — exploration table clients
```sql
-- Schéma complet
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'clients'
ORDER BY ordinal_position;

-- Répartition par source
SELECT source, COUNT(*) FROM clients GROUP BY source ORDER BY 2 DESC;

-- Trouver le dernier numero_client utilisé
SELECT numero_client FROM clients ORDER BY numero_client DESC LIMIT 5;
```

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

*Dernière mise à jour : 10 mai 2026 (ajout section import factures WinBiz)*
