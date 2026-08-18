# JOURNAL — Chantier « scan des commandes magasin manuscrites »

**Projet** : jardin-confort-formulaire
**Localisation** : `C:\Users\ezefi\jardin-confort-formulaire`
**Dépôt lié** : `jardi-mail-mcp` (connecteur MCP, même base Supabase)
**Production** : `https://offres.jardin-confort.ch`
**Dernière mise à jour** : 18.08.2026

> ⚠️ Fichier versionné (dépôt privé GitHub). **Aucun secret ici.**
>
> Ce journal ouvre au **Lot 2**. Les Lots 0 et 1 vivent dans le connecteur et
> sont consignés dans `journal-mcp-mail.md` §14 et §15 ; le Lot 3 (prompt
> système) n'avait jusqu'ici **aucun journal** — c'est une des raisons pour
> lesquelles son état réel a échappé à tout le monde pendant 20 heures (§1).

---

## 🎯 Ce que fait le Lot 2

Permettre à un vendeur de soumettre au chat Jardi la **photo ou le scan d'une
commande magasin manuscrite**, pour que Jardi la lise et dépose un brouillon
`DRA-XXX`. C'est le lot qui rend atteignable la §12 du prompt système —
livrée au Lot 3, mais **inerte** tant qu'aucun fichier ne pouvait entrer.

Le piège central, énoncé au cadrage : un fichier en base64 dans l'historique du
chat. Un PDF de 2 Mo pèse ~2,7 millions de caractères, soit **45 fois** le budget
de 60 000, et repartirait **à chaque tour**.

---

## 1. ⚠️ Pré-vol — le Lot 3 n'était pas committé

Le cadrage exigeait un pré-vol bloquant : vérifier que la §12 « Régime reprise de
document » était bien sur `main`. Elle n'y était pas. La lecture directe de
`.git/` (doc `04` §3) a donné :

```
refs/heads/main                      4521f83…
refs/remotes/origin/main             4521f83…
refs/heads/feat/prompt-regime-reprise 4521f83…   ← le MÊME
```

Aucun `refs/remotes/origin/feat/prompt-regime-reprise`. Le reflog s'arrêtait sur
`checkout: moving from main to feat/prompt-regime-reprise`, **sans aucune entrée
`commit:` après**. Et `chat/route.ts` sur le disque faisait 23 908 octets contre
17 233 sur GitHub, avec la §12 complète, modifié trois minutes avant la création
de la branche.

**Ce n'était donc pas « un commit non poussé » : c'était du travail non
sauvegardé**, qu'un `git checkout` malheureux effaçait. Pendant ce temps le doc
`12` §11 et le doc `08` §3 le déclaraient « livré et déployé ».

Commité (`5431533`) puis mergé dans `main` (`4b6399b`) avant la moindre ligne de
Lot 2 — le Lot 2 patche le même fichier.

### Le motif, et il s'est répété quatre fois dans la journée

| # | Où | Quoi |
|---|---|---|
| 1 | formulaire, matin | §12 du Lot 3, jamais committée |
| 2 | connecteur, soir | **le paramètre `client` du Lot 1**, jamais committé (§6) |
| 3 | formulaire | branche créée dans le mauvais dépôt |
| 4 | formulaire | correctif §12.2/§12.3 laissé non committé en changeant de dépôt |

**Rien sur le poste ne signale un arbre sale, et un `git status` oublié ne fait
aucun bruit.** Le doc `04` §3 exige déjà un `git status` après le `checkout -b` ;
il en faut visiblement un aussi **avant de changer de dépôt et avant de fermer
une session**. Le coût d'un oubli n'est pas le désordre : c'est un journal qui
affirme une livraison qui n'existe pas, et des diagnostics faux construits
dessus (§6).

---

## 2. Ce qui a été livré

Branche `feat/chat-upload-fichier`, 3 commits (`2508915`, `1ccfc94`, `96956e0`).

| # | Fichier | Rôle |
|---|---|---|
| 0bis | `docs/sql/009-annexes-pieces-jointes.sql` | table `pieces_jointes` + bucket `annexes` |
| 1 | `app/api/claude/upload/route.ts` *(neuf)* | double écriture : archive Supabase **puis** API Files |
| 2 | `app/api/claude/chat/route.ts` | liste blanche de blocs, projection, beta ajouté, §12.2/§12.3 |
| 3 | `app/api/claude/conversations/route.ts` | champ `fichiers` accepté |
| 4 | `app/dashboard/jardi/page.tsx` | trombone, glisser-déposer, resize, puces, périmés |
| 5 | `app/api/cron/claude-files-purge/route.ts` + `vercel.json` | purge TTL 24 h |

`proxy.ts` **non modifié** : `/api/claude/upload` n'étant dans aucune liste
publique, il est protégé par défaut. Le piège des flux serveur→serveur (blackout
des 8 jours, doc `04` §8) n'est donc pas réveillé.

### La confidentialité tient à l'ordre d'écriture, pas à une discipline

```
1. Storage Supabase (bucket annexes)  ← l'archive, jamais purgée
2. ligne pieces_jointes                ← ce qui pilote la purge
3. API Files d'Anthropic               ← la copie de travail, TTL 24 h
4. claude_file_id posé sur la ligne    ← ce qui la rend purgeable
```

Si 1 ou 2 échoue, **rien ne part chez Anthropic**. Si 4 échoue après 3, la copie
serait invisible de la purge donc **ineffaçable** : elle est supprimée
immédiatement et l'upload refusé. Une archive locale orpheline ne coûte rien ;
une copie non purgeable chez un tiers, si.

**La purge est pilotée par notre table**, jamais par `GET /v1/files` : on ne
supprime que ce dont on détient une copie, et on ne touche jamais un fichier
déposé dans le workspace par un autre usage.

---

## 3. Décisions prises pendant le chantier

- **Purge horaire (`40 * * * *`), pas quotidienne.** Avec une passe par jour et
  un TTL de 24 h, un scan déposé juste après le passage attend jusqu'à **47 h** —
  la promesse « effacé au plus tard le lendemain » serait fausse. En horaire, le
  pire cas est 25 h, pour une requête qui ne trouve presque toujours 0 ligne.
  `shopify-sync` est à `:15`, la purge à `:40`.
- **Bucket `annexes` public, comme les trois existants.** Critère retenu par
  Thierry : *« public si comme l'URL de l'offre avec un slug »*. Il est rempli, et
  largement — le chemin est `chat/<uuid v4>`, soit **122 bits** d'aléa contre ~25
  pour la partie aléatoire d'un slug d'offre, dont le numéro est séquentiel.
  Vérifié en base : `storage.objects` ne porte **qu'une seule policy**, un SELECT
  public sur `brand-logos`. `anon` ne peut donc pas **énumérer** `annexes` — seul
  l'accès par chemin exact fonctionne.
  ⚠️ **Constaté, pas supposé** : le PDF d'un scan nominatif a été ouvert depuis
  une machine tierce, sans cookie, avec la seule URL. **Une URL d'annexe qui fuit
  donne le document, à n'importe qui, pour toujours.**
- **`MAX_BLOCS = 20`** par message côté serveur, 8 fichiers côté navigateur.
- **Redimensionnement navigateur obligatoire** — ce n'est pas une optimisation :
  Vercel plafonne le corps d'une fonction à **~4,5 Mo**, les 32 Mo de l'API
  Anthropic sont hors d'atteinte. Côté long à 2000 px, JPEG 0.85, EXIF appliqué.

---

## 4. Ce que la revue adversariale a rattrapé

Le patch a été soumis à une relecture contradictoire avant livraison. Neuf
défauts ancrés, huit corrigés. Les trois qui comptent :

### Le piège base64 n'était PAS fermé — et le commentaire prétendait le contraire

`estMessageValide` contrôlait la **forme** des blocs, mais la route **relayait les
objets reçus tels quels**. Un
`{type:"image", source:{type:"file", file_id:"…", data:"<2,7 Mo>"}}` passait la
validation, pesait **zéro** au budget (`poidsTexte` ne compte que le texte) et
repartait à chaque tour.

**Une liste blanche vérifie ce qui est là, pas ce qui est en trop.** Les blocs sont
désormais **reconstruits** champ par champ (`projeter()`), plus jamais relayés.
Filet supplémentaire : refus au-delà de 1 Mo de corps, avec log.

### Le seul chemin produisant un fichier ineffaçable n'était pas tracé

Si le `POST /v1/files` aboutit mais que la réponse se perd (coupure, RST, fin de
`maxDuration`), on n'a jamais vu le `file_id`, la ligne reste à `NULL`, et la
purge — qui refuse délibérément de balayer le workspace — ne le verra **jamais**.
Marqueur `ORPHELIN POSSIBLE` en journal, avec le `piece_id`, et procédure de
rapprochement manuel documentée dans l'en-tête du fichier.

### Un message « photo seule » de plus de 24 h disparaissait de l'historique

`construireContenu` rendait `""`, le message était filtré, mais **la réponse de
Jardi restait** : deux `assistant` consécutifs, et un modèle qui commente un
document dont l'énoncé a disparu. Remplacé par un texte de substitution
(« Scan joint : … — copie de travail expirée »).

### Deux bugs que seul le typecheck a vus

Un projet miroir (Next 16.2.3, React 19.2.4, TS 5.9, `tsconfig.json` réel) a été
monté pour faire tourner `tsc --noEmit` avant livraison. Il a sorti :

1. **`sessionValide` avalée** par un remplacement de bloc trop large dans
   `conversations/route.ts` — le build aurait échoué.
2. `f.taille` possiblement `undefined`.

**Un patch appliqué par remplacement de bloc peut emporter une fonction voisine
sans que rien ne le signale à la lecture.** Le typecheck est le seul filet.

---

## 5. Smoke test — trois brouillons, trois enseignements

Tous sur la commande **53858** (celle du pilote, comparée à **DRA-805** créé le
17.08 par appel direct au connecteur).

| | Résultat | Ce qu'il a appris |
|---|---|---|
| **DRA-808** | total **264.–** au lieu de 7'089.– | `prix_net_ttc` donné **seul** → ligne à la volée à 0 (§6) |
| **DRA-809** | 7'089.– ✅ mais `client_nom = "Claude"` et prix barré **13'650** | deux défauts, dont un mal diagnostiqué (§6) |
| **DRA-810** | **conforme sur toute la ligne** | ✅ |

**DRA-810 contre DRA-805, au franc près :** Solanas `custom` à **13'653** avec
rabais **6'828** (`lineDiscount` **et** `lineDiscountPerUnit` écrits tous deux),
7890 à 84.–, 7960 à 60.–, service `etage_montage` 120.–, sous-total 6'969.–,
**total 7'089.–**, réconciliation « concordent ». Et en plus : `client_nom`
**Reiman**, `client_prenom` **André**, `1802 Corseaux`, `commercial` **Alejandro**,
`client_email` **vide** (décision D7 respectée).

### Le transport, mesuré

Onglet Réseau, trois tours consécutifs sur un PDF de **766 Ko** :

```
messages → 0 → content:
  [{type:"document", source:{type:"file", file_id:"file_011Ce9GAUW9nMoHRsXSwr1fH"}}, …]
```

Une référence de trente caractères, **identique aux trois tours**. Compteur
total : **5,7 ko** puis **13,5 ko**. Le PDF n'est jamais reparti. C'est le test
que tout le lot existait pour passer.

---

## 6. ⚠️ Un diagnostic faux, et pourquoi il l'était

**Symptôme (DRA-809) :** Jardi identifie la fiche `CL-19504` sans ambiguïté,
l'annonce, puis crée un brouillon au nom de « Claude », tous les champs client à
`NULL`.

**Première analyse :** la description du paramètre `client` du connecteur disait
encore *« reprise du document »* et *« ne remplir que ce qui est lu AVEC
CERTITUDE »* — un vestige d'avant la §12.3. Analyse plausible, **et fausse**.

**Ce que le `git diff` a montré :** sur `main` du connecteur, **le paramètre
`client` n'existe pas**. Tout le travail du Lot 1 sur la reprise client vivait
dans la copie de travail depuis le 17.08 à 22:47, jamais committé, jamais
déployé. Jardi n'a pas ignoré une consigne — **l'outil ne lui offrait pas le
champ**.

L'erreur de méthode : avoir lu le code **du disque** et raisonné comme s'il était
en ligne, alors que le modèle dialogue avec le serveur **déployé**. Le doc `04`
§9 le dit depuis juillet — *« le `git log` et l'état de la prod priment toujours
sur le journal »* — et le piège s'est rejoué **le jour même** où il avait déjà
servi à débusquer le Lot 3.

**Règle : avant d'attribuer un comportement du modèle à une consigne, vérifier
que le code portant cette consigne est bien celui qui tourne.** Le `git diff`
avant de conclure, pas seulement avant de committer.

---

## 7. Correctifs de prompt nés du terrain

La §12 était **inerte depuis 20 heures**. Son premier passage réel a sorti trois
défauts — c'est exactement la valeur du Lot 2.

### §12.2 — `prix_net_ttc` ne se donne jamais seul

Il exprime un rabais **par rapport à** `prix_ttc`. Sans lui, une ligne à la volée
vaut 0, le rabais est refusé, le total s'effondre (DRA-808 : 264.–). Règle :
**toujours les deux** — `prix_ttc` = prix affiché avant rabais, `prix_net_ttc` =
prix net écrit.

Le correctif naïf aurait été de poser `prix_ttc = 6'825` (le net). Ça donnerait le
bon total **mais perdrait le rabais** : plus de prix barré, plus de −50 %, contre
la règle 5 du cadrage.

### §12.2 — ne pas ajuster un prix lu pour qu'un pourcentage tombe rond

DRA-805 lisait **13'653** (rabais 6'828, −50,01 %). DRA-809 a lu **13'650**, en
justifiant *« cohérent avec −50 % exact »*. **Le scan porte 13'653** — vérifié à
l'œil. C'est la décision **D5 prise à l'envers** : au lieu d'appliquer un
pourcentage, ajuster le prix pour le justifier.

⚠️ **Angle mort du dispositif : la réconciliation ne peut pas l'attraper.** Le net
est juste, le sous-total est juste, le total tombe, le verdict est « concordent ».
Le seul chiffre faux est celui qui n'entre dans **aucun calcul** — et qui pourtant
**s'imprime** sur l'offre et le bulletin de livraison.

### §12.3 — remplir le paramètre `client`, même sur une fiche incomplète

La §12.3 disait *quoi* faire (« recopier SES coordonnées ») sans **nommer le
paramètre**, ni dire qu'une fiche incomplète se pose quand même. Ajouté :
« **tous les champs sont facultatifs, une fiche incomplète se pose telle quelle,
champ par champ — elle ne s'abandonne pas** », et ce qui manque va en notes
internes **en plus**, jamais à la place.

### Côté connecteur (`jardi-mail-mcp`, branche `feat/client-facturation-et-describe`)

Le Lot 1 non committé a été committé **avec** quatre correctifs de description
(`client`, `prix_ttc`, `prix_net_ttc`, plus un commentaire de tête périmé).
Détail complet dans `journal-mcp-mail.md` **§17**. Aucune logique modifiée.

⚠️ **Une description d'outil est lue au moment de l'appel et pèse au moins autant
qu'une règle de prompt.** Quand une décision métier est prise dans un dépôt, les
`.describe()` de l'autre deviennent des contradictions silencieuses.

---

## 8. Pièges nouveaux, à ne pas rejouer

- **Une liste blanche ne filtre pas ce qui est en trop.** Valider la forme d'un
  objet ne dit rien de ses clés supplémentaires. Pour un objet relayé à un tiers :
  **reconstruire**, ne pas transmettre.
- **Un patch par remplacement de bloc peut avaler une fonction voisine**
  (`sessionValide`). Seul `tsc --noEmit` l'a vu.
- **`renduInline` cassait sur `**[texte](url)**`.** L'alternance de `MOTIF_INLINE`
  retient ce qui commence **le plus à gauche** : le gras matche en premier et
  avale le lien, affiché en markdown brut. Observé en production sur un lien
  Thunderbird. Corrigé en rendant le contenu du gras **récursivement**.
- **Un fichier lâché à côté de la zone de dépôt fait NAVIGUER le navigateur vers
  ce fichier** : la page disparaît, avec la saisie en cours et la conversation si
  aucune réponse n'a encore été sauvegardée. Garde global `dragover`/`drop`.
- **`toBlob("image/jpeg")` aplatit la transparence en NOIR.** Une capture PNG
  arriverait en écriture noire sur fond noir, illisible, sans aucune erreur.
  Canevas rempli en blanc avant `drawImage`.
- **Le doc `04` §3 se trompe sur le connecteur** : `jardi-mail-mcp` n'est pas
  « en LF des deux côtés ». Son `app/api/[transport]/route.ts` est en **CRLF** en
  copie de travail ; son journal, lui, est en LF. Écrire chaque fichier dans son
  propre encodage.
- **`vercel.json` et `docs/sql/*.sql` sont en LF**, les sources `.ts`/`.tsx` en
  CRLF. Ce n'est pas une incohérence à corriger, c'est l'état du dépôt.
- **`shopify-sync` est horaire (`15 * * * *`), pas quotidien** — le cadrage le
  croyait quotidien en plaçant la purge « à côté ».
- **Une erreur de lecture sur un TITRE ne déclenche aucun contrôle.** DRA-810
  porte « Ensemble **SOFANAS** » au lieu de SOLANAS. Ce titre s'imprime sur
  l'offre, le bulletin de livraison et la fiche de travail. Rien ne le rattrape :
  **le relevé de lecture doit être lu, pas seulement les montants.**

---

## 9. Vérifications faites en base

- `pieces_jointes` : 16 colonnes, les 10 écrites par la route présentes et bien
  typées, **0 trigger** (doc `04` §12), RLS activée sans policy.
- Index partiel `(created_at) WHERE claude_file_id IS NOT NULL` : **exactement**
  le prédicat de la purge, tri compris.
- Bucket `annexes` : public, 20 Mo, 5 types MIME, 0 policy sur `storage.objects`.
- **Les 5 RPC du connecteur intactes** (6ᵉ règle d'or) : aucune colonne de
  `offres`, `clients`, `commandes_shopify` ou `factures_winbiz` touchée.
- L'advisor Supabase signale `pieces_jointes` en `rls_enabled_no_policy` **niveau
  INFO**, comme les 20 autres tables du projet. Posture voulue, pas régression.
- **Confirmé dans la donnée, pas seulement dans le doc** : `lineDiscount` ET
  `lineDiscountPerUnit` valent tous deux 6'828 sur DRA-805 et DRA-810. Le piège
  le plus dangereux du chantier (§7 du doc `12`) est effectivement couvert.
- **P2-28 confirmé** : `remise_chf = 0` sur les deux, alors que le document porte
  6'828.– de rabais de ligne. Arbitré acceptable le 17.08.

---

## 10. Reste ouvert

- ⬜ **La purge n'a jamais été vue tourner.** `CRON_SECRET` est marqué
  **Sensitive** dans Vercel — bonne posture, mais sa valeur n'est plus lisible,
  donc pas de déclenchement manuel par `curl`. Une ligne a été **antidatée à
  −25 h** et attend : au premier `:40` suivant le déploiement en production, le
  cron partira seul. À vérifier alors : le log Vercel (`1 supprime(s)`),
  `claude_file_id` passé à **NULL**, et **le PDF toujours servi** par son URL
  publique. C'est ce couple qui prouve la promesse du lot.
- ⬜ **Test mobile** : l'upload depuis un téléphone (appareil photo, EXIF, HEIC)
  n'a pas été exercé — seul le PDF depuis l'ordinateur l'a été. C'est pourtant
  l'usage principal du chantier.
- ⬜ **DRA-808 et DRA-809 à supprimer** : déchets de test (doc `04` §9).
- 🟡 **Le rattachement au DRA reste hors périmètre.** Toutes les lignes du Lot 2
  ont `entity_id NULL`, **définitivement** — c'est l'étape 5 du doc `14`.
  ⚠️ **Conséquence à ne pas manquer** : le doc `14` §6 prévoit « une purge des
  lignes orphelines, `entity_id IS NULL` depuis plus de 24 h ». Écrite telle
  quelle au chantier annexes, elle **effacerait toutes les preuves papier** — et
  aussi les plans clients déposés avant création du document. Elle devra exclure
  `categorie = 'scan_commande'`, ou attendre l'étape 5.
- 🟡 **P2-1 s'aggrave à l'usage.** Ce lot met le chat, ses 14 outils et désormais
  un dépôt de fichiers dans la poche de chaque porteur du **code d'accès partagé
  statique**. La capacité est livrée, pas le déploiement large.
- ⬜ **Pas de déduplication à l'upload.** Le `content_hash` est calculé et stocké,
  mais redéposer le même fichier crée une seconde ligne (constaté : deux lignes
  identiques pour le même scan). Prévu au doc `14` §5.1, hors Lot 2.
- ⬜ **113 erreurs ESLint préexistantes** dans `print/*` et cinq composants
  (`any`, `react-hooks/set-state-in-effect`). Aucune dans les fichiers du Lot 2
  — vérifié par lint ciblé. `next build` ne lance plus ESLint : Vercel n'en dit
  rien. Dette à part entière.
- ⬜ **« dernier mail X » ne rend pas toujours le plus récent.** Deux exécutions
  de la même requête ont rendu deux mails différents (14.08 et 15.08), selon que
  le modèle a lancé une ou deux recherches. `mail_chercher` classe par pertinence,
  pas par date : le tri chronologique du §2 repose entièrement sur la discipline
  du modèle, sur une liste possiblement tronquée. **Question de fond non
  tranchée** : « dernier mail Dedon » désigne-t-il le dernier échange avec le
  fournisseur, ou le dernier mail où le mot apparaît, sujet client compris ?
