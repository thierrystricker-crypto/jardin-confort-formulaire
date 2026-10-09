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

## 09.10.2026 — Phase 2 (fiche) : les boutons du haut rangés en menus

Les 4 groupes du haut de la fiche v1 (Documents PDF, Pages web, Navigation &
contact, Outils internes — ~15 boutons) deviennent 4 menus déroulants.
**Aucun bouton n'est recopié** : `_components/MenusFiche.tsx` repère les vrais
groupes de la fiche v1 (par leur intitulé), les marque (`v2-top`, `v2-groupe`,
`v2-dossier`) et ouvre / ferme le panneau au clic ; v2.css §7 fait la mise en
forme. Les boutons gardent donc leur logique, leurs états (« Génération… »,
« ✓ Lien copié »), le composant Wallee, le bandeau de rappel PDF. Un clic dans
un panneau le laisse ouvert (on voit le retour) ; clic dehors ou Échap ferme.
Un bouton ajouté plus tard dans un de ces groupes v1 apparaît tout seul dans le
bon menu. Groupe vide (ex. pas d'e-mail client → pas d'« Email relance ») =
menu masqué. Le bloc dossier v1 perd logo, n° et montant (déjà dans l'en-tête v2)
et garde ses badges et « Marquer livrée ».
⚠️ Dépend des intitulés v1 (« Documents PDF », « Pages web », « Navigation »,
« Outils internes ») : les renommer en v1 = le menu correspondant redevient un
groupe de boutons ordinaire (rien ne casse, rien ne disparaît).

## 09.10.2026 — Retours sur la fiche et la liste

- En-tête de fiche : **Société, puis Nom, puis Prénom** (société un ton plus
  discret). Bandeau compact idem.
- Liste, brouillons, Ctrl+K : **Nom puis Prénom** (affichage, tri par client et
  pertinence de recherche). Sans nom, la société prend la place du nom.
- Raccourci direct **« Page commande client » / « Page de l'offre »** à gauche des
  menus : copie du lien v1 du menu Pages web (même adresse, même libellé),
  recréée par MenusFiche si la v1 le change.
- Menu Pages web : « 🔗 Copier le lien client » (offres) reste en tête, puis la
  page commande / la page de l'offre, puis le reste (CSS `order`, v1 intacte).
- Bouton « 👁 Aperçu » de l'en-tête (et du bandeau) : ouvre `/print/offre/[slug]`
  dans un nouvel onglet au lieu de descendre sur la carte d'aperçu.

## 10.10.2026 — Jardi dans la v2 : design pro + tri et filtres de l'historique

Nouvelle page **`/v2/jardi`** (la v1 `/dashboard/jardi` n'est PAS touchée : même
API `/api/claude/*`, même base, les deux pages voient les mêmes conversations).
Fichiers : `app/v2/jardi/page.tsx` (copie restylée de la v1, logique reprise telle
quelle : streaming, pièces jointes + TTL 24 h, dictée, sauvegarde auto, `?c=`
`?s=` `?q=` `?source=`, ThunderAI en lecture, identité par appareil, panneau
d'utilisation), `historique-v2.tsx`, `outils.ts`, `jardi.css`.

- **Design** : jetons v2 (clair ET sombre) ; en-tête de conversation (titre,
  auteur, date, nb d'échanges) ; réponses sans bulle avec avatar Jardi et puces
  d'outils lisibles (icône + nom) ; tableaux encadrés, rayés, avec « Copier le
  tableau » (collage Excel) ; zone de saisie en carte (Joindre, Dicter, envoi) ;
  accueil « Bonjour Prénom » + Reprendre + modèles en cartes.
- **Actions en plus** : 🔗 copier le lien de la conversation, ⬇ exporter en
  `.md`, ✎ reprendre / reformuler une question.
- **Historique** : tri (activité récente, plus anciennes, date de création, plus
  d'échanges, titre A→Z) ; filtres période (aujourd'hui / 7 j / 30 j / 3 mois),
  personne, thème (ce que Jardi a consulté : clients, mails & PJ, brouillons
  d'offre, commandes, stock, délais, stats, listes d'achat — avec compteurs) ;
  📌 épingles en haut ; puces des filtres actifs + compteur ; groupes par mois
  au-delà du mois courant. Liste chargée jusqu'à 500 (plafond serveur), tri et
  filtres côté navigateur. Réglages et épingles mémorisés **par appareil**
  (`jardi-v2-historique`, `jardi-v2-epingles`) — aucune écriture en base.
- Touche **`/`** = recherche de l'historique (Ctrl+K reste la recherche globale).
- Coquille : Jardi devient une page interne du menu (plus de nouvel onglet), le
  menu latéral se **replie tout seul** sur cette page (bouton ⇥ pour le rouvrir,
  réglage mémorisé inchangé). Liens v1 vers `/dashboard/jardi` (to-do « Préparer
  une réponse »…) → `/v2/jardi` ; `/dashboard/thunderai` → `/v2/jardi?source=thunderai`.
- ⚠️ Les modales v1 réutilisées (choix de l'utilisateur au 1er passage, panneau
  d'utilisation) restent en thème sombre.
- Vérifié : `next build` + captures clair / sombre / filtres / accueil / mobile
  sur API simulée ; envoi → streaming → sauvegarde (POST) → `?c=` dans l'adresse.

### Phase 2 (à faire)

1. Fiche : ~~menus~~ ✅ fait ; reste éventuellement les onglets (Résumé / Suivi
   commercial / Historique / Annexes), l'aperçu restant à droite.
2. Clients et fiche client en natif v2.
3. Si adopté : redirection `/dashboard` → `/v2` (dont `/dashboard/jardi` →
   `/v2/jardi`), puis nettoyage.
