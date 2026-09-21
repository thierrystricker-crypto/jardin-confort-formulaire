# Journal — Index 3D et planner (chantier `feature/modeles-3d`)

Cadrage complet : projet Claude « Import articles shopify »,
`claude/planner-3d-et-index-2026-09-19.md` (décisions, picker par collection,
avertissements taille/couleur, mode maquette, ordre de construction).

## 20.09.2026 — Étape 1 : table `modeles_3d` + synchro + page dashboard

**Pourquoi** : le planner 3D (à venir, route `/planner`) a besoin d'un catalogue
qui sache, pour chaque article, s'il a un modèle 3D et où il est. Cette table
sert aussi au badge « 3D » et à la card de faisabilité des offres (étape 3).
Shopify reste la seule source ; la table est un miroir régénérable.

**Base** (`docs/sql/018-modeles-3d.sql`, Supabase de l'app, SQL Editor)
- `modeles_3d` — TOUS les produits (13 984), avec ou sans modèle. Clé =
  `product_id`. Colonnes : identité (handle, titre, marque, statut, publie),
  catalogue (tags, `collection` = tag `Collection_xxx`, `categories` = tags
  `Catégorie_xxx`, `tag_no3dfile`, image, prix_min), variantes/options
  (`variant_mode`, `option_names`, `option_values`, `has_size_option`,
  `has_color_option`, `options_signature`, `options_changed_at`), modèle
  (`source` model3d | url, `url_glb`, `url_usdz`, `gid_model3d`, `nom_fichier`,
  `taille_octets`, `fichier_partage_n`, `model_attached_at`), colonnes
  générées `has_3d`, `size_mismatch_possible`, `color_mismatch_possible`,
  `anomalies[]`, et les colonnes géométrie (bbox, top_view_*, footprint_*)
  réservées à la passe géométrie (étape 1b, pas encore écrite).
- `modeles_3d_sync_etat` — une ligne : bulk operation en cours, statut
  (idle / running / importing / done / error), stats de la dernière passe.
- Vue `v_modeles_3d_marques` — synthèse par marque pour le dashboard.
- RLS activée sans policy (service role seulement). Une policy de lecture
  publique (statut ACTIVE + publié) viendra avec le planner public.

**Synchro** (`lib/modeles-3d-sync.ts`)
- **Bulk operation** Admin GraphQL (`bulkOperationRunQuery`) sur `products` :
  id, titre, handle, vendor, statut, publishedAt, tags, image, options
  (`optionValues`), métachamps `custom.model_3d_url` et `custom.model_3d_glb`
  (+ `reference … on Model3d` : fichiers glb/usdz, taille), variantes (id, sku,
  titre, prix). ≈ 3 min côté Shopify pour 14 000 produits, un JSONL de ~40 Mo
  téléchargé et parsé en une passe, upsert par lots de 500, puis suppression
  des fiches disparues de Shopify (`synced_at` antérieur à la passe).
- ⚠️ Le fragment `... on Model3d` dans `product.media` ne renvoie RIEN en bulk
  (vérifié le 19.09) — et de toute façon aucun Model3d n'est un média produit
  chez nous : tout passe par les métachamps. Ne pas « corriger » en ajoutant
  `media` à la requête.
- ⚠️ Scope : la lecture de `reference … on Model3d` exige `read_files` sur
  l'app Client Credentials (en plus de `read_products`). Si tous les
  `source = 'url'` sortent mais aucun `model3d`, c'est ce scope qui manque.
- Résumable : `etapeSynchro()` fait UN pas (démarre / vérifie / importe) ;
  `executerSynchro()` enchaîne en attendant (cron, ≤ 230 s). Si Shopify n'a
  pas fini, l'état reste `running` et le prochain passage reprend. Un
  `importing` figé depuis plus de 10 min est considéré comme mort → `error`.
- Classification : `has_size_option` (nom d'option Taille/Dimension/Format/
  Diamètre/Longueur… OU majorité de valeurs en « 140x80 », « cm », « Ø ») ;
  `has_color_option` (Couleur/Coloris/Finition/Teinte/Tissu/Toile/Structure).
  La détection couleur par code (table `couleurs_marque`) viendra plus tard.
- Anomalies (uniquement sur les fiches AVEC modèle) : > 3 Mo / > 5 Mo, nom de
  fichier générique (Projet_sans_nom…), fichier partagé par n produits, tag
  `no3dfile` obsolète, options modifiées depuis le rattachement du modèle,
  sans collection.
- `model_attached_at` = première synchro où un modèle a été vu sur la fiche ;
  `options_changed_at` = signature des options différente de la veille (une
  variante ajoutée un an après déclenche l'avertissement toute seule).

**Routes**
- `GET /api/cron/modeles-3d-sync` — nuit, `15 3 * * *` UTC (05:15 CH été),
  `Authorization: Bearer $CRON_SECRET` comme shopify-sync. Notification interne
  unique en cas d'échec (type `shopify_sync_erreur`).
- `GET|POST /api/modeles-3d/sync` — interne (cookie) : état / un pas de synchro.
  Le bouton du dashboard appelle POST toutes les 5 s jusqu'à `done`.
- `GET /api/modeles-3d/stats` — synthèse par marque, `?anomalies=1`, `?q=`,
  `?collection=&marque=` (déjà la requête du futur picker).

**Page** `app/dashboard/modeles-3d/page.tsx` (+ bouton « 🧊 Index 3D » sur le
dashboard) : statut + dernière synchro + bouton « Rafraîchir l'index 3D »,
KPI, tableau par marque (clic = filtre), liste des anomalies ou recherche,
badges « taille / couleur non garantie », liens boutique / admin / fichier.

**Garde-fous** : aucune écriture Shopify, jamais. Le planner et les pages
d'offres ne sont PAS touchés dans cette étape (décision du 19.09 : moteur
d'abord, offres en dernier).

**Mise en route**
1. Exécuter `docs/sql/018-modeles-3d.sql` dans le SQL Editor.
2. Déployer (preview), ouvrir `/dashboard/modeles-3d`, cliquer « Rafraîchir
   l'index 3D », attendre 2 à 4 min.
3. Vérifier : ~1 470 produits avec 3D (852 Model3d + 620 .bin au 19.09), les
   marques Emu / Fermob / Schaffner / Houe en Model3d, Barlow Tyrie / Dedon /
   Les Jardins en URL. Si 0 Model3d → scope `read_files` (voir plus haut).

**Suite** : étape 1b passe géométrie (bbox + vues de dessus + silhouettes,
script Node qui charge chaque GLB nouveau ou modifié) ; étape 2 planner
`/planner` (React Three Fiber, vues Plan/3D, picker par collection) ; étape 3
badge 3D + card de faisabilité + lien offres → planner.

## 20.09.2026 — première synchro en preview + règle `no3dfile`

- Première passe en **31 s** (Shopify plus rapide que l'export de la veille) :
  13 984 produits, **1 539 avec modèle** (850 Model3d + 689 .bin, dont les 69
  Extremis importés le 19.09). Scope `read_files` OK.
- « 1 359 avec anomalies » : presque tout venait de « tag no3dfile obsolète »
  (Barlow Tyrie 488/488, Les Jardins 379/379, Dedon 546/548). Cause trouvée :
  la règle de tagage automatique (condition Twig dans l'app de workflows) ne
  regardait que `custom.model_3d_glb` — elle datait d'avant le passage aux
  .bin par URL (17.09). **Corrigée** : `no3dfile` = les DEUX métachamps vides
  (`model_3d_glb is empty and model_3d_url is empty`). À relancer sur tout le
  catalogue, puis « Rafraîchir l'index 3D » : l'anomalie doit tomber à zéro.
- Le tag `no3dfile` n'est **pas** utilisé par le thème (cascade sur les
  métachamps uniquement) ; c'est un repère interne « où il manque des modèles ».
  L'anomalie reste en place comme garde-fou : elle signalera si la règle
  recasse.
- « Taille ? » vide sur Fermob / Emu / Schaffner = normal : chez ces marques
  chaque dimension est une fiche, pas une option de variante.
- « Nouveaux modèles = 1 539 » à la première passe : normal, ne compte que les
  nouveaux à partir de la 2ᵉ synchro.

## 20.09.2026 — Étape 2 : le planner (`/planner`, branche `feature/planner-3d`)

**Périmètre** : page interne isolée (aucun état partagé avec le formulaire
d'offres), catalogue manuel, une scène avec deux vues. Rien côté offres.

**Dépendances** : `three`, `@react-three/fiber` (v9, React 19),
`@react-three/drei` (v10), `@types/three`. Le canvas est importé en
`dynamic(…, { ssr: false })`.

**Fichiers**
- `docs/sql/019-planner-scenes.sql` — table `planner_scenes` (nom, cree_par,
  offre_slug pour l'étape 3, terrasse jsonb, items jsonb, mode, vue). RLS sans
  policy.
- `lib/planner-types.ts` — `CatalogueItem`, `SceneItem` (uid, product_id, url,
  x, z, rot, size_warn, color_warn), `Scene`, `MENTION_LEGALE`.
- `app/api/planner/catalogue/route.ts` — marques → collections (compteurs
  avec 3D / total) → articles d'une collection (3D en premier, sans 3D grisés) ;
  recherche `?q=`. Fiches ACTIVE seulement.
- `app/api/planner/scenes/route.ts` + `[id]/route.ts` — liste / création /
  lecture / mise à jour / suppression.
- `components/planner/PlannerCanvas.tsx` — le moteur : terrasse + `Grid`
  50 cm / 1 m, modèles `useGLTF(url, draco, meshopt)`, **recentrage au
  chargement** (pieds à y = 0, centre de l'empreinte à l'origine) et remontée
  des cotes mesurées ; glisser sur le sol (aimant 5 cm), sélection avec halo
  + étiquette de cotes ; vue Plan = `OrthographicCamera` vue de dessus
  (`up = [0,0,-1]`, rotation désactivée, clic gauche = déplacer la vue), vue
  3D = `PerspectiveCamera` + OrbitControls ; mode maquette = un
  `MeshStandardMaterial` gris substitué à tous les matériaux (originaux gardés
  dans `userData`) ; capture via `preserveDrawingBuffer` ; un modèle qui ne
  charge pas devient un cube rouge « Modèle non chargé » (garde d'erreur par
  article, la scène continue).
- `components/planner/PlannerCatalogue.tsx` — recherche, marque, collections,
  vignettes (image Shopify), badges 3D / taille ? / couleur ? ; règle du picker :
  un résultat de recherche a un bouton « collection › » qui ouvre toute sa
  collection.
- `app/planner/page.tsx` — barre (nom, Plan/3D, Couleurs/Maquette, terrasse
  L × P, aimant, Nouvelle / Ouvrir / Enregistrer / Capture), outils de
  l'article sélectionné (⟲ ⟳ 90° dupliquer supprimer), liste des articles posés
  avec cotes mesurées, total indicatif et avertissements, mention légale
  affichée en permanence et écrite dans la capture PNG. Raccourcis : R / Maj+R,
  flèches (5 cm, Maj = 25 cm), Suppr, Ctrl+D, Échap. `?scene=<id>` recharge
  une scène ; garde `beforeunload` si modifications non enregistrées.
- `app/dashboard/page.tsx` — bouton « 🪑 Planner 3D ».

**À valider au premier essai (c'est le but du prototype)**
1. CORS : un .bin (Barlow Tyrie / Dedon / Les Jardins) ET un Model3d
   (Schaffner / Fermob / Emu) se chargent depuis offres.jardin-confort.ch.
   Sinon cube rouge → lire la console (`Access-Control-Allow-Origin`).
2. Échelle : une chaise Schaffner ≈ 55 × 60 × H 85 cm, une table Dedon ≈ ses
   cotes catalogue ; un Les Jardins ou un Barlow Tyrie aberrant (× 100 ou
   ÷ 100) se voit tout de suite dans l'étiquette de cotes.
3. Poids : dix articles Dedon (meshopt) dans une scène restent fluides ?
4. Orientation : les chaises pCon « de dos » (yaw) — à corriger dans le
   pipeline, pas dans le planner.

**Pas encore** : silhouettes 2D pré-calculées (passe géométrie, étape 1b),
recoloration Fermob, lien offres (étape 3), page publique.

## 20.09.2026 — Planner : retours v1 (branche `feature/planner-3d`)

Premier essai concluant : CORS OK sur .bin et Model3d, échelle OK. Retours de
Thierry et réponses :

- **Chevauchement et débordement de la terrasse** : conservés volontairement
  (utile pour mimer une pile, un débord de parasol, une extension).
- **Ombres pixelisées** → `PCFSoftShadowMap`, carte 4096², caméra d'ombre
  serrée sur la terrasse (± L/2+2, ± P/2+2 m) au lieu de ± 12 m fixes, `bias`
  et `normalBias` réglés (moins d'acné d'ombre sous les tressages).
- **Fond blanc agressif** → fond `#26292e`, cohérent avec le dashboard sombre.
- **Couleur du sol** → colonne `sol` sur `planner_scenes` (SQL 020) et
  presets `SOLS` dans `lib/planner-types.ts` (bois, pierre, béton, gravier,
  gazon, blanc) ; sélecteur dans la barre ; enregistré avec la scène.
- **Clic hors du plan doit désélectionner** → `onPointerDown` sur le plan de
  sol invisible (hors glisser) → `onSelect(null)`.
- **Nouvel article au milieu du plan** → `caseLibre()` : bande de dépôt sous la
  terrasse (z = P/2 + 0,9 m), cases de 1 m de gauche à droite, première case
  sans article à moins de 0,7 m. On glisse ensuite sur la terrasse.
- **Recherche par SKU** → l'index ne stockait pas les SKU. SQL 020 ajoute
  `sku_1`, `variant_id_1`, `skus text[]`, `skus_txt` ; le sync les remplit
  (première variante = référence) ; `/api/modeles-3d/stats?q=` et
  `/api/planner/catalogue?q=` cherchent aussi dans `skus_txt`. Nécessite un
  « Rafraîchir l'index 3D » après le SQL.
- **Annuler** → historique en mémoire (`passe` / `futur`, 50 états) : Ctrl+Z,
  Ctrl+Y ou Ctrl+Maj+Z, boutons ↶ ↷. Un glisser = un seul état (empilé au
  début du drag, pas à chaque mouvement).
- **Exports** :
  - « 🛒 Liste d'achat » → regroupe les articles par fiche (qty) et crée une
    liste via `POST /api/listes-achat` (`Planner — <nom de scène>`), avec
    `sku` / `variant_id` de la première variante, image et prix ; ouvre
    `/dashboard/listes-achat`.
  - « 🖨 Fiche » → fenêtre d'impression : capture de la vue courante + tableau
    (image, titre, marque, SKU, cotes mesurées, qty, prix indicatif) + mention
    légale. Pas de PDF côté serveur pour l'instant : Ctrl+P → PDF.

Fichiers : `docs/sql/020-modeles-3d-skus.sql`, `lib/modeles-3d-sync.ts`,
`app/api/modeles-3d/stats/route.ts`, `app/api/planner/catalogue/route.ts`,
`app/api/planner/scenes/route.ts`, `app/api/planner/scenes/[id]/route.ts`,
`lib/planner-types.ts`, `components/planner/PlannerCanvas.tsx`,
`components/planner/PlannerCatalogue.tsx`, `app/planner/page.tsx`.

**Limite connue** : le SKU exporté est celui de la première variante ; tant
que le 3D est au niveau fiche, l'utilisateur ajuste la variante dans la liste
d'achat. Quand le 3D sera par variante (doc `3d-par-variante`), le planner
portera la vraie variante.

## 20.09.2026 — 3D par variante dans l'index et le planner

Nouvelle convention (doc projet `3d-par-variante-2026-09-19`) : le métachamp
`custom.model_3d_url` existe aussi **au niveau variante**, rempli seulement
quand la variante change la géométrie. Cascade thème = cascade planner :
variante → `model_3d_glb` (Model3d) fiche → `model_3d_url` fiche.

- Bulk : les variantes remontent `selectedOptions` et leur métachamp.
- SQL 021 : `variantes_3d jsonb` (`[{variant_id, sku, titre, options, url}]`)
  et `variantes_3d_n`. `model_level` passe à `variante` dès qu'une variante a
  son fichier → `size_mismatch_possible` (colonne générée) s'éteint pour la
  fiche. Si la fiche n'a aucun défaut, on prend le premier fichier de
  variante comme défaut, avec l'anomalie « modèles par variante sans défaut
  fiche ».
- Planner : `choixModeles()` (lib/planner-types) dédoublonne par URL (les
  couleurs partagent le fichier de leur taille) et ajoute le défaut fiche
  s'il diffère. Vignette : badge « N tailles » ; un clic ouvre « Quelle
  taille ? » si plusieurs fichiers, sinon pose directement. L'article posé
  porte le vrai `variant_id` / SKU de la taille → la liste d'achat est juste
  pour ces fiches, et pas d'avertissement taille.
- Stats de sync : `par_variante`.

Premiers cas : Marina Extremis (5 fiches), Biohort à suivre.

## 20.09.2026 — Planner : retours v2

- **Nom obligatoire avant export** : Capture, Fiche et Liste d'achat
  demandent un nom (`window.prompt`) si la scène s'appelle encore « Sans
  titre » ; annuler = pas d'export.
- **⛶ Recadrer (touche F)** : repasse en vue Plan et cadre toute la terrasse
  (zoom calculé sur la taille réelle du canvas, marge 1,6 m pour les cotes
  et la bande de dépôt), cible d'OrbitControls recentrée. En 3D : point de
  vue de départ.
- **Rotation fine verrouillée** : certains Dedon sont livrés tournés de ~15°
  (pas de face). Bouton 🔒/🔓 dans les outils de l'article : déverrouillé,
  un curseur ±45° (ou saisie ±180°, pas de 0,5°) pose `rot_fix` sur
  l'article, en plus des pas de 15° de `rot`. Verrouillé par défaut, jamais
  proposé sans clic (SketchUp syndrome). La correction est mémorisée par
  fiche dans le navigateur (`planner-rot-fix`) et réappliquée aux prochains
  exemplaires. **Vraie correction à faire dans le pipeline** (retourner le
  fichier) ; la liste des `rot_fix` posés donne la liste des fichiers à
  corriger.
- **Correctif** : le nom saisi dans la boîte « Nom du plan ? » n'arrivait pas
  dans le fichier PNG / la fiche / la liste (l'état React n'est à jour qu'au
  rendu suivant) → `exigerNom()` renvoie le nom et les exports l'utilisent
  directement.
- **Nom pré-rempli** : un nouveau plan s'appelle « 20.09.2026 Thierry — »
  (date + conseiller `jardi-utilisateur`) ; tant que rien ne suit le tiret, le
  premier export demande de compléter (client, projet), avec ce préfixe déjà
  dans la boîte.
- **Prix** : la fiche affiche maintenant « Prix unitaire TTC » et « Total
  ligne » (qty × unitaire). Le prix est **exact** quand la variante est
  connue (fichier 3D par variante → `variantes_3d[].prix`, nouveau champ
  rempli par le sync ; ou fiche à variante unique) ; sinon c'est le prix le
  plus bas de la fiche, affiché « dès CHF … », et le total devient « dès »
  dès qu'une ligne l'est. `SceneItem.prix_exact` porte la distinction ;
  `CatalogueItem.variant_count` remonte dans le catalogue. Nécessite un
  « Rafraîchir l'index 3D » pour que les prix par variante existent.
- **Fiche imprimable calquée sur le document `/print/offre/[slug]`** (pas la
  page web de l'offre) : Raleway, en-tête logo + « Plan 3D » + tableau méta
  (date, conseiller, terrasse, articles, n° de plan), nom du plan à droite,
  filet bleu, capture légendée, tableau « Description de l'article / Qté /
  Prix/pce / Total » avec « Réf. », cotes 3D et avertissements, totaux à
  droite (Sous-total → TVA 8.1 % incluse → TOTAL TTC entre filets bleus),
  remerciement, conditions, pied de page complet (adresse, TVA, site). Plus
  de marque en doublon (elle est dans le titre). Regroupement par fiche et
  variante. Impression déclenchée une fois police/logo/vignettes chargés,
  `print-color-adjust: exact`, bouton « Imprimer » à l'écran.

## 20.09.2026 — Partage client en lecture seule (branche `feature/planner-partage`)

Premier morceau du « lien 3D joint à l'offre » : un lien public que le client
ouvre sur son téléphone ou son PC pour tourner autour de son plan.

- SQL 022 : `planner_scenes.partage_token` (32 hex, unique, null = pas de
  partage) + `partage_cree_le`.
- `POST /api/planner/scenes/[id]/partage` (interne) crée ou renvoie le jeton
  → `{ token, url }` ; `DELETE` le révoque. L'URL utilise
  `NEXT_PUBLIC_BASE_URL` si défini, sinon l'origine de la requête.
- `GET /api/planner/partage/[token]` (PUBLIC, proxy.ts) renvoie la scène
  épurée : nom, terrasse, sol, mode, vue, items (titre, URL du modèle,
  position, rotation, image, SKU, prix + drapeau « dès »). Ni `cree_par`, ni
  id de scène, ni `variant_id`. `Cache-Control: no-store`.
- `/planner/partage/[token]` (PUBLIC) : même moteur `PlannerCanvas` avec
  `lectureSeule` (le clic sur un meuble ne sélectionne ni ne déplace, il
  passe aux OrbitControls) ; logo, nom du plan, Plan/3D, Recadrer,
  Couleurs/Maquette, liste des articles avec prix et avertissements, mention
  légale, adresse. Recadrage automatique au chargement. Page d'erreur propre
  si le jeton est révoqué (« Ce lien n'est plus valable »).
- Planner : bouton « 🔗 Partager » (scène enregistrée obligatoire) → bandeau
  vert avec l'URL, Copier, Ouvrir, Révoquer.
- proxy.ts : `/planner/partage/` et `GET /api/planner/partage/` ajoutés aux
  routes publiques. Les GLB sont sur le CDN Shopify, déjà publics.

À suivre sur cette base : QR AR, logo en marge, export PDF, puis lien offres.
- **Lien et QR du plan 3D client sur les exports** : la fiche imprimable
  reprend le bloc bleu de l'offre (« 🧊 Votre plan en 3D », bouton, URL, QR
  qrserver) juste avant le remerciement ; la capture PNG gagne un bandeau
  plus haut avec le QR en bas à droite (« Votre plan en 3D — Scannez pour
  tourner autour de votre projet »). `lienPartagePourExport()` enregistre le
  plan si besoin (confirm ; Annuler = export sans lien) puis crée / relit le
  jeton. `enregistrer()` renvoie désormais l'id. `GET /api/planner/qr`
  (interne) proxifie qrserver en same-origin pour pouvoir dessiner le QR dans
  le canvas sans le tainter. La fenêtre d'impression est ouverte dans le clic
  (popup blocker) puis remplie après le lien.
- **Versions figées** (SQL 023, `planner_scenes_versions`) : chaque Fiche /
  Capture fige la scène enregistrée en Vn avec son propre jeton
  (`POST /api/planner/scenes/[id]/versions {motif}`) ; le QR / lien imprimé
  pointe sur cet instantané, immuable. `GET /api/planner/partage/[token]`
  cherche d'abord une version puis le jeton vivant ; pour une version il
  renvoie `modifie_depuis` (scène mise à jour après, ou version plus
  récente) et `url_actuelle` (lien vivant s'il existe). La page client
  affiche un bandeau : « Version V2 du … telle qu'imprimée » (+ « le projet
  a été modifié depuis — voir la version actuelle » en ambre) ou, pour le
  lien vivant, « Plan mis à jour le … Ce lien montre toujours la dernière
  version du projet : elle peut différer d'un document imprimé ». La fiche
  mentionne V n dans l'en-tête et dans le bloc 3D ; la capture aussi.
- **Retours du 20.09 soir** : export = enregistrement automatique (plus de
  confirm — Chrome l'avalait quand la fenêtre d'impression avait le focus,
  d'où « pas de QR ») ; capture prise AVANT d'ouvrir la fenêtre (rAF ne tourne
  plus en arrière-plan → blocage sur « Préparation… ») ; halo de sélection
  retiré avant capture ; version réutilisée si plan inchangé ; espace après
  le tiret du nom.
- **Deux gabarits de fiche** : « 🖨 Fiche » (prix, TVA, total) et « 🖨 Sans
  prix » (articles, quantités, cotes — ni colonnes prix, ni récapitulatif, ni
  note « dès »). Plus d'impression automatique : la fiche s'affiche, bouton
  « Imprimer / PDF » en haut à droite (→ Enregistrer en PDF dans Chrome).
- **Logo sur la capture PNG** : bandeau blanc de 120 px avec logo à gauche
  (`GET /api/planner/logo`, same-origin pour le canvas), nom du plan, ligne
  terrasse / articles / date, mention légale + adresse, QR à droite.

**À préparer — export PDF** : reprendre le circuit des offres. (1) Déplacer
le HTML de la fiche dans une vraie route `app/print/planner/[token]/page.tsx`
(jeton de version → `GET /api/planner/partage/[token]` + `?prix=0|1`), ce qui
règle aussi le `about:blank` ; (2) route interne
`POST /api/planner/scenes/[id]/pdf` qui fige la version, appelle pdf.co sur
`/print/planner/<token>?jc_token=…` comme `fiche-travail-pdf/route.ts`, et
renvoie le PDF (ou l'enregistre dans Supabase Storage `planner-pdf/` avec
l'URL sur la version) ; (3) bouton « ⬇ PDF » dans le planner ; (4) plus tard,
joindre ce PDF à l'offre (étape 3). Proxy : `/print/planner/` accepte le
`jc_token` comme les autres prints (déjà couvert par `pathname.startsWith("/print/")`).

## 20.09.2026 — Fiche en vraie page print + PDF pdf.co (branche `feature/planner-pdf`)

- SQL 024 : `planner_scenes_versions.capture_url`, `pdf_url`,
  `pdf_sans_prix_url` ; les cotes 3D mesurées sont figées dans `items[].dims`.
- `lib/planner-versions.ts` : `figerVersion(sceneId, motif, {capture, dims})`
  — logique partagée (réutilisation si scène inchangée, dépôt de la capture
  PNG dans le bucket public `pdfs` sous `planner/<token>.png`).
- `app/print/planner/[token]/page.tsx` : **composant serveur**, même gabarit
  que `/print/offre`, lit la version dans Supabase, affiche la capture
  stockée (pas de WebGL) ; `?prix=0` = sans prix. Un humain l'ouvre avec son
  cookie, pdf.co avec `jc_token` (déjà couvert par proxy.ts pour `/print/`).
  Les boutons « Fiche » / « Sans prix » du planner figent la version (avec
  capture + cotes) puis ouvrent cette page → plus de `about:blank`, plus de
  HTML généré côté client.
- `POST /api/planner/scenes/[id]/pdf {prix, capture, dims}` : fige / réutilise
  la version, pdf.co `convert/from/url` sur la page print (A4, marges 10 mm,
  `printBackground`), PDF stocké `planner/<token>-avec-prix.pdf` |
  `-sans-prix.pdf`, URL sur la version ; renvoyé tel quel s'il existe déjà.
  Boutons « ⬇ PDF » et « ⬇ PDF sans prix » (violet) dans le planner ; ouvre le
  PDF dans un onglet. `maxDuration = 60`.
- Variables : `PDFCO_API_KEY`, `DASHBOARD_SESSION_SECRET`, `NEXT_PUBLIC_APP_URL`
  (déjà en place pour les offres) ; `NEXT_PUBLIC_BASE_URL` optionnel pour les
  liens de partage.
- ⚠️ pdf.co doit atteindre la page print : en **preview Vercel** la
  protection de déploiement peut le bloquer → tester le PDF en prod, ou
  désactiver la protection sur le preview le temps du test.

## 21.09.2026 — Étape 3 : lien avec les offres (branche `feature/planner-offres`)

Léger et en lecture seule, comme convenu : aucune modification du modèle de
données ni de la sauvegarde des offres / brouillons.

- SQL 025 : `modeles_3d.variant_ids text[]` (gid de toutes les variantes de
  la fiche) + index GIN sur `variant_ids` et `skus`. Le sync les remplit.
  → « Rafraîchir l'index 3D » après le SQL.
- `lib/modeles-3d-lookup.ts` : `resoudreLignes3d(lignes)` — retrouve le
  modèle d'une ligne par **gid de variante** (`shopifyVariantId`, clé fiable),
  repli par SKU (si unique, ou une seule fiche avec 3D). Cascade variante →
  fiche ; renvoie url, source, prix (exact si variante connue), avertissements
  taille / couleur, marque, image.
- `GET /api/planner/faisabilite?type=offre|brouillon&slug=` : relit
  `offres.data.lines` / `drafts.data.lines` (lignes `product`), synthèse
  `avec_3d / total` + détail par ligne. Recalculé à chaque appel → suit V1,
  V2, V3.
- `components/Faisabilite3DCard.tsx` : card « 🧊 Faisabilité 3D » — « 5/8
  articles de cette commande sont disponibles pour un plan-rendu en 3D »,
  bouton « Ouvrir le planner avec ces articles », détail par ligne (3D / — ,
  taille ?, couleur ?), marques manquantes, plans déjà liés (scènes avec
  `offre_slug`). Posée sur `app/dashboard/[slug]` (offres et commandes) et
  `app/dashboard/draft/[slug]`. Se cache si erreur ou aucune ligne produit.
- Planner : `?depuis=offre:<slug>` | `brouillon:<slug>` → nouvelle scène
  (non enregistrée) avec les lignes 3D × quantité posées dans la bande de
  dépôt, `offre_slug` renseigné, nom « date conseiller — N° client ».
  `GET /api/planner/scenes?offre_slug=` liste les scènes liées.
- Badge « 3D » dans le picker du formulaire de brouillon :
  `/api/shopify-search` renvoie `has3d` (lookup par gid, jamais bloquant),
  `DraftFormulaire` affiche un petit badge vert à côté du SKU.

Pas encore : PDF / lien 3D joints automatiquement à l'offre (annexe), badge
sur les lignes déjà posées dans le formulaire.
- Retours étape 3 : garde « modifications non enregistrées » sur le lien
  Dashboard du planner (navigation client Next, `beforeunload` ne joue pas) ;
  la card ouvre le planner dans un nouvel onglet ; **aperçu léger** des plans
  liés = capture PNG de la dernière version (`GET /api/planner/scenes?offre_slug=`
  joint `derniere_version` : numero, token, capture_url, pdf_url), avec
  boutons Planner / 3D client / PDF / **Copier le lien** (version figée) à
  coller dans un mail au client.
- **Plan lié à une offre / commande → pas de prix webshop côté client** :
  la page `/planner/partage/[token]` masque prix et total (API publique :
  `sans_prix` = `offre_slug` non nul, pour les versions comme pour le lien
  vivant) et affiche « Les prix figurent sur votre offre ou votre commande » ;
  dans le planner, « Fiche » et « ⬇ PDF » (avec prix) passent en gris ambre
  et, au clic, proposent d'ouvrir la version sans prix (OK) ou d'annuler.
