# Journal — « Stock list » (recherche délais catalogue)

## 11.09.2026 — création (branche `feature/stock-list`)

**Besoin** : l'équipe de vente veut le délai de livraison d'un article au catalogue,
y compris les fiches DRAFT et les SKU des relevés fournisseurs pas encore créés
dans Shopify (les métachamps Shopify ne couvrent que les variantes existantes).

**Source** : vue `v_recherche_delai` du Supabase WEBSHOP (`eyhoeujnoclzntdxmtby`,
≠ Supabase de l'app). Full outer join `feed` × `shopify_variante`, délai client
déjà calculé (delai_config → date dispo + transport → transport seul → vide).

**Fichiers**
- `lib/supabase-webshop.ts` — client dédié, serveur, lecture seule. Env
  `WEBSHOP_SUPABASE_URL` + `WEBSHOP_SUPABASE_SERVICE_KEY` (Vercel + .env.local).
- `app/api/stock-list/route.ts` — GET `?q=` → `.or(sku.ilike, titre.ilike)`,
  50 lignes max, tri fournisseur puis sku. `/api/delais` était déjà pris
  (suivi des délais des commandes en cours).
- `app/api/stock-list/shopify/route.ts` — POST `{ variantIds }` → un seul
  `nodes(ids)` Admin GraphQL via `shopifyAdminGraphQL` : image variante (repli
  `featuredMedia` produit), `onlineStoreUrl`, lien admin.
- `app/dashboard/stock-list/page.tsx` — recherche debounce 300 ms, tableau,
  **délai client en dernière colonne** mise en évidence, vignettes, ligne
  cliquable (boutique ; admin Shopify si DRAFT ; rien si hors Shopify).
- `app/dashboard/page.tsx` — bouton « 🔎 Stock list » à côté de « ⏱ Délais fournisseurs ».

**Garde-fous** : page 100 % lecture seule ; aucune écriture Shopify ni Supabase ;
la vue est la seule chose lue dans le Supabase webshop.

**Vues ajoutées côté webshop** : `v_fournisseur_sync` (fournisseur, actif,
dernier relevé, nb SKU, dernier verdict + motif du journal) pour le bandeau.

**Reporté** : `date_source` par moteur `flux_*` (vraie date de la stock list
fournisseur, ex. Manutti 21.08 alors que le passage Make est du 11.09) ; `feed.libelle` (titre fabricant pour les 7 366 SKU hors Shopify,
aujourd'hui cherchables par SKU seulement) — à faire moteur `flux_*` par moteur
après la mise en prod.

## 12.09.2026 — mise en prod (PR feature/stock-list → main)

**Ajouté pendant la validation sur preview**
- Vue `v_recherche_delai` : colonne `dispo_fournisseur` uniformisée
  (EN_STOCK · REASSORT · SUR_COMMANDE · NON_LIVRABLE · INCONNU) calculée depuis le
  statut brut ET la quantité — la quantité > 0 prime (Les Jardins NON_COMMANDABLE
  avec stock = livrable jusqu'à épuisement). Délai client aussi sur statut « en
  stock » sans quantité (Barebones, Fatboy) → transport seul.
- Vue `v_fournisseur_sync` : bandeau des marques (logo `brand_logos` de l'app,
  date du dernier relevé, verdict + motif du journal, étiquette observation).
- Page : cartes marques = filtre ; filtres rapides côté API (stock JC, stock
  fournisseur, non livrables, fiches actives, hors Shopify) + délai ≤ 4 sem.
  côté client ; tri par colonne ; boutons copier SKU / copier titre / ouvrir la
  variante (`?variant=`) en nouvel onglet ; colonnes à largeur fixe.
- Route Shopify : titre de variante, image (repli média produit), liens vers LA
  variante (boutique, ou admin si non publiée), lots de 250.

**Reporté (après prod)**
- Recherche par nom de variante (« sunwing 461 ») : colonne `variante_titre` sur
  `shopify_variante` + `v->>'title'` dans `rafraichir_miroir` + le mot `title`
  dans la requête GraphQL des 12 scénarios Make + `.or()` de la route.
- `date_source` par moteur `flux_*` (vraie date de la stock list fournisseur).
- `feed.libelle` (titre fabricant pour les SKU hors Shopify).
- Logo Lafuma absent de `brand_logos` (affiché en texte).

**Piège de session** : les copies vers le PC via Claude ont plusieurs fois
envoyé une version en retard du fichier (page.tsx, route.ts, supabase-webshop.ts).
Toujours vérifier la taille du fichier sur disque après écriture, et que
`git diff --stat` liste bien chaque fichier attendu avant de pousser.

## 12.09.2026 (soir) — Listes d'achat (branche `feature/listes-achat`)

**Pourquoi** : après un jour d'usage, la Stock list devient le point de départ
des offres. Les vendeurs veulent choisir plusieurs articles, garder le panier,
et surtout ré-utiliser les combos qu'on revend sans arrêt (socle + poids +
tube + parasol).

**Base** : table `listes_achat` (Supabase de l'app `llkyzspixrbtoprtmvoh`,
`docs/sql/017-listes-achat.sql`, RLS sans policy) — nom, cree_par, statut
(ouverte / transformee / archivee), lignes jsonb, est_modele, draft_slug.
Aucun prix stocké : relus chez Shopify (Admin `nodes`, price + compareAtPrice)
au moment de créer ou compléter un brouillon.

**Fichiers**
- `lib/listes-achat.ts` (types, panier local, article à la volée « Libre »)
- `lib/listes-achat-lignes.ts` (serveur : lignes de liste → QuoteLine, promo en
  lineDiscount comme le picker)
- `app/api/listes-achat/route.ts` (GET/POST), `[id]/route.ts` (GET/PATCH/DELETE
  = archive), `[id]/brouillon/route.ts` (POST → DRA via le handler /api/drafts
  importé), `[id]/lignes/route.ts` (GET → lignes pour ajout à une offre)
- `components/ListeAchatPanneau.tsx` (barre 🛒 de la Stock list),
  `ListeAchatLignes.tsx` (tableau éditable partagé : ± qty, ▲▼ et
  glisser-déposer, article à la volée), `ListeAchatImport.tsx` (onglet
  « 🛒 Liste d'achat » du formulaire : cartes + aperçu en fenêtre avec cases et
  quantités, ajout À LA SUITE sans toucher au client)
- `app/dashboard/listes-achat/page.tsx` (onglets Ouvertes / ⭐ Modèles /
  Transformées / Archivées, détail éditable + Enregistrer)
- `DraftFormulaire.tsx` : 3ᵉ onglet dans « Ajouter des articles » (mode normal
  et mode large)
- Stock list : colonne Prix TTC, bouton + (36 px, toujours visible), recherche
  hybride (vue + `productVariants(query)` Admin → « sfera 527 » trouve la
  variante), pleine largeur 1 900 px, SKU en police normale, titre puis une
  option de variante par ligne (`selectedOptions`).

**Règles**
- Un modèle n'est jamais transformé : on charge une copie ; la liste
  « ouverte » de l'API inclut tous les modèles non archivés ; cocher Modèle
  rouvre une liste transformée.
- Le panier non enregistré vit dans le navigateur du poste ; tout le reste est
  partagé entre vendeurs.
- « Qui es-tu ? » = `jardi-utilisateur` (même clé que Jardi) → cree_par et
  commercial du brouillon.

**Reporté** : logo Diphano et Lafuma dans brand_logos ; `date_source` par
moteur ; `feed.libelle`. Le nom de variante cherchable est RÉGLÉ par la
recherche Admin, plus besoin de toucher aux scénarios Make pour ça.
