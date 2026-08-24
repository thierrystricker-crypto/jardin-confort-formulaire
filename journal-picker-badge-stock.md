# Journal — Chantier « Badge de stock du picker »

> Branche `fix/picker-badge-stock-continue` · 24.08.2026 · session unique
> Ferme **P1-47**. Demande de départ : dans le panneau « Ajouter des articles »,
> le badge de stock disait « Rupture » aussi bien sur un article réassortable à 0
> (`CONTINUE`, le cas courant chez Jardin-Confort) que sur une pièce définitivement
> perdue (`DENY`) — alors que la ligne du tableau, elle, distingue déjà les deux.
> Le correctif est un **alignement du picker sur le vocabulaire de la ligne**.

---

## 1. Le constat de départ

Mesuré avant la session, non re-diagnostiqué : sur 50 variantes à stock ≤ 0,
**48 étaient `CONTINUE`**. Le mot réservé au cas critique s'appliquait donc au cas
courant, et à l'instant précis de la décision commerciale.

Le badge du picker était purement quantitatif — `inventoryPolicy` n'était jamais
consulté — alors que la donnée était déjà présente dans la réponse de
`/api/shopify-search` (l. 340) et portée par le type de l'item (l. 27).
Une condition à écrire, aucune requête à ajouter.

**Découverte en lisant le code : il y a DEUX pickers, pas un.**

| | Fichier | Défaut constaté |
|---|---|---|
| Picker **liste** (`wideMode`, défaut à `true` l. 314) | l. ~2924 | « Rupture » sur tout stock ≤ 0 |
| Picker **tuiles** (bouton « ◧ Mode normal ») | l. ~2235 | **défaut symétrique** : « Sur commande » sur tout stock < 1, **DENY compris** |

Le second annonçait donc commandable une pièce non réassortable — **et lui affichait
en plus un délai**. Corriger le seul picker du cadrage aurait fait se contredire les
deux écrans. Les deux ont été alignés, en deux commits séparés pour rester
révocables indépendamment.

## 2. La décision (Thierry)

« Sur commande » en **orange #E67E22** — l'orange déjà employé par le picker pour
`⚠ N`. Le rouge reste réservé au seul cas où la marchandise ne peut plus être
obtenue. *Si les deux cas sont rouges, seul le mot les sépare et la confusion
n'est réglée qu'à moitié.*

## 3. Les modifications

### 3.1 Commit `1490316` — picker liste

- **Helper `badgeStockPicker(stock, policy)`**, placé juste après le type
  `ShopifyItem`. Sort la logique du JSX pour que le second picker l'appelle plutôt
  que d'en recopier une variante (doc `04` : une duplication diverge en silence).
- Le badge devient :

| Cas | Avant | Après |
|---|---|---|
| stock > 2 | `✓ N` vert | inchangé |
| 0 < stock ≤ 2 | `⚠ N` orange | inchangé |
| stock ≤ 0 · `CONTINUE` | 🔴 « Rupture » | **« Sur commande »** orange |
| stock ≤ 0 · `DENY` | 🔴 « Rupture » | inchangé — **seul cas rouge** |
| stock `null` **ou** policy `null` | « N/A » gris | « Stock à vérifier » gris |

`policy === null` signifie que l'API Admin n'a pas répondu : on ne sait pas.
**Une inconnue ne se peint jamais en rouge.**

### 3.2 Commit 2 — picker tuiles

- Le test `stock === null` devient `stock === null || inventoryPolicy === null`
  (→ lien « Vérifier ↗ »).
- À 0, le cas se dédouble : `CONTINUE` → « Sur commande » (`.jc-stock-cmd`),
  `DENY` → « Rupture » (`.jc-stock-zero`, classe **déjà déclarée l. 3865 et
  utilisée nulle part** — vestige d'avant le passage à « Sur commande » ; aucune
  règle CSS ajoutée, donc pas de risque de doublon).
- **Le délai ne s'affiche plus que si `CONTINUE`** : c'est exactement la règle de
  la page produit du thème (doc `03` §4 ter — délai affiché seulement en rupture
  *vendable*). Promettre un délai sur une pièce non réassortable était une
  promesse fabriquée.

⚠️ **Réserve cosmétique** : « Rupture » vaut `var(--danger)` (#f87171) dans les
tuiles et `#dc2626` en dur dans la liste. Deux rouges légèrement différents ;
uniformiser demanderait de toucher au style du picker liste, non fait ici.

## 4. Ce qui n'a PAS été touché

- Le rendu de la **ligne** (l. ~2569-2589) : il était correct.
- Le filtre **« En stock uniquement »** : il masque bien tout stock ≤ 0, et c'est
  juste — « en stock » n'est pas « commandable ».
- Les **accents doublement encodés** (P3-40) : laissés tels quels, fichier
  ré-écrit en UTF-8 sans BOM et 100 % CRLF, comme avant.
- Aucun **fichier sanctuarisé** ouvert.
- Aucun mouvement de stock, aucune écriture en base.

**Garde-fou vérifié après patch** : `if (revisionMode) return;` toujours présent,
1 seule occurrence. 📌 **Il est à la ligne 1329, pas 1291** — les docs `04` §5 et
P3-2 donnent un repère périmé.

## 5. Recette

**Typecheck avant push** — le dépôt n'étant pas lançable ici, un projet miroir
minimal (Next 16.2.3 / React 19.2.4, même `tsconfig.json`, imports locaux stubbés)
a servi de banc : `tsc --noEmit` rend **exactement les deux mêmes erreurs qu'avant
patch** (deux artefacts du miroir), zéro erreur nouvelle. Parse TSX confirmé par
esbuild sur les deux versions.

**Cobayes vérifiés dans Shopify AVANT le test** — un test qui ne peut pas échouer
ne valide rien :

| SKU | Stock | Policy | Tag | Métachamp |
|---|---|---|---|---|
| `023965` Bistro 97×57 Vert tilleul | 0 | **CONTINUE** | `6weeks` | **2-3** |
| `360220` Balad Ocre rouge | 0 | **DENY** | `6weeks` | 2-3 |
| `360282` Balad Cactus | 0 | **DENY** | `6weeks` | — |
| `3602A5` Balad Gris argile | 2 | DENY | `6weeks` | — |
| `360247` / `360214` / `360221` / `3602B9` / `360273` | 3 à 5 | DENY | `6weeks` | — |

`023965` et `360220` sont tous deux à 0 et ne diffèrent **que** par la politique :
le contraste peut échouer.

**Résultats en preview** (`hw7djho33`) :

- Picker liste — `023965` → « Sur commande » orange ✅ · `360220` et `360282` →
  « Rupture » rouge ✅ · `3602A5` → `⚠ 2` ✅ · les cinq autres → `✓ N` vert ✅.
  **Une seule recherche `3602` exerce trois branches sur quatre, aucune n'a bougé.**
- Picker tuiles — `023965` → « Sur commande » + bandeau de délai ✅ ·
  `360220` → « Rupture », **bandeau de délai disparu** ✅.
- Ligne du tableau, inchangée — `360220` : « Sur commande » + `🔴 Rupture (0/1)` +
  case « J'ai vérifié la dispo fournisseur » ; `023965` : « Sur commande » seul,
  sans badge ni case.

📌 **Aucun numéro DRA consommé** : le numéro n'est attribué qu'au clic sur
« Créer le brouillon ». Ajouter des lignes à un brouillon non créé suffit à valider
le rendu de la ligne, et n'écrit rien. À réutiliser — le cadrage prévoyait un
déchet de test qui n'a pas eu lieu.

## 6. Découvertes hors périmètre (pour le bilan — rien n'a été modifié)

### 6.1 🔴 Le barème des délais existe en QUATRE exemplaires

P1-44 en recense deux. En voici quatre, dont **un non recensé** :

| Porteur | Table/formule | Multi-tags | `8weeks` | Qui le voit |
|---|---|---|---|---|
| Thème `product-inventory.js` | référence | le + **court** | 8-10 | le client, sur la boutique |
| `lib/shopify-refresh-stock.ts` l. 84 | table ✅ | le + **court** ✅ | ✅ | **le client, sur la page d'offre** |
| `app/api/shopify-search/route.ts` l. 256 | table, libellés ✅ | le + **long** ❌ | **absent** ❌ | le vendeur, picker tuiles |
| `lib/promesse-shopify.ts` l. 50 | formule ❌ | le + **long** ❌ | 9 ❌ | le suivi des délais |

**Le seul porteur juste est celui qui parle au client.** P1-44 est donc un bug de
**mesure** (le suivi s'invente des dépassements), pas de **promesse** — l'inverse
de ce que le backlog laisse craindre. Même motif que P1-36 : *le bug avait trois
sites, pas deux.*

### 6.2 🔴 Aucun affichage ne lit le métachamp — écart mesuré sur le SKU du test

Depuis le 23.08 le thème lit `fournisseur.delai_semaines` **en priorité**.
`023965` porte le métachamp **`2-3`** et le tag **`6weeks`** : la boutique annonce
**2-3 semaines**, l'application (page d'offre client comme picker tuiles) annonce
**6-8**. Sur cet article, **l'offre paraît trois fois plus lointaine que la page
que le client vient de quitter.** L'app est plus pessimiste que le site — rien ne
se casse chez le client — mais les trois sources disent trois choses.
→ Le vrai travail de **P2-35** n'est pas d'afficher le délai dans le picker
(il y est déjà), c'est de **brancher les affichages sur le métachamp**.

### 6.3 🔴 Un `DENY` à 0 promet un délai au CLIENT

`app/offre/[slug]/page.tsx` l. 977 : `isSC = stock === "sur_commande" || sn < 1`,
**sans `inventoryPolicy`**. Un `DENY` à 0 affiche donc `📦 6–8 semaines` sur la
page d'offre. Ce n'est pas théorique : le garde-fou avertit sans bloquer, donc un
vendeur qui coche « J'ai vérifié la dispo fournisseur » envoie l'offre — et le
client reçoit la promesse. **C'est le même défaut que les deux pickers, au seul
endroit où il engage.** Non corrigé ici : une page client ne se modifie pas en
passant.

### 6.4 Ce qui est déjà bon et ne doit pas être « corrigé »

- Le **figeage** : `/api/offres/[slug]` refresh en live tant que l'offre est en
  cours, sert les lignes de la commande liée dès signature ; `valider/route.ts`
  l. 175 fige `frozenLines`, **qui portent déjà `delaiLivraison`**. Le délai est
  donc photographié J0 avec le stock, comme une promesse doit l'être.
- La page de **confirmation** n'affiche ni stock ni délai — zéro occurrence.

### 6.5 Ménage

- **P3-14 sous-estime : il y a trois fichiers parasites trackés**, pas un —
  `ezefijardin-confort-formulaire` (557 o), `h` et
  `ombre cohérent sur la page admin brand-logos` (**16 653 o chacun**, donc très
  probablement le même contenu dupliqué par deux redirections PowerShell ratées).
- `.gitignore` complété (commit `9befa04`) : `rattrapage-log.json` (avant même
  qu'il existe) et `_base_*.tsx`.

## 7. Reste à faire

- [ ] **P1-46 n'a pas bougé** : `scripts/rattrapage-documents.mjs` est écrit et
      committé mais **n'a jamais tourné** (aucun `rattrapage-log.json`).
      149 régénérations en attente.
- [ ] **P2-35** — brancher les affichages sur le métachamp (voir §6.2), et unifier
      les quatre barèmes sur une seule source.
- [ ] **§6.3** — le `DENY` à 0 qui promet un délai au client : chantier à part,
      page client.
- [ ] **P1-44** — à requalifier : bug de mesure, pas de promesse (voir §6.1).
