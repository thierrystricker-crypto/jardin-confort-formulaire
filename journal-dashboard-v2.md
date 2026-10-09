# Journal — Dashboard 2.0 (refonte de l'interface, « plan B »)

## 09.10.2026 — Phase 1 : coquille + accueil + en-tête de fiche

**Principe.** La v2 est construite À CÔTÉ de la v1, sous `/v2`. Aucun fichier de
`app/dashboard`, `components`, `lib` ou `proxy.ts` n'est modifié.
**Abandonner = supprimer `app/v2` et `app/api/v2`.** Rien d'autre à défaire.

### Ce qui existe

| Fichier | Rôle |
|---|---|
| `app/v2/layout.tsx` + `_components/V2Shell.tsx` | Menu latéral par métier (Vente / Stock & fournisseurs / Outils / Gestion), barre du haut (recherche Ctrl+K, cloche, + Nouvelle offre), bascule clair/sombre mémorisée par poste (`jc-v2-theme`), menu réductible (`jc-v2-menu-reduit`), lien « Version actuelle » |
| `app/v2/v2.css` | Jetons de thème, styles v2, et le **pont mode clair** (section 4) qui convertit la palette sombre codée en dur des pages v1 — généré, 198 règles, tout préfixé `.v2-root` |
| `app/v2/page.tsx` | Nouvel accueil. **Logique copiée de `app/dashboard/page.tsx`** (recherche, articles, filtres, tri, préférences localStorage partagées). Présentation : onglets catégories + bouton Filtres + étiquettes de filtres actifs, ligne cliquable + menu ⋯, Brouillons en onglet, KPI « À livrer » ajouté |
| `app/v2/[slug]/page.tsx` + `_components/EnteteDocument.tsx` | Fiche : **nom + prénom du client et n° du document en grand** en tête, bandeau compact au défilement, bouton « 👁 Aperçu » qui descend sur la carte d'aperçu ; dessous, la fiche v1 complète et inchangée |
| `app/api/v2/entete/[slug]/route.ts` | Lecture seule d'UNE ligne de `offres_dashboard` pour l'en-tête. Pas de Shopify, pas d'écriture |
| 18 autres `app/v2/**/page.tsx` | Pages v1 montées telles quelles via `_components/Legacy.tsx` (mode clair par le pont) |
| `app/v2/_lib/routes.ts` | `versV2()` / `versV1()` : correspondance des URLs |

### Pièges et décisions

- **Les liens `/dashboard/…` des pages v1** sont réécrits vers `/v2/…` par la coquille
  (survol + clic intercepté avant le `<Link>` Next). Les navigations
  `window.location.href = …` (lignes cliquables des listes v1) passent par la
  Navigation API (Chrome/Edge) ; ailleurs elles ouvrent la v1 — rien de cassé.
- **Restent en v1 volontairement** : Jardi (plein écran, onglet à part), ThunderAI
  (redirection), `/dashboard/[slug]/reviser` et `/drafts/*` (formulaires).
- **Le bouton « ← Dashboard »** des pages v1 est masqué en v2 (le menu le remplace).
- **Pont mode clair** : les accents Tailwind 200/300/400 (utilisés en texte sur fond
  sombre) sont redéfinis en 800/700/600 à l'intérieur de `.v2-legacy` ; les fonds
  zinc clairs (stock list) sont protégés. Les styles **inline** ne sont pas
  convertis (Jardi en a — raison de plus pour le garder en v1).
- Clé de mémorisation des filtres distincte (`v2:dashboard:filtres`) : v1 et v2
  ne se marchent pas dessus ; les préférences « masquer… » sont partagées.

### Vérifié

`next build` complet (types + validation des routes Next) ; captures clair /
sombre / mobile sur API simulées ; interception des liens testée (clic sur un
`<Link>` v1 et `window.location.href`).

## 09.10.2026 — Retours après premier essai

- Ctrl+K cherche aussi les **fiches clients** (`/api/clients?q=…&limit=6`, même
  recherche par pertinence que la page Clients), en plus des documents.
- Menu Vente : Offres & commandes, Clients, Listes d'achat, **To-do en dernier**.
- « Revue des e-mails » retirée du menu (page orpheline, aucun lien en v1) ;
  reste trouvable par Ctrl+K, comme le fichier clients WinBiz.
- Titres de catégories du menu plus contrastés (quasi blanc en sombre, quasi
  noir en clair).
- Accueil : ligne complète « Semaine NN » en grand + date + bouton 💬 Jardi.
  La semaine est calculée au montage (la page est pré-rendue au build).

## 09.10.2026 — Cartes trop serrées / textes qui débordent (pages v1 dans la v2)

**Cause :** les pages v1 choisissent leurs colonnes (`sm:/md:/lg:/xl:`) selon la
largeur de l'**écran**. Avec le menu latéral, la place réelle est ~250 px plus
étroite : à 1440 px, la fiche gardait ses 2 colonnes (aperçu à droite) et la
carte Montants ses 4 cases dans ~400 px → les montants sortaient des cases.

**Correction (v2.css §5, aucune page v1 touchée) :** `.v2-legacy` devient un
conteneur (`container-type: inline-size`) et les classes `grid-cols-*`,
`col-span-*`, `flex-row/col` des pages v1 sont rejouées en `@container` sur la
**largeur disponible**, avec les mêmes seuils que Tailwind. Une page v1 se met
donc en page exactement comme en v1 pour la même largeur utile. Filet : dans une
grille, un texte trop long passe à la ligne au lieu de déborder.
Conséquence visible : sur un écran de 1440 px, la fiche passe en une colonne
(aperçu dessous) ; menu réduit ou écran ≥ ~1550 px → aperçu à droite comme avant.
Les classes arbitraires (`xl:grid-cols-[minmax(0,1fr)_660px]`…) sont relevées
dans le code au moment de la génération : une NOUVELLE valeur arbitraire dans
une page v1 retombera sur le comportement écran tant que le CSS n'est pas regénéré.

## 09.10.2026 — L'aperçu de la commande était tombé en bas de page

Effet de bord de la correction précédente : à 1440 px avec le menu, la largeur
utile (~1190 px) n'atteignait plus le palier xl (1280) → fiche en une colonne,
aperçu sous toutes les cartes. **L'aperçu est la carte la plus précieuse.**
v2.css §6 : la grille principale de la fiche (`xl:grid-cols-[minmax(0,1fr)_660px]`,
fiche ET brouillon) passe en 2 colonnes dès ~990 px utiles, aperçu =
`clamp(480px, 50%, 660px)`. Chaque colonne devient un conteneur ; dans une
colonne, Montants passe en 2×2 dès 416 px ; Client et Offre restent l'un SOUS l'autre
dans la colonne de gauche (demande de Thierry), la droite étant réservée à l'aperçu.
Mesuré : aperçu à droite à 1280, 1440 et 1920 px, aucun débordement.

### Phase 2 (à faire)

1. Fiche : ranger les ~70 boutons en menus Documents ▾ / Paiement ▾ / ⋯ et en
   onglets (Résumé / Suivi commercial / Livraison & délais / Historique / Annexes),
   l'aperçu restant visible dans Résumé.
2. Clients et fiche client en natif v2.
3. Si adopté : redirection `/dashboard` → `/v2`, puis nettoyage.
