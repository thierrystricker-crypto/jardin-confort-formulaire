# Journal — Lien carte Saferpay (Worldline)

Chantier ouvert le **02.11.2026**. Fait suite au chantier « Lien de paiement Wallee » (04.09.2026) et au chantier « Wallee v2 » qui n'a jamais été déployé — voir `journal-wallee-lien-paiement.md`.

Branche `feat/saferpay-lien-carte`. **État au 03.11.2026 : migration 035 exécutée, smoke test complet et concluant, prêt à merger. Reste la mise en production (réglages backoffice + variables), et le webhook.**

## Pourquoi Saferpay, et pourquoi maintenant

- **Wallee ne fera pas les cartes.** Ils conditionnent l'activation Visa/MasterCard à la reprise de l'acquiring du webshop Shopify, à un taux refusé.
- **Saferpay (Worldline) à 1,7 %** contre 2,9 % chez Stripe → Saferpay retenu, Stripe écarté. Contrat n° 176726201 confirmé le 20.10.2026, licence **all-in-one** (Payment API, Management API, Secure PayGate, terminaux illimités). Customer ID **382850**, terminal **17788204 (SPG)**.
- ⚠️ **Saferpay ne supporte plus Shopify** (documentation officielle) : ce contrat sert aux liens de paiement de l'app, pas au webshop.

### 🔴 Le QR Wallee n'a jamais fonctionné, et ne fonctionnera pas en l'état

Le test du 07.09.2026 avait tout : paiement de 1.00 CHF crédité sur le compte PostFinance, référence QRR `00 48617 00063 22212 31724 70751` conforme au camt.054, aucun rejet. Et pourtant la transaction Wallee `587970306` est restée « Terminé », facture « Ouvert ».

**Cause racine établie le 03.11.2026, pièces à l'appui.** PostFinance a envoyé une *Confirmation de mutation — Compte virtuel pour facture QR* datée du **26.06.2025** pour le compte virtuel `CH60 3000 0001 1000 1575 7`, dont la feuille de données indique :

> **Canal de livraison : E-finance** — valable dès le 27.06.2025

L'adhésion signée le 06.06.2025 désignait pourtant wallee AG en Managed File Transfer, User-ID `xp1s100029`. Trois semaines plus tard, la livraison des camt.054 a donc été **rebasculée vers l'e-finance de Jardin-Confort**, pour alimenter l'app Shopify qui émet une quarantaine de factures QR par an. Et la seule ligne de réconciliation jamais reçue par Wallee date du **24.06.2025**, trois jours avant la bascule. Le formulaire est explicite : « un seul canal de livraison possible ».

Wallee ne voit donc aucun paiement, ne passe jamais en `FULFILL`, et le badge ne s'allume jamais. Le test du 07.09.2026 l'illustre parfaitement : tout ce qui dépendait de nous a fonctionné — la référence QRR est arrivée intacte chez PostFinance — mais le fichier n'est jamais parti chez Wallee.

**Correctif engagé le 03.11.2026** : demande d'un **second** compte virtuel QR sur le même compte postal `CH12 0900 0000 1000 1575 7`, livré en MFTPF à `xp1s100029`, le premier gardant sa livraison e-finance pour Shopify. Formulaire `01601` pré-rempli par Wallee (pages 2 et 3 seulement ; les pages 4 à 6 sont le formulaire OPAE, hors sujet), posté à PostFinance AG, Scan Center, 3002 Bern, avec une remarque explicite en rubrique 7 pour qu'on ne mute pas le compte existant. Contact PostFinance : Chantal Murith-Roduit, Customer Team CC, +41 58 448 14 24, partenaire 1001494898.

À réception de la feuille de données, saisir le nouveau QR-IBAN dans le processeur Wallee **#282572**, champ « Numéro de compte bancaire virtuel QR », derrière « Modifier ». **C'est la seule chose à changer** : ni le space #48617, ni les connecteurs, ni les références QRR (dont le préfixe vient du space), ni le code de l'app — le QR-IBAN n'y figure nulle part.

### ✅ Canal rétabli le 11.11.2026 — vérifié de bout en bout

PostFinance a ouvert le second compte virtuel le **05.11.2026** : QR-IBAN **`CH15 3000 0002 1000 1575 7`** (le `0002` distingue du `0001` d'origine), compte de crédit inchangé `CH12 0900 0000 1000 1575 7`, **canal de livraison MFTPF**, camt.054 quotidien, numéro de livraison `1151459767`. Contact : Valérie Bergmann-Castella. Le premier compte virtuel garde sa livraison e-finance pour les factures QR Shopify — les deux coexistent, comme demandé.

Le QR-IBAN a été saisi dans le processeur **#282572**. Test sur **CMD-81027** (1.10 CHF) :

1. QR-facture émise le 10.11 à 12:12 — bulletin portant bien `CH15 3000 0002 1000 1575 7`, référence `00 48617 00005 33729 71681 50131`. **Vérifier l'IBAN sur le PDF avant de payer est le contrôle le moins cher** : il prouve que la modification du processeur a pris effet.
2. Virement exécuté le 11.11.
3. **11.11 à 00:18 : réconciliation Wallee `#9054314`, « Paiement par facture QR », Résolu.** Première ligne depuis le 24.06.2025.
4. Webhook → Make → app : ligne `acomptes_wallee` écrite à 23:18:20 UTC sur l'état `FULFILL`, et le badge s'affiche : « ✅ Acompte reçu le 10.11 — 1.10 CHF · virement QR ».

**Délai à connaître** : la livraison camt.054 est *quotidienne*. La réconciliation QR arrivera toujours le lendemain ouvrable, là où Saferpay confirme en quelques secondes. Ce n'est pas un défaut, c'est la nature du virement bancaire — mais ça interdit de conclure à une panne avant deux jours ouvrables.

### 🔴 Deux points relevés par ce test

**`paid_at` est faux : il recopie `completedOn`.** La charge utile le montre sans ambiguïté — `acomptes_wallee.paid_at` = `2026-11-10T11:12:17.183Z` = `raw.transaction.completedOn`. C'est l'instant où Wallee a bouclé la transaction **à sa création**, soit 12:12:17 heure locale : cinq minutes *avant* que le virement ne soit saisi dans l'e-banking (12:17). Ce n'est donc ni la date du paiement, ni celle de l'encaissement.

Que le jour tombe juste sur ce test est une coïncidence — la facture a été payée le jour même. Dès qu'un client paiera trois semaines après réception, le badge affichera la date d'émission, fausse de trois semaines.

Trois sources, par ordre de justesse :

1. **La date de valeur** de l'enregistrement de réconciliation (`#9054314` affiche « Date de valeur 10/11/2026 ») — la vraie date du paiement, celle qui compte comptablement. **Cible idéale**, mais absente de la charge utile du webhook : il faut la lire chez Wallee.
2. **`raw.webhook.timestamp`** (`2026-11-10T23:18:17Z`) — l'instant où Wallee a enregistré l'encaissement. Décalé d'un jour ouvrable, jamais de trois semaines. Compromis simple, disponible sans appel supplémentaire.
3. **`completedOn`** — l'actuel, faux dès que le délai de paiement dépasse la journée.

À corriger là où la ligne `acomptes_wallee` est écrite.

**Les e-mails Wallee partent au client.** Le connecteur `#352449` a « Envoyer des courriels à l'acheteur » activé : e-mail d'autorisation, de facture, de **livraison** et de refus, dans les modèles de Wallee. Le test a aussi produit une « Recommandation de livraison » et un bordereau d'expédition au moment du paiement de l'acompte. Tant que le cobaye est Jardin-Confort, c'est sans conséquence ; **avec génération automatique, ce sont ~460 clients par an qui recevraient des messages non écrits par nous**, dont un bulletin de livraison des semaines avant la livraison réelle. À passer en revue avant le chantier de génération automatique.

### Chantier suivant : QR-facture Wallee à la place du QR actuel

Décision de Thierry : la QR-facture Wallee doit se fabriquer **automatiquement à chaque conversion d'offre en commande**, et le client reçoit un mail avec le lien de sa commande et celui du QR de paiement. Le vendeur n'a alors plus de bouton à presser, et la route publique `app/api/offres/[slug]/wallee-facture` (écrite le 05.09.2026, déjà en production) sert le PDF au client.

Questions ouvertes avant d'écrire une ligne :

- **Où déclencher la création ?** Le point naturel est la validation de l'offre, mais `valider/route.ts` est sanctuarisé (P0-3, P0-4) et D26 interdit la logique dans Make. Pistes : création paresseuse au premier chargement de la page client, ou au moment de générer le QR.
- **Quelles commandes ?** Sur 2026 : 257 « Paiement d'avance », 203 « Acompte de 50 % », 26 « Paiement à 30 jours ». Ne créer que l'**acompte** à la conversion (le solde est dû à la livraison, parfois des mois plus tard) ramène le volume de ~690 à ~460 par an.
- **Coût** : Wallee facture à la **génération**, pas au paiement — les compteurs s'appellent « Number of Authorized Transactions ». Une QR-facture jamais payée coûte autant qu'une autre. À 0.20, ~92 CHF/an : le coût n'est pas l'argument, le bruit dans la réconciliation l'est.
- **Les e-mails au client**, ci-dessus.


**Conséquence** : Saferpay devient le premier canal qui confirme réellement un encaissement. Le QR client reste le pdf4me actuel, pointé manuellement.

## Répartition des moyens de paiement (décision du 02.11.2026)

| Prestataire | Moyens | Réconciliation |
|---|---|---|
| **Saferpay** | Visa, MasterCard, TWINT, Apple Pay, Google Pay | immédiate (statut `PAID`) |
| **Wallee** | QR-facture, PostFinance Pay / e-finance / Carte PostFinance, PayPal | QR : aucune aujourd'hui |

TWINT quitte donc Wallee (id `242531` retiré de la liste) : le mode Wallee `twint` est renommé **`postfinance`**.

## Ce qui a été prouvé en test avant d'écrire une ligne de code

Compte de test Saferpay (client **287701**, terminaux 17781240 eCommerce et **17781241 SPG**), le 02.11.2026 :

1. `POST /rest/customers/287701/terminals/17781241/spg-offers` → `OfferId` + `PaymentLink`
2. Page de paiement « Jardin Confort SA / CHF 1,00 / Acompte test », carte Visa de test acceptée, autorisation `840788`
3. Page de confirmation affichant **« ID ordre : CMD-TEST-001 »** — notre `OrderId` traverse toute la chaîne, c'est la clé de rattachement à la commande
4. `GET …/spg-offers/{offerId}` → `Status: PAID`, `TransactionId`

### Pièges rencontrés, tous documentés dans `lib/saferpay.ts`

- La **Management API veut les en-têtes** `Saferpay-ApiVersion` et `Saferpay-RequestId` ; elle n'utilise pas le bloc `RequestHeader` du corps, contrairement à la Payment API.
- **`Content-Type: application/json; charset=utf-8` est exigé même sur les GET** (sinon `VALIDATION_FAILED — Content type not supported`).
- **`Payer.BillingAddress` est obligatoire** à la création.
- **`ExpirationDate` est obligatoire**, au moins 1 h dans le futur, au plus 6 mois.
- 🔴 **Les paramètres par défaut de Secure PayGate doivent être enregistrés dans le Backoffice**, sinon `ACTION_NOT_SUPPORTED — There are no default settings for Secure PayGate yet`. **À refaire en PRODUCTION** avant le premier lien réel. Le formulaire exige l'expéditeur (préfixe avant `@link2saferpay.com`) et le reply-to dès qu'on touche au bloc e-mails.
- Saferpay distingue `Invalid credentials` (mot de passe faux) de `Unable to authenticate request` (verrouillage temporaire après échecs répétés, qui se lève seul).

## Livré (code)

- **`docs/sql/035-transactions-saferpay.sql`** — table `transactions_saferpay` (sœur de `transactions_wallee`) : `offer_id`, `commande_slug`, `merchant_reference`, `montant`, `tranche`, `statut` (`OPEN|PAID|EXPIRED|DISABLED`), `transaction_id`, `payment_link`, `expiration_date`, `paid_at`, `environnement` (`test|production`), `raw`. RLS activée sans policy. **Le lien est stocké** : celui de Saferpay est stable jusqu'à expiration, contrairement à l'URL jetable de Wallee. La migration ajoute aussi `mode` et `tranche` à `transactions_wallee` (voir § panne silencieuse).
- **`lib/saferpay.ts`** — client HTTP de la Management API : `creerLienPaiement`, `lireLienPaiement`, `configSaferpay`. Erreurs Saferpay remontées telles quelles (`ErrorName`/`ErrorMessage`), montants convertis en centimes, `ExpirationDate` ISO sans millisecondes.
- **`app/api/saferpay-transactions/route.ts`** — route interne. `POST { slug, tranche?, force? }`, `GET ?slug=`. Montant et débiteur repris à l'identique du QR sanctuarisé et de la route Wallee. Commandes uniquement (409 sinon), une offre `OPEN` par tranche, refus explicite si l'adresse de facturation est incomplète.
- **`app/api/acomptes/route.ts`** — nouvelle route unifiée : fusionne les paiements Wallee `FULFILL` et les liens Saferpay `PAID`. `/api/acomptes-wallee` reste en place, inchangée.
- **`components/LienCarteSaferpay.tsx`** — bouton de création par tranche, statut, lien à copier, badge `TEST` quand l'environnement est le sandbox. **Affiche ses erreurs au lieu de disparaître.**
- **`components/AcompteWalleeBadge.tsx`** — lit `/api/acomptes`, affiche le moyen (« carte », « virement QR », « PostFinance / PayPal »).
- **`app/api/cron/saferpay-statuts/route.ts` + `vercel.json`** — relecture des offres `OPEN` toutes les 30 minutes, `Authorization: Bearer $CRON_SECRET`, 50 lignes par passage, filtré sur l'environnement courant.
- **`components/AcompteWalleeBadge.tsx` + `LienCarteSaferpay.tsx`** — le ↻ et la création d'un lien émettent `jc:encaissements-maj` ; le badge l'écoute et se recharge. Sans ça il gardait l'état du chargement de la page et un paiement tout juste constaté n'apparaissait qu'après un F5.
- **`app/dashboard/[slug]/page.tsx`** — **groupe « Paiement » à part entière** (5ᵉ groupe de la fiche, même forme que les quatre autres : intitulé puis boutons), regroupant carte et Wallee. `app/v2/_components/MenusFiche.tsx` + `app/v2/v2.css` : il devient le menu déroulant « 💳 Paiement » de la v2. Placé d'abord *dans* le groupe Documents PDF le 02.11, il s'y retrouvait caché — corrigé le même jour. Les boutons QR restent où ils sont : déplacer leurs gestionnaires dans une page de 120 Ko est le travail du chantier dashboard 2.0.
- **`app/api/wallee-transactions/route.ts` + `components/WalleeLienPaiement.tsx`** — mode `twint` renommé `postfinance`, id TWINT `242531` retiré, variable d'env `WALLEE_METHODES_POSTFINANCE`.
- **`docs/sql/016-transactions-wallee-mode-tranche.sql` supprimé.**

## 🔴 La panne silencieuse du bloc Wallee (découverte le 02.11)

Le code « Wallee v2 » écrit le 05.09 **était commité sur `main`** — sans branche dédiée, emporté par un `git add` d'un chantier d'octobre : aucun commit ne mentionne « wallee » après `4535bec`. Mais la **migration 016 n'a jamais été exécutée**. La route sélectionnait donc `transactions_wallee.mode` et `.tranche`, colonnes inexistantes ; elle échouait ; et le composant, qui rend `null` quand il n'a pas d'état, **faisait disparaître le bloc Wallee de la fiche commande sans aucun message**. D'où zéro transaction depuis le 04.09.2026.

Deux leçons :
1. Un fichier de migration non exécuté qui part en production est une bombe à retardement. **Exécuter la migration avant de merger**, pas après.
2. **Un composant ne doit jamais s'effacer sur erreur.** Une fonction en panne qui se cache coûte des mois. `LienCarteSaferpay` affiche ses erreurs ; `WalleeLienPaiement` devra être corrigé de la même manière.

## Règle d'affichage, posée le 02.11

**On n'affiche JAMAIS « non payé ».** L'absence de badge signifie « nous ne savons pas », pas « le client n'a pas payé » : un acompte réglé en espèces au magasin, par TWINT au comptoir ou par virement QR n'est connu d'aucune source automatique. Un vendeur qui annoncerait à un client qu'il n'a pas payé alors qu'il a payé serait pire que pas d'information du tout.

## Prérequis avant le test

1. SQL Editor : exécuter `035-transactions-saferpay.sql`.
2. Backoffice Saferpay **de test** : paramètres Secure PayGate enregistrés (déjà fait le 02.11).
3. Variables Vercel, **valeurs sandbox sur la preview** :
   `SAFERPAY_BASE_URL=https://test.saferpay.com/api`, `SAFERPAY_CUSTOMER_ID=287701`, `SAFERPAY_TERMINAL_ID=17781241`, `SAFERPAY_API_USER`, `SAFERPAY_API_PASSWORD`.
   En production : `https://www.saferpay.com/api`, `382850`, `17788204`, et un utilisateur JSON API créé dans le backoffice de prod.
4. 🔴 **Les variables Vercel sont figées AU BUILD.** Les cinq `SAFERPAY_*` ont été créées le 02.11 à 23h08–23h10 UTC, alors que le preview `pjqfm25qi` avait été construit à 22h57 : il affichait donc « Saferpay non configuré sur cet environnement », et un redéploiement de **production** n'y change rien puisqu'elles sont scopées **Preview**. Il faut redéployer la **branche**. Même piège à prévoir en production : créer les variables, *puis* déployer.
5. ⚠️ **Permissions IP : laisser vide** dans le backoffice. Vercel n'a pas d'IP fixe ; une seule adresse saisie couperait l'API.

## Protocole de test (preview, cobaye CMD-80666 UNIQUEMENT)

1. Fiche commande → bloc « Paiement » → « 💳 Créer lien carte acompte ». Vérifier le badge `TEST`, le montant, la date de validité.
2. Copier le lien, l'ouvrir, payer avec une carte de test → le badge « Acompte reçu — carte » doit apparaître après un ↻ ou au prochain passage du cron.
3. Relancer la création : doit répondre 409 « déjà payée ».
4. Si CMD-80666 est en « Acompte de 50 % » : créer le lien de solde ; sinon vérifier que `POST tranche=solde` répond 409.
5. **Adresses** : créer un lien sur une commande dont l'adresse n'a pas de numéro de rue, puis sur une sans rue du tout. La première doit passer, la seconde être refusée proprement par notre garde-fou.
6. Vérifier que le bloc Wallee **réapparaît** une fois la 035 exécutée.

## Résultats du smoke test (02.11.2026, preview, sandbox)

Chaîne complète validée sur **CMD-80666** : lien créé (193.50 CHF, valable 30 jours), page Saferpay au bon libellé et au bon `OrderId`, paiement Visa de test accepté, autorisation `525574`, transaction `Yf71G1b4nCE4tASf56lObfvbnfEb`. En base : `statut = PAID`, `paid_at` à la minute, `environnement = test`. Le bouton de création disparaît une fois la tranche payée. Le bloc Wallee est bien réapparu après la 035.

**CMD-81017** (50 %, société Bäckerei-Conditorei Fleischli) affiche bien ses deux tranches, 22.50 CHF chacune sur 45.00. Le **solde a été payé** le 03.11 — autorisation 491465, transaction `SCSh5Wb33p2btASj0xOdb8dlO5Wb` — ce qui valide d'un coup la tranche solde et un paiement **société** de bout en bout (`Company` transmis dans l'adresse de facturation).

Situation utile observée au passage : solde payé, acompte toujours ouvert. Le badge affiche « ✅ Solde reçu le 03.11 — 22.50 CHF · carte » et ne laisse jamais entendre que le reste n'est pas payé — la règle tient.

Le menu v2 : le bloc était d'abord **à l'intérieur** du groupe « Documents PDF » (un `<span>` n'est pas reconnu comme intitulé de groupe par `MenusFiche`). Il est devenu un 5ᵉ groupe à part entière → menu « 💳 Paiement ». Étant le dernier de la rangée, son panneau (`left: 0`) sortait de la fenêtre : `MenusFiche` mesure maintenant à l'ouverture et bascule le panneau à droite (`v2-menu-droite`) quand il déborde et qu'il y tient. Corrige du même coup tout menu qui déborderait après un retour à la ligne.

⚠️ **Le cron ne tourne pas sur la preview** : Vercel n'exécute les tâches planifiées que sur les déploiements de production, et la production n'a aucune variable `SAFERPAY_*` (toutes scopées Preview). En preview, seul le **↻** rafraîchit un statut. Le cron ne sera donc réellement éprouvé qu'une fois la production configurée — et comme il filtre sur `environnement`, il ne touchera jamais les lignes de test.

### 🔴 Ce que le test d'adresse a révélé

Le protocole supposait une colonne `client_numero`. **Le numéro vient en réalité de `data.numero`** ; la colonne existe mais n'est pas la source. Conséquences :

- Le cas « rue sans numéro » n'est pas un cas limite : sur 484 commandes, 265 ont le numéro écrit **dans** `client_rue` (« Chemin de la cornelle 46 »). Il passe sans rien faire.
- **Le trou corrigé** : `client_rue` vide + `data.numero` rempli donnait une rue réduite au seul numéro. **CMD-80883** (« 31 ») n'était refusée que sur NPA et localité, et **CMD-80878** (« 36 », Gstaad, NPA et ville remplis) **serait passée entièrement**, créant un lien avec une adresse de facturation inutilisable. Le garde-fou exige désormais **au moins une lettre** dans la rue.
- Refus propres confirmés avant tout appel à Saferpay : CMD-80883 et CMD-80933 (NPA seul manquant → message précis).
- Cas positif : **CMD-81017** (adresse complète, numéro en champ séparé, 50 %) — lien d'acompte créé à 22.50 CHF sur 45.00.

### Hors périmètre, à verser au backlog

**7 commandes portent le numéro en double** parce que `client_rue` le contient déjà *et* que `data.numero` est rempli — CMD-81010 donne « Petite Corniche 11 11 ». La logique d'adresse étant reprise à l'identique du QR sanctuarisé, ces adresses sont **déjà fausses sur les QR-factures envoyées**. Rien n'a été touché ici.

## Mise en production — les réglages du backoffice

Ces réglages ne sont **pas** dans le code et ne se déploient pas : ils vivent dans le backoffice Saferpay, et ceux de test ne suivent pas en production. Tant qu'ils manquent, l'API répond `ACTION_NOT_SUPPORTED — There are no default settings for Secure PayGate yet`.

Relevé sur le compte de **test** le 03.11.2026. Seuls les e-mails et la condition 3-D Secure y ont été saisis à la main ; le reste est au défaut.

| Réglage | Valeur en test | En production |
|---|---|---|
| Adresses de notification de paiement | `direction@jardinconfort.ch` | à ressaisir |
| Type d'autorisation standard | *Enregistrement automatique des transactions* | garder — un acompte s'encaisse, ne se réserve pas |
| Condition standard (3DSV2) | *Uniquement avec transfert de responsabilité et authentification 3-D Secure* — **choisi par Thierry, ce n'est pas le défaut** | 🔴 **à refaire** : le défaut est « aucune condition », et un paiement sans transfert de responsabilité ne se distingue en rien d'un autre jusqu'au litige |
| Demander le nom du titulaire | décoché | garder |
| Redirection vers propre page | décoché | garder — le vendeur suit l'état sur la fiche |
| Notifiez votre serveur une fois le paiement effectué | décoché | **c'est ici que se branchera le webhook** |
| Expéditeur | `jardin-confort@link2saferpay.com` | à ressaisir |
| Reply-to / BCC | `contact@jardinconfort.ch` | à ressaisir |
| Conditions générales (PDF par langue) | aucune | à téléverser |

Donc : rien à « décider » en production, tout à **recopier** — et deux lignes qui ne se recopieront pas toutes seules, la condition 3-D Secure et les CG. Le formulaire exige l'expéditeur et le reply-to dès qu'on touche au bloc e-mails.

### ❓ Question ouverte à poser à Saferpay avant le premier lien réel

La *Condition standard* est présentée comme s'appliquant **« pour les liens créés dans le Backoffice »**. Nos liens viennent de l'**API**, et le corps de `spg-offers` ne contient **aucun champ de condition 3-D Secure** (seulement `Options.PreAuth`, que nous ne passons pas — d'où la capture automatique). Deux lectures possibles : soit le réglage couvre aussi les liens API, soit ceux-ci retombent sur la configuration du terminal.

C'est la seule inconnue qui engage de l'argent : sans transfert de responsabilité, la fraude reste à notre charge. **À faire confirmer par le support Saferpay**, pas à supposer.

### Rappel contractuel affiché par Saferpay lui-même

Le backoffice rappelle dans l'encadré du bloc e-mails que **les courriels sortants contenant le lien de paiement, les CG jointes et l'offre doivent être conservés au moins 24 mois** (point 6 des « Conditions spéciales pour l'acceptation des cartes de crédit dans les transactions sans présentation de la carte »). Comme nos liens partent par les canaux du vendeur et non par l'envoi Saferpay, cette conservation est **à notre charge** : à organiser.

Puis, hors Secure PayGate : créer un **utilisateur JSON API de production**, laisser ses **permissions IP vides**, saisir les cinq variables `SAFERPAY_*` en scope Production, et **déployer après** — jamais avant.

## Reste à faire / bilan de passation

- **Webhook Saferpay** : activer « Notifiez votre serveur une fois le paiement effectué » dans le backoffice, capturer une vraie notification, puis écrire la route. Le cron deviendra le filet.
- **Saisie manuelle d'un encaissement** (espèces, TWINT comptoir, virement QR) : c'est ce qui rendra le badge exhaustif et fiable. À faire avant d'afficher quoi que ce soit sur les documents.

### Chantier « Paiements » — demandé le 11.11.2026

Trois fonctions demandées, qui partagent un même socle :

1. **Notification dans le dashboard** à chaque encaissement (type `paiement_recu` dans la table `notifications` existante ; voir plus haut pour le patron du helper unique et les deux questions ouvertes : Wallee inclus ou non, `commercial` renseigné ou non).
2. **Une page « Paiements »** listant acomptes et paiements, toutes sources confondues — extension globale de ce que `/api/acomptes` fait aujourd'hui par document.
3. **Une quittance maison imprimable**.

**Le besoin de quittance concerne les paiements À DISTANCE, pas le comptoir** (précisé par Thierry le 11.11.2026 — une première analyse disait l'inverse et était fausse). L'encaissement au magasin produit déjà un **ticket de caisse** : ce client a sa preuve. Ceux qui n'ont rien portant notre en-tête sont ceux qui règlent par **lien carte Saferpay** ou **QR Wallee** — ils ne reçoivent qu'une confirmation du prestataire ou un avis bancaire.

Conséquence : **la quittance ne dépend pas de la saisie manuelle.** Ses données sont déjà en base, dans `transactions_saferpay` et `acomptes_wallee`. Elle peut être construite immédiatement.

⚠️ Et il y a un risque à faire l'inverse : émettre une quittance maison pour un encaissement saisi manuellement **doublerait le ticket de caisse** — deux documents, deux numérotations, pour un seul paiement. Si la saisie manuelle arrive, soit elle ne donne pas droit à quittance, soit elle référence le numéro du ticket.

La **saisie manuelle** garde sa valeur, mais pour la liste et le badge : un acompte réglé cash reste invisible dans l'app, et le vendeur qui ouvre la fiche ne voit rien. Problème d'information interne, pas de preuve client.

Deux décisions à prendre avant d'écrire la quittance :

- **Une quittance émise est une preuve** : numérotée, figée, modifiable seulement par correction tracée — même régime que les offres signées et les commandes.
- **TVA** : un acompte sur une commande TTC contient de la TVA. Décider si et comment elle figure sur la quittance, avec le comptable.
- **Mention de l'acompte sur les pages print dynamiques** (fiche de travail, bulletin de livraison, fiche bleue), une fois la saisie manuelle en place. Jamais sur le PDF de confirmation client, figé à la validation.
- **Montant à la volée** pour le lien carte, jumeau de `/dashboard/qr-libre`.
- **`WalleeLienPaiement` doit afficher ses erreurs** au lieu de rendre `null`.
- **Notification dans le dashboard à chaque paiement** : la table `notifications` convient telle quelle (type libre, `offre_slug`, `commercial`, `total_ttc`…), un type `paiement_recu` s'y range sans migration. Le point de conception : un helper unique appelé par les trois constats de paiement (↻, cron, webhook), n'écrivant que sur la transition `OPEN → PAID`, sinon le vendeur reçoit deux ou trois fois la même notification. Deux questions ouvertes : Wallee inclus ou non, et `commercial` renseigné ou non.
- **Webhook Saferpay — la forme est désormais connue** (relevé dans le backoffice le 03.11) : la case « Notifiez votre serveur une fois le paiement effectué » prend une URL contenant `{{{PAYMENTPAGETOKEN}}}`, puis `PaymentPage/Assert` donne la transaction, rattachée par `Transaction.OrderId`. Attention, `Assert` est une méthode de la **Payment API** (bloc `RequestHeader` dans le corps), pas de la Management API. Pointer sur l'alias **stable de branche** et non sur une URL de déploiement, qui change à chaque build. Ne cocher la case qu'une fois la route écrite.
- **Conservation 24 mois** des courriels sortants contenant un lien de paiement, les CGV et l'offre — exigence contractuelle Worldline (point 6 des conditions spéciales cartes). À organiser.
- **Vérifier la facturation TWINT chez Wallee** : TWINT étant passé chez Saferpay, un éventuel fixe mensuel côté Wallee n'a plus lieu d'être.
- **Nom affiché sur la page de paiement** : « Jardin Confort SA » sans trait d'union sur le compte de test. Vérifier l'orthographe en production.
- **QR Wallee** : demander à Wallee quel QR-IBAN est rattaché à leur contrat de réconciliation, et ce qu'il faut pour en brancher un dédié.
