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
