# Journal — Améliorations formulaire et offres (07-08.10.2026)

> Session unique, conversation Cowork du 07.10.2026 au soir → 08.10.2026.
> Cinq demandes de Thierry, venues du terrain, traitées à la suite. **Aucune entrée
> de backlog existante ne les couvrait.** Tout est en production au 08.10.2026.
> Convention P0-19 respectée : documents cités par numéro, jamais par nom de client.

| Branche | Commits | En prod |
|---|---|---|
| `feat/picker-etendu` | `7c8a53e` (picker étendu), `448d96e` (qté ▲▼ + badge 3D), `f82f93a` (service perso), `3a7abd9` (Offert / Inclus) | merge sur `main`, déploiement prod `3a7abd9` |
| `feat/prolonger-offre` | `3cd3536` | fast-forward `3a7abd9..3cd3536`, déploiement prod `3cd3536` |

---

## 1. Vue étendue du picker Shopify (`7c8a53e`)

**Demande** : trop de défilement pour trouver la bonne variante ; une vue large, une
photo par carte, des infos lisibles, filtres et tri, un niveau produit maître → variantes,
le stock du produit = somme des variantes.

**Arbitrages de Thierry** : panneau plein écran ouvert par un bouton (pas un 3ᵉ mode
de mise en page) ; vue par **produit maître** par défaut.

**Livré**
- `components/ShopifyPickerEtendu.tsx` (nouveau) : panneau plein écran, ouvert par
  « Vue étendue (N) » dans les DEUX pickers (colonne Grand écran et tuiles Mode normal).
  Partage la recherche du formulaire (`search` / `shopifyItems`), n'interroge rien
  lui-même ; l'ajout passe par `addShopifyItem` — même chemin que les autres pickers.
- Vue Produits : une carte par produit, marque, nb de variantes, fourchette de prix,
  stock total + répartition (en stock / sur cde / rupture / à vérifier). Un seul
  produit dans les résultats → ouvert directement.
- Vue Variantes : une photo (celle de la variante), nom de variante en gros, SKU, prix,
  badge de stock plein, délai (CONTINUE ≤ 0 seulement), vente par N, badge 3D.
- Filtres : Tous / En stock / Sur commande / Rupture / En promo / marque. Tri :
  pertinence, stock ↑↓ (inconnus toujours en fin), nom, prix ↑↓.
- `lib/badge-stock-picker.ts` (nouveau) : la règle P1-47 sort de `DraftFormulaire`
  pour être partagée — une règle, pas deux copies.
- `api/shopify-search` : champs **additifs** `productHandle`, `productTitle`,
  `variantTitle`, `vendor`, `productImage` (+ `vendor` dans la requête Storefront).

**Règles posées**
- **Stock total = somme des quantités POSITIVES des variantes TROUVÉES.** Une variante
  CONTINUE à −3 ne retire rien aux autres. Les variantes non retenues par la recherche
  ne sont pas chargées, donc pas comptées (« luxembourg rouille » ≠ « 4101 »).
- Pas de `aria-modal="true"` sur le panneau : le style global de `DraftFormulaire`
  remet margin/padding à `revert-layer` sous `[role=dialog][aria-modal=true]`
  (correctif TransformerModal) et effacerait tous les espacements.

**Limite inchangée** : Storefront plafonne à 20 produits × 100 variantes par recherche.

## 2. Lignes d'offre : ▲▼ de quantité et badge 3D (`448d96e`)

- Boutons ▲▼ à droite du champ qté (style `jc-move-btn`, `screenOnly`). Mêmes règles
  que la saisie : pas de N (`orderUnit`), minimum 1 ou N, **en révision jamais
  au-dessus de la qté d'origine** (▲ grisé, infobulle « nouvelle ligne via le picker »).
- Badge « 3D » sous le SKU, écran seulement. Nouvelle route **lecture seule**
  `POST /api/modeles-3d/lignes` (200 lignes max, protégée par le proxy) qui réutilise
  `resoudreLignes3d` — même résolution que le planner (gid de variante, puis SKU).
  Cache par clé `gid|sku`, debounce 400 ms. **Jamais écrit dans le document** : la 3D
  peut arriver après l'offre.

## 3. Service personnalisé (`f82f93a`)

**Cause de l'« incliquable »** : la règle `.jc-check-label input { width:15px; height:15px }`
s'appliquait aussi au champ libellé (même conteneur que la case) → zone cliquable de
15 px de haut. Champ remplacé par un `textarea` hors de ce conteneur.

- Libellé : retour à la ligne visuel, extensible à la main ; **Entrée bloquée** (le
  libellé reste une seule ligne pour les documents et l'export WinBiz).
- Écrire un libellé coche le service (sinon le prix restait grisé — cause d'oubli).
- **Avertissement prix manquant** : service coché + libellé + champ prix VIDE.
  **0 est accepté** (offert). Contour rouge + message ; `window.confirm` au clic
  Enregistrer / Créer / Imprimer / Transformer (« Annuler » met le focus sur le prix).
  **Jamais en auto-save.**

## 4. Services « Offert » et « Inclus » (`3a7abd9`)

**Demande** : un service à 0 affiche « Offert » sans que le client voie la valeur du
geste ; et parfois le service est inclus dans un article.

**Modèle** (`lib/service-affichage.ts`) : le prix reste **"0"** dans
`servicePrices[code]` ; le mode et la valeur vivent à côté :
`servicePrices["<code>__mode"] = "offert"|"inclus"`, `servicePrices["<code>__valeur"]`.
**Conséquence voulue : aucun calcul de total n'est touché** — formulaire, documents,
export WinBiz, `computeTotals` recopié par le connecteur. Vérifié par la vraie
`computeTotals` : totaux strictement identiques avec et sans les clés de mode.

**Affichage** : prix > 0 → inchangé ; 0 + inclus → « Inclus » ; 0 + offert + valeur →
« (119.-) Offert » ; 0 sinon → « Offert » (historique). Le mode n'est lu que si le
prix vaut 0 (une donnée incohérente affiche le prix compté dans le total).

**Formulaire** : boutons Offert / Inclus avant le prix sur chaque service, perso
compris. Offert → le champ devient « valeur » (repris du prix saisi) ; Inclus → champ
grisé ; re-clic → retour au prix d'avant.

**Rendus touchés** : `/offre/[slug]`, `print/offre`, `print/draft`, `print/fiche-travail`,
`print/fiche-bleue`, `print/all` (3 endroits), `lib/winbiz-export.ts`
(« Service: Offert (valeur CHF 119.-) » / « Service: Inclus »).
**Non touché** : `print/offre/page.tsx` sans slug (hérité, plus utilisé).

**Bug corrigé au passage** : la page client `/offre/[slug]` affichait le service
personnalisé sous le libellé **« custom »** (`serviceLabels[code] || code`). Elle lit
désormais `servicePrices.custom_label`.

## 5. Prolonger une offre (`3cd3536`)

**Demande** : un client demande de prolonger une offre expirée ; c'était impossible.

**Arbitrage** : bouton « ⏳ Prolonger » à côté de « ✏️ Corriger » (option 3 des trois
proposées par Thierry).

**Modèle** (`lib/validite-offre.ts`) : **la date de l'offre ne change jamais** (preuve
de ce qui a été proposé et quand). La prolongation pose `data.validiteJusquau`
("YYYY-MM-DD") ; si présente, elle remplace `date_document + validiteDuree`.

**Traçabilité** : passe par `/api/corrections` — correction tracée (auteur, motif,
ancienne/nouvelle date), visible dans l'historique. Seul champ hors liste v1, accepté
**uniquement pour `entity_type = offre`** ; le serveur refuse une offre Convertie /
Acceptée / Abandonnée et une date passée ou mal formée.

**Modal** (`components/ProlongerOffreModal.tsx`) : +15/30/60/90 jours ou date libre ;
base = fin actuelle si encore valable, aujourd'hui si expirée ; nom repris de
`localStorage["corrections-author"]` ; motif prérempli.

**Rendus** : `/offre/[slug]` (bandeau et bouton de signature) ; `print/offre` et
`print/all` affichent « Validité de l'offre : jusqu'au 07.11.2026 » au lieu de
« 30 jours » quand l'offre est prolongée.

**Premier usage réel** : `DEV-2026-742` prolongée du 23.09.2026 au 07.11.2026 le 08.10
(correction tracée, vérifiée en base). Son PDF stocké date du 24.08 : à régénérer par
le bouton PDF.

---

## 6. Pièges rencontrés (deux fois dans la session)

**Les liens « Documents » du dashboard et le rendu pdf.co pointent la PROD depuis une
preview** (`NEXT_PUBLIC_APP_URL`). Deux fois de suite, Thierry a conclu « ça ne marche
pas en preview » — Offert puis Prolonger — alors que la base contenait les bonnes
données et la preview le bon code. **C'est P2-44 / P2-45, et le périmètre est plus
large que noté** : `api/offres/[slug]/pdf` construit aussi l'URL rendue par pdf.co sur
`NEXT_PUBLIC_APP_URL` (pas seulement `fiche-travail-pdf`), et `api/corrections`
régénère le PDF d'une commande via la même URL. Contournement utilisé : l'alias de
branche Vercel (`…-git-<hash>-…vercel.app/print/offre/<slug>`), qui suit le dernier
commit.

## 7. Contrôles

- Typecheck sur projet miroir Next 16.2.3 / React 19.2.4, même `tsconfig` : **aucune
  erreur nouvelle** sur les 5 livraisons (3 erreurs préexistantes, artefacts des stubs).
- Garde-fou `if (revisionMode) return;` : toujours 1 occurrence après chaque patch.
- Encodage UTF-8 sans BOM et fins de ligne d'origine conservés (CRLF ; `api/corrections`
  est en LF et l'est resté).
- Aucun fichier sanctuarisé ouvert. Aucune colonne, RPC ni migration. Aucune écriture
  de stock. Les 5 RPC du connecteur ne sont pas concernées (seules des clés JSON
  s'ajoutent à `data`).

## 8. Reste à faire

- [ ] Régénérer le PDF de `DEV-2026-742` (bouton PDF) avant envoi au client.
- [ ] Supprimer les branches `feat/picker-etendu` et `feat/prolonger-offre`.
- [ ] `DEV-2026-891` (créée le 07.10 pour tester « Offert ») : si c'est bien un test,
      à supprimer ou à garder comme témoin.
- [ ] Constat non traité : `api/offres/[slug]/valider` ne vérifie pas l'expiration
      côté serveur — seule la page masque le bouton. Une offre expirée reste signable
      par un appel direct. Hors périmètre (route publique critique, chantier 3).
