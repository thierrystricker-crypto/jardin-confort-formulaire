Chantier « Planche couleurs — réglages après coup et décor d'inspiration ».

AVANT TOUTE PROPOSITION
Lis les docs projet 00, 02 (modèle de données), 03 (règles métier), 04 (pièges)
et 06 (décisions). Lis ensuite, sur le disque, le journal du chantier précédent,
C:\Users\ezefi\jardin-confort-formulaire\journal-moodboard-matieres.md, puis le
code réel :
- lib/moodboard.ts et lib/matieres-offre.ts
- components/MoodboardPlanche.tsx, MoodboardReglages.tsx et MoodboardCard.tsx
- app/api/offres/[slug]/matieres/route.ts et app/api/moodboard/apercu/route.ts
- app/print/offre/[slug]/page.tsx, app/print/draft/[slug]/page.tsx et
  app/planche/[slug]/page.tsx
- docs/sql/031-matieres-pour-offre.sql et docs/sql/032-matieres-pour-offre-cote.sql
Ne travaille pas de mémoire : le journal décrit une intention, le disque la réalité.

ÉTAT DE DÉPART
La planche couleurs et matières est en production depuis le 13.10.2026 (PR #63,
merge 208a14c). Elle se règle UNIQUEMENT dans le brouillon, avec une case
décochée par défaut et un rendu « par valeur » ou « en dégradé ». Les réglages
vivent dans data.moodboard = {actif, mode, sens}, et transformer_draft puis
valider les recopient dans l'offre puis dans la commande.
POINT 0, À VÉRIFIER D'ABORD : le test réel en production n'a peut-être pas encore
été fait (transformer un brouillon dont la case est cochée, puis vérifier que le
PDF enregistré porte la planche en dernière page). Demande-moi où il en est.

OBJECTIF, EN DEUX PARTIES.

PARTIE A — RÉGLER LA PLANCHE APRÈS COUP, DEPUIS LE DASHBOARD.
Sur la carte « Planche couleurs » de /dashboard/[slug] (offre ET commande), je
veux pouvoir choisir, à tout moment, entre :
- « Sans planche »
- « Planche seule »
- « Planche + décor d'inspiration »
Cela permet aussi d'ajouter la planche à une offre ou à une commande qui a été
créée sans elle. Le formulaire du brouillon passe au même choix à trois
positions, à la place de la case actuelle.
- Modèle proposé : data.moodboard.affichage = "aucune" | "planche" |
  "planche-decor". Il doit rester compatible avec l'existant : actif false
  correspond à "aucune", actif true à "planche". Ne casse aucun document
  existant.
- 🔴 LE POINT DE CADRAGE PRINCIPAL, À ME SOUMETTRE AVANT DE CODER : une offre
  signée et une commande sont des PREUVES. Toute modification passe par une
  correction tracée (table corrections) ou une révision versionnée, jamais par
  une réécriture silencieuse. La planche est indicative et non contractuelle,
  mais elle change le document PDF. Propose-moi le traitement de chacun des
  trois cas :
  1. offre non signée ;
  2. offre signée ;
  3. commande.
  Pour chacun : où l'on écrit, comment on trace, et ce qui se régénère.
  Contrainte absolue : le PDF initial archivé d'une commande
  (commandes/<slug>_initial.pdf) ne change JAMAIS. Établis ce qui régénère
  aujourd'hui pdf_url pour une offre et pour une commande AVANT de proposer
  quoi que ce soit, et ne régénère rien sans un clic explicite.
- Écriture : jamais data en bloc. Fusion jsonb uniquement (doc 04 §8 : écrire
  un jsonb en bloc efface ce que l'appelant ne connaît pas). Si tu ajoutes une
  colonne à offres, vérifie d'abord les 5 RPC du connecteur (chercher_clients,
  dossier_client, chercher_commandes_magasin, chercher_mails, chercher_pj).
- Question à trancher avec moi : la planche d'une commande est aujourd'hui
  RECALCULÉE en direct. La route sait lire une palette figée
  (data.moodboard.palette), mais rien ne l'écrit. Faut-il la figer à la
  validation, ou au moment où on l'active après coup ?

PARTIE B — LE DÉCOR D'INSPIRATION.
Un petit groupe de 2 ou 3 objets naturels (galets, sable, lin, olivier,
ardoise…), posés en léger chevauchement dans le coin bas gauche de la planche,
comme sur la planche d'un architecte. Ils sont choisis automatiquement d'après
les couleurs dominantes de l'offre.
- LA BANQUE EST PRÊTE : 60 PNG transparents de 600 px (49 sujets) dans
  Téléchargements\deco-inspiration\shopify-600\, nommés
  jc-deco-<code>-<variante>.png, avec index-etiquettes.csv (fichier, code,
  variante, ambiance, nature, teintes_filtre, sujet).
  - Les 7 ambiances : CL clairs, GR gris minéraux, SO sombres, BO bois et
    bruns, TE terres chaudes, VE verts, BL bleus et violets.
  - Les natures : minéral, végétal, bois, textile, métal, céramique.
  - Je les aurai déposées dans Shopify, Contenu → Fichiers. Récupère leurs URL
    du CDN par l'API Admin (files, filtre sur le nom jc-deco-) — ne me demande
    pas de les copier à la main.
  - Stockage proposé pour la v1 : une table de constantes dans le code
    (lib/moodboard-decor.ts), générée depuis le CSV et les URL. C'est une
    donnée DISTINCTE de la table matieres, et la règle de lecture seule des
    matières reste entière.
- SQL 033 : la RPC matieres_pour_offre doit renvoyer aussi teinte_filtre
  (text[]). C'est un DROP puis CREATE, comme la 032 : garder les mêmes revoke
  et grant, rester en lecture seule et sans rapprochement par nom. Je
  l'exécuterai dans le SQL Editor (projet llkyzspixrbtoprtmvoh). Vérifie avant
  que l'ordre de teinte_filtre est bien « teinte principale en premier ».
- Calcul de la couleur de l'offre (déjà discuté avec moi) :
  - le poids en CHF de chaque finition se répartit entre ses teintes : 2 parts
    pour la principale, 1 part pour chacune des autres ; multicolore-motif est
    ignorée ;
  - la dominante est la teinte au plus gros score ;
  - la seconde est la teinte suivante prise dans une autre ambiance, si elle
    pèse au moins 15 % ;
  - l'accent est une teinte colorée (vert, bleu, rouge, orange, jaune, rose ou
    violet) qui pèse au moins 10 %.
  - Choix des images : un minéral et un végétal de la dominante, puis une
    troisième image de la seconde ou de l'accent, d'une autre nature que les
    deux premières. Ne jamais reprendre la matière déjà sur la planche (une
    offre surtout en teck ne reçoit pas de planche de teck). Quand plusieurs
    images conviennent, choisir par un hash du slug : le même document donne
    toujours le même décor.
- Mise en page :
  - zone en bas à gauche, affichée SEULEMENT s'il reste de la place sous les
    pastilles (avec beaucoup de finitions, elle disparaît) ;
  - légère ombre portée ;
  - mention discrète « Inspiration » ;
  - partout où la planche s'affiche : impression de l'offre, impression du
    brouillon, /planche/[slug], carte du dashboard, aperçu du formulaire.
- 🔴 PIÈGE À NE PAS REPRODUIRE : urlCdn() force format=pjpg, ce qui est
  indispensable pour les finitions (sinon le CDN sert du WebP, et le PDF de 7
  finitions passe de 3,2 à 12,7 Mo). Mais le JPEG n'a PAS de transparence : les
  images du décor doivent passer par un autre helper, en PNG (width≈300,
  format=png). Vérifie le poids du PDF avec et sans décor.

GARDE-FOUS
- Aucune information de stock ou de rareté sur un document client.
- La preview Vercel écrit dans la VRAIE base : changer le réglage d'un document
  réel est une écriture réelle. Fais les tests sur des documents de test
  (CMD-80666 pour une commande), jamais sur l'offre d'un vrai client.
- Les PDF sont rendus par pdf.co depuis la PRODUCTION (NEXT_PUBLIC_APP_URL) :
  le décor n'apparaîtra dans un PDF enregistré qu'après le merge. En preview,
  tester sur la page /print elle-même.
- Après tout changement de proxy.ts, tester les appels serveur à serveur.
- Fichiers sanctuarisés : api/offres/[slug]/qr, lib/shopify-*.ts,
  api/stock-movements/process, matcher WinBiz.
- SQL uniquement dans le SQL Editor Supabase, jamais via PowerShell.
- Copies de fichiers vers le PC : écrire chaque nouvelle version depuis un
  chemin de staging NEUF, puis relire le fichier sur le disque et comparer
  taille et contenu. Réutiliser le même chemin a déjà réécrit une ancienne
  version, sans erreur.
- `gh` est installé sur mon PC depuis le 13.10.2026 : tu peux me donner
  gh pr create et gh pr merge --merge --delete-branch.
- Git : une commande par ligne, la séquence complète (cd, add, commit, push)
  après chaque modification, et les patches en blocs « cherche / remplace par »
  ou en fichiers complets.

RÈGLE DE TRAVAIL — n'écris dans AUCUN doc projet, quel que soit son numéro. La
consolidation se fait dans une conversation dédiée ; deux fils qui écrivent le
même doc s'effacent l'un l'autre sans signal. Tu mets à jour le journal du dépôt
(journal-moodboard-matieres.md, à compléter), et tu me rends en fin de session
un bilan de passation selon le modèle de la fin du doc 09. Ce bilan est le SEUL
véhicule de tes trouvailles : ce qui n'y figure pas est perdu.

Commence par un cadrage écrit : le traitement des trois cas de la partie A
(offre non signée, offre signée, commande), le modèle de données, la SQL 033 et
l'ordre de livraison (A puis B, ou l'inverse, avec ta raison). Ne touche à rien
avant validation.
