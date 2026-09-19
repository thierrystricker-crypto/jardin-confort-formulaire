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
