# JOURNAL — Chantier « Annexes et pièces jointes »

**Projet** : jardin-confort-formulaire
**Localisation** : `C:\Users\ezefi\jardin-confort-formulaire`
**Dépôt lié** : `jardi-mail-mcp` (connecteur MCP, même base Supabase)
**Production** : `https://offres.jardin-confort.ch`
**Cadrage de référence** : doc projet `14` ; démarrage consigné au doc `09`
**Dernière mise à jour** : 18.08.2026

> ⚠️ Fichier versionné (dépôt privé GitHub). **Aucun secret ici.**
>
> L'étape 1 du doc `14` (table `pieces_jointes` + bucket `annexes`) a été livrée
> par le **Lot 2 du chantier scan** — voir `journal-chantier-scan.md` §2. Ce
> journal ouvre au **bloc 1** : le dépôt manuel (étapes 2 et 3 du doc `14` §9).

---

## 🎯 Ce que fait le bloc 1

Permettre à un conseiller de **déposer des pièces dans un dossier** — plans du
client, photos de la terrasse ou de l'accès de livraison, bon de reprise, fiche
technique — depuis le dashboard, à tout moment, y compris après création de
l'offre ou de la commande, et de les **voir** dans une carte unique.

---

## 1. Pré-vol

`git status` sur **les deux dépôts** avant toute branche (leçon du 18.08,
doc `04` §3) : les deux arbres propres, sur `main` à jour. Diagnostic SQL en
lecture seule avant de coder : état réel conforme au journal du Lot 2 —
table de 16 colonnes, RLS sans policy, 0 trigger, 6 index ; bucket public
20 Mo / 5 MIME ; une seule policy sur `storage.objects` (SELECT `brand-logos`).
En base : 5 lignes, toutes `scan_commande` / `entity_id NULL`, dont **4 avec le
même `content_hash`** (le scan 53858 redéposé aux tests) — la dédup annoncée au
doc `14` §5.1 n'existait pas encore, confirmé dans la donnée.

## 2. Ce qui a été livré

Branche `feat/annexes-depot-manuel`, commits `d67395a` (bloc) + correctif
vignettes, mergés par pull request le 18.08. **Aucune migration SQL** : tout
existait déjà (Lot 2).

| # | Fichier | Rôle |
|---|---|---|
| 1 | `app/api/pieces-jointes/route.ts` *(neuf)* | POST multipart (un fichier par appel) + GET liste ; résolution de la cible par slug, dédup 409 par `content_hash`, ordre Storage → ligne avec retrait en cas d'échec |
| 2 | `app/api/pieces-jointes/[id]/route.ts` *(neuf)* | PATCH (liste blanche stricte : `libelle`, `categorie`) + DELETE **doux** (`supprime_at`) |
| 3 | `lib/preparer-fichier.ts` *(neuf)* | Préparation navigateur **extraite** de la page jardi : côté long 2000 px, JPEG 0.85, EXIF `from-image`, fond blanc anti-transparence-noire, plafond 4 Mo |
| 4 | `components/AnnexesBlock.tsx` *(neuf)* | La carte : bandeau de vignettes, aperçu fixe 600 px, zone de dépôt (existe même vide), scan épinglé + badge, libellé/catégorie éditables sur place, garde global `dragover`/`drop` |
| 5 | `app/dashboard/jardi/page.tsx` | Import de `lib/preparer-fichier` à la place du code local — aucun changement de comportement |
| 6 | `app/dashboard/[slug]/page.tsx` | +1 import, +1 bloc JSX (offres ET commandes) |
| 7 | `app/dashboard/draft/[slug]/page.tsx` | +1 import, +1 bloc JSX |

`proxy.ts` **non modifié** : `/api/pieces-jointes` n'est dans aucune liste
publique, donc protégé par défaut ; le cookie est revérifié dans les routes
(défense en profondeur, motif de `/api/claude/upload`).

## 3. Décisions prises pendant le chantier

- **`scan_commande` est réservé au flux du chat.** Ni déposable ni attribuable
  ni retirable à la main (PATCH le refuse dans les deux sens) : c'est ce qui
  garde au badge « preuve papier » son sens.
- **Suppression douce PARTOUT, brouillons compris.** Le doc `14` tolérait la
  suppression franche sur un brouillon ; une seule sémantique est plus simple et
  ne détruit jamais rien. Le fichier reste dans le bucket.
- **`ajoute_par` = le commercial du document** (sinon « Dashboard »). Pas d'UI
  d'identité : le code d'accès est partagé, il n'y a pas de session nominative.
- **Dédup au dépôt : 409 avec la pièce existante** (même hash, même dossier,
  non supprimée). Les 4 doublons historiques du chat restent hors périmètre
  (dossier NULL, autre écrivain).
- **Aperçu à hauteur FIXE (600 px) quel que soit le contenu** — décision née du
  smoke test : avec `max-h`, changer de vignette redimensionnait la carte et
  faisait perdre le cadrage de défilement. `h-[600px]` + `object-contain`.
- **La purge des orphelines du doc `14` §6 n'est PAS implémentée, même
  partiellement.** Écrite telle quelle, elle effacerait 100 % des scans du chat
  (`entity_id NULL` tant que l'étape 5 n'est pas faite) et tout plan déposé
  avant création du document. À reparler après l'étape 5, avec exclusion de
  `categorie = 'scan_commande'`.

## 4. Vérifications

- **Typecheck en miroir avant livraison** : dépôt complet reconstitué (npm ci
  sur le lock, Next 16.2.3 / React 19.2.4 / TS 5.9, tsconfig réel),
  `tsc --noEmit` **0 erreur** — puis confirmé sur le poste. Lint ciblé sur les
  7 fichiers : 0 erreur (4 warnings préexistants, hors des lignes du lot).
- **Fins de ligne vérifiées octet par octet** : les 7 fichiers en CRLF,
  UTF-8 sans BOM (doc `04` §3 : l'encodage se décide par fichier).
- **Smoke test preview sur `CMD-80666`** (la preview écrit dans la vraie base) :
  dépôt multiple ✅, dédup 409 ✅, édition libellé/catégorie ✅, garde
  anti-navigation ✅, retrait doux ✅, carte vide sur brouillon ✅.
- **Contrôle SQL après coup** (un défaut sans erreur ne se voit que dans les
  données) : 4 lignes, `entity_type='commande'` / `entity_id=539` résolus,
  chemins tous en `commande/<uuid>.jpg` sans nom d'origine, accents intacts en
  base, hash présents, `claude_file_id` NULL partout, `supprime_at` posé
  6 secondes après le dépôt de la pièce retirée.
- Captures PNG bien ré-encodées JPEG par le pipeline navigateur (~150 Ko).

## 5. Pièges (nouveaux ou confirmés)

- **Une hauteur d'aperçu variable fait sauter la page au changement de
  sélection.** `max-h` ne suffit pas : la carte se redimensionne et le
  défilement se perd. Hauteur fixe + `object-contain`.
- **Écrire une classe regex de caractères de contrôle via un outil d'écriture
  peut poser les caractères EUX-MÊMES dans le fichier** (fichier devenu
  « binaire » pour grep). Toujours la forme échappée `\u0000-\u001F\u007F`, et
  vérifier avec `file`/`grep` après écriture.
- Confirmé : les blocs du dashboard **se fetchent eux-mêmes** — le branchement
  d'une carte dans une page de 1700 lignes tient en 1 import + 1 bloc JSX,
  aucun state partagé.

## 6. Reste ouvert (le chantier continue)

- 🟡 **Étape 4 — le suivi DRA → DEV → CMD, demandé explicitement par Thierry
  le 18.08** : en l'état, une annexe reste sur le document où elle a été
  déposée ; la transformation crée un nouveau slug. Décision doc `14` §7 :
  **recopie des lignes** (fichiers jamais dupliqués, même `chemin`). Piste
  d'implémentation : côté routes (`/api/drafts/[slug]/transformer` et
  `/api/offres/[slug]/valider`, recopie non bloquante), **sans toucher la RPC**
  `transformer_draft`.
- 🟡 **Étape 5 — rattachement des scans du chat** : paramètre `piece_jointe_id`
  sur `offre_draft_creer` (connecteur), posé par `POST /api/drafts`. Sans elle,
  les scans restent `entity_id NULL` et invisibles de la carte.
- ⬜ Les 5 lignes de test du chat (dont 4 doublons du scan 53858) et
  DRA-808/809 : déchets de test à nettoyer (déjà noté au journal scan §10).
- ⬜ Vignettes : bandeau, pas de grille — à réviser si l'usage réel dépasse
  ~10 pièces par dossier.
- ⬜ Purge des orphelines : voir §3, ne pas implémenter sans en reparler.
