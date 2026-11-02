# Bilan de passation — Mentions Expo / Soldes, accueil v2, révisions (10.10.2026)

> À coller dans la conversation de consolidation. Aucun doc projet n'a été écrit
> par cette session. Trois demandes du terrain, traitées à la suite le 10.10.2026.
> Convention P0-19 respectée : documents cités par numéro, jamais par nom de client.

## 0. Commits

| Commit | Branche | Objet | État |
|---|---|---|---|
| `a751c65` | `feat/mention-expo-soldes` | Mentions Expo / Soldes sur les lignes et l'article à la volée | ✅ en prod (fast-forward sur `main`) |
| *(hash non relevé)* | `fix/v2-bouton-nouvelle-offre` | Accueil v2 : « Nouvelle offre » aligné sur le contenu en grand écran | ✅ mergé sur `main` |
| `29a8754` + `2dcd38d` | `fix/revision-diff-complet` | Révision : texte, SKU, image, commentaires, logos, ordre créent une version | 🟡 **poussé, en attente du test preview puis du merge** |

`2dcd38d` ne fait que remettre les fins de ligne LF (voir §3, doc 04). Le diff réel de la
branche contre `main` : 3 fichiers, **+130 / −1**.

## 1. Ce qui a été livré

### 1.1 Mentions « Expo » / « Soldes » (`lib/mention-vente.ts`, `DraftFormulaire.tsx`)

- Boutons **Expo** / **Soldes** sous la désignation de chaque ligne produit ou à la volée
  (écran seulement), et deux cases dans l'onglet « Article à la volée » (normal et grand
  écran), appliquées à l'ajout puis remises à zéro.
- Textes : « Article d'exposition ni repris ni échangé. Vendu en l'état tel que vu et
  essayé. » / « Article soldé ni repris ni échangé. » / combinée « Article d'exposition
  soldé ni repris ni échangé. Vendu en l'état tel que vu et essayé. » *(point final
  ajouté au texte Expo, par cohérence.)*
- **La mention est écrite à la fin du titre** (séparateur « — ») : visible partout où le
  titre l'est — page client, impressions, fiche bleue, bulletin, export WinBiz,
  connecteur. **Aucun rendu touché, aucune colonne, aucune RPC.**
- L'état n'est pas stocké : il se **relit** à la fin du titre. Fonctionne aussi sur une
  ligne Shopify, dont le titre reste verrouillé à la main.
- En révision, boutons **grisés sur les lignes héritées** de la commande.
- Pas de case « collante » dans le picker Shopify : risque de marquer un article neuf.
- Contrôles : typecheck sur projet miroir (aucune erreur nouvelle), tests unitaires des
  bascules, garde-fou `if (revisionMode) return;` toujours à 1 occurrence.
- **WinBiz** : la description devient « titre — mention / Art. SKU » ; le tiret cadratin
  est dans cp1252 (0x97), aucun `?`, aucun avertissement de nettoyage.

### 1.2 Accueil v2 : bouton « Nouvelle offre » (`app/v2/v2.css`)

- La barre du haut prend toute la largeur, le contenu de l'accueil s'arrête à 1700 px :
  le bouton partait dans le coin de l'écran. Règle
  `.v2-main:has(.v2-page) > .v2-topbar { padding-right: max(24px, calc(100% - 1676px)) }`
  sous `@media (min-width: 821px)`. **Limitée à l'accueil** (seule page en `.v2-page`).
- Vérifié dans Chromium : bouton et « Jardi » au même pixel à 1400, 2000 et 3200 px.

### 1.3 Révisions : « Aucun changement détecté » à tort (`lib/revision-diff.ts`)

- **Cause** : `computeRevisionDiff` ne voyait que ajouts/retraits d'articles,
  qty/prix/remise et en-tête. Une révision qui ne changeait **qu'un texte, un SKU, une
  image, un commentaire, un logo ou l'ordre** était refusée par
  `api/offres/[slug]/reviser`.
- **Signalement terrain partiellement inexact** : « supprimer un article bloque » est
  **faux** d'après la base — 6 révisions « suppression seule » enregistrées sur 60 jours,
  aucune ligne de commande sans `id` ni `id` dupliqué (329 commandes, 1 007 lignes).
  Probablement une ligne commentaire, ou une suppression accompagnée d'une retouche de
  texte.
- **Correctif** : nouvelle liste **`autresChanges`** dans le diff
  (`{ quoi, sku?, title?, avant?, apres? }`), comptée dans `hasChanges`. Couvre :
  désignation, SKU, image, stock **saisi** d'un article à la volée (pas celui d'une ligne
  Shopify, figé J0), commentaire ajouté / modifié / supprimé, image-logo ajouté /
  remplacé / supprimé / taille, ordre relatif des lignes.
  Comparaison tolérante (`undefined` = `null` = `""`, espaces de bord ignorés).
- **Côté stock : strictement inchangé** (`retraits` / `ajouts` identiques).
- Affichage : `RevisionsHistoryBlock.tsx` rend la nouvelle liste ; les diffs archivés
  sans la clé s'affichent comme avant. `api/revisions` : type seulement.
- **RPC `reviser_commande` relue en base** : elle insère `p_diff` tel quel → aucune
  migration.
- **Validation sur données réelles** : le nouveau diff rejoué sur les **54 révisions des
  75 derniers jours** → **zéro faux positif** (ni image, ni ordre). Et il révèle des
  modifications passées **absentes de l'historique** : commentaires modifiés / ajoutés /
  supprimés, désignations et un SKU corrigés, enregistrés parce qu'un autre changement
  accompagnait la retouche.
- 12 cas ciblés passés, typecheck sans erreur nouvelle.

## 2. Entrées de backlog

*Numéros à attribuer par la consolidation.*

**À passer en ✅** : aucune entrée existante ne couvrait ces trois demandes.

**Nouvelles :**

| Gravité | Sujet | Détail |
|---|---|---|
| **P2** | **Historique des révisions incomplet avant le 10.10.2026** | Les retouches de texte / commentaire / SKU passées avec un autre changement ne figurent pas dans `diff` (exemples relevés le 10.10 sur les 75 derniers jours). La vérité reste dans `data_avant` des snapshots. Pas de réécriture rétroactive : les diffs archivés sont des preuves |
| **P3** | **Longueur max du champ 51 WinBiz inconnue** | Avec une mention, une description dépasse 150 caractères. Notre code ne tronque pas. À vérifier par un export de test (dossier TEST) |
| **P3** | **Ordre de la description WinBiz** | « titre — mention / Art. SKU » : le SKU arrive après la mention. Option : sortir la mention et la mettre en fin de ligne dans `winbiz-export.ts` (non sanctuarisé) |
| **P3** | **Mention non modifiable sur une ligne héritée en révision** | Voulu (preuve). Si le besoin d'ajouter une mention oubliée sur une commande apparaît, passer par une correction tracée |
| **P3** | **Mention retouchée à la main = plus reconnue** | Les boutons repassent à « off » ; recliquer ajoute une mention propre à la suite. Sans gravité |

## 3. Docs à mettre à jour

- **01 architecture** : nouveau module `lib/mention-vente.ts` ; règle d'alignement de
  la barre v2 dans `app/v2/v2.css`.
- **02 modèle de données** — aucune colonne, RPC ni migration.
  - `commandes_revisions.diff` peut porter **`autresChanges`** (depuis le 10.10.2026).
  - La mention Expo / Soldes vit **dans `lines[].title`**, pas dans une clé dédiée.
  - Les 5 RPC du connecteur ne sont pas concernées. **À vérifier dans le doc 08** : si
    le connecteur lit `commandes_revisions.diff`, la clé ajoutée est additive.
- **03 règles métier** :
  - Mentions Expo / Soldes : textes exacts (§1.1), combinables, écrites dans le titre.
  - **Exception assumée à la règle d'or n°1** : « soldé » évoque une liquidation, mais
    c'est une condition de vente (ni repris ni échangé) que le client doit voir. Décision
    de Thierry, 10.10.2026.
  - Révision : tout changement visible du document crée une version, y compris texte,
    commentaire, logo et ordre.
- **04 pièges** :
  - 🔴 **Corriger le bilan du 08.10 et le journal d'octobre : le dépôt n'est PAS en
    CRLF.** Vérifié sur GitHub le 10.10 : les fichiers sont stockés en **LF** ;
    `core.autocrlf` les présente en CRLF dans le dossier de travail Windows. Un fichier
    écrit en CRLF est re-normalisé en LF au commit — **sauf s'il contient un CR isolé**
    (ici, un `\r` final sans `\n`) : Git renonce alors à convertir et le commit réécrit
    tout le fichier (« 772 insertions / 643 suppressions » pour ~130 lignes réelles).
    Contrôle : `git diff --stat main` après commit, ou compter les CR du fichier brut
    sur GitHub.
  - Un fichier modifié non commité **suit** un `git checkout` : le correctif `v2.css` a
    failli partir avec la mauvaise branche. `git status` avant chaque checkout.
  - La comparaison de révision ne doit pas comparer de valeurs absentes / vides
    littéralement (`undefined` ≠ `""`) : faux positifs garantis.
- **06 décisions** :
  - **D-e** : mention de vente écrite dans le titre, état relu depuis le titre — une
    seule source, aucun rendu à toucher.
  - **D-f** : pas de case « collante » dans le picker Shopify ; bascule sur la ligne.
  - **D-g** : `autresChanges` suffit à créer une version, sans aucun effet sur le stock ;
    le stock d'une ligne Shopify n'y est jamais suivi (figé J0).
- **07, 09** : rien à changer.

## 4. Vérification des greffes

Aucune entrée rangée en greffe.

## 5. Ménage

- Après le merge de `fix/revision-diff-complet` : supprimer les branches
  `feat/mention-expo-soldes`, `fix/v2-bouton-nouvelle-offre`, `fix/revision-diff-complet`
  (à ajouter à P3-28).
- Export WinBiz de test d'une commande avec une ligne Expo + Soldes (dossier TEST) pour
  lever le doute sur la longueur du champ 51.
