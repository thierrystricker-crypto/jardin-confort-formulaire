# Journal — Jardi dans Thunderbird (façade ThunderAI) [19-20.08.2026]

Chantier mené en une session (19.08 au soir → 20.08). État : **en production,
adopté** — réponses aux mails, création de brouillons d'offres depuis la
fenêtre de chat ThunderAI, historique de secours.

## 1. Objectif et décision

L'équipe utilisait l'extension Thunderbird **ThunderAI** branchée sur ChatGPT
pour proposer des réponses aux mails. Objectif : remplacer ChatGPT par le VRAI
Jardi (règles + outils MCP jardi-mail), pas par un Claude nu.

ThunderAI ne parle pas MCP, mais possède une intégration « **OpenAI Compatible
API** » à URL libre. Décision : une **façade** dans CE projet qui se présente
à ThunderAI comme une API OpenAI et exécute derrière la même mécanique que le
chat du dashboard (clé Anthropic côté serveur, règles Jardi, outils MCP).

Avantages décisifs sur les alternatives étudiées (API Claude native de
ThunderAI = Claude sans outils ; serveur MCP Thunderbird local type zileo =
installation + siège Claude par poste) :

- **rien à installer sur les postes** : trois champs à changer dans ThunderAI ;
- **aucune clé Anthropic sur les postes** : seulement un jeton dédié révocable ;
- **toute correction de comportement est côté serveur** : un deploy, tous les
  postes en profitent (vérifié dès le premier jour avec la règle de civilité).

## 2. Architecture

### Routes (nouvelles)

- **`app/api/thunderai/v1/chat/completions/route.ts`** — la façade. Reçoit le
  format OpenAI (`{model, messages, stream:true}`), exige
  `Authorization: Bearer $THUNDERAI_SECRET`, appelle la Messages API Anthropic
  (mêmes réglages que le chat : `CLAUDE_CHAT_MODEL`, `max_tokens` 16384,
  connecteur MCP `jardi-mail` avec `CLAUDE_CHAT_MCP_TOKEN`, boucle d'outils
  gérée par l'API), et **traduit le flux SSE Anthropic → format OpenAI** à la
  volée (`choices[0].delta.content`, terminé par `data: [DONE]`). Seuls les
  `text_delta` visibles sont relayés ; outils et réflexion transitent en
  silence. Chemin non streamé (`stream:false`) conservé pour les tests
  PowerShell.
- **`app/api/thunderai/v1/models/route.ts`** — liste de modèles pour la liste
  déroulante de ThunderAI : un seul modèle exposé, « **jardi** ». Le vrai
  modèle Anthropic reste choisi côté serveur.
- **`app/api/claude/thunderai-historique/route.ts`** — consultation de
  l'historique (GET, filtre `?q=`), volontairement SOUS `/api/claude/`
  (cookie) et pas sous `/api/thunderai/` (zone sans cookie).

### Prompt partagé

`REGLES_JARDI` et `blocDate()` extraits de la route du chat vers
**`app/api/claude/chat/regles-jardi.ts`** — une seule source de vérité, les
deux routes l'importent. La façade ajoute un bloc `CONTEXTE_THUNDERAI`
(après le bloc caché, avant la date) : travailler d'abord sur le mail fourni,
texte seul prêt à insérer pour les réponses, markdown supporté, pas de
fichiers ici, et la règle 5 (voir §5 civilité).

### Historique — filet anti « clic trop rapide »

Avec ChatGPT, une réponse perdue se retrouvait sur chatgpt.com. La façade est
sans état → table Supabase **`thunderai_echanges`** (projet
jardin-confort-database, RLS sans policy, migration `creation_thunderai_echanges`
appliquée le 19.08 directement par Claude via MCP Supabase). La façade insère
chaque échange complet APRÈS le `[DONE]` (zéro latence ajoutée) et purge au
fil de l'eau ce qui a plus de 60 jours. Consultation :
**`/dashboard/thunderai`** (thème sombre, filtre, « 📋 Copier la réponse »).

### Sécurité

- `proxy.ts` : `/api/thunderai/` passe SANS cookie (comme `/api/cron/`) ; en
  échange chaque route vérifie son bearer.
- **`THUNDERAI_SECRET`** : env Vercel du formulaire, hex 64, généré au poste.
  C'est la seule chose que détiennent les postes.
- Invariants intacts : lecture seule + brouillons, aucun envoi possible ;
  ThunderAI lui-même ne fait qu'insérer du texte dans une fenêtre de rédaction.

## 3. Config d'un poste (fiche de déploiement, ~2 minutes)

Dans Thunderbird → Modules complémentaires → ThunderAI → Options :

1. **Type de connexion** : « API compatible OpenAI » (Services : Personnalisé).
2. **Adresse de l'hôte** : `https://offres.jardin-confort.ch/api/thunderai`
3. **Conserver la compatibilité "v1"** : coché (défaut).
4. **Clé API OpenAI Comp** : la valeur de `THUNDERAI_SECRET`.
5. **Modèles** : bouton « Mettre à jour la liste » → choisir **jardi**.
6. **Nom du chat** : `Jardi`.
7. **Temps mort de la commande spéciale** : **240000** (120000 trop court
   quand Jardi enchaîne les outils).
8. Au premier appel, ThunderAI peut demander l'autorisation pour le domaine —
   accepter (même esprit que le « Toujours autoriser » des liens `mid:`).

Prompt personnalisé « Assistant Jardi » (remplace la version de l'époque
ChatGPT — tout ce qu'elle réexpliquait vit maintenant côté serveur) :

```
Expéditeur du mail (c'est à LUI que la réponse s'adresse) : {%author%}
Destinataires : {%recipients%}
Boîte de réception : {%account_email_address%}
Sujet : {%mail_subject%}

Rédige la proposition de réponse à ce courriel selon tes règles Jardi. Si des instructions ou un brouillon de réponse figurent à la fin du mail (ou dans le texte supplémentaire), ils priment : suis-les sans inventer d'autre réponse et sans prendre de décision. Donne uniquement le corps de la réponse, prêt à insérer, sans commentaire.
```

Propriétés : « Demander du texte supplémentaire » coché, action « Faire une
réponse ». Le placeholder `{%account_email_address%}` rend la règle
multi-marques (§8 des règles) fiable dans ThunderAI.

## 4. Pièges à ne pas rejouer

- **Chemin d'import à 4 niveaux** : depuis
  `app/api/thunderai/v1/chat/completions/`, le module partagé est à
  `../../../../claude/chat/regles-jardi` (TS2307 avec 3). Et le collage
  multi-lignes PowerShell a enchaîné `git push` MALGRÉ l'erreur `tsc` → build
  Vercel cassé (sans conséquence : le déploiement production actif ne bouge
  pas). Réflexe : coller `npx tsc --noEmit` SEUL, lire, puis committer.
- **Accents cassés dans `Invoke-RestMethod`** : artefact d'affichage de
  PowerShell 5.1 (UTF-8 décodé en Latin-1), PAS un bug serveur — ThunderAI
  décode en UTF-8 natif, accents propres.
- **ThunderAI streame TOUJOURS** (`stream:true` forcé dans son worker, aucun
  préréglage) : la façade doit produire du SSE OpenAI, chunks
  `choices[0].delta.content` + `data: [DONE]`.
- **La fenêtre de chat ThunderAI est à 100 % l'UI de l'extension**
  (`api_webchat/`, markdown-it embarqué — les liens markdown SONT cliquables,
  y compris `mid:` et PJ). Pas stylable sans forker.

## 5. Civilité — ne jamais deviner Monsieur/Madame [20.08]

Constaté : « Madame » adressé à Nicolas (fil multi-personnes, dernier mail
signé « NC »). Deux causes : ThunderAI n'envoyait pas l'en-tête expéditeur
(corrigé par les placeholders du §3), et aucune consigne n'interdisait de
deviner. Règle 5 ajoutée au `CONTEXTE_THUNDERAI` : la réponse s'adresse à
l'expéditeur du dernier message ; civilité UNIQUEMENT si certaine (donnée par
le client, ou une réponse précédente du fil s'adresse à CETTE personne ainsi) ;
au moindre doute « Bonjour, » sans civilité ; ne jamais mélanger les
interlocuteurs d'un fil. **Suivi en cours** : retour de Thierry après quelques
jours de test.

## 6. Retombées immédiates

- Brouillon d'offre créé depuis la fenêtre de chat ThunderAI en coupant court
  à une réponse client — même moteur, tous les outils.
- Bug dormant `pj_chercher` (`order_by: last_modified` → tag inexistant,
  la combinaison contenu + période n'avait jamais servi) débusqué par l'usage
  ThunderAI et corrigé dans jardi-mail-mcp (voir son journal, §18).
- UI du chat dashboard au passage : zone de saisie auto-extensible (plafond
  ~10 lignes, retour à 2 après envoi) et modèles de départ cliquables qui
  REMPLISSENT la saisie à compléter (tableau `MODELES` en tête de
  `app/dashboard/jardi/page.tsx`).

## 7. Idées non engagées

Bouton « 🕘 ThunderAI » dans la rangée du dashboard principal ; serveur MCP
Thunderbird local (zileo, préréglage Read Only) pour les actions locales
(classer, calendrier) — reporté, la façade couvre le besoin exprimé ;
purge/rotation configurable de `thunderai_echanges` si le volume gêne.
