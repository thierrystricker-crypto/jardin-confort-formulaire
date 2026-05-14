# Journal — Chantier "Brouillons" (drafts)

> **Pour reprendre dans un nouveau chat Claude :** colle ce fichier en première
> message. Il contient tout le contexte nécessaire pour reprendre où on s'est
> arrêté.

---

## 🚀 Reprise rapide — Session 7 à démarrer

**État au 2026-05-15 :** Sessions 1, 2, 3, 4, 5, 6 terminées. La fonctionnalité
"brouillon → offre" est opérationnelle bout-en-bout ET intégrée au dashboard :
- Création/édition de brouillons (`/drafts/nouveau`, `/drafts/[slug]/editer`)
- Vue lecture-seule dashboard (`/dashboard/draft/[slug]`)
- Duplication en nouveau brouillon (depuis tout brouillon, transformé ou non)
- Transformation atomique brouillon → offre via modal (RPC SQL + route +
  composant `TransformerModal`)
- **Section "Brouillons" sur le dashboard principal** avec 5ème KpiCard,
  filtre commercial, masquer transformés, lien vers offre cible

**Prochaine session : Session 7 — Aperçu print filigrane BROUILLON**
Créer une page print dédiée pour les brouillons : filigrane "BROUILLON" en
diagonale, bloc signature masqué, pas de lien validation. Aujourd'hui le
bouton "👁 Aperçu" pointe vers `/print/offre/[slug]` qui charge depuis la
table `offres` et affiche "Aucun article" pour un brouillon.

**À faire en Session 7 :**
1. Créer `app/drafts/[slug]/print/page.tsx` (server-side ou client-side
   selon ce que fait `/print/offre/[slug]` actuel)
2. Charger les données via `GET /api/drafts/[slug]` (Session 2)
3. Adapter le composant d'aperçu pour masquer signature + lien validation
   quand `isDraft={true}`
4. Ajouter filigrane "BROUILLON" en diagonale (CSS pseudo-element ou SVG
   superposé)
5. Mettre à jour le bouton "👁 Aperçu" dans `/dashboard/draft/[slug]/page.tsx`
   pour pointer vers la nouvelle route

**Avant de démarrer la Session 7, avoir sous la main :**
- `app/print/offre/[slug]/page.tsx` (la page print actuelle des offres — à
  étudier pour comprendre la structure)
- Tous composants partagés utilisés par le print (template, bloc signature,
  bloc client, bloc lignes, etc.)
- Le composant filigrane DRAFT actuel si tu en utilises déjà un pour les
  aperçus offres non signées
- Le présent journal pour les notes Session 7

**Risque Moyen** — manipulation de composants print partagés avec les offres
en prod. Bien découpler côté brouillon (prop `isDraft`) pour ne pas
introduire de régression sur les aperçus offres existants.

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

**Pour tester en local :**
```powershell
cd C:\Users\ezefi\jardin-confort-formulaire
npm run dev
# → http://localhost:3000
```
Si "Another next dev server is already running" : `Get-Process node | Stop-Process -Force` puis relancer.

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
- Listé dans une section dédiée "Brouillons" en bas du dashboard

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
  (affiché `→ DEV-2026-047` dans la section brouillons du dashboard)
- Depuis DEV-2026-047 : `data.fromDraftSlug` pointe vers DRA-005 (en place
  depuis Session 5)
- Depuis DRA-007 : `data.copiedFromOffreSlug` pointe vers DEV-2026-047 (à
  ajouter Session 8)

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
| Dashboard | Section "Brouillons" en bas du tableau offres (collapsible, ouverte par défaut) — voir Session 6 |
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
| 3 | Page `/drafts/nouveau` + `/drafts/[slug]/editer` + composant partagé | Moyen | ✅ Terminée | 2026-05-14 | e72e2bc + clôture |
| 4 | Page `/dashboard/draft/[slug]` (vue brouillon + bouton "Modifier") | Moyen | ✅ Terminée | 2026-05-14 | J4VKQq9yD |
| 5 | Modal "Transformer en offre" + route `/api/drafts/[slug]/transformer` | ~~Élevé~~ Moyen* | ✅ Terminée | 2026-05-14 | c831bdf |
| 6 | Section "Brouillons" sur dashboard + filtre archivés | Faible | ✅ Terminée | 2026-05-15 | (push après commit) |
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

**Architecture cible :**
```
app/dashboard/draft/[slug]/page.tsx     # Nouvelle page de cette session
```
La route s'inspire structurellement de `app/dashboard/[slug]/page.tsx` (existante
pour les offres) mais sans les actions non pertinentes pour un brouillon
(signature, conversion commande, lien public).

**Différences avec `/dashboard/[slug]` actuel :**
- Bouton "✏️ Modifier" (renvoie vers `/drafts/[slug]/editer` — Session 3)
- Bouton "📋 Dupliquer en nouveau brouillon" : appelle `POST /api/drafts` avec
  le `data` du brouillon courant. Source intacte, copie indépendante créée,
  redirection vers `/drafts/[nouveau-slug]/editer`. Disponible **même** sur les
  brouillons déjà transformés (pour générer des variantes — cas d'usage central).
- Bouton "🔄 Transformer en offre" (déclenche modal Session 5) — désactivé si
  le brouillon est déjà transformé (`transformed_at !== null`)
- Bouton "👁 Aperçu" (page print avec filigrane BROUILLON — Session 7)
- Bouton "🗑 Supprimer" : possible uniquement si non transformé (route existante
  côté API depuis la Session 2 ; le serveur renvoie 409 si transformé). À garder
  derrière une confirmation (modal ou inline) pour éviter les suppressions
  accidentelles.
- **PAS** de bouton "Envoyer pour signature"
- **PAS** de bouton "Convertir en commande"
- **PAS** de lien public partageable
- Bandeau visuel "BROUILLON" en haut de page
- Si `transformed_at !== null` : bandeau supplémentaire orange "Transformé en
  offre [DEV-2026-XXX →]" avec lien vers `/dashboard/[offre-slug]`

**Critère de succès :** afficher un brouillon en lecture seule, lancer
modification et retour, dupliquer (avec ou sans transformation préalable),
gérer correctement l'affichage des brouillons transformés.

---

### Session 5 — Transformation brouillon → offre (CRITIQUE)

**Objectif :** convertir un brouillon en offre définitive — **scénario A direct
serveur** (acté en fin de Session 3). Pas de retour par `/offres/nouveau`.

**Modal de confirmation :**
- Récap : client, montant total, nombre de lignes, commercial
- Cases à cocher obligatoires :
  - [ ] J'ai vérifié toutes les informations (client, prix, quantités, remarques)
  - [ ] Je confirme que cette transformation est définitive et que l'offre
        ne sera plus modifiable
- Bouton "Transformer" désactivé tant que toutes cases ne sont pas cochées

**Route `POST /api/drafts/[slug]/transformer` :**
1. Charger le brouillon
2. **Refuser (409)** si `transformed_at !== null` : un brouillon ne peut être
   transformé qu'une seule fois.
3. Générer numéro d'offre via la séquence existante `next_dev_numero`
4. INSERT dans `offres` avec toutes les données du brouillon
   - Ajouter `data.fromDraftSlug = <slug du brouillon>` pour traçabilité inverse
5. UPDATE du brouillon : `transformed_at = now()`, `transformed_into_offre_slug = ...`,
   `archived = true`
6. Retourner `{ offreSlug }` pour redirection
7. Wrap dans une transaction Supabase atomique (RPC SQL)

**Redirection :** après succès, rediriger vers `/dashboard/[offreSlug]` (la
nouvelle offre).

**Critère de succès :** transformer un brouillon, vérifier qu'une offre est
créée avec le bon numéro, que le brouillon est marqué `archived=true` mais
toujours consultable, que `transformed_into_offre_slug` pointe correctement, et
que l'utilisateur arrive sur la page de la nouvelle offre.

---

### Session 6 — Section "Brouillons" sur dashboard

**Objectif :** intégrer les brouillons dans le dashboard sans gêner.

**Modifications dashboard :**
- 5ème KpiCard "📝 Brouillons" en haut (grille passée en 5 colonnes sur xl)
- Section "Brouillons" collapsible **en bas** du tableau offres (le pipeline
  commercial reste prioritaire en haut)
- Compteur de brouillons "X actifs / Y au total"
- Filtre "Masquer les brouillons transformés" (coché par défaut → cache ceux
  avec `archived=true`)
- Filtre commercial existant s'applique aussi aux brouillons (cohérence avec
  l'expérience offres)
- Bouton "⬆ Haut" pour remonter au sommet du dashboard
- Tri par `updated_at DESC` (les plus récemment modifiés en haut)

**Critère de succès :** la section apparaît, liste les brouillons, le filtre
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
- Le composant d'aperçu actuel (probablement `app/print/offre/[slug]/page.tsx` ou similaire)
- Tous composants partagés utilisés par le print (template, bloc signature, bloc client, bloc lignes)
- Le composant filigrane DRAFT actuel utilisé pour les aperçus offres non signées

**Important pour Session 7 :** actuellement le bouton "👁 Aperçu" du formulaire
brouillon et de la page `/dashboard/draft/[slug]` pointent vers `/print/offre/[slug]`
(stub temporaire — pas de filigrane et "Aucun article" affiché car la page charge
depuis la table `offres`). À remplacer par `/drafts/[slug]/print` avec template dédié.

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
- [ ] Section "Brouillons" collapsible fonctionne
- [ ] Les 50 offres existantes sont toujours accessibles et fonctionnelles

**Déploiement :**
1. **Régénérer la `SUPABASE_SERVICE_ROLE_KEY`** (cf. section sécurité ci-dessous)
2. Merge `feature/brouillons` → `main` via PR
3. Vercel déploie automatiquement
4. Vérification post-déploiement sur la prod (création d'un brouillon test)
5. Optionnel : suppression du brouillon test

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
- Tous les endpoints testés en local : création vide, création pré-remplie, listing avec
  3 modes de filtre archived (false/true/all), filtre commercial, lecture détaillée,
  modification, suppression, cas d'erreur 404 et 409

**Écarts au plan initial :**
- `.env.local` était **incomplet** au début de la session : il manquait `NEXT_PUBLIC_SUPABASE_URL`
  et `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Ajoutées en local.
- `lib/supabase.ts` lisait `SUPABASE_SECRET_KEY` mais `.env.local` (et Vercel) utilisent
  `SUPABASE_SERVICE_ROLE_KEY` (nom standard Supabase). Ajout d'un fallback rétrocompatible :
  `process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY`.
- `computeTotals(data)` plante si `data.lines` ou `data.enabledServices` sont `undefined`.
  Le POST et le PUT court-circuitent l'appel quand `data.lines` est vide ou absent.
- Slug brouillon adopte le **même pattern que les offres** : `dra-001-x7k2m` (lowercase
  + token aléatoire 5 chars).
- `numero_affiche` en UPPERCASE (`DRA-001`) distinct du slug en lowercase (`dra-001-...`).

**Sécurité à traiter avant déploiement prod (Session 9) :**
- ⚠️ La `SUPABASE_SERVICE_ROLE_KEY` complète a été collée dans un chat de débogage
  pendant cette session. **À révoquer + régénérer** avant la Session 9 :
  1. Supabase Dashboard → Settings → API → Reset service_role secret
  2. Mettre à jour la variable dans Vercel (Settings → Environment Variables)
  3. Mettre à jour `.env.local` en local
  4. Redéploiement automatique Vercel après update env vars

**Format de réponse `GET /api/drafts` :**
```json
{
  "drafts": [
    {
      "id": 2, "slug": "dra-002-mzu6w", "numero_draft": 2,
      "numero_affiche": "DRA-002", "reference": "...",
      "client_societe": null, "client_nom": "Dupont", "client_prenom": "Jean",
      "client_email": "...", "commercial": "Thierry",
      "total_ttc": 0, "nb_articles": 0,
      "created_at": "...", "updated_at": "...",
      "transformed_at": null, "transformed_into_offre_slug": null,
      "archived": false
    }
  ],
  "count": 1
}
```

### Session 3 — Terminée le 2026-05-14 (commit refactor `e72e2bc` + commit clôture)

**Réalisé :**
- Architecture refactor propre : composant partagé `DraftFormulaire` + 2 pages fines
  - `app/drafts/_components/DraftFormulaire.tsx` (~3750 lignes) : toute la logique
    métier, accepte un prop optionnel `initialSlug`
  - `app/drafts/nouveau/page.tsx` (14 lignes) : mode création
  - `app/drafts/[slug]/editer/page.tsx` (20 lignes) : mode édition
- Sauvegarde brouillon : manuelle + auto-save 2 min si nom+email+commercial remplis
- Mode édition : fetch GET au montage, 5 états gérés (loading/ready/not_found/transformed/error)
- Adaptations spécifiques brouillon : pas de bannière URL publique, STORAGE_KEY localStorage
  isolée (`jc-draft-v1-local`), création client en base uniquement au save manuel
- Tests validés en local : création DRA-003, édition immédiate, persistance F5, 404 propre

**Décisions de modèle métier actées en fin de Session 3 :**
1. Mode de transformation = Scénario A direct serveur (pas de retour par `/offres/nouveau`)
2. Conservation indéfinie des brouillons transformés (pas de purge à 30j)
3. Un brouillon = 1 transformation max
4. Bouton "📋 Dupliquer en nouveau brouillon" disponible même sur brouillons transformés
5. Deux boutons de copie depuis offre (Session 8) : nouveau brouillon OU nouvelle offre
6. Concept "is_template" abandonné

**Pièges techniques rencontrés :**
- PowerShell + crochets `[ ]` : `Remove-Item -Recurse -Force app\drafts\[slug]\editer` échoue
  silencieusement. Solution : `-LiteralPath "app\drafts\[slug]\editer"`.
- Double présence du segment "drafts" : `app/api/drafts/` ET `app/drafts/`. Risque de confusion.
- Next.js 16 + params async : `params` typé `Promise<{ slug: string }>` et awaité.

### Session 4 — Terminée le 2026-05-14

**Réalisé :**
- Page `/dashboard/draft/[slug]/page.tsx` créée (~700 lignes)
- Architecture alignée sur `/dashboard/[slug]` côté offres : "use client", params async,
  fetch dans useEffect, layout en grille avec sticky preview à droite
- Bandeau pleine largeur "📝 BROUILLON" en haut, avec dates créé/modifié
- Bandeau orange "🔒 Brouillon transformé en offre" conditionnel avec lien vers l'offre cible
- Sections lecture-seule : Client, Brouillon (méta), Livraison, Montants, Remarques, Notes
- Boutons d'action : Modifier / Transformer (désactivé Session 4) / Aperçu / Dupliquer / Supprimer

**Bug fix transverse réalisé pendant la session :**
- `app/print/layout.tsx` redéclarait `<html>`, `<head>`, `<body>` alors que le root layout
  les fournit déjà → double `<html>` imbriqué et 7 erreurs d'hydration React 19. Corrigé.

### Session 5 — Terminée le 2026-05-14

**Décisions actées en début de session :**
1. **Transformation toujours en Offre, jamais directement en Commande** (modal simplifiée,
   risque divisé : pas besoin de reproduire la logique PDF/stock critique de `save/route.ts`)
2. `client_numero_client` laissé à NULL (comportement actuel des offres en prod)
3. Mécanisme de création de fiche client `clients` non reproduit (à investiguer hors chantier)
4. Modal simplifiée à 2 cases à cocher (au lieu de 4 prévues)
5. Affichage "Type cible" supprimé dans la page brouillon

**Architecture implémentée (Approche C validée) :**
- **RPC SQL atomique** `transformer_draft(p_slug TEXT) RETURNS JSONB`
  - `SELECT ... FOR UPDATE` sur le draft → pas de race condition
  - Refuse 404 si `DRAFT_NOT_FOUND` (P0001), 409 si déjà transformé (P0002)
  - Versionné dans `docs/sql/003-rpc-transformer-draft.sql`
- **Route JS** `POST /api/drafts/[slug]/transformer` avec gestion typée des erreurs
- **Composant modal** `TransformerModal.tsx` : 3 vues (idle/already_transformed/error),
  2 checkboxes obligatoires, fermeture Escape/overlay, redirection silencieuse au succès
- **Page brouillon** : bouton "🔄 Transformer en offre" activé, conversion `Number()` pour
  les colonnes `numeric` (Supabase renvoie en string)

**Tests validés bout-en-bout :**
- ✅ DRA-003 → DEV-2026-050 via UI
- ✅ DRA-007 → DEV-2026-049 via CLI
- ✅ Test 409 deux onglets : vue "🔒 Brouillon déjà transformé" avec bouton "Voir l'offre existante"

**Pièges techniques retenus :**
- `offres.numero_affiche` est une GENERATED column → ne PAS lister dans l'INSERT
- Bug pré-existant : URLs absolues avec fallback prod dans `POST /api/drafts` (corrigé `1fbbda3`)
- PowerShell 5.1 et `$_.ErrorDetails.Message` vide sur HTTP 4xx → passer par StreamReader

**Risques résiduels documentés (non bloquants) :**
- `client_numero_client` reste NULL (alignement avec comportement actuel)
- Création de fiche client `clients` non reproduite (à investiguer hors chantier)
- Affichage "Type cible" cosmétique à nettoyer dans `app/dashboard/draft/[slug]/page.tsx`
- `save/route.ts` utilise encore URLs absolues avec fallback prod (à harmoniser)

### Session 6 — Terminée le 2026-05-15

**Réalisé :**
- 5ème KpiCard "📝 Brouillons" ajoutée (passage grille `xl:grid-cols-4` → `xl:grid-cols-5`)
  avec compteur "X actifs / Y au total" et scroll smooth vers la section au clic
- Type `DraftRecord` aligné sur la réponse de `GET /api/drafts` (Session 2)
- Helper `nomClientDraft(d)` + helper `offreNumeroFromSlug(slug)` pour extraire le numéro
  d'offre lisible depuis le slug (ex: `dev-2026-050-cd94b` → `DEV-2026-050`)
- Section brouillons collapsible **en bas** du tableau offres (volontairement en bas pour
  ne pas masquer le pipeline commercial principal — choix utilisateur explicite)
- Header section avec bouton repli ▶/▼ + compteur ambre + bouton "⬆ Haut" pour remonter
  au sommet du dashboard (smooth scroll)
- Quand section ouverte : checkbox "Masquer brouillons transformés" (cochée par défaut,
  persistée localStorage) + bouton "+ Nouveau brouillon" + bouton 🔄 actualiser
- Tableau brouillons stylé ambre/orange (couleur tertiaire, distincte du bleu offres et
  vert commandes), bordure gauche `border-l-amber-400/60` pour les actifs,
  `border-l-zinc-600/50` pour les transformés (grisés)
- Colonnes brouillons : Réf · Client · Conseiller · Montant · Statut · Modifié le · Actions
- Badge statut : "📝 Brouillon" (ambre) ou "🔒 Transformé" (gris)
- **Affichage du numéro d'offre cible** sur les brouillons transformés (`→ DEV-2026-XXX`)
  — cohérent avec le pattern existant des offres converties (`← DEV-2026-XXX` sur les commandes)
- Actions contextuelles :
  - Brouillon actif → boutons Voir + ✏️ Modifier
  - Brouillon transformé → boutons Voir + → Offre (lien vers `/dashboard/[offre-slug]`)
- Persistance localStorage :
  - `dashboard-hide-transformed-drafts` (checkbox masquer)
  - `dashboard-drafts-collapsed` (état repli)
- Le filtre commercial global du dashboard s'applique aussi aux brouillons
- Fetch `GET /api/drafts?archived=all` au mount (récupère tout, filtrage côté client)

**Écarts au plan initial :**
- Le journal Session 6 prévoyait initialement un **onglet/tabs "Brouillons" séparé**.
  Après inspection du dashboard, décision prise d'aller sur **deux tableaux empilés**
  (offres en haut, brouillons en bas) plutôt qu'un système d'onglets ou un
  `quickFilter="brouillons"` qui aurait fait disparaître le tableau offres.
  Raison métier : le dashboard est avant tout un outil de **suivi commercial du
  pipeline offres**, les brouillons sont des "todos commerciaux" secondaires.
- Position : brouillons **en bas** (et non en haut comme initialement suggéré par
  Claude), choix utilisateur explicite — le commercial doit pouvoir surveiller les
  offres en cours en priorité.
- Section ouverte par défaut (pas auto-collapse si N=0) car la persistance localStorage
  gère déjà la préférence de l'utilisateur.
- Ajout d'un **bouton "⬆ Haut"** non prévu initialement, demandé en cours de session
  pour faciliter le retour en haut du dashboard après consultation des brouillons.
- Ajout de l'**affichage du numéro d'offre cible** sur les brouillons transformés
  (`→ DEV-2026-XXX`), demandé pour cohérence avec le pattern existant des offres
  converties.

**Modifications fichier :**
- `app/dashboard/page.tsx` : ~180 lignes ajoutées, 0 supprimée (modification purement
  additive, zéro risque pour la partie offres existante)

**Tests validés en local :**
- ✅ 5 KpiCards alignées sur xl, "📝 Brouillons" en 5ème position
- ✅ Compteur "2 actifs / 6 au total" correct (visible sur screenshot prod local)
- ✅ Clic KpiCard scroll smooth vers la section
- ✅ Bouton "⬆ Haut" remonte au sommet
- ✅ Checkbox "Masquer brouillons transformés" cache/affiche les transformés
- ✅ Section repliable, état persisté entre rafraîchissements
- ✅ Filtre commercial s'applique aux brouillons
- ✅ Lignes transformées grisées avec lien `→ DEV-2026-XXX` cliquable vers l'offre cible
- ✅ Lignes actives avec bouton ✏️ Modifier qui mène à `/drafts/[slug]/editer`
- ✅ Clic ligne entière ouvre `/dashboard/draft/[slug]`

**Notes pour Session 7 (aperçu print filigrane BROUILLON) :**
- Toujours pas de page `/drafts/[slug]/print` dédiée. Le bouton "👁 Aperçu" sur
  `/dashboard/draft/[slug]` pointe encore vers `/print/offre/[slug]` qui charge depuis
  la table `offres` et affiche "Aucun article" pour un brouillon.
- À faire en Session 7 :
  1. Créer `app/drafts/[slug]/print/page.tsx` (server-side, charge depuis
     `/api/drafts/[slug]` et passe les données au composant d'aperçu existant avec
     une prop `isDraft={true}`)
  2. Adapter le composant d'aperçu pour masquer signature + lien validation quand `isDraft`
  3. Ajouter filigrane "BROUILLON" en diagonale via CSS pseudo-element ou SVG superposé
  4. Mettre à jour le bouton "👁 Aperçu" dans `/dashboard/draft/[slug]/page.tsx` pour
     pointer vers la nouvelle route
- Risque Moyen (manipulation de composants print partagés avec offres en prod).
- Bien découpler côté brouillon (prop `isDraft`) pour ne pas introduire de régression
  sur les aperçus offres existants.

**Architecture des fichiers brouillons après Session 6 :**
```
app/
├── api/drafts/
│   ├── route.ts                            # POST + GET                 ← Session 2
│   ├── [slug]/route.ts                     # GET + PUT + DELETE         ← Session 2
│   └── [slug]/transformer/route.ts         # POST transformation        ← Session 5
├── drafts/
│   ├── _components/
│   │   └── DraftFormulaire.tsx             # Composant partagé          ← Session 3
│   ├── nouveau/page.tsx                    # Mode création              ← Session 3
│   └── [slug]/editer/page.tsx              # Mode édition               ← Session 3
├── dashboard/
│   ├── page.tsx                            # + section brouillons       ← Session 6
│   └── draft/
│       └── [slug]/
│           ├── page.tsx                    # Vue + bouton transformer   ← Sessions 4+5
│           └── TransformerModal.tsx        # Modal de confirmation      ← Session 5
```

docs/sql/
├── 001-create-drafts.sql                   # Table drafts                ← Session 1
├── 002-rpc-next-dra-numero.sql             # RPC séquence DRA            ← Session 2
└── 003-rpc-transformer-draft.sql           # RPC transformation atomique ← Session 5

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