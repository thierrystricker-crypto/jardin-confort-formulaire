# Cadrage — Chantier « Export Winbiz » : générer le fichier bizexdoc depuis une commande du dashboard

> Rédigé le 29.08.2026 dans une conversation de cadrage dédiée, à partir de quatre sources confrontées :
> le scénario Make de référence (blueprint lu en entier), le guide interne (docx, journal ChatGPT),
> la doc officielle Winbiz (helpcenter, article 10681203852828), et les deux fichiers d'exemple
> produits le 18.04.2026 (commandes 54063 BERTHONZOZ et 53990 DOMS) avec leurs scans.
> **v2 du 29.08** — intègre les retours de Thierry : numéro de document sans lettres, rabais/services
> Make confirmés comme bricolage (détail fidèle validé), et surtout **attribution directe au vrai
> client Winbiz** (le client générique n'était qu'une fatalité technique) via le fichier clients
> Winbiz téléchargé avant une séance d'import.
> **Aucun code n'a été écrit ni modifié.**
> ✅ **Cadrage validé par Thierry le 29.08.2026** (« ok pour tout »), avec une précision qui change
> le matcher : **le fichier d'adresses Winbiz ne porte ni téléphone ni e-mail** — le match se fait
> sur nom + prénom + NPA uniquement (§6.2).

---

## 1. Objectif et périmètre v1

Chaque commande du dashboard est aujourd'hui ressaisie à la main dans WinBiz pour être facturée.
En attendant la clé API WinBiz (demandée), la v1 fait ceci et rien d'autre :

**Un bouton sur la page d'une commande génère le fichier d'import WinBiz (`bizexdoc_*.csv`),
l'attribue au bon client Winbiz quand le match est sûr, et le dépose dans un dossier Google Drive
dédié — comme le faisait Make — avec traçabilité en base.**
Arbitrage de Thierry du 29.08 : bouton → dépôt Drive, pas de simple téléchargement.

Hors périmètre v1 : l'appel direct à l'API WinBiz (v3, quand la clé existera), la page
`/dashboard/comptabilite` complète (la v1 pose les tables que cette page lira), les notes de crédit,
les acomptes (voir §8), les commandes web Shopify (périmètre = documents `type_document = "Commande"`
de l'app).

---

## 2. Ce que disent les quatre sources — et où elles divergent

Le scénario Make de référence est **« Integration Google Drive, DocuPipe 1 Light avec tri article
simpifié (a retester dernier stable) (copy) »** (id 4907813). Vérifié : les 4 copies du même nom et
la version sans « (copy) » (4326345, la plus récemment éditée) sont **identiques au caractère près
sur toute la chaîne d'encodage** — seules des durées de `Sleep` diffèrent. Il n'y a donc qu'une seule
référence, pas d'ambiguïté de version. Ce qui est mort dans ce flux est bien l'extraction DocuPipe
(lecture du manuscrit), jamais l'encodage : c'est l'encodage qu'on réutilise.

Confrontation :

| Sujet | Guide docx (journal ChatGPT) | Flux Make (dernier état) | Exemples du 18.04 | Doc officielle |
|---|---|---|---|---|
| Séparateur, structure | `;`, colonnes fixes, en-tête répété | idem | idem | idem (champs numérotés 1–159) |
| Encodage | non précisé | ⚠️ module de conversion cp1252 présent mais **sortie non branchée** : les fichiers partaient en UTF-8 | UTF-8 (accents corrects) | **ANSI 1252** exigé |
| Ligne rabais | classification `Rabais;Rabais`, **TVA vide**, cpt selon config | classification `Article;Article`, **TVA remplie** (3000 / 8.10 / `<VAT_FIGURE=300>`) | comme Make | champ 49 = 7 « réduction » jamais utilisé par nous |
| Montant du rabais | montant négatif calculé en amont | `total_net − somme(articles)` (ligne d'équilibrage) | 53990 : −358 ✓ ; **54063 : +23.10 ✗** (voir §4) | — |
| Titres de section | type 4 « titre » documenté | encodés en **type 2 (texte)** | type 2 | 4 = titre, 2 = texte |
| Sous-total | vraie ligne type 3, aucun montant, Winbiz calcule | idem | idem | champ 105 : 0 = sous-total |
| Client | — | code adresse 999 + placeholders `"Société SA"`… | idem | champ 20 obligatoire, **cascade de correspondance** (voir §6) ; champ 47 pilote création/mise à jour |

Deux enseignements : le **flux Make est plus récent que le guide** (il a abandonné `Rabais;Rabais`
au profit d'une ligne article négative ordinaire, TVA remplie — et c'est cette variante que portent
les fichiers réellement importés) ; et la question de l'encodage n'a **jamais été tranchée
volontairement** — l'import a accepté de l'UTF-8 par accident ou par tolérance. À tester (§8, T1).

---

## 3. La spécification d'encodage (référence : flux Make, état du 14.04.2026)

Règle d'or héritée du guide et confirmée par les erreurs passées : **ne jamais recompter les
colonnes à l'œil, réutiliser les gabarits validés tels quels** — et quand un champ précis doit
changer (le 20, le 47), le localiser **programmatiquement** en splittant le gabarit, jamais en
comptant des points-virgules à l'écran.

### 3.1 Fichier

- Texte, séparateur `;`, fins de ligne CRLF, **une ligne vide finale** (l'agrégateur Make termine par `\n\n`).
- Nom : `bizexdoc_facture_winbiz_{numero}_{societe}_ {nom}_ {prenom}_{run_id}.csv`
  avec `run_id = YYYYMMDD_HHmmss_{aléa 1000–9999}` (les espaces après `_` sont dans le modèle Make ; à assainir en v1, rien ne les impose).
- Encodage : cible **cp1252** conformément à la doc officielle, sous réserve du test T1 (§8).
- Toutes les lignes d'un document répètent l'en-tête ; numéros de ligne croissants et uniques.

### 3.2 Les deux gabarits d'en-tête

**Ligne 1 du fichier (en-tête du document, 21 champs seulement) :**

```
{numero};20;{date JJ.MM.AAAA};;;{total_net};CHF;;;;<AUTO>;{vendeur};F;;;;;;;{code_client};;
```

- champ 1 = numéro : **chiffres uniquement, Winbiz refuse les lettres** (retour Thierry 29.08).
  Le numéro CMD **sans préfixe** : `CMD-80695` → `80695`. Le lien exact commande ↔ fichier vit dans
  la table d'export (§7).
- champ 2 = `20` : type « facture débiteurs ».
- champ 6 = total net TTC du document — **doit tomber juste au centime** avec la somme des lignes, sinon Winbiz fabrique un arrondi fantôme (§10 du guide).
- champ 11 = `<AUTO>` : compte collectif débiteurs.
- champ 12 = **initiales du vendeur** (`MG`, `AG`, `SS`, `TS`, `FC`) — sur cette ligne uniquement, `<AUTO>` partout ailleurs. Table de correspondance du flux Make : Alejandro→AG, Michel/Michel Gédéon→MG, Sabrina Striberni→SS, Thierry Stricker→TS, Fabian Coquoz→FC. Côté app, partir de `traite_par`/commercial de la commande.
- champ 20 = `{code_client}` : le **code adresse Winbiz réel** quand le match est sûr, `999` en repli (toute la logique au §6). Les lettres sont permises ici — le champ est alphanumérique C(15), seule la numérotation de document est numérique.

**Préfixe commun de toutes les lignes suivantes (champs 1–48) :**

Cas client attribué (match sûr, §6) :

```
{numero};20;{date};;;{total_net};CHF;;;;<AUTO>;<AUTO>;F;;;;;;;{code_client};;"{societe}";"{nom}";"{prenom}";"{rue}";;"{npa}";"{ville}";;;F;;;;;;;;1;{date};;;;;{titre};;1
```

Cas repli (aucun match sûr) — le comportement historique :

```
{numero};20;{date};;;{total_net};CHF;;;;<AUTO>;<AUTO>;F;;;;;;;999;;"Société SA";"Nom";"Prenom";"Rue";;"Npa";"Ville";;;F;;;;;;;;1;{date};;;;;Monsieur;;1
```

> 🔴 **Champ 47 « Mise à jour de l'adresse » — le piège de la v2.** Doc officielle : `0` (le
> **défaut** quand le champ est vide) = ajoute l'adresse si inexistante, **REMPLACE ses données si
> elle existe** ; `1` = ajoute si inexistante, **ne modifie jamais** une existante ; `2` = complète.
> Dans le gabarit Make le champ 47 est vraisemblablement vide → défaut `0` : chaque import
> **écrasait** les données du client 999 avec les placeholders. Sans conséquence sur un client
> poubelle — **destructif dès qu'on met de vrais codes et de vraies fiches**. La v1 force
> explicitement **`1`** dans le champ 47, après avoir localisé sa position par comptage
> programmatique du gabarit (premier test unitaire du chantier).
>
> **Le bug n'est pas théorique — il est déjà arrivé** (bug métier historique, rapporté par Thierry
> le 29.08) : la fiche 999 s'appelle « Import », rue de l'Import, 1111 Import. Il a suffi qu'un
> vrai nom se glisse une fois dans les champs d'adresse d'une ligne 999 pour que la fiche soit
> renommée — et comme **toutes** les factures importées pointent sur la fiche 999, elles se sont
> **toutes** retrouvées au nom de ce client. Défense en profondeur dans la v1 : (1) champ 47 = 1,
> qui suffit à lui seul ; (2) sur le chemin de repli, les champs d'adresse (22–28) ne portent
> **jamais** les données du client de la commande — uniquement les placeholders neutres — et les
> vraies coordonnées ne vivent que dans la ligne texte n° 1 ; (3) un test unitaire dédié vérifie
> qu'aucun fragment du nom du client ne peut apparaître dans les champs 22–28 d'une ligne en
> repli 999.

### 3.3 Les gabarits de ligne (suffixes ajoutés au préfixe)

Notation : `{n}` = numéro de ligne ; le 2ᵉ champ du suffixe est le type Winbiz (1 = article,
2 = texte, 3 = sous-total).

**Ligne adresse client (n = 1, type texte)** — les coordonnées de la commande, à plat, séparées par
` | ` (conservée **même quand le client est attribué** : c'est la vérification à l'écran de la
comptable, et la trace si le match était faux) :

```
;1;2;;{Nom | Prénom | Rue | NPA Ville | e-mail | Tél};;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
```

**Titre de section (type texte)** — marque/collection (« FERMOB 2026 ») :

```
;{n};2;;{titre}; {date};;;;;;;;3000;8.10;1;2200;2;;;;<VAT_FIGURE=300>;;;;;;;;;;;;;;;;;;;;;;;
```

**Ligne article (type 1)** :

```
;{n};1;;{description} ;{date};{qté};{prix unitaire};Pce;0;;;;3000;8.10;1;2200;2;;;;<VAT_FIGURE=300>;;;;1;;0;Article;Article;;;;;;;100;0;;0;;;;0;0;0;;0;;;;0;
```

- code article laissé **vide** (le champ vide entre le type et la description) : aucune résolution dans la base articles Winbiz — c'est voulu, une description tombée dans ce champ déclenche « Article introuvable ».
- après `Pce` : `0` = remise de ligne (voir §5.3), puis compte de vente `3000`, TVA `8.10`, `1` (TVA incluse), contrepartie `2200`, `2`, et `<VAT_FIGURE=300>` (chiffre TVA forcé).
- Make numérotait les articles `index + 2` ; l'app peut numéroter séquentiellement, seule la croissance compte.

**Sous-total (n = 100, type 3)** — aucun montant, Winbiz calcule la somme des lignes précédentes :

```
;100;3;;Sous-total;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;0;;;;;;;;;;;;;;;;;;;;;;;;;
```

(le `0` isolé en fin de gabarit est le champ 105 : 0 = sous-total, 1 = total.)

**Ligne rabais (n = 200)** — une ligne article ordinaire à montant **négatif** :

```
;200;1;;{libellé rabais};{date};1;{montant négatif};Pce;0;;;;3000;8.10;1;2200;2;;;;<VAT_FIGURE=300>;;;;1;;0;Article;Article;;;;;;;100;0;;0;;;;0;0;0;;0;;;;0;
```

Quantité 1, le signe porté par le prix — jamais par la quantité. C'est la variante du flux Make
(TVA remplie, classification `Article;Article`) ; la variante du guide (`Rabais;Rabais`, TVA vide)
reste le plan B si un import de test montre une TVA incohérente.

**Ligne livraison / service (n = 202)** — même gabarit article, libellé + prix du service
(0 si offert, avec un libellé qui le dit : « Livraison "à l'étage" et déballage : Offert »).

### 3.4 Assemblage

```
en-tête (ligne 1)
adresse client (ligne 2)
titres + articles (lignes 3…)
Sous-total (ligne 100)
rabais (ligne 200) — seulement s'il y en a un
livraison / services (lignes 202…)
[arrondi (ligne 210) — si manualRounding ≠ 0, voir §5]
ligne vide finale
```

L'ordre est commercial autant que technique : le rabais s'applique à la marchandise **avant** les
frais de livraison, pour que le pourcentage perçu par le client reste vrai.

---

## 4. Pourquoi on ne reprend PAS le calcul de rabais de Make

Make calculait `RABAIS SPECIAL = total_net − somme(articles)` : une **ligne d'équilibrage**, pas un
rabais — et la ligne de service était traitée pareil. Thierry le confirme (29.08) : *« les rabais
faits et calculés par Make étaient un bricolage pour retomber sur le bon montant, idem pour les
frais de service »* — une contrainte de l'époque manuscrite, pas un choix. Preuve par l'exemple
54063 : le papier disait sous-total 1'950.90, rabais −5 % ≈ −97, livraison +120 → total 1'974. Le
fichier généré porte une ligne « RABAIS SPECIAL » **positive** de `23.09999999999991` (artefact
flottant inclus) et une livraison à 0.—. Le total comptable tombe juste ; le détail est faux.

Depuis le dashboard, on a les données structurées : la v1 encode le **détail fidèle** (vrais rabais
négatifs, vraie livraison avec son prix, arrondi explicite) et remplace l'équilibrage par un
**contrôle bloquant** :

> **Invariant de génération** : somme(lignes émises) = `totals.total` de la commande, au centime.
> Sinon le fichier n'est **pas** émis et l'erreur dit l'écart. On ne truque jamais l'écart dans une
> ligne de rabais. Tous les montants se calculent en centimes entiers — jamais un
> `23.09999999999991` dans un fichier comptable.

---

## 5. Mapping commande → fichier

À vérifier contre le code réel à l'ouverture du chantier (`lib/jc-print-types.ts` / `computeTotals`,
structure `data` des commandes) — rien ne se code de mémoire.

### 5.1 En-tête
| Winbiz | Source app |
|---|---|
| numéro (champ 1) | `numero_commande` **débarrassé de son préfixe et de tout caractère non numérique** (arbitrage Thierry 29.08). Collision éventuelle avec la numérotation d'exercice Winbiz : à confirmer avec la comptable (T4) |
| date | date de la commande (JJ.MM.AAAA) |
| total_net | `totals.total` figé de la commande |
| vendeur | `traite_par` → initiales (table §3.2) ; `<AUTO>` si inconnu |
| code client (champ 20) | résultat du match §6 ; `999` en repli |

### 5.2 Adresse
Champs 22–28 du préfixe : les données du client **de la commande** (société, nom, prénom, rue, NPA,
ville) quand le client est attribué, les placeholders historiques en repli. Champ 47 = `1` dans les
deux cas (§3.2). La ligne texte n° 1 (coordonnées à plat) est émise dans tous les cas.

### 5.3 Lignes
| Cas dashboard | Encodage |
|---|---|
| Article (`data.lines[]`, qté > 0) | ligne type 1 : description (+ n° d'article fournisseur et couleur dans le texte, comme Make), qté, prix unitaire |
| Rabais de ligne (`lineDiscount`/`lineDiscountPerUnit`) | **prix unitaire net** (prix − rabais unitaire) + mention « (dont rabais X.—/pce, prix brut Y.—) » dans la description. Le guide a établi que les remises en % importées sont le point le plus fragile de Winbiz — on n'utilise **pas** le champ remise (laissé à `0`) tant qu'un import de test ne l'a pas validé (T2, §8) |
| Titre / ligne texte du document | ligne type 2 |
| Sous-total marchandises | ligne 100, type 3, calculée par Winbiz |
| Rabais global (`discountPercent` → `totals.discountValue`) | ligne 200 : montant négatif exact, libellé « Rabais {p} % » |
| Services (`enabledServices` / `servicePrices`) | une ligne 202+ par service, libellé réel, prix réel (0 + « Offert » si offert) |
| Arrondi (`manualRounding`) | ligne dédiée « Arrondi », montant signé — jamais fondu dans un rabais |

### 5.4 Ce que l'export ne fait jamais
- **Aucune écriture sur la commande** : une commande est une preuve, l'export est une lecture. Les seules écritures sont dans les tables d'export (§7).
- **Aucune création ni modification d'adresse dans Winbiz** (v1) : soit un code qui existe déjà (il vient du fichier clients Winbiz), soit 999 — et champ 47 = 1 verrouille le tout.
- Aucun appel Shopify, aucun mouvement de stock, aucun fichier sanctuarisé ouvert (le matcher WinBiz n'est pas concerné : il rapproche des factures importées **depuis** WinBiz, flux inverse).

---

## 6. Attribution client — du « client 999 » au vrai client

Retour de Thierry (29.08) : le regroupement de toutes les factures sur un client générique était
*« une fatalité technique plus qu'un choix »* ; l'attribution directe serait *« le top du top pour
la comptable »*, et il peut **télécharger le fichier clients Winbiz avant une séance d'importation**
pour optimiser le match. Contrainte structurelle : Winbiz attribue les codes clients **par
exercice** — un code n'est pas stable d'une année à l'autre.

### 6.1 Ce que fait Winbiz à l'import (doc officielle, champ 20)

Cascade de correspondance : **a)** adresse existante ayant le même **code adresse** ; **b)** sinon,
même valeur dans le **code adresse complémentaire** ; **c)** sinon, même **numéro de localisation
globale (GLN)** ; **d)** sinon, comportement du **champ 47** (création selon 0/1/2 — voir le piège
§3.2). On ne contrôle que le champ 20 : pour que a) fonctionne, il faut y mettre le code exact de
l'exercice courant.

### 6.2 Stratégie v1 : table de correspondance rafraîchie par le fichier clients

1. **Upload** : avant une séance d'import, Thierry exporte le fichier clients Winbiz et le charge
   dans l'app (route + petit écran d'upload — l'embryon de la page comptabilité). Chargé dans une
   table **`winbiz_adresses`** : `exercice`, `code`, `societe`, `nom`, `prenom`, `rue`, `npa`,
   `ville`, `email`, `telephone`, `raw jsonb`, `importe_le`. Chaque upload remplace l'exercice
   concerné. (Format exact du fichier export Winbiz à relever sur pièce à l'ouverture du chantier.)
2. **Match à la génération** : le client de la commande est cherché dans `winbiz_adresses`
   (normalisation casse/accents/espaces/tirets — même esprit que `search_clients_relevance`).
   ⚠️ **Précision de Thierry (29.08) : le fichier d'adresses Winbiz ne porte ni téléphone ni
   e-mail saisis.** Le seul match fort disponible est donc **nom + prénom + NPA** (la rue
   normalisée sert de départage si elle existe des deux côtés). Conséquences assumées :
   - **Un seul candidat** nom + prénom + NPA → champ 20 = son code, vraies données d'adresse,
     champ 47 = 1.
   - **Zéro candidat, ou plusieurs** (homonymes d'un même NPA, et les doublons Winbiz documentés —
     Graz ×7, GRUNINGER ×5…, cf. P2-12) → **repli 999 + placeholders**, raison consignée. Jamais de
     choix silencieux entre deux candidats — la règle est la même que pour le connecteur.
   - Le taux de repli sera donc plus élevé qu'avec un match e-mail/téléphone : c'est **la raison de
     plus** pour la cible §6.3 (code complémentaire), qui rend le match exact et définitif.
3. **Restitution** : la réponse du bouton et la table d'export disent le résultat — « attribuée à
   {code} — {nom} ({critère}) » ou « non attribuée → client 999, à réassigner ({raison}) ». La
   comptable ne rouvre plus que les replis.
4. **Fraîcheur** : si le dernier fichier clients chargé ne couvre pas l'exercice de la date de la
   commande, ou date de plus de N jours, l'app avertit avant de générer (les codes changent par
   exercice — un fichier de l'an dernier attribuerait des factures au mauvais client, **sans
   erreur visible**, le pire des modes de panne).

### 6.3 La cible (étape 2, à valider avec la comptable)

La cascade **b)** est la vraie sortie du problème d'exercice : le champ « **code adresse
complémentaire** » d'une fiche Winbiz est libre, stable, et à nous. Si la comptable y inscrit le
numéro client de l'app (`CL-XXXXX`) — à la main au fil de l'eau, ou par un seed en masse préparé
depuis `winbiz_adresses` —, alors champ 20 = `CL-XXXXX` matche **sans fichier clients à
recharger**, année après année (les lettres sont permises dans les codes, seule la numérotation de
document est numérique). C'est aussi la clé de rapprochement naturelle du jour où l'API Winbiz
arrive, et un pont évident vers le chantier « Raccrochage client ». Hors périmètre v1 ; à inscrire
au backlog.

---

## 7. Architecture v1

1. **`lib/winbiz-export.ts`** — module pur : `buildWinbizCsv(commande, attribution) → { filename, content, warnings }`. Aucune E/S, testable seul (gabarits, centimes, invariant §4, champ 47).
2. **Résolution client** — `lib/winbiz-match.ts` pur : `matchClient(client, adressesExercice) → { code, source } | { repli, raison }`.
3. **`POST /api/commandes/[slug]/export-winbiz`** — résout le client, génère, vérifie l'invariant, dépose sur Drive, journalise, renvoie `{ run_id, filename, statut, attribution, deja_exporte? }`.
4. **Upload du fichier clients** — `POST /api/winbiz-adresses/upload` + écran minimal (liste des exercices chargés, date du dernier upload).
5. **Dépôt Google Drive** — deux voies possibles, à trancher au cadrage technique du chantier :
   - **(a) Webhook Make dédié** (recommandé) : l'app POste `{filename, contenu base64}` à un petit scénario Make « Dépôt Winbiz » qui écrit dans le dossier Drive. Réutilise la connexion Google **déjà en place** dans Make, zéro nouveau secret Google dans Vercel, même patron que le webhook mail existant — clé en variable d'environnement, leçon du chantier 2.
   - (b) Compte de service Google + API Drive depuis Vercel : plus direct, mais un secret Google de plus à gérer et un partage de dossier à configurer.
   - Dossier Drive **dédié et neuf** (« Exports_Winbiz_App »). Surtout pas un des dossiers du flux scan, et à ne jamais confondre avec le dossier `Factures_winbiz` que consomme « WinBiz - Import CSV depuis Google Drive » toutes les 30 min — c'est le flux **inverse** (WinBiz → Supabase).
6. **Table `winbiz_exports`** (nouvelle — aucun risque pour les 5 RPC du connecteur) :
   `id`, `created_at`, `commande_slug`, `numero_commande`, `numero_winbiz` (chiffres émis),
   `run_id`, `filename`, `montant`, `contenu_hash`, `version` (n° d'export pour cette commande),
   `client_code`, `match_type` (`email` | `tel` | `nom_npa` | `repli_aucun` | `repli_ambigu`),
   `statut` (`genere` | `depose` | `erreur`), `erreur`, `cree_par`.
   RLS activée sans policy, service role, comme le reste. Idem `winbiz_adresses`.
7. **Le bouton** (page commande) — et la réponse à « risqué si on appuie dessus tous les jours » :
   - jamais exporté → « Exporter vers WinBiz » ;
   - déjà exporté → « ✓ Exporté le {date} (v{n}) — Ré-exporter ? » avec confirmation explicite ; un ré-export crée `version n+1`, ne remplace rien, et le fichier porte un `run_id` distinct ;
   - si la commande a été **révisée depuis le dernier export**, le bouton le dit (« ⚠️ commande révisée après l'export v{n} ») — c'est le cas « mauvaise version » ;
   - l'attribution client s'affiche avant confirmation (« sera attribuée à {code} {nom} » / « partira sur le client 999 ») ;
   - c'est cette table que lira la future page `/dashboard/comptabilite` (historique, versions, statuts, futur bouton API Winbiz). La page elle-même est **v2**.

Méthode inchangée : cadrage validé → branche dédiée → patches courts → preview Vercel + smoke test →
merge → journal. La preview écrit dans la vraie base : les tests d'export utiliseront une commande de
test, et le dossier Drive de test sera distinct du dossier de production.

---

## 8. Points ouverts et tests d'import à faire AVANT la mise en production

| # | Question | Comment trancher |
|---|---|---|
| T1 | **Encodage** : cp1252 (doc officielle) ou UTF-8 (ce que Make envoyait en réalité — son module de conversion existait mais n'était branché nulle part) ? | Générer le même fichier dans les deux encodages avec des accents (é, è, ô, ü) et importer les deux dans WinBiz sur un document de test. Retenir celui qui rend les accents intacts |
| T2 | Le champ **remise de ligne** (le `0` après `Pce`) est-il fiable en import ? | Import de test avec une remise % simple. Tant que non validé : prix net + mention (§5.3) |
| T3 | Ligne rabais : variante Make (`Article;Article`, TVA remplie) vs guide (`Rabais;Rabais`, TVA vide) — laquelle donne le bon décompte TVA ? | Les fichiers du 18.04 (variante Make) ont-ils été importés avec une TVA juste ? Sinon, import de test comparatif |
| T4 | **Numéro de document** : le n° CMD nu (chiffres) peut-il entrer en collision avec la numérotation d'exercice Winbiz ? La balise `<NEW>` (numérotation par Winbiz) serait l'alternative | Avec la comptable : sa numérotation d'exercice prime |
| T5 | **Acomptes** : le papier 54063 porte « ACOMPTE VERSÉ 934.— ». La v1 exporte la facture pleine et laisse l'acompte à la saisie comptable, ou faut-il une ligne/un document de paiement (type 24) ? | Avec la comptable — hors périmètre v1 sauf avis contraire |
| T6 | TVA : tout est à 8.1 % (`<VAT_FIGURE=300>`) aujourd'hui. Y a-t-il des cas 0 % / autres taux dans les commandes ? | SELECT de diagnostic sur les commandes existantes à l'ouverture du chantier |
| T7 | **Attribution client** : import de test avec un vrai code au champ 20 et champ 47 = 1 → la facture atterrit sur la bonne fiche ET la fiche n'est pas modifiée ? Contre-test : champ 47 laissé vide sur un **client de test** pour constater l'écrasement (défaut 0) — c'est le mécanisme exact du bug historique « toutes les factures 999 renommées » (§3.2), à reproduire une fois pour le prouver, jamais sur la fiche 999 réelle | Import de test sur un client de test, avant toute production |
| T8 | **Format du fichier clients Winbiz** (colonnes exactes, encodage) — conditionne le match §6.2. Acquis (Thierry, 29.08) : **pas de téléphone ni d'e-mail saisis** → match nom + prénom + NPA uniquement | Relever sur un export réel fourni par Thierry à l'ouverture du chantier |

Arbitrages pris par Thierry le 29.08.2026 : **bouton → dépôt Drive** comme Make ; **numéro de
document sans lettres** (préfixe supprimé) ; **détail fidèle** — l'équilibrage Make était un
bricolage assumé, pas un modèle ; **attribution directe au client** dès que le match est sûr, le
client générique n'étant plus qu'un repli ; fichier clients Winbiz téléchargeable avant une séance
d'import pour alimenter le match. Reconduits sur recommandation : **table `winbiz_exports` dès la
v1** ; repli 999 plutôt que création d'adresse ; champ 47 = 1.

---

## 9. Prompt de démarrage du chantier (à coller dans une nouvelle conversation, une fois ce cadrage validé)

```
Chantier « Export Winbiz » — le fichier bizexdoc depuis une commande du dashboard.

Avant toute proposition : lis le cadrage (cadrage-export-winbiz.md, v2), puis les
docs projet 00, 02 (modèle de données), 03 (règles métier), 04 (pièges) et
l'entrée correspondante du backlog 05. Puis lis le code réel :
lib/jc-print-types.ts (computeTotals, structure des lignes), la page commande du
dashboard, et une commande réelle en base (SELECT sur offres, type_document =
'Commande') pour vérifier la structure exacte de data. Demande à Thierry un
export réel du fichier clients Winbiz (T8) avant d'écrire le matcher.
Ne travaille pas de mémoire : le cadrage anticipe des noms de champs qui doivent
être confirmés.

Objectif : un bouton sur la page commande génère le fichier d'import WinBiz,
l'attribue au bon client Winbiz quand le match est sûr (repli client 999 sinon),
et le dépose dans un dossier Google Drive dédié, avec traçabilité en table.

Ordre de livraison :
1. lib/winbiz-export.ts pur + tests sur les commandes 54063/53990 reconstituées :
   le fichier généré doit reproduire les gabarits de référence au caractère près
   (mêmes positions de colonnes), avec le détail fidèle (§4 et §5 du cadrage).
   PREMIER test unitaire : localiser programmatiquement les champs 20 et 47 du
   gabarit et prouver que le 47 émis vaut 1 — le défaut 0 REMPLACE les données
   du client existant dans Winbiz. Ce n'est pas théorique : une fois, un vrai nom
   glissé dans les champs d'adresse d'une ligne 999 a renommé la fiche « Import »
   et TOUTES les factures qui pointaient dessus (§3.2 du cadrage). Deuxième test
   unitaire : sur une ligne en repli 999, les champs d'adresse 22–28 ne peuvent
   jamais contenir un fragment des données du client de la commande.
2. Migrations winbiz_exports + winbiz_adresses (tables neuves — vérifier quand
   même les 5 RPC par principe). SQL dans le SQL Editor uniquement.
3. Upload du fichier clients (route + écran minimal) puis lib/winbiz-match.ts :
   match fort uniquement sur nom + prénom + NPA normalisés (le fichier d'adresses
   Winbiz ne porte NI téléphone NI e-mail — acquis du 29.08, ne pas compter
   dessus), rue en départage, repli 999 sur zéro ou plusieurs candidats — jamais
   de choix silencieux entre deux fiches (les doublons Winbiz sont documentés,
   P2-12). Avertir si le fichier clients chargé ne couvre pas l'exercice de la
   commande : les codes changent par exercice.
4. Route POST /api/commandes/[slug]/export-winbiz + dépôt Drive (webhook Make
   dédié, clé en variable d'environnement — jamais en dur, leçon du chantier 2).
5. Le bouton, avec ses états : jamais exporté / déjà exporté (vN, date) /
   commande révisée depuis le dernier export — et l'attribution client affichée
   avant confirmation.

Garde-fous :
- l'export ne modifie JAMAIS la commande : lecture seule + insert dans les
  tables d'export. Une commande est une preuve.
- l'export ne crée ni ne modifie JAMAIS une adresse dans Winbiz : code existant
  ou 999, et champ 47 = 1.
- numéro de document : chiffres uniquement, préfixe CMD- retiré (Winbiz refuse
  les lettres dans les numéros de facture).
- invariant bloquant : somme des lignes émises = totals.total au centime, en
  centimes entiers, sinon pas de fichier. Jamais de ligne d'équilibrage.
- aucun appel Shopify, aucun mouvement de stock, aucun fichier sanctuarisé
  (le matcher WinBiz est le flux INVERSE : ne pas y toucher).
- la preview Vercel écrit dans la vraie base : commande de test dédiée, dossier
  Drive de test distinct de la production.
- les tests d'import T1 à T8 du cadrage §8 se font dans WinBiz sur des documents
  et un client de test AVANT toute mise en production — me les demander
  explicitement.
- ne mets jamais une valeur de secret dans un message, un fichier ou un journal.

RÈGLE DE TRAVAIL — n'écris dans AUCUN doc projet (00 à 15). La consolidation se
fait dans une conversation dédiée. Toi, tu mets à jour le journal du dépôt
(journal-export-winbiz.md, à créer) et tu me rends en fin de session un bilan
complet : entrées de backlog, pièges, décisions, greffes sans hôte. Ce bilan est
le SEUL véhicule de tes trouvailles.

Commence par un cadrage écrit : ce que tu constates dans le code par rapport au
cadrage (structure réelle de data.lines, services, arrondi, format du fichier
clients Winbiz), le SQL des migrations, et le plan de smoke test. Ne touche à
rien avant validation.
```

---

## 10. Annexe — traçabilité des sources

- Scénario Make de référence : 4907813 (teamId 742490), dernier édit 14.04.2026 ; identique à 4326345 (21.04) hors `Sleep`. Chaîne d'encodage : modules 60 (données globales), 62–67 (vendeur→initiales), 155 (adresse à plat), 125 (préfixe), 102 (en-tête), 104 (ligne adresse), 58+118/119+160 (articles/titres), 166 (sous-total), 100/101/169 (rabais d'équilibrage), 188–191 (livraison), 148/149 (assemblage), 146/237 (upload Drive ×2), 242 (run_id). Le module 147 (UTF-8→cp1252) existe mais sa sortie n'est consommée par aucun module.
- Exemples : `bizexdoc_facture_winbiz_54063…7613.csv` et `…53990…9638.csv` (18.04.2026) + scans.
- Guide interne : « Guide de référence — Créer un fichier SCP compatible Winbiz » (docx).
- Doc officielle : helpcenter.winbiz.ch, « Format d'importation des documents » (champs 1–159, types de documents, balises `<NEW>`/`<UPDATE>`/`<AUTO>`/`<VAT_CODE>`/`<VAT_FIGURE>`, cascade du champ 20, valeurs 0/1/2 du champ 47, champ 105 réductions/totaux). Captures des champs 20 et 47 fournies par Thierry le 29.08.
- Éclairage inverse utile : `factures_winbiz_lignes` (doc 02) montre le typage WinBiz côté export — `dl_dettyp` 1 = article, 2 = note, 3 = sous-total, 4 = titre, 7 = paiement — cohérent avec le champ 49 de l'import.
- Retours de Thierry (29.08) intégrés en v2 : numéro sans lettres ; rabais/services Make = bricolage ; attribution client directe visée, fichier clients Winbiz téléchargeable avant séance d'import, codes attribués par exercice, cascade de correspondance confirmée.
