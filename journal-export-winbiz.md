# Journal — Chantier « Export Winbiz »

> Le fichier bizexdoc depuis une commande du dashboard. Cadrage : `cadrage-export-winbiz.md` (v2)
> + cadrage technique d'ouverture du 29.08.2026 (rendu en conversation, validé par Thierry).
> Règle de travail : ce journal est mis à jour à chaque session ; **aucun doc projet (00–15) n'est
> écrit par ce chantier** — le bilan de passation est le seul véhicule des trouvailles.

---

## Session 1 — 29.08.2026 : cadrage validé, module pur livré, 38 tests verts

### Arbitrages pris par Thierry (29.08, session d'ouverture)

1. **Brice Chappé → initiales `BC`** (absent de la table Make ; 186 commandes sur 400). Existence du
   vendeur BC dans WinBiz à confirmer au test T7.
2. **Pro HT dès la v1** : champ Winbiz « TVA incluse dans le prix de l'article » (champ 62 du gabarit) —
   valeurs officielles **0/1 = Inclus, 2 = Exclu, vide = 0 par défaut**. Privé TTC → `1` (historique),
   Pro HT → `2`. Premier export Pro réel conditionné au test **T9**.
3. **L'état « modifiée depuis l'export » couvre révisions ET corrections** (une correction change
   l'adresse, donc le fichier).
4. **Route : `POST /api/offres/[slug]/export-winbiz`** (convention du dépôt — pas de `/api/commandes`).

### Ce que les fichiers de référence réels ont corrigé du cadrage v2

Les deux fichiers du 18.04.2026 ont été retrouvés sur le Drive et recopiés dans
`scripts/winbiz-fixtures/` (`ref_54063.csv`, `ref_53990.csv`). Relevé programmatique :

- 🔴 **Fins de ligne : LF, pas CRLF.** Le cadrage v2 (§3.1) disait « CRLF » ; les fichiers réellement
  importés avec succès sont en LF, terminés par une ligne vide (`;\n\n`). La v1 émet du LF conforme
  aux fichiers qui ont fait leurs preuves.
- 🔴 **Le champ 47 valait DÉJÀ `1` dans les fichiers du 18.04** — le cadrage supposait « champ 47
  vraisemblablement vide → défaut 0 ». Le gabarit Make de dernière génération portait déjà le verrou.
  Le bug historique « fiche 999 renommée » est donc antérieur à ces gabarits (ou passé par un autre
  canal). La règle v1 est inchangée : champ 47 = `1`, prouvé par test, sur toutes les lignes.
- **Positions exactes relevées par split, jamais à l'œil** : préfixe = champs 1–47 ; champ 48 = n° de
  ligne, 49 = type (1 article / 2 texte / 3 sous-total), 51 = description, 52 = date, 53 = qté,
  54 = prix, 56 = remise ligne (toujours 0 tant que T2 n'est pas validé), 61 = 8.10, **62 = TVA
  incluse (1/2)**, 68 = `<VAT_FIGURE=300>` ; le `0` du sous-total est au **champ 104** (le cadrage
  disait 105). Longueurs : en-tête 22 champs, adresse 88, titre 91, article 99, sous-total 129.
- Les montants Make étaient des nombres JS bruts (`1974`, `163.9`, `23.09999999999991`). La v1 émet
  depuis des **centimes entiers** avec un format sans zéro traînant (`1974`, `163.9`, `97.55`) — le
  `23.0999…` est impossible par construction (testé).

### Ce que la base a corrigé du cadrage (diagnostic SQL du 29.08, lecture seule)

- **`data._totals` absent de 335 commandes sur 400** (écrit seulement par les révisions). Le total de
  référence est **`computeTotals(data).totalAfterRounding`** recalculé, avec **contrôle croisé
  bloquant** sur la colonne `total_ttc` (les colonnes sont des recopies — doc 04 §5 bis).
- **Service libre** : `servicePrices.custom_label` porte le libellé (non documenté au cadrage).
- **18 commandes Pro (prix HT)** sur 400 → arbitrage n° 2 ci-dessus.
- Vendeurs réels : noms complets (`Michel Gédéon` 201, `Brice Chappé` 186, `Thierry Stricker` 7,
  `Fabian Coquoz` 5, `Sabrina Striberni` 1).
- 400 numéros conformes `CMD-\d{5}` (80537 → 80936). 127 commandes à rabais global %, 97 à rabais de
  ligne, 150 à arrondi manuel, 88 avec lignes commentaire, 26 avec lignes média.
- Les 5 RPC du connecteur : présentes, non concernées (tables neuves seulement).

### Le fichier clients Winbiz (T8) — relevé sur pièce

`liste dadresses étiquettes a.xls` (export « liste d'adresses, étiquettes »), **8 664 fiches,
111 colonnes**, encodage sans CODEPAGE (lu en iso-8859-1, accents corrects) :

- Colonnes utiles au match : `ad_code` (code adresse), `ad_societe`, `ad_nom`, `ad_prenom`,
  `ad_rue_1`, `ad_npa`, `ad_ville`. `ad_titre2` = politesse.
- **Confirmé : ni e-mail ni téléphone saisis** (2–3 fiches sur 8 664). `ad_codes` (code adresse
  complémentaire, la cible §6.3 du cadrage) : **vide partout** — le terrain est vierge pour le seed.
- 🔴 **1 823 fiches sur 8 664 SANS code adresse** → non matchables, à exclure du matcher.
- 🔴 **Deux codes en doublon dans le fichier : `35` et `1000`** (deux fiches chacun) — anomalie
  Winbiz à signaler ; le matcher traitera un code dupliqué comme ambigu (repli).
- **67 clés nom+prénom+NPA en doublon** sur 7 902 (Graz, Frei, Friedli ×3…) → repli ambigu, conforme
  au cadrage. **694 fiches société sans nom** → question ouverte : match `societe_npa` (prévu dans le
  CHECK de la migration) à valider avant de l'activer.
- **L'exercice n'est PAS dans le fichier** → il sera saisi à l'upload (champ du petit écran).
- 19 noms avec espace de tête, 79 NPA non suisses (5 chiffres, formats étrangers) → normalisations
  d'import.

### Livré cette session (branche à créer : `feature/export-winbiz`)

| Fichier | Contenu |
|---|---|
| `lib/winbiz-export.ts` | Module **pur** `buildWinbizCsv()` : gabarits de référence embarqués et substitués par index, centimes entiers, invariant bloquant, champ 47 = 1, champ 62 = 1/2, encodeur cp1252 sans dépendance (+ sortie UTF-8 pour T1), assainissement `;`/retours ligne, nom de fichier assaini |
| `scripts/test-winbiz-export.ts` | **38 tests** (`npx tsx scripts/test-winbiz-export.ts`) — dont les 2 tests de sécurité du prompt en tête |
| `scripts/winbiz-fixtures/ref_*.csv` | Les 2 fichiers de référence du 18.04.2026 (bytes d'origine, LF) |
| `docs/sql/010-winbiz-export.sql` | Migrations `winbiz_adresses` + `winbiz_exports` — **à exécuter dans le SQL Editor** (étape 2) |
| `journal-export-winbiz.md` | Ce journal |

Tests : **38 verts**, typecheck `tsc --noEmit` strict OK. Les deux premiers tests du chantier :
champ 47 = 1 localisé programmatiquement (vérifié d'abord sur la référence validée, puis sur le
généré) ; en repli 999, aucun fragment des données du client dans les champs 21–47 d'aucune ligne.
La reproduction « au caractère près » : en-tête et sous-total **byte-identiques** à la référence ;
adresse/article/rabais/service identiques hors champs de valeur (n°, description, quantité, prix).

### Décisions techniques de la session (à reprendre au bilan)

- Total de référence = `computeTotals(data)`, jamais `data._totals` ; écart avec `total_ttc` → refus.
- Pro HT : somme des lignes = total **HT** (`totalAfterRounding`), champ 6 = cette somme ; **T9
  tranchera** si Winbiz attend le TTC au champ 6.
- Rabais de ligne : prix unitaire **net** émis + mention « (dont rabais X/pce, prix brut Y) »,
  champ 56 laissé à 0 (T2) ; rabais non divisible par la quantité en centimes → **refus** (jamais
  d'à-peu-près dans un fichier comptable).
- Lignes `comment` → lignes texte type 2 ; lignes `media` exclues ; pas de titres de marque
  auto-générés en v1 (le document du dashboard n'a pas cette notion — les commentaires la portent).
- Politesse (champ 45) : constante « Monsieur » du gabarit — inerte pour une fiche existante
  (champ 47 = 1) ; à raffiner si un jour l'app porte la civilité.
- Caractère non représentable en cp1252 → `?` + warning listé, jamais silencieux ; `−` (U+2212,
  affichage des remises) transposé en `-`.
- `genererRunId()` est exporté mais impur par nature : la **route** fournit `runId`, le module reste pur.
- Fixtures de référence : le test neutralise une éventuelle conversion CRLF de git (`autocrlf`).

---

## Session 1 (suite) — 29.08.2026 : étapes 2 et 3

### Étape 2 — migrations passées et vérifiées

`010-winbiz-export.sql` exécuté par Thierry dans le SQL Editor (« Success. No rows returned »).
SELECT de contrôle (doc 04 §12) : colonnes conformes, RLS **activée sans policy** sur les deux tables
(service_role only, comme le reste), index `winbiz_adresses_match_idx` et contraintes UNIQUE en place.

### Étape 3 — matcher + upload + écran

**`lib/winbiz-match.ts`** (pur, **19 tests verts** — `npx tsx scripts/test-winbiz-match.ts`) :

- `matchClient(client, candidatsNpa)` : match fort **nom+prénom+NPA** normalisés (accents, casse,
  espaces, tirets, apostrophes), **rue en départage** sur les homonymes, repli 999 sur zéro ou
  plusieurs candidats — la raison porte les codes en cause. Jamais de choix silencieux.
- Cas société sans personne : `societe_npa`, **uniquement quand la commande n'a pas de nom** — jamais
  en second choix derrière un nom qui n'a pas matché. ⚠️ À valider à l'usage (décision de session).
- `preparerAdresses()` : trim (espaces de tête du fichier réel), **fiches sans code écartées**,
  **codes portés par plusieurs fiches écartés en bloc** (un code ambigu ne doit jamais être
  attribuable). Partagée entre la route d'upload et les tests.
- La route d'export (étape 4) fournira les candidats par `exercice + npa` ; le module refiltre
  (défense en profondeur, testée).

**Upload** — le fichier réel pèse ~15 Mo, au-dessus du **plafond de corps Vercel ~4,5 Mo**
(doc 04 §5 ter) : le `.xls` est donc **parsé dans le navigateur** et seules les 7 colonnes utiles
montent (payload mesuré : **0,83 Mo**).

- `public/vendor/xlsx.full.min.js` — SheetJS 0.18.5 **vendorisé** (pas de CDN au runtime, pas de
  dépendance npm ; version npm la plus récente ; usage borné à un fichier que Thierry exporte
  lui-même, sur une page derrière le verrou). Il émet des avertissements console « Missing Info for
  XLS Record 0x27d » sur ce fichier : **bruit sans conséquence**, le contenu est complet.
- `app/dashboard/winbiz-adresses/page.tsx` — écran : choix de l'exercice (défaut = exercice comptable
  courant, oct→sept), analyse du fichier avec aperçu (fiches lues / exploitables / écartées / codes
  dupliqués), chargement, état des exercices en base. **L'exercice n'est pas dans le fichier** — il
  se saisit ici, avec l'avertissement « codes par exercice » à l'écran.
- `app/api/winbiz-adresses/upload/route.ts` — POST : validation bornée, re-exécution de
  `preparerAdresses` côté serveur (jamais le payload tel quel — doc 04 §5 ter), **remplacement par
  exercice** (delete puis insert par **lots de 1 000** — leçon des statement timeout sur tables
  indexées), échec d'insertion **jamais maquillé** (l'exercice à moitié chargé est annoncé, un
  re-upload repart propre).
- `app/api/winbiz-adresses/route.ts` — GET : exercices chargés (nb de fiches, dernier import).

**Simulation de bout en bout sur le vrai fichier** (SheetJS → mapping → `preparerAdresses`) :
8 664 lues → **6 837 exploitables**, 1 823 sans code, codes 35 et 1000 écartés — identique au relevé
Python indépendant du matin. Typecheck `tsc --noEmit` strict : **0 erreur** (routes et page comprises,
types Next/React 16.2.3 / 19.2.4).

### Prochaines étapes

1. ✅ ~~lib pur + tests (38)~~
2. ✅ ~~Migrations SQL Editor + contrôle~~
3. ✅ ~~Upload fichier clients + matcher (19 tests)~~ — smoke test preview à faire au premier upload réel
4. Route `POST /api/offres/[slug]/export-winbiz` + webhook Make « Dépôt Winbiz »
   (`WINBIZ_DRIVE_WEBHOOK_URL` + `WINBIZ_DRIVE_API_KEY`, dossier « Exports_Winbiz_App », test distinct)
5. Le bouton (3 états, révisions + corrections, attribution affichée avant confirmation)
6. Tests d'import T1–T9 dans WinBiz, sur documents et client de test, avant toute production
