# Journal — Page « To-do du jour » (`/dashboard/todo`)

> Chantier ouvert et livré le **28.08.2026**, en une session, avec Thierry.
> Dépôts concernés : `jardin-confort-formulaire` (page + API) et
> `jardi-mail-mcp` (lecture IMAP + SQL).
> Spec de conception : `claude/chantier-todo-digest.md` (docs du projet Claude).
> Ce fichier-ci est l'état de référence du chantier côté dépôt.

---

## 1. Ce que ça résout

Le dashboard savait répondre à « qu'est-ce que ce mail dit ? », « où en est
cette commande ? », « combien on a vendu ». Il ne savait pas répondre à la
question du matin : **qu'est-ce qui attend, et est-ce que c'est à moi ?**

Sept sections sur une page, chacune avec son compteur, ses lignes et **son
périmètre affiché en clair** — parce qu'un compteur sans périmètre se lit
comme un inventaire (leçon du 17.08, journal du connecteur §5).

---

## 2. Les sept sections et leur signal

| Section | Source | Signal |
|---|---|---|
| SAV en attente | IMAP live, INBOX contact@ + info@ | non lu + mots-clés du sujet |
| Mails à traiter | IMAP live, INBOX + dossiers de tri de info@ | non lu |
| Formulaires sans réponse | IMAP live, `02-Formulaires` de contact@ | **non répondu**, 30 j |
| Retards fournisseurs | `v_suivi_delais` | `alarme_retard` |
| Échéances proches | `v_suivi_delais` | `alarme_echeance_proche` |
| Confirmations manquantes | `v_suivi_delais` | `alarme_delai_manquant` |
| Offres à relancer | `offres` | ouverte ≥ 7 j, **10 plus gros montants** |

**Le signal utile n'est pas le même selon le dossier.** C'est la découverte
qui a structuré tout le reste :

- `INBOX` : on lit, et lire = prendre en charge → **non lu**.
- `02-Formulaires` : tout est lu (43/43) → **non répondu**.
- `Archive` : 9 519 non-lus sur 9 523 → aucun signal, jamais.
- `03-Avis`, `Promotions`, `Spam`, `SocialNetworks` : jamais ouverts → exclus.

⚠️ **L'invariant du journal du connecteur (« jamais filtrer par état de
lecture ») est caduc** : il datait d'une époque où INBOX comptait 950 non-lus.
Mesuré le 28.08 : contact@ **20 sur 21 737**, info@ **61 sur 116 197**. À
corriger dans `journal-mcp-mail.md` §2.

---

## 3. Architecture

```
/dashboard/todo (page)
      │  fetch
      ▼
/api/todo ──────────► Supabase (v_suivi_delais, offres, v_todo_masques)
      │
      └── fetch ────► jardi-mail-mcp /api/todo-mails ──► IMAP (lecture seule)
                                    └──────────────────► Supabase (mails.apercu,
                                                          todo_exclusions,
                                                          fournisseurs_surveilles)
```

**Pourquoi une route REST dans le connecteur, et pas un outil MCP de plus :**
le pont `mcp-remote` fige la liste d'outils au démarrage de l'app de bureau,
et le dashboard n'a besoin que d'un GET. Il appelle déjà `/attachment` et
`/mid` de la même façon. Bearer : `MCP_SECRET` ou `MCP_SECRET_CHAT` — **aucun
secret nouveau**, le formulaire réutilise `CLAUDE_CHAT_MCP_TOKEN`.

**Pourquoi les mails ne peuvent pas venir de l'index :** ni le non-lu
(`\Seen`) ni le répondu (`\Answered`) n'y sont — ce sont des flags IMAP. Seul
le connecteur a les mots de passe des boîtes. En revanche l'aperçu, lui, vient
de l'index : **aucune lecture IMAP supplémentaire**.

---

## 4. Invariants

1. **`direction@jardinconfort.ch` n'est jamais lue ni mentionnée** (boîte
   confidentielle). Verrou à trois niveaux : `BOITES_INTERDITES` refuse la
   connexion même si l'adresse était ajoutée au registre, elle n'est pas
   mappée vers une mention de conseiller, et elle est retirée des
   destinataires dès la lecture. Choix assumé : un mail arrivé sur
   info@/contact@ **avec direction@ en copie** reste affiché (seule l'adresse
   est effacée) — l'écarter ferait disparaître du travail réel en silence.
2. **Lecture seule IMAP** : `readOnly` sur chaque ouverture de dossier, aucun
   flag touché. Un mail listé ici reste non lu dans Thunderbird.
3. **Aucun SMTP**, jamais. Les brouillons restent des brouillons.
4. Chaque section annonce son **périmètre** (boîte, dossier, règle, fenêtre,
   ce qui a été écarté).
5. Une section vide dit « à jour » ; une section **en échec** dit
   « indisponible » en ambre. Les deux ne doivent pas se ressembler.
6. Aucune section ne dépasse ce qu'un humain traite en une matinée — au-delà
   on borne, **et on dit qu'on borne**.
7. Rien d'irréversible : `todo_traitements` est en ajout seul, garanti par
   trigger (UPDATE et DELETE testés, refusés).

---

## 5. Ce qui a été mesuré (28.08.2026)

Tout a été vérifié sur les données réelles avant d'écrire le code. Les
chiffres ci-dessous sont datés : ils vieilliront, la méthode non.

- **Non-lus** : contact@ 20 / 21 737 · info@ 61 / 116 197 · Archive
  9 519 / 9 523.
- **Filtre des automates** : sur les 20 non-lus de contact@, **11 sont de
  vrais sujets**, 9 des automates (rapports Shopify, notifications de stock,
  BackupMaster, rapport de liens morts, démarchage SEO, auto-répondeur).
- **`sans_reponse` seul est inexploitable** : 141 messages sur 10 jours dans
  contact@ INBOX, presque tous des automates qui n'attendent rien.
- **Formulaires** : 43 messages, 0 non lu, **12 non répondus** remontant au
  06.06 → d'où la fenêtre de 30 jours.
- **Adresses nominatives** : sur **1818 mails** reçus en 30 jours dans les
  deux INBOX, **5** portent l'adresse d'un conseiller. Le To/Cc ne suffit
  pas → on relève les **dossiers de tri** de info@.
- **Délais** : 10 retards, 24 échéances proches, 36 alarmes « délai
  manquant » (pour 62 lignes à l'étape `sans_delai` — l'alarme n'arme qu'après
  5 jours ouvrés), 205 lignes de suivi en cours.
- **Offres** : 167 ouvertes, dont **158 ont ≥ 7 jours**. La règle du dashboard
  sélectionne 95 % du stock → d'où le bornage aux 10 plus gros montants.
  `date_envoi` : 0 remplie. `date_relance_prevue` : 0. `nb_relances` : 9.
  L'app n'écrivait jamais ces colonnes — c'est ce que corrige « Marquer
  comme relancée ».
- **Brouillons dormants** : info@ en a 122, dont 76 non lus (constat annexe,
  pas encore exploité).

---

## 6. Décisions, et pourquoi

| Décision | Motif |
|---|---|
| Route REST plutôt qu'outil MCP | Le pont fige la liste d'outils ; un GET suffit |
| Exclusions des automates **en base** (`todo_exclusions`) | Éditable sans redéploiement, comme les fiches fournisseurs |
| SAV par mots-clés du sujet, sans IA | Simple, lisible, et le périmètre le dit. Escalade vers un modèle possible plus tard, montage du job délais |
| Condition « expéditeur = client connu » **non** appliquée au SAV | Le démarchage parle rarement de garantie ; une requête client par expéditeur coûtait cher pour un risque faible |
| Compteur du bandeau = ce qui est **affiché** | « 228 à traiter » (les 158 offres entières) effraie sans rien dire de la journée. L'arriéré reste dans `total_arriere` |
| Cartes **repliées** sauf les trois sections mail | Quatre listes déployées d'un coup découragent avant d'avoir commencé |
| Une carte par mail, pas une ligne de séparation | Illisible une fois l'aperçu et les boutons ajoutés |
| Bouton **neutre** « ☑ Marquer comme traité » | En vert avec « ✓ Traité » il se lisait comme un badge d'état, pas comme une action |
| Masquage qui **expire** (7 j, 14 j pour une offre) sauf pour les mails | Un mail est un événement unique ; un retard est un état qui dure et doit se rappeler à nous. Sinon « traité » enterre les problèmes |
| Volet « déjà traité » borné à 50 | Les mails sont masqués définitivement : sans borne le volet grossit sans fin. **Le filtrage porte toujours sur la totalité** |
| Rafraîchissement au retour sur l'onglet | Les sections mail sont lues en direct ; une ligne qui persiste n'est qu'une page non rechargée |

---

## 7. Pièges rencontrés (à ne pas rejouer)

1. **Un motif ILIKE doit couvrir la chaîne ENTIÈRE.** `%@seoant.com` ne
   matche pas `brokenlink@support.seoant.com`. Trouvé par le test
   d'acceptation sur les vrais non-lus, pas par la relecture.
2. **Exclure ses propres adresses est dangereux.** Les motifs
   `contact@jardin-confort.ch` / `info@jardinconfort.ch` étaient redondants
   (les sujets `Stock +%` et `[Rapport AC]%` suffisent) **et** ils écartaient
   de vrais mails internes — mesuré : « Parasol Neuhaus » envoyé depuis
   info@. Désactivés, pas supprimés.
3. **Les entités HTML se décodent AVANT le fourre-tout `&xxx;`**, sinon
   « a &eacute;crit » devient « a crit ».
4. **Un `<style>` peut n'avoir pas de fermeture** : l'index coupe l'aperçu à
   2000 caractères. Tout ce qui suit une balise ouverte non refermée est jeté,
   et s'il ne reste que du CSS l'aperçu vaut `null` — pas d'aperçu vaut mieux
   qu'un aperçu de code.
5. **Une connexion IMAP par boîte, pas par dossier.** Avec les dossiers des
   conseillers on passait de 3 à 8 ouvertures de session par chargement.
6. **Préparer un brouillon ne marque rien.** `mail_creer_brouillon` fait un
   APPEND dans Brouillons et ne touche jamais le message d'origine : il reste
   non lu, donc dans la liste. C'est le trou que bouche « Marquer comme
   traité ». Thunderbird, lui, **ne sait pas** poser `\Answered` à la main —
   demandé depuis 2002 (bug 128072), jamais implémenté ; seule l'extension
   `ToggleReplied` le fait. Écarté : ce serait écrire un mensonge dans la
   boîte, et ça ne réglerait qu'une section sur sept.
7. **Un refactor peut emporter du code voisin.** Le remplacement de
   `lireDossier` par `lireBoite` a supprimé au passage `nettoyerApercu` et sa
   table d'entités — rattrapé par `tsc`, pas par la relecture.

---

## 8. Fichiers

**`jardin-confort-formulaire`**
- `app/dashboard/todo/page.tsx` — la page (cartes, aperçu dépliable, boutons,
  volet « déjà traité », rafraîchissement au focus)
- `app/api/todo/route.ts` — les 4 sections base + appel du connecteur pour les
  3 sections mail + filtrage des lignes masquées
- `app/api/todo/traitement/route.ts` — marquer / remettre, et écriture de
  `date_derniere_relance` sur les offres
- `app/dashboard/page.tsx` — bouton « ☑ To-do du jour »
- `app/dashboard/jardi/page.tsx` — lecture de `?q=` (une fois, puis le
  paramètre est retiré de l'adresse)
- `app/api/claude/chat/regles-jardi.ts` — consigne `signataire`

**`jardi-mail-mcp`**
- `app/api/todo-mails/route.ts` — les 3 sections mail, lecture seule
- `app/api/[transport]/signatures.ts` — table `SIGNATAIRES`, substitution du
  nom et de l'adresse
- `app/api/[transport]/route.ts` — paramètre `signataire` sur
  `mail_creer_brouillon`
- `sql/2026-08-28_todo_exclusions.sql` — motifs d'automates
- `sql/2026-08-28_todo_traitements.sql` — marquage en ajout seul

**Base** (`jardin-confort-database`) : `todo_exclusions`,
`todo_traitements`, vue `v_todo_masques`, triggers d'immuabilité.

---

## 9. Ce qui reste

**Fonctionnalité non construite :**
- **Sortie texte du digest** — le même contenu en un texte pour un brouillon
  matinal (étape 6 de la feuille de route délais). C'est le seul vrai morceau
  qui manque.

**À régler poste par poste, hors code :**
- **`signataire` depuis l'app de bureau** : paramètre neuf, le pont
  `mcp-remote` ne le voit qu'après redémarrage. D'ici là zod le supprime en
  silence et la signature reste au nom de Thierry, sans erreur visible.
- **ThunderAI ne sait pas qui est devant le poste** : le prénom doit être
  ajouté au prompt personnalisé de l'extension, sur chaque poste.

**À instruire :**
- **Domaine `glatz.com` absent de la fiche fournisseur** (elle ne déclare que
  `glatz.ch`). Les non-lus contiennent `b2b-portal@glatz.com` — « Glatz /
  Confirmation d'achat #V794864 ». Soit doublon, soit des confirmations Glatz
  invisibles au job des délais depuis le début.
- Le volet « déjà traité » ne montre que les masquages **actifs**.
  L'historique complet (y compris ce qui a été remis ou est revenu tout seul)
  est en base dans `todo_traitements`, jamais effacé, mais aucune page ne le
  lit.

**À décider à l'usage :**
- La page remplace-t-elle `/dashboard/notifications` ou vit-elle à côté ?
- Une to-do par conseiller, ou la liste commune avec les pastilles ?
- Fenêtre des formulaires : 30 jours aujourd'hui (`JOURS_FORMULAIRES`), à
  rouvrir maintenant que « traité » existe.
- Réglage du filtre des automates : les deux nombres écartés sont affichés
  dans le périmètre de « Mails à traiter ». S'il reste du bruit, une ligne
  dans `todo_exclusions` suffit — pas de déploiement.
