# Journal — Lien de paiement Wallee (création de transaction depuis le dashboard)

Chantier ouvert et livré le **04.09.2026**. Suite directe de « Acompte payé visible » (03.09.2026, PR #50), qui avait livré le circuit descendant Wallee → Make → `/api/wallee-webhook` → `acomptes_wallee` → badge. Ce chantier fournit l'amont : la transaction dont le paiement allumera le badge.

Branche `feat/wallee-lien-paiement`, commits `9f7a8b3` (livraison) et `6e51f7f` (correctif adresse + QR-facture), merge `a6fb3a1` dans `main`, déployé en prod. **Puis hotfix le soir même** : branche `fix/wallee-facture-fulfill`, commit `88da666`, merge `f64ee55` — voir § Incident.

## 🔴 Incident du 04.09 (soir) — faux badge « Acompte reçu » sur CMD-80953

Test du bouton sur une **vraie commande** (CMD-80953, 248.00 CHF). Sur la page Wallee, choix de « **Facture** » + Payer. « Facture » est le connecteur **QR-Facture (PostFinance) = paiement sur facture, après livraison** : pour Wallee, la marchandise peut partir, l'argent viendra plus tard → la transaction passe **directement en `FULFILL`** (« Livrer »). Le webhook a fait son travail à la lettre : FULFILL relu à la source → ligne dans `acomptes_wallee` → **badge « ✅ Acompte reçu — CHF 248.00 » allumé sans un centime encaissé.** La décision D27 (« seul FULFILL atteste ») était vraie pour le virement QR et les moyens en ligne ; elle est **fausse pour le connecteur facture**.

Réparation : ligne `acomptes_wallee` supprimée au SQL Editor (`wallee_transaction_id = 587845213`) ; facture `452741330` **décomptabilisée** dans le portail (Wallee n'attend plus le paiement, le client n'a jamais rien reçu, mails coupés).

Hotfix, deux verrous indépendants :
1. **`app/api/wallee-transactions/route.ts`** : `allowedPaymentMethodConfigurations = [243711]` — **virement QR seul** (surchargeable par `WALLEE_METHODE_VIREMENT_QR`). « Facture » n'apparaît plus sur la page. C'est l'arbitrage v2 (« automatique = QR seul »), avancé au jour même.
2. **`app/api/wallee-webhook/route.ts`** : **troisième filtre** après le FULFILL relu — si le connecteur s'appelle `QR-Facture` ou la méthode `Facture`, on répond 200 `ignored: facture-sans-paiement:<id>` sans rien écrire, et on journalise l'id de méthode. Le `raw.transaction` gagne `connecteur`, `methode`, `methodeId`.

**Hotfix du hotfix** (`bdf123d`, commit direct sur `main`, assumé) : le rejeu Make du payload FULFILL a **recréé la ligne** — le verrou 2 ne voyait rien, parce que **l'API Wallee 5.x ne renvoie les objets liés (`paymentConnectorConfiguration`) qu'avec le paramètre `expand`** (exemple du README du SDK). Correctif : `expand: ["paymentConnectorConfiguration"]` à la relecture, plus un **filet 4 ter** indépendant d'`expand` : référence CMD-/DEV- + connecteur illisible + transaction ouverte à tous les moyens → ignoré en 200. Rejeu après déploiement : Make SUCCESS, log `ignored: facture-sans-paiement:255090`, aucune ligne. **`255090` = id de la configuration « Facture » (QR-Facture PostFinance)**, à exclure en dur au prochain chantier ; `243711` = virement QR.

Leçons : (a) **FULFILL ≠ encaissé pour tout connecteur** — le sens d'un état dépend du moyen ; (b) **jamais de test sur une vraie commande, Wallee compris** : une transaction créée est un engagement de facturation ; (c) le futur bouton « autres moyens » portera une **liste explicite** (TWINT, PostFinance, PayPal) qui exclut la facture par construction.

## Périmètre livré

- **Bouton « 💠 Créer lien de paiement Wallee »** sur la fiche commande (`app/dashboard/[slug]/page.tsx`, groupe « Documents PDF », après « QR à la volée »), visible uniquement si `type_document === "Commande"`. Usage **manuel, pour tester** : les flux client (page de validation, mail Make, mail pré-écrit) ne sont pas touchés.
- **Route interne `app/api/wallee-transactions/route.ts`** (cookie via `proxy.ts`, rien ouvert) :
  - `POST { slug }` : crée la transaction Wallee, l'enregistre dans `transactions_wallee`, renvoie l'URL de page de paiement (jamais stockée).
  - `GET ?slug=` : lignes du document ; relit l'état chez Wallee si la dernière n'est pas terminale ; régénère l'URL de page si elle est encore payable (`PENDING`/`CONFIRMED`).
  - `GET ?slug=&document=facture` : le PDF « Facture » rendu par Wallee (bulletin QR suisse inclus) via `getPaymentTransactionsIdInvoiceDocument`, servi tel quel.
- **Composant `components/WalleeLienPaiement.tsx`** (pattern `AcompteWalleeBadge` : fetch autonome, une ligne de JSX dans la page) : bouton de création, pastille d'état, « Ouvrir la page », « Copier le lien » (URL fraîche à chaque clic), « QR-facture Wallee » dès `AUTHORIZED`/`COMPLETED`/`FULFILL`, « Régénérer » si `FAILED`/`VOIDED`/`DECLINE`, avertissement si le montant du document a changé depuis la transaction.
- **Table `transactions_wallee`** (`docs/sql/015-transactions-wallee.sql`, exécutée à la main au SQL Editor). Table **sœur** de `acomptes_wallee`, séparée à dessein : `transactions_wallee` = ce qu'on a *demandé* (tout état), `acomptes_wallee` = ce qui est *payé* (FULFILL seul, écrit par le webhook). Lien : `wallee_transaction_id`. RLS activée sans policy. Aucune colonne d'`offres` touchée.

## Paramètres de la transaction

- Montant et débiteur **reproduits à l'identique** de `api/offres/[slug]/qr/route.ts` (sanctuarisé, non touché) : `isAcompte = payment_mode.includes("50%")`, `montant = isAcompte ? round(total_ttc × 0.5) : total_ttc` ; nom = `client_societe` sinon prénom + nom ; rue = `client_rue` + `data.numero` ; NPA, ville. Pas de helper partagé — duplication licite, comme `qr-libre`. Arbitrage de Thierry : « on n'a eu aucun bug avec cette manière ».
- `merchantReference = invoiceMerchantReference = numero_affiche` (clé relue par le webhook et le badge). `currency CHF`, `language fr-CH`, une seule `lineItem` PRODUCT au montant de l'acompte, `metaData { slug, numero_affiche, source: "dashboard" }`.
- `emailsDisabled: true` **par transaction** (jamais dans le space 48617, partagé avec le webshop).
- ~~Aucun `allowedPaymentMethodConfigurations` : tous les moyens du space (arbitrage v1)~~ → **depuis le hotfix `f64ee55` : `[243711]`, virement QR seul** (voir Incident). `successUrl` = `failedUrl` = `/offre/[slug]` (page confirmation client).
- `customerEmailAddress` omis si l'e-mail commence par `sans-email.` (D17).
- Pays `CH` en dur : aucune colonne pays dans `offres`.

## Smoke test (preview, cobaye CMD-80666 / `cmd-80666-l8i6x`)

Transaction `587401300` créée : référence `CMD-80666`, 193.50 CHF, `fr-CH`, e-mails désactivés, adresse structurée, tous moyens proposés. En choisissant « Virement bancaire avec facture QR » + Payer : Wallee émet la facture QR, passe la transaction en **`COMPLETED`** (= facture émise, **pas** payée — le piège D27, vécu), et redirige sur `/offre/cmd-80666-l8i6x`. Deux webhooks réels (autorisé, complété) → Make en SUCCESS → `acomptes_wallee` **vide** pour cette transaction → badge éteint. Le filtre FULFILL discrimine sur une transaction de l'app, pas seulement sur celles du webshop. Le bouton « QR-facture Wallee » rend le même PDF que « Télécharger la facture » du portail.

## Découvertes

1. **Le client repart sans bulletin.** Après « Payer » en virement QR, Wallee redirige sur `successUrl` sans montrer la QR-facture, et les mails sont coupés. En l'état, ce lien ne doit **pas** être donné à un client : c'est un outil vendeur (le vendeur envoie le PDF via le bouton). La bascule des flux client doit servir ce PDF depuis notre page de confirmation.
2. **`acomptes_wallee` reçoit les paiements du webshop.** Le listener 732770 écoute tout le space : 3 lignes du 03.09 avec des références aléatoires (`r6V4xWxk…`) sont des commandes web. Sans dégât (le badge lit par `numero_affiche`), mais la table se remplit. À trancher : filtrer sur le motif `^(CMD|DEV)-` dans le webhook, ou l'assumer comme journal.
3. **Repli « 1 » du QR = « Chemin des Viards 2 1 » chez Wallee.** Le QR sanctuarisé met `d.numero || "1"` dans un champ numéro séparé (pdf4me) ; le SDK Wallee n'a qu'un champ `street`, où le « 1 » s'imprimait collé à la rue. Corrigé (`6e51f7f`) : plus de repli numéral côté Wallee, assemblage `[rue, numero].filter(Boolean)` comme le bulletin HTML du QR. La transaction `587401300` garde le « 2 1 » (créée avant).
4. **QR structuré, numéro vide.** Code QR décodé : type `S` des deux côtés (norme 2025 respectée), créancier `Route de Lavaux` / `425` séparés (config du space), débiteur rue complète et **numéro vide** — le SDK n'a pas de champ numéro. Conforme (champ facultatif), moins propre que pdf4me. Limite du connecteur, pas de notre code.
5. **Moyens réellement actifs sur le space 48617** : virement QR, QR-Facture, TWINT, PostFinance Pay / e-finance / Carte PostFinance, PayPal. **Visa, MasterCard, Maestro, V PAY, Diners, Discover : « contrat de l'organisation non actif ».** Un futur « lien carte » n'offrira que TWINT/PostFinance/PayPal tant que le contrat cartes n'est pas activé chez Wallee.
6. **Document « Facture »** : intitulé « Facture », `TOTAL HT`, taux 0 % (aucune ligne `taxes` envoyée), « Payable jusqu'au » = +10 jours (réglage du connecteur, partagé avec le webshop). Le SDK permet de remplacer la facture d'une transaction avec un `dueOn` propre (`postPaymentTransactionsInvoicesIdReplace`, `TransactionInvoiceReplacement.dueOn`) — à tester.

## Arbitrages pris pendant le chantier

- Table sœur `transactions_wallee` plutôt qu'insertion dans `acomptes_wallee` (invariant « une ligne = payé » conservé).
- Reproduire le QR, pas l'abstraire (pas de `lib/acompte-document.ts`).
- v1 = tous les moyens du space **pendant quelques heures**, puis **QR seul** dès le hotfix du soir ; **v2 = lien automatique QR seul**, bouton manuel séparé pour les autres moyens (liste explicite, jamais la facture) au cas par cas.
- Une seule transaction vivante par commande ; nouvelle création uniquement après échec terminal, ou `force` si le montant du document a changé.
- Ligne témoin `587401300` laissée dans `transactions_wallee`.

## Réglages Wallee faits à la main le 04.09 (soir, après le merge)

Tout ceci vit dans le portail Wallee, pas dans le dépôt — consigné ici pour qu'on sache que ça existe.

- **Modèle de document « Facture » publié** (Paramètres → Personnalisation → Ressources, éditeur versionné : snapshot « Initial » de 2023 remplacé par la version du 04.09). Seule modification du Twig `document/template/payment/invoice.twig` : `{% block instantPayment %}{% endblock %}` — le lien « payer en ligne » et le petit QR disparaissent. Réglages *Document* : logo Jardin-Confort, devise « CHF 1,00 », informations du document réduites à 6 (référence de commande, date de la facture, à payer au plus tard le, montant impayé, mode de paiement, n° TVA). ⚠️ Un modèle « Jardin-Confort — QR-facture app » a été ajouté sous Facture, mais il pointe sur le **même** `invoice.twig` que le défaut : ce n'est pas une copie distincte.
- **Une seule page : impossible.** Le bulletin QR (page 2) est fusionné par le connecteur PostFinance après le rendu ; il n'existe ni dans `payment-receipts.twig` (qui n'est que le tableau des paiements reçus) ni dans `processor/`. Aucun réglage ne le déplace. Deux pages = présentation standard des QR-factures.
- **Connecteur `#338569` « Virement bancaire avec facture QR »** (méthode 243711) : délai de paiement **10 → 30 jours** ; à décocher : rappels de paiement, frais de relance, « code QR + lien » (source du lien dans le PDF). Les cases d'e-mails à l'acheteur restent cochées : neutralisées par transaction (`emailsDisabled`), prouvé sur trois transactions. ⚠️ Ne pas confondre avec `#352449` « QR-Facture (PostFinance) » (méthode 255090 = « Facture », exclue).
- **TVA** : la route envoie désormais `taxes: [{ rate: 8.1, title: "TVA" }]` (incluse, montant inchangé) — commit à venir ; sans cela la facture Wallee affichait 0 % et un total HT égal au TTC. Ne s'applique qu'aux transactions créées après déploiement. Pour un acompte de 50 %, afficher la TVA = usage suisse, à confirmer avec la compta.
- **Reste à faire dans le portail** : adresse du space (ligne d'expéditeur « Lutry Suisse, Switzerland » en double, nom de personne) — *Paramètres → Espace → Adresse*.
- **Preuve de bout en bout en attente** : transaction `587970306` (CMD-80947, **1.00 CHF**) à payer réellement avec sa QR-facture ; le rapprochement (1-2 jours ouvrés) doit allumer le badge sur CMD-80947 sans intervention.

## Prochain chantier — « Bascule des flux client » (cadrage à écrire)

1. Tester `postPaymentTransactionsIdProcessWithoutInteraction` sur une transaction QR seul : si ça produit la facture sans clic client, créer la transaction à la conversion (dans `after()` de `valider`, non bloquant, avec création à la demande en filet sur la page de confirmation).
2. Demander à Wallee si une facture QR **émise et non payée** est facturée (décide entre création à la conversion et création au premier affichage).
3. Tester `postPaymentTransactionsInvoicesIdReplace` avec `dueOn` (+30 jours pour un solde).
4. Page de validation / confirmation / mail Make / mail pré-écrit : servir la QR-facture Wallee à la place du pdf4me — via une route publique en lecture seule.
5. Lien « solde » : seconde transaction sur la même commande (`total_ttc − acompte`), badge distinguant acompte et solde.
6. Vérifier la migration ISO 2019 avec Wallee avant le 16.11.2026 (P1-54).

---

# Chantier « Wallee v2 » — TWINT/PostFinance/PayPal, solde, QR-facture sur la page client (05.09.2026)

Branche `feat/wallee-v2-twint-solde-facture`. Suite directe du chantier du 04.09. **État : code écrit, migration 016 à exécuter, smoke test sur CMD-80666 à faire** (voir § Protocole).

## Pivot du cadrage (04.09 soir → 05.09)

- **Les cartes de crédit ne passeront pas par Wallee.** Wallee conditionne l'activation Visa/MasterCard à la reprise de l'acquiring cartes du webshop Shopify, à un taux refusé. Le « lien carte » prévu au cadrage n'aurait de toute façon offert que TWINT / PostFinance / PayPal : il est renommé honnêtement. Les cartes iront chez un autre prestataire : **Saferpay** (Worldline, taux 1,7 %) si la licence *Easy* / *Go Card ePayments* (Payment API + Management API) est accessible à un tarif raisonnable — demande envoyée à Worldline ; sinon **Stripe** (2,9 %, Checkout Session + webhook, un lien « Page de paiement Jardin-Confort SA » existe déjà mais à montant libre). La licence Saferpay actuelle *GoCard SPG* n'a **ni Payment API ni Management API** : liens à la main seulement. Chantier cartes = séparé, plus tard. Stripe mis de côté.
- **Règle métier nouvelle : les liens QR et TWINT d'une même commande vivent en parallèle.** Cas vécu : le client reçoit le QR, demande un lien carte/TWINT, dépasse sa limite, revient payer par QR — le QR doit rester actif. « Une seule transaction vivante par commande » devient **« une seule vivante par (commande, mode, tranche) »**.
- **Aucune décomptabilisation**, ni bouton ni automatisme : une QR-facture non payée qui traîne chez le client « est une facture papier dans un tiroir ». (L'idée « décomptabiliser la QR sœur quand un TWINT passe FULFILL » est notée, pas retenue.)
- **Le solde est une seconde transaction QR**, pas une réutilisation de celle de l'acompte : une transaction Wallee porte un montant fixe et se ferme une fois payée ; un second virement sur le même QR arriverait sur le compte mais tomberait en tâche manuelle chez Wallee, sans webhook. Le solde est **créé à la demande par le vendeur** (le « payable jusqu'au » +30 j part de la création : le créer à la conversion ferait une facture échue avant la livraison).
- **Correction d'un constat du cadrage** : `/offre/[cmd-slug]` (la `successUrl`) affiche bien les deux boutons PDF + QR — une commande garde `statut = "Acceptée"`, et le bloc l. 723 teste `isAcceptee`. `successUrl` inchangée.

## Ids relevés dans le portail (space 48617, 05.09.2026)

| Configuration | id | Usage |
|---|---|---|
| TWINT (connecteur #336339) | 242531 | mode `twint` |
| PayPal | 243712 | mode `twint` |
| Carte PostFinance | 243713 | mode `twint` |
| PostFinance e-finance | 243714 | mode `twint` |
| PostFinance Pay | 243715 | mode `twint` |
| Virement bancaire (QR) | 243711 | mode `qr` |
| Facture (QR-Facture PostFinance) | 255090 | **exclu en dur** |
| Carte de crédit/débit | 242532 | contrat non actif, exclu |

## Livré (code)

- **`docs/sql/016-transactions-wallee-mode-tranche.sql`** : colonnes `mode` (`qr` | `twint` | `carte` réservé) et `tranche` (`acompte` | `solde`), DEFAULT `qr` / `acompte` (les lignes existantes sont toutes des QR d'acompte), CHECK, index `(commande_slug, mode, tranche, created_at desc)`. **À exécuter au SQL Editor avant de déployer** : la route sélectionne ces colonnes.
- **`app/api/wallee-transactions/route.ts`** : `POST { slug, mode?, tranche?, force? }` ; `METHODES_TWINT = [242531, 243712, 243713, 243714, 243715]` (env `WALLEE_METHODES_TWINT` en CSV, 255090 retiré quoi qu'il arrive) ; montant du solde = `total_ttc − acompte`, 409 si le document n'est pas en « 50% » ; règle une-vivante par (mode, tranche) ; `lineItem.uniqueId = numero-tranche`, libellé « Solde à la livraison » ; `metaData` gagne `mode`, `tranche`. `GET ?slug=` relit l'état de la dernière ligne de chaque (mode, tranche) non terminale et joint `payment_page_url` à chaque ligne payable ; renvoie `montant_acompte`, `montant_solde`, `solde_applicable`. `GET &document=facture&tranche=` : la QR-facture de la dernière transaction **QR** de la tranche (AUTHORIZED/COMPLETED/FULFILL).
- **`components/WalleeLienPaiement.tsx`** : boutons de création par (mode, tranche) absents ou en échec — « Créer QR acompte », « Créer TWINT / PostFinance / PayPal acompte », et les deux « solde » si `solde_applicable` ; une ligne d'état par transaction courante (pastille, montant, n°, Ouvrir / Copier si payable, QR-facture si QR validée, « Montant modifié » si le montant de la tranche a changé, compteur d'antérieures). Libellé COMPLETED distinct par mode (« QR-facture émise — en attente du virement » vs « Paiement annoncé »).
- **`app/api/acomptes-wallee/route.ts`** + **`components/AcompteWalleeBadge.tsx`** : chaque acompte FULFILL est enrichi de `mode`/`tranche` relus dans `transactions_wallee` (jointure par `wallee_transaction_id`) → badge « ✅ Acompte reçu » / « ✅ Solde reçu » / « ✅ Paiement reçu » (transaction inconnue de l'app, ex. webshop). Webhook **non touché**.
- **`app/api/offres/[slug]/wallee-facture/route.ts`** (nouvelle, **publique, GET seul, lecture seule**) : résout le slug (commande, ou offre convertie → commande liée par `numero_commande`, comme le GET racine), cherche la dernière transaction QR de la tranche avec facture ; `?format=json` → `{ disponible, tranche, wallee_transaction_id, state, montant }` ; sinon le PDF Wallee, `no-store`. 404 sans transaction. Déclarée dans **`proxy.ts`** juste sous `/qr` (`/wallee-facture` && GET).
- **`app/offre/[slug]/page.tsx`** et **`app/offre/[slug]/confirmation/page.tsx`** : au chargement, un `fetch ?format=json` pour `acompte` et `solde` ; si la QR-facture d'acompte existe, `handleQrDownload` ouvre `/api/offres/[slug]/wallee-facture?tranche=acompte` (libellé « Télécharger la QR-facture [de l'acompte] ») ; sinon **code pdf4me intact**. Un bouton « QR-facture du solde » apparaît quand elle existe. `api/offres/[slug]/qr`, `valider/route.ts`, Make : non touchés.

## Protocole de test (preview Vercel, cobaye CMD-80666 / `cmd-80666-l8i6x` UNIQUEMENT)

0. SQL Editor : exécuter la 016, puis `delete from transactions_wallee where commande_slug = 'cmd-80666-l8i6x';` (la ligne témoin 587401300 disparaît — assumé). Portail : décomptabiliser la facture de 587401300 si elle est encore ouverte.
1. Fiche commande : « Créer QR acompte » → page Wallee → virement QR + Payer → redirection `/offre/cmd-80666-l8i6x` → le bouton QR doit dire « Télécharger la QR-facture » et ouvrir le PDF Wallee ; **TVA 8,1 %** visible ; « Payable jusqu'au » +30 j.
2. Fiche commande : « Créer TWINT / PostFinance / PayPal acompte » → page Wallee avec TWINT, PostFinance Pay / e-finance / Carte, PayPal, **sans « Facture » ni carte de crédit** ; ne pas payer. Le QR de l'étape 1 doit rester listé et sa facture téléchargeable (parallélisme).
3. Si CMD-80666 est en « Acompte de 50 % » : « Créer QR solde » → montant = total − acompte, libellé « Solde à la livraison » → page client : second bouton « QR-facture du solde ». Sinon vérifier que les boutons solde sont absents et que `POST tranche=solde` répond 409.
4. Rejeu Make d'un FULFILL existant (CMD-80947 si payé) → badge « Acompte reçu » (tranche relue) ; une ligne webshop → « Paiement reçu ».
5. `/offre/[dev-slug]` de l'offre convertie liée (si elle existe) → même bascule.

## Reste à faire / bilan de passation (à consolider par la conversation de synthèse)

- Chantier **cartes** (Saferpay Easy / Go Card ePayments si tarif OK, sinon Stripe) : table sœur par prestataire, route, webhook signé, `mode = 'carte'` déjà prévu par la 016.
- **D du cadrage** : une commande dont le TWINT est FULFILL garde le bouton QR pdf4me côté client ; et la page client ne dit pas « acompte payé, solde à régler ». À traiter avec l'affichage solde côté client.
- Création automatique du lien QR d'acompte à la conversion (`after()` de `valider`, non bloquant) — chantier séparé, `valider/route.ts` non touché ici.
- `postPaymentTransactionsInvoicesIdReplace` avec `dueOn` pour un solde à échéance choisie — non testé.
- ISO 2019 avant le 16.11.2026 (P1-54) ; adresse du space dans le portail.
