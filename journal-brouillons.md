# Journal — Chantier "Brouillons" (drafts)

> **Pour reprendre dans un nouveau chat Claude :** colle ce fichier en première
> message. Il contient tout le contexte nécessaire pour reprendre où on s'est
> arrêté.

---

## 🚀 Reprise rapide — Session 9 à démarrer

**État au 2026-05-15 :** Sessions 1, 2, 3, 4, 5, 6, 7, 8 terminées. La
fonctionnalité brouillons est **complète bout-en-bout**. Il ne reste que les
tests E2E et le déploiement prod (Session 9).

**Récap fonctionnel :**
- Création/édition de brouillons (`/drafts/nouveau`, `/drafts/[slug]/editer`)
- Vue lecture-seule dashboard (`/dashboard/draft/[slug]`)
- Duplication brouillon → brouillon (depuis tout brouillon, transformé ou non)
- Transformation atomique brouillon → offre via modal
- Section "Brouillons" sur le dashboard principal
- Aperçu print brouillon dédié avec filigrane "BROUILLON — DRA-XXX"
- **Session 8** : tous les boutons "Nouvelle offre" / "Copier offre" du
  dashboard offre+commande sont devenus des boutons "Nouveau brouillon" /
  "Copier en brouillon". Plus aucun bouton dans l'app ne crée directement une
  offre — toute création passe par un brouillon, l'offre n'existe que via
  transformation.
- Traçabilité bidirectionnelle : `data.fromDraftSlug` (offre → brouillon
  source), `transformed_into_offre_slug` (brouillon → offre cible),
  `data.copiedFromOffreSlug` + `data.copiedFromDraftSlug` (lignée de copies).

**Prochaine session : Session 9 — Tests E2E + déploiement prod**

**Avant de démarrer Session 9, avoir sous la main :**
- Le présent journal pour la checklist des tests E2E (section Session 9)
- Accès Supabase Dashboard pour la régénération de la `SUPABASE_SERVICE_ROLE_KEY`
- Accès Vercel pour mise à jour des env vars
- Le présent journal pour les notes Session 9

**Risque ÉLEVÉ** — merge vers `main` + déploiement prod. Rollback prévu via
`git revert` (la table `drafts` peut rester vide en base sans impact).

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
git commit -m ""
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

## ⚠️ Piège PowerShell transverse — Les crochets `[ ]` dans les chemins

**Tous les Cmdlets PowerShell** qui acceptent un paramètre `-Path` interprètent
les crochets `[ ]` comme un **wildcard de classe de caractères**. Sans
`-LiteralPath`, le chemin `app\drafts\[slug]\page.tsx` est lu comme
"n'importe quel caractère parmi s, l, u, g", ce qui retourne silencieusement
zéro résultat (ou `False` pour `Test-Path`) au lieu d'une erreur explicite.

**Cmdlets concernés :** `Test-Path`, `Get-Content`, `Select-String`, `Copy-Item`,
`Remove-Item`, `Move-Item`, `Get-ChildItem`, `New-Item` (pour les chemins existants), etc.

**Toujours utiliser `-LiteralPath`** dans le chantier brouillons :

```powershell
# ❌ Faux-négatifs silencieux (le fichier existe pourtant !)
Test-Path "app\dashboard\draft\[slug]\page.tsx"           # → False
Select-String -Path "app\drafts\[slug]\editer\..." -Pattern "..."  # → vide

# ✅ Correct
Test-Path -LiteralPath "app\dashboard\draft\[slug]\page.tsx"      # → True
Get-Content -LiteralPath "app\dashboard\draft\[slug]\page.tsx" | Select-String -Pattern "..."

# ✅ Pour les noms simples sans crochets, pas de souci
Select-String -Path "app\drafts\_components\DraftFormulaire.tsx" -Pattern "..."
```

**Coût en cas d'oubli :** environ 30 minutes de faux diagnostic en Session 7
parce qu'on cherchait à comprendre pourquoi les modifications "n'étaient pas
prises" alors qu'elles l'étaient.

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
- Créé via "Nouveau" ou copie d'une offre/commande/brouillon existant
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
Création → modifications libres → "Transformer en offre" → Offre figée
↓
Brouillon archivé MAIS conservé
indéfiniment (consultable +
duplicable pour variantes)

### Schéma complet des flux entre brouillons et offres

Ce schéma a été défini en fin de Session 3 puis enrichi en Session 8 (toutes
les copies passent désormais par le brouillon, aucune offre n'est plus créée
directement par copie).
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
│   DEPUIS UNE OFFRE ou UNE COMMANDE (Session 8)                      │
│                                                                     │
│   DEV-2026-047 ──── Modifier ────────▶ ❌ Impossible (immuable)     │
│        │                                                            │
│        ├── + Nouveau brouillon ──────▶ DRA-007 vierge              │
│        ├── 👤 Brouillon même client ─▶ DRA-008 (client pré-rempli) │
│        ├── 📋 Copier offre complète                                │
│        │   en brouillon ─────────────▶ DRA-009 (tout copié)        │
│        └── 📋 Copie offre en                                       │
│            brouillon sans client ────▶ DRA-010 (articles seulement)│
│                                                                     │
│   (Libellés identiques côté commande, "offre" → "commande")        │
│                                                                     │
└────────────────────────────────────────────────────────────────────┘

**Traçabilité bidirectionnelle :**
- Depuis DRA-005 : `transformed_into_offre_slug` pointe vers DEV-2026-047
  (affiché `→ DEV-2026-047` dans la section brouillons du dashboard)
- Depuis DEV-2026-047 : `data.fromDraftSlug` pointe vers DRA-005 (Session 5)
- Depuis DRA-009 issu d'une copie d'offre : `data.copiedFromOffreSlug` +
  `data.copiedFromOffreNumero` (Session 8)
- Depuis DRA-006 issu d'une duplication brouillon : `data.copiedFromDraftSlug`
  + `data.copiedFromDraftNumero` (Session 8)
- Chaîne préservée : si DRA-006 est dupliqué en DRA-011, DRA-011 contient
  **les deux** infos (offre racine ET brouillon parent direct).

**Cas d'usage "3 variantes rouge/vert/noir" — workflow complet :**

Créer DRA-005 → remplir version rouge complète
Dupliquer DRA-005 → DRA-006 → transformer → DEV-2026-047 (rouge)
Dupliquer DRA-005 → DRA-007 → modifier rouge→vert → transformer → DEV-2026-048 (vert)
Dupliquer DRA-005 → DRA-008 → modifier rouge→noir → transformer → DEV-2026-049 (noir)

Résultat :

DRA-005 reste comme "modèle racine rouge" jamais transformé directement
DRA-006, DRA-007, DRA-008 conservés comme historique de chaque variante
3 offres distinctes, chacune avec son brouillon source
Tout reste consultable indéfiniment


**Alternative depuis l'offre (Session 8) :**

DEV-2026-047 (rouge) déjà créée
Depuis le dashboard de DEV-2026-047 : "📋 Copier offre complète en brouillon" → DRA-009
Modifier rouge→vert dans DRA-009 → transformer → DEV-2026-050 (vert)
Re-cliquer "📋 Copier offre complète en brouillon" depuis DEV-2026-047 → DRA-010
Modifier rouge→noir dans DRA-010 → transformer → DEV-2026-051 (noir)


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
| Boutons de copie depuis offre/commande | **Tous deviennent des brouillons** (Session 8). Plus aucun bouton de l'app ne crée directement une offre. |
| Mécanisme de copie depuis offre/commande | **POST direct `/api/drafts`** (Session 8 — Option A). Le brouillon est créé en base immédiatement avec son numéro DRA-XXX. Plus de `localStorage` + `?from_copy=1`. |
| Flag `is_template` | **Abandonné** — devenu inutile avec la conservation indéfinie des brouillons transformés |
| Migration offres existantes | **Aucune** — les ~50 offres actuelles restent valides |
| Aperçu brouillon | Page print dynamique (Shopify), **pas de PDF** |
| Template brouillon | Devis actuel + filigrane BROUILLON, sans signature, sans lien validation |
| Lien public de signature | **Bloqué** sur les brouillons (ne doit JAMAIS s'afficher) |
| Architecture pages drafts | Composant partagé `_components/DraftFormulaire.tsx` réutilisé par `/drafts/nouveau` et `/drafts/[slug]/editer` |
| Sauvegarde brouillon | Manuelle + auto-save 2 min (si nom+email+commercial remplis) |
| URL d'édition | Route dynamique `/drafts/[slug]/editer` (pas de query param) |
| Architecture aperçu brouillon | **Page autonome dupliquée** `/print/draft/[slug]/page.tsx` (pas de prop `isDraft` sur la page offre) — Session 7 |
| Filigrane | SVG inline en data-URI, `background-image: repeat` ambre #f59e0b opacité 0.11, double ligne "BROUILLON — DRA-XXX" + "Document non contractuel" — Session 7 |
| Auto-print | **Aucun nulle part** (brouillon ET offre) — Session 7 |
| Ouverture des brouillons créés par copie | **Nouvel onglet** (`window.open(..., "_blank")`) — Session 8. L'offre source reste accessible. |

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
| 7 | Aperçu print : filigrane BROUILLON, sans signature, sans lien validation | Moyen | ✅ Terminée | 2026-05-15 | (push après commit) |
| 8 | Boutons "Copier en brouillon" depuis offre/commande/brouillon + traçabilité | Faible→Moyen* | ✅ Terminée | 2026-05-15 | 5b5956b |
| 9 | Tests end-to-end + merge `feature/brouillons` → `main` + déploiement prod | **Élevé** | ☐ À faire | | |

*Session 8 : risque révisé à la hausse en cours de session après détection d'une
incohérence UX entre les flux de copie (Option B initiale → Option A finale).

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
app/dashboard/draft/[slug]/page.tsx     # Nouvelle page de cette session
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

**Approche retenue :** page autonome dupliquée (pas de prop `isDraft` injectée
dans la page offre), pour ne pas alourdir le code chaud diffusé aux clients et
permettre une évolution indépendante du template brouillon.

**Filigrane :** SVG inline en data-URI, répété via `background-image: repeat`.
Couleur ambre `#f59e0b`, opacité 0.11, rotation -30°, double ligne
"BROUILLON — DRA-XXX" + "Document non contractuel".

**Critère de succès :** ouvrir `/print/draft/DRA-001-XXXX` affiche un PDF-like
avec filigrane permanent, sans bloc signature.

---

### Session 8 — Boutons de copie depuis une offre/commande/brouillon

**Objectif :** refondre tous les boutons de copie de l'application pour qu'ils
créent désormais des **brouillons** et non plus directement des offres. Aligné
sur la philosophie brouillon-first : l'offre n'existe que via transformation.

**4 boutons à modifier sur le dashboard offre+commande
(`app/dashboard/[slug]/page.tsx`) :**

1. `+ Nouvelle offre` → **`+ Nouveau brouillon`** (→ `/drafts/nouveau`)
2. `👤 Nouvelle offre même client` → **`👤 Brouillon même client`**
   (→ `/drafts/nouveau?prefill=...`)
3. `📋 Copier offre complète` → **`📋 Copier {offre|commande} complète en brouillon`**
   (libellé dynamique via `isTypeOffre`)
4. `📋 Copie offre sans client` → **`📋 Copie {offre|commande} en brouillon sans client`**
   (libellé dynamique)

**Mécanisme de copie pour les boutons 3/4 :** POST direct `/api/drafts` avec
payload au format `DraftSnapshot`. Le brouillon est créé en base immédiatement
avec son numéro DRA-XXX, redirection nouvelle onglet vers `/drafts/[slug]/editer`.

**Bouton "📋 Dupliquer en nouveau brouillon" côté page brouillon
(`app/dashboard/draft/[slug]/page.tsx`) :** enrichi avec
`data.copiedFromDraftSlug` + `data.copiedFromDraftNumero`.

**Traçabilité dans `data` JSONB :**
- `copiedFromOffreSlug` + `copiedFromOffreNumero` : copie depuis offre/commande
- `copiedFromDraftSlug` + `copiedFromDraftNumero` : duplication brouillon
- Chaîne préservée : un brouillon copié depuis un brouillon issu d'une offre
  conserve les deux infos.

**Critère de succès :** depuis une offre, commande ou brouillon, tous les
boutons de copie créent un brouillon DRA-XXX immédiatement persisté en base,
avec traçabilité de la source.

---

### Session 9 — Tests + déploiement prod

**Objectif :** valider l'ensemble et déployer.

**Tests end-to-end manuels (checklist) :**
- [ ] Création d'un brouillon depuis zéro (`/drafts/nouveau`)
- [ ] Modification d'un brouillon existant (`/drafts/[slug]/editer`)
- [ ] Suppression d'un brouillon non transformé
- [ ] Tentative de suppression d'un brouillon transformé → 409 attendu
- [ ] Copie d'une offre existante → brouillon (avec client + complet)
- [ ] Copie d'une offre existante → brouillon (sans client)
- [ ] Copie d'une commande existante → brouillon (libellés "commande" corrects)
- [ ] Duplication d'un brouillon existant → brouillon
- [ ] Duplication d'un brouillon **transformé** → brouillon (cas d'usage variantes)
- [ ] Vérification Supabase Studio : `data.copiedFromOffreSlug` /
      `copiedFromDraftSlug` correctement persistés
- [ ] Aperçu print d'un brouillon (filigrane, pas de signature, pas de QR)
- [ ] Tentative d'accès au lien public d'un brouillon → bloqué
- [ ] Transformation brouillon → offre (toutes cases cochées)
- [ ] Transformation refusée si cases non cochées
- [ ] Vérification : offre créée avec bon numéro, brouillon archivé
- [ ] Filtre "Masquer brouillons transformés" fonctionne
- [ ] Section "Brouillons" collapsible fonctionne (état persisté)
- [ ] Régression `ambianceImages` : copie d'une offre avec images lourdes →
      images bien présentes dans le brouillon créé
- [ ] Les ~50 offres existantes sont toujours accessibles et fonctionnelles

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
   *(décision révisée en Session 8 : un seul bouton "vers brouillon", plus aucune copie
   directe vers offre — voir Session 8)*
6. Concept "is_template" abandonné

**Pièges techniques rencontrés :**
- PowerShell + crochets `[ ]` : `Remove-Item -Recurse -Force app\drafts\[slug]\editer` échoue
  silencieusement. Solution : `-LiteralPath "app\drafts\[slug]\editer"`.
  **Note Session 7 :** ce piège s'étend à **toutes** les Cmdlets avec `-Path` (Test-Path,
  Get-Content, Select-String, etc.). Voir section "Piège PowerShell transverse" en haut.
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

### Session 7 — Terminée le 2026-05-15

**Décisions actées en début de session :**
1. **Architecture autonome** : page brouillon dupliquée depuis page offre, pas
   de prop `isDraft` injectée dans le composant existant. Raison : éviter
   d'alourdir le code chaud de l'aperçu offre (utilisé par tous les clients en
   prod) et permettre une évolution indépendante du template brouillon.
2. **Filigrane** : SVG inline en data-URI, répété via `background-image: repeat`
   sur `.doc-wrap`. Couleur ambre #f59e0b, opacité 0.11, rotation -30°, double
   ligne "BROUILLON — DRA-XXX" + "Document non contractuel". Robuste impression
   multi-pages grâce au `print-color-adjust: exact` déjà présent dans le CSS.
3. **Pas d'auto-print** nulle part (cohérent avec l'objectif de décourager
   l'impression d'un document non finalisé). Bouton "🖨 Imprimer quand même"
   visible à l'écran.
4. **Bandeau écran-only ambre** en haut "Aperçu d'un brouillon — Document non
   contractuel · Ne pas imprimer pour diffusion" + bouton "← Retour au
   brouillon" pointant vers `/dashboard/draft/[slug]`. Masqué à l'impression
   via `@media print`.

**Architecture implémentée :**
- **Nouvelle page** `app/print/draft/[slug]/page.tsx` (~670 lignes)
  - Copie de `/print/offre/[slug]/page.tsx` puis adaptation
  - Fetch via `/api/drafts/[slug]` (route Session 2), parsing `json.draft.data`
  - Helper `buildWatermarkDataUri(numero)` qui génère le SVG filigrane avec
    `encodeURIComponent` (sécurise les caractères spéciaux du numéro)
  - Type de doc affiché : forcé à "Brouillon", libellé "N° de brouillon"
  - Mention "TOTAL TTC (indicatif)" au lieu de "TOTAL TTC"
  - Footer thanks remplacé par "📝 Document préliminaire — cette version est un
    brouillon non contractuel" (couleur ambre)
  - Footer terms réécrit pour brouillon ("L'offre définitive fera seule foi")
- **Suppressions par rapport à la page offre :**
  - Bloc signature (`doc-sign-block` "Bon pour accord")
  - Bloc lien validation + QR code (cartouche bleu)
  - Banner vert "Stock en temps réel"
  - Badge stock par ligne (5 cas : à vérifier / sur commande / partiel /
    complet / pas de stock dispo) — ~70 lignes JSX supprimées
  - `useSearchParams` et paramètre `nostock` (inutile pour un brouillon)
- **Dashboard draft** (`app/dashboard/draft/[slug]/page.tsx`) :
  - `urlPrintStub` → `urlPrint = /print/draft/${draft.slug}`
  - Retrait du badge "⚠ Sans filigrane (Session 7)"
  - Retrait du bandeau jaune "⚠ Aperçu incomplet"
  - Mise à jour title du bouton "👁 Aperçu"
- **Formulaire draft** (`app/drafts/_components/DraftFormulaire.tsx`) :
  - Fonction `openPrint()` refondue (lignes 797-813 anciennement, 797-825 maintenant)
  - Suppression du mécanisme `localStorage` (devenu inutile maintenant que la
    page print charge depuis la base via `/api/drafts/[slug]`)
  - `/print/offre` (cassé, sans slug !) → `/print/draft/${slug}` (fonctionnel)
  - Récupération du slug post-save via parsing `window.location.pathname`
    (closure React ne voyait pas la nouvelle valeur de `currentSlug` après
    `setCurrentSlug`)

**Tests validés en local :**
- ✅ Aperçu depuis `/dashboard/draft/[slug]` (bouton "👁 Aperçu" + iframe à droite)
- ✅ Aperçu depuis `/drafts/[slug]/editer` (bouton dans le formulaire)
- ✅ Aperçu depuis brouillon vierge non persisté → save préalable déclenché
- ✅ Filigrane visible répété en diagonale sur toutes les pages à l'impression
- ✅ Bandeau écran et bouton imprimer correctement masqués à l'impression
- ✅ Articles affichés (plus de "Aucun article" — bug stub corrigé)
- ✅ Mention "Document préliminaire" en bas de page
- ✅ Brouillon transformé : aperçu accessible (lecture seule, fonctionne)

**Pièges techniques retenus :**
- **Closure React et `currentSlug` après `setCurrentSlug`** : la fonction
  `openPrint()` capture la valeur de `currentSlug` au render, donc même après
  un `await saveDraft()` qui met à jour le state, la closure voit toujours
  l'ancienne valeur. Solution adoptée : parser l'URL post-save (fallback simple,
  pas de refactor de la signature `saveDraft` qui retournait `Promise<boolean>`).
- **Filigrane SVG en data-URI** : `encodeURIComponent` est obligatoire pour les
  caractères `<>&"'` et le numéro injecté est `replace(/[<>&"']/g, "")` en
  garde-fou supplémentaire (XSS prevention sur un input qui vient de la base).
- **`print-color-adjust: exact`** (hérité de `body`) est essentiel pour que le
  filigrane sorte à l'imprimante (Chrome supprime les backgrounds par défaut).
- **Piège PowerShell étendu** : le bug des crochets `[ ]` qu'on avait noté en
  Session 3 pour `Remove-Item` s'applique à **toutes les Cmdlets** qui acceptent
  un paramètre `-Path` (Test-Path, Get-Content, Select-String, Copy-Item, etc.).
  Sans `-LiteralPath`, PowerShell interprète `[slug]` comme un wildcard de
  classe de caractères ("n'importe quel caractère parmi s, l, u, g"), ce qui
  retourne silencieusement zéro résultat (ou `False` pour Test-Path) au lieu
  d'une erreur explicite. Cause de ~30 min de faux diagnostic en Session 7
  parce qu'on cherchait à comprendre pourquoi les modifications "n'étaient pas
  prises" alors qu'elles l'étaient. Voir section "Piège PowerShell transverse"
  en haut de ce journal.

**Modifications fichier :**
- `app/print/draft/[slug]/page.tsx` : nouveau (~670 lignes)
- `app/dashboard/draft/[slug]/page.tsx` : ~20 lignes modifiées (3 zones)
- `app/drafts/_components/DraftFormulaire.tsx` : ~17 lignes modifiées (fonction
  `openPrint` + commentaires)

**Bug pré-existant noté (HORS périmètre Session 7) :**
- Pendant la création/modification d'une **offre** (pas brouillon), l'aperçu
  print ne montre PAS les badges stock des articles. Ce bug existait déjà
  avant la Session 7. Hypothèse : le composant aperçu lit uniquement depuis
  l'API qui n'est pas appelée tant que pas sauvegardé. Le `data.lines[].stock`
  n'est probablement pas hydraté côté front pendant la saisie.
- **À traiter dans un chantier séparé "bugs aperçu offre"** une fois le chantier
  brouillons clos. Ne concerne pas les brouillons (qui n'affichent volontairement
  pas le stock — voir décision Session 7).

**Notes pour Session 8 (boutons de copie depuis une offre) :**
- Depuis le dashboard d'une offre, ajouter "📋 Copier en nouveau brouillon" à
  côté de "📄 Copier en nouvelle offre" (existant)
- Le bouton "brouillon" appelle `POST /api/drafts` avec le payload de l'offre
  + ajouter `data.copiedFromOffreSlug = <slug offre>` pour traçabilité
- Le bouton "offre" existant utilise probablement encore le mécanisme
  `localStorage` + `?from_copy=1` hérité — bon moment pour le refactorer en
  appel direct `POST /api/offres/save`
- Régression à éviter : les `ambianceImages` doivent être copiées dans les deux
  cas (bug pré-chantier connu)

**Architecture des fichiers brouillons après Session 7 :**
app/
├── api/drafts/
│   ├── route.ts                            # POST + GET                 ← Session 2
│   ├── [slug]/route.ts                     # GET + PUT + DELETE         ← Session 2
│   └── [slug]/transformer/route.ts         # POST transformation        ← Session 5
├── drafts/
│   ├── _components/
│   │   └── DraftFormulaire.tsx             # Composant partagé + bouton aperçu ← Sessions 3, 7
│   ├── nouveau/page.tsx                    # Mode création              ← Session 3
│   └── [slug]/editer/page.tsx              # Mode édition               ← Session 3
├── print/
│   ├── offre/[slug]/page.tsx               # Aperçu OFFRE (inchangé)    ← prod
│   └── draft/[slug]/page.tsx               # Aperçu BROUILLON           ← Session 7 ★
├── dashboard/
│   ├── page.tsx                            # + section brouillons       ← Session 6
│   └── draft/
│       └── [slug]/
│           ├── page.tsx                    # Vue + bouton aperçu        ← Sessions 4, 5, 7
│           └── TransformerModal.tsx        # Modal de confirmation      ← Session 5

docs/sql/
├── 001-create-drafts.sql                   # Table drafts                ← Session 1
├── 002-rpc-next-dra-numero.sql             # RPC séquence DRA            ← Session 2
└── 003-rpc-transformer-draft.sql           # RPC transformation atomique ← Session 5

### Session 8 — Terminée le 2026-05-15 (commit `5b5956b`)

**Réalisé :**

Refonte des 4 boutons en bas du dashboard offre+commande
(`app/dashboard/[slug]/page.tsx`) pour qu'ils créent désormais des brouillons,
jamais directement des offres :
- `+ Nouvelle offre` → **`+ Nouveau brouillon`** (→ `/drafts/nouveau`)
- `👤 Nouvelle offre même client` → **`👤 Brouillon même client`**
  (→ `/drafts/nouveau?prefill=...`, query param déjà supporté par
  `DraftFormulaire` depuis Session 3)
- `📋 Copier offre complète` → **`📋 Copier {offre|commande} complète en brouillon`**
  (libellé dynamique via `isTypeOffre`)
- `📋 Copie offre sans client` → **`📋 Copie {offre|commande} en brouillon sans client`**
  (libellé dynamique)

Refactor `copierOffre` → `copierEnBrouillon` :
- Fonction async avec `POST` direct `/api/drafts` (au lieu de
  `localStorage["jc-offre-copy"]` + redirection vers `?from_copy=1`)
- Payload construit au format `DraftSnapshot` (camelCase pour les champs
  métier, conforme à ce qu'attend la route POST côté serveur)
- Redirection nouvelle onglet vers `/drafts/[slug]/editer` au succès

Ajout de traçabilité de la source dans `data` JSONB du brouillon créé :
- Depuis offre/commande : `data.copiedFromOffreSlug` + `data.copiedFromOffreNumero`
- Depuis brouillon (modif dans `dupliquerBrouillon` de
  `app/dashboard/draft/[slug]/page.tsx`) : `data.copiedFromDraftSlug` +
  `data.copiedFromDraftNumero`
- Préservation automatique de `copiedFromOffreSlug` quand un brouillon issu
  d'une offre est dupliqué (le `...draft.data` préserve les champs hérités) →
  chaîne de provenance maintenue

**Décision pivot en cours de session — Option B → Option A :**

Démarrage initial sur **Option B** (réutilisation du mécanisme localStorage +
`?from_copy=1` déjà présent dans `DraftFormulaire` depuis Session 3), choisi
pour son risque minimal. Premier test → bouton fonctionnait mais révélait une
**incohérence UX gênante** :

| Source de la copie | URL résultante | Brouillon créé en base ? | Numéro DRA visible ? |
|---|---|---|---|
| Offre → brouillon (Option B) | `/drafts/nouveau?from_copy=1` | ❌ Non | ❌ Non |
| Commande → brouillon (Option B) | `/drafts/nouveau?from_copy=1` | ❌ Non | ❌ Non |
| Brouillon → brouillon (Session 4, déjà Option A) | `/drafts/[slug]/editer` | ✅ Oui | ✅ Oui |

Décision : **passer à Option A** (POST direct `/api/drafts` depuis le
dashboard offre) pour aligner les trois flux sur le même comportement.

**Bénéfices collatéraux de la bascule Option A :**
- Comportement uniforme : "Copier en brouillon" = brouillon créé en base
  immédiatement avec son DRA-XXX, peu importe la source
- Résolution définitive du bug `ambianceImages` trop lourdes pour localStorage
  (entrée D5 de la dette technique — **désormais close**)
- Plus de dépendance au mécanisme `?from_copy=1` côté dashboard offre

**Pièges techniques retenus :**
- **Format de payload `POST /api/drafts`** : `body.data` doit être au format
  `DraftSnapshot` (camelCase pour les champs métier, snake_case pour quelques
  champs hérités comme `complement_nom`). Le serveur extrait ensuite vers les
  colonnes plates (`client_nom`, `client_email`, etc.) et stocke tout `data`
  en JSONB.
- Le mapping critique : `offre.client_nom` → `data.nom` (PAS `data.client_nom`).
  Même chose pour `client_prenom` → `prenom`, `client_email` → `email`,
  `client_tel1` → `telephone1`, etc.
- La réponse `POST /api/drafts` expose `json.editUrl`
  (`/drafts/[slug]/editer`) prêt à utiliser, pas besoin de reconstruire l'URL
  à partir du slug.
- `async function` obligatoire pour pouvoir `await fetch` — le mot-clé est
  facile à oublier en remplaçant une fonction synchrone existante.

**Modifications fichier :**
- `app/dashboard/[slug]/page.tsx` : ~70 lignes modifiées (4 boutons refondus
  + fonction `copierEnBrouillon` réécrite en async POST direct)
- `app/dashboard/draft/[slug]/page.tsx` : ~5 lignes ajoutées (étendre `data`
  avec `copiedFromDraftSlug` + `copiedFromDraftNumero` dans
  `dupliquerBrouillon`)

**Tests validés en local :**
- ✅ Depuis offre DEV-XXX : "Copier offre complète en brouillon" → DRA-014
  créée immédiatement, bouton "💾 Enregistrer" visible, pastille verte
- ✅ Depuis offre : "Copie offre en brouillon sans client" → brouillon avec
  articles uniquement, champs client vides
- ✅ Depuis commande : libellés "commande" corrects, POST fonctionnel
- ✅ Depuis brouillon : duplication enrichie avec `copiedFromDraftSlug`
- ✅ Bouton "+ Nouveau brouillon" → `/drafts/nouveau` (formulaire vide)
- ✅ Bouton "👤 Brouillon même client" → `/drafts/nouveau?prefill=...` avec
  champs client pré-remplis

**Code mort identifié (à nettoyer dans un futur chantier post-brouillons) :**
- Le mécanisme `?from_copy=1` + lecture `localStorage["jc-offre-copy"]` dans
  `app/drafts/_components/DraftFormulaire.tsx` (useEffect ligne ~1145) n'est
  **plus appelé par aucun bouton** après cette session. Code dormant
  inoffensif mais à supprimer pour clarté.
- Le même mécanisme côté `app/offres/nouveau/page.tsx` (si présent) devient
  également obsolète puisque plus aucun bouton ne mène vers
  `/offres/nouveau?from_copy=1`.
- Ajouté à la dette technique : voir D6 ci-dessous.

**Notes pour Session 9 (tests E2E + déploiement prod) :**
- Ajouter au plan de tests : vérifier que copier offre → brouillon préserve
  bien les `ambianceImages` même lourdes (régression D5 résolue, à confirmer
  en prod après déploiement)
- Vérifier visuellement dans Supabase Studio que `data.copiedFromOffreSlug`
  est bien persisté sur les nouveaux brouillons créés depuis une offre
- Confirmer que la suppression du mécanisme localStorage côté dashboard offre
  n'a pas cassé d'éventuelle compatibilité avec d'anciens onglets restés
  ouverts pendant le déploiement (low risk : aucun bouton ne mène plus à
  `?from_copy=1`, mais le useEffect côté `DraftFormulaire` est toujours là
  donc le comportement reste fonctionnel pour les onglets pré-déploiement)

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

## 🐛 Dette technique identifiée pendant le chantier (HORS périmètre)

À traiter **après** la fin du chantier brouillons (post-Session 9). Aucun n'est
bloquant pour la livraison de la feature brouillons elle-même.

| # | Sujet | Origine | Priorité | Statut |
|---|---|---|---|---|
| D1 | `client_numero_client` reste NULL sur les offres créées par transformation | Session 5 (alignement avec comportement actuel) | Basse | Ouvert |
| D2 | Mécanisme de création de fiche `clients` non reproduit côté transformation | Session 5 | Moyenne | Ouvert |
| D3 | Affichage "Type cible" cosmétique à nettoyer dans `app/dashboard/draft/[slug]/page.tsx` | Session 5 | Basse | Ouvert |
| D4 | `save/route.ts` utilise des URLs absolues avec fallback prod (à harmoniser avec relatif) | Session 5 | Moyenne | Ouvert |
| D5a | Bug `ambianceImages` trop lourdes pour localStorage lors d'une copie d'offre | Pré-chantier confirmé Session 7 | — | ✅ **Résolu Session 8** (passage à POST direct) |
| D5b | Aperçu offre pendant création/modification n'affiche pas les badges stock (`data.lines.stock` pas hydraté côté front avant save) | Session 7 (bug pré-chantier confirmé) | Moyenne | Ouvert |
| D6 | Code mort `?from_copy=1` + `localStorage["jc-offre-copy"]` dans `DraftFormulaire.tsx` (useEffect ~ligne 1145) et probablement `app/offres/nouveau/page.tsx` — plus appelé par aucun bouton après Session 8 | Session 8 (bascule Option B → A) | Basse | Ouvert |
| R1 | Script d'import factures non versionné (local PC uniquement) | Audit Storage avant chantier | Urgente | Ouvert |
| R2 | Google Drive perso sans backup tiers (10 ans de factures) | Audit Storage avant chantier | Importante | Ouvert |
| R3 | Bucket `brand-logos` non régénérable | Audit Storage avant chantier | Basse | Ouvert |

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
Google Drive (compte perso) → Script local idempotent → Supabase Storage (3000+ factures)
↓
URLs en DB (table clients)

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
🛠 Pour appliquer
powershellcd C:\Users\ezefi\jardin-confort-formulaire
# Sauvegarde de précaution
Copy-Item -LiteralPath journal-brouillons.md -Destination "journal-brouillons.md.bak-session7"
# Puis remplacer le contenu de journal-brouillons.md par le bloc complet ci-dessus
