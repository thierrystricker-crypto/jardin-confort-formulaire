# Journal — Suivi des délais fournisseurs, côté formulaire [20-21.08.2026]

Chantier mené sur deux jours. État : **en production** (déploiement au dernier
push). Spec et état de référence : doc projet
`claude/chantier-suivi-delais-fournisseurs.md`. Côté serveur MCP + job
d'extraction : `journal-mcp-mail.md` §19 du dépôt `jardi-mail-mcp`. Base :
projet Supabase `llkyzspixrbtoprtmvoh` (tables `suivi_commandes`,
`delais_evenements`, vues `v_suivi_delais` / `v_transit_calibrage`).

## 1. Objectif

Donner à l'équipe UNE page qui répond à trois questions : où en est chaque
commande fournisseur (confirmée, facturée, expédiée, reçue), quelles commandes
sonnent (échéance, retard, délai manquant), et — l'info la plus importante
selon Thierry — **est-ce que le délai promis au client tient toujours face au
délai confirmé par le fabricant**.

## 2. Ce qui a été construit dans CE dépôt

### Dashboard `/dashboard/delais` (`app/dashboard/delais/page.tsx`)

12 colonnes : Réf, Client (société en premier + Nom Prénom en petit), Marque,
Commande, Départ fournisseur (Fermob « S35 · dès le je 03.09.26 », règle de
transit au survol), Arrivage (vert = réel, calculé depuis la preuve), **Durée**
(date commande → arrivée prévue, en jours), **Promesse client** (date + badge
`⚠️ +X j vs promis` rose ou `✓ raccord` émeraude), Étape, Alarme, ↗ Commande
(lien vers l'offre magasin `/dashboard/{slug}` ou l'admin Shopify), Actions
(bouton Reçu → calibrage). Chronologie dépliable par ligne : chaque événement
daté, sourcé (auto/manuel), avec écart calculé **au sein d'une même réf
fournisseur seulement** (deux commandes fournisseur distinctes pour une même
commande client ne se comparent pas entre elles), badge de réf, PDF source
nommé. Volets bas : file `a_valider` (événements auto sous 0.8 de confiance,
valider/rejeter), extractions orphelines (rien n'est jeté en silence), fiches
fournisseurs + calibrage des règles de transit.

### Routes API (lecture via `supabaseAdmin`, service key serveur)

- `app/api/delais/route.ts` — GET : lignes de `v_suivi_delais` (hors
  clôturées) enrichies (société, lien commande), orphelines, calibrage,
  fiches, `a_valider`.
- `app/api/delais/chronologie/route.ts` — GET : événements d'une ligne.
- `app/api/delais/evenement/route.ts` — POST : `reception` (date obligatoire),
  `valider`/`rejeter`, `orpheline_traitee`/`orpheline_ignoree`.
- `app/api/delais/promesse/route.ts` — POST : remplit la promesse client des
  commandes web (§4).

### PDF sources : liens signés périssables (`lib/pj-lien.ts`)

Le chemin Dropbox est permanent (stocké dans `delais_evenements.pj_chemin`) ;
le lien est signé HMAC et expire en 4 h, régénéré à chaque affichage — même
mécanique que le proxy `/attachment` de jardi-mail-mcp. Nécessite
`ATTACHMENT_SIGN_SECRET` dans CE projet Vercel (même valeur que jardi-mail-mcp)
mais **aucun identifiant Dropbox ici** : le secret ne fait que signer.
`nomDocument()` rend le nom lisible (préfixe technique retiré ; ARC Fermob
générique → « ARC BTB… » depuis le commentaire).

## 3. Promesse client — la colonne qui justifie le chantier

`suivi_commandes.delai_annonce_client`, remplie différemment selon le canal,
**jamais écrasée** (c'est un instantané de ce que le client a vu, pas un
calcul vivant) :

- **Magasin** : parsée du champ `lead_time` de l'offre par la fonction SQL
  `delai_client_depuis_lead_time` (mots-clés stock → date de commande ; sinon
  plus grand nombre × unité ; > 365 j → null). 19/21 remplies au 21.08.
- **Web** : cascade EXACTE du thème Shopify (doc Thierry du 21.08) — voir §4.

## 4. Promesse web : cascade métachamp → tags (`lib/promesse-shopify.ts`)

1. Métachamp de VARIANTE `fournisseur.delai_semaines` (« 2-3 », « 5-6 »,
   « 7-9 », « 10-12 » — semaines, délai client FINAL acheminement compris).
   **Il prime toujours.** Ne JAMAIS lire les autres métachamps du namespace
   (`fournisseur.stock`, `.maj_stock`, `.delai` : internes à la synchro).
2. Sinon, tag PRODUIT `Nweek(s)` (`1week`, `2weeks`, `8weeks`…) : borne haute
   retenue N+1 semaines (N+2 dès 10). Ancres sûres : 1week→1-2,
   10weeks→10-12 ; **barème intermédiaire à confirmer avec Thierry** —
   ajustable dans `semainesDepuisTags()` sans rien toucher d'autre.
3. Ni l'un ni l'autre → NULL. Le site disait « je ne sais pas », on n'invente
   pas une promesse.

Promesse = date_commande + (max des bornes hautes parmi les lignes de la
marque) × 7 jours — le max, car le client attend la livraison complète.

**Déclenchement** : le dashboard POSTe `/api/delais/promesse` à chaque
ouverture (fire-and-forget, max 40 lignes par appel, silencieux en cas
d'échec, recharge si des lignes ont été complétées). Les SKU viennent de
l'index `commandes_shopify_articles` (jamais l'API commandes de Shopify) ;
les métachamps/tags de l'API Admin GraphQL via `shopifyAdminGraphQL()`
(export ajouté à `lib/shopify-stock.ts` — Client Credentials déjà en place,
**aucun nouveau secret**).

**Rattrapage initial** fait en session le 21.08 : 129 SKU relevés,
**102/102 lignes web ouvertes remplies** (un SKU inexistant dans Shopify,
085043101151, couvert par les autres SKU de sa commande). Résultat immédiat :
23 lignes où l'arrivage prévu dépasse la promesse (têtes : CMD-80898 +61 j,
JAR-13188 +36 j, JAR-12814 +32 j, JAR-12368 +30 j).

**Limites assumées** (documentées dans le code, pas cachées) :

- On lit le métachamp/tag du MOMENT DU REMPLISSAGE, pas du jour de la
  commande (Shopify n'archive pas ; l'historique du webshop ne remonte qu'au
  12.08.2026). Rempli à J+0/J+1 par le dashboard, le biais est négligeable ;
  pour le rattrapage des vieilles commandes c'est une approximation.
- La règle du site « le stock JC prime » (pas de délai affiché si tout était
  en stock) n'est pas reconstituable a posteriori. Approximation raisonnable :
  une ligne au suivi = commandée au fournisseur = le délai était affiché.

## 5. Découverte d'architecture — d'où vient le métachamp

Le métachamp est alimenté par le SECOND projet Supabase
**`jardin-confort-webshop`** (`eyhoeujnoclzntdxmtby`) : `feed` (relevé
fournisseur — Fermob 11 274 SKU, Fatboy, Cane-line, Barebones, La Siesta) →
`delai_config` (statut Fermob → fourchette : DELAI COURT→2-3, 4 SEMAINES→5-6,
DE 5 A 8→7-9, SUPÉRIEUR A 8→10-12) → synchro quotidienne vers Shopify.
`historique` garde les relevés depuis le 12.08.2026. Seul Fermob a le
métachamp (Cane-line à venir) ; Glatz/Fatboy passent par les tags. Vérifié
sur pièce : 470314 « 4 SEMAINES » au feed porte « 5-6 » en métachamp.

⚠️ Au passage : 5 tables de ce projet webshop sont **sans RLS**
(`delai_config`, `doublon_sku`, `reference_exclue`, `reference_arretee`,
`metachamp_attente`) — à corriger avec des policies (les activer sans policy
bloquerait tout accès).

## 6. Pièges à ne pas rejouer

- **Jamais le Shopify de Cowork pour les COMMANDES** (fenêtre 60 jours
  silencieuse) — l'index `commandes_shopify` ou l'app. Les produits et
  métachamps, eux, se lisent par l'API Admin (scope complet).
- Une promesse posée ne se recalcule pas : le filtre `is null` est dans la
  sélection ET dans l'update. Recalculer effacerait l'écart qu'on cherche à
  mesurer.
- L'écart de chronologie ne se calcule qu'entre événements de la MÊME réf
  fournisseur — sinon une seconde commande fournisseur (avenant 3 du
  chantier) ressemble à un report.
- Champ vide ≠ « disponible » : pas de métachamp ni tag → promesse NULL,
  pas de badge — on n'invente rien.

## 7. À faire ensuite

- Confirmer le barème tags → fourchette avec Thierry (§4.2).
- Étape 6 : digest quotidien.
- Canaux GAL / lumi-shop non seedés dans le suivi ; rattrapage magasin
  mai-juillet si besoin.
- RLS des 5 tables du projet webshop (§5).
