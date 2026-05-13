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
                                              Brouillon archivé 30j
                                              puis purgé automatiquement
```

---

## ✅ Décisions validées

| Décision | Choix retenu |
|---|---|
| Stockage | Nouvelle table `drafts` |
| Après transformation | Archivé 30j, puis purge auto |
| Filtre dashboard | "Masquer brouillons transformés" |
| Numérotation | `DRA-XXX` |
| Dashboard | Onglet "Brouillons" caché par défaut |
| Confirmation transformation | Modal avec récap + cases à cocher |
| Copie depuis offre signée | Crée un brouillon |
| Migration offres existantes | **Aucune** — les ~50 offres actuelles restent valides |
| Aperçu brouillon | Page print dynamique (Shopify), **pas de PDF** |
| Template brouillon | Devis actuel + filigrane BROUILLON, sans signature, sans lien validation |
| Lien public de signature | **Bloqué** sur les brouillons (ne doit JAMAIS s'afficher) |

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
| 1 | Préparation : backup Supabase + branche git + création table `drafts` | Faible | ☐ À faire | | |
| 2 | API `/api/drafts` (POST, GET, GET[slug], PUT[slug], DELETE[slug]) | Moyen | ☐ À faire | | |
| 3 | Page `/drafts/nouveau` (clone adapté de `/offres/nouveau`) + redirection | Moyen | ☐ À faire | | |
| 4 | Page `/dashboard/draft/[slug]` (vue brouillon + bouton "Modifier") | Moyen | ☐ À faire | | |
| 5 | Modal "Transformer en offre" + route `/api/drafts/[slug]/transformer` | **Élevé** | ☐ À faire | | |
| 6 | Onglet "Brouillons" sur dashboard + filtre archivés | Faible | ☐ À faire | | |
| 7 | Aperçu print : filigrane BROUILLON, sans signature, sans lien validation | Moyen | ☐ À faire | | |
| 8 | Refonte "Copier offre complète" → crée un brouillon | Faible | ☐ À faire | | |
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

### Session 3 — Page `/drafts/nouveau`

**Objectif :** permettre la création/édition d'un brouillon via formulaire.

**Stratégie :** cloner `/offres/nouveau/page.tsx` en `/drafts/nouveau/page.tsx`,
puis adapter :
- `saveToSupabase` appelle `/api/drafts` au lieu de `/api/offres/...`
- Pas de bouton "Envoyer pour signature"
- Bouton "Transformer en offre" (session 5)
- L'URL devient `/drafts/[slug]` après création (pas `/dashboard/[slug]`)

**Mode édition :** la même page doit pouvoir charger un brouillon existant via
query param ou route dynamique `/drafts/[slug]/editer`.

**Décision à prendre en début de session :** route dynamique `/drafts/[slug]/editer`
(plus propre) ou query param `/drafts/nouveau?id=...` (plus simple) ?

**Critère de succès :** créer un brouillon depuis zéro, le sauvegarder, le
rouvrir, le modifier, le re-sauvegarder.

---

### Session 4 — Page `/dashboard/draft/[slug]`

**Objectif :** vue lecture-seule d'un brouillon, avec actions.

**Différences avec `/dashboard/[slug]` actuel :**
- Bouton "Modifier" (renvoie vers la page d'édition de session 3)
- Bouton "Transformer en offre" (déclenche modal session 5)
- Bouton "Aperçu" (page print avec filigrane BROUILLON)
- **PAS** de bouton "Envoyer pour signature"
- **PAS** de bouton "Convertir en commande"
- **PAS** de lien public partageable
- Bandeau visuel "BROUILLON" en haut de page

**Critère de succès :** afficher un brouillon en lecture seule, lancer
modification et retour.

---

### Session 5 — Transformation brouillon → offre (CRITIQUE)

**Objectif :** convertir un brouillon en offre définitive.

**Modal de confirmation :**
- Récap : client, montant total, nombre de lignes, commercial
- Cases à cocher obligatoires :
  - [ ] J'ai vérifié les coordonnées client
  - [ ] J'ai vérifié les prix et quantités
  - [ ] J'ai vérifié les remarques et délais
  - [ ] Je confirme que cette transformation est définitive et que l'offre ne sera plus modifiable
- Bouton "Transformer" désactivé tant que toutes cases ne sont pas cochées

**Route `POST /api/drafts/[slug]/transformer` :**
1. Charger le brouillon
2. Générer numéro d'offre via la séquence existante (à identifier en début de session)
3. INSERT dans `offres` avec toutes les données du brouillon
4. UPDATE du brouillon : `transformed_at = now()`, `transformed_into_offre_slug = ...`, `archived = true`
5. Retourner `{ offreSlug }` pour redirection
6. Wrap dans une transaction Supabase (ou rollback manuel si échec)

**Redirection :** après succès, rediriger vers `/dashboard/[offreSlug]` (la nouvelle offre).

**⚠️ Risque :** une transformation partielle (brouillon archivé mais offre non
créée) corromprait l'état. Il **faut** une transaction ou un rollback explicite.

**Critère de succès :** transformer un brouillon, vérifier qu'une offre est
créée avec le bon numéro, que le brouillon est marqué `archived=true`, et que
l'utilisateur arrive sur la page de la nouvelle offre.

---

### Session 6 — Onglet "Brouillons" dashboard

**Objectif :** intégrer les brouillons dans le dashboard sans gêner.

**Modifications dashboard :**
- Nouvel onglet "Brouillons" caché par défaut (par exemple toggle/checkbox "Afficher les brouillons" ou onglet séparé selon l'UI actuelle)
- Compteur de brouillons actifs (non archivés)
- Filtre "Masquer les brouillons transformés" (coché par défaut → cache ceux avec `archived=true`)
- Tri par `updated_at DESC` (les plus récemment modifiés en haut)

**Critère de succès :** l'onglet apparaît, liste les brouillons, le filtre
fonctionne.

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

**Critère de succès :** ouvrir `/drafts/DRA-001/print` affiche un PDF-like avec
filigrane permanent, sans bloc signature.

---

### Session 8 — Copie offre signée → brouillon

**Objectif :** adapter les boutons "Copier offre complète" et "Nouvelle offre
même client" pour créer un brouillon au lieu d'une offre.

**Modification de `copierOffre()` dans `/dashboard/[slug]/page.tsx` :**
- Appel à `POST /api/drafts` avec le payload (au lieu de `localStorage` + redirect)
- Redirection vers `/drafts/[nouveauSlug]/editer` après création
- Suppression du mécanisme `localStorage` + `?from_copy=1` (devenu obsolète)

**Variante alternative pour ouverture dans nouvel onglet :** le bouton ouvre
`/drafts/copier-depuis/[offreSlug]` qui crée le brouillon côté serveur puis
redirige. Permet l'`Open in new tab`.

**Critère de succès :** depuis une offre existante, cliquer "Copier offre
complète" crée un brouillon DRA-XXX éditable.

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

### Session 1
_(à remplir après réalisation)_

### Session 2
_(à remplir après réalisation)_

### Session 3
_(à remplir après réalisation)_

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
