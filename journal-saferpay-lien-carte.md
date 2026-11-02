# Journal — Lien carte Saferpay (Worldline)

Chantier ouvert le **02.11.2026**. Fait suite au chantier « Lien de paiement Wallee » (04.09.2026) et au chantier « Wallee v2 » qui n'a jamais été déployé — voir `journal-wallee-lien-paiement.md`.

Branche `feat/saferpay-lien-carte`. **État : code écrit, migration 035 à exécuter, smoke test sur CMD-80666 à faire.**

## Pourquoi Saferpay, et pourquoi maintenant

- **Wallee ne fera pas les cartes.** Ils conditionnent l'activation Visa/MasterCard à la reprise de l'acquiring du webshop Shopify, à un taux refusé.
- **Saferpay (Worldline) à 1,7 %** contre 2,9 % chez Stripe → Saferpay retenu, Stripe écarté. Contrat n° 176726201 confirmé le 20.10.2026, licence **all-in-one** (Payment API, Management API, Secure PayGate, terminaux illimités). Customer ID **382850**, terminal **17788204 (SPG)**.
- ⚠️ **Saferpay ne supporte plus Shopify** (documentation officielle) : ce contrat sert aux liens de paiement de l'app, pas au webshop.

### 🔴 Le QR Wallee n'a jamais fonctionné, et ne fonctionnera pas en l'état

Le test du 07.09.2026 avait tout : paiement de 1.00 CHF crédité sur le compte PostFinance, référence QRR `00 48617 00063 22212 31724 70751` conforme au camt.054, aucun rejet. Et pourtant la transaction Wallee `587970306` est restée « Terminé », facture « Ouvert ».

**Cause racine trouvée le 02.11** : le flux de réconciliation PostFinance ne part pas chez Wallee, il revient dans l'e-banking de Jardin-Confort — le compte QR sert aux factures QR de Shopify. Wallee ne voit donc jamais le paiement, ne passe jamais en `FULFILL`, et le badge ne s'allume jamais. La page *Réconciliation → Enregistrements* de Wallee ne contient qu'**une seule ligne, du 24.06.2025** : le canal a fonctionné au début, puis a été rebasculé. Pour que Wallee réconcilie un jour, il faudra une nouvelle demande à PostFinance, probablement avec un QR-IBAN dédié.

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
- **`app/dashboard/[slug]/page.tsx`** — bloc « Paiement » unique regroupant carte et Wallee, à l'emplacement de l'ancien bloc Wallee. Les boutons QR restent où ils sont : déplacer leurs gestionnaires dans une page de 120 Ko est le travail du chantier dashboard 2.0.
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
4. ⚠️ **Permissions IP : laisser vide** dans le backoffice. Vercel n'a pas d'IP fixe ; une seule adresse saisie couperait l'API.

## Protocole de test (preview, cobaye CMD-80666 UNIQUEMENT)

1. Fiche commande → bloc « Paiement » → « 💳 Créer lien carte acompte ». Vérifier le badge `TEST`, le montant, la date de validité.
2. Copier le lien, l'ouvrir, payer avec une carte de test → le badge « Acompte reçu — carte » doit apparaître après un ↻ ou au prochain passage du cron.
3. Relancer la création : doit répondre 409 « déjà payée ».
4. Si CMD-80666 est en « Acompte de 50 % » : créer le lien de solde ; sinon vérifier que `POST tranche=solde` répond 409.
5. **Adresses** : créer un lien sur une commande dont l'adresse n'a pas de numéro de rue, puis sur une sans rue du tout. La première doit passer, la seconde être refusée proprement par notre garde-fou.
6. Vérifier que le bloc Wallee **réapparaît** une fois la 035 exécutée.

## Reste à faire / bilan de passation

- **Webhook Saferpay** : activer « Notifiez votre serveur une fois le paiement effectué » dans le backoffice, capturer une vraie notification, puis écrire la route. Le cron deviendra le filet.
- **Saisie manuelle d'un encaissement** (espèces, TWINT comptoir, virement QR) : c'est ce qui rendra le badge exhaustif et fiable. À faire avant d'afficher quoi que ce soit sur les documents.
- **Mention de l'acompte sur les pages print dynamiques** (fiche de travail, bulletin de livraison, fiche bleue), une fois la saisie manuelle en place. Jamais sur le PDF de confirmation client, figé à la validation.
- **Montant à la volée** pour le lien carte, jumeau de `/dashboard/qr-libre`.
- **`WalleeLienPaiement` doit afficher ses erreurs** au lieu de rendre `null`.
- **Conservation 24 mois** des courriels sortants contenant un lien de paiement, les CGV et l'offre — exigence contractuelle Worldline (point 6 des conditions spéciales cartes). À organiser.
- **Vérifier la facturation TWINT chez Wallee** : TWINT étant passé chez Saferpay, un éventuel fixe mensuel côté Wallee n'a plus lieu d'être.
- **Nom affiché sur la page de paiement** : « Jardin Confort SA » sans trait d'union sur le compte de test. Vérifier l'orthographe en production.
- **QR Wallee** : demander à Wallee quel QR-IBAN est rattaché à leur contrat de réconciliation, et ce qu'il faut pour en brancher un dédié.
