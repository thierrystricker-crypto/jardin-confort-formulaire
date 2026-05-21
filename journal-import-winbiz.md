# 📚 JOURNAL — Import des factures WinBiz dans Supabase

**Projet** : jardin-confort-formulaire
**Localisation des scripts** : `C:\Users\ezefi\`
**Supabase URL** : `https://llkyzspixrbtoprtmvoh.supabase.co`
**Bucket Storage** : `factures` (sous-dossiers par année : `2020/`, `2021/`, `2022/`, ...)
**Table cible** : `factures_winbiz`

---

## 🎯 Objectif général

Importer en masse les PDFs de factures WinBiz (exportés sur Google Drive) vers Supabase, en les rattachant aux bons clients existants. Chaque facture devient consultable depuis le dashboard `/dashboard/clients/[id]` du projet.

---

## 📅 Convention exercice comptable

**RÈGLE D'OR** : les exercices comptables vont du **1er octobre au 30 septembre**.

| Exercice | Période civile |
|---|---|
| Exercice 2020 | 1.10.2019 → 30.09.2020 |
| Exercice 2021 | 1.10.2020 → 30.09.2021 |
| Exercice 2022 | 1.10.2021 → 30.09.2022 |
| Exercice 2023 | 1.10.2022 → 30.09.2023 |
| Exercice 2024 | 1.10.2023 → 30.09.2024 |
| Exercice 2025 | 1.10.2024 → 30.09.2025 |
| Exercice 2026 | 1.10.2025 → 30.09.2026 (en cours) |

**Piège classique** : ne pas confondre "exercice 2021" (1.10.20 → 30.09.21) avec "année civile 2021". Les requêtes SQL doivent toujours filtrer par `date_facture BETWEEN 'YYYY-10-01' AND 'YYYY-09-30'`.

**Dossiers PDFs** : un dossier par exercice sur Google Drive
- `G:\Mon Drive\Factures_winbiz\2020\` → exercice 2020
- `G:\Mon Drive\Factures_winbiz\2021\` → exercice 2021
- `G:\Mon Drive\Factures_winbiz\2025_all\` → exercice 2025 (cas spécifique du rattrapage)
- etc.

---

## 📋 Photo actuelle de la base (au 20.05.2026)

| Exercice | Factures | CA total CHF | Période |
|---|---:|---:|---|
| 2020 | 1'387 | 3'984'841.40 | 01.10.19 → 30.09.20 |
| 2021 | 1'322 | 4'528'213.80 | 01.10.20 → 30.09.21 |
| 2022 | 1'109 | 3'447'859.03 | 07.10.21 → 30.09.22 |
| 2023 | 1'000 | 2'798'845.70 | 01.10.22 → 30.09.23 |
| 2024 | 1'070 | 2'810'772.50 | 02.10.23 → 30.09.24 |
| 2025 | 1'011 | 2'884'336.05 | 01.10.24 → 30.09.25 |
| 2026 | 189 (en cours) | 628'562.75 | 04.10.25 → 11.05.26 |
| **TOTAL** | **7'088** | **21'083'431.23** | 6,5 ans d'historique complet |

**Reste à importer** : bouclage de l'exercice 2026 au 30.09.26 (~800 factures attendues).

---

## 🏗️ Architecture des 3 scripts standards

Pour chaque exercice à importer, on utilise un **triplet de scripts** + des fichiers de données intermédiaires.

### Workflow général

```
   [PDFs sur Google Drive]
            │
            ▼
   match-factures-YYYY.js  ←──── lit clients Supabase + parse noms PDF
            │
            ▼
   factures_results_YYYY.json
   (matched / multiple / notFound / errors / alreadyImported)
            │
            ▼
   [INSPECTION MANUELLE des cas problématiques]
   [→ Diagnostic SQL dans Supabase Studio recommandé]
            │
            ▼
   fix-factures-YYYY.js     ←──── corrections manuelles + création clients manquants
            │
            ▼
   factures_results_YYYY_corrected.json
            │
            ▼
   import-factures-YYYY.js ──dry-run──► [vérification]
            │
            ▼
   import-factures-YYYY.js (run réel)
            │
            ▼
   [Supabase Storage + table factures_winbiz]
   + factures_import_log_YYYY.json
```

### Script 1 : `match-factures-YYYY.js`

**Rôle** : Parse les noms de fichiers PDF, identifie le client en base, classe en 5 catégories.

**Entrée** : dossier `G:\Mon Drive\Factures_winbiz\YYYY\`

**Sortie** : `C:\Users\ezefi\factures_results_YYYY.json` avec 5 sections :

| Catégorie | Sens |
|---|---|
| `matched` | Client trouvé sans ambiguïté → prêt à importer |
| `multiple` | Plusieurs clients candidats (homonymes) → à trancher manuellement |
| `notFound` | Aucun client en base → à créer ou à matcher manuellement |
| `errors` | Parser cassé (NPA/ville absents) → à matcher manuellement |
| `alreadyImported` | Facture déjà en base (anti-doublon SQL) → skip auto |

**Stratégies de matching cascadées** (du plus strict au plus permissif) :
- `unique` : 1 seul candidat à l'adresse exacte (NPA + ville + rue ilike)
- `score_unique` : Plusieurs candidats mais un seul score nom+prénom > 0
- `score_clear` : Plusieurs candidats, le top dépasse le 2e de > 30 points
- `name_only` : Adresse introuvable → match par nom seul (1 résultat)
- `tie_lowest_id` : Plusieurs candidats à égalité parfaite → ID le plus bas pris
- `anonymous_winbiz` : Pattern "X mister X" détecté → rattaché à CL-22090 Anonyme

**⚠️ Architecture critique** : le script fait une **vraie cascade de requêtes SQL** :
1. `clients?npa=X&ville=Y&rue=ilike.Z*` → si 1 candidat → `unique` (cas le plus fréquent ~80%)
2. Sinon élargir : `npa=X&ville=Y` → scoring nom/prénom sur ces seuls candidats
3. Sinon : recherche nom seul si nom distinctif (cas adresse changée, type MENEGALLI)

**NE JAMAIS** réécrire ce script avec une version "charge tous les clients en mémoire et score". Cette approche fait remonter les clients "garbage" (CL-04494 `nom="d"`, etc.) et casse le matching. Le script 2021/2020 atteint 96-97% en cascade SQL ; toute version naïve descend à 86%.

### Script 2 : `fix-factures-YYYY.js`

**Rôle** : Applique les corrections manuelles aux cas problématiques + crée les clients manquants en pré-étape.

**Entrée** : `factures_results_YYYY.json`

**Sortie** : `factures_results_YYYY_corrected.json` (matched augmenté, autres catégories réduites)

**Structure du script** (depuis fix-factures-2021.js et fix-factures-2020.js, les plus matures) :

```javascript
// PHASE 1 — Création des nouveaux clients (option B)
const NOUVEAU_CLIENT_X = await findOrCreateClient("X", { nom, prenom, ... })

// PHASE 2 — Dictionnaires de corrections
const CORRECTIONS = {       // pour les "multiple"
  "47798": { id: 14622, numero_client: "CL-14622", nom: "Bastian", ... },
  ...
}
const NOT_FOUND_CORRECTIONS = {  // pour les "notFound"
  ...
}
const ERROR_CORRECTIONS = {  // pour les "errors"
  ...
}

// PHASE 3 — Application + écriture du JSON corrigé
```

### Script 3 : `import-factures-YYYY.js`

**Rôle** : Upload les PDFs dans Supabase Storage + insert dans `factures_winbiz`.

**Entrée** : `factures_results_YYYY_corrected.json` + dossier PDFs

**Sortie** :
- Fichiers uploadés dans `factures/YYYY/facture_<NUM>_<CLIENT_ID>.pdf`
- Lignes insérées dans `factures_winbiz`
- Log : `C:\Users\ezefi\factures_import_log_YYYY.json`

**Sécurités intégrées** :
1. **Anti-doublon niveau 2** : recheck `numero_facture` avant chaque INSERT (paranoid mode)
2. **Mode `--dry-run`** : simule sans rien écrire
3. **Vérification existence PDF** avant upload
4. **Pause 150ms** entre chaque facture pour ne pas surcharger l'API
5. **`x-upsert: true`** côté Storage → uploads idempotents

**Résilience aux erreurs réseau** : grâce à l'anti-doublon niveau 2, si le script plante en plein milieu (ECONNRESET, timeout, ...), on peut le **relancer simplement** et il reprendra là où il s'est arrêté sans créer de doublons. C'est arrivé sur l'import 2020 (facture 46901 perdue à cause d'un ECONNRESET) : relance → 1386 skippées + 1 importée = parfait.

---

## 🔑 Authentification Supabase

### ⚠️ Système de clés mis à jour le 15.05.2026

Depuis cette date, Supabase a remplacé les anciennes clés JWT (`anon` + `service_role`) par :
- **`sb_publishable_...`** (frontend, équivalent anon)
- **`sb_secret_...`** (backend, équivalent service_role, bypasse RLS)

**Pour les scripts d'import**, on utilise **`sb_secret_...`** (sinon erreur 401 "Legacy API keys are disabled" ou "row violates RLS policy").

### Où trouver la clé

Supabase Dashboard → Settings → API Keys → bouton "Reveal" sur la clé `secret`.

### Convention dans les scripts

Tous les scripts ont en haut :
```javascript
const SUPABASE_KEY = "REMPLACER_PAR_TA_CLE_SECRET_SB_SECRET_ACTUELLE"
```

À remplacer dans les **3 fichiers** du triplet (`match`, `fix`, `import`) à chaque nouvelle session.

### Future amélioration (TODO)

Migrer vers un fichier `.env` central avec `dotenv` pour éviter de coller la clé dans 10+ scripts. Workflow envisagé :

```javascript
require('dotenv').config({ path: 'C:\\Users\\ezefi\\.env' })
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
```

Pas urgent, à faire en 1 session dédiée quand on aura le temps.

---

## 🏷️ Conventions de matching client

### Hiérarchie de priorité quand plusieurs clients candidats

1. **Match adresse exacte** (rue + npa + ville)
2. **Match société + nom**
3. **Match nom + prénom + ville**
4. **Match nom seul** (dernier recours, peu fiable)
5. **Tie-break** : ID le plus bas en base (convention historique = client Shopify enrichi)

### Cas particuliers documentés

#### Client générique "Anonyme" CL-22090

Pour les factures WinBiz volontairement masquées (pattern "X mister X X X X X X" dans le nom de fichier), on rattache au client générique **CL-22090 Anonyme** (créé en mai 2026).

**Quand utiliser** :
- Pattern "X mister X" détecté automatiquement par le matcher
- Demande explicite "mettre sous mister x" pour facture isolée

#### Clients placeholder avec adresse Jardin-Confort

Quand un PDF WinBiz n'a **ni adresse ni prénom** (juste un nom de famille), 2 stratégies :

**A. Anonyme** (CL-22090) — option choisie si nom commun et risque de confusion
**B. Placeholder à l'adresse Jardin-Confort** (Route de Lavaux 425, 1095 Lutry) — option choisie si nom distinctif. Permet de retrouver le client plus tard si on identifie qui c'est.

Exemples placeholders créés :
- **CL-22340 Istanbul Grill & More** (1003 Lausanne) — exercice 2021
- **CL-22342 Jaquier** (placeholder Lutry) — exercice 2021, facture 48679
- **CL-22341 Robert** (placeholder Lutry, Mme) — exercice 2021, facture 48964
- **CL-22339 CDTEA Sierre** — exercice 2025
- **SIG Services Industriels de Genève** (Bâtiment 39, 1219 Le Lignon) — exercice 2020, factures 46389 + 46449

#### Doublons en base à arbitrer

Quand plusieurs clients identiques existent (même nom, même adresse, IDs différents), convention : **prendre le plus ancien** (ID le plus bas). Les doublons sont souvent dus à des migrations historiques WinBiz. Une session de nettoyage future pourrait les fusionner.

Exemples vus :
- Allegre Yves CL-14292 / CL-21849
- Gallegos Alejandro CL-16732 / CL-21898 / CL-21903 (×3)
- Dennig Sylvain CL-15798 / CL-21878
- Kaeser Patrick (vu en 2021)
- Fernandez - Ordonez David CL-16421 / CL-21888 / CL-21895 (×3, vu en 2020)
- Fahrni Patrick CL-16341 / CL-21884 / CL-21891 (×3, vu en 2020)
- **Graz Isabelle CL-14176 / CL-17095 / CL-17536 / CL-17541 / CL-18023 / CL-21844 / CL-21907 (×7 !, vu en 2020)**
- Gauthey Claude CL-16788 / CL-21899 / CL-21904 (×3, vu en 2020)
- Juriens Marcel CL-17824 / CL-21917 (×2, vu en 2020)
- Butty - Flouck Raphaël et Margaux CL-14879 / CL-21868 (×2, vu en 2020)
- Wenger Alexandre CL-21625 (avec ville "GENEVE", vu en 2020)
- Veillon Vincent CL-21367 (vu en 2020)
- BEHR CREATEUR D'INTERIEURS CL-03226 + CL-16202 placeholder (vu en 2020)
- LO Immeubles SA CL-18312 / CL-18313 / CL-18314 (×3, vu en 2020 et 2021)

#### Clients étrangers

Les factures à destination étrangère ont des spécificités qui cassent le parser :
- **France** : NPA 5 chiffres (`74320` au lieu de format CH `7432`)
- **Dubai** : NPA `0000` car non applicable
- **Format `CH - 1852`** : préfixe pays avec espaces qui perturbe l'extraction (✅ géré dans le parser via `stripCountryPrefix`)

Ces factures finissent parfois en `errors` du JSON match. À traiter manuellement dans le fix.

Exemples 2020 :
- SCHELLER Jean-Pierre Passage de l'Oratoire 2 FRANCE → CL-20516
- WENGER Alexandre GENEVE (sans NPA) → CL-21625

---

## 🐛 3 bugs récurrents du parser

Documentés lors du rattrapage 2025, confirmés en 2021 et 2020. À patcher un jour pour éviter qu'ils reviennent :

### Bug 1 — Adresse étrangère

Le parser cherche un NPA suisse à 4 chiffres. Quand le NPA est étranger (France 5 chiffres, Dubai 0000), il ne trouve rien → catégorie `errors`.

**Exemples** : SCHEMITICK France, Shalini Misra Dubai, ALLEGRE France, Hôtel Montreux Palace c/o CISBOX Allemagne, SCHELLER France (2020).

### Bug 2 — NPA précédé de `CH - `

Format `CH - 1852 Roche VD` au lieu de `1852 Roche VD`. ✅ Géré dans le parser 2021/2020 via `stripCountryPrefix()`.

### Bug 3 — Nom de fichier tronqué

Quand le nom complet client + adresse + référence produit dépasse ~100 caractères, le NPA est mangé en fin de string.

**Exemples** : EMS Sauvabelin, EHNV, Ville Neuchâtel, Ville Yverdon, Hôtel La Prairie, CDTEA Sion, URBAN PROJECT SA / ZIERINGER (2020 et 2021).

### Patch envisagé (TODO)

Améliorer le regex du parser pour gérer :
1. NPA étrangers (regex souple `\d{4,5}`)
2. ✅ Préfixe pays `CH\s*-\s*` à ignorer (déjà fait)
3. Recherche du NPA plus tôt dans la string (avant le tronquage)

À faire avant le bouclage de l'exercice 2026.

---

## 📂 Structure des PDFs WinBiz

### Format de nom de fichier standard

```
CLIENT-{NOM CLIENT} {SOCIETE?} {ADRESSE?} {NPA VILLE}  codex   {MARQUE} {ANNEE}  {DESCRIPTION PRODUIT}__FACTURE-{NUM}__DATE-{DD.MM.YYYY}__TOTAL_CHF-{MONTANT}.pdf
```

**Séparateur principal** : double espace. Métadonnées en suffixe.

**Exemples** :

```
CLIENT-Monsieur  DUPONT Jean  Rue de la Gare 1  1000 Lausanne  codex   GLATZ 2024  PALAZZO__FACTURE-52000__DATE-15.03.2025__TOTAL_CHF-1'500.00.pdf
```

**Patterns extractibles** :
- `__FACTURE-(\d+)__` → numéro de facture
- `__DATE-(\d{2}\.\d{2}\.\d{4})__` → date (format CH)
- `__TOTAL_CHF-([\d'.,]+)` → montant (apostrophes comme séparateurs de milliers)

### Variantes WinBiz

- **Couples** : `Monsieur et Madame DUPONT Jean & Marie`
- **Sociétés** : `SOCIETE SA  Monsieur DUPONT Jean ...` (société d'abord, contact ensuite)
- **Multi-civilités** : `Mesdames Roca et De Marco`
- **Pays préfixé** : `CH - 1852` ou `F - 74320`
- **Compléments adresse** : `Case postale 999`, `Villa Mira`, `Bât. A`
- **Floor** : `1er étage`, `2ème`
- **Numéro postal de ville** : `1000 Lausanne 6`, `1211 Genève 22` (boîte postale)
- **Parenthèses dans ville** : `La Croix (Lutry)`, `Sâles (Gruyère)`

Le parser actuel gère la plupart de ces variantes, sauf les bugs cités plus haut.

---

## 🚀 Procédure pour démarrer un nouvel import

### Étape 0 — Préparation

1. Vérifier que les PDFs sont dans le bon dossier : `G:\Mon Drive\Factures_winbiz\YYYY\`
2. Compter les PDFs attendus : `Get-ChildItem "G:\Mon Drive\Factures_winbiz\YYYY" -Filter *.pdf | Measure-Object`
3. Récupérer la `sb_secret_` actuelle depuis Supabase Dashboard

### Étape 1 — Adapter les 3 scripts

**⚠️ TOUJOURS DEMANDER LES SCRIPTS DE RÉFÉRENCE À CLAUDE**. Repartir des **scripts 2020/2021** (les plus matures). Ne pas laisser Claude réinventer le matcher de tête : il faut lui coller le vrai script comme template.

Copier-coller et remplacer **uniquement** :

| Constante | Valeur exercice YYYY |
|---|---|
| `PDF_FOLDER` | `G:\\Mon Drive\\Factures_winbiz\\YYYY` |
| `OUTPUT_FILE` / `RESULTS_FILE` | `C:\\Users\\ezefi\\factures_results_YYYY.json` |
| Output corrected | `C:\\Users\\ezefi\\factures_results_YYYY_corrected.json` |
| LOG_FILE | `C:\\Users\\ezefi\\factures_import_log_YYYY.json` |
| FOLDER (Storage) | `YYYY` |
| Header commentaires | Mise à jour année + période |
| `SUPABASE_KEY` | nouvelle clé `sb_secret_...` |

3 fichiers à créer :
- `match-factures-YYYY.js`
- `fix-factures-YYYY.js` (vide au départ, à remplir après inspection)
- `import-factures-YYYY.js`

### Étape 2 — Lancer le match

```powershell
cd C:\Users\ezefi
node match-factures-YYYY.js
```

Récupérer le récap (matched / multiple / notFound / errors / alreadyImported) et le fichier `factures_results_YYYY.json` généré.

**Si le taux matched est < 95%, c'est anormal.** Le script 2021/2020 fait 96-97% en automatique. Si tu vois 86% c'est que le script a été mal régénéré (cas vu le 19-20.05.2026 — première version naïve sans cascade SQL).

### Étape 3 — Inspecter les cas problématiques (préférence : SQL direct dans Supabase)

Pour chaque catégorie `multiple` / `notFound` / `errors`, identifier le bon client. Méthode recommandée :

1. **Construire une grosse requête SQL `WITH` qui liste les 30-50 cas à diagnostiquer** et fait un `LEFT JOIN ILIKE` sur `nom`, `societe`, `prenom` de la table `clients`
2. La lancer dans **Supabase Studio → SQL Editor**
3. Exporter le résultat en JSON ou copier-coller
4. Décider pour chaque cas : match avec client existant (ID le plus bas en cas de doublon) ou création nouveau client

**Template de requête diagnostic** :

```sql
WITH cas_a_traiter AS (
  SELECT 'MULTIPLE'::text AS cas, '46354'::text AS facture, 'Schilliger'::text AS recherche UNION ALL
  SELECT 'NOT_FOUND',  '46327', 'Longchamp'                                                 UNION ALL
  SELECT 'ERROR',      '46322', 'Schweickhardt'
  -- ... etc, une ligne par mot-clé à chercher
)
SELECT
  c.cas, c.facture, c.recherche,
  cli.id, cli.numero_client, cli.nom, cli.prenom, cli.societe, cli.rue, cli.npa, cli.ville
FROM cas_a_traiter c
LEFT JOIN clients cli
  ON  cli.nom     ILIKE '%' || c.recherche || '%'
  OR  cli.societe ILIKE '%' || c.recherche || '%'
  OR  cli.prenom  ILIKE '%' || c.recherche || '%'
-- Filtre anti-garbage
WHERE cli.id IS NULL
   OR (
     COALESCE(LENGTH(TRIM(cli.nom)),     0) > 2
     OR COALESCE(LENGTH(TRIM(cli.societe)),0) > 2
     OR COALESCE(LENGTH(TRIM(cli.prenom)),0) > 2
   )
ORDER BY c.cas, c.facture::int, cli.id NULLS LAST;
```

### Étape 4 — Construire le fix

Remplir les 3 dictionnaires :
- `CORRECTIONS` (pour multiples)
- `NOT_FOUND_CORRECTIONS` (pour notFound)
- `ERROR_CORRECTIONS` (pour errors)

Si des clients sont à créer, les ajouter dans la PHASE 1 du fix avec `findOrCreateClient()` (anti-doublon intégré).

```powershell
node fix-factures-YYYY.js --dry-run   # test (vérifie tous les chiffres)
node fix-factures-YYYY.js             # création + écriture JSON
```

### Étape 5 — Import

```powershell
node import-factures-YYYY.js --dry-run   # test (vérifie que tous les PDFs existent)
node import-factures-YYYY.js             # run réel (~5-10 min selon volume)
```

**Si erreur réseau en cours de run** (ECONNRESET, timeout) : juste **relancer le script**. L'anti-doublon niveau 2 reprendra là où ça s'est arrêté.

### Étape 6 — Validation

```sql
-- Compte par exercice avec dates bornes
SELECT 
  CASE 
    WHEN EXTRACT(MONTH FROM date_facture) >= 10 
      THEN EXTRACT(YEAR FROM date_facture) + 1
    ELSE EXTRACT(YEAR FROM date_facture)
  END AS exercice,
  COUNT(*) AS nb_factures,
  MIN(date_facture) AS date_min,
  MAX(date_facture) AS date_max,
  ROUND(SUM(montant)::numeric, 2) AS ca_total
FROM factures_winbiz
GROUP BY exercice
ORDER BY exercice;
```

Vérifier que l'exercice YYYY apparaît avec le bon volume et les bonnes bornes (`YYYY-1 oct → YYYY sept`).

---

## 🛟 Anti-doublons (3 niveaux de protection)

Pour éviter d'importer 2 fois la même facture :

### Niveau 1 : Anti-doublon au matching

Dans `match-factures-YYYY.js`, avant de traiter un PDF, on vérifie si son `numero_facture` est déjà en base. Si oui → catégorie `alreadyImported`.

### Niveau 2 : Anti-doublon avant INSERT

Dans `import-factures-YYYY.js`, juste avant chaque INSERT, on refait un check `SELECT id FROM factures_winbiz WHERE numero_facture = X`. Si trouvé → skip (`log.skipped`).

C'est ce niveau qui sauve la mise en cas d'erreur réseau en cours de run : on relance et les déjà-importées sont skip automatiquement.

### Niveau 3 : Contrainte SQL

La table `factures_winbiz` a (devrait avoir) une contrainte UNIQUE sur `numero_facture`. Si les 2 niveaux précédents échouent, l'INSERT plante avec une erreur 409 Conflict.

---

## 📊 Marqueurs de traçabilité

### Champ `match_confiance` dans `factures_winbiz`

Pour différencier comment chaque facture a été matchée :

| Valeur | Signification |
|---|---|
| `auto` | Match auto par le matcher (cas `matched` du JSON, a une `matchStrategy`) |
| `manuel` | Correction manuelle via le fix |
| `manuel-rattrapage` | Cas particulier des 17 factures de rattrapage 2025 (mai 2026) |

### Requête de rétroactivité

```sql
-- Voir toutes les factures importées par fix manuel
SELECT numero_facture, date_facture, montant, client_id, match_confiance
FROM factures_winbiz
WHERE match_confiance LIKE 'manuel%'
ORDER BY date_facture DESC;
```

---

## 🆘 Cas d'erreur fréquents et résolution

### "Legacy API keys are disabled"

Tu utilises l'ancienne clé JWT `eyJ...`. **Remplacer par la nouvelle `sb_secret_...`** (Settings → API Keys).

### "row violates row-level security policy"

Tu utilises la clé `sb_publishable_` (frontend, soumise aux RLS) au lieu de `sb_secret_` (backend, bypasse RLS). Remplacer par la bonne.

### "PDF introuvable"

Vérifier :
1. Le chemin `PDF_FOLDER` est-il correct ?
2. Le nom de fichier exact dans le JSON correspond-il à celui du disque ? (sensible à la casse et aux espaces)
3. Le PDF a-t-il été déplacé / renommé entre le match et l'import ?

### "401 Unauthorized" au début du run

Clé Supabase invalide ou périmée. Test rapide :
```powershell
$key = "TA_CLE"
Invoke-RestMethod -Uri "https://llkyzspixrbtoprtmvoh.supabase.co/rest/v1/clients?select=id&limit=1" -Headers @{ "apikey" = $key; "Authorization" = "Bearer $key" }
```

### "ECONNRESET" en cours d'import

Erreur réseau aléatoire. **Solution** : relancer simplement `node import-factures-YYYY.js`. Grâce à l'anti-doublon niveau 2, les déjà-importées seront skippées et seules les manquantes seront traitées.

Vu sur l'import 2020 (facture 46901 perdue → relance → 1386 skippées + 1 importée → ✅).

### Taux matched anormalement bas (< 95%)

Le script `match-factures-YYYY.js` a été mal écrit (probablement régénéré de tête au lieu d'être copié depuis 2020/2021). Vérifier qu'il fait une **vraie cascade de requêtes SQL** :
1. `clients?npa=X&ville=Y&rue=ilike.Z*`
2. `clients?npa=X&ville=Y`
3. `clients?nom=ilike.*X*` (recherche nom seul)

Si le script charge tous les clients en mémoire et fait du scoring sur les 22'000 → erreur d'architecture, il ramasse les garbage.

### Comptage final ne correspond pas aux PDFs

Causes possibles :
1. **Doublons de PDFs** dans le dossier (1 facture présente 2 fois sur disque)
2. **Facture annulée chez WinBiz** (numéro brûlé, pas de PDF correspondant)
3. **Date hors période** (facture présente mais date avant 1.10 ou après 30.09)
4. **Quelques factures pas dans les logs success** mais réellement en base (cas DIAZ 52154, MENEGALLI 52780 du rattrapage 2025)

Diagnostic : croiser PDFs sur disque (PowerShell) vs `factures_winbiz` en SQL.

---

## 📝 Sessions passées de référence

### 18.05.2026 — Rattrapage 17 factures exercice 2025
- 994 en base au départ, 19 manquantes diagnostiquées (PDFs sur disque vs imports loggés)
- Création CDTEA Sierre (CL-22339)
- 17 factures réellement importées (2 déjà en base — faux positifs au comptage initial)
- Marqueur `match_confiance = 'manuel-rattrapage'`
- Volume final exercice 2025 : 1011 factures

### 19.05.2026 — Import complet exercice 2021
- 1323 PDFs sur disque
- Match : 1287 matched + 13 multiples + 13 notFound + 9 errors + 1 alreadyImported (**97,3% auto**)
- 3 nouveaux clients créés : Istanbul Grill (CL-22340), Robert (CL-22341), Jaquier placeholder (CL-22342)
- 1 erreur post-fix corrigée : Jaquier 48679 d'abord mal assignée à CL-17704 Jaquier Alain
- 1322 factures importées, 0 erreur
- Volume final exercice 2021 : 1322 factures, CA 4'528'213.80 CHF

### 20.05.2026 — Import complet exercice 2020
- 1392 PDFs sur disque
- **Première itération ratée** : Claude a régénéré un matcher "de tête" qui ne faisait pas la cascade SQL → 86% seulement. Thierry a tiqué (« d'habitude on a 95%+ »). Réécriture en copiant fidèlement le script 2021 → 96,6%.
- Match v2 : 1345 matched + 13 multiples + 15 notFound + 14 errors + 5 alreadyImported = **96,6% auto**
- Diagnostic des 42 cas problématiques via une **grosse requête SQL `WITH ... LEFT JOIN ILIKE`** dans Supabase Studio (méthode très efficace, à reproduire)
- **1 client créé** : SIG Services Industriels de Genève (Bâtiment 39, 1219 Le Lignon) — pour factures 46389 + 46449
- 42 corrections manuelles : 41 par match en base + 2 via SIG créé
- 1387 factures à importer (1392 - 5 déjà en base)
- **1 erreur ECONNRESET sur facture 46901** au run réel → relance → 1386 skippées + 1 importée = 1387 ✅
- Volume final exercice 2020 : 1387 factures, CA 3'984'841.40 CHF

#### Décisions de matching notables exercice 2020

- **Doublons résolus par ID le plus bas** (convention) :
  - Schilliger SA Gland → CL-16762
  - Gallegos Alejandro → CL-16732 (×3 doublons en base)
  - LO Immeubles SA → CL-18312 (×3)
  - EDI MEDICAL → CL-16151 (×2)
  - Fernandez - Ordonez David → CL-16421 (×3)
  - Fahrni Patrick → CL-16341 (×3)
  - Graz Isabelle → CL-14176 (×7 !)
  - Butty - Flouck → CL-14879 (×2)
  - Juriens Marcel → CL-17824 (×2)
  - Gauthey Claude → CL-16788 (×3)
  - Uffer Filip → CL-21248 (×2)
- **Adresse changée** (match par nom + prénom uniquement) :
  - BASTIAN Françoise → CL-14622 (PDF dit Route du Jorat 44A, base dit Bois-Murat 20 Epalinges)
  - HERMANN Nadia → CL-17371 (PDF dit Morlens, base dit Romont FR)
  - NICOD Natalia → CL-19202 (PDF dit Av Milan 4, base dit Bd Grancy 3)
  - Gosselke - Zbinden Jacqueline → CL-17037
  - Veillon Vincent → CL-21367
- **Société exacte du PDF** (vs autres sociétés à la même adresse) :
  - 46478 Lully.O1 SA → CL-18392 Broccard (pas Autogrill)
  - 47588 Tertianum Romandie SA → CL-21088 Journot
- **Clients étrangers** :
  - SCHELLER Jean-Pierre FRANCE → CL-20516
  - WENGER Alexandre GENEVE (sans NPA) → CL-21625

---

## 🎯 TODO pour les sessions futures

1. **Patcher le parser** (3 bugs récurrents : NPA étranger 5 chiffres, troncature en fin de string). Le bug `CH -` est déjà géré.
2. **Migrer vers `.env`** pour la clé Supabase (au lieu de la coller dans 10+ scripts)
3. ✅ ~~Importer exercice 2020~~ — fait le 20.05.2026
4. **Boucler exercice 2026** à fin septembre 2026 (rajouter les ~800 factures restantes : 1.10.25 → 30.09.26)
5. **Nettoyer les doublons clients** identifiés ci-dessus (fusion vers ID le plus bas). Particulièrement urgent pour :
   - Graz Isabelle ×7
   - Fahrni Patrick ×3
   - Gauthey Claude ×3
   - Gallegos Alejandro ×3
   - Fernandez - Ordonez David ×3
   - LO Immeubles SA ×3
6. **Améliorer `findOrCreateClient`** dans les fix : vérifier nom + npa + **prénom** + **rue** pour distinguer un placeholder d'un vrai client (le bug Jaquier 2021 n'aurait pas existé). ✅ Déjà appliqué dans les fix 2020/2021.
7. **Tester rétroactivement** que tous les liens PDFs dans `factures_winbiz` sont accessibles (script de vérif)
8. **Documenter dans le dashboard** la convention "exercice comptable" pour que les filtres `/dashboard/clients/[id]` la respectent

---

## 📁 Fichiers de référence

Dans `C:\Users\ezefi\` :
- `match-factures-YYYY.js` / `fix-factures-YYYY.js` / `import-factures-YYYY.js` (1 triplet par exercice importé)
- `factures_results_YYYY.json` / `factures_results_YYYY_corrected.json` (à conserver pour audit)
- `factures_import_log_YYYY.json` (logs de chaque run)
- `corriger-jaquier-48679.js` (exemple de correction ciblée post-import)
- Scripts de diagnostic SQL : à privilégier sur scripts Node ad hoc pour interroger Supabase

**Triplets de référence (les plus matures)** :
- **Exercice 2021** : référence pour le parser et la cascade SQL
- **Exercice 2020** : référence pour le diagnostic SQL groupé via `WITH ... LEFT JOIN ILIKE`

**Important** : ces fichiers contiennent ta clé `sb_secret_`. **NE JAMAIS LES COMMITER SUR GIT**. Vérifier la présence d'un `.gitignore` dans `C:\Users\ezefi\` ou s'assurer que ce dossier n'est pas un repo git.

---

## 🤖 Notes pour Claude (session future)

**À FAIRE systématiquement quand on démarre un nouvel exercice** :
1. **Demander à Thierry de te coller les scripts de référence** (`match-factures-2021.js`, `fix-factures-2021.js`, `import-factures-2021.js`, ou ceux de 2020). Ne JAMAIS régénérer "de tête".
2. **Copier fidèlement** la structure : modifier uniquement les chemins, l'année dans les commentaires, et la clé Supabase. Aucune modification de la logique de matching.
3. **Privilégier les requêtes SQL directes** dans Supabase Studio pour les diagnostics, plutôt que des scripts Node ad hoc.
4. **Vérifier que le taux matched > 95%** après le match. Si < 95%, c'est que le script a été mal régénéré.
5. **Anti-doublon niveau 2** : rassurer l'utilisateur sur la possibilité de relancer en cas d'erreur réseau (ECONNRESET courant sur 1000+ factures).

**À NE PAS FAIRE** :
- ❌ Régénérer un matcher "de tête" en s'inspirant du journal. Le journal décrit le comportement, pas l'implémentation exacte.
- ❌ Charger tous les clients en mémoire et faire du scoring permissif → ramasse les garbage CL-04494 etc.
- ❌ Proposer un fix sans avoir vérifié les vrais candidats en base via SQL.
- ❌ Continuer l'import si l'utilisateur tique sur un chiffre anormal. Toujours vérifier la source du problème (script ? données ? requête ?).

---

**Dernière mise à jour** : 20.05.2026 (après import complet exercice 2020)
