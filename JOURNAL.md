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
- Exercice 2022 : 1.10.2021 → 30.09.2022
- Exercice 2023 : 1.10.2022 → 30.09.2023
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

### Table `clients` (~22 094 lignes au 10 mai 2026, nuit)
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

**Répartition par source au 10 mai 2026 (nuit)** :
- `shopify` : 10 630 (48%)
- `winbiz` : 8 258 (37%)
- `offre` : 9
- `manuel` : 6

**⚠️ Règle CRITIQUE — "ID bas = client Shopify enrichi"** (vérifiée empiriquement) :
- Les imports Shopify ont été faits **AVANT** les imports WinBiz → IDs bas = Shopify
- Lors de l'import WinBiz, fusion automatique si adresse identique
- Conséquence : pour un même client, l'**ID le plus bas** a souvent **email + tel** (origine Shopify enrichie de l'adresse postale WinBiz)
- En cas de doublon dû aux accents (ex. Engelhard Loic vs Loïc), prendre l'ID le plus bas

**Adresses partiellement écrasées par Shopify** : certaines adresses WinBiz "sales" (typos, formats divers) ont été remplacées par les versions Shopify "propres" lors de la fusion. Le matching par rue ne peut donc pas être strict — les adresses dans les PDFs WinBiz peuvent différer de l'adresse en base.

### Table `factures_winbiz` (4 362 lignes au 10 mai 2026, nuit — total CHF ~11 844 000)
- **A `client_id`** (figé à l'import)
- `numero_facture` (TEXT) — **unique par construction WinBiz** (pas de doublons possibles côté source)
- `date_facture` (DATE)
- `nom_fichier` (TEXT) — nom brut du PDF
- `pdf_url` (TEXT) — URL Supabase Storage publique
- `montant` (NUMERIC)
- `match_auto` (BOOL) — true si match automatique, false si correction manuelle
- `match_confiance` (TEXT) — `"auto"` ou `"manuel"`

**🔬 Audit "adresse partagée" effectué le 10 mai 2026 nuit** :
- 4 362 factures × 3 053 clients audités via `audit-adresse-partagee.js`
- 69 cas avec motifs divergents identifiés
- **2 vrais bugs trouvés et corrigés** : Grill & More vs Nestlé (7 factures) + Luis Ismael vs 3 clients Biel (5 factures)
- **Taux de propreté final : 99,725%** (12 factures sur 4 362 mal attribuées et corrigées)
- 67 autres cas = faux positifs légitimes (variantes civilité Mr/Mme, sociétés multi-contacts, transcriptions arabes du même couple, etc.)

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
- `factures/2022/` — exercice 2022 complet (1 109 factures, importé 10 mai 2026 nuit)
- `factures/2023/` — exercice 2023 complet (1 000 factures, importé 10 mai 2026)
- `factures/2024/` — exercice 2024 quasi complet (721 batch 1 + 349 batch 2 = 1 070 factures)
- `factures/2025/` — exercice 2025 quasi complet (675 batch 1 + 319 batch 2 = 994 factures)
- `factures/2026/` — exercice 2026 en cours (124 batch 1 + 65 batch 2 = 189 factures à mi-parcours)

⚠️ **Note importante** : le `client_id` dans la table `factures_winbiz` peut être réassigné après l'upload (cf. réassignations Grill & More et Luis/ASPL). Le **nom de fichier** dans le bucket Storage reste lui figé sur le `clientId` initial — pas grave puisque c'est juste un nom de stockage interne.

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

**Doublons accents/typos** :
- Engelhard Loic (7173) / Loïc (16245)
- Demaurex Gaétan (4117) / Gaetan (15780)
- Grobéty (6700) / Grobety (17129)
- Iacobelli (8842) / Iacibelli (15732)
- Capobianco (14967) / Copobianco (15397)
- **Damseaux Clara : 2 entrées** (13482 Shopify avec email BISELELA@GMAIL.COM, 15580 winbiz "Damseaux Tabet Clara") — découvert via audit du 10 mai 2026
- **Chopard-Gnägi René et René : 2 entrées** (15242, 16982 "GNÄGI et CHOPARD") — découvert via audit du 10 mai 2026

**Doublons d'import successif** (découverts sur exercice 2023 — chaque exercice WinBiz importé semble avoir recréé les clients à l'emporter) :
- Hi Ying Mei : **5 entrées** (17390, 17539, 17544, 18026, 21910)
- Bourgoz Dominique : **4 entrées** (3638, 14653, 18036, 21863)
- Faiveley François : **3 entrées** (16345, 21885, 21892) + 1 société Faiveley Tech (16346)
- Gallegos Alejandro (commercial JC) : **3 entrées** (16732, 21898, 21903)
- Abbondanzieri Katia : 2 entrées (14194, 21845)
- Fell Claude : 2 entrées (16408, 21887)
- Laurent Frédéric : 2 entrées (18153, 21922)
- De Kerchove D'o Vincent : 2 entrées (15636, 21876)
- Geiser Lilia : 3 entrées (16824, 21900, 21905)
- Barbier (sans prénom) : 2 entrées (14592, 21854)
- Nordmann Philippe : 3 entrées (4451 Shopify avec email, 19251, 19476)
- Abrial Jacques : 2 entrées (14205, 21847)

**Doublons supplémentaires identifiés sur l'exercice 2022** :
- Marchesi Francine : **4 entrées** (18539, 18540, 21925, 21926)
- Parmigiani Tino : 2 entrées (19436, 19478)
- Tercier (sans prénom) : 2 entrées (21080, 21412)
- Berthod Julie : 4 entrées (3327, 14648, 18031, 21858)
- Bossaert Kristine : 4 entrées (3607, 14652, 18035, 21862)
- Ben-Amara Rose-Marie : 4 entrées (3250, 14645, 18028, 21855)
- Collins Dorli : 2 entrées (15336, 21872)
- Galfetti Laurie : 3 entrées (16720, 21897, 21902)
- Burri-Cordonier Caroline : 2 entrées (14861, 21867)
- Therrien Julie [AROBUZZ INC] : 2 entrées (14411, 21852)
- Hotel Montreux Palace SA : 2 entrées (17487, 17488)

**Convention de fusion** (cf. règle "ID bas = client Shopify enrichi") :
1. Identifier le client_id à conserver = **ID le plus bas** (généralement src=shopify avec email)
2. Mettre à jour toutes les FK qui pointent vers les doublons (`factures_winbiz.client_id`, etc.)
3. Supprimer les doublons

### ⚠️ Bug pattern "adresse partagée" — clients différents à la même adresse
**Découvert le 10 mai 2026 nuit, après import 2022**

**Symptôme** : Plusieurs clients distincts résident à la même adresse postale (ou avec un NPA en commun), et le matcher se trompe de cible quand il tranche entre eux.

**Cas concrets corrigés** :

1. **Grill & More vs Nestlé** : 7 factures Grill & More Lausanne Sàrl (Rue du Lion d'Or 6, 1003 Lausanne) avaient été rattachées à **Société des Produits Nestlé SA Invoice Center** (CL-17616). Réassignées à **Grill & More Company SA** (CL-16981). Script `reassigner-factures-grill-more.js`.

2. **Luis Ismael [ASPL] vs 3 clients Biel** : 5 factures rattachées par erreur à Luis Ismael (CL-13222, Zentralstrasse 53, Biel — client Shopify) alors qu'aucune n'était à son adresse. Le seul point commun était le NPA 2502.
   - 2 factures (#50235 #50854, CHF 8 500) → réassignées à **Chopard-Gnägi René et René** (CL-15242, Rue d'Aarberg 95)
   - 1 facture (#52855, CHF 20 000) → réassignée à **Reist Alain [EPIS TAFF BIENNE]** (CL-16255, Rue des Maréchaux 1)
   - 2 factures (#53944 #53945, CHF 269) → réassignées à **Dubar Marie-Hélène** (CL-16019, Rue du Stand 82)
   - Script `reassigner-factures-luis-aspl.js`. **CL-13222 Luis Ismael n'a finalement aucune facture WinBiz** (probablement un client Shopify qui n'a jamais commandé via WinBiz).

**Détection** : invisible au moment du match (matchStrategy `auto`). Repéré soit manuellement (Grill & More) soit via le script `audit-adresse-partagee.js` (Luis/ASPL).

**Audit complet réalisé le 10 mai 2026 nuit** :
- 4 362 factures × 3 053 clients audités
- 69 cas suspects (≥2 motifs divergents) → après inspection :
  - 67 cas légitimes (variantes Mr/Mme, sociétés multi-contacts, transcriptions arabes d'un couple, typos OCR)
  - 2 vrais bugs identifiés et corrigés (les 2 cas ci-dessus, 12 factures au total)
- **Base à 99,725% propre** après audit (12 factures sur 4 362 mal attribuées et corrigées)

**Recommandation future** :
1. **Audit SQL périodique** après chaque batch (cf. requête plus bas)
2. **Améliorer parser v3** : si plusieurs candidats à la même adresse, comparer le `CLIENT-XXX` du nom de fichier contre `nom` ET `societe` de chaque candidat. Pas de match fuzzy → marquer en `multiple` plutôt qu'auto-résoudre.
3. **Heuristique de prudence à ajouter au matcher** : si un client a un email Shopify (`src=shopify` avec email rempli) ET qu'on s'apprête à lui attribuer une facture WinBiz dont le nom_fichier ne contient AUCUN token de son nom/prenom, **ne pas auto-résoudre** et passer en `multiple`. Aurait évité les 2 bugs corrigés (Nestlé et Luis Ismael avaient tous les 2 src=shopify avec email).

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
- Fusion des doublons clients (la liste ne cesse de grandir — Engelhard, Demaurex, Grobéty, Iacobelli, Capobianco, Marchesi, Parmigiani, Tercier, Berthod, Bossaert, Ben-Amara, Galfetti, Damseaux, Chopard-Gnägi, etc.)

### 🎯 Priorité 5 — Audit régulier "adresse partagée"
**Workflow recommandé après chaque batch** :
1. Lancer `audit-adresse-partagee.js`
2. Inspecter les cas avec ≥3 motifs distincts (probables vrais bugs)
3. Pour chaque vrai bug, dupliquer le script `reassigner-factures-{nom}.js` et corriger

### 🎯 Priorité 6 — Import incrémental clients WinBiz
Voir section dédiée plus bas — outil à créer pour rafraîchir périodiquement les adresses sans créer de doublons.

### 🎯 Priorité 7 — Batchs factures WinBiz à venir
- **Batch 2026-3** : suite de l'exercice 2026 en cours (~130-150 factures attendues d'ici fin septembre 2026)
- Workflow rodé sur 5 batchs : dupliquer les scripts `2024-2` → adapter chemins (PDF_FOLDER, RESULTS_FILE, LOG_FILE, FOLDER Storage) → run match → inspecter JSON → fix → dry-run → import
- **N'oublie pas l'audit post-import** avec `audit-adresse-partagee.js`
- Le parser v2.1 (avec détection `anonymous_winbiz`) reste réutilisable tel quel

### 🎯 Priorité 8 — Améliorations parser (v3 future)
Identifiées à travers les 5 batchs effectués + audit, à intégrer dans une `match-factures-v3.js` future :
- **Détection adresse magasin** : si `npa=1095 AND ville=Lutry AND rue=Route de Lavaux 425` → basculer directement sur recherche par nom seul (évite les 7+ candidats sans intérêt)
- **Normalisation ville `F-VILLE`** : ajouter `ville.replace(/^(F|D|I|A|FL)-/i, '')` pour gérer `74440 F-CHAMONIX`
- **Tolérance NPA tronqué** : si NPA semble coupé (< 4 chiffres), basculer sur recherche par nom+société
- **Anti adresse partagée v1** : ajouter au scoring un check sur le premier segment du `nom_fichier` (`CLIENT-XXX`) contre `nom` ET `societe` du candidat. Si aucune correspondance fuzzy → marquer en `multiple` même si l'adresse matche parfaitement (cas Grill & More vs Nestlé)
- **Anti adresse partagée v2 (heuristique de prudence)** : si un candidat `src=shopify` avec email rempli n'a AUCUN token de son nom/prenom dans le nom_fichier → ne pas auto-résoudre, passer en `multiple` (aurait évité le bug Luis/ASPL)

Pas urgent — le pipeline actuel atteint 96-97% auto + audit post-import permet de rattraper les rares cas qui passent.

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

### Session du 10 mai 2026 — Marathon imports factures WinBiz (5 batchs)
- ✅ **2026 batch 2** : 65 factures, score parfait 100% en 0 erreur, 1 client créé (Fondation Asile des Aveugles, CL-22088)
- ✅ **2023 complet** : 1000 factures, 97.5% auto, 100% final, 1 client créé (Varone Christelle, CL-22089), pattern "adresse magasin Lutry" résolu
- ✅ **2025 batch 2** : 319 factures, 96.6% auto, 100% final, 2 clients créés (Anonyme CL-22090, HOPITAL JULES GONIN CL-22091), pattern "anonymous_winbiz" identifié
- ✅ **2024 batch 2** : 349 factures, 97.4% auto, 100% final, 0 client créé. Parser v2.1 avec détection automatique `anonymous_winbiz` introduit
- ✅ Pipeline éprouvé : match → fix → import avec anti-doublon double niveau + mode `--dry-run`
- 📖 Voir section dédiée **"Import factures WinBiz"** ci-dessous

### Session du 10 mai 2026 (nuit) — Import factures WinBiz exercice 2022 complet + audit base + 2 bugs corrigés
- ✅ **1109 factures** du dossier `2022` importées (numéros 49193 à 50308)
- ✅ Score auto : 1064/1109 (96.0%)
- ✅ Score final : **1109/1109 (100%)** après 45 corrections manuelles
- ✅ **2 clients créés** : Pittet Anne / TRICYLE Sàrl (CL-22093, restaurant Café Saint Pierre Lausanne) et Weiss Yael (CL-22094)
- ✅ **1 client retrouvé** : Rochat-Guignard Isabelle existait déjà sous **CL-19697** (créée lors d'un import WinBiz antérieur, format "Rochat - Guignard" avec espaces — c'est pour ça que mes recherches initiales ne la trouvaient pas)
- ✅ 1 erreur upload transient (HTTP 502 sur #49298) résolue au 2e run grâce à l'anti-doublon
- ✅ Total `factures_winbiz` désormais : **4 362 factures, ~CHF 11 844 000**

**🐛 2 bugs majeurs "adresse partagée" découverts et corrigés** :

1. **Grill & More vs Nestlé** (repéré par hasard sur fiche client Nestlé) :
   - 7 factures Grill & More Lausanne Sàrl mal rattachées à **CL-17616 Société des Produits Nestlé SA Invoice Center** au lieu de **CL-16981 Grill & More Company SA**
   - Script `reassigner-factures-grill-more.js` créé et appliqué → 7/7 réassignées
   - CL-16981 a maintenant ses 14 factures complètes

2. **Luis Ismael [ASPL] vs 3 clients Biel** (repéré par l'audit) :
   - 5 factures rattachées à **CL-13222 Luis Ismael** (Zentralstrasse 53, Biel — client Shopify) alors qu'aucune n'était à son adresse — seul point commun : NPA 2502
   - Script `reassigner-factures-luis-aspl.js` → 5/5 réassignées vers 3 vrais clients (Chopard-Gnägi CL-15242, Reist EPIS TAFF CL-16255, Dubar CL-16019)
   - CL-13222 Luis Ismael n'a finalement plus aucune facture (probable client Shopify pur, sans achat WinBiz)

**🔬 Audit complet de la base post-correction** :
- Script `audit-adresse-partagee.js` créé pour passer en revue toute la table `factures_winbiz`
- 4 362 factures × 3 053 clients passés en revue
- 69 cas avec motifs divergents identifiés
- 67 cas = faux positifs légitimes après inspection (variantes Mr/Mme, sociétés multi-contacts, transcriptions arabes, typos OCR)
- 2 vrais bugs (les 2 ci-dessus) → tous corrigés
- **Taux de propreté final : 99,725%** (12 / 4 362 factures corrigées)

### 🏆 Bilan global du 10 mai 2026 (5 sessions + audit + 2 bugs corrigés)
| Session | Volume | Score auto | Erreurs |
|---|---|---|---|
| 2026 (batch 2) | 65 | 95.4% | 0 |
| 2023 (complet) | 1 000 | 97.5% | 0 |
| 2025 (complément) | 319 | 96.6% | 0 |
| 2024 (complément) | 349 | 97.4% | 0 |
| **2022 (complet)** | **1 109** | **96.0%** | **0** |
| **TOTAL IMPORTS** | **2 842 factures** | **96.6%** | **0** |
| **+ Audit & corrections bugs** | **12 factures réassignées** | — | **2 bugs corrigés** |

**6 clients créés** : Fondation Asile des Aveugles (CL-22088), Varone Christelle (CL-22089), Anonyme (CL-22090), HOPITAL JULES GONIN - FAA (CL-22091), Pittet Anne / TRICYLE Sàrl (CL-22093), Weiss Yael (CL-22094)
**1 client retrouvé existant** : Rochat-Guignard Isabelle (CL-19697)
**2 bugs critiques corrigés** : 12 factures total réassignées (Grill & More + Luis/ASPL)

**Décisions de référence durables** (réutilisables pour batchs futurs) :
- Bulgari Horlogerie SA → **CL-14830** (Girolimetto Yoann) — utilisée 4 fois sur 2023, 2025, 2024
- Services Industriels de Genève (SIG) → **CL-20708** (entité société) — utilisée 5 fois (2 sur 2023, 3 sur 2022)
- EGEL Sàrl → **CL-16162** (Ly Van-Loc)
- MENETREY SA → **CL-21937** (Leffondre Karl, créé 2024)
- Gallegos Alejandro (commercial JC) → **CL-16732** — utilisée 3 fois sur 2023 et 2024
- Hôtel Bellerive → **CL-17470** (entité société)
- Tennis Club Seeblick → **CL-6232** (Bernhard Andreas)
- Deguemp Cécile → **CL-7851** — utilisée 4 fois (2023, 2025, 2024-2)
- TIR CRS SA / Transfusion Interrégionale CRS SA → **CL-21191** (nouvelle ref 2022)
- H.M.C. Hôtel Management → **CL-17233** — utilisée 2 fois (2025, 2022)
- TCS Training et Loisir SA → **CL-21071** — utilisée 2 fois (2026-2, 2022)
- Burnand Jérôme → **CL-04274** (Shopify avec email) — utilisée 3 fois (2024, 2022 ×2)
- Edwards David → **CL-16156** — utilisée 4 fois (2024, 2022 ×3)
- Hôtel Montreux Palace SA → **CL-17487** (ref 2022)
- Grill & More Company SA → **CL-16981** (14 factures rattachées après correction du 10 mai 2026 nuit)
- Chopard-Gnägi René et René → **CL-15242** (2 factures 2022-2023, Biel)
- Reist Alain [EPIS TAFF BIENNE] → **CL-16255** (1 facture 2025)
- Dubar Marie-Hélène → **CL-16019** (2 factures 2026)

**État final de la table `factures_winbiz` au 10 mai 2026, nuit (post-audit)** :
| Exercice | Période | Nb factures | Total CHF |
|---|---|---|---|
| **2022** | **1.10.21 → 30.09.22** | **1 109** | **~2 800 000** |
| 2023 | 1.10.22 → 30.09.23 | 1 000 | 2 798 845.70 |
| 2024 | 1.10.23 → 30.09.24 | 1 070 | 2 810 772.50 |
| 2025 | 1.10.24 → 30.09.25 | 994 | 2 807 118.05 |
| 2026 (en cours) | 1.10.25 → 30.09.26 | 189 | 628 562.75 |
| **TOTAL** | | **4 362** | **~11 844 000** |

**Observation** : les 4 exercices complets (2022, 2023, 2024, 2025) ont un CA très stable entre 2.79M et 2.81M CHF — activité régulière depuis 4 ans.

---

# 📥 Import factures WinBiz — Documentation complète

> Cette section documente le système d'import des factures PDF WinBiz vers Supabase (Storage + table `factures_winbiz`). Elle est volontairement détaillée car le pipeline est ré-utilisé périodiquement (typiquement par exercice ou par batch).

## 🎯 Vue d'ensemble

**Objectif** : prendre des PDFs de factures WinBiz exportés sur Google Drive, les uploader dans Supabase Storage, et insérer les métadonnées (n° facture, date, montant, lien client) dans la table `factures_winbiz`.

**Volumétrie historique au 10 mai 2026, nuit (post-audit)** :
- Exercice 2022 : 1 109 factures importées (10 mai 2026 nuit)
- Exercice 2023 : 1 000 factures importées (10 mai 2026)
- Exercice 2024 : 1 070 factures importées (721 batch 1 mai + 349 batch 2 le 10 mai)
- Exercice 2025 : 994 factures importées (675 batch 1 fin avril + 319 batch 2 le 10 mai)
- Exercice 2026 : 189 factures en cours (124 batch 1 + 65 batch 2 le 10 mai)
- **Total : 4 362 factures, ~CHF 11 844 000 — base à 99,725% propre après audit**

**Localisation des PDFs** : `G:\Mon Drive\Factures_winbiz\<dossier>\`

**Format des noms de fichier WinBiz** :
```
CLIENT-{civilité}  {NOM Prénom}  {Rue n°}  {NPA Ville}  codex  {champs supplémentaires}__FACTURE-{n°}__DATE-{DD.MM.YYYY}__TOTAL_CHF-{montant}.pdf
```
Séparateur principal : **double espace**. Métadonnées en suffixe : `__FACTURE-XXXXX__DATE-DD.MM.YYYY__TOTAL_CHF-X'XXX.XX`.

---

## 🔄 Pipeline en 3-4 étapes (+ étape 5 audit)

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
- `creer-cafe-saint-pierre.js` (Pittet Anne / TRICYLE Sàrl, 2022) → CL-22093, ID 22093
- `creer-weiss-yael.js` (Weiss Yael, 2022) → CL-22094, ID 22094

⚠️ **Toujours vérifier d'abord les éventuels doublons avec recherche flexible** : sur 2022, "Rochat-Guignard" avait été créé sous "Rochat - Guignard" (espaces autour du tiret) lors d'un import antérieur — la recherche `nom=ilike.*rochat*guignard*` ne le trouvait pas. Faire des recherches `nom=ilike.*rochat*` + `nom=ilike.*guignard*` pour être sûr.

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

⚠️ **Limite connue** : la stratégie ne détecte pas les cas "adresse partagée" où plusieurs clients distincts résident à la même adresse (cf. bugs Grill & More vs Nestlé et Luis Ismael vs Chopard/EPIS/Dubar). À auditer manuellement avec `audit-adresse-partagee.js` après chaque batch.

### Étape 2 — Corrections manuelles
**Script** : `fix-factures-{exercice}.js`

**Ce qu'il fait** :
1. Lit le JSON brut du match
2. Applique les corrections manuelles définies dans 3 dictionnaires :
   - `CORRECTIONS = { "numero_facture": { id, numero_client, ... } }` pour les `multiple`
   - `NOT_FOUND_CORRECTIONS = { ... }` pour les `notFound`
   - `ERROR_CORRECTIONS = { ... }` pour les `errors` (parser cassé sur NPA/ville)
3. Écrit `factures_results_{exercice}_corrected.json`

**Workflow humain** :
- Inspecter les sections `multiple`, `notFound` et `errors` du JSON brut
- Pour chaque cas, identifier le bon client en base (ou décider de le créer via étape 0)
- Remplir les dictionnaires
- Re-run jusqu'à 0 multiple / 0 notFound / 0 errors

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

### Étape 4 (NOUVELLE depuis 10 mai 2026 nuit) — Audit post-import
**Script** : `audit-adresse-partagee.js`

**Ce qu'il fait** :
1. Charge toutes les factures de la base
2. Regroupe par `client_id`
3. Pour chaque client ayant ≥2 factures, extrait le "motif identitaire" (~nom+prénom) de chaque `nom_fichier`
4. Si un client a ≥2 motifs distincts → cas suspect
5. Affiche les 100 premiers cas par ordre de gravité (nb motifs distincts décroissant)

**Comment l'interpréter** :
- **2 motifs très proches** (ex: `madame X` vs `monsieur X`) → faux positif, c'est une famille
- **2 motifs avec orthographes différentes** (ex: `tabet amine` vs `damseaux tabet clara`) → faux positif, c'est un couple
- **2-3 motifs avec sociétés/noms complètement étrangers** → vrai bug, à corriger via `reassigner-factures-{nom}.js`

### Étape 5 (correction des bugs trouvés à l'étape 4)
**Script type** : `reassigner-factures-{nom}.js`

**Ce qu'il fait** :
1. Liste les factures à réassigner (mode `--apply` pour exécuter, sinon read-only)
2. Vérifie client source et clients cibles
3. UPDATE `factures_winbiz.client_id` pour chaque facture concernée

**Exemples historiques** :
- `reassigner-factures-grill-more.js` (10 mai 2026 nuit) — 7 factures déplacées de CL-17616 vers CL-16981
- `reassigner-factures-luis-aspl.js` (10 mai 2026 nuit) — 5 factures déplacées de CL-13222 vers 3 clients distincts (CL-15242, CL-16255, CL-16019)

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
| 7 | **Audit post-import "adresse partagée"** | post-import (rattrape les bugs invisibles au match) |

→ **Tu peux Ctrl+C un import en plein milieu et le relancer sans risque de doublon.**
→ **Tu peux corriger un bug "adresse partagée" même des mois après l'import (les UPDATE sont safe).**

---

## 🎯 Améliorations du parser au fil des sessions

### Améliorations apportées dans le `match-factures-2024-2.js` (parser v2.1, réutilisé pour 2022)

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
| 10 | **Détection `anonymous_winbiz`** (v2.1) : titre `X mister X X X X X X` → rattachement client générique CL-22090 | Auto-résolution des factures WinBiz masquées |

### Statistiques d'évolution (au 10 mai 2026, nuit)
| Batch | Volume | Score auto | Corrections | Parser |
|---|---|---|---|---|
| Exercice 2024 (initial) | 721 | 90.0% | 72 multiple + 1 notFound | v1 |
| Exercice 2026 (batch 2) | 65 | 95.4% | 3 multiple | v2 |
| Exercice 2023 (complet) | 1 000 | 97.5% | 18 multiple + 5 notFound + 2 errors | v2 |
| Exercice 2025 (batch 2) | 320 | 96.6% | 5 multiple + 5 errors | v2 |
| Exercice 2024 (batch 2) | 350 | 97.4% | 6 multiple + 1 notFound + 1 error | v2.1 |
| Exercice 2022 (complet) | 1 109 | 96.0% | 24 multiple + 10 notFound + 11 errors | v2.1 |

**Score moyen pondéré sur 2 844 factures (5 batchs récents, parser v2/v2.1)** : **96.6% en automatique**
Le scoring nom+prénom intégré au match a fait gagner ~7 points de précision par rapport au parser v1. La détection automatique des "X mister X" introduite en v2.1 a auto-résolu plusieurs cas qui auraient été en errors auparavant.

⚠️ **Limite découverte le 10 mai 2026 nuit** : le score auto de 96-97% inclut quelques **faux positifs invisibles** (cas "adresse partagée"). Sur l'audit complet de 4 362 factures, 12 étaient mal attribuées (0.275%). Le **score réel après audit est donc ~99.7%** au lieu des ~96.6% affichés.

---

## 🐛 Pièges connus & cas tordus rencontrés

### 1. Adresse PDF différente de la base (fusion Shopify)
**Cause** : Lors de l'import WinBiz, fusion automatique avec un client Shopify existant à la même adresse → l'adresse Shopify "propre" écrase l'adresse WinBiz "sale". Le PDF WinBiz garde la version originale.

**Exemples concrets** :
- MENEGALLI Orlando : PDF dit "Rue des Alpes 8, 1006 Lausanne" / base dit "Avenue de Provence 10, 1007 Lausanne" (déménagement)
- VENETZ-SUTTER Laurent : PDF dit "Chemin de Bellecombe 22B" / base dit "Route de la Conversion 308" (déménagement ou 2e résidence)
- Hermann Nadia : PDF dit "Rte de Morlens 95, 1674 Morlens" / base dit "Rte de l'Ancienne Ferme 10, 1680 Romont FR" (déménagement)

**Solution** : la recherche par nom seul (étape 3 du matching) récupère ces cas.

### 2. Doublons clients dus aux accents et variantes typographiques
Documenté dans la section "Bugs connus". À noter : **les variantes d'espaces** comme "Rochat-Guignard" vs "Rochat - Guignard" (espaces autour du tiret) cassent aussi les recherches strictes. Toujours élargir le pattern de recherche quand on cherche un doublon potentiel.

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

### 7. Adresse magasin imposée par WinBiz (clients "à l'emporter")
**Cause** : Quand un client achète au magasin sans donner d'adresse personnelle, WinBiz force l'adresse magasin (`Route de Lavaux 425, 1095 Lutry`) pour l'export. Ces clients existent en base mais avec `rue=null, npa=null, ville=null` (importés vides), ce qui rend le matching par adresse impossible (le filtre renvoie tous les clients résidant au magasin).

**Exemples concrets sur 2022** (7 factures) : MARCHESI Francine, MOREL-FAVRE Christine, RENEVEY Carole, ROCHAT-GUIGNARD Isabelle, PARMIGIANI Tino, TERCIER, WATTS Robert.
**Exemples concrets sur 2023** (9 factures) : FELL Claude, ABBONDANZIERI Katia, Hi Ying Mei, BOURGOZ Dominique, LAURENT Frédéric, NORDMANN Philippe, FAIVELEY François, DE KERCHOVE Vincent, BARBIER.

**Solution** : recherche par nom seul (étape 3 du matching). Les clients sont en base — il suffit de les trouver autrement que par adresse.

**Amélioration future possible** : détecter `npa=1095 AND ville=Lutry AND rue=Route de Lavaux 425` au parsing → basculer directement sur recherche par nom seul (skip le filtre adresse).

### 8. Clients WinBiz volontairement masqués (`X mister X`)
**Cause** : WinBiz exporte certaines factures avec le nom de client masqué (titre `CLIENT-X mister X X  X  X  X X  codex...`). Probablement des factures sans client identifié, des tests, ou des factures avec une exigence de confidentialité.

**Exemples concrets (exercice 2025)** : 2 factures #52617 et #52619 (achats FATBOY 2024 modestes : 278 et 118 CHF).

**Solution adoptée** : création d'un client générique `Anonyme` (CL-22090) en base, avec une `notes` explicative. Les factures sont rattachées à ce client générique pour ne pas perdre la trace comptable.

### 9. Préfixe pays collé au NPA sans espace (`74440 F-CHAMONIX`)
**Cause** : Format français inversé — au lieu de `F - 74440 Chamonix` (que mon stripper gère), WinBiz exporte `74440 F-CHAMONIX` (NPA puis `F-` collé à la ville).

**Exemples concrets** : facture #53452 (2025) et #49408 (2022) DUNAND Valérie F-Chamonix → parser tombe en `errors`. Le client était bien en base (id=16085).

**Solution actuelle** : traitement manuel via le fix.

**Amélioration future possible** : ajouter au parser un nettoyage `ville = ville.replace(/^(F|D|I|A|FL)-/i, '')` après extraction.

### 10. NPA tronqué juste avant `__FACTURE`
**Cause** : Certains noms de fichiers très longs tronquent juste après les premiers chiffres du NPA. Exemple :
`...BULGARI HORLOGERIE SA  Mesdames  Sonia Roca et Jenny De Marco  Rue de Monruz 34  Case postale 82  2__FACTURE-53153__...`

Le NPA `2000` est coupé à `2`. **Solution** : traitement manuel via le fix.

### 11. ⚠️ Adresse partagée par plusieurs clients distincts (bugs Grill & More + Luis/ASPL)
**Cause** : Plusieurs clients distincts en base partagent la même adresse postale, ou le matcher tombe sur le mauvais client par défaut quand le NPA seul est utilisé comme critère. Le matcher tranche au scoring nom puis ID bas, et peut tomber sur le mauvais.

**Cas concrets historiques (10 mai 2026)** :
1. **Grill & More vs Nestlé** : 7 factures Grill & More Lausanne Sàrl (2021-2023) rattachées à CL-17616 (Société des Produits Nestlé SA Invoice Center) au lieu de CL-16981 (Grill & More Company SA).
2. **Luis Ismael [ASPL] vs Chopard/EPIS/Dubar** : 5 factures de 3 clients distincts (Chopard CL-15242, EPIS TAFF CL-16255, Dubar CL-16019) — tous résidant à Biel mais à des adresses différentes — rattachées par erreur à Luis Ismael (CL-13222, Zentralstrasse 53, Biel).

**Détection** : invisible au moment du match (matchStrategy `auto`). Repéré soit manuellement (Grill & More) soit via le script `audit-adresse-partagee.js` (Luis/ASPL).

**Solution** :
1. Script `audit-adresse-partagee.js` à lancer après chaque batch d'import
2. Pour chaque vrai bug trouvé, créer un `reassigner-factures-{nom}.js` (template : `reassigner-factures-grill-more.js` ou `reassigner-factures-luis-aspl.js`)
3. Lancer en mode `--apply` après vérification read-only

**Heuristique simple pour décider si c'est un vrai bug** :
- Les `nom_fichier` divergents pointent vers des **personnes/sociétés différentes en base** (vérifié via recherche) → vrai bug
- Les `nom_fichier` divergents sont juste des **variantes du même client** (Mr/Mme, typos, transcriptions) → faux positif, on garde tel quel

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
node match-factures-2026-3.js
# → Produit factures_results_2026-3.json

# 4. Inspecte les "multiple", "notFound" et "errors" dans le JSON
#    Si nouveau client à créer → étape 4a
#    Sinon → étape 5

# 4a. (si nécessaire) Crée les clients manquants
# Adapte un script du type creer-XXX.js
# ⚠️ Vérifie d'abord les doublons avec recherche flexible (variantes d'espaces, tirets, accents)

# 5. Remplis fix-factures-2026-3.js avec les corrections
node fix-factures-2026-3.js
# → Produit factures_results_2026-3_corrected.json

# 6. Dry-run (recommandé)
node import-factures-2026-3.js --dry-run

# 7. Import réel
node import-factures-2026-3.js
# → Upload Storage + INSERT factures_winbiz + log

# 8. Vérification SQL
# SELECT COUNT(*) FROM factures_winbiz WHERE created_at > NOW() - INTERVAL '1 hour';

# 9. 🆕 AUDIT POST-IMPORT (depuis 10 mai 2026 nuit) :
node audit-adresse-partagee.js
# → Inspecte les cas suspects, surtout ceux avec ≥3 motifs distincts
# → Pour chaque vrai bug détecté, duplique reassigner-factures-grill-more.js
#   et adapte le mapping, puis lance --apply
```

---

## 🎯 Décisions de référence durables (réutilisables pour batchs futurs)

Quand les mêmes clients reviennent dans plusieurs exercices, on conserve la même décision pour la cohérence. Voici les références accumulées :

### Sociétés multi-contacts résolues
| Société / pattern | Client retenu | ID | Origine décision |
|---|---|---|---|
| MENETREY SA (Bioley-Orjulaz) | Leffondre Karl | CL-21937 (id 21939) | Créé pour 2024 #52201 |
| Services Industriels de Genève (SIG) | SERVICES INDUSTRIELS DE GENEVE (entité) | CL-20708 | 2023, 2022 (5 factures cumulées) |
| BULGARI HORLOGERIE SA (Neuchâtel 2000) | Girolimetto Yoann (Livraison) | CL-14830 | 2023 #50912, 2025 #53153 et #53681, 2024 #52583 |
| EGEL Sàrl | Ly Van-Loc | CL-16162 | 2023 #50495, #50927, #50950 |
| Tennis Club Seeblick (Zürich) | Bernhard Andreas | CL-6232 | 2023 #51202 |
| Hôtel Bellerive (Lausanne) | Hôtel Bellerive (entité société) | CL-17470 | 2025 #53653 |
| H.M.C. Hôtel Management Corp. SA | Bellevue C/o Victoria-Jungfrau AG | CL-17233 | 2025 #53368, 2022 #49498 |
| TCS Training et Loisir SA (Vernier) | C/o Touring Club Suisse | CL-21071 | 2026-2 #80112/#53872, 2022 #49369 |
| ASICC Cercle de Corsier | Petersen Helena | CL-14435 | 2023 #51388 |
| TIR CRS SA Bern | Transfusion Interrégionale CRS SA (Finances & Controlling) | CL-21191 | 2022 #49258 |
| EMS La Sombaille (Chaux-de-Fonds) | Veya Jean-Pierre | CL-08860 (Shopify avec email) | 2022 #50052 |
| LEDUNFLY SA (Nyon) | Geindreau Antoine (LEDUNFLY Operations) | CL-18207 | 2022 #49468, 2025 — regroupé avec Biot Olivier (employé même société) |
| EDI Médical Sàrl (Pully) | Dizdari Ernal | CL-16152 | 2022 #49871 |
| Grill & More Company SA (Lausanne) | Grill & More Company SA [GMH SA - Grill & More Lausanne Sàrl] | CL-16981 | 14 factures (2021-2025) après correction bug 10 mai 2026 |

### Cas particuliers
| Cas | Décision | Note |
|---|---|---|
| Gallegos Alejandro (commercial JC) | CL-16732 (le plus bas des 3 doublons) | Utilisé 3 fois (2023 #51299/#50957, 2024 #52389) |
| Stricker Thierry | CL-20963 | Factures internes Jardin-Confort |
| Deguemp Cécile | CL-7851 (Shopify avec email) | Utilisée 4 fois (2023 #50408, 2025 #52695/#53096, 2024 #52325) — adresse base ≠ adresse facturation OK |
| BEHR CREATEUR D'INTERIEURS | CL-3226 | 2023 #50524, 2026-2 #54085, 2022 #49338/#49713 (Lutry — décision Thierry de rassembler avec Aubonne) |
| Begault Christine (BRUELLAN) | CL-3216 (Crans-Montana) | 2023 #51116 |
| Dunand Valérie F-Chamonix | CL-16085 | Cliente française (utilisée 2025 et 2022) |
| Abrial Jacques (France) | CL-14205 | 2023 #51031 |
| Tavassoli Alexandre / CLINIQUE LES ALPES | CL-17476 | 2024 #52530, 2022 #49255 |
| Edwards David | CL-16156 | 2024 #51550, 2022 ×3 (#49284, #50276, #49500) |
| Burnand Jérôme | CL-4274 (Shopify avec email) | 2024 #51629, 2022 ×2 (#49508, #49838) |
| Ruedi Kym | CL-19865 (Frenkendorf) | 2024 #52571 (a probablement déménagé à Basel) |
| Hermann Nadia | CL-17371 (Romont, base ≠ Morlens facture) | 2022 #49699 |
| Pariente Steven (Conches) | CL-19429 | 2022 #49865 |
| Cornu Anne-Sophie (Epalinges) | CL-15418 | 2022 #49989 |
| Biolley et Pollini (Lausanne) | CL-3430 | 2022 #49793 |
| Nicod Cyril | CL-19200 (St-Gingolph 1898) | 2022 #50308 (Bouveret 1897 sur facture — décision Thierry : même client, NPA voisin) |
| Gosselke - Zbinden Jacqueline | CL-17037 (Montreux, base ≠ Forel-Lavaux facture) | 2022 #49297 |
| Mermoud André (Lausanne) | CL-18761 | 2022 #50087 |
| Hôtel Montreux Palace SA | CL-17487 (2 doublons, ID bas) | 2022 #49893, #50133 |
| AROBUZZ INC / Therrien Julie (Canada) | CL-14411 (2 doublons, ID bas) | 2022 #50018 |
| FINM CO / D'Angelo Giovanni (Canada) | CL-16466 | 2022 #50019 |
| Chopard-Gnägi René et René (Biel) | CL-15242 | 2 factures réassignées depuis CL-13222 (audit 10 mai 2026) |
| Reist Alain [EPIS TAFF BIENNE] | CL-16255 | 1 facture réassignée depuis CL-13222 (audit 10 mai 2026) |
| Dubar Marie-Hélène (Biel) | CL-16019 | 2 factures réassignées depuis CL-13222 (audit 10 mai 2026) |
| Al Mojil Adel / Almeajel Fatemah | CL-14270 (transcription arabe d'un couple) | Confirmé légitime via audit 10 mai 2026 |
| Damseaux Tabet Clara / Tabet Amine | CL-15580 (nom de mariage : couple) | Confirmé légitime via audit 10 mai 2026 — note : doublon avec CL-13482 (Damseaux Clara) à fusionner un jour |

### Clients créés ex nihilo (clients qui n'existaient pas en base avant)
| Client | Numero / ID | Créé pour |
|---|---|---|
| Leffondre Karl (MENETREY SA) | CL-21937 / id 21939 | 2024 #52201 |
| Fondation Asile des Aveugles | CL-22088 / id 22089 | 2026-2 #53854 |
| Varone Christelle | CL-22089 / id 22090 | 2023 #51078, #51210 |
| Anonyme (factures masquées WinBiz) | CL-22090 / id 22091 | 2025-2 #52617, #52619 |
| HOPITAL JULES GONIN - FAA | CL-22091 / id 22092 | 2025-2 #52999 |
| Pittet Anne / TRICYLE Sàrl (Café Saint Pierre) | CL-22093 / id 22093 | 2022 #49193, #49459 |
| Weiss Yael | CL-22094 / id 22094 | 2022 #49924 |

→ **Pattern récurrent à anticiper** : si une facture concerne un acteur public/médical/société complexe non encore en base, c'est probablement à créer. Le script `creer-XXX.js` est à dupliquer/adapter à chaque fois.

---

## 📖 Tableau récapitulatif des scripts

| Script | Rôle | Réutilisable ? |
|---|---|---|
| `match-factures-{ex}.js` | Parsing PDFs + matching client + anti-doublon niveau 1 | ✅ Oui (changer chemins en haut) |
| `fix-factures-{ex}.js` | Corrections manuelles des multiples/notFound/errors | ⚠️ Spécifique à chaque batch (corrections différentes) |
| `import-factures-{ex}.js` | Upload Storage + INSERT + anti-doublon niveau 2 + dry-run | ✅ Oui (changer chemins) |
| `creer-XXX.js` | Création one-shot d'un client manquant | ❌ One-shot, à dupliquer pour chaque cas |
| `verifier-clients-{ex}.js` | Recherches client ad-hoc (recherches en base) | ✅ Oui (modifier les `search()` selon les besoins) |
| `verifier-dernier-numero-client.js` | Trouve le prochain CL-XXXXX libre | ✅ Oui |
| **`audit-adresse-partagee.js`** 🆕 | **Audit complet de la base pour détecter bugs type Grill & More** | ✅ **Oui — à lancer après chaque batch** |
| `diagnostic-grill-more.js` | Audit "factures avec keyword X regroupées par client" | ✅ Oui (modifier le keyword) — modèle pour audit ciblé |
| `diagnostic-3-cas-suspects.js` | Inspection détaillée d'une liste de client_id suspects | ✅ Oui (modifier la liste d'IDs et les recherches) |
| `reassigner-factures-grill-more.js` | UPDATE `client_id` en bulk pour réassigner des factures | ✅ Oui (template pour chaque correction de masse) |
| `reassigner-factures-luis-aspl.js` | UPDATE `client_id` vers plusieurs cibles selon mapping | ✅ Oui (template pour réassignations 1→N) |

**Tous ces scripts vivent dans `C:\Users\ezefi\`** (pas dans le repo Next.js).
**Pas de git push à faire après leur exécution.**

---

## 🧹 Limites du système actuel & recommandations

### Limite 1 — Le titre PDF ne contient ni email ni tel
Quand on crée un client à la volée (cas Leffondre, Fondation Asile, Pittet, Weiss), il aura `email = null` et `tel1 = null`. Si ce même client existe dans Shopify avec un email, on rate l'opportunité de fusion riche.

**Recommandation** : faire un **import incrémental WinBiz tous les 3-6 mois** pour rafraîchir les adresses et chopper les nouveaux clients sans les créer à la volée. Ça évite l'accumulation de "clients orphelins" à créer un par un.

### Limite 2 — Pas de numéro client WinBiz d'origine en base
Quand on crée un client à la volée, il reçoit un nouveau `numero_client` Supabase (ex. CL-22093). Mais WinBiz a son propre numéro client interne. Si plus tard on réimporte WinBiz "proprement", on peut avoir des doublons.

**Recommandation future** : ajouter une colonne `winbiz_client_id` à `clients` pour stocker le n° WinBiz d'origine et éviter les doublons lors de futurs réimports.

### Limite 3 — Le `fix-factures` est manuel et fastidieux pour les gros volumes
Sur 2024 : 72 corrections manuelles. Sur 2022 : 45. Sur 2026-2 : 3. Le scoring intégré au match a beaucoup réduit le besoin, mais il reste des cas tordus (sociétés multi-contacts, adresses changées, adresses partagées) qui requièrent une décision humaine.

**Recommandation** : pas d'amélioration urgente, le pipeline tient bien la route. À surveiller seulement si un batch génère >10% de multiples.

### Limite 4 — Bug "adresse partagée" invisible au match
Voir bugs Grill & More et Luis/ASPL : le matcher peut auto-résoudre vers le mauvais client sans aucun signal d'alerte. **2 bugs trouvés sur 4 362 factures = 0,275%** — c'est rare mais ça existe.

**Recommandation** : audit SQL ou via `audit-adresse-partagee.js` après chaque batch d'import. C'est devenu une étape officielle du pipeline (étape 4 / 5).

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
node match-factures-2022.js
node fix-factures-2022.js
node import-factures-2022.js --dry-run
node import-factures-2022.js
node audit-adresse-partagee.js
```

### PowerShell — vérification taille fichier
```powershell
Get-Item C:\Users\ezefi\fix-factures-2022.js | Select-Object Name, Length
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
    WHEN date_facture BETWEEN '2021-10-01' AND '2022-09-30' THEN '2022'
    WHEN date_facture BETWEEN '2022-10-01' AND '2023-09-30' THEN '2023'
    WHEN date_facture BETWEEN '2023-10-01' AND '2024-09-30' THEN '2024'
    WHEN date_facture BETWEEN '2024-10-01' AND '2025-09-30' THEN '2025'
    WHEN date_facture BETWEEN '2025-10-01' AND '2026-09-30' THEN '2026'
    ELSE 'autre'
  END as exercice,
  COUNT(*),
  SUM(montant) as total_chf
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

-- 🆕 AUDIT "adresse partagée" version SQL
-- (alternative au script audit-adresse-partagee.js — peut tourner directement dans Supabase SQL Editor)
SELECT
  c.id, c.numero_client, c.nom, c.societe,
  COUNT(*) AS nb_factures,
  COUNT(DISTINCT LEFT(f.nom_fichier, 50)) AS nb_motifs_distincts,
  STRING_AGG(DISTINCT LEFT(f.nom_fichier, 80)::text, ' | ' ORDER BY LEFT(f.nom_fichier, 80)::text) AS motifs
FROM factures_winbiz f
JOIN clients c ON c.id = f.client_id
GROUP BY c.id, c.numero_client, c.nom, c.societe
HAVING COUNT(*) > 1 AND COUNT(DISTINCT LEFT(f.nom_fichier, 50)) > 1
ORDER BY nb_motifs_distincts DESC, nb_factures DESC
LIMIT 50;
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

*Dernière mise à jour : 10 mai 2026, nuit (post-audit) — exercice 2022 importé (1 109 factures, 100%) ; 2 bugs "adresse partagée" corrigés (Grill & More + Luis/ASPL = 12 factures réassignées) ; audit complet de la base : 99,725% propre ; total base 4 362 factures / CHF ~11 844 000 sur 5 exercices ; nouvelle étape audit ajoutée au pipeline officiel.*