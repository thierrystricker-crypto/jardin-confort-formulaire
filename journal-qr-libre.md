# Journal — QR-paiement à la volée (+ correctifs du même jour)

> Session du **28.08.2026** (Cowork, conversation « demandes d'amélioration »).
> Deux chantiers menés et mergés dans la même session :
> 1. Correctifs : ordre nom/prénom fiche client + totaux à 0 sur les documents « services uniquement » (commit `7e5ffb4`).
> 2. Feature : QR-paiement à montant libre, page `/dashboard/qr-libre` (branche `feat-qr-libre`, mergée en `8018c30`).
>
> Ce journal est la source détaillée. La consolidation vers les docs projet
> (01, 02, 04, 05) reste à faire par la conversation de consolidation.

---

## Chantier 1 — Correctifs (commit `7e5ffb4`, mergé sur main)

### 1.1 Ordre nom/prénom sur la fiche client

**Demande :** `/dashboard/clients/[id]` affichait « Prénom Nom » au lieu de « Nom Prénom ».

**Diagnostic :** un seul endroit inversé dans toute l'app — le titre `<h1>` de la
fiche client (`nomComplet`, ligne ~554 de `app/dashboard/clients/[id]/page.tsx`).
Le fichier clients, les blocs d'adresse facturation/livraison et la liste
utilisaient déjà `[nom, prenom]`.

**Correctif :** `[client.prenom, client.nom]` → `[client.nom, client.prenom]`. Une ligne.

### 1.2 Totaux à 0 sur les documents « services uniquement »

**Symptôme rapporté :** CMD-80923 affichait 0.– « à certains endroits » alors que
son total est 90.– ; soupçon que les stats du dashboard excluaient les frais de service.

**Fausse piste écartée :** les stats n'excluent PAS les frais de service. Tout
(KPI dashboard, StatsCards, RPC `stats_commandes_periode`, fiche client) lit la
colonne `offres.total_ttc`, qui inclut les services via `computeTotals`.

**Cause racine :** les routes brouillons (`POST /api/drafts` et `PUT /api/drafts/[slug]`)
ne calculaient les totaux que si le brouillon avait **au moins une ligne d'article**
(garde-fou `hasLines`, posé à l'origine parce qu'un brouillon vierge créé depuis
« Nouveau » n'a pas la structure complète qu'attend `computeTotals`). Un document
composé uniquement de prestations — CMD-80923 : « Réparation de 3 parasols »,
90.– en service custom, zéro article — était donc enregistré avec
`sous_total = services_total = total_ttc = 0`.

**Chaîne de propagation** (c'est la partie non évidente) :
brouillon (`drafts`, colonnes totaux à 0)
→ RPC SQL `transformer_draft` (recopie les colonnes du draft telles quelles)
→ offre DEV-2026-748 à 0
→ route `valider` (recopie les colonnes de l'offre)
→ commande CMD-80923 à 0.
Les pages qui **recalculent** depuis `data` (page du document, PDF, page publique)
affichaient 90.– ; celles qui **lisent la colonne** (dashboard, fiche client,
stats) affichaient 0.–. D'où le « 0.– à certains endroits ».

**Correctif code :** dans les deux routes drafts, `computeTotals` est maintenant
TOUJOURS appelé, sur une structure normalisée (`lines: []`, `enabledServices: {}`,
`servicePrices: {}`, `clientType` par défaut « Privé (prix TTC) », etc.) — le cas
« brouillon vierge » qui motivait le garde-fou est couvert par les valeurs sûres,
et les services seuls comptent désormais dès le brouillon.

**Réparation des données** (UPDATE ciblé des seules colonnes dérivées
`services_total` / `tva_montant` / `total_ttc` — le `data` JSON et les PDFs
affichaient déjà les bons montants, aucune preuve modifiée) :

| Document | id | Avant | Après |
|---|---|---|---|
| DEV-2026-151 (abandonnée, mai) | 304 | 0 | 119.– (TVA 8.92) |
| DEV-2026-748 (convertie) | 1233 | 0 | 90.– (TVA 6.74) |
| CMD-80923 (acceptée) | 1234 | 0 | 90.– (TVA 6.74) |
| DRA-146 (brouillon actif) | — | 0 | 119.– |

DRA-146 était le seul brouillon non transformé porteur du même défaut : réparé
pour qu'il ne propage pas un 0 s'il est transformé avant le déploiement du fix.
Vérification finale par SQL : plus aucune anomalie « services attendus > 0 et
total_ttc = 0 » en base.

---

## Chantier 2 — QR-paiement à la volée (branche `feat-qr-libre` → `8018c30`)

### 2.1 Besoin

Le QR d'une commande est **figé** au montant convenu (50 % ou 100 % selon le mode
de paiement). Cas réels non couverts : client qui paie un acompte carte/cash au
magasin puis veut régler le **solde** (ou un montant différent) par QR ; demande
d'**acompte à un nouveau client** avant toute commande. Impossible jusqu'ici de
créer un QR manuellement.

### 2.2 Cadrage validé (avec Thierry)

- Pré-remplissage : recherche client **et** chargement par n° de commande/offre ;
  saisie manuelle toujours possible, tout reste modifiable.
- Historique : oui, petite table dédiée.
- Montant : libre (> 0), avec récapitulatif de confirmation avant génération.
- **Interdit de toucher** à la route sanctuarisée `api/offres/[slug]/qr` → le
  pipeline est **dupliqué volontairement** dans une route autonome.

### 2.3 Ce qui a été construit

**Page `app/dashboard/qr-libre/page.tsx`** (client component, style dashboard) :
recherche client (debounce 300 ms sur `/api/clients?q=`), chargement d'un
document par numéro avec total + boutons 50 % / 100 %, formulaire débiteur
(société ou nom/prénom, rue, n°, NPA, ville — adresse complète exigée par le QR
suisse), montant, libellé (défaut « Acompte »), référence, conseiller (liste
fermée `EQUIPE_JARDI`, pré-sélection localStorage), récapitulatif → génération
(~15 s) → lien PDF, historique des 30 derniers.
Paramètres d'URL au montage : `?prefill=<JSON>` (fiche client) et
`?commande=CMD-XXXXX` (page document). Lus via `window.location.search` dans un
`useEffect` — PAS `useSearchParams`, qui imposerait un boundary `<Suspense>` au
prerender Next.

**Route `app/api/qr-libre/route.ts`** (interne, couverte par le verrou proxy.ts
sans modification du proxy) :
- `POST` : validation (nom ou société ; rue+NPA+ville ; montant > 0) → HTML au
  template Jardin-Confort (en-tête « Bulletin de paiement ») → pdf.co → pdf4me
  `CreateSwissQrBill` (même IBAN BCV, mêmes conventions que le QR commande :
  société prioritaire comme débiteur B2B, `referenceType: NON`) → upload bucket
  `pdfs` sous `qr-libre/` → insert historique. **N'écrit jamais dans `offres`**,
  aucun impact stock.
- `GET ?commande=` : pré-remplissage — correspondance exacte sur
  `numero_affiche` d'abord, repli `numero_commande`/`numero_offre`, le plus
  récent. Lecture seule.
- `GET` : historique (30 derniers).

**Table `qr_libres`** (migration `create_qr_libres`, base `llkyzspixrbtoprtmvoh`) :
id, created_at, societe/nom/prenom, rue/numero/npa/ville, montant (check > 0),
libelle, reference, commande_numero, commercial, pdf_url. **RLS activée, aucune
policy** → service role uniquement, comme le reste de l'app.

**Points d'entrée ajoutés :** bouton « 💳 QR paiement » dans la barre du
dashboard ; « 💳 Créer QR paiement à la volée » sur la fiche client (passe
l'adresse en `?prefill=`) ; « 💳 QR à la volée » sur la page offre/commande, à
côté du bouton QR figé (passe `?commande=`).

### 2.4 Incident de build (2 déploiements plantés, `eeac2b5` et `c2650e8`)

`Type error: Property 'data' does not exist on type 'GenericStringError'` sur
`/api/qr-libre/route.ts`. Cause : la liste de colonnes du `select()` était une
string **composée en deux morceaux** — supabase-js ne peut pas parser le littéral
pour en inférer le type de ligne et retombe sur `GenericStringError`. Corrigé au
commit suivant (`8018c30`) par un cast explicite `Record<string, unknown>` du
résultat. Validation avant repush : `tsc --noEmit` strict sur les mêmes versions
que Vercel (Next 16.2.3 / React 19.2.4 / supabase-js) → zéro erreur, build vert.

---

## Découvertes et pièges (à consolider au doc 04)

1. **Toute route qui écrit `total_ttc` doit passer par `computeTotals`, sans
   raccourci conditionnel.** Le garde-fou `hasLines` des drafts était un
   court-circuit « raisonnable » qui a produit des documents à 0.– propagés
   jusqu'aux commandes. Normaliser l'entrée plutôt que sauter le calcul.
2. **Les colonnes totaux de `offres` sont des recopies, pas des recalculs** :
   `transformer_draft` (SQL) et `valider` recopient telles quelles. Un défaut en
   amont se fige dans la « preuve ». Symptôme typique : montants différents entre
   les pages qui recalculent depuis `data` et celles qui lisent les colonnes.
3. **supabase-js + liste de colonnes composée = build Vercel cassé**
   (`GenericStringError`). Caster explicitement le résultat quand le `select()`
   n'est pas un littéral simple.
4. **Un contrôle de syntaxe ne suffit pas avant de pousser** : l'erreur ci-dessus
   ne se voit qu'au `tsc --noEmit` complet. Coût : deux déploiements plantés.
5. **`useSearchParams` impose un `<Suspense>` au prerender** ; pour un simple
   pré-remplissage au montage, `window.location.search` dans `useEffect` évite
   le piège.
6. La génération d'un QR consomme un crédit pdf.co + pdf4me par bulletin — sans
   autre effet de bord (pas de stock, pas d'écriture dans `offres`).

## État en fin de session

Tout est mergé sur `main` et déployé. Base réparée et vérifiée. Chantiers clos.

**Idées non retenues / pour plus tard (backlog éventuel) :** référence QRR
structurée (aujourd'hui `referenceType: NON`, comme le QR commande) ; bouton
« Solde restant » qui déduirait les acomptes déjà versés ; envoi direct du PDF
par mail au client depuis la page.
