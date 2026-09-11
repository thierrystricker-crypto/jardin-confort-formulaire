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

**Reporté** : `feed.libelle` (titre fabricant pour les 7 366 SKU hors Shopify,
aujourd'hui cherchables par SKU seulement) — à faire moteur `flux_*` par moteur
après la mise en prod.
