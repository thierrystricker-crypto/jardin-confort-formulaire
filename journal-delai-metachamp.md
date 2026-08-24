# Journal — Chantier « Délai : le métachamp d'abord »

> Branche `fix/delai-metachamp-prioritaire` · 24.08.2026 · session unique
> Ferme **P2-35** et la moitié visible de **P1-44**.
> Déclencheur : une offre client réelle, `DEV-2026-742`, annonçant **6–8 semaines**
> sur `024365` là où la boutique annonce **2-3 semaines** pour la même variante.

---

## 1. Le constat

`024365` (Fermob Bistro Table 77×57 / Vert tilleul 65) porte **à la fois** le
métachamp de variante `fournisseur.delai_semaines = "2-3"` **et** le tag produit
`6weeks`. Depuis la publication du thème le 23.08, la boutique lit le métachamp
en priorité et affiche « Sur commande ✓ Délai 2-3 semaines ».

L'application, elle, ne demandait **jamais** le métachamp : `refreshStock()` ne
réclamait que `product { tags }` dans ses deux requêtes GraphQL. D'où 6–8.

**Un client pouvait donc lire deux délais différents pour le même article** : 2-3
sur la fiche produit qu'il venait de quitter, 6–8 sur l'offre qu'on lui envoyait.
L'écart n'était pas dangereux — l'app était plus *pessimiste* que la boutique,
donc rien d'intenable n'a été promis — mais il rendait l'offre incohérente avec
le site, sur ~8 400 variantes Fermob métachampées.

### Les quatre porteurs du barème (rappel du journal précédent)

| Porteur | Bar. tags | Multi-tags | `8weeks` | Métachamp | Qui le voit |
|---|---|---|---|---|---|
| Thème (référence) | — | le + court | 8-10 | ✅ prioritaire | le client, boutique |
| `lib/shopify-refresh-stock.ts` | ✅ | le + court | ✅ | ❌ → **corrigé** | le client, page d'offre |
| `app/api/shopify-search/route.ts` | libellés ✅ | le + long ❌ | absent ❌ | ❌ → **corrigé** | le vendeur, picker |
| `lib/promesse-shopify.ts` | formule ❌ | le + long ❌ | 9 ❌ | ✅ déjà | le suivi des délais |

## 2. Les modifications

### 2.1 Commit `1ea2269` — `lib/shopify-refresh-stock.ts` (page client)

- Les **deux** requêtes GraphQL (par ID de variante **et** fallback par SKU)
  demandent `metafield(namespace: "fournisseur", key: "delai_semaines")`.
- Nouveau `getDelayFromMetafield()` : parse `"2-3"`, `"10-12"`, `"12"` et compose
  `« 2–3 semaines »` (tiret demi-cadratin, comme `DELAY_MAP`). Rend `null` sur
  toute valeur qui ne parse pas → repli sur les tags.
- Nouveau `getDelay(metachamp, tags)` : la cascade du thème, métachamp d'abord.
- **Le barème des tags de ce fichier était déjà exact** (`6weeks → 6–8`,
  `8weeks → 8–10`, chaîne ascendante donc le plus court sur multi-tags). Pas touché :
  il devient simplement le repli qu'il est dans le thème.

### 2.2 Commit `9e3ad00` — `app/api/shopify-search/route.ts` (picker)

- Même cascade : le métachamp est demandé dans la requête Admin par IDs, transporté
  dans la Map, et prime à la composition de l'item (le tag posé par
  `buildStorefrontItems` reste le repli).
- **Deux écarts avec le thème corrigés** : `8weeks` était purement **absent** (donc
  aucun délai là où le site dit 8-10), et la chaîne était **descendante**, donc sur
  un produit multi-tags elle retenait le délai le plus **long** quand le thème
  retient le plus **court**.

📌 **Les deux fichiers ne composent pas la même phrase, et c'est voulu** :
`« 2–3 semaines »` (tiret demi-cadratin) pour la page client, qui préfixe déjà d'un
`📦` ; `« Sur commande ✓ Délai 2-3 semaines »` (trait d'union) pour le picker, dont
le bandeau reprend la formulation de la boutique. Chaque helper reste aligné sur le
vocabulaire déjà en place dans son fichier.

## 3. Ce qui n'a PAS bougé

- **Les commandes.** Leur `delaiLivraison` est figé J0 dans `data.lines` avec le
  stock : la promesse déjà faite est conservée. Vérifié dans `valider/route.ts`
  l. 175, les `frozenLines` portent bien le délai.
- **La règle « le stock JC prime ».** Sur `DEV-2026-742`, la chaise `010165` porte
  elle aussi le métachamp `2-3`, mais son stock est à 1 : elle affiche
  `🟠 Stock partiel (1 / 2 pces)` et **aucun délai**. La cascade n'a pas débordé.
- **Le `lead_time`** de l'offre, saisi à la main par le commercial (« 3/6 semaines »
  sur `DEV-2026-742`) : champ libre, indépendant.
- **`promesse-shopify.ts`**, qui lisait déjà le métachamp. Sa formule de repli sur
  les tags reste fausse — voir §6.

⚠️ **Effet assumé** : toutes les **offres en cours** affichent la nouvelle valeur à
leur prochaine ouverture, y compris celles déjà envoyées. C'est le régime du stock
dynamique, que la page annonce (« Stock en temps réel — mis à jour à chaque
ouverture »), et le changement va vers ce que dit la boutique. Un client ayant gardé
un PDF verra deux chiffres.

## 4. Recette

**Typecheck** sur miroir minimal (Next 16.2.3 / React 19.2.4, `tsconfig.json` du
dépôt) : **zéro erreur avant, zéro erreur après** — témoin propre cette fois.

**Helpers testés sur leurs cas limites** avant toute mise en ligne :
`"2-3"` → `2–3 semaines` · `"12"` → `12 semaines` · `" 2 - 3 "` → toléré ·
`""`, `"abc"`, `"0"`, `"60"`, `"5-2"`, `null` → `null`, donc repli sur les tags.

**Le cobaye : `9690` — Fermob Accroche Coeurs Portemanteau.** 📌 **À réutiliser :
c'est le meilleur cas de test du dépôt pour les délais.** Une seule recherche, un
seul produit donc **un seul tag `6weeks`**, et quatre comportements côte à côte :

| Variantes | Métachamp | Attendu |
|---|---|---|
| `969082` | `2-3` | Délai **2-3** semaines |
| `9690B9` `9690A6` `9690D2` `9690A7` | `5-6` | Délai **5-6** semaines |
| `9690E1` `9690E2` | **aucun** | Délai **6-8** semaines (repli tag) |
| `9690D1` `9690D3` | `2-3` mais **DENY** | « Rupture », **aucun délai** |

Trois valeurs différentes issues du même tag : si la cascade écrasait, tout dirait
pareil ; si elle ne s'appliquait pas, tout dirait 6-8. Les deux `DENY` vérifient en
prime que ce chantier et P1-47 se composent sans se marcher dessus.

Résultat en preview : les quatre lignes conformes, plus `024365` passé à
**2–3 semaines** sur `DEV-2026-742`.

## 5. Pièges découverts

1. 🔴 **Pour tester un affichage de délai, le cobaye doit être `CONTINUE` ET à
   stock ≤ 0.** Les deux premiers cobayes de cette session (`360282`, `3602A5`)
   étaient inutilisables : le premier est `DENY` (délai masqué par P1-47), le second
   a du stock (délai masqué par « le stock JC prime »). Ils *semblaient* valider le
   repli alors qu'ils ne testaient rien. Vérifier que le cobaye peut **afficher** la
   chose avant de conclure qu'elle est correcte.
2. **Le métachamp est au niveau VARIANTE, pas produit.** Deux coloris du même
   produit ont deux délais différents (`9690B9` = 5-6, `969082` = 2-3). Toute
   requête qui le lit au niveau produit se trompera silencieusement.
3. **Connecteur Vercel de Cowork : 403 sur le scope de l'équipe**
   (`team_EbMflGeCK231vnTgVHsbanib`). `list_teams` rend une liste **vide**, ce qui
   ressemble à « aucune équipe » et non à « pas le droit ». Donner le bon slug ou le
   bon ID n'y change rien : c'est le jeton qu'il faut ré-autoriser. À faire si l'on
   veut que l'assistant lise les déploiements lui-même.
4. **Ne pas déduire quel code tourne sur une preview.** Une preview testée plus tôt
   dans la session portait le bon code, mais son origine n'a été établie qu'après
   coup. Vérifier le SHA rattaché au déploiement avant de conclure — c'est le
   doc `04` §9 appliqué à l'envers.

## 6. Reste à faire

- [ ] 🔴 **Un `DENY` à 0 promet toujours un délai au CLIENT.**
      `app/offre/[slug]/page.tsx` l. 977 : `isSC = stock === "sur_commande" || sn < 1`,
      **sans `inventoryPolicy`**. Ce chantier a corrigé la *source* du délai, pas la
      *condition d'affichage* : un `DENY` à 0 annonce désormais « 📦 2–3 semaines »
      au lieu de « 📦 6–8 semaines » — toujours une promesse sur une pièce qu'on ne
      peut plus obtenir. Le picker, lui, ne le fait plus. **C'est le dernier défaut
      de cette famille qui engage vis-à-vis d'un client.**
- [ ] **P1-44 pour le suivi** : `lib/promesse-shopify.ts` garde sa formule
      (`n>=10?n+2:n+1`, faux sur `6weeks` et `8weeks`) et prend le tag le plus long.
      Il lit déjà le métachamp, donc l'erreur ne sort que sur les variantes sans
      métachamp. Le compte des 23 dépassements est à refaire après correction.
- [ ] **P1-46** : `scripts/rattrapage-documents.mjs` n'a toujours jamais tourné.
      149 régénérations en attente.
