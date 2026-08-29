# Journal — Chantier « Délai fournisseur : juste, et visible »

> `fix/delai-metachamp-prioritaire` puis `fix/delai-visible-commercial` · 24.08.2026
> Une seule session, **trois branches successives**, parce que le chantier a été
> déclaré fini deux fois avant de l'être — voir §7.
> Ferme **P2-35**. Réduit **P1-44** à son seul porteur restant.
>
> Déclencheur : une offre client réelle, `DEV-2026-742`, annonçant **6–8 semaines**
> sur `024365` là où la boutique annonce **2-3 semaines** pour la même variante.

---

## 1. Le constat

`024365` (Fermob Bistro Table 77×57 / Vert tilleul 65) porte **à la fois** le
métachamp de variante `fournisseur.delai_semaines = "2-3"` **et** le tag produit
`6weeks`. Depuis la publication du thème le 23.08, la boutique lit le métachamp
en priorité et affiche « Sur commande ✓ Délai 2-3 semaines ».

L'application ne demandait **jamais** le métachamp : `refreshStock()` ne réclamait
que `product { tags }` dans ses deux requêtes GraphQL. D'où 6–8.

**Un client pouvait donc lire deux délais différents pour le même article** : 2-3
sur la fiche produit qu'il venait de quitter, 6–8 sur l'offre qu'on lui envoyait —
sur ~8 400 variantes Fermob métachampées. L'app étant plus *pessimiste* que la
boutique, rien d'intenable n'a été promis ; c'est la cohérence qui était en cause.

**Et le commercial, lui, ne voyait aucun délai** — ni dans le picker en mode grand
écran (le mode par défaut), ni sur la ligne une fois l'article posé dans l'offre.

### Les quatre porteurs du barème des tags

| Porteur | Barème | Multi-tags | `8weeks` | Métachamp | Qui le voit |
|---|---|---|---|---|---|
| Thème `product-inventory.js` (référence) | — | le + court | 8-10 | ✅ prioritaire | le client, boutique |
| `lib/shopify-refresh-stock.ts` | ✅ | le + court | ✅ | ❌ → **corrigé** | le client, page d'offre |
| `app/api/shopify-search/route.ts` | libellés ✅ | le + long ❌ | absent ❌ | ❌ → **corrigé** | le vendeur, picker |
| `lib/promesse-shopify.ts` | formule ❌ | le + long ❌ | 9 ❌ | ✅ déjà | le suivi des délais |

Le seul porteur juste était **celui qui parle au client**. P1-44 est donc un bug de
**mesure**, pas de **promesse** — l'inverse de ce que le backlog laissait craindre.

## 2. Volet 1 — la justesse (`1ea2269`, `9e3ad00`, merge `bc39ec3`)

### `lib/shopify-refresh-stock.ts` — la page client
- Les **deux** requêtes GraphQL (par ID de variante **et** fallback par SKU)
  demandent `metafield(namespace: "fournisseur", key: "delai_semaines")`.
- `getDelayFromMetafield()` parse `"2-3"`, `"10-12"`, `"12"` et compose
  `« 2–3 semaines »`. Rend `null` sur toute valeur qui ne parse pas → repli tags.
- `getDelay(metachamp, tags)` : la cascade du thème, métachamp d'abord.
- Le barème des tags de ce fichier **était déjà exact** — pas touché, il devient
  le repli qu'il est dans le thème.

### `app/api/shopify-search/route.ts` — le picker
- Même cascade (métachamp demandé à l'Admin, transporté dans la Map, prioritaire).
- **Deux écarts avec le thème corrigés** : `8weeks` était **absent** (aucun délai
  là où le site dit 8-10), et la chaîne était **descendante**, donc elle retenait
  le délai le plus **long** quand le thème retient le plus **court**.

## 3. Volet 2 — la visibilité (`fix/delai-visible-commercial`)

Le volet 1 a rendu le délai correct **là où personne ne le regardait**. Le picker
en tuiles l'affichait déjà avant ce chantier ; le picker grand écran et la ligne
de l'offre, jamais. Ce volet répare cela.

### Ce qui manquait, précisément
- 🔴 **`QuoteLine` n'avait pas de champ `delaiLivraison`.** Celui du fichier
  (l. 33) appartient à `ShopifyItem`. `addShopifyItem` ne le copiait donc pas :
  **le délai mourait au moment où l'article entrait dans l'offre.**
- La colonne Stock de la ligne n'affichait que « Sur commande ».
- Le picker liste (`wideMode`, **défaut à `true`**) affichait le badge sans délai.

### Le piège du format
Les deux sources n'écrivaient pas le même texte : `refreshStock` rendait
`« 2–3 semaines »`, l'API du picker `« Sur commande ✓ Délai 2-3 semaines »`.
Brancher l'affichage tel quel aurait donné **deux libellés pour une seule donnée** :
un à l'ajout, un autre après rechargement.

📌 **Règle retenue : une donnée, une écriture. Chaque affichage habille.**
`delaiLivraison` porte désormais la forme courte partout — c'est déjà celle stockée
en base et figée dans les commandes, donc **aucune migration** — et le picker en
tuiles recompose « Sur commande ✓ Délai … » au rendu.

### Les modifications
1. `QuoteLine` gagne `delaiLivraison?: string`, `addShopifyItem` le transporte.
2. Colonne Stock de la ligne : le délai sur une 2ᵉ ligne, sous « Sur commande ».
3. Picker liste : le délai sous le badge.
4. API picker : forme courte, chaîne vide si aucun délai.
5. Garde `!== "Sur commande"` aux **trois** endroits d'affichage (voir §5.1).
6. `white-space: normal` sur `.jc-line-delai` et `.jc-line-discount-shown` (§5.2).

**Règle d'affichage, identique aux trois endroits** — celle de la page produit du
thème : `stock ≤ 0` **et** `CONTINUE`. Un article en stock n'affiche pas de délai
(« le stock JC prime »), un `DENY` non plus (il n'y a rien à promettre).

## 4. Ce qui n'a PAS bougé

- **Les commandes.** `delaiLivraison` est figé J0 dans `data.lines` avec le stock :
  la promesse déjà faite est conservée (`valider/route.ts` l. 175, les
  `frozenLines` portent bien le délai). Sur une commande, la ligne affiche donc la
  promesse **faite**, pas celle d'aujourd'hui.
- **La règle « le stock JC prime ».** Sur `DEV-2026-742`, la chaise `010165` porte
  elle aussi le métachamp `2-3`, mais son stock est à 1 : elle affiche
  `🟠 Stock partiel (1 / 2 pces)` et **aucun délai**.
- **`refreshStock` rend toujours la chaîne `"Sur commande"`** quand il n'y a ni
  métachamp ni tag. Non modifié : d'autres écrans lisent peut-être ce champ et ils
  n'ont pas été inventoriés. Le filtre est à l'affichage, là où l'effet est maîtrisé.
- **`promesse-shopify.ts`** (le suivi), qui lisait déjà le métachamp.
- Le `nowrap` de `.td-stock` et `.td-money`, et le `lead_time` saisi à la main.

⚠️ **Effet assumé** : les **offres en cours** affichent la nouvelle valeur à leur
prochaine ouverture, y compris celles déjà envoyées. C'est le régime du stock
dynamique, que la page annonce, et le changement va vers ce que dit la boutique.
Un client ayant gardé un PDF verra deux chiffres.

## 5. Pièges découverts

### 5.1 « Sur commande » écrit deux fois
`refreshStock` rend **littéralement la chaîne `"Sur commande"`** quand aucun délai
n'est connu. Côté client c'est voulu (`📦 {delai || "Sur commande"}` — double filet).
Mais sur la ligne du formulaire, où le badge dit déjà « Sur commande », la 2ᵉ ligne
l'aurait **répété juste dessous**. D'où la garde `!== "Sur commande"`, aux trois
endroits. *Trouvé parce que Thierry a demandé « et s'il n'y a ni tag ni métachamp ? »
— la question a révélé le défaut avant la mise en ligne.*

### 5.2 🔴 `nowrap` au niveau de la CELLULE : tout texte long ajouté déborde
`.td-stock` **et** `.td-money` portent `white-space: nowrap` sur la cellule, pour
protéger « 2 pces » et « CHF 208.00 » d'être coupés. Conséquence : tout texte long
qu'on ajoute dans ces cellules ne peut pas se replier et **sort s'écrire par-dessus
la colonne voisine**. Vu deux fois de suite — le délai débordant sur Total, puis la
mention de remise débordant sur Stock.
**Règle : annuler le `nowrap` sur l'élément qu'on ajoute, jamais sur la cellule.**

### 5.3 `.td-stock` est déclarée DEUX fois
L. ~3906 puis ~3998 — c'est la **seconde** qui gagne (elle seule porte le `nowrap`).
Chercher `.td-stock` et lire la première occurrence donne une réponse fausse.
Même motif que les doublons CSS déjà signalés au doc `04`.

### 5.4 🔴 Le cobaye doit pouvoir AFFICHER ce qu'on teste
Les deux premiers cobayes choisis pour vérifier le repli sur les tags (`360282`,
`3602A5`) étaient inutilisables : le premier est `DENY` (délai masqué), le second a
du stock (délai masqué). Ils *semblaient* valider le repli **alors qu'ils ne
testaient rien**. Vérifier que le cobaye peut afficher la chose avant de conclure
qu'elle est correcte — corollaire direct de « un test qui ne peut pas échouer ne
valide rien ».

### 5.5 Le métachamp est au niveau VARIANTE, pas produit
Deux coloris du même produit ont deux délais différents (`9690B9` = 5-6,
`969082` = 2-3). Toute requête qui le lit au niveau produit se trompe en silence.

### 5.6 Connecteur Vercel de Cowork : 403 muet
`list_teams` rend une liste **vide**, ce qui ressemble à « aucune équipe » et non à
« pas le droit ». Le vrai message n'apparaît qu'en interrogeant un projet :
*« You must re-authenticate to this scope »* (`team_EbMflGeCK231vnTgVHsbanib`).
Donner le bon slug ou le bon ID n'y change rien — c'est le jeton à ré-autoriser.

### 5.7 Ne pas déduire quel code tourne sur une preview
Une preview testée en cours de session portait le bon code, mais son origine n'a
été établie qu'après coup (`[new branch]` au push prouvait qu'elle ne venait pas de
la branche). Vérifier le SHA rattaché au déploiement avant de conclure.

## 6. Recette

**Typecheck** sur miroir minimal (Next 16.2.3 / React 19.2.4, `tsconfig.json` du
dépôt), à chaque volet : aucune erreur nouvelle face au témoin d'avant patch.

**Helpers testés sur leurs cas limites** : `"2-3"` → `2–3 semaines` · `"12"` →
`12 semaines` · `" 2 - 3 "` toléré · `""`, `"abc"`, `"0"`, `"60"`, `"5-2"`, `null`
→ `null`, donc repli sur les tags.

### 📌 Les cobayes de référence — à réutiliser

**`9690` — Fermob Accroche Coeurs Portemanteau.** Une seule recherche, **un seul
produit donc un seul tag `6weeks`**, et quatre comportements côte à côte :

| Variantes | Métachamp | Attendu |
|---|---|---|
| `969082` | `2-3` | Délai **2-3 semaines** |
| `9690B9` `9690A6` `9690D2` `9690A7` | `5-6` | Délai **5-6 semaines** |
| `9690E1` `9690E2` | **aucun** | Délai **6-8 semaines** (repli tag) |
| `9690D1` `9690D3` | `2-3` mais **DENY** | « Rupture », **aucun délai** |

Trois valeurs différentes issues du même tag : si la cascade écrasait, tout dirait
pareil ; si elle ne s'appliquait pas, tout dirait 6-8.

**`OST0001675-HFTB` — Manutti Cobi Coffee Table 113×113.** Stock 0, `CONTINUE`,
**ni métachamp ni tag `Nweeks`** : le seul cas « aucun délai » trouvé au catalogue.
Attendu : « Sur commande » **seul**, sans 2ᵉ ligne, partout.

**`410148` — Fermob Luxembourg Chaise / Romarin 48.** Stock 0, `CONTINUE`,
métachamp `2-3`, **et une remise de ligne** : la rangée la plus exigeante du
tableau, celle qui fait cohabiter une mention de remise longue et un délai sur deux
lignes dans deux colonnes en `nowrap`.

**Résultats en preview** — les quatre cas conformes, dans le picker grand écran
**et** sur la ligne, sans chevauchement. `024365` passé à 2–3 semaines sur
`DEV-2026-742`, concordant avec la fiche produit.

📌 **Aucun numéro DRA consommé** : le numéro n'est attribué qu'au clic sur « Créer
le brouillon ». Ajouter des lignes à un brouillon non créé suffit à valider le
rendu, et n'écrit rien.

## 7. Erreur de méthode — à ne pas répéter

**Ce chantier a été déclaré fini deux fois avant de l'être.**

La première version de ce journal affirmait « **Ferme P2-35** » alors que seule la
*justesse* du délai avait été corrigée. P2-35 disait « afficher le délai dans le
picker » : le seul endroit qui l'affichait était le picker en tuiles, et il le
faisait **déjà avant le chantier**. Autrement dit, une entrée du backlog a été
cochée pour un travail qui ne l'accomplissait pas.

Ce qui l'a rattrapé n'est pas une relecture, c'est Thierry : *« à la fin ça n'a pas
grand intérêt tout ce travail si on ne voit rien. »*

**Le contrôle qui manquait** : ne pas se demander « la valeur est-elle juste ? »
mais « **qui la voit, et à quel moment décide-t-il ?** ». Ici la réponse était
« personne, jamais » — le mode grand écran est le défaut, et le délai disparaissait
dès que l'article entrait dans l'offre.

## 8. Reste à faire

- [ ] 🔴 **Un `DENY` à 0 promet toujours un délai au CLIENT.**
      `app/offre/[slug]/page.tsx` l. 977 : `isSC = stock === "sur_commande" || sn < 1`,
      **sans `inventoryPolicy`**. Ce chantier a corrigé la *source* et l'*affichage
      interne*, jamais cette condition : un `DENY` à 0 annonce « 📦 2–3 semaines »
      au lieu de « 📦 6–8 » — toujours une promesse sur une pièce qu'on ne peut plus
      obtenir. Les deux pickers et la ligne ne le font plus. **C'est le dernier
      défaut de cette famille qui engage vis-à-vis d'un client.**
- [ ] **La colonne Stock est saturée.** « Sur commande » passe sous les boutons
      d'action de la ligne, sur chaque article à 0. Défaut **antérieur** à ce
      chantier, rendu voyant maintenant que le reste est propre. Correction
      minimale : `.jc-stock-cmd` de 12px à 11px, ou élargir la colonne — mais
      toucher aux largeurs de ce tableau mérite son propre cadrage.
- [ ] **P1-44, dernier porteur** : `lib/promesse-shopify.ts` garde sa formule
      (`n>=10?n+2:n+1`, faux sur `6weeks` et `8weeks`) et prend le tag le plus long.
      Il lit déjà le métachamp, donc l'erreur ne sort que sur les variantes sans
      métachamp. Le compte des 23 dépassements est à refaire après correction.
- [ ] **P1-46** : `scripts/rattrapage-documents.mjs` n'a toujours jamais tourné.
      149 régénérations en attente.
