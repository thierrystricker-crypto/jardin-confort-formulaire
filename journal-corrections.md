# Journal — Chantier "Corrections" (modifications post-immutabilité)

> **Pour reprendre dans un nouveau chat Claude :** colle ce fichier en premier
> message, accompagné si possible de `journal-brouillons.md` pour le contexte
> projet global. Ce fichier contient tout le cadrage du chantier corrections.

---

## 🎯 Contexte du chantier

**Projet :** `jardin-confort-formulaire` (Next.js + Supabase + Shopify, Vercel)
**Chemin local :** `C:\Users\ezefi\jardin-confort-formulaire`
**Lié à :** journal-brouillons.md (chantier précédent, terminé 2026-05-16)
**Démarrage :** 2026-05-17

### Problème métier

Depuis la mise en prod du chantier brouillons, les offres (DEV-XXXX) et les
commandes (CMD-XXXXX) sont **immuables** dès leur création. En vraie vie,
les commerciaux ont besoin de corriger des erreurs après coup (faute
d'orthographe, mauvais téléphone, adresse incomplète). Aujourd'hui ils
doivent dupliquer en brouillon, corriger, retransformer — pénible et casse
les statistiques.

### Décision de cadrage stratégique

Livrer **vite** un mécanisme de corrections limité aux **champs purement
cosmétiques** (adresse, téléphone, notes), avec une architecture carrée qui
pourra **plus tard** être étendue aux champs sensibles (prix, lignes,
remises) sans refactor majeur. Les corrections de mouvements d'articles
(stock Shopify) sont **complètement hors scope** pour le moment.

---

## 🔒 Périmètre v1 verrouillé (validé 2026-05-17)

### ✅ Champs corrigibles (cosmétique pur, ~22 champs)

**Bloc en-tête**
- Mode de paiement
- Mode de livraison

**Bloc adresse de facturation**
- Société
- Nom, Prénom
- Complément nom
- Rue, No, NPA, Ville
- Complément d'adresse
- Téléphone 1, Téléphone 2
- Email
- Délai de livraison

**Bloc adresse de livraison (entier)**
- Checkbox "Adresse de livraison différente"
- Société livraison
- Nom livraison, Prénom
- Complément nom livraison
- Rue livraison, No, NPA, Ville livraison
- Complément d'adresse livraison
- Téléphone livraison
- Accès livraison / étage

**Bloc informations complémentaires**
- Remarques (visibles sur le document client)
- Notes internes (non visibles client)

### 🔒 Champs verrouillés v1 (grisés dans le drawer, tooltip "Modification non disponible en v1")

- **Commercial** (effets de bord stats commerciales, à voir avec workflow "transfert de dossier" en v2)
- **Type de client** (Privé TTC / Pro HT — change l'affichage des prix dans le PDF, à traiter avec les champs financiers)
- **Validité de l'offre** (engagement contractuel, à voir avec les champs sensibles)

### 🚫 Hors drawer v1 complètement (n'apparaissent même pas)

- Numéro DEV/CMD (jamais modifiable)
- Toutes les lignes (libellé, quantité, prix unitaire, remise ligne)
- Remise globale, services inclus, arrondi, TVA, total
- Identité fiscale du client (numéro TVA, IDE)

---

## ✅ Décisions de design verrouillées

| Décision | Choix retenu |
|---|---|
| **Entités concernées** | Offres ET commandes, mécanisme commun |
| **Granularité permissions** | Tout utilisateur peut corriger (pas de système de rôles v1) |
| **Auteur de la correction** | Nom saisi à la volée dans la modal de confirmation, pré-rempli depuis localStorage (pas d'auth système dans le projet) |
| **Raison obligatoire** | Oui, textarea min 5 caractères (CHECK constraint en DB + validation front) |
| **UX principale** | Bouton "✏️ Corriger" sur page dashboard → drawer latéral |
| **Diff temps réel** | Zone "Modifications en attente" en haut du drawer |
| **Confirmation** | Modal centrée avec récap des modifs + champ "Votre nom" + textarea "Raison" |
| **Synchro client/nom/email** | Avertissement contextuel (Option 1) : modal d'info si correction sur `client_email`, `client_nom` ou `client_prenom` (cf. section dédiée). Pas de blocage. Pas d'intégrité référentielle dure cassée. |
| **Régénération PDF** | Synchrone au save (utilisateur attend 2-3s) |
| **Mention sur PDF** | "Édition mise à jour le JJ.MM.AAAA — version N" sur **tous les PDFs** (offre + commande + fiche de travail) |
| **Détail des modifs** | Affiché **uniquement** sur la fiche de travail (usage métier interne) |
| **Historique dashboard** | Section collapsible "📝 Historique des corrections", masquée par défaut, lecture seule, immuable |
| **Périmètre découpé en** | 3 PR successives (Session 1, 2, 3) |

---

## 🔍 Synchro fiche client ↔ offres/commandes (état actuel + impact corrections)

### État actuel du projet (2026-05-17, vérifié dans le code)

**Aucun mécanisme automatique ne crée de fiche client lors de la création d'une offre ou d'un brouillon.** La table `clients` se remplit uniquement par :
1. Création manuelle via `/dashboard/clients` (bouton "+ Nouveau client")
2. Import Winbiz (`app/api/clients/import/route.ts`)
3. Sync Shopify (`lib/shopify-orders.ts`)

Le fichier `app/api/offres/[slug]/route.ts` contient bien 2 occurrences de `.from("clients")`, mais ce sont des **SELECT en lecture seule** : à chaque affichage d'offre, on cherche dans `clients` une fiche avec le même email pour afficher son `numero_client`. Aucun INSERT/UPDATE.

`app/api/offres/save/route.ts` ne contient **aucune** référence à la table `clients`.

### Conséquence : le matching offre ↔ fiche client est statistique

Les champs `client_*` dans `offres` et `commandes` sont des **copies dénormalisées** au moment de la création, sans FK. Le rapprochement avec la fiche client se fait à la volée lors de l'affichage du dashboard, via `enrichWithCounts` dans `app/api/clients/route.ts`, par matching en cascade :
1. Priorité 1 : `client_numero_client` (NULL en pratique sur 100% des offres récentes, cf. dette D1)
2. Priorité 2 : `client_email` (case-insensitive)
3. Priorité 3 (fallback) : `client_nom + client_npa`

### Impact d'une correction sur ces champs

Modifier `client_email`, `client_nom` ou `client_prenom` d'une offre/commande peut **changer la fiche client sur laquelle elle apparaît** dans le dashboard.

Exemples concrets :
- Corriger "Striker" → "Stricker" (faute de frappe, même email) : l'offre reste sur la fiche du même client (matching email continue de fonctionner)
- Corriger email "mister.d@example.com" → "mister.d@new-domain.com" : si une fiche existe avec le nouvel email, l'offre y migre ; sinon, fallback nom+NPA ; sinon, orpheline visuellement
- Corriger nom complet "Mister D" → "Mister C" avec changement d'email : l'offre quitte la fiche Mister D et apparaît sur la fiche Mister C (si elle existe)

**Aucune donnée n'est jamais perdue ou corrompue.** L'offre/commande reste accessible par son numéro DEV-/CMD-. Le déplacement visuel est totalement réversible en remettant l'ancienne valeur.

### Solution v1 retenue : avertissement contextuel (Option 1)

Sur la modal de confirmation du save, **si et seulement si** les champs modifiés incluent `client_email`, `client_nom`, ou `client_prenom`, on affiche un bloc d'info au-dessus du récap habituel :

```
ℹ️ Information

Vous modifiez des champs qui servent à associer cette
[offre/commande] à une fiche client dans le dashboard.

→ Avant : cette [offre/commande] apparaissait sur la fiche
   client correspondant à "<ancienne valeur>"
→ Après : elle apparaîtra sur la fiche client correspondant
   à "<nouvelle valeur>" (si une telle fiche existe)

L'[offre/commande] reste accessible directement par son
numéro [DEV-2026-XXX / CMD-XXXXX].
```

Pas de blocage. Le commercial choisit en connaissance de cause. La correction reste tracée dans `corrections`.

### À voir en v1.5 (noté en dette technique)

Permettre une option "Mettre à jour aussi la fiche client correspondante avec ces nouvelles valeurs" au moment de la correction. Plus complexe (gestion des conflits si une fiche client existe déjà avec les nouvelles valeurs), donc out-of-scope v1.

---


```sql
CREATE TABLE corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Cible de la correction (polymorphe : offres ou commandes)
  entity_type text NOT NULL CHECK (entity_type IN ('offre', 'commande')),
  entity_id uuid NOT NULL,
  entity_slug text NOT NULL,
  entity_numero text NOT NULL,      -- DEV-2026-XXX ou CMD-XXXXX, figé au moment de la correction

  -- Métadonnées
  corrected_at timestamptz NOT NULL DEFAULT now(),
  corrected_by text NOT NULL CHECK (length(trim(corrected_by)) >= 2),

  -- Contenu de la correction
  fields_changed jsonb NOT NULL,    -- { "client_nom": { "old": "Striker", "new": "Stricker" }, ... }
  reason text NOT NULL CHECK (length(trim(reason)) >= 5),

  -- Suivi PDF (utile pour retry si pdf.co échoue)
  pdf_regenerated_at timestamptz    -- NULL = pas encore régénéré, sinon timestamp
);

-- Index pour les requêtes fréquentes
CREATE INDEX idx_corrections_entity ON corrections (entity_type, entity_id, corrected_at DESC);
CREATE INDEX idx_corrections_slug ON corrections (entity_slug);
```

### Notes sur les choix de schéma

- **`entity_slug` et `entity_numero` redondants avec `entity_id`** mais figés au moment de la correction. Garantit qu'un historique reste lisible même si quelque chose change ailleurs.
- **Pas de FK** vers `offres` ou `commandes` car `entity_id` peut pointer vers 2 tables (trade-off classique table polymorphe).
- **`corrected_by` text** plutôt que FK vers une table users : pas d'auth système dans le projet. Texte libre saisi à la volée.
- **`CHECK reason >= 5`** : ceinture-bretelles côté DB en plus de la validation front.
- **`fields_changed` JSONB** : flexible, indexable plus tard si besoin (`fields_changed ? 'client_nom'`).
- **`pdf_regenerated_at`** : si pdf.co timeout, on peut retry sans recréer une correction.

### RLS implémenté en Session 1

- Lecture : tous (SELECT TO public USING true)
- Insertion : tous (INSERT TO public WITH CHECK true)
- Update/Delete : interdits (historique immuable, pas de policy donc bloqué par défaut RLS)

**Schéma final livré (différences avec le brouillon ci-dessus)** :
- `entity_id` est `bigint` et pas `uuid` (la table `offres` utilise `bigint` comme clé primaire — bug découvert et corrigé en Session 1)

---

## 📋 Découpage en sessions / PR

### Session 1 — Table + API CRUD (~ 1h)
**Branche :** `feature/corrections`
**PR à venir :** `#7`

- [ ] Création table `corrections` dans Supabase (SQL Editor)
- [ ] Index `idx_corrections_entity` + `idx_corrections_slug`
- [ ] Policies RLS (lecture / insertion / pas de update / pas de delete)
- [ ] Route `POST /api/corrections`
  - Body : `{ entity_type, entity_id, fields_changed, reason, corrected_by }`
  - Validation stricte des champs autorisés (whitelist côté API)
  - Insertion de la ligne `corrections`
  - Application des changements à l'entité cible (`offres` ou `commandes`)
  - Déclenchement régénération PDF
  - Réponse : `{ correction_id, pdf_regenerated: boolean }`
- [ ] Route `GET /api/corrections?entity_type=...&entity_id=...`
  - Retourne la liste ordonnée par `corrected_at DESC`
- [ ] Tests manuels via REST Client / curl
- [ ] Commit + push + smoke test preview Vercel

### Session 2 — Drawer + bouton "Corriger" (~ 2h)
**PR à venir :** `#8`

- [ ] Composant `<CorrectionDrawer />` partagé (offres + commandes)
  - Liste des ~22 champs corrigibles
  - Champs verrouillés grisés avec tooltip
  - Zone "Modifications en attente" avec diff temps réel
- [ ] Modal `<CorrectionConfirmModal />`
  - Récap des champs modifiés (old → new)
  - Input "Votre nom" (pré-rempli depuis `localStorage["corrections-author"]`)
  - Textarea "Raison de la correction" (min 5 char)
  - Boutons "Annuler" / "Confirmer la correction"
- [ ] Bouton "✏️ Corriger" sur `app/dashboard/[slug]/page.tsx` (offre)
- [ ] Bouton "✏️ Corriger" sur la page dashboard commande équivalente
- [ ] Validation front symétrique à la validation API
- [ ] Tests manuels sur preview Vercel
- [ ] Commit + push + smoke test

### Session 3 — Historique dashboard + PDF offre uniquement (~ 1h)
**PR à venir :** `#9`

Périmètre v1 **limité aux offres en cours** (DEV-XXXX, pas encore converties) :

- [ ] Composant `<CorrectionsHistoryBlock />` (collapsible, masqué par défaut)
- [ ] Intégration sur page dashboard offre + commande (lecture seule)
- [ ] Modification du template PDF offre (`app/print/offre/[slug]/page.tsx`) :
  - Ajout footer discret "Édition mise à jour le JJ.MM.AAAA — version N" si `corrections.count >= 1`
- [ ] Modification du template fiche de travail (`app/print/fiche-travail/[slug]/page.tsx`) :
  - Ajout section détaillée "Historique des corrections" en fin de document
- [ ] **Hors scope v1 (reporté en Session 4)** : régénération du PDF commande (CMD-XXXXX et offres acceptées/converties) — voir section Session 4 ci-dessous
- [ ] Smoke test bout-en-bout sur preview Vercel
- [ ] Merge prod
- [ ] Mise à jour du journal

### Session 4 — Régénération PDF commande avec merge snapshot (à planifier)
**À démarrer après stabilisation Session 3 en prod**

Problématique métier critique soulevée le 2026-05-17 par Thierry :
> Lorsque qu'une offre est confirmée par client/vendeur, la commande est créée et un PDF est généré avec le stock figé tel que juste avant la commande. Si un PDF doit être régénéré pour les commandes avec les corrections, il faut bien réfléchir pour que le PDF corresponde au stock tel qu'avant la commande.

**Exemple concret du piège** :
- T0 : Client commande 2 chaises (stock affiché : 6 pces) → PDF figé "Stock : 6", décrémentation Shopify → stock réel 4
- T1 (3 jours plus tard) : autres ventes + livraisons + réassort → stock réel peut être n'importe quoi (0, 8, 12...)
- T2 : Commercial corrige une faute de frappe dans le nom client
- ⚠️ Si on régénère le PDF avec stock live → PDF afficherait "Stock : 8" (faux et pire, détruit la preuve de ce qui a été vendu au client)

**Solution retenue (architecture)** :
La régénération PDF commande doit utiliser le **snapshot figé** (`data_snapshot` ou `data.lines` figées à T0), avec overlay des **seuls champs cosmétiques corrigés** (whitelist v1 — qui par définition ne touchent pas aux lignes ni au stock).

```
function regenererPDFCommande(commandeSlug) {
  const baseData = offre.data_snapshot ?? offre.data;  // stock T0 figé
  const liveData = offre.data;                          // contient corrections
  const overlayKeys = CORRECTIBLE_FIELDS_V1;            // whitelist cosmétique

  const mergedData = { ...baseData };
  for (const key of overlayKeys) {
    mergedData[key] = liveData[key];
  }
  generatePDF(mergedData);  // lignes/stock = T0, nom/adresse = corrigés
}
```

**Cas limite à traiter** : les commandes anciennes (pré-snapshot, avant Session 7 du chantier brouillons) qui n'ont pas de `data_snapshot`. À voir : migration en masse ou fallback "non régénérable".

**Process métier à implémenter (notes Thierry 2026-05-17)** :

1. **Warning au commercial à chaque correction sur une commande** : modal post-save expliquant que :
   - Le PDF a été régénéré (lignes/stock figés respectés, corrections cosmétiques appliquées)
   - L'équipe doit **réimprimer les documents nécessaires** (commande, fiche de travail, bulletin de livraison, page de garde, fiche bleue archive)
   - L'équipe doit **mettre à jour le dossier papier physique**
   - Checkbox "✅ Je confirme avoir réimprimé les documents et mis à jour le dossier papier" — obligatoire pour fermer la modal

2. **Garder une trace du PDF initial** :
   - À chaque régénération PDF commande, archiver l'ancien PDF dans une colonne `pdf_versions` (jsonb array) ou dans un sous-dossier Supabase Storage `commandes/v1/`, `commandes/v2/`, etc.
   - Sur la page dashboard de la commande, afficher un sélecteur de version PDF : "Contrat original (T0)" vs "Édition actuelle (T+N corrections)"
   - Le PDF "Contrat original" reste **immuable** et téléchargeable comme preuve juridique en cas de litige

3. **Indicateurs visuels** dans le dashboard pour les commandes corrigées :
   - Badge "✏️ Corrigée N fois" à côté du numéro CMD-
   - Lien "Voir versions PDF" qui ouvre l'historique des versions

**Pourquoi reporter en Session 4** :
- Le mécanisme de merge snapshot + corrections est nouveau et nécessite des tests approfondis
- L'archivage des versions PDF nécessite probablement une nouvelle table `pdf_versions` ou colonne JSONB sur `offres`
- Le warning post-save avec confirmation papier est une vraie feature métier à part entière
- Ne pas mélanger ça avec la Session 3 pour ne pas retarder la mise en prod du drawer + historique qui apportent déjà 90% de la valeur

---

## ❓ Questions juridiques / métier reportées (à ne pas oublier pour v2)

Ces points ne bloquent pas la v1 cosmétique mais devront être tranchés
avant d'étendre aux champs sensibles :

1. **Statut comptable des commandes** : dans le système, une `commande` (CMD-XXXXX) équivaut-elle à une **facture émise** (avec numéro de facture séquentiel + obligations TVA) ou est-ce un objet séparé ? Crucial pour décider si on peut modifier librement les commandes ou s'il faut un workflow avenant/note de crédit.

2. **Renvoi PDF client** : quand un PDF a été corrigé, faut-il proposer un renvoi automatique au client (email) ou laisser l'action manuelle ?

3. **Notification manager** : pour les corrections "sensibles" (champs financiers, identité client), faut-il déclencher une notification email/Slack au responsable ? Définir ce qu'est une correction "sensible".

4. **Corrections de quantité sur commandes synchronisées Shopify** : si on corrige une quantité de ligne, faut-il auto-compenser le `stock_movement` ? Que faire si Shopify refuse (stock insuffisant) ?

---

## 🛠️ Méthodologie validée (issue post-S9 chantier brouillons)

1. **Branche dédiée + PR + Preview Vercel + smoke test avant merge** systématiquement
2. **Diagnostic SQL/lecture avant de toucher au code** — on évite de coder à l'aveugle
3. **Format `cherche / remplace par`** par blocs courts à appliquer dans VS Code via Ctrl+F + Ctrl+V
4. **Pas de scripts PowerShell avec `exit 1`** dans le terminal VS Code (ils crashent le shell)
5. **`git --no-pager diff`** pour éviter d'être bloqué dans `less`
6. **Journal mis à jour dans la foulée** pendant que c'est frais en tête

### Workflow git après chaque modification (PowerShell)

```powershell
cd C:\Users\ezefi\jardin-confort-formulaire
git add .
git commit -m "<descriptif>"
git push
```

### Pour tester en local

```powershell
cd C:\Users\ezefi\jardin-confort-formulaire
npm run dev
# → http://localhost:3000
```

---

## 📦 État de départ du chantier

- **Branche :** `main` à `b807d15` (post-PR #6 = fix UI boutons + bouton Transformer)
- **Cf. journal-brouillons.md** pour tout l'historique chantier précédent
- **Dette technique pertinente :**
  - D1 / D2 : `client_numero_client` et création fiche `clients` non synchronisées (non bloquant pour corrections v1, mais bon à savoir : pas d'intégrité référentielle dure entre `offres` et `clients`)

## 📊 État actuel (fin Session 3, avant Session 4)

- **Branche `feature/corrections`** au commit `8807bf9` (à jour sur GitHub)
- **Commits :** `a814137` → `4f2e5f4` → `ef91d42` → `a5d8e55` → `0831e00` → `8807bf9` (6 commits)
- **Sessions 1-3 livrées et testées en local**, en attente de smoke test preview Vercel + merge prod
- **PR à créer :** `feature/corrections` → `main` sur GitHub avec titre "feat(corrections): système de corrections cosmétiques v1 (drawer + traçabilité + historique)"
- **Fichier `test-correction.http`** reste local (untracked, non commité, c'est un fichier de test)
- **Offre cobaye `dev-2026-074-aa0be`** : nettoyée (0 corrections), valeurs restaurées à leur état initial (Stricker Thierry, contact@jardinconfort.ch, complement_nom "employé", À l'emporter)

---

## 📝 Sessions réalisées

### Session 1 — ✅ Livrée le 2026-05-17
**Commits :** `a814137` → `4f2e5f4` → `ef91d42`
**Périmètre livré :**
- Table `corrections` + RLS + 2 index (migration `docs/sql/004-create-corrections-table.sql`)
- `lib/corrections-config.ts` : whitelist 26 champs JSONB + CLIENT_IDENTITY_FIELDS + FLAT_COLUMN_MAP
- `app/api/corrections/route.ts` : POST + GET avec validation stricte, rollback automatique si insert correction échoue (invariant "modif → trace"), synchronisation JSONB ↔ colonnes plates
- Tests via REST Client (test-correction.http) : valide, raison <5, champ hors whitelist, slug inexistant

**Bugs résolus pendant la session :**
- `entity_id` était `uuid` au départ, corrigé en `bigint` (la table `offres` utilise `bigint` comme PK)
- Whitelist initiale utilisait des labels UI (`modePaiement`, `tel1`) au lieu des vraies clés JSONB du formulaire (`paymentMode`, `telephone1`). Alignée après lecture de `app/api/offres/save/route.ts` et SELECT JSONB sur offre réelle.

### Session 2 — ✅ Livrée le 2026-05-17
**Commit :** `a5d8e55`
**Périmètre livré :**
- `components/CorrectionDrawer.tsx` : drawer latéral via createPortal, 4 sections repliables (Document / Facturation / Livraison / Notes), diff temps réel, mémorisation auteur localStorage `corrections-author`
- `components/CorrectionConfirmModal.tsx` : modal confirmation avec nom + raison + avertissement contextuel identité client (Option 1)
- Modifs `app/dashboard/[slug]/page.tsx` : bouton "✏️ Corriger" dans "Suivi commercial", montage du drawer, reload window après success
- Autocomplete navigateur désactivé partout (`autoComplete="new-password"`) en cohérence avec `DraftFormulaire.tsx`

**Tests effectués :**
- 8 corrections successives sur offre cobaye `dev-2026-074-aa0be` : tous champs validés (notes, complement_nom, email, mode livraison, rue/numéro, modes de paiement)
- Synchro JSONB ↔ colonne plate vérifiée pour `notes_internes` et `client_complement_nom` (les 2 mis à jour des deux côtés)
- Avertissement bleu sky bien affiché quand modification d'email

### Session 3 — ✅ Livrée le 2026-05-18
**Commits :** `0831e00` → `8807bf9`
**Périmètre livré :**
- `components/CorrectionsHistoryBlock.tsx` : section "📝 Historique des corrections" sur dashboard, **ouverte par défaut** (changement décidé en fin de session, pour visibilité immédiate), affichage version N+1 (doc initial = v1)
- Intégration sur `app/dashboard/[slug]/page.tsx` entre "Suivi commercial" et "Modèle d'email"
- Modifs `app/print/offre/[slug]/page.tsx` : state `correctionsCount` + `lastCorrectionAt`, fetch parallèle `/api/corrections`, footer italique gris "Édition mise à jour le JJ.MM.AAAA — version N" sous Facebook/Instagram
- Modifs `app/print/fiche-travail/[slug]/page.tsx` : bloc rouge "⚠ Document corrigé · N corrections" placé **en fin de document** (pas en haut), format compact 1-ligne par correction avec séparateurs `/` entre zones et `·` entre champs multi, page-break autorisé sur le bloc complet mais pas sur header ni items individuels

**Bugs résolus pendant la session :**
- Fiche de travail ne chargeait pas les corrections : lecture de state `typeDocument` dans closure async React où le setState n'avait pas encore été appliqué. Fix : re-fetch local de `/api/offres/${slug}` au lieu de lire le state.
- Avec 8+ corrections en test, bloc rouge prenait une page A4 entière en haut. Fix : format compact + déplacement en fin de document + page-break autorisé.

**Décisions UX prises en cours de session :**
- Historique dashboard ouvert par défaut (au lieu de masqué) pour visibilité immédiate
- Bloc rouge fiche travail placé en FIN et pas en haut, avec page-break autorisé pour éviter qu'il bascule entièrement sur une page suivante non lue
- PDF commande **non régénéré** en v1 (reporté Session 4 pour respecter le stock figé T0)

---

## 🐛 Dette technique du chantier

_(à remplir au fur et à mesure)_

| # | Sujet | Origine | Priorité | Statut |
|---|---|---|---|---|
| C1 | Permettre l'option "synchroniser aussi la fiche client" au moment d'une correction de `client_email`, `client_nom` ou `client_prenom`. Gestion des conflits si une fiche client existe déjà avec les nouvelles valeurs. | Cadrage v1 (2026-05-17) | Moyenne | Ouvert (v1.5) |
