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

### Phase 2 (à faire)

1. Fiche : ranger les ~70 boutons en menus Documents ▾ / Paiement ▾ / ⋯ et en
   onglets (Résumé / Suivi commercial / Livraison & délais / Historique / Annexes),
   l'aperçu restant visible dans Résumé.
2. Clients et fiche client en natif v2.
3. Si adopté : redirection `/dashboard` → `/v2`, puis nettoyage.
