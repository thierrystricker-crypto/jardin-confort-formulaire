# Journal — Bulletin de livraison à la volée

> Session du **02.09.2026** (Cowork). Branche `feature/bulletin-livraison-volee`,
> **mergée en prod le 02.09.2026** après smoke test sur preview.
> Ce journal est la source détaillée du chantier. La consolidation vers les docs
> projet (01, 02, 04, 05, 06) se fait dans la conversation de consolidation — ce
> chantier n'y écrit pas.

---

## 1. Le besoin

Le bouton « 🚚 Bulletin livraison » de la fiche commande imprimait une **réplique
exacte de la commande**. Dès qu'un envoi est partiel (une partie de la commande
part, le reste suit), ou qu'on joint quelque chose qui n'est pas sur la commande
(pièce de rechange, accessoire), le bulletin est faux. Le texte de remerciement
du bulletin annonçait déjà « les éventuels articles non livrés… feront partie
d'une livraison ultérieure » : l'envoi partiel était prévu dans l'esprit, pas
dans l'outil.

**Demande de Thierry :** une page bulletin à la volée où les lignes se
suppriment, se modifient (quantité) et s'ajoutent facilement, avec impression et
enregistrement en PDF en option.

**Arbitrages pris le 02.09 :**
- PDF **serveur + historique** (pas seulement « Enregistrer au format PDF » du
  navigateur) : une table `bulletins_livraison`, un PDF par bulletin dans le
  bucket `pdfs`, visible sur la fiche commande.
- Ajout de lignes en **texte libre** (désignation, référence facultative,
  quantité). Le picker Shopify est hors périmètre (P-nouveau ci-dessous).
- Une **mention libre éditable** imprimée sous le titre (« Livraison partielle
  1/2 », « Solde de commande »…), vide par défaut donc invisible.

---

## 2. Ce que le code montrait avant de coder

- `app/print/bulletin-livraison/[slug]/page.tsx` (405 l.) : page de rendu pur,
  un seul bouton Imprimer, lignes affichées telles quelles depuis `data.lines`.
- `app/dashboard/[slug]/page.tsx` l. 1320 : simple lien `<a>` vers la page,
  visible seulement si `isCommandeReelle`.
- `app/print/all/[slug]/page.tsx` porte **sa propre copie** du bulletin
  (préfixe `bl-`) — non touchée, elle reste la réplique de la commande.
- Modèle réutilisable pour le PDF : `api/offres/[slug]/fiche-travail-pdf` (pdf.co
  rend la page `/print/...` avec `jc_token` en query, dépôt bucket `pdfs`).
- `proxy.ts` : `jc_token` n'est accepté que sur `/print/*`. Une page rendue par
  pdf.co peut donc lire `/api/offres/[slug]` (public), mais **pas** une API
  interne — d'où le point 3.4.

---

## 3. Ce qui a été livré

### 3.1 La page `/print/bulletin-livraison/[slug]` devient éditable (réécrite)

- **Barre fixe en haut d'écran** (masquée à l'impression) : compteur
  « X / Y articles · N pièces · déjà K bulletins enregistrés · modifié », champ
  Mention, boutons **📥 Reste à livrer** (si un bulletin est déjà enregistré),
  **＋ Ajouter une ligne**, **↺ Tout remettre**, **🖨 Imprimer**,
  **💾 Enregistrer en PDF**.
- **Par ligne** : champ quantité (min 1, surligné ambre si modifié, badge
  « qté 2 → 1 »), bouton ✕ qui **retire** la ligne de ce bulletin (elle reste
  visible grisée et barrée à l'écran avec « ↩ Remettre » ; elle **sort** à
  l'impression), lignes commentaire et média retirables aussi.
- **Ajout de ligne** : formulaire en pied de tableau (désignation, réf.
  facultative, qté ; Entrée = ajouter, Échap = fermer). Ligne verte à l'écran
  avec badge « ajoutée », **sans distinction à l'impression**.
- **Mention** : imprimée sous « Bulletin de livraison » dans un cartouche ambre,
  même style que « RETRAIT EN MAGASIN ».
- **Reste à livrer** : pour chaque ligne d'origine, `qtyOrig − Σ qty déjà
  enregistrées (par sourceId)`. Reste ≤ 0 → ligne retirée ; sinon quantité =
  reste. Les lignes ajoutées aux bulletins précédents n'entrent pas dans le
  calcul (elles n'ont pas de `sourceId`). Pose la mention « Livraison N — solde »
  si le champ est vide.
- **Ouverte sans rien toucher, la page imprime exactement ce qu'elle imprimait
  avant.** Le bouton du dashboard est inchangé (seul son `title` a été précisé).
- **Mode lecture seule `?bulletin=<uuid>`** : affiche un bulletin enregistré
  (lignes et mention telles qu'enregistrées), barre réduite à « n° K enregistré
  le … · PDF · Nouveau bulletin · Imprimer ». C'est ce mode que pdf.co rend, et
  c'est lui qu'ouvre « Réimprimer » depuis le dashboard.
- **Rien n'écrit jamais dans `offres`.** La commande reste la preuve.
- **Aucun prix, aucun stock** : inchangé.

À l'impression, `@media print` masque : barre, bandeaux, colonne « édition »,
badges, lignes retirées, ligne d'ajout, et remplace le champ quantité par du
texte (`.bl-only-screen` / `.bl-only-print`). Vérifié en local par rendu
Playwright en média `print` : le document imprimé est identique au bulletin
d'origine, aux lignes retirées près.

### 3.2 Table `bulletins_livraison` — `docs/sql/013-bulletins-livraison.sql`

`id uuid`, `offre_slug`, `numero_affiche`, `numero_bulletin int` (1, 2, 3… par
commande, **index unique** `(offre_slug, numero_bulletin)`), `mention`, `lines
jsonb` (`{sourceId, type, sku, title, qty, image?, mediaUrl?, mediaSize?,
mediaSource?}` — **jamais de prix**), `nb_lignes`, `nb_pieces`, `pdf_url`,
`pdf_erreur`, `cree_par`, `created_at`. RLS activée, aucune policy (posture
`pieces_jointes`). Ne touche à aucune table existante → aucun risque pour les
5 RPC du connecteur.

⚠️ **À exécuter dans le SQL Editor Supabase (projet `llkyzspixrbtoprtmvoh`)
AVANT de tester la preview.** Sans la table, « Enregistrer en PDF » renvoie une
erreur claire, et l'édition/impression fonctionnent quand même.

### 3.3 Routes API

| Route | Rôle |
|---|---|
| `GET /api/bulletins-livraison?slug=` | Historique d'une commande, plus récent en premier. Cookie. |
| `POST /api/bulletins-livraison` | `{ slug, mention, lines }`. Vérifie que le document est une **Commande**, nettoie les lignes (liste blanche, 200 lignes max, qté entière ≥ 1), calcule `numero_bulletin`, **insère d'abord**, puis pdf.co → `pdfs/bulletins/<slug>_<n>_<jeton>.pdf` → `pdf_url`. Si le PDF échoue : la ligne reste, `pdf_erreur` est renseigné, réponse **502** `{ error, bulletin }`. Cookie. |
| `GET /api/bulletins-livraison/[id]` | Un bulletin par uuid, lecture seule. Cookie **ou** `jc_token` (voir 3.4). |

### 3.4 `proxy.ts` — une ligne de plus, additive

Le bloc « pdf.co doit pouvoir rendre les pages /print » accepte désormais
`jc_token` aussi sur **`GET /api/bulletins-livraison/<uuid>`** (regex stricte
sur l'uuid, GET seul). Raison : la page rendue par pdf.co n'a pas de cookie et
doit relire le bulletin enregistré. Elle transmet le `jc_token` qu'elle a reçu
en query. Rien d'autre ne change ; la liste (`?slug=`) et le POST restent
cookie-only. Vérifié en local : 200 avec jeton, 401 sans, 401 sur la liste même
avec jeton.

### 3.5 Dashboard — `components/BulletinsLivraisonBlock.tsx` + 3 lignes dans `/dashboard/[slug]`

Carte « 🚚 Bulletins de livraison » sous « Mouvements de stock », sur les
commandes réelles seulement. Liste : n°, date, mention, articles, pièces,
**📄 PDF** (ou « ⚠️ sans PDF » avec l'erreur en title), **🖨 Réimprimer**
(`?bulletin=<id>`). Bouton « ✏️ Nouveau bulletin (envoi partiel…) ». La carte
existe même vide, avec une phrase qui explique la fonction. Elle se recharge au
retour sur l'onglet (l'éditeur s'ouvre dans un autre onglet).

### 3.6 Date du bulletin (ajout après le premier test, même jour)

**Règle de Thierry :** la date de commande et la date du bulletin (= date
d'envoi) sont **deux choses sans lien** — sauf que la seconde ne peut **jamais**
être antérieure à la première.

- En-tête imprimé : « Date de commande » (figée, non éditable) et « Date du
  bulletin » (champ date dans la barre, pré-rempli à **aujourd'hui**, borne
  `min` = date de commande).
- Vérification **des deux côtés** : la page bloque le bouton et affiche un
  bandeau rouge ; la route POST relit `offres.date_document` et refuse en 400.
- Colonne `date_bulletin date` — migration **`docs/sql/014-bulletins-livraison-date.sql`**,
  qui rétro-remplit les bulletins de test avec leur jour de création.
- La carte du dashboard affiche la date du bulletin (l'horodatage
  d'enregistrement reste en `title`).
- **Éditée EN PLACE dans l'en-tête du document** (demande de Thierry après
  test) : cadre pointillé bleu « cliquer pour modifier », `showPicker()` au
  clic ouvre le calendrier natif. Texte simple à l'impression et dans le PDF.
  Un seul endroit pour l'éditer — le champ n'est pas dans la barre.

### 3.7 Piège preview découvert au premier test — `NEXT_PUBLIC_APP_URL`

`NEXT_PUBLIC_APP_URL` vaut la **production** sur toutes les cibles Vercel,
preview comprise. Conséquences :
- Tous les boutons « Documents » de `/dashboard/[slug]` (🚚, 📦, 🗂, jeu
  complet, page commande client…) ouvrent la **prod** depuis une preview. On
  croit tester la preview, on regarde la prod. **Préexistant, non corrigé ici**
  — à remonter au backlog (liens relatifs).
- `fiche-travail-pdf` fait rendre par pdf.co la page de **prod** depuis une
  preview. Invisible tant que la page existe en prod à l'identique ; faux dès
  qu'une preview change le template.
Correctifs de ce chantier, limités à son périmètre : la carte
`BulletinsLivraisonBlock` utilise des **liens relatifs**, et la route POST
prend l'**origine de la requête** (`x-forwarded-host`) quand
`VERCEL_ENV === "preview"`, `APP_URL` sinon.

Piège évité : `new Date().toISOString().slice(0,10)` donne la veille après
22 h (heure de Zurich → UTC). La date du jour est construite en local.

---

## 4. Fichiers touchés

| Fichier | Nature |
|---|---|
| `app/print/bulletin-livraison/[slug]/page.tsx` | **Réécrit** (405 → ~680 l.) — le template imprimé est conservé à l'identique, plus « Date de commande » / « Date du bulletin » |
| `app/api/bulletins-livraison/route.ts` | Nouveau |
| `app/api/bulletins-livraison/[id]/route.ts` | Nouveau |
| `components/BulletinsLivraisonBlock.tsx` | Nouveau |
| `app/dashboard/[slug]/page.tsx` | +1 import, +1 rendu de carte, 1 `title` précisé |
| `proxy.ts` | +7 lignes, additives |
| `docs/sql/013-bulletins-livraison.sql` | Nouveau — **à exécuter à la main** |
| `docs/sql/014-bulletins-livraison-date.sql` | Nouveau — **à exécuter à la main**, après 013 |

Aucun fichier sanctuarisé touché. Aucune colonne existante touchée.

---

## 5. Smoke test à faire sur la preview Vercel

Sur une **commande de test** (pas un vrai client) :

1. Ouvrir « 🚚 Bulletin livraison » → la page s'affiche avec la barre ; Imprimer
   (aperçu) → identique à l'ancien bulletin, sans barre ni colonne « édition ».
2. Passer une quantité de 2 à 1, retirer une ligne, ajouter « Pied de parasol
   de remplacement », mention « Livraison partielle 1/2 » → aperçu d'impression :
   3 lignes, quantité 1, cartouche ambre, pas de trace de la ligne retirée.
3. « Enregistrer en PDF » (~10 s) → bandeau vert, lien PDF ; le PDF montre le
   même document. Sur la fiche commande, la carte liste le bulletin n° 1.
4. Rouvrir « Bulletin livraison » → compteur « déjà 1 bulletin enregistré »,
   bouton « Reste à livrer » → les quantités restantes s'appliquent, la ligne
   entièrement livrée est retirée, mention « Livraison 2 — solde ».
5. « Réimprimer » depuis la carte → la page en lecture seule montre le bulletin
   n° 1 tel quel.
6. Contrôle SQL après le test : `select numero_bulletin, nb_lignes, nb_pieces,
   pdf_url is not null from bulletins_livraison where offre_slug = '<slug>'`.

Un test qui ne peut pas échouer ne valide rien : au point 2, si l'aperçu
d'impression montre encore la ligne retirée, c'est que `@media print` ne
s'applique pas.

---

## 6. Points ouverts / à remonter au backlog

- **Picker Shopify dans l'ajout de ligne** (image, SKU, titre du catalogue).
  Écarté de la v1 par arbitrage ; réutiliserait `/api/shopify-search`.
- **Le jeu complet `/print/all`** garde sa copie du bulletin, réplique de la
  commande. Si un jour le jeu complet doit imprimer le *dernier* bulletin
  enregistré, c'est un autre chantier (P3-3, dérive des copies).
- **`cree_par`** est prévu en base mais la page ne sait pas qui est devant le
  poste (code d'accès partagé) : vide tant que le chantier 5 n'existe pas.
- **Striping des lignes** : à l'impression en mode édition, une ligne retirée
  (masquée par CSS) décale l'alternance gris/blanc d'une ligne. Purement
  cosmétique ; le PDF enregistré (mode lecture seule) n'a pas ce défaut.
- **Concurrence** : deux enregistrements simultanés sur la même commande se
  disputent `numero_bulletin` ; l'index unique fait échouer le second avec un
  message clair. Pas de reprise automatique — volontairement, le cas est rare.
