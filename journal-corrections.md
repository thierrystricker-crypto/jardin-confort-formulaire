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

### RLS (à définir en Session 1)

- Lecture : tous les utilisateurs authentifiés
- Insertion : tous les utilisateurs authentifiés
- Update/Delete : interdits (historique immuable)

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

### Session 3 — Historique + finitions PDF (~ 1h)
**PR à venir :** `#9`

- [ ] Composant `<CorrectionsHistoryBlock />` (collapsible, masqué par défaut)
- [ ] Intégration sur page dashboard offre + commande
- [ ] Modification du template PDF principal (offre/commande) :
  - Ajout footer "Édition mise à jour le JJ.MM.AAAA — version N" si `corrections.count >= 1`
- [ ] Modification du template PDF fiche de travail :
  - Ajout section détaillée "Historique des corrections" en fin de document
- [ ] Smoke test bout-en-bout sur preview Vercel
- [ ] Merge prod
- [ ] Mise à jour du journal

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

---

## 📝 Sessions réalisées

_(à remplir au fur et à mesure)_

### Session 1 — non démarrée
### Session 2 — non démarrée
### Session 3 — non démarrée

---

## 🐛 Dette technique du chantier

_(à remplir au fur et à mesure)_

| # | Sujet | Origine | Priorité | Statut |
|---|---|---|---|---|
| C1 | Permettre l'option "synchroniser aussi la fiche client" au moment d'une correction de `client_email`, `client_nom` ou `client_prenom`. Gestion des conflits si une fiche client existe déjà avec les nouvelles valeurs. | Cadrage v1 (2026-05-17) | Moyenne | Ouvert (v1.5) |