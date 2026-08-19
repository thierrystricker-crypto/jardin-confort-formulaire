# JOURNAL — Chantier « Annexes et pièces jointes »

**Projet** : jardin-confort-formulaire
**Localisation** : `C:\Users\ezefi\jardin-confort-formulaire`
**Dépôt lié** : `jardi-mail-mcp` (connecteur MCP, même base Supabase)
**Production** : `https://offres.jardin-confort.ch`
**Cadrage de référence** : doc projet `14` ; démarrage consigné au doc `09`
**Dernière mise à jour** : 19.08.2026 — chantier CLOS (blocs 1 et 2 + correctifs)

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

## 6. Bloc 2 — suivi DRA → DEV → CMD et rattachement des scans (18-19.08)

Formulaire : branche `feat/annexes-suivi-et-rattachement` (`b65af16` + `2c8a73c`),
PR #42. Connecteur : branche `feat/draft-pieces-jointes` (`58b7730`), PR #4.

### Étape 4 — la recopie (demandée explicitement par Thierry le 18.08)

- `lib/annexes-suivi.ts` *(neuf)* : `recopierAnnexes()` — **ne lève jamais**,
  idempotente par `content_hash`, recopie catégorie/nom/libellé/`chemin`
  (jamais les fichiers), **conserve le `created_at` d'origine** (la date de
  dépôt fait partie de la preuve), ne recopie **jamais** `claude_file_id`
  (il pilote la purge : il n'existe que sur la ligne d'origine) ni les pièces
  supprimées.
- `transformer` : recopie DRA → DEV après la RPC, non bloquante,
  `annexesCopiees` dans la réponse. **La RPC `transformer_draft` n'est pas
  touchée.**
- `valider` : recopie DEV → CMD dans `after()`. D'abord placée en DERNIER
  (prudence maximale sur la route publique) — **prise en défaut au smoke test
  en moins d'une minute** : la chaîne PDF → stock dure 30-60 s et la carte de
  la commande paraissait vide. Déplacée en **tête** du bloc (3 requêtes
  Supabase, aucune interaction avec l'ordre PDF → stock).
- Vérifié en base sur DRA-815 → DEV-2026-724 → CMD-80908 : trois lignes, même
  `chemin` `draft/<uuid>.jpg`, `created_at` identique. Et la dédup 409 refuse
  un redépôt du même contenu sur un document qui le porte par recopie — y
  compris quand le fichier redéposé est le PNG d'origine ré-encodé JPEG par le
  navigateur : **le hash travaille sur le contenu préparé, pas sur le nom**.

### Étape 5 — le rattachement

- **`pieces_jointes_ids` en TABLEAU (max 8), pas l'id unique du doc `14` §6** :
  un scan multi-pages = plusieurs fichiers, le flux pousse à photographier
  page par page. Écart assumé et documenté.
- Le modèle ne voit que les `file_id` (copies de travail Anthropic) : il ne
  peut pas nommer une archive qu'on ne lui donne pas. `construireContenu`
  (page jardi) ajoute donc sous les fichiers un bloc texte
  « [Archives des fichiers joints — …nom → piece_id…] ».
- Connecteur : paramètre `pieces_jointes_ids` (zod `.uuid()`, describe
  détaillé), transmis tel quel à `POST /api/drafts` — aucun accès fichier
  côté MCP. `annexes_rattachees` / `annexes_non_rattachees` dans la sortie.
- `POST /api/drafts` : ne rattache qu'une ligne **encore orpheline**
  (`entity_id IS NULL`) et non supprimée — on ne vole jamais une pièce d'un
  autre dossier. Non bloquant, ids invalides ignorés.
- Vérifié en prod : DRA-817 porte son scan épinglé (`scan_commande`), qui
  suivra vers l'offre et la commande par l'étape 4.

## 7. ⚠️ La panne « Réponse vide », et son vrai diagnostic (nuit du 18 au 19)

**Symptôme** : après les merges, « prépare le brouillon » + scan → bulle rouge
« Réponse vide — réessaie », deux fois de suite ; les autres usages du chat
(stats, mails, lecture de scan) fonctionnaient.

**Premier faux coupable — le déploiement.** La PR #42 du formulaire n'était
**pas mergée** : Vercel montrait le bloc 2 en Preview seulement, la prod était
restée au journal (#41). Une PR ouverte a toute l'apparence du travail livré —
**vérifier la colonne Production de Vercel, pas le sentiment.** Après le vrai
merge, la panne persistait pourtant, par intermittence.

**La mesure plutôt que l'hypothèse** : la requête exacte a été rejouée hors
interface (fetch instrumenté dans le navigateur, flux SSE capturé). Verdict :
`stop_reason: "max_tokens"` — la route chat plafonnait à **4096 tokens de
sortie**, et **la réflexion étendue du modèle ET toute la boucle d'outils MCP
comptent dans la sortie**. Le régime §12 (réflexion + 10-15 appels d'outils)
crève ce plafond ; quand il tombe avant le premier bloc de texte, l'écran ne
montre rien. Selon la longueur de réflexion, ça passait ou cassait — d'où le
troisième essai réussi (DRA-817) sans qu'on ait rien changé.

**Correctifs** (`fix/chat-max-tokens-et-reflexion`, formulaire) :
`max_tokens` 4096 → **16384** ; les blocs `thinking` — jusqu'ici **ignorés par
la page** — affichent une puce « analyse » (l'écran n'est plus mort pendant la
réflexion) ; un `stop_reason: max_tokens` s'annonce en clair (« Réponse
interrompue — limite de longueur atteinte ») au lieu de passer pour une
réponse complète ou vide.

## 8. Correctifs nés des tests du 19.08

- **Les numéros d'articles manuscrits disparaissaient des lignes à la volée**
  (54063 : 4165, 4104, 4212, 4160, 5613 jugés ambigus au catalogue — 6 à 10
  variantes chacun — et perdus, alors que c'est ce dont le vendeur a besoin
  pour choisir la variante). Correctif **déterministe côté connecteur** : le
  serveur ajoute « — art. XXXX » au titre de toute ligne à la volée dont la
  référence cherchée est compacte et absente de la désignation. Le numéro
  s'imprime, comme sur tout document commercial.
- **« Michel » manuscrit rendu « Michel Gex » — un conseiller qui n'existe
  pas, complété par le modèle** (le motif D5, appliqué à un nom). Enjeu réel :
  le commercial se propage jusqu'au **modèle d'e-mail** préparé sur la fiche —
  un nom inventé serait parti en signature d'un mail client. Correctif
  déterministe côté connecteur : `rapprocherVendeur()` sur la **liste fermée**
  des six conseillers (nom complet, initiales, jetons/préfixes, repli prénom
  avec note « VÉRIFIER ») ; inconnu ou ambigu → valeur brute posée + signal
  « VENDEUR NON RECONNU », le menu déroulant forcera un choix manuel.
  ⚠️ **La liste vit désormais en DEUX endroits** : le menu déroulant de
  `DraftFormulaire.tsx` (~l. 1695, la source de vérité) et `CONSEILLERS` dans
  le connecteur. Un changement d'équipe se reporte aux deux.
  16 cas testés unitairement avant livraison (prénoms, noms, initiales,
  accents, ambigus, inconnus).

## 9. Pièges nouveaux, à ne pas rejouer

- **Une PR ouverte n'est pas un déploiement.** Le badge « Pull requests (1) »
  de GitHub et la colonne Environment de Vercel font foi, pas la mémoire
  d'avoir « mergé ».
- **La réflexion étendue et la boucle MCP comptent dans `max_tokens`.** Un
  plafond taillé pour du texte meurt en silence sur un flux à outils.
- **Les blocs `thinking` existent dans le flux** : une UI qui ne les connaît
  pas montre un écran mort — et un utilisateur qui réessaie.
- **L'écriture de classes regex `\uXXXX` a posé les caractères littéraux DEUX
  fois dans la même session** (contrôles `\u0000-\u001F`, diacritiques
  `\u0300-\u036f`). Vérifier `file` + `grep` après chaque écriture de regex.
- **Une réécriture python en mode texte avale les CRLF** (universal newlines) :
  relire les fins de ligne après toute retouche programmatique, juste avant de
  livrer.
- **Un correctif « prudemment placé en dernier » peut créer le bug visible**
  (recopie après la chaîne PDF : 60 s de carte vide). La prudence se mesure
  aux dépendances réelles, pas à la position dans le fichier.

## 10. Reste ouvert — fin de chantier

- ⬜ **Déchets de test à supprimer** : DRA-808, 809, 816, 817 ;
  DRA-815 → DEV-2026-724 → CMD-80908 (chaîne du smoke bloc 2) ; les annexes
  d'essai encore sur CMD-80666 ; et **6 scans orphelins** en base (re-uploads
  des 54063/54057 pendant les pannes) + les 4 doublons du 53858 (journal scan
  §10). SQL Editor, tracé.
- ⬜ **Pas de dédup à l'upload côté chat** (`/api/claude/upload`) : chaque
  re-soumission crée une ligne. Le motif 409 de `/api/pieces-jointes` est
  prêt à être transposé — petite tranche à part.
- ⬜ **Purge des orphelines : toujours PAS implémentée, à dessein.** L'étape 5
  existe désormais, mais les orphelins historiques et tout scan d'une
  conversation sans brouillon seraient détruits. À recadrer avec exclusion de
  `categorie = 'scan_commande'` — ne pas implémenter sans en reparler.
- ⬜ Vignettes : bandeau, pas de grille — à réviser si l'usage réel dépasse
  ~10 pièces par dossier.
- ⬜ Backlog séparé (doc `14` §3) : sauvegarde du Storage Supabase, qu'aucun
  backup de base ne couvre.
- 📔 Docs projet à mettre à jour en fin de chantier : `05` (backlog), `09`
  (avancement), `14` (statut : livré), `04` (pièges §9 ci-dessus),
  `08` (paramètre `pieces_jointes_ids` du connecteur).
