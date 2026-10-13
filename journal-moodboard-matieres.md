# Journal — Planche couleurs et matières (moodboard) en fin d'offre

> Chantier du 12 au 13.10.2026. Branche `feat/moodboard-matieres`, **PR #63, mergée sur `main` (`208a14c`)**, déployée en production le 13.10.2026.
> Convention P0-19 : documents cités par numéro, jamais par nom de client.

## 1. Le besoin

Ajouter en **dernière page de l'offre** une planche des couleurs et matières des articles présents :
- une vignette ronde, avec le nom, le code et la marque ;
- trouvée **automatiquement** à partir des variantes Shopify des lignes et de la table `matieres`.

Pilotes : Manutti, Dedon, Fermob.

**Deux règles posées par Thierry au lancement, non négociables :**

1. **Lecture seule** : l'app ne fait que lire la base matières. Une couleur manquante ou mal reliée se corrige dans l'autre chat (« Import articles Shopify »), jamais ici.
2. **Pas de rapprochement par nom dans l'app** : la fonction de rattachement de la base (`matiere_depuis_option`) s'en charge déjà, et l'app ne doit pas en recoder une.

## 2. La chaîne de calcul

```
ligne d'offre (shopifyVariantId)
  → Shopify Admin GraphQL nodes(ids) : selectedOptions, product.vendor, product.handle
    (API 2026-04, token client_credentials recopié — rien n'est importé des lib/shopify-*.ts sanctuarisées)
  → RPC matieres_pour_offre(p_lignes jsonb)   [SQL 031 puis 032, exécutées dans le SQL Editor]
      - découpe les valeurs d'option sur " / ", " + " et " - "
        (seulement "/" et "+" pour Suncomfort et Schaffner ; Schaffner force l'option « Couleur »)
      - appelle matiere_depuis_option pour chaque morceau
      - dédoublonne par cle, additionne le poids (montant CHF de la ligne)
      - renvoie cote = maitre_cote (taille de l'image maître)
```

- La RPC est `language sql stable security invoker`, avec `revoke` pour `public` et `anon`, et `grant` pour `service_role` et `authenticated`.
- La 032 fait un `DROP` puis un `CREATE`, parce qu'une colonne de sortie a changé.

## 3. Les fichiers

| Fichier | Rôle |
|---|---|
| `docs/sql/031-matieres-pour-offre.sql`, `032-…-cote.sql` | La RPC, en lecture seule |
| `lib/matieres-offre.ts` | Côté serveur : `matieresPourLignes()`, lecture Shopify par paquets de 100 avec un délai maximal de 8 s, calcul de couverture `{articles, representes, nonRelies}` |
| `lib/moodboard.ts` | Sans dépendance serveur : types, réglages, `texteCouverture`, `grouperParFamille`, `clarte` (L* CIELAB), `disposerParPoids`, `disposerEnDegrade`, `urlCdn` |
| `components/MoodboardPlanche.tsx` | Le rendu de la planche : pastilles, palette, survol croisé, pied de planche |
| `components/MoodboardReglages.tsx` | Le bloc du formulaire de brouillon : case, rendu, sens, aperçu, liste interne des articles non reliés |
| `components/MoodboardCard.tsx` | La carte du dashboard (offre **et** commande) |
| `app/api/offres/[slug]/matieres/route.ts` | GET **public** (pdf.co rend sans cookie) : finitions, couverture (deux nombres), numéro, réglages. Aucune donnée client |
| `app/api/moodboard/apercu/route.ts` | POST **interne** `{lines}`, 300 lignes au plus ; renvoie aussi `nonRelies` |
| `app/print/offre/[slug]/page.tsx`, `app/print/draft/[slug]/page.tsx` | Dernière page `.doc-moodboard` ; paramètre de test `?moodboard=poids\|degrade\|degrade-inverse` |
| `app/planche/[slug]/page.tsx` | Page **publique** « Vos couleurs et matières », sans prix ni nom de client |
| `app/drafts/_components/DraftFormulaire.tsx` | État `moodboard`, snapshot, auto-save, bloc `MoodboardReglages` |
| `app/dashboard/[slug]/page.tsx` | `<MoodboardCard>` placée après `Faisabilite3DCard` |
| `proxy.ts` | `GET …/matieres` public, `/planche/` public |

**Réglages** stockés dans `data.moodboard` :

```
{ actif: boolean, mode: "poids" | "degrade", sens: "clair-fonce" | "fonce-clair", palette? }
```

- Ils passent du brouillon à l'offre sans code supplémentaire, parce que `transformer_draft` recopie `data`.
- Ils passent de l'offre à la commande de la même façon, parce que `valider` recopie `...offre.data`.
- La case est **décochée par défaut**.

## 4. Le rendu retenu

Le format est fixe : **180 × 215 mm**, avec 36 % pour la colonne de gauche et 60 % pour la palette. Toutes les positions sont en pourcentages, ce qui donne un rendu identique dans le PDF, à l'écran et dans l'aperçu.

**Colonne de gauche** : les pastilles rondes, classées par famille. Chaque pastille est une fenêtre à la même échelle que le carré de son bloc dans la palette. Au survol, elle grossit de 2,4 et passe au gros plan ×2.

**Palette de droite**, en rendu « mixte » :
- un carré montrant la matière entière, puis le reste du bloc en gros plan ×2 ;
- si l'image maître fait moins de 500 px (`COTE_MIN_ETIREE`), le carré entier est répété à la place du gros plan.

**Deux dispositions :**
- **par valeur** : treemap squarified sur la racine carrée du poids, avec une part de 3 % au minimum et de 35 % au maximum ;
- **en dégradé** : bandes triées par clarté L*, avec une part de 6 % au minimum, du clair au foncé ou l'inverse.

**Survol croisé** : survoler une pastille fait réagir son bloc, et inversement. Le bloc survolé reçoit un contour noir de 2 px, dessiné à l'intérieur. Les pastilles très claires (L* > 85) ont un cercle gris. Tout cela est coupé à l'impression.

**Pied de planche :**
- la couverture, par exemple « Finitions présentées pour X articles sur Y de votre offre. » ;
- l'explication du gros plan ×2 ;
- la mention « Teintes et matières présentées à titre indicatif, non contractuelles… Échantillons disponibles dans notre exposition. »

## 5. Ce qui a été tranché en cours de route

- **Pas de planche sur la page web client `/offre/[slug]`.** Elle figure sur l'impression et le PDF, comme les plans 3D.
- **Commande : rien à coder.** La planche suit `data` dans la commande. Le PDF initial `commandes/<slug>_initial.pdf` est archivé une seule fois, à la signature, et `pdf_url` est régénéré lors des révisions.
- **Images en JPEG pour le PDF (`format=pjpg`).** Sans ce paramètre, le CDN sert du WebP que Chrome intègre en image brute. Planche de 7 finitions : **12,7 Mo → 3,2 Mo**.
- **La palette figée (`data.moodboard.palette`) est prévue par la route mais n'est jamais écrite.** Aujourd'hui, la planche d'une commande est recalculée en direct.

## 6. Tests (sur la preview)

| Document | Résultat |
|---|---|
| DEV-2026-884 | 3 finitions, `actif: false` |
| DEV-2026-873 | 1 article représenté sur 2 (Fermob Rouille 09 absent de la base matières) |
| DEV-2026-838 | Rendu des vignettes validé par Thierry |
| DRA-104 | Enregistré avec la case cochée |
| `/planche/…` | Répond sans être connecté |

**Reste à faire en production** : transformer un brouillon dont la case est cochée et vérifier que le PDF enregistré contient la planche. Les PDF sont rendus depuis la production.

## 7. Suite préparée : décor d'inspiration

Une banque de **60 images (49 sujets)** est prête : objets naturels générés par gpt-image, détourés en PNG transparent.
- Elles sont classées en 7 ambiances (CL, GR, SO, BO, TE, VE, BL) et étiquetées avec les mêmes teintes que `matieres.teinte_filtre`.
- Elles sont réduites à 600 px et nommées `jc-deco-<code>-<variante>.png`.
- Emplacement : `Téléchargements\deco-inspiration\shopify-600\`, avec `index-etiquettes.csv`. Les originaux sont dans le dossier parent.

C'est l'objet du chantier suivant.

---

## 8. Chantier « réglages après coup et décor » (13.10.2026)

Branche `feat/planche-reglages-decor`, **PR #64 mergée le 13.10.2026, `main` = `31bb443`** (17 fichiers, +1 102 / −67). Convention P0-19 : documents cités par numéro.

⬜ **Reste à faire en production** : transformer un brouillon de TEST réglé sur « Planche + décor », puis vérifier le PDF enregistré (le décor n'existe dans un PDF enregistré qu'après le merge, pdf.co lisant la prod) et mesurer son poids.

### 8.1 Décisions de cadrage (validées par Thierry)

- **La planche reste calculée en direct, rien n'est figé.** `data.moodboard.palette` n'est toujours pas écrite. Une commande révisée (article ajouté ou retiré) voit sa planche suivre ses lignes. Le PDF initial archivé (`commandes/<slug>_initial.pdf`) reste la preuve, intact.
- **Seul le RÉGLAGE d'affichage est enregistré** : `data.moodboard.affichage = "aucune" | "planche" | "planche-decor"`, avec `actif` recopié à côté (`actif = affichage !== "aucune"`) pour les documents et le code antérieurs. Sans `affichage`, `actif: true` se lit « planche ».
- **Réglage après coup depuis le dashboard** (carte Planche couleurs) :
  - offre non signée et commande : choix à trois positions + rendu, enregistré comme **correction tracée** (auteur, motif) ;
  - **offre signée : lecture seule**, renvoi vers la commande née de la signature (c'est son PDF que voit le client).
- **Rien n'est régénéré au réglage** : le PDF est recréé à chaque ouverture depuis le dashboard, il reprend donc le réglage du moment.

### 8.2 Base

- **SQL 033** : `matieres_pour_offre` renvoie aussi `teinte_filtre` (DROP + CREATE, mêmes revoke/grant). Exécutée et vérifiée le 13.10.2026. Ordre de `teinte_filtre` : principale en premier (non alphabétique : 417 tableaux sur 1 137 à plusieurs teintes le sont) ; 17 matières ont `multicolore-motif` en tête, l'app la saute.
- **SQL 034** : RPC `regler_planche(p_slug, p_affichage, p_mode, p_sens, p_corrected_by, p_reason)`, une transaction : `jsonb_set` + fusion dans `data.moodboard` (jamais `data` en bloc) et insertion dans `corrections`. Refuse une offre signée. Aucun changement → rien n'est écrit. `service_role` seul. Exécutée et vérifiée le 13.10.2026.
- `offres` porte **quatre** triggers, pas trois : `offres_sync_suivi_livraison` (sur `statut_livraison` seulement) s'ajoute aux trois connus.

### 8.3 Partie A — fichiers

| Fichier | Changement |
|---|---|
| `lib/moodboard.ts` | `AffichageMoodboard`, `AFFICHAGES_MOODBOARD`, `estAffichageMoodboard`, `reglagesAEcrire` ; `COTE_MIN_GROS_PLAN` supprimée (P3-90) |
| `app/api/offres/[slug]/planche/route.ts` | Nouvelle route interne → RPC `regler_planche` (409 si offre signée) |
| `components/MoodboardCard.tsx` | Choix à trois positions, rendu, nom + motif, lecture seule sur offre signée |
| `components/MoodboardReglages.tsx` | Trois boutons radio à la place de la case |
| `DraftFormulaire.tsx` | Snapshot `moodboard: reglagesAEcrire(moodboard)` |
| `app/dashboard/[slug]/page.tsx` | Props `offreSignee` et `commandeIssue` de la carte |
| `CorrectionsHistoryBlock.tsx` | Libellés en clair pour `moodboard.*` |
| `api/offres/[slug]/matieres/route.ts` | Renvoie `affichage` ; palette figée lue pour une Commande seulement |
| `lib/revision-diff.ts` | 🔴 Correctif d'un défaut latent de la PR #63 (voir 8.5) |

### 8.4 Partie B — le décor d'inspiration

- **Placement retenu : coin bas gauche, sous les pastilles** (variante A sur quatre maquettées). La zone prend la place libre de la colonne de gauche ; une requête de conteneur (`@container (aspect-ratio > 2)`) la masque quand elle est trop basse. Masquée aussi sur la page planche en mobile.
- **Banque** : `lib/moodboard-decor.ts`, 60 entrées générées depuis `index-etiquettes.csv` et les URL lues par l'API Admin (files, `jc-deco-`). Donnée distincte de la table `matieres`.
- **Couleur de l'offre** : poids CHF réparti entre les teintes (2 parts la principale, 1 les autres, `multicolore-motif` ignorée) ; dominante ; seconde = teinte suivante d'une autre ambiance ≥ 15 % ; accent = teinte colorée ≥ 10 %.
- **Choix** : un minéral + un végétal de l'ambiance dominante, puis une image de la seconde, sinon de l'accent, sinon de la teinte suivante d'une autre ambiance (même sous 15 %) — d'une autre nature si l'ambiance le permet, la même sinon (les verts n'ont que végétal + un minéral).
- **Exclusions par famille de la planche** (pas de rapprochement par nom) : bois → aucun objet en bois ; corde → corde grise, jute ; tissu / toile → lin ; céramique → tesson ; pierre → béton, molasse, travertin, ardoise.
- **Graine du tirage : les clés des finitions, triées — pas le slug.** Écart assumé au cadrage : avec le slug, le brouillon, l'offre et la commande (trois slugs) montraient trois décors différents. Mêmes finitions → même décor, à chaque étape.
- **Images en PNG, 220 px, par `urlDecor()`** — jamais `urlCdn()` (JPEG, pas de transparence). Mesuré au rendu Chromium (2 planches) : +1,26 Mo à 300 px avec ombre, +0,74 Mo à 300 px sans ombre, **+0,93 Mo à 220 px avec ombre** (retenu, ~450 Ko par planche). L'ombre portée (`filter: drop-shadow`) fait intégrer l'image en matrice.
- **Premiers résultats** (avant le retrait des châtaignes, voir plus bas) : CMD-80669 → terre, châtaignes, bois flotté ; DEV-2026-903 → terre, châtaignes, lin.
- **Limite de la banque** : les « bois et bruns » n'ont qu'un minéral (la terre) → toute dominante bois reçoit la terre. À compléter côté banque (un ou deux minéraux bruns).
- **Châtaignes retirées de la banque** (BO-05 a et b, choix de Thierry) : 58 objets tirables. Les fichiers restent dans Shopify. Pour que les bruns gardent un végétal, le minéral et le végétal se cherchent désormais dans l'ambiance dominante **ou** parmi les objets qui portent la teinte dominante (allium séché, bourgeon), et le tirage préfère les objets dont la teinte dominante est la **principale** (une brique « rouge, brun » passait avant la terre « brun »). Résultats : CMD-80669 → terre, allium séché, bois flotté ; DEV-2026-903 → terre, corde de jute, pampa.
- **Le choix ne regarde pas les pixels** : il lit les étiquettes posées à la main dans `index-etiquettes.csv` (ambiance, nature, teintes). Une étiquette fausse donne un objet mal assorti sans que rien ne le signale.
- Test sans écriture : `/print/offre/<slug>?moodboard=poids&decor=1`.
- **Disque de fond sous les objets** (demande de Thierry, 13.10.2026) : la couleur MOYENNE de la planche, calculée en CIELAB (une moyenne en RVB donne un gris sale), pondérée par la racine carrée du poids CHF comme la palette, puis éclaircie de 35 % vers le blanc (`ECLAIRCIR_FOND`). Essayée puis écartée : la teinte la plus claire, trop dépendante d'une seule finition (DEV-2026-903 tirait vers le rose du teck). Résultats : CMD-80669 → #cfccc5, DEV-2026-903 → #bfb6b0. Cercle CSS, sans image : poids négligeable.

### 8.5 Trouvailles

- 🔴 **Défaut latent de la PR #63 dans le diff de révision** : le formulaire envoie toujours `data.moodboard` ; sur une commande sans planche enregistrée, le diff y voyait un changement à chaque révision, donc une version fantôme. Aucune révision depuis le merge (vérifié) : aucun dégât. Corrigé : comparaison de la forme normalisée (`normPlanche`).
- **Conversion de fins de ligne** : trois fichiers d'origine finissent sans retour à la ligne ; une conversion `sed 's/$/\r/'` y ajoutait un CR isolé (le piège du doc 04). Détecté avant écriture ; conversion par remplacement `\n` → `\r\n` uniquement. `app/print/offre/[slug]/page.tsx` garde son `}\r` final d'origine.
- **Incident de test** : le smoke test de la partie A a été fait par erreur sur une vraie commande, CMD-80669, au lieu de CMD-80666. Effet client nul (réglage revenu à « sans planche », PDF identique) ; deux lignes de correction « test » restent dans son historique interne.
