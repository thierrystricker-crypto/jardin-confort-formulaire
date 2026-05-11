# JOURNAL — Feature `complement_nom`
Projet : `jardin-confort-formulaire`
Localisation : `C:\Users\ezefi\jardin-confort-formulaire`
Production : `https://offres.jardin-confort.ch`

---

## 🎯 Objectif global de la feature

Ajouter un champ texte libre **`complement_nom`** (et son pendant livraison `livr_complement_nom`) dans tout le système, pour gérer les cas réels :
- "et Marie" (conjoint)
- "c/o Crédit Suisse" (chez quelqu'un)
- "Mesdames Roca et De Marco" (contact société)
- "M. & Mme Untel" (couple)

**Affichage final attendu** sur tous les documents — ordre fixe :
```
[Société]
Nom Prénom
[Complément nom]      ← le nouveau champ
Rue No
Complément d'adresse
NPA Ville
```

---

## 📐 Décisions architecturales (gravées dans le marbre)

1. **1 seul champ texte libre** par adresse (facturation + livraison)
2. **Ordre final** : `societe → nom prenom → complement_nom → rue → rue2 → npa+ville`
3. **Affichage sur TOUS les documents** : offre / commande / fiche travail / bulletin / page garde / fiche bleue / print all / page web client
4. **EXCLUSION ABSOLUE — QR paiement** : `app/api/offres/[slug]/qr/route.ts` reste INTOUCHABLE (norme Swiss QR-bill stricte)
5. **`livr_complement_nom`** avec **héritage auto** depuis facturation si `!livrDiff` (cas 95%)
6. **Règle d'or** : ajouter le champ, **JAMAIS** changer la logique existante (Option 1 retenue, pas de helper centralisé)
7. **Pas de migration rétroactive** ni régénération PDFs anciens
8. **Matcher WinBiz non touché** (les imports historiques continuent sans cette donnée)
9. **Label final formulaire** : `"Complément nom (optionnel)"` + hint `(conjoint, c/o, contact...)`
10. **Label distinct de `rue2`** : `rue2` est renommé `"Complément d'adresse"` partout dans la fiche client pour éviter toute ambiguïté

---

## ✅ PHASE 1 — Backend (TERMINÉE)

### Migration SQL exécutée sur Supabase
4 colonnes ajoutées :
- `clients.complement_nom TEXT`
- `clients.livr_complement_nom TEXT`
- `offres.client_complement_nom TEXT` (colonne plate dénormalisée, à l'image des autres `client_*`)
- `offres.livr_complement_nom TEXT`

Fichier source : `/mnt/user-data/outputs/migration-complement-nom.sql` (session précédente)

### Types TypeScript (`lib/jc-print-types.ts`)
- `complement_nom?: string` ajouté après `prenom`
- `livr_complement_nom?: string` ajouté après `livrPrenom`
- Optionnels (`?`) pour compat ascendante avec offres antérieures à la feature

### Helper ABANDONNÉ
Le fichier `lib/format-client.ts` a été créé puis **abandonné** au profit de l'Option 1 (chaque template JSX ajoute son propre bloc). Plus simple, moins risqué, respecte la règle d'or.

---

## ✅ PHASE 2 — UI saisie (TERMINÉE le 11 mai 2026)

### Fichiers patchés et commités

#### 1. `app/offres/nouveau/page.tsx` (formulaire principal)
- `DraftSnapshot` : ajout `complement_nom` après `prenom`, `livr_complement_nom` après `livrPrenom`
- `useState` : `complementNom` et `livrComplementNom`
- `clientSuggestions` type : ajout des 2 champs
- `applyClient()` : `setComplementNom(c.complement_nom || "")`
- `makeSnapshot()` : `complement_nom: complementNom`, `livr_complement_nom: livrComplementNom`
- `saveToSupabase()` body POST clients : ajout `complement_nom` + `livr_complement_nom`
- `loadDraftLocal()` : restauration depuis snapshot
- `resetForm()` : `setComplementNom("")` + `setLivrComplementNom("")`
- **useEffect prefill** (ligne ~611) : `if (p.complement_nom) setComplementNom(p.complement_nom)` + `if (p.numero) setNumero(p.numero)`
- **useEffect from_copy** (ligne ~583) : `if (p.complement_nom) setComplementNom(p.complement_nom)` + `if (p.livr_complement_nom) setLivrComplementNom(p.livr_complement_nom)` + `if (p.numero) setNumero(p.numero)`
- **Input JSX facturation** : entre nom/prenom et rue (ordre `societe → nom prenom → complement → rue`)
- **Input JSX livraison** : entre Nom/Prénom livraison et Rue livraison

#### 2. `app/dashboard/clients/[id]/page.tsx` (fiche client)
- Type `Client` : ajout `complement_nom` + `livr_complement_nom`
- Liste édition principale : ordre `Société → Nom → Prénom → Complément nom (optionnel) → Rue → Complément d'adresse → ...`
- Liste édition livraison : idem
- Affichage display principal : idem ordre
- Affichage display livraison : idem ordre
- **2 URLs prefill** (header + état vide) : ajout `complement_nom: client.complement_nom || ""` + `numero: client.numero_rue || ""`

#### 3. `app/dashboard/[slug]/page.tsx` (dashboard offre individuelle)
- Bouton "👤 Nouvelle offre même client" : URL prefill avec `complement_nom` et `numero` depuis `offre.data` (JSONB, pas colonnes plates car ces champs n'y sont pas)
- Fonction `copierOffre()` : ajout dans le bloc `if(avecClient)` : `complement_nom: (offreData.complement_nom as string) || ""`, `livr_complement_nom: (offreData.livr_complement_nom as string) || ""`, `numero: (offreData.numero as string) || ""`

#### 4. `app/api/clients/route.ts`
- Type `Client` patché
- `POST` destructure `complement_nom` + `livr_complement_nom`
- Insert en base avec ces 2 champs

#### 5. `app/api/clients/[id]/route.ts`
- Liste `allowed` du PATCH : `complement_nom` + `livr_complement_nom`

#### 6. `app/api/offres/save/route.ts`
- Row construite avec `client_complement_nom: data.complement_nom` + `livr_complement_nom: data.livr_complement_nom`

#### 7. `app/api/offres/[slug]/valider/route.ts`
- Payload webhook Make : ajout `complement_nom` + `livr_complement_nom`

### Commit Phase 2
```
feat(complement-nom): phase 2 complete - prefill propre (formulaire + fiche client + dashboard offre)
```

### Tests Phase 2 effectués et validés ✅
1. ✅ Création client avec complément en fiche → persistance OK
2. ✅ Fiche client → "+ Nouvelle offre" → complément + numéro rue arrivent dans le formulaire
3. ✅ Création offre, enregistrement → données stockées en base et JSONB
4. ✅ Dashboard offre → "👤 Nouvelle offre même client" → idem
5. ✅ Dashboard offre → "📋 Copier offre complète" → idem + lignes articles préservées
6. ✅ Édition fiche client, ajout complément, sauvegarde, rechargement → persistance OK
7. ⚠️ **PDFs n'affichent PAS encore le complément** (volontaire, c'est la Phase 3)

---

## 🐛 Bugs trouvés et corrigés pendant la Phase 2

| Bug | Description | Statut |
|---|---|---|
| 1 | Preview `/print/offre` ne montre pas le complément | NORMAL — sera fait Phase 3 |
| 2 | Ordre champ complément dans formulaire (placé après société au lieu d'après prénom) | Corrigé |
| 3 | Label "Complément" ambigu avec `rue2` (complément d'adresse) | Renommé `"Complément nom (optionnel)"` |
| 4 | Fiche client n'affichait pas les nouveaux champs | Patchs appliqués (type + édition + display) |
| 5 | URL prefill fiche client ne reprenait pas `complement_nom` ni `numero_rue` (le numéro était un bug PRÉ-EXISTANT) | Corrigé sur les 2 URLs |
| 6 | Boutons "Copier offre" du dashboard ne reprenaient pas complément + numéro | Corrigé (URL prefill + localStorage) |
| 7 | Bloc `from_copy` du formulaire ne lisait pas `complement_nom` ni `livr_complement_nom` | Corrigé |

---

## 🚀 PHASE 3 — Templates d'affichage (À FAIRE — NON DÉMARRÉE)

### 🎯 Objectif
Afficher le champ `complement_nom` (et `livr_complement_nom` avec héritage auto) sur **tous les documents générés** sans exception, sauf le QR paiement.

### 🛡️ Règle d'or à respecter ABSOLUMENT
- **Pattern strict identique partout** (Option 1, pas de helper)
- **Ne JAMAIS toucher la logique existante**, juste **ajouter** le bloc complément à la bonne position
- **Champ optionnel** : afficher uniquement si présent (`{data.complement_nom && <div>{data.complement_nom}</div>}`)

### 📋 Pattern à utiliser

**Bloc facturation (simple) :**
```jsx
{data.societe && <div>{data.societe}</div>}
<div style={{fontWeight:700}}>{data.nom} {data.prenom}</div>
{data.complement_nom && <div>{data.complement_nom}</div>}   {/* ← AJOUT */}
{data.rue && <div>{data.rue} {data.numero}</div>}
{data.rue2 && <div>{data.rue2}</div>}
<div>{data.npa} {data.ville}</div>
```

**Bloc livraison (avec héritage auto) :**
```jsx
{data.livrDiff ? (
  <>
    {data.livrSociete && <div>{data.livrSociete}</div>}
    <div style={{fontWeight:700}}>{data.livrNom} {data.livrPrenom}</div>
    {data.livr_complement_nom && <div>{data.livr_complement_nom}</div>}   {/* ← AJOUT */}
    {data.livrRue && <div>{data.livrRue} {data.livrNumero}</div>}
    {data.livrRue2 && <div>{data.livrRue2}</div>}
    <div>{data.livrNpa} {data.livrVille}</div>
  </>
) : (
  /* Hérite de la facturation, complement_nom inclus */
  <>
    {data.societe && <div>{data.societe}</div>}
    <div style={{fontWeight:700}}>{data.nom} {data.prenom}</div>
    {data.complement_nom && <div>{data.complement_nom}</div>}   {/* ← AJOUT */}
    {data.rue && <div>{data.rue} {data.numero}</div>}
    {data.rue2 && <div>{data.rue2}</div>}
    <div>{data.npa} {data.ville}</div>
  </>
)}
```

⚠️ **Variante condensée pour blocs avec héritage** (utilisée dans certains fichiers existants) :
```jsx
{(data.livrDiff ? data.livr_complement_nom : data.complement_nom) && (
  <div>{data.livrDiff ? data.livr_complement_nom : data.complement_nom}</div>
)}
```

### 📁 Fichiers à patcher (8 fichiers, ~10-12 blocs JSX au total)

| Fichier | Blocs à patcher | Notes |
|---|---|---|
| `app/print/offre/[slug]/page.tsx` | 3 blocs : window snapshot + facturation + livraison | Template offre signée serveur |
| `app/print/offre/page.tsx` | 2-3 blocs : preview standalone (localStorage) | C'EST CE QUE THIERRY VOIT en preview |
| `app/print/fiche-travail/[slug]/page.tsx` | ~3 blocs : window livraison + bloc billing + adresse | Interne |
| `app/print/bulletin-livraison/[slug]/page.tsx` | 3 blocs | Sans prix, joint au colis |
| `app/print/page-garde-colis/[slug]/page.tsx` | 1 bloc livraison hybride | Page de garde A4 |
| `app/print/fiche-bleue/[slug]/page.tsx` | 3 blocs info | Archive classeur papier |
| `app/print/all/[slug]/page.tsx` | ~10 blocs sur 5 sections | **PAS de section QR** (déjà séparée) — réimplémente tout, patches indépendants |
| `app/offre/[slug]/page.tsx` | 2 blocs : addrFact + addrLivr | Page web client (validation/signature) |

### 🛑 Fichiers À NE PAS TOUCHER

| Fichier | Pourquoi |
|---|---|
| `app/api/offres/[slug]/qr/route.ts` | Swiss QR-bill — norme stricte, format figé |
| `lib/shopify-orders.ts` | Shopify push commande — pas de complément côté Shopify |
| `lib/shopify-stock.ts` | Stock Shopify uniquement |
| `lib/shopify-pdf-urls.ts` | URLs PDFs Shopify Order Printer Pro |
| Matcher WinBiz | Imports historiques, hors scope |

### 🔍 Procédure de travail recommandée pour Phase 3

**Étape par étape, fichier par fichier :**

1. **Commencer par** `app/print/offre/page.tsx` (preview standalone) — le plus important pour les tests visuels rapides.
2. Pour chaque fichier :
   - Demander à Thierry de l'**uploader** dans le chat
   - Identifier les blocs d'adresse (chercher `client_nom`, `data.nom`, `livr_nom`, etc.)
   - Livrer les patches `Cherche / Remplace par` précis
   - Thierry applique
   - Test visuel sur une offre/commande de test (ex: `https://offres.jardin-confort.ch/print/offre/dev-2026-001-ylxzj`)
3. **Pas besoin de tout faire dans la même session.** Chaque fichier peut être traité indépendamment, tant que le pattern est respecté.
4. Commit après chaque fichier (ou groupe de 2-3) :
   ```
   feat(complement-nom): phase 3 - affichage sur <nom-du-template>
   ```

### 🧪 Tests Phase 3 à faire au fur et à mesure

Pour chaque fichier patché, ouvrir une offre de test (avec `complement_nom` rempli) et vérifier :
- ✅ Le complément s'affiche **après** Nom/Prénom et **avant** Rue
- ✅ Si pas de complément en base, **rien ne s'affiche** (le bloc disparaît proprement)
- ✅ Pour la livraison : si `livrDiff=false`, le complément de **facturation** est repris (héritage auto)
- ✅ Pour la livraison : si `livrDiff=true`, le `livr_complement_nom` est utilisé
- ✅ Aucun bug d'affichage sur les anciennes offres (champ absent) — affichage robuste

### 🎁 Cas de test à préparer
Créer 3 offres de test dans le système :
- **TEST-1** : couple Privé sans société, avec `complement_nom = "et Marie"`, livraison identique
- **TEST-2** : société Pro avec contact, `complement_nom = "À l'attention de Mme Dupont"`, livraison différente avec `livr_complement_nom = "À l'attention de M. Martin"`
- **TEST-3** : offre ancienne SANS complément (vérifier non-régression : rien ne doit casser, juste pas de ligne complément)

---

## 📊 État final base de données après Phase 2

### Tables modifiées
```sql
-- clients (3053 lignes)
clients.complement_nom         TEXT NULL  -- vide pour tous les anciens clients
clients.livr_complement_nom    TEXT NULL  -- vide pour tous les anciens clients

-- offres (varie)
offres.client_complement_nom   TEXT NULL  -- vide pour toutes les anciennes offres
offres.livr_complement_nom     TEXT NULL  -- vide pour toutes les anciennes offres

-- + JSONB offres.data inclut désormais snap.complement_nom et snap.livr_complement_nom
```

### Snapshots formulaire
Le `DraftSnapshot` (sauvegardé en `localStorage` clé `jc-offre-v15-draft` ET en JSONB `offres.data`) contient désormais :
- `complement_nom: string` (entre `prenom` et `rue`)
- `livr_complement_nom: string` (entre `livrPrenom` et `livrTel`)

---

## 🗺️ Cartographie complète des flux de données

### Flux 1 : Création client direct depuis fiche
```
fiche client édition → API /api/clients POST → DB clients.complement_nom
```

### Flux 2 : Création client via formulaire offre
```
formulaire /offres/nouveau → saveToSupabase() → API /api/clients POST → DB
                                              ↓
                          → API /api/offres/save POST → DB offres.client_complement_nom + JSONB data
```

### Flux 3 : Prefill formulaire depuis fiche client
```
bouton "+ Nouvelle offre" fiche client
  → URL ?prefill={...,complement_nom,numero}
  → useEffect prefill dans nouveau/page.tsx
  → setComplementNom() + setNumero()
```

### Flux 4 : Copie offre complète depuis dashboard
```
dashboard offre → bouton "📋 Copier offre complète"
  → copierOffre(true) écrit dans localStorage "jc-offre-copy" (avec complement_nom + livr_complement_nom + numero)
  → ouvre /offres/nouveau?from_copy=1
  → useEffect from_copy lit localStorage et setComplementNom() + setLivrComplementNom() + setNumero()
```

### Flux 5 : Conversion offre → commande
```
dashboard offre → "✅ Convertir en commande"
  → API /api/offres/[slug]/valider POST
  → crée nouvelle row offres (type Commande) avec JSONB data copié (inclut complement_nom)
  → webhook Make payload inclut complement_nom + livr_complement_nom
```

### Flux 6 (Phase 3) : Affichage sur templates
```
PDF templates → lit depuis JSONB offres.data (ou snapshot localStorage pour preview)
  → affiche data.complement_nom au bon endroit
```

---

## 🚨 Points d'attention pour la suite (Phase 3 et après)

### À propos de la cohérence des données

1. **Pour les anciennes offres (avant 11 mai 2026)** :
   - `offres.client_complement_nom = NULL`
   - `JSONB data.complement_nom` inexistant
   - **Affichage Phase 3 doit gérer ces cas** (le `{data.complement_nom && ...}` suffit)
   - Pas de migration rétroactive prévue

2. **Pour les nouveaux clients créés à partir d'aujourd'hui** :
   - Si saisi dans le formulaire offre → présent partout
   - Si saisi dans la fiche client → présent en DB clients seulement
   - **Pas de propagation rétroactive** vers les offres existantes du client

### Cas limites à tester

- Client avec `complement_nom` mais sans société : doit afficher `Nom Prénom / Complément / Rue`
- Client avec société et `complement_nom` : doit afficher `Société / Nom Prénom / Complément / Rue`
- Livraison `livrDiff=true` avec `livr_complement_nom` vide mais `complement_nom` facturation rempli : la livraison ne doit PAS hériter (livrDiff coupe l'héritage)
- Offre ancienne sans aucun complément : aucun affichage parasite

### Workflow git habituel
```powershell
cd C:\Users\ezefi\jardin-confort-formulaire
git add .
git commit -m "<message>"
git push
```

---

## 📦 Fichiers de référence livrés dans `/mnt/user-data/outputs/`

Session précédente (et antérieurs) :
- `migration-complement-nom.sql` (Phase 1)
- `lib-format-client.ts` (helper finalement abandonné)
- `PATCH-types.md` (guide patches types Phase 1)
- Scripts audit factures WinBiz (autre feature)

---

## 🎬 Prochaine session — Comment reprendre

1. **Charger ce JOURNAL.md** dans le chat (à uploader en premier)
2. Annoncer **"Phase 2 OK, on attaque Phase 3"**
3. Uploader le premier fichier à patcher (recommandé : `app/print/offre/page.tsx`)
4. Suivre la procédure étape par étape décrite ci-dessus
5. Tester chaque fichier indépendamment avant de passer au suivant
6. Commits réguliers, un par fichier ou groupe (3 max)

### Commande de relance ultra-courte pour la prochaine session
```
Phase 2 du complement_nom OK et commité. On attaque Phase 3 — affichage 
sur les templates PDF + page web client. Voici le journal et le premier 
fichier à patcher : [uploader JOURNAL.md + app/print/offre/page.tsx]
```

---

## 🏁 Récapitulatif progression feature

| Phase | Description | Statut |
|---|---|---|
| Phase 1 | Backend DB + types | ✅ TERMINÉE |
| Phase 2 | UI saisie (formulaire + fiche client + APIs + dashboard offre + webhook) | ✅ TERMINÉE (11 mai 2026) |
| Phase 3 | Affichage templates PDF + page web client | ⏳ À FAIRE |
| Phase 4 | Tests cas limites + validation finale | ⏳ À FAIRE après Phase 3 |

**Estimation Phase 3** : 1 à 2 sessions de chat (8 fichiers, ~10-12 blocs JSX, patches répétitifs).

---

*Journal généré le 11 mai 2026 — fin de Phase 2*
