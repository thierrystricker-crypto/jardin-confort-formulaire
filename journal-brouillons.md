# Journal — Chantier "Brouillons" (drafts)

> **Pour reprendre dans un nouveau chat Claude :** colle ce fichier en première
> message. Il contient tout le contexte nécessaire pour reprendre où on s'est
> arrêté.

---

## 🚀 Reprise rapide — Phase C+D de Session 9 à démarrer

**État au 2026-05-15 (fin de Phase B de Session 9) :** Sessions 1 à 8 terminées.
Tests E2E de Session 9 **16/16 validés** sur la branche `feature/brouillons`.
4 fixes UX trouvés en cours de tests et déjà commités/pushés. **Il ne reste que
Phase C (sécurité) + Phase D (merge + déploiement prod).**

**Branche `feature/brouillons` — dernier commit : `3cb1db6`**

### Commits Session 9 effectués (Phase B — tests E2E)

| Commit | Description |
|---|---|
| `d4520d0` | docs: clôture Session 8 dans le journal (pré-Session 9) |
| `9e15263` | fix(drafts): duplication brouillon ouvre dans nouvel onglet (cohérence Session 8) |
| `604ff42` | fix(drafts): préserver clés traçabilité copiedFrom* lors du PUT (régression Session 8) |
| `9e40fd2` | fix(drafts): retirer mention (indicatif) du total dans aperçu brouillon |
| `3cb1db6` | fix(drafts): afficher détail des totaux (remise, services, arrondi) sur récap modal et page brouillon |

### Ce qui a été démontré bout-en-bout en Phase B

- ✅ CRUD brouillon complet (création, modification, suppression, garde-fou 409 sur transformés)
- ✅ Les 4 boutons de copie depuis offre/commande créent bien des brouillons via POST direct
- ✅ Duplication brouillon (actif ET transformé — cas variantes) fonctionnelle
- ✅ Traçabilité bidirectionnelle complète sur 3 niveaux (offre source → brouillon, brouillon → offre cible, brouillon → brouillon parent)
- ✅ Aperçu print brouillon avec filigrane, sans signature, sans QR
- ✅ Lien public bloqué pour les slugs brouillon (sécurité)
- ✅ Transformation atomique brouillon → offre (testée avec DRA-019 → DEV-2026-058)
- ✅ Garde-fou modal : bouton désactivé tant que cases non cochées
- ✅ Filtre "Masquer transformés" + état persistant localStorage
- ✅ 73 offres existantes accessibles et fonctionnelles (dont DEV-2026-011 avec 7 images d'ambiance lourdes)

### Pour démarrer Phase C, avoir sous la main :

- Le présent journal (le coller en début de chat)
- Accès Supabase Dashboard pour régénération de la `SUPABASE_SERVICE_ROLE_KEY`
- Accès Vercel pour mise à jour des env vars
- Le fichier `.env.local` à mettre à jour côté local
- L'URL de la prod : `https://offres.jardin-confort.ch/dashboard`

**Risque ÉLEVÉ** — Phase C touche aux secrets prod, Phase D merge vers `main` et déclenche déploiement prod. Rollback prévu via `git revert` (la table `drafts` peut rester en base sans impact).

---

## 🎯 Phase C + D à exécuter dans le nouveau chat

### Phase C — Sécurité et préparation déploiement (~20 min)

1. **Régénérer la `SUPABASE_SERVICE_ROLE_KEY`** dans Supabase Dashboard (Settings → API → Reset). Cette clé a fuité dans un chat de debug pendant la Session 2, donc régénération **non-négociable** avant déploiement.
2. **Mettre à jour la clé dans Vercel** (Settings → Environment Variables) sur les 3 environnements (Production, Preview, Development). Pas de redéploiement encore.
3. **Mettre à jour la clé dans `.env.local`** côté local + vérifier que `npm run dev` repart sans erreur 401 Supabase.
4. **Vérifier que la prod actuelle tourne toujours** sur `https://offres.jardin-confort.ch/dashboard` (la nouvelle clé doit être active sur Vercel sans avoir cassé l'app actuelle qui utilise toujours `main`).
5. **Préparer le message de PR** pour le merge `feature/brouillons` → `main`.

### Phase D — Merge et déploiement (~15 min + smoke test)

1. **Créer la PR** `feature/brouillons` → `main` sur GitHub.
2. **Vérifier le Preview Deployment Vercel** qui se build automatiquement sur la PR. Faire un dernier test rapide sur l'URL preview (créer 1 brouillon, le transformer).
3. **Merger la PR** (merge commit recommandé pour garder l'historique des 9 sessions visible).
4. **Vercel auto-deploy `main`** → suivre les logs de build.
5. **Smoke test prod** sur `https://offres.jardin-confort.ch/dashboard` :
   - Créer un brouillon DRA-XXX "TEST PROD" + l'imprimer
   - Le transformer en offre
   - Vérifier que DRA-XXX est bien archivé et que l'offre apparaît
   - Optionnel : supprimer l'offre+brouillon de test ou les marquer pour traçabilité
6. **Mettre à jour le journal** (Session 9 ✅, date, hash du merge commit) et fermer la branche `feature/brouillons` (la garder localement quelques jours par précaution).

**Rollback si problème** : `git revert <merge-commit>` + push → Vercel redéploie l'état antérieur. La table `drafts` peut rester en base sans impact.

---

## 🎯 Contexte du projet

**Projet :** `jardin-confort-formulaire`
**Stack :** Next.js (App Router) + Supabase + Shopify, hébergé sur Vercel
**Chemin local :** `C:\Users\ezefi\jardin-confort-formulaire`
**Branche de travail :** `feature/brouillons` — HEAD à `3cb1db6`
**URL prod :** `https://offres.jardin-confort.ch/dashboard`

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

## ⚠️ Pièges Windows transverses (Session 9 a confirmé)

### Piège 1 — Crochets `[ ]` dans les chemins PowerShell

**Tous les Cmdlets PowerShell** qui acceptent un paramètre `-Path` interprètent les crochets `[ ]` comme un **wildcard de classe de caractères**. Sans `-LiteralPath`, le chemin `app\drafts\[slug]\page.tsx` est lu comme "n'importe quel caractère parmi s, l, u, g", ce qui retourne silencieusement zéro résultat (ou `False` pour `Test-Path`) au lieu d'une erreur explicite.

**Toujours utiliser `-LiteralPath`** sur les chemins contenant `[slug]`.

### Piège 2 — Heredocs PowerShell `@"..."@` fragiles aux fins de ligne

**Découvert en Session 9.** Les heredocs PowerShell ne matchent pas toujours du multi-ligne contenant du code (CRLF vs LF, indentation invisible). Si on doit modifier un fichier via PowerShell :
- ✅ Préférer un script avec **comptage d'occurrences via `IndexOf` en boucle** comme garde-fou
- ✅ Utiliser `[System.IO.File]::ReadAllText()` + `WriteAllText()` avec `UTF8Encoding($false)`
- ❌ Éviter `Get-Content -Raw` / `Set-Content` (encodage Windows-1252 par défaut → corruption des accents)

### Piège 3 — VS Code et chemins contenant `[slug]`

**Découvert en Session 9.** La commande `code "app\dashboard\draft\[slug]\page.tsx"` depuis PowerShell crée parfois un **buffer vide** dans VS Code (les crochets interprétés comme wildcard). Le fichier disque reste intact, mais VS Code affiche un onglet vide → **si Ctrl+S est fait, le fichier disque est écrasé par le vide**.

**Solution** : ouvrir le fichier via **Ctrl+P** dans VS Code et taper le nom du fichier, ou via **Fichier → Ouvrir**. **Ne jamais utiliser `code` en CLI** pour ces chemins.

**Si ça arrive** : fermer l'onglet via croix X et choisir **"Ne pas enregistrer"** (jamais Ctrl+S sur un buffer vide).

### Piège 4 — VS Code indicateur "UTF-8 with BOM" incohérent

**Découvert en Session 9.** L'indicateur d'encodage en bas à droite de VS Code peut afficher "UTF-8 with BOM" même quand le fichier disque n'a PAS de BOM (vérifié via `[System.IO.File]::ReadAllBytes()` → bytes initiaux `22 75 73 65` au lieu de `EF BB BF`).

**Si l'indicateur dit "UTF-8 with BOM"** : faire "Reopen with Encoding" → "UTF-8" (sans BOM) **avant** de modifier. Ne pas faire "Save with Encoding" qui modifierait potentiellement le fichier disque.

### Piège 5 — Redirection PowerShell sur chemin `C:\...`

**Découvert en Session 9.** Si un copier-coller PowerShell perd les backslashes (`\` interprété comme caractère d'échappement à un moment), une commande type `git log > C:\Users\ezefi\jardin-confort-formulaire` crée un **fichier au nom tronqué** comme `ezefijardin-confort-formulaire` dans le répertoire courant. À nettoyer manuellement.

**Bonne pratique** : utiliser `Out-File -LiteralPath "..."` au lieu de `>` pour les redirections.

---

## 🐛 Problème métier (rappel)

Aujourd'hui, dès qu'une offre est enregistrée, elle est **immuable**. Conséquence : pour corriger la moindre faute de frappe ou ajuster un prix, le commercial doit créer une nouvelle offre avec un nouveau numéro. La base contient des doublons quasi-identiques et les statistiques sont faussées.

**Solution livrée :** notion de **brouillon (draft)** modifiable à volonté, transformable en offre définitive par action explicite du commercial. **Aucune offre n'est plus créée directement** depuis l'application — toute création passe par un brouillon, l'offre n'existe que via transformation.

---

## 📋 Modèle métier livré

### Brouillon (`drafts`)

- Créé via "Nouveau" ou copie d'une offre/commande/brouillon existant
- **Modifiable indéfiniment** par le commercial
- Numérotation `DRA-001`, `DRA-002`...
- **Aperçu** filigrané "BROUILLON" (page print dynamique)
- **Template** = devis actuel sans bloc signature + sans lien validation
- **Pas de lien public partageable** (sécurité confirmée en Session 9)
- Listé dans une section dédiée "Brouillons" en bas du dashboard

### Offre (`offres`)

- Créée uniquement par action "Transformer en offre" depuis un brouillon
- **Immuable** dès la transformation
- Numéro d'offre définitif attribué à ce moment
- Lien public de signature
- Aperçu/PDF sans filigrane

### Traçabilité bidirectionnelle 3 niveaux
DEV-2026-047 (offre source originelle)
│
│ Copier offre → brouillon
▼
DRA-019 (brouillon)
│ data.copiedFromOffreSlug = "dev-2026-047-l321a"   ← Session 8 + fix 604ff42
│
│ Modifications + saves multiples
│
│ Transformer en offre (RPC SQL atomique)
▼
DEV-2026-058 (nouvelle offre)
│ data.fromDraftSlug = "dra-019-ama4u"               ← Session 5
DRA-019 archivé avec :
- archived = true
- transformed_at = même timestamp que offre.created_at (atomicité)
- transformed_into_offre_slug = "dev-2026-058-63a24"
- data.copiedFromOffreSlug PRÉSERVÉ = "dev-2026-047-l321a"

**Test bout-en-bout effectué en Session 9 sur DRA-019 → DEV-2026-058.** Tous les liens validés en SQL.

---

## ✅ Décisions validées (récap)

| Décision | Choix retenu |
|---|---|
| Stockage | Nouvelle table `drafts` |
| Après transformation | **Conservé indéfiniment** (pas de purge auto) |
| Filtre dashboard | "Masquer brouillons transformés" (coché par défaut, persistance localStorage) |
| Numérotation | `DRA-XXX` |
| Dashboard | Section "Brouillons" en bas (collapsible, ouverte par défaut) |
| Confirmation transformation | Modal avec récap détaillé + 2 cases à cocher |
| Mode de transformation | **RPC SQL atomique** `transformer_draft(p_slug)` |
| Transformation multiple | **Non** — un brouillon = 1 transformation max |
| Bouton "📋 Dupliquer en brouillon" | Disponible **même** sur brouillons transformés (cas variantes), s'ouvre en **nouvel onglet** |
| Boutons de copie depuis offre/commande | **Tous deviennent des brouillons** (Session 8). Aucun bouton ne crée plus directement une offre. |
| Mécanisme de copie | **POST direct `/api/drafts`** (Session 8 — Option A). Plus de localStorage. |
| Aperçu brouillon | Page print dynamique avec filigrane "BROUILLON — DRA-XXX" |
| Récap modal de transformation | Détail complet (Sous-total, Remise (X%), Services inclus, Arrondi, TVA, Total) — Session 9 fix `3cb1db6` |
| Lien public sur brouillon | **Bloqué** (vérifié Session 9 : `/offre/dra-XXX-XXXXX` retourne "introuvable") |
| Sauvegarde brouillon | Manuelle + auto-save 2 min |
| URL d'édition | Route dynamique `/drafts/[slug]/editer` |
| Filigrane | SVG inline data-URI, ambre `#f59e0b`, opacité 0.11, rotation -30° |
| Auto-print | **Aucun** nulle part |

---

## 🗒️ Notes par session (résumé)

Pour les détails complets des Sessions 1 à 8, voir versions précédentes du journal. Récap rapide :

- **Session 1 (2026-05-14)** — Table `drafts` créée + branche feature/brouillons (commit `11b4c36`)
- **Session 2 (2026-05-14)** — 5 routes API CRUD + RPC `next_dra_numero()` (commit `268b2fb`)
- **Session 3 (2026-05-14)** — Pages `/drafts/nouveau` + `/drafts/[slug]/editer` + composant partagé `DraftFormulaire.tsx` (commit `e72e2bc`)
- **Session 4 (2026-05-14)** — Page `/dashboard/draft/[slug]` lecture-seule (commit `J4VKQq9yD`)
- **Session 5 (2026-05-14)** — Transformation atomique via RPC SQL + modal (commit `c831bdf`)
- **Session 6 (2026-05-15)** — Section "Brouillons" sur dashboard + 5ème KpiCard
- **Session 7 (2026-05-15)** — Aperçu print brouillon avec filigrane (page autonome)
- **Session 8 (2026-05-15)** — Refonte des 4 boutons de copie + traçabilité Option A (commit `5b5956b`)

### Session 9 — Phase B (tests E2E) — Terminée le 2026-05-15

**16 tests E2E validés** en local sur la branche `feature/brouillons` :

**B1. CRUD brouillon** (4 tests)
- ✅ Création vide (DRA-016)
- ✅ Modification + persistance F5
- ✅ Suppression brouillon actif (confirm + DELETE)
- ✅ Suppression brouillon transformé bloquée (bouton grisé front)

**B2. Copies et duplications** (5 tests)
- ✅ Copie offre complète → brouillon (DRA-017)
- ✅ Copie offre sans client → brouillon (DRA-019)
- ✅ Libellés "commande" dynamiques (testé sur `cmd-80550-y1o2c`)
- ✅ Duplication brouillon actif (DRA-022, après fix `9e15263`)
- ✅ Duplication brouillon transformé (DRA-023 — cas variantes critique)

**B3. Traçabilité Supabase** (1 test multi-volet)
- ✅ `data.copiedFromOffreSlug` / `copiedFromDraftSlug` correctement persistés
- ✅ **Bug détecté + fix** : la traçabilité était écrasée au premier save → fix `604ff42` (préservation côté serveur dans PUT)
- ✅ Idempotence : la traçabilité survit à des saves successifs

**B4. Aperçu print + sécurité** (2 tests)
- ✅ Filigrane visible, pas de signature, pas de QR
- ✅ **Fix UX** : `TOTAL TTC (indicatif)` → `TOTAL TTC` (commit `9e40fd2`) car les chiffres sont identiques entre brouillon et offre
- ✅ Lien public `/offre/[slug-brouillon]` → "introuvable" (sécurité OK)

**B5. Transformation** (2 tests)
- ✅ Modal récap avec cases à cocher (garde-fou)
- ✅ **Bug UX détecté + fix** : la modal n'affichait pas le détail des totaux → fix `3cb1db6` (ajout Remise (X%), Services, Arrondi). Évite la confusion visuelle "calculs faux"
- ✅ Transformation effective DRA-019 → DEV-2026-058 validée bout-en-bout en SQL

**B6. Dashboard et régressions** (3 tests)
- ✅ Filtre "Masquer transformés" + lien `→ DEV-2026-XXX` cliquable
- ✅ Persistance localStorage (collapse + checkbox)
- ✅ 73 offres existantes accessibles + DEV-2026-011 (7 images d'ambiance lourdes) charge correctement

**4 fixes UX commités en Phase B** (chacun découvert par un test) :

| Commit | Description |
|---|---|
| `9e15263` | Duplication brouillon ouvre dans nouvel onglet (cohérence Session 8) |
| `604ff42` | Préserver clés traçabilité `copiedFrom*` lors du PUT (régression Session 8) |
| `9e40fd2` | Retirer mention "(indicatif)" du total dans aperçu brouillon |
| `3cb1db6` | Afficher détail des totaux (remise, services, arrondi) sur récap modal et page brouillon |

**Données de test résiduelles en base après Phase B :**
- DRA-016 supprimé (test B1.3)
- DRA-017, DRA-019 (transformé en DEV-2026-058), DRA-022, DRA-023 conservés
- DEV-2026-058 créé (transformation de DRA-019, client "Test Fix Tracabilite", montant 6441.80 CHF)

### Session 9 — Phase C + D
_(à exécuter dans un nouveau chat — voir section "Reprise rapide" en haut)_

---

## 🐛 Dette technique identifiée (HORS périmètre Session 9)

À traiter **après** le déploiement prod (post-Phase D). Aucun n'est bloquant.

| # | Sujet | Origine | Priorité | Statut |
|---|---|---|---|---|
| D1 | `client_numero_client` reste NULL sur offres créées par transformation | Session 5 | Basse | Ouvert |
| D2 | Mécanisme de création de fiche `clients` non reproduit côté transformation | Session 5 | Moyenne | Ouvert |
| D3 | Affichage "Type cible" cosmétique à nettoyer dans `app/dashboard/draft/[slug]/page.tsx` | Session 5 | Basse | Ouvert |
| D4 | `save/route.ts` utilise des URLs absolues avec fallback prod | Session 5 | Moyenne | Ouvert |
| D5a | Bug `ambianceImages` trop lourdes pour localStorage | Pré-chantier | — | ✅ **Résolu Session 8** |
| D5b | Aperçu offre en création/modification n'affiche pas badges stock | Session 7 (pré-chantier) | Moyenne | Ouvert |
| D6 | Code mort `?from_copy=1` + `localStorage["jc-offre-copy"]` dans `DraftFormulaire.tsx` (useEffect ~ligne 1145) et `app/offres/nouveau/page.tsx` | Session 8 | Basse | Ouvert |
| D7 | Affichage du pourcentage de remise manquant sur aperçu print offre et page brouillon (seul le montant CHF est affiché) — fix appliqué uniquement sur modal de transformation Session 9 | Session 9 | Moyenne | Ouvert |
| D8 | Fichier parasite `ezefijardin-confort-formulaire` tracké depuis commit `310d262` (chemin Windows mal échappé historique). Inerte. À supprimer dans un commit dédié `chore: cleanup historical garbage` | Pré-chantier (découvert Session 9) | Basse | Ouvert |
| R1 | Script d'import factures non versionné (local PC uniquement) | Audit Storage | Urgente | Ouvert |
| R2 | Google Drive perso sans backup tiers (10 ans de factures) | Audit Storage | Importante | Ouvert |
| R3 | Bucket `brand-logos` non régénérable | Audit Storage | Basse | Ouvert |

---

## 🗄️ Audit Supabase Storage

**Plan Supabase :** Pro (backups DB automatiques activés).

**⚠️ Important :** Les backups DB Supabase **n'incluent pas** les fichiers du Storage.

### Buckets actifs

| Bucket | Utilisé par | Régénérable ? |
|---|---|---|
| `brand-logos` | `app/api/brand-logos/upload/route.ts` | ❌ Non |
| `pdfs` | `app/api/offres/[slug]/pdf/route.ts`, `qr/route.ts` | ✅ Oui (pipeline HTML → pdf.co → pdf4me) |
| `factures` | Script d'import local depuis Google Drive | ✅ Oui (script idempotent) |
| `fiche-travail-pdf` | `app/api/offres/[slug]/fiche-travail-pdf/route.ts` | ✅ Probablement oui |

### Plan de mitigation (À FAIRE APRÈS DÉPLOIEMENT PROD)

- [ ] **R1** : déplacer le script d'import dans le repo, commit sur `main`
- [ ] **R2** : Google Takeout one-shot sur "Factures Winbiz"
- [ ] **R3** : backup manuel des logos via dashboard Supabase

### Impact sur le chantier brouillons

✅ **Aucun.** La table `drafts` stocke les `ambianceImages` en base64 dans JSONB, 100% couvert par backups DB.

---

## 🆘 En cas de problème en cours de Phase C/D

1. **Le chat plante :** ouvrir un nouveau chat, coller ce journal, indiquer la phase en cours et la dernière étape complétée.
2. **Un commit casse l'app :** `git revert HEAD` puis push.
3. **Migration SQL douteuse :** la table `drafts` peut être droppée sans impact (`drop table drafts cascade;`) tant qu'on n'a pas de brouillons transformés en prod.
4. **Déploiement prod casse :** `git revert <merge-commit>` + push → Vercel redéploie automatiquement l'état antérieur. La nouvelle table `drafts` peut rester vide en base.
5. **Clé Supabase régénérée mais Vercel pas synchro :** la prod actuelle peut tomber. Vérifier IMMÉDIATEMENT après régénération que la nouvelle clé est sur les 3 envs Vercel et que la prod répond.