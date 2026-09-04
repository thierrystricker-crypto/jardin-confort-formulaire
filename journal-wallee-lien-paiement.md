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
