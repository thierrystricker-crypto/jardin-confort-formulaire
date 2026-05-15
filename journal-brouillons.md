# Journal — Chantier "Brouillons" (drafts)

> **Pour reprendre dans un nouveau chat Claude :** colle ce fichier en première
> message. Il contient tout le contexte nécessaire pour reprendre où on s'est
> arrêté.

---

## 🚀 Reprise rapide — Phase D de Session 9 à démarrer

**État au 2026-05-15 (fin de Phase C de Session 9) :** Sessions 1 à 8 terminées.
Phase B (tests E2E) : 16/16 validés. **Phase C (sécurité) : terminée.** La clé
`SUPABASE_SERVICE_ROLE_KEY` legacy `eyJ...` a été migrée vers la nouvelle API
key Supabase `sb_secret_...`, et les clés JWT legacy ont été désactivées via
"Disable JWT-based API keys". La fuite de la Session 2 est définitivement
neutralisée.

**Branche `feature/brouillons` — dernier commit : `3cb1db6`** (inchangé depuis Phase B)

### Ce qui a été fait en Phase C (2026-05-15)

1. ✅ Identification : projet utilisait encore les clés Supabase JWT legacy (`eyJ...`)
2. ✅ Migration vers les nouvelles API keys Supabase :
   - `SUPABASE_SERVICE_ROLE_KEY` : `eyJ...` → `sb_secret_...`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` : `eyJ...` → `sb_publishable_...`
3. ✅ Mise à jour Vercel (3 envs : Production, Preview, Development)
4. ✅ Mise à jour `.env.local`
5. ✅ Prod redéployée et confirmée fonctionnelle sur nouvelles clés
6. ✅ Local confirmé fonctionnel sur nouvelles clés
7. ✅ **"Disable JWT-based API keys" cliqué côté Supabase** → clés legacy mortes
8. ✅ Smoke test post-désactivation : prod + local OK

### Effet de bord découvert pendant Phase C

**R1 promue de "Urgente" à "Critique"** : il existe **~50 scripts Node.js**
à la racine de `C:\Users\ezefi\` (familles `import-factures-*.js`,
`fix-factures-*.js`, `match-factures-*.js`, `verifier-clients-*.js`,
`creer-*.js`, `reassigner-*.js`, `audit-*.js`, `diagnostic-*.js`) qui
contiennent la clé legacy `eyJ...` **hardcodée**. Tous sont désormais
**cassés** (401 Supabase) depuis la désactivation. **Décision** : laissés
de côté volontairement (scope creep évité en pleine Phase C). Quand un
script sera nécessaire, à refactor proprement à ce moment-là avec lecture
depuis un `.env` (pas de re-hardcoding de la nouvelle clé `sb_secret_...`,
sinon on reproduit la dette).

### Pour démarrer Phase D dans le nouveau chat

- Coller le présent journal mis à jour
- Avoir accès au dashboard GitHub du repo
- Avoir accès Vercel pour suivre le build du Preview Deployment
- L'URL de la prod : `https://offres.jardin-confort.ch/dashboard`
- Ne pas oublier : la prod tourne déjà sur la nouvelle clé `sb_secret_...`, donc le merge `feature/brouillons` → `main` n'impacte **que le code**, pas les secrets.

**Risque MOYEN** — Phase D merge vers `main` et déclenche déploiement prod.
Rollback prévu via `git revert` (la table `drafts` peut rester en base sans impact).

---

## 🎯 Phase D à exécuter dans le nouveau chat

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

### Piège 6 — UI Supabase changeante : pas de "Reset" individuel sur clés JWT legacy

**Découvert en Session 9 Phase C.** L'UI Supabase 2026 a supprimé le bouton
"Reset" individuel sur les clés legacy `service_role` et `anon` (le bouton
dont parlent encore beaucoup de tutos / réponses Stack Overflow). Les deux
seules options disponibles aujourd'hui pour régénérer une clé legacy fuitée
sont :
- **Rotate JWT secret** (Settings → JWT Keys) : invalide simultanément `anon`
  ET `service_role`. Il faut alors **redéployer en mettant à jour les deux**.
- **Migrer vers les nouvelles API keys** `sb_publishable_...` / `sb_secret_...`
  (Settings → API Keys → onglet "Publishable and secret API keys") puis
  cliquer "Disable JWT-based API keys" dans l'onglet legacy. C'est la voie
  recommandée par Supabase aujourd'hui.

Les nouvelles clés sont auto-créées par Supabase sur les projets existants
et coexistent avec les legacy jusqu'à désactivation explicite.

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
| Clés Supabase | **Nouvelles API keys** `sb_publishable_...` / `sb_secret_...` (depuis Session 9 Phase C). Plus les anciennes JWT `eyJ...` legacy. |

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

### Session 9 — Phase C (sécurité) — Terminée le 2026-05-15

**Objectif** : régénérer la `SUPABASE_SERVICE_ROLE_KEY` fuitée en Session 2.

**Situation initiale découverte** : projet utilisait encore les clés Supabase
**JWT legacy** (`eyJ...`). L'UI Supabase 2026 a supprimé le bouton "Reset"
individuel sur ces clés. Deux nouvelles options sont proposées par Supabase :
les "Publishable / Secret API keys" (nouveau système non-JWT, recommandé) et
la rotation du JWT secret (invalide tout en bloc).

**Stratégie retenue** : migration vers les nouvelles API keys
(`sb_publishable_...` et `sb_secret_...`) en coexistence avec les legacy,
puis désactivation des legacy une fois la migration validée.

**Pourquoi cette stratégie** :
- Coexistence pendant la migration → zéro downtime
- Validation prod + local avant le clic irréversible
- Alignement avec la direction du produit Supabase
- Pas de nouveau format de variable côté code (mêmes noms d'env vars, juste les valeurs changent)

**Étapes effectuées dans l'ordre** :
1. Identification des clés actuellement utilisées (`eyJ...` legacy en local et en prod)
2. Récupération des nouvelles clés `sb_secret_...` et `sb_publishable_...` (déjà auto-créées par Supabase)
3. Mise à jour Vercel : `SUPABASE_SERVICE_ROLE_KEY` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` sur les 3 envs (Production, Preview, Development)
4. Redéploiement Vercel main → smoke test prod OK
5. Mise à jour `.env.local` + smoke test local OK
6. **"Disable JWT-based API keys"** cliqué dans l'onglet legacy de Supabase
7. Smoke test final post-désactivation : prod + local OK

**Effet de bord majeur découvert** : ~50 scripts ad-hoc à la racine de
`C:\Users\ezefi\` contiennent la clé legacy `eyJ...` hardcodée (familles
`import-factures-*`, `fix-factures-*`, `match-factures-*`,
`verifier-clients-*`, `creer-*`, `reassigner-*`, `audit-*`, `diagnostic-*`).
**Décision lucide** : ne pas étendre le scope de Phase C. Ces scripts cassent
au profit de la rotation effective (401 Supabase). À traiter dans un commit
dédié plus tard quand un script sera réellement nécessaire — avec lecture
d'un `.env`, **pas de re-hardcoding** de la nouvelle clé.

**Aucun commit git** créé pendant Phase C (rotation = env vars + Supabase
console, pas de modification du code source).

**Nouvelle dette** :
- D9 (ajoutée) : créer un `.env.example` versionné dans le repo pour
  documenter les noms des env vars requises

### Session 9 — Phase D
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
| D9 | Créer un `.env.example` versionné dans le repo pour documenter les noms des env vars Supabase requises (`SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_URL`) | Session 9 Phase C | Basse | Ouvert |
| R1 | Script d'import factures non versionné (~50 scripts à `C:\Users\ezefi\` avec clé legacy `eyJ...` hardcodée — **tous cassés depuis désactivation Phase C**). À refactor avec lecture `.env` au moment de réutilisation | Audit Storage + Session 9 Phase C | **Critique** | Ouvert |
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

- [ ] **R1** : déplacer le(s) script(s) d'import dans le repo (refactor `.env`), commit sur `main`
- [ ] **R2** : Google Takeout one-shot sur "Factures Winbiz"
- [ ] **R3** : backup manuel des logos via dashboard Supabase

### Impact sur le chantier brouillons

✅ **Aucun.** La table `drafts` stocke les `ambianceImages` en base64 dans JSONB, 100% couvert par backups DB.

---

## 🆘 En cas de problème en cours de Phase D

1. **Le chat plante :** ouvrir un nouveau chat, coller ce journal, indiquer la phase en cours et la dernière étape complétée.
2. **Un commit casse l'app :** `git revert HEAD` puis push.
3. **Migration SQL douteuse :** la table `drafts` peut être droppée sans impact (`drop table drafts cascade;`) tant qu'on n'a pas de brouillons transformés en prod.
4. **Déploiement prod casse :** `git revert <merge-commit>` + push → Vercel redéploie automatiquement l'état antérieur. La nouvelle table `drafts` peut rester vide en base.
5. **Erreur 401 Supabase quelque part :** la rotation Phase C a tué les clés legacy `eyJ...`. Vérifier que la prod et le local utilisent bien les nouvelles `sb_secret_...` / `sb_publishable_...` (Vercel Env Vars + `.env.local`). Si nécessaire récupérer les nouvelles clés via Supabase Dashboard → Settings → API Keys → onglet "Publishable and secret API keys".
6. **Un des ~50 scripts à `C:\Users\ezefi\` doit être relancé** : il renverra 401 Supabase (clé legacy désactivée Phase C). Le refactorer alors avec lecture depuis un `.env` (créer `C:\Users\ezefi\.env` avec la nouvelle `SUPABASE_SERVICE_ROLE_KEY=sb_secret_...`, et faire que le script lise `process.env.SUPABASE_SERVICE_ROLE_KEY` via un `require("dotenv").config()`). Ne **pas** re-hardcoder la nouvelle clé.
