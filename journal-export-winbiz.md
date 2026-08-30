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

### Smoke test étape 3 — fait le 29.08 au soir

Upload du fichier réel depuis la preview : aperçu conforme (8 664 → 6 837, codes 35/1000 signalés),
chargement OK, **contre-vérifié en base** : 6 837 fiches exercice 2026, fiche témoin 1003 propre
(espace de tête retiré, accents intacts — 661 villes accentuées), zéro fiche sans code, zéro 35/1000.

📌 **Précision de Thierry (29.08 au soir) : l'export Winbiz contient TOUTES les adresses, pas
seulement celles du dernier exercice — il ne peut pas être filtré par exercice.** Conséquence : le
champ « exercice » de l'écran n'est pas un filtre mais une **étiquette de fraîcheur** (l'exercice
ouvert dans Winbiz au moment de l'export) — ce que l'écran disait déjà. Charger tout est voulu (plus
de fiches matchables). Question dérivée pour **T7** : si l'export porte un code global par fiche, la
contrainte « codes par exercice » est peut-être plus douce que le cadrage le supposait.

---

## Session 1 (suite) — 29.08.2026 : étape 4, la route d'export et le dépôt Drive

**`app/api/offres/[slug]/export-winbiz/route.ts`** (typecheck strict 0 erreur) :

- **GET** = l'état pour le bouton, à blanc : attribution prévue (« sera attribuée à {code} {nom} » /
  « partira sur le client 999 ({raison}) »), fraîcheur du fichier clients, exports passés, drapeau
  « révisée OU corrigée depuis le dernier export » (arbitrage du 29.08 — les deux comptent),
  `webhook_configure`. Aucune écriture.
- **POST** = génération (module pur, invariant bloquant) → **trace d'abord** (`winbiz_exports`,
  `version = max+1`, l'UNIQUE ferme la course entre deux clics) → dépôt webhook → statut
  `genere → depose | erreur` avec l'erreur consignée. **Statut de réponse du webhook LU** (un 401 ne
  lève pas d'exception — leçon du chantier 2). `sha256` du contenu cp1252 dans `contenu_hash`.
- **Fichier clients d'un autre exercice que la commande → repli 999 « sans fichier »**, jamais de
  match sur un fichier périmé (le pire des modes de panne, cadrage §6.2.4). Fraîcheur > 30 jours →
  avertissement non bloquant.
- **Preview → dossier de TEST** : le payload part avec `test: true` dès que `VERCEL_ENV ≠ production`.
  Impossible de déposer un fichier de test dans le dossier de production depuis une preview.

**Côté Make et Drive (créés par le connecteur, le 29.08)** :

- Dossiers Drive **`Exports_Winbiz_App`** (prod) et **`Exports_Winbiz_App_TEST`**, neufs, à la racine
  du Drive `direction@`. ⚠️ Relevé au passage dans le blueprint de référence : le flux Make
  historique déposait ses bizexdoc **dans `Factures_winbiz`** — le dossier du flux inverse. Le
  dossier dédié n'était pas un luxe.
- Webhook **« JC - Depot Winbiz »** (id 3629839, `gateway-webhook`) — **sans clé API à la création**
  (l'API Make ne crée pas de clés) : ⚠️ **à fermer par Thierry dans l'interface Make avant le premier
  test** — Webhooks → JC - Depot Winbiz → API key auth, créer une clé NEUVE (jamais celle de la
  validation d'offre), en-tête `x-make-apikey`.
- Scénario **« JC - Depot Winbiz (app -> Drive) »** (id 7153710, **actif**) : webhook → routeur →
  2 dépôts Drive. Sécurité dans le bon sens : **seul un `test: false` explicite va en production**,
  tout le reste (test true, champ absent, valeur inattendue) part dans le dossier TEST.

**Variables Vercel à créer (Production + Preview + Development)** : `WINBIZ_DRIVE_WEBHOOK_URL` (l'URL
du webhook, visible dans Make) et `WINBIZ_DRIVE_API_KEY` (la valeur de la clé créée ci-dessus).
Rappel chantier 2 : un déploiement doit être **postérieur** aux variables pour les voir.

### Prochaines étapes

1. ✅ ~~lib pur + tests (38)~~
2. ✅ ~~Migrations SQL Editor + contrôle~~
3. ✅ ~~Upload fichier clients + matcher (19 tests) + smoke test réel~~
4. ✅ ~~Route export + scénario Make + dossiers Drive~~ — reste la clé webhook + les 2 variables
   Vercel (Thierry), puis smoke test preview sur CMD-80666 (dossier TEST)
5. ✅ ~~Le bouton~~ — `components/ExportWinbizBlock.tsx` (composant autonome, patron
   RevisionsHistoryBlock) + **2 lignes additives** dans `app/dashboard/[slug]/page.tsx` (import +
   insertion, ancres uniques vérifiées, diff contrôlé — le garde-fou auto-save du dépôt n'est pas
   dans ce fichier, rien d'autre n'a bougé). Les 3 états du cadrage §7.7 : jamais exporté / exporté
   v{n} avec ré-export confirmé / ⚠️ révisée-corrigée depuis l'export. Attribution TOUJOURS affichée
   avant confirmation, avertissements restitués, badge Pro HT, historique des versions.
   Webhook « JC - Depot Winbiz » **verrouillé par clé** (vérifié par l'API le 29.08 au soir :
   apikey [229253], en-tête x-make-apikey) ; variables Vercel posées par Thierry.
6. Smoke test preview : CMD-80666 → fichier dans le dossier **TEST** ; puis tests d'import T1–T9
   dans WinBiz, sur documents et client de test, avant toute production

---

## Session 1 (suite) — 30.08.2026 : premier import RÉEL dans WinBiz, et ses retours

**Le circuit complet a été validé de bout en bout** : bouton (preview) → génération → trace
`winbiz_exports` v1 `depose` → dépôt dans `Exports_Winbiz_App_TEST` (vérifié par l'API Drive) →
fichier contrôlé octet par octet (cp1252 réel, LF, champ 47 = 1, invariant 193.50 au centime) →
**import dans WinBiz par Thierry, réussi**.

### Ce que l'import de test a tranché (captures + PDF à l'appui)

- **T1 (encodage) : cp1252 VALIDÉ** — accents parfaits dans WinBiz (« Société », « extérieur »).
- **T3 (ligne rabais) : variante Make VALIDÉE** — Rabais 10 % à −21.59, TVA 8.10 % Incl., total et
  TVA (14.50) justes. « Les lignes de rabais semblent très bien » (Thierry).
- **T7 (moitié « protection ») : champ 47 = 1 VALIDÉ** — la fiche 999 s'appelle toujours
  « Import Import », rien n'a été écrasé. Reste l'autre moitié : l'attribution sur un vrai code.

### Les 4 champs vides relevés par Thierry — et la découverte au passage

Recherche dans la doc officielle (champs 1–159) avant tout patch :

- 🔴 **Le champ 12 n'est PAS le vendeur : c'est le « Compte d'escompte »** (doc officielle). Le guide
  historique et le flux Make y écrivaient MG/TS **pour rien** — c'est pour ça que la colonne
  Commercial restait vide à l'import. Le vrai champ est le **134 « Code du commercial » C(20) »**
  (section Document, porté par les lignes).
- **Champ 5 « Référence » C(250)** = « Notre référence » à l'écran → désormais le **numéro CMD
  complet** (lettres permises, seule la numérotation du champ 1 est numérique).
- **Champ 135 « Votre référence » C(250)** → la référence saisie sur la commande (`data.reference`).
- **« Expédition » n'existe pas dans le format d'import** (champs 1–159 relevés) — limite à
  connaître ; le champ 142 « Délai de livraison » N(4) existe si un jour on veut y mettre des jours.

**Patch du module** (42 tests verts, tsc 0 erreur) : champ 5 posé sur l'en-tête ET le préfixe de
toutes les lignes ; **lignes étendues à 135 champs** (les longueurs étaient déjà variables dans les
fichiers validés : 88/91/99/129) avec champ 134 = initiales du vendeur (vide + warning si inconnu —
jamais un code inventé) et champ 135 = référence ; **champ 12 rendu à `<AUTO>`** (plus jamais les
initiales dans un champ de compte d'escompte). Les tests de gabarit comparent toujours au caractère
près sur la longueur de la référence, en n'exemptant que le champ 5 (divergence voulue, testée à
part) ; l'extension doit être vide hors 134/135.

⚠️ **À re-vérifier au prochain import de test** (le champ 134 est un CODE de commercial WinBiz — il
faut que TS/MG/BC… existent dans la liste des commerciaux WinBiz, sinon le champ restera vide ou
sera refusé) : ré-importer un fichier v2 et contrôler Commercial, Notre référence, Votre référence —
et que la fiche 999 est toujours intacte.

### Compléments du 30.08 (retours de Thierry, même session)

- **Notes de la commande → champ 19 « Notes » C(250)** de l'en-tête et du préfixe : `Remarques: … |
  Interne: …` (remarques visibles client + notes internes), étiquetées, tronquées à 250 avec
  warning. La comptable les voit dans WinBiz et peut les supprimer. À contrôler au prochain import :
  où WinBiz les affiche, et qu'elles ne partent PAS sur la facture imprimée du client.
- **« Expédition » : champ inexistant dans le format d'import** — re-vérifié dans la doc officielle
  (aucun champ expédition/livraison/transport sur les 159). La liste de valeurs pré-enregistrées de
  WinBiz (Emporté de notre magasin, Livraison par transporteur, Poste…) ne se remplit qu'à la main —
  ou le jour de l'API. Limite actée. (Piste voisine non exploitée : champ 140 « Code de la condition
  de paiement » — possible de mapper le paymentMode si les conditions WinBiz ont des codes connus ;
  non fait, à décider.)
- Suite de tests : **44 verts**.

### Import v2 (30.08) : Notre référence ✓ — Commercial toujours vide → ligne texte

L'import v2 a confirmé **Notre référence** (champ 5 ✓). Le **Commercial reste vide** : le champ 134
attend des codes de commerciaux définis dans WinBiz, qui n'existent pas — et Thierry se souvient que
**le flux Make n'y arrivait pas non plus**. Solution retenue (proposée par Thierry) : le conseiller
part AUSSI en **ligne texte libre n° 2, juste sous la ligne d'adresse** — « Conseiller: Michel
Gédéon (MG) » — sur le gabarit texte nu (sans champs TVA). Le champ 134 reste émis : il s'activera
tout seul si des codes de commerciaux sont un jour créés dans WinBiz.
« Expédition » : définitivement acté comme absent du format d'import — **le mode de livraison de la
commande (`deliveryMode`) part sur la même ligne texte** : « Conseiller: … (TS) | Expédition:
Livraison à domicile ».
**Adresse de facturation confirmée comme seule source** (PS de Thierry du 30.08) : c'était déjà le
cas par construction — les champs racine du document SONT la facturation, les champs `livr*` ne sont
jamais lus — désormais verrouillé par un test dédié (aucun fragment de l'adresse de livraison ne
peut apparaître dans le fichier). **46 tests verts.**

### Rabais de ligne : passage à l'encodage NATIF — c'est le test T2, en cours

Retour de Thierry sur l'import 80936 : la présentation « prix net + mention (dont rabais X/pce,
prix brut Y) » encombre un document qui part au client, colonne % vide. Doc officielle relevée :
**champ 56 « Remise % » N(7,6)** ET **champ 67 « Montant de remise » N(13,2)**, plus champ 57
« Montant total de la ligne » N(12,2).

Encodage retenu (v3) : **prix BRUT au champ 54, montant du rabais au champ 67, total net explicite
au champ 57, champ 56 laissé à 0, description propre**. Les francs sont exacts, les % des
étiquettes (D5) — et le cauchemar historique documenté (guide + souvenir de Thierry : « un
cauchemar », le vieux flux Make avait renoncé et tout avalé dans l'équilibrage) portait sur le
**pourcentage** ; le montant + total explicite ne demande aucun recalcul à WinBiz. Le refus
« rabais non divisible par la quantité » n'a plus lieu d'être (le rabais est un montant de LIGNE).

### ✅ T2 VALIDÉ à l'import (30.08, facture 80936 v2)

Prix bruts affichés, **colonne % remplie par WinBiz lui-même** (calculée depuis le montant — on
n'envoie jamais de %), montants nets et total 6'777.00 justes, TVA juste. « Super les rabais !!! »
(Thierry). Un rabais en francs quelconque (100.— sans % rond) marche par construction.

### Derniers réglages de présentation (30.08, retours sur la facture 80936 v2)

- **Notes : le champ 19 s'affiche en pied de page — invisible** (« la preuve, je ne l'avais pas
  vu »). Retiré. Les remarques + notes internes partent en **dernière ligne texte n = 220** (après
  l'arrondi 210), même gabarit nu que la ligne Conseiller. Tronquées à 250 (limite de description).
- **Ligne d'ouverture n = 1 : « CMD-XXXXX du JJ.MM.AAAA »**, texte sans prix, tout en haut —
  l'adresse passe en n = 2, Conseiller/Expédition en n = 3.
- **Notre référence (champ 5) = « CMD-XXXXX du JJ.MM.AAAA »** : la comptable change la date de la
  facture à la date d'envoi — la **date de commande** doit survivre. Elle vit désormais aux deux
  endroits (champ 5 + ligne 1).

- **Description d'article : « titre / Art. SKU »** — le numéro d'article séparé et étiqueté
  (« Fermob Cadiz Bridge / Stéréo gris argile A5ST / Art. 8702A5ST »).
- **Ligne récap des rabais (n = 215)** : « Montant total des rabais sur la commande: CHF X.XX » =
  rabais de ligne + arrondi (le rabais GLOBAL a déjà sa ligne 200 visible, il n'est pas recompté).
  Émise **seulement si ce total atteint 2 % de la commande** — en dessous, on ne s'en vante pas.
  Placée entre l'arrondi (210) et les notes (220).

**51 tests verts.**

### Import final de contrôle (31.08) : présentation validée — et un piège WinBiz de plus

L'import du fichier v3 complet (ligne CMD+date en tête, « / Art. », récap CHF 3470.00, remarques en
fin de corps) est **validé par Thierry** (« bravo c'est en ordre »).

### 31.08 au soir — distinguer le n° d'EXPORT de la VERSION de la commande

Retour de Thierry après le merge : la carte affichait « v1, v2, v3 » — des numéros d'**export** que
tout le monde lirait comme des **versions de la commande** (le « · Vn » des révisions). Correctif :

- **Migration `011-winbiz-export-version-commande.sql`** (SQL Editor) : colonne
  `winbiz_exports.commande_version` = version vivante au moment de l'export
  (MAX(version_num des révisions) + 1 ; NULL sur les exports antérieurs).
- **Nom de fichier** : `bizexdoc_facture_winbiz_{numero}_V{version}_…` — la comptable voit de quelle
  version du document le fichier est la photo.
- **Carte** : « Export 1, 2, 3… » (plus jamais « v ») + « commande V{n} » partout — bouton,
  confirmation, résultat, historique. Anciennes lignes sans version → « commande V? ».

🔴 **Piège découvert en chemin — à consigner au doc 04 via le bilan : importer un numéro de document
déjà existant ne REMPLACE PAS le document dans WinBiz, silencieusement.** Deux imports successifs de
la facture 80936 (v2 puis v3) ont laissé le document v2 en place : le PDF réimprimé montrait
l'ancienne présentation sans aucune erreur visible. Diagnostic fait par le contenu (le pied de page
venait du champ 19, vide dans le fichier v3 — impossible qu'il en sorte). **Procédure comptable :
avant de réimporter une nouvelle version d'un document, supprimer l'ancienne facture dans WinBiz.**
Même famille que T4 (collision de numérotation) — à valider avec la comptable.
