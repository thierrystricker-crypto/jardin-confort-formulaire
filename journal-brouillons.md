# Journal — Chantier "Brouillons" (drafts)

> **Pour reprendre dans un nouveau chat Claude :** colle ce fichier en première
> message. Il contient tout le contexte nécessaire pour reprendre où on s'est
> arrêté.

---

## 🎯 Contexte du projet

**Projet :** `jardin-confort-formulaire`
**Stack :** Next.js (App Router) + Supabase + Shopify, hébergé sur Vercel
**Chemin local :** `C:\Users\ezefi\jardin-confort-formulaire`
**Branche de travail :** `feature/brouillons`

**Workflow git (PowerShell) après chaque modification :**
```powershell
cd C:\Users\ezefi\jardin-confort-formulaire
git add .
git commit -m "<message>"
git push
```

---

## 🐛 Problème métier à résoudre

Aujourd'hui, dès qu'une offre est enregistrée, elle est **immuable**.
Conséquence : pour corriger la moindre faute de frappe ou ajuster un prix, le
commercial doit créer une nouvelle offre avec un nouveau numéro. La base
contient des doublons quasi-identiques et les statistiques sont faussées.

**Solution retenue :** introduire une notion de **brouillon (draft)** modifiable
à volonté, transformable en offre définitive par action explicite du commercial.

---

## 📋 Modèle métier cible

### Brouillon (`drafts`)
- Créé via "Nouveau" ou copie d'une offre/brouillon existant
- **Modifiable indéfiniment** par le commercial
- Numérotation `DRA-001`, `DRA-002`...
- **Aperçu** filigrané "BROUILLON" (page print Shopify dynamique, jamais de PDF généré)
- **Template** = devis actuel sans bloc signature + sans lien de validation
- **Pas de lien public partageable**
- Listé dans un onglet séparé "Brouillons" sur le dashboard (caché par défaut)

### Offre (`offres`)
- Créée uniquement par action "Transformer en offre" depuis un brouillon
- **Immuable** dès la transformation (comportement actuel)
- Numéro d'offre définitif attribué à ce moment
- Lien public de signature
- Aperçu/PDF sans filigrane

### Cycle de vie d'un brouillon
```
Création → modifications libres → "Transformer en offre" → Offre figée
                                                          ↓
                                              Brouillon archivé MAIS conservé
                                              indéfiniment (consultable +
                                              duplicable pour variantes)
```

### Schéma complet des flux entre brouillons et offres

Ce schéma a été défini en fin de Session 3 pour clarifier tous les cas d'usage.
Il consolide les décisions actées sur la duplication, la transformation et la
conservation indéfinie.

```
┌────────────────────────────────────────────────────────────────────┐
│                                                                     │
│   CRÉATION VIERGE                                                   │
│                                                                     │
│   /drafts/nouveau ──────────────────▶ DRA-005                       │
│                                                                     │
└────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────┐
│                                                                     │
│   DEPUIS UN BROUILLON                                               │
│                                                                     │
│   DRA-005 ──── Modifier ──────────▶ DRA-005 (modifié)               │
│       │                                                             │
│       ├── 📋 Dupliquer en brouillon ─▶ DRA-006 (copie indép)        │
│       │                                                             │
│       └── 🔄 Transformer en offre ─▶ DEV-2026-047 (figée)           │
│                                       (DRA-005 archivé mais         │
│                                        toujours consultable +       │
│                                        duplicable)                  │
│                                                                     │
└────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────┐
│                                                                     │
│   DEPUIS UNE OFFRE                                                  │
│                                                                     │
│   DEV-2026-047 ──── Modifier ──────▶ ❌ Impossible (immuable)       │
│        │                                                            │
│        ├── 📋 Copier en brouillon ──▶ DRA-007 (éditable)           │
│        │                                                            │
│        └── 📄 Copier en offre ──────▶ DEV-2026-048 (figée direct)  │
│                                                                     │
└────────────────────────────────────────────────────────────────────┘
```

**Traçabilité bidirectionnelle :**
- Depuis DRA-005 : `transformed_into_offre_slug` pointe vers DEV-2026-047
- Depuis DEV-2026-047 : `data.fromDraftSlug` pointe vers DRA-005 (à ajouter Session 5)
- Depuis DRA-007 : `data.copiedFromOffreSlug` pointe vers DEV-2026-047 (à ajouter Session 8)

**Cas d'usage "3 variantes rouge/vert/noir" — workflow complet :**

```
1. Créer DRA-005 → remplir version rouge complète
2. Dupliquer DRA-005 → DRA-006 → transformer → DEV-2026-047 (rouge)
3. Dupliquer DRA-005 → DRA-007 → modifier rouge→vert → transformer → DEV-2026-048 (vert)
4. Dupliquer DRA-005 → DRA-008 → modifier rouge→noir → transformer → DEV-2026-049 (noir)

Résultat :
- DRA-005 reste comme "modèle racine rouge" jamais transformé directement
- DRA-006, DRA-007, DRA-008 conservés comme historique de chaque variante
- 3 offres distinctes, chacune avec son brouillon source
- Tout reste consultable indéfiniment
```

**Alternative depuis l'offre (Session 8) :**

```
1. DEV-2026-047 (rouge) déjà créée
2. Depuis le dashboard de DEV-2026-047 : "📋 Copier en nouveau brouillon" → DRA-009
3. Modifier rouge→vert dans DRA-009 → transformer → DEV-2026-050 (vert)
4. Re-cliquer "Copier en nouveau brouillon" depuis DEV-2026-047 → DRA-010
5. Modifier rouge→noir dans DRA-010 → transformer → DEV-2026-051 (noir)
```

Les deux workflows coexistent — le commercial choisit selon le contexte.

---

## ✅ Décisions validées

| Décision | Choix retenu |
|---|---|
| Stockage | Nouvelle table `drafts` |
| Après transformation | **Conservé indéfiniment** (pas de purge auto à 30j) — un brouillon transformé reste consultable et duplicable |
| Filtre dashboard | "Masquer brouillons transformés" (filtre d'affichage, pas de purge) |
| Numérotation | `DRA-XXX` |
| Dashboard | Onglet "Brouillons" caché par défaut |
| Confirmation transformation | Modal avec récap + cases à cocher |
| Mode de transformation | **Scénario A direct serveur** : POST `/api/drafts/[slug]/transformer` → crée l'offre + archive le brouillon → redirection auto vers `/dashboard/[offre-slug]`. Pas de retour par le formulaire `/offres/nouveau`. |
| Transformation multiple du même brouillon | **Non** — un brouillon = 1 transformation max. Pour générer plusieurs variantes : dupliquer d'abord, transformer ensuite la copie. |
| Bouton "📋 Dupliquer en nouveau brouillon" | Disponible depuis tout brouillon (transformé ou pas) — la source reste intacte |
| Bouton "📋 Copier offre → nouveau brouillon" | Ajouté en Session 8, à côté de l'existant "Copier en nouvelle offre" |
| Bouton "📄 Copier offre → nouvelle offre" | Conservé tel quel (comportement actuel) |
| Flag `is_template` | **Abandonné** — devenu inutile avec la conservation indéfinie des brouillons transformés |
| Copie depuis offre signée | Crée un brouillon (Session 8) OU une offre directe (existant) — au choix du commercial |
| Migration offres existantes | **Aucune** — les ~50 offres actuelles restent valides |
| Aperçu brouillon | Page print dynamique (Shopify), **pas de PDF** |
| Template brouillon | Devis actuel + filigrane BROUILLON, sans signature, sans lien validation |
| Lien public de signature | **Bloqué** sur les brouillons (ne doit JAMAIS s'afficher) |
| Architecture pages drafts | Composant partagé `_components/DraftFormulaire.tsx` réutilisé par `/drafts/nouveau` et `/drafts/[slug]/editer` |
| Sauvegarde brouillon | Manuelle + auto-save 2 min (si nom+email+commercial remplis) |
| URL d'édition | Route dynamique `/drafts/[slug]/editer` (pas de query param) |

---

## 🗂️ Schéma SQL prévu (Session 1)

```sql
create table drafts (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,                    -- DRA-001, DRA-002...
  numero_draft int not null,

  -- Identique à offres
  client_nom text,
  client_prenom text,
  client_societe text,
  client_email text,
  client_tel1 text,
  client_rue text,
  client_npa text,
  client_ville text,
  commercial text,
  data jsonb,

  -- Méta brouillon
  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  -- Statut de transformation
  transformed_at timestamptz,
  transformed_into_offre_slug text,
  archived boolean default false
);

create index drafts_archived_idx on drafts(archived);
create index drafts_transformed_at_idx on drafts(transformed_at);
create index drafts_commercial_idx on drafts(commercial);

create sequence drafts_numero_seq start 1;
```

**RLS Supabase :** à définir selon la politique actuelle de la table `offres`
(probablement même politique : authentifié = lecture/écriture).

---

## 🗓️ Découpage en 9 sessions

> À chaque fin de session, mettre à jour la colonne "État" ci-dessous et noter
> les éventuels écarts dans la section "Notes par session" en bas du fichier.

| # | Session | Risque | État | Date | Branche/commit |
|---|---|---|---|---|---|
| 1 | Préparation : backup Supabase + branche git + création table `drafts` | Faible | ✅ Terminée | 2026-05-14 | 11b4c36 |
| 2 | API `/api/drafts` (POST, GET, GET[slug], PUT[slug], DELETE[slug]) | Moyen | ✅ Terminée | 2026-05-14 | 268b2fb |
| 3 | Page `/drafts/nouveau` + `/drafts/[slug]/editer` + composant partagé | Moyen | ✅ Terminée | 2026-05-14 | e72e2bc |
| 4 | Page `/dashboard/draft/[slug]` (vue brouillon + bouton "Modifier") | Moyen | ☐ À faire | | |
| 5 | Modal "Transformer en offre" + route `/api/drafts/[slug]/transformer` | **Élevé** | ☐ À faire | | |
| 6 | Onglet "Brouillons" sur dashboard + filtre archivés | Faible | ☐ À faire | | |
| 7 | Aperçu print : filigrane BROUILLON, sans signature, sans lien validation | Moyen | ☐ À faire | | |
| 8 | Boutons "Copier en brouillon" + "Copier en offre" depuis dashboard offre | Faible | ☐ À faire | | |
| 9 | Tests end-to-end + merge `feature/brouillons` → `main` + déploiement prod | **Élevé** | ☐ À faire | | |

---

## 📝 Détail de chaque session

### Session 1 — Préparation et schéma SQL

**Objectif :** mettre en place l'infrastructure sans toucher au code applicatif.

**À faire :**
1. Snapshot Supabase (Dashboard Supabase → Database → Backups, ou export SQL via `pg_dump`)
2. Créer branche : `git checkout -b feature/brouillons`
3. Exécuter le SQL de création de table `drafts` dans Supabase
4. Vérifier RLS active et cohérente avec la table `offres`
5. Tester insertion manuelle d'une ligne de test
6. Commit initial (seul le `journal.md` change côté code)

**Fichiers attendus :**
- `journal-brouillons.md` (à la racine ou dans `docs/`)
- Migration SQL (à conserver dans `supabase/migrations/` si tu utilises Supabase CLI, sinon dans `docs/sql/`)

**Critère de succès :** la table `drafts` existe en base, vide, accessible via SQL.

---

### Session 2 — API `/api/drafts`

**Objectif :** créer les routes API CRUD pour les brouillons.

**Routes à créer :**
- `POST /api/drafts` : créer un brouillon (vide ou pré-rempli depuis copie)
- `GET /api/drafts` : lister les brouillons (filtre `archived=false` par défaut)
- `GET /api/drafts/[slug]` : charger un brouillon
- `PUT /api/drafts/[slug]` : mettre à jour un brouillon
- `DELETE /api/drafts/[slug]` : supprimer un brouillon (avant transformation)

**Génération du slug `DRA-XXX` :** utiliser `nextval('drafts_numero_seq')` puis
formater en `DRA-${numero.toString().padStart(3, '0')}`.

**Fichiers à fournir au début de la session :**
- L'API existante de création d'offre (`/api/offres/...`) pour reprendre la même structure
- Le code Supabase client utilisé dans le projet (probablement `lib/supabase.ts`)

**Critère de succès :** tester chaque endpoint via Postman/curl, vérifier
qu'une ligne se crée bien dans `drafts`.

---

### Session 3 — Pages `/drafts/nouveau` + `/drafts/[slug]/editer`

**Objectif :** permettre la création et l'édition d'un brouillon via formulaire.

**Stratégie :** cloner `/offres/nouveau/page.tsx` en composant partagé, puis
adapter :
- `saveToSupabase` → `saveDraft` qui appelle `/api/drafts` (POST) ou `/api/drafts/[slug]` (PUT)
- Pas de bouton "Envoyer pour signature"
- Bouton "Transformer en offre" (session 5)
- Au premier save, redirection silencieuse vers `/drafts/[slug]/editer`

**Mode édition :** la même page doit pouvoir charger un brouillon existant via
route dynamique `/drafts/[slug]/editer`.

**Décision prise en début de session :** route dynamique `/drafts/[slug]/editer`
+ refactor en composant partagé `_components/DraftFormulaire.tsx`.

**Critère de succès :** créer un brouillon depuis zéro, le sauvegarder, le
rouvrir, le modifier, le re-sauvegarder.

---

### Session 4 — Page `/dashboard/draft/[slug]`

**Objectif :** vue lecture-seule d'un brouillon, avec actions.

**Différences avec `/dashboard/[slug]` actuel :**
- Bouton "✏️ Modifier" (renvoie vers `/drafts/[slug]/editer` — Session 3)
- Bouton "📋 Dupliquer en nouveau brouillon" : appelle `POST /api/drafts` avec
  le `data` du brouillon courant. Source intacte, copie indépendante créée,
  redirection vers `/drafts/[nouveau-slug]/editer`. Disponible **même** sur les
  brouillons déjà transformés (pour générer des variantes).
- Bouton "🔄 Transformer en offre" (déclenche modal Session 5) — désactivé si
  le brouillon est déjà transformé (`transformed_at !== null`)
- Bouton "👁 Aperçu" (page print avec filigrane BROUILLON — Session 7)
- Bouton "🗑 Supprimer" : possible uniquement si non transformé (route existante
  côté API depuis la Session 2 ; le serveur renvoie 409 si transformé)
- **PAS** de bouton "Envoyer pour signature"
- **PAS** de bouton "Convertir en commande"
- **PAS** de lien public partageable
- Bandeau visuel "BROUILLON" en haut de page
- Si `transformed_at !== null` : bandeau supplémentaire orange "Transformé en
  offre [DEV-2026-XXX →]" avec lien vers `/dashboard/[offre-slug]`

**Critère de succès :** afficher un brouillon en lecture seule, lancer
modification et retour, dupliquer (avec ou sans transformation préalable).

---

### Session 5 — Transformation brouillon → offre (CRITIQUE)

**Objectif :** convertir un brouillon en offre définitive — **scénario A direct
serveur** (acté en fin de Session 3). Pas de retour par `/offres/nouveau`.

**Modal de confirmation :**
- Récap : client, montant total, nombre de lignes, commercial
- Choix Offre ou Commande (récupéré depuis `data.formType` mais surchargeable
  au dernier moment dans la modal)
- Cases à cocher obligatoires :
  - [ ] J'ai vérifié les coordonnées client
  - [ ] J'ai vérifié les prix et quantités
  - [ ] J'ai vérifié les remarques et délais
  - [ ] Je confirme que cette transformation est définitive et que l'offre
        ne sera plus modifiable
- Bouton "Transformer" désactivé tant que toutes cases ne sont pas cochées

**Route `POST /api/drafts/[slug]/transformer` :**
1. Charger le brouillon
2. **Refuser (409)** si `transformed_at !== null` : un brouillon ne peut être
   transformé qu'une seule fois. Pour générer une variante, le commercial doit
   d'abord dupliquer le brouillon (Session 4).
3. Générer numéro d'offre via la séquence existante (à identifier en début de
   session — probablement `next_dev_numero` ou équivalent côté `/api/offres/save`)
4. INSERT dans `offres` avec toutes les données du brouillon
   - Ajouter `data.fromDraftSlug = <slug du brouillon>` pour traçabilité inverse
5. UPDATE du brouillon : `transformed_at = now()`, `transformed_into_offre_slug = ...`,
   `archived = true`
   - **NB :** `archived = true` mais le brouillon reste en base indéfiniment
     (consultable et duplicable). Pas de purge automatique.
6. Retourner `{ offreSlug }` pour redirection
7. Wrap dans une transaction Supabase (ou rollback manuel si échec)

**Redirection :** après succès, rediriger vers `/dashboard/[offreSlug]` (la
nouvelle offre).

**⚠️ Risque :** une transformation partielle (brouillon archivé mais offre non
créée) corromprait l'état. Il **faut** une transaction ou un rollback explicite.

**Critère de succès :** transformer un brouillon, vérifier qu'une offre est
créée avec le bon numéro, que le brouillon est marqué `archived=true` mais
toujours consultable, que `transformed_into_offre_slug` pointe correctement, et
que l'utilisateur arrive sur la page de la nouvelle offre.

---

### Session 6 — Onglet "Brouillons" dashboard

**Objectif :** intégrer les brouillons dans le dashboard sans gêner.

**Modifications dashboard :**
- Nouvel onglet "Brouillons" caché par défaut (par exemple toggle/checkbox "Afficher les brouillons" ou onglet séparé selon l'UI actuelle)
- Compteur de brouillons actifs (non archivés)
- Filtre "Masquer les brouillons transformés" (coché par défaut → cache ceux
  avec `archived=true`). **Important :** ce filtre est purement visuel
  (affichage), pas un mécanisme de purge — les brouillons transformés restent
  en base indéfiniment et restent duplicables même quand masqués (le commercial
  doit décocher le filtre pour les retrouver).
- Tri par `updated_at DESC` (les plus récemment modifiés en haut)

**Critère de succès :** l'onglet apparaît, liste les brouillons, le filtre
fonctionne, les brouillons transformés sont retrouvables en décochant le filtre.

---

### Session 7 — Aperçu print avec filigrane BROUILLON

**Objectif :** une vue d'aperçu pour brouillons, distincte de celle des offres.

**Approche :** réutiliser le composant d'aperçu existant en lui passant une
prop `isDraft: boolean` qui :
- Ajoute le filigrane "BROUILLON" en diagonale sur chaque page
- Masque le bloc signature
- Masque le lien de validation
- Affiche éventuellement un bandeau "Document non contractuel"

**Fichiers à fournir au début de la session :**
- Le composant d'aperçu actuel (probablement `app/offres/[slug]/print` ou similaire)
- Le composant filigrane DRAFT actuel utilisé pour les aperçus offres non signées

**Important pour Session 7 :** actuellement le bouton "👁 Aperçu" du formulaire
brouillon pointe vers `/print/offre` (stub temporaire — pas de filigrane). À
remplacer par `/drafts/[slug]/print` avec template dédié.

**Critère de succès :** ouvrir `/drafts/DRA-001/print` affiche un PDF-like avec
filigrane permanent, sans bloc signature.

---

### Session 8 — Boutons de copie depuis une offre

**Objectif :** depuis le dashboard d'une offre (`/dashboard/[offre-slug]`),
permettre **deux types de copies** côte à côte :

1. **"📄 Copier en nouvelle offre"** (existant, conservé tel quel) :
   - Crée directement une nouvelle offre figée
   - Workflow rapide pour les variantes simples sans réflexion
   - Comportement actuel inchangé (mais à dépoussiérer du mécanisme localStorage
     hérité — voir plus bas)

2. **"📋 Copier en nouveau brouillon"** (nouveau) :
   - Appel `POST /api/drafts` avec le payload de l'offre source
   - Ajouter `data.copiedFromOffreSlug = <slug de l'offre source>` pour
     traçabilité
   - Redirection vers `/drafts/[nouveau-slug]/editer` après création
   - Permet au commercial de modifier tranquillement avant de transformer en
     offre, parfait pour les variantes qui demandent de la réflexion

**Refonte du bouton existant :**
- Supprimer le mécanisme `localStorage` + `?from_copy=1` pour les deux flux
  (devenu obsolète maintenant qu'on a des routes API)
- Le bouton "Copier en nouvelle offre" appelle directement `POST /api/offres/save`
  côté serveur
- Le bouton "Copier en nouveau brouillon" appelle `POST /api/drafts`

**Variante alternative pour ouverture dans nouvel onglet :** chaque bouton ouvre
une route serveur qui crée + redirige (`/drafts/copier-depuis/[offreSlug]` ou
`/offres/copier-depuis/[offreSlug]`). Permet le clic milieu / `Open in new tab`.

**Critère de succès :** depuis une offre existante, les deux boutons sont
visibles. Le bouton "brouillon" crée un DRA-XXX éditable. Le bouton "offre"
crée directement une DEV-2026-XXX. Les `ambianceImages` sont correctement
copiées dans les deux cas (régression du bug pré-chantier).

---

### Session 9 — Tests + déploiement prod

**Objectif :** valider l'ensemble et déployer.

**Tests end-to-end manuels (checklist) :**
- [ ] Création d'un brouillon depuis zéro
- [ ] Modification d'un brouillon
- [ ] Suppression d'un brouillon non transformé
- [ ] Copie d'une offre existante → brouillon
- [ ] Copie d'un brouillon existant → brouillon
- [ ] Aperçu print d'un brouillon (filigrane, pas de signature)
- [ ] Tentative d'accès au lien public d'un brouillon → bloqué
- [ ] Transformation brouillon → offre (toutes cases cochées)
- [ ] Transformation refusée si cases non cochées
- [ ] Vérification : offre créée avec bon numéro, brouillon archivé
- [ ] Filtre "Masquer brouillons transformés" fonctionne
- [ ] Onglet "Brouillons" caché par défaut
- [ ] Les 50 offres existantes sont toujours accessibles et fonctionnelles

**Déploiement :**
1. Merge `feature/brouillons` → `main` via PR
2. Vercel déploie automatiquement
3. Vérification post-déploiement sur la prod (création d'un brouillon test)
4. Optionnel : suppression du brouillon test

**Rollback prévu :** si problème majeur, `git revert` du merge et redéploiement.
La table `drafts` peut rester en base (vide, sans impact).

---

## 🗒️ Notes par session

> À remplir au fur et à mesure : écarts au plan, décisions prises en cours de
> route, problèmes rencontrés, fichiers modifiés.

### Session 1 — Terminée le 2026-05-14

**Réalisé :**
- Branche `feature/brouillons` créée et poussée
- Audit Supabase Storage effectué : 4 buckets identifiés (brand-logos, factures, pdfs, fiche-travail-pdf). Risques R1/R2/R3 identifiés et assumés (voir section "Audit Supabase Storage")
- Architecture auth confirmée : `lib/supabase.ts` exporte `supabase` (anon) et `supabaseAdmin` (service_role). Les routes API utilisent `supabaseAdmin` pour bypass RLS
- Table `drafts` créée avec structure alignée sur `offres` (bigint id, RLS off, toutes les colonnes pertinentes)
- Trigger `updated_at` automatique testé et fonctionnel
- SQL versionné dans `docs/sql/001-create-drafts.sql`

**Écarts au plan initial :**
- La table `drafts` initialement créée avec une structure minimale (UUID, RLS on, peu de colonnes) a été DROP et recréée avec la structure complète. Sans impact car aucune donnée.
- RLS active sur `drafts` par défaut → désactivée pour cohérence avec `offres`.

**Notes pour Session 2 :**
- Pour la génération du numéro de brouillon, s'inspirer de `app/api/offres/save/route.ts` (ligne 74 : `numero_offre: numeroOffre`)
- Le client à utiliser dans les routes API : `supabaseAdmin` depuis `lib/supabase.ts`
- Patterns existants à étudier : `app/api/offres/[slug]/notes/route.ts`, `app/api/offres/[slug]/statut/route.ts` pour la structure des routes

### Session 2 — Terminée le 2026-05-14

**Réalisé :**
- 5 routes API CRUD créées dans `app/api/drafts/` :
  - `POST /api/drafts` (création) — commit `f3bf118`
  - `GET /api/drafts` (liste avec filtres archived/commercial) — commit `eeefb3b`
  - `GET /api/drafts/[slug]` (détail complet avec data JSONB) — commit `521946c`
  - `PUT /api/drafts/[slug]` (update avec garde transformation 409) — commit `8555d6c`
  - `DELETE /api/drafts/[slug]` (hard delete avec garde transformation 409) — commit `268b2fb`
- RPC SQL `next_dra_numero()` créée dans Supabase pour générer `DRA-001`, `DRA-002`, etc.
  Versionnée dans `docs/sql/002-rpc-next-dra-numero.sql`. Utilise `nextval('drafts_numero_seq')`
  (choix de la séquence plutôt que `COUNT(*)` comme `next_dev_numero`, pour rester stable
  après purge automatique des brouillons archivés)
- Tous les endpoints testés en local : création vide, création pré-remplie, listing avec
  3 modes de filtre archived (false/true/all), filtre commercial, lecture détaillée,
  modification, suppression, cas d'erreur 404 et 409

**Écarts au plan initial :**
- `.env.local` était **incomplet** au début de la session : il manquait `NEXT_PUBLIC_SUPABASE_URL`
  et `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Probablement jamais synchronisé avec les vars Vercel
  (qui contient ces valeurs côté prod, sinon offres ne marcherait pas). Ajoutées en local
  pour pouvoir tester via `npm run dev`.
- `lib/supabase.ts` lisait `SUPABASE_SECRET_KEY` mais `.env.local` (et Vercel) utilisent
  `SUPABASE_SERVICE_ROLE_KEY` (nom standard Supabase). Ajout d'un fallback rétrocompatible :
  `process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY`.
- `computeTotals(data)` plante si `data.lines` ou `data.enabledServices` sont `undefined`.
  Le POST et le PUT court-circuitent l'appel quand `data.lines` est vide ou absent :
  totaux à 0 par défaut. Le code de `lib/jc-print-types.ts` n'a pas été touché (utilisé
  aussi par offres en prod).
- Slug brouillon adopte le **même pattern que les offres** : `dra-001-x7k2m` (lowercase
  + token aléatoire 5 chars). Le journal initial évoquait `DRA-001` simple, mais le risque
  d'énumération d'URLs (même sans lien public) justifiait le token, par cohérence avec
  les offres.
- `numero_affiche` en UPPERCASE (`DRA-001`) distinct du slug en lowercase (`dra-001-...`).
  Décision : le slug est l'identifiant URL, `numero_affiche` est ce qui est montré à l'UI.

**Sécurité à traiter avant déploiement prod (Session 9) :**
- ⚠️ La `SUPABASE_SERVICE_ROLE_KEY` complète a été collée dans un chat de débogage
  pendant cette session. **À révoquer + régénérer** avant la Session 9 :
  1. Supabase Dashboard → Settings → API → Reset service_role secret
  2. Mettre à jour la variable dans Vercel (Settings → Environment Variables)
  3. Mettre à jour `.env.local` en local
  4. Redéploiement automatique Vercel après update env vars

**Notes pour Session 3 :**
- Les 5 routes API sont prêtes pour être consommées par la page `/drafts/nouveau` qu'on va
  cloner depuis `/offres/nouveau`. Le formulaire devra appeler :
  - `POST /api/drafts` pour la création (avec body `{ data: {...} }`)
  - `PUT /api/drafts/[slug]` pour les sauvegardes ultérieures (auto-save éventuel)
  - `GET /api/drafts/[slug]` pour le chargement initial en mode édition
- L'URL d'édition d'un brouillon est `/drafts/[slug]/editer` (cf. `editUrl` renvoyé par
  le POST). À implémenter en Session 3 ou 4 selon le découpage.
- Le retour du POST contient `dashboardUrl` qui pointe vers `/dashboard/draft/[slug]`
  (Session 4). Pour l'instant cette URL n'existe pas encore.
- Le tri du listing `GET /api/drafts` est par `updated_at DESC`. À chaque PUT, le trigger
  SQL met à jour `updated_at` automatiquement, donc le brouillon récemment modifié
  remonte naturellement en haut du dashboard (Session 6).

**État de la base après Session 2 :**
- 1 brouillon DRA-002 (Dupont/Jean/Thierry/TEST-001) reste en base après les tests.
  Peut être supprimé via `DELETE /api/drafts/dra-002-mzu6w` ou conservé pour tester
  Session 3.
- Séquences `drafts_id_seq` et `drafts_numero_seq` sont à 2 (prochain brouillon = `DRA-003`,
  `id=3`).
- Pour repartir totalement propre avant Session 3 :
```sql
  DELETE FROM drafts;
  ALTER SEQUENCE drafts_id_seq RESTART WITH 1;
  ALTER SEQUENCE drafts_numero_seq RESTART WITH 1;
```

### Session 3 — Terminée le 2026-05-14 (commit `e72e2bc`)

**Réalisé :**
- Architecture refactor propre : composant partagé `DraftFormulaire` + 2 pages fines
  - `app/drafts/_components/DraftFormulaire.tsx` (~3750 lignes) : toute la logique
    métier, accepte un prop optionnel `initialSlug`
  - `app/drafts/nouveau/page.tsx` (14 lignes) : mode création, rend `<DraftFormulaire />`
  - `app/drafts/[slug]/editer/page.tsx` (20 lignes) : mode édition, extrait le slug
    de la route et le passe en prop
- Sauvegarde brouillon :
  - Bouton manuel "💾 Créer le brouillon" / "💾 Enregistrer" selon le mode
  - Auto-save toutes les 2 minutes si `isDirty`, conditionné à
    nom + email + commercial remplis (pas de brouillons vides en base)
  - Pastille de statut (vert/orange/rouge) + texte "💾 Enregistré il y a Xs"
  - Filet de sécurité `beforeunload` natif navigateur si modifs non sauvées
- Mode édition :
  - Au montage, fetch `GET /api/drafts/[slug]` et hydratation des ~50 champs
  - 5 états de chargement gérés : `loading` / `ready` / `not_found` / `transformed` / `error`
  - Bandeau dédié pour chaque cas d'erreur (rouge pour not_found, orange pour transformed
    avec lien vers l'offre cible, etc.)
  - Save manuel + auto-save désactivés tant que `initialLoadStatus !== "ready"`
- Adaptations spécifiques brouillon :
  - Titre dynamique : "Nouveau brouillon — Offre" / "Brouillon DRA-XXX — Commande"
  - Sélecteur Offre/Commande conservé (un brouillon peut devenir une offre OU
    directement une commande)
  - Suppression de la bannière "URL publique" (n'a pas de sens pour un brouillon)
  - Bouton "🔄 Nouveau brouillon" reset complet + navigation vers `/drafts/nouveau`
  - `STORAGE_KEY` localStorage isolée (`jc-draft-v1-local`) pour ne pas écraser
    le brouillon local des offres
  - Création client en base **uniquement** au save manuel (éviter les clients
    fantômes pour des brouillons abandonnés)
  - `MediaLinePicker` réutilisé depuis `app/offres/nouveau/MediaLinePicker` —
    pas de duplication
- Tests validés en local (utilisateur) :
  - Création d'un brouillon DRA-003 depuis zéro → bascule auto vers `/drafts/dra-003-xxxxx/editer`
  - Édition immédiate après création + persistance après F5
  - 404 propre sur slug inexistant avec bouton "+ Nouveau brouillon"
  - Rechargement d'un brouillon existant avec hydratation complète des champs

**Écarts au plan initial :**
- Choix d'architecture : refactor en composant partagé **après** validation du clone,
  pas avant. Approche "marcher avant de courir" qui a permis de valider le flow
  bout en bout (création + persistance) avant de toucher à la structure.
- L'option discutée "vue lecture-seule + bouton Modifier" a été reportée à la
  Session 4 (`/dashboard/draft/[slug]`). La page `/drafts/[slug]/editer` est
  directement éditable, conformément à la sémantique des URLs (`/drafts/*` pour
  éditer, `/dashboard/*` pour consulter).
- Le bouton "👁 Aperçu" pointe encore vers `/print/offre` en attendant la Session 7
  (filigrane BROUILLON). Pour l'instant l'aperçu d'un brouillon est donc visuellement
  identique à celui d'une offre — à corriger en Session 7.

**Pièges techniques rencontrés (à retenir pour les sessions suivantes) :**
- **PowerShell + crochets `[ ]`** : les crochets sont interprétés comme wildcards.
  `Remove-Item -Recurse -Force app\drafts\[slug]\editer` échoue **silencieusement**.
  Solution : `Remove-Item -Recurse -Force -LiteralPath "app\drafts\[slug]\editer"`
  ou passer par l'explorateur Windows.
- **Double présence du segment "drafts"** : il y a `app/api/drafts/` (routes API)
  ET `app/drafts/` (pages). Risque de confusion lors du collage de fichiers.
  Symptôme du bug : erreur build Vercel `Type error: File '/vercel/path0/app/api/drafts/[slug]/editer/page.tsx' is not a module`
  (un `page.tsx` parasite avait été placé dans `app/api/...` au lieu de `app/...`).
- **Next.js 16 + params async** : dans `app/drafts/[slug]/editer/page.tsx`, le prop
  `params` doit être typé comme `Promise<{ slug: string }>` et awaité. Pattern à
  réutiliser pour toutes les pages dynamiques server-side à venir.

**Décisions de modèle métier actées en fin de Session 3 :**

À la fin de la session, après discussion sur les cas d'usage réels (variantes
de couleur, modèles réutilisables, copies depuis offres signées), plusieurs
décisions importantes ont été prises pour clarifier le modèle métier complet
avant d'attaquer les sessions 4-5-6-8. Voir aussi le tableau "Décisions
validées" et le schéma "Flux entre brouillons et offres" en haut du journal.

1. **Mode de transformation = Scénario A direct serveur.** Le clic "Transformer
   en offre" appelle `POST /api/drafts/[slug]/transformer` qui fait tout en
   atomique : INSERT dans offres, UPDATE du brouillon, génération PDF + URL
   publique. Redirection finale vers `/dashboard/[offre-slug]`. **Pas de
   passage par `/offres/nouveau` pré-rempli** — ça viderait la modal de
   vérification de son sens et créerait une fenêtre de modification
   post-engagement.

2. **Conservation indéfinie des brouillons transformés.** Décision changée
   par rapport au journal initial : **pas de purge automatique à 30 jours**.
   Un brouillon transformé reste consultable et duplicable indéfiniment via
   `/dashboard/draft/[slug]`. Le filtre dashboard "Masquer transformés" devient
   un filtre visuel d'affichage, pas un mécanisme de purge.

3. **Un brouillon = 1 transformation max.** Pour générer plusieurs variantes
   à partir d'une même base (ex : cuisine rouge / verte / noire), le
   commercial doit **dupliquer le brouillon d'abord**, puis transformer la
   copie. La route `POST /api/drafts/[slug]/transformer` renverra 409 si
   `transformed_at !== null`. Garantit l'intégrité du modèle "offre = état
   figé à un instant T précis et engageant".

4. **Bouton "📋 Dupliquer en nouveau brouillon"** disponible depuis tout
   brouillon (Session 4) — y compris les brouillons déjà transformés. Permet
   de générer des variantes à partir d'un brouillon source qui sert de modèle
   racine. Source intacte, copie indépendante.

5. **Deux boutons de copie depuis une offre (Session 8) :**
   - "📄 Copier en nouvelle offre" (existant, conservé) : pour les variantes
     rapides sans réflexion
   - "📋 Copier en nouveau brouillon" (nouveau) : pour les variantes qui
     demandent du travail de modification avant engagement

6. **Concept "is_template" abandonné.** L'idée d'un flag explicite pour
   différencier brouillons-modèles et brouillons-actifs avait été évoquée
   mais devient inutile dès lors qu'on conserve indéfiniment les brouillons :
   **tout brouillon est implicitement réutilisable.** Le commercial organise
   par titre/référence comme il l'entend.

**Notes pour Session 4 :**
- La page `/dashboard/draft/[slug]` (vue lecture-seule depuis le dashboard) devra :
  - Faire le même `GET /api/drafts/[slug]` que `DraftFormulaire` en mode édition
    (la logique d'hydratation peut être extraite si besoin, mais une simple lecture
    des champs JSON suffit pour de l'affichage)
  - Réutiliser la structure visuelle de `/dashboard/[slug]` (offre) mais sans
    bouton "Envoyer pour signature", sans bouton "Convertir en commande", sans
    lien public partageable
  - Inclure un bouton "✏️ Modifier" qui renvoie vers `/drafts/[slug]/editer`
  - Inclure un bouton "📋 Dupliquer en nouveau brouillon" (disponible même sur
    brouillons transformés — voir décision 4 ci-dessus)
  - Inclure un bouton "🔄 Transformer en offre" (modal Session 5) — désactivé
    si déjà transformé
  - Inclure un bouton "👁 Aperçu" qui ouvre `/drafts/[slug]/print` (Session 7)
  - Bandeau visuel "BROUILLON" en haut de page
- Si un brouillon a `transformed_at !== null`, la vue dashboard doit afficher
  un bandeau "Transformé en offre [LIEN]" et désactiver le bouton de
  transformation, mais **garder actif** le bouton de duplication (c'est le
  cas d'usage central des variantes).

**État de la base après Session 3 :**
- Brouillons de test créés pendant les tests : DRA-003 et DRA-004 selon les
  manipulations. Tous peuvent être supprimés via `DELETE /api/drafts/[slug]` ou
  conservés comme données de test pour la Session 4.
- Séquences `drafts_id_seq` et `drafts_numero_seq` ont avancé.
- Pour repartir totalement propre avant Session 4 :
```sql
  DELETE FROM drafts;
  ALTER SEQUENCE drafts_id_seq RESTART WITH 1;
  ALTER SEQUENCE drafts_numero_seq RESTART WITH 1;
```

**Architecture des fichiers brouillons après Session 3 :**
```
app/
├── api/drafts/
│   ├── route.ts                       # POST (create) + GET (list)  ← Session 2
│   └── [slug]/route.ts                # GET + PUT + DELETE          ← Session 2
└── drafts/
    ├── _components/
    │   └── DraftFormulaire.tsx        # Composant partagé           ← Session 3
    ├── nouveau/page.tsx               # Mode création               ← Session 3
    └── [slug]/editer/page.tsx         # Mode édition                ← Session 3
```

### Session 4
_(à remplir après réalisation)_

### Session 5
_(à remplir après réalisation)_

### Session 6
_(à remplir après réalisation)_

### Session 7
_(à remplir après réalisation)_

### Session 8
_(à remplir après réalisation)_

### Session 9
_(à remplir après réalisation)_

---

## 🆘 En cas de problème en cours de session

1. **Le chat plante :** ouvrir un nouveau chat, coller ce fichier `journal.md`
   en première message, indiquer la session en cours et la dernière étape
   complétée.
2. **Un commit casse l'app :** `git revert HEAD` puis push, on repart de l'état
   stable précédent.
3. **Migration SQL douteuse :** la table `drafts` peut être droppée sans impact
   sur les offres existantes (`drop table drafts cascade;`) tant qu'on n'a pas
   commencé à transformer des brouillons en offres.
4. **Conflits sur `main` :** la branche `feature/brouillons` reste isolée
   jusqu'à la session 9. Tant qu'on n'a pas mergé, on peut tout abandonner sans
   risque pour la prod.

---

## 🗄️ Audit Supabase Storage (effectué avant chantier)

**Plan Supabase :** Pro (backups DB automatiques activés).

**⚠️ Important :** Les backups DB Supabase **n'incluent pas** les fichiers du
Storage (buckets). Seules les références (URLs) dans la DB sont sauvegardées.

### Buckets actifs

| Bucket | Utilisé par | Régénérable ? |
|---|---|---|
| `brand-logos` | `app/api/brand-logos/upload/route.ts` | ❌ Non (fichiers uploadés manuellement) |
| `pdfs` | `app/api/offres/[slug]/pdf/route.ts`, `qr/route.ts` | ✅ Oui (pipeline HTML → pdf.co → pdf4me) |
| `factures` | Script d'import local depuis Google Drive | ✅ Oui (script idempotent) |
| _(`fiche-travail-pdf`)_ | `app/api/offres/[slug]/fiche-travail-pdf/route.ts` | ✅ Probablement oui |

### Architecture archives factures Winbiz

```
Google Drive (compte perso) → Script local idempotent → Supabase Storage (3000+ factures)
                                                              ↓
                                                       URLs en DB (table clients)
```

**Source de vérité :** Google Drive. Supabase est une couche de présentation
reconstructible via le script.

### ⚠️ Risques identifiés et ASSUMÉS (décision explicite du 2026-05-14)

Trois risques ont été identifiés avant le démarrage du chantier brouillons.
Décision prise : **continuer le chantier brouillons en priorité**, traiter ces
risques en chantier(s) séparé(s) plus tard.

| # | Risque | Probabilité | Impact | Mitigation prévue |
|---|---|---|---|---|
| R1 | **Script d'import factures non versionné** (local PC uniquement) | Moyenne (crash disque, suppression accidentelle) | Élevé (perte de la capacité de reconstruction) | À déplacer dans `scripts/import-factures-winbiz/` du repo + commit |
| R2 | **Google Drive perso sans backup tiers** | Faible-Moyenne (compromission compte, suspension, erreur humaine après 30j corbeille) | Critique (10 ans de factures, obligation légale CH) | À mettre en place : Google Takeout one-shot, puis rclone vers cloud tiers ou disque externe |
| R3 | **Bucket `brand-logos` non régénérable** | Faible | Moyen (refaisable manuellement mais pénible) | Backup manuel one-shot via dashboard Supabase |

### Plan de mitigation (À FAIRE APRÈS LE CHANTIER BROUILLONS)

- [ ] **R1 (Urgent)** : déplacer le script d'import dans le repo, vérifier
  qu'aucun secret n'est en dur (sortir clés API/tokens vers `.env.local`),
  ajouter un `README.md` documentant l'usage. Commit sur `main`.
- [ ] **R2 (Important)** : Google Takeout one-shot sur le dossier "Factures
  Winbiz" → backup sur disque externe ou cloud tiers. Refaire tous les
  trimestres au début, puis automatiser avec rclone.
- [ ] **R3 (Optionnel)** : télécharger manuellement les logos du bucket
  `brand-logos` vers `C:\Users\ezefi\backups\brand-logos-<date>`.

### Impact sur le chantier brouillons

✅ **Aucun.** La table `drafts` stockera les `ambianceImages` en base64 dans
JSONB (même approche que `offres.data`), donc 100% couvert par les backups DB.

---

## 📂 État actuel du code (avant chantier)

**Bug corrigé récemment (avant ce chantier) :** copie des `ambianceImages` lors
de "Copier offre complète" / "Nouvelle offre même client" — fonctionnait via
`localStorage` mais oubliait les images. Corrigé en ajoutant `ambianceImages`
au prefill et en wrappant `localStorage.setItem` dans un try/catch avec
fallback pour gérer le quota.

**À noter :** ce mécanisme `localStorage` deviendra obsolète à la session 8
(remplacé par la création serveur d'un brouillon).
