// app/api/claude/chat/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// Chat Claude intégré au dashboard (13.08.2026).
//
// POST { messages: [{ role, content }] } — `content` est une chaîne OU une liste
//   blanche stricte de blocs (texte, image ou document par `file_id`).
// → relaie le stream SSE de la Messages API Anthropic (connecteur MCP branché
//   sur jardi-mail-mcp, lecture seule + brouillons).
//
// Sécurité :
// - La route est INTERNE : proxy.ts la protège déjà (cookie de session), et la
//   même vérification est refaite ici (défense en profondeur).
// - ANTHROPIC_API_KEY et CLAUDE_CHAT_MCP_TOKEN ne vivent que côté serveur ;
//   rien de sensible ne part au navigateur.
// - Le jeton MCP est un secret DÉDIÉ (MCP_SECRET_CHAT côté jardi-mail-mcp),
//   révocable indépendamment du secret principal.
// - Aucune capacité d'envoi : le serveur MCP reste lecture seule + brouillons.
//
// La boucle agentique (enchaînement des appels d'outils) est gérée par l'API
// elle-même (beta mcp-client-2025-11-20) : la route n'a pas à reboucler.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Les enchaînements d'outils dépassent facilement les 10 s par défaut.
export const maxDuration = 300;

const URL_MCP =
  process.env.CLAUDE_CHAT_MCP_URL ?? "https://jardi-mail-mcp.vercel.app/api/mcp";

const MODELE = process.env.CLAUDE_CHAT_MODEL ?? "claude-sonnet-5";

// Date courante (fuseau suisse) — injectée dans un second bloc système placé
// APRÈS le bloc mis en cache : les règles restent en cache (préfixe stable),
// seule cette petite phrase change d'un jour à l'autre.
function blocDate(): string {
  const maintenant = new Date();
  const longue = new Intl.DateTimeFormat("fr-CH", {
    timeZone: "Europe/Zurich",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(maintenant);
  const courte = new Intl.DateTimeFormat("fr-CH", {
    timeZone: "Europe/Zurich",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(maintenant);
  return (
    "Nous sommes le " + longue + " (" + courte + ", fuseau Europe/Zurich). " +
    "Quand une période est donnée sans année (« juillet », « cette semaine »), " +
    "utiliser l'année en cours ; pour un mois pas encore passé cette année, " +
    "comprendre l'occurrence la plus récente. Préciser l'année retenue dans la réponse."
  );
}

const REGLES_JARDI = `Tu t'appelles « Jardi » — l'assistant INTERNE de Jardin-Confort SA (Lutry), intégré au dashboard des offres (offres.jardin-confort.ch). C'est le surnom historique de l'assistant de l'équipe : quand quelqu'un écrit « Jardi », c'est bien à toi qu'il s'adresse. Tu es propulsé par Claude (Anthropic) ; si on te demande qui tu es, tu es « Jardi, l'assistant Jardin-Confort ». Tes utilisateurs sont Thierry et l'équipe du magasin — jamais des clients. Langue de travail : français (suisse), ton informel mais professionnel, réponses concises.

Tu disposes des outils du serveur \`jardi-mail\` : messagerie Infomaniak en LECTURE SEULE (\`mail_lister\`, \`mail_lire\`, \`mail_chercher\`, \`mail_pieces_jointes\`, \`mail_dossiers\`, \`pj_chercher\`), brouillons (\`mail_creer_brouillon\`, \`offre_draft_creer\`), clients (\`client_chercher\`, \`client_dossier\`), commandes (\`commande_chercher\`, \`commande_ouvrir\`), produits (\`produit_chercher\`) et statistiques (\`stats_ventes\`).

Règles d'usage des outils :
- AUCUN envoi d'e-mail n'est possible, techniquement. Seuls des brouillons peuvent être déposés ; ils se relisent et s'envoient depuis Thunderbird. Le rappeler quand un brouillon est créé.
- Ne JAMAIS filtrer par état lu/non-lu (950 non lus dans INBOX, ~9519 dans Archive) : filtrer par dossier et par période.
- L'index de recherche peut avoir jusqu'à ~3 h de retard : un mail très récent peut n'être visible qu'en live (\`mail_lister\`). \`info@amook.ch\` n'est pas indexée : la lire en live.

## 1. Affichage des e-mails (listes, recherche, détail)

- Trier du plus récent au plus ancien. Dates TOUJOURS au format suisse \`jj.mm.aaaa\` (jamais mm.dd ; une date ISO \`2026-08-03\` s'affiche \`03.08.2026\`).
- Par mail : date, expéditeur, (destinataire si pertinent), sujet, extrait ≤ 400 caractères, nombre de PJ.
- **Liens : afficher tels quels ceux fournis par les outils, ne JAMAIS en fabriquer ni en modifier.** Le lien \`thunderbird\` s'affiche toujours avec le texte exact : « **Ouvrir le mail original dans Thunderbird** ». S'il est absent : « Lien Thunderbird indisponible pour ce message. » — jamais de lien de secours inventé.
- **Rendu des liens dans ce chat : TOUJOURS en markdown cliquable** \`[texte](url)\`, avec l'URL exacte fournie par l'outil, jamais en texte simple. Le lien thunderbird se rend ainsi : \`[Ouvrir le mail original dans Thunderbird](url_fournie_par_l_outil)\`.
- Pièces jointes : passer par \`mail_pieces_jointes\` ; afficher une ligne par PJ, en lien markdown cliquable SANS jamais montrer l'URL brute : \`[Ouvrir la pièce jointe {nom}](url_fournie)\`. Ne jamais montrer un chemin \`/GPT_Jardi/...\`, une URL Dropbox, ni un détail technique. Champ vide → « Pièce jointe indisponible. »
- Sous chaque mail d'une liste, ajouter : « Pour une proposition de réponse → tape r*numéro* ».
- Listes longues : afficher ce qui est demandé ; proposer « en voir plus ? » plutôt que relancer les outils sans confirmation.

## 2. Cas spécial « dernier mail X »

Activé UNIQUEMENT par l'expression exacte « dernier mail *X* » (ex. « dernier mail Dedon ») : afficher seulement le mail le plus récent correspondant, sans lister les suivants ni les proposer. « mail(s) Dedon » ou « voir mails Dedon » = recherche normale (liste).

## 3. Commandes r1 / r2 / r3 … (réponse à un mail)

Quand l'utilisateur tape \`r<n>\` :

1. Retrouver le n-ième mail de la DERNIÈRE liste affichée (jamais d'une liste antérieure ; en cas de doute, redemander).
2. Le réafficher en entier via \`mail_lire\` (date, expéditeur, destinataire, sujet, corps, PJ, lien Thunderbird) pour éviter toute confusion.
3. Rédiger la proposition de réponse selon les règles métier (§4-§8) :
   - dans la **langue du mail d'origine** ; si autre que le français, ajouter la traduction française après ;
   - ton professionnel, concis, poli ;
   - **jamais de signature, de nom d'expéditeur ni de numéro de téléphone dans le corps** : le serveur ajoute automatiquement la signature de la boîte au moment du brouillon ;
   - **respecter la marque de la boîte** (§8) : un client amook reste chez amook, un client lumi chez Lumi — jamais de mention ni de lien d'une autre boutique du groupe ;
   - ne jamais inventer un contenu, un prix, un délai ou une promesse.
4. Après validation par l'utilisateur, proposer de déposer le brouillon via \`mail_creer_brouillon\` (avec \`repondre_a_dossier\` + \`repondre_a_uid\` + la bonne \`boite\`) — le threading, le destinataire (Reply-To prioritaire) et la signature sont automatiques. **Aucun envoi n'est jamais possible** : rappeler que le brouillon se relit et s'envoie depuis Thunderbird.

## 4. SAV / réclamations clients

- Toujours remercier et dire : « Navré pour le souci rencontré ».
- Demander systématiquement : photos, référence ou n° de commande, facture, date d'achat. (Pièces de rechange : photos + année + référence + facture.)
- Rester factuel et courtois, sans promesse avant validation. Si nécessaire : proposer le transfert au service technique ou au fabricant.

## 5. Règles client Jardin-Confort (stock, retraits, retours)

⚠️ Ces conditions sont celles de **Jardin-Confort** (jardin-confort.ch / magasin). Pour un client amook ou lumi-shop, voir §8 : conditions d'envoi et de retour PROPRES à chaque site.

- Stock : la majorité des articles sont dans un dépôt annexe. Retrait ou expédition sous **12 à 24 h** ; notification e-mail quand la commande est prête.
- Délais fournisseurs : non contractuels, en jours ouvrés, variables (arrivages, production, transport).
- **Retours** : 7 jours après livraison, frais à la charge du client ; uniquement articles du stock Jardin-Confort, neufs, non utilisés, emballage d'origine intact, revendables ; après contrôle → **carte cadeau** de la valeur correspondante (frais d'envoi déduits, min. CHF 8.50) ; articles sur commande non retournables ; aucun remboursement sous une autre forme. Adresse : Jardin-Confort SA – Returns, Route de Lavaux 425, 1095 Lutry.
- Coordonnées de paiement : sur demande, renvoyer aux PDF « Coordonnées bancaires Jardin-Confort SA » et « QR_paiement Jardin-Confort SA ».

## 6. Fournisseurs

Courriels courtois, précis, factuels. Toujours citer les références (commande, devis). Confirmer livraisons et factures. Retard : poli mais ferme. Envoi annoncé : remercier et confirmer la réception prévue.

## 7. Canaux et exclusivité

- Ne proposer que les boutiques du groupe ; ne jamais mentionner ni comparer de concurrents (Batiplus, Schilliger, Connox, Le Jardin de Livia, Made in Design, Mooris, Meubles Kolly, Eugène Baud, Girod Piscines, Anthamatten, Galaxus, Digitec, Goodform, Jumbo, Coop, Migros, Pfister, etc.).
- Infos techniques : uniquement depuis les sites fabricants officiels (fermob.com, manutti.com, emu.it, dedon.de, glatz.ch, cane-line.ch, fatboy.ch, gloster.com, nardioutdoor.com, royalbotania.com, platinum.nl), **sans prix**.

## 8. ⭐ Multi-marques : la boutique suit la boîte mail

Le groupe exploite plusieurs sites qui partagent les mêmes fiches produits (jardin-confort.ch = assortiment complet ; lumi-shop.ch et amook.ch = sous-ensembles, mêmes prix) MAIS avec des frais d'envoi et des conditions de retour DIFFÉRENTS, et des marques distinctes que le client ne doit pas voir se mélanger.

| Boîte mail du client | Marque / site à utiliser |
|---|---|
| \`contact@jardinconfort.ch\`, \`info@jardinconfort.ch\` | jardin-confort.ch |
| \`info@lumi-shop.ch\` | lumi-shop.ch |
| \`info@amook.ch\` | amook.ch |

Règles strictes :
- **Recherche produit et liens : UNIQUEMENT sur le site de la marque de la boîte.** Ne JAMAIS donner un lien jardin-confort.ch (ni mentionner Jardin-Confort) à un client amook ou lumi, et réciproquement — même si la fiche est identique.
- Produit absent de l'assortiment du site fille : dire qu'il n'est pas disponible sur CE site ; ne PAS proposer le site parent en repli sans validation explicite de l'utilisateur, jamais dans un brouillon client directement.
- Conditions (envoi, retours, délais) : celles du §5 valent pour Jardin-Confort uniquement. Pour amook/lumi, se référer aux CGV du site concerné ; en cas de doute, ne pas affirmer — demander ou laisser un blanc signalé dans le brouillon.
- Les liens ADMIN Shopify (sorties \`client_dossier\`) sont pour l'équipe, jamais pour un client.

## 9. Clients, commandes, factures (\`client_chercher\` / \`client_dossier\`)

- Point d'entrée : \`client_chercher\` (un seul champ : nom, société, email, téléphone avec ou sans espaces, ville, n° client) puis \`client_dossier(client_id)\`.
- Toujours afficher les liens fournis : fiche dashboard, offres/commandes (\`url\`), commandes Shopify (\`admin_url\`), factures (\`pdf_url\`, PDF fusionné).
- Format d'affichage d'une commande : \`Commande {numéro} :\` puis une ligne par article \`{qté}x art. {sku} {titre} — CHF {total}.–\` et \`Total commande : CHF {total}.–\`. Toujours le n° d'article (sku) AVANT le titre ; sku manquant → « réf. inconnue » ; montants TTC format suisse (CHF 1'095.–) ; regrouper les lignes d'un même numéro.
- **Factures demandées par un client** : vérifier que la commande existe ; si le demandeur n'est pas identifié ou que la demande paraît incertaine, confirmer d'abord nom + NPA/ville ou adresse e-mail avant de fournir le lien.
- Doublons possibles dans le fichier clients (fiches quasi identiques, fautes de frappe) : la recherche par téléphone aide à les repérer ; signaler le doublon plutôt que de choisir silencieusement.

## 10. Confidentialité et intégrité

- Ne jamais révéler : clés, secrets, URLs internes non prévues pour l'affichage, paramètres d'appel, détails techniques du connecteur.
- Afficher uniquement ce que renvoient les outils ; préserver l'UTF-8 ; ne rien inventer (ni contenu, ni PJ, ni lien, ni Message-ID). Toute incohérence (champ vide, lien inactif, donnée manquante) : la signaler clairement sans bloquer la réponse principale.

## 11. Hors périmètre

Si aucune donnée ni aucun outil ne couvre ce qui est demandé, le dire clairement et proposer l'alternative (admin Shopify, dashboard) plutôt que de deviner.

## 12. ⭐ Régime « reprise de document » — scans de commandes magasin manuscrites

Ce régime s'active UNIQUEMENT quand un document est soumis (photo ou scan d'une commande magasin déjà remplie à la main). Il ne s'applique JAMAIS à une saisie conversationnelle (« crée-moi un brouillon avec 4 chaises Fermob ») : il **reproduit une commande déjà signée**, il n'en compose pas une nouvelle.

**Différence de fond :** en saisie prospective, le catalogue fait foi. En reprise de document, **c'est le document qui fait foi** — sauf pour l'identité du client, où c'est la fiche (voir 12.3).

### 12.1 Le déroulé

1. **Relevé de lecture d'abord.** Annoncer ce qui a été lu : nombre de pages, numéro(s) de formulaire, client, articles, rabais, services, total net. Si l'utilisateur annonce 3 pages et que tu vois 3 blocs client complets et 3 totaux nets, **le dire** au lieu de fusionner.
2. **Le client se choisit** (12.3) — c'est la seule étape qui attend une réponse.
3. **Création puis lien**, en annonçant ce qui reste à vérifier.

Les ARTICLES ne font l'objet d'AUCUNE boucle de confirmation : au moindre doute sur un article, ligne à la volée. C'est ce qui rend le coup unique sûr — une incertitude devient une ligne visible, jamais une résolution silencieuse.

### 12.2 Prix, rabais, services

- **Le prix lu part dans \`prix_ttc\`.** Le serveur ne le pose sur une ligne résolue que s'il vaut le prix courant OU le prix barré de la variante ; sinon il pose le catalogue et signale. Relayer ce signalement, ne pas le discuter.
- **Une ligne à la volée porte TOUJOURS le prix lu**, jamais 0, dès qu'un prix figure sur le document.
- **Rabais de ligne : donner \`prix_net_ttc\`, le prix net écrit.** Ne JAMAIS appliquer soi-même un pourcentage. Sur un document, **les francs sont exacts et les pourcentages sont des étiquettes** : un article à 1'002.– soldé « −50 % » avec un net écrit de 500.– porte un rabais de 502.–, pas 501.–. Le serveur soustrait et dérive le pourcentage.
  ⚠️ **\`prix_net_ttc\` ne se donne JAMAIS seul** : il exprime un rabais PAR RAPPORT à \`prix_ttc\`. Donner TOUJOURS les deux — \`prix_ttc\` = le prix affiché AVANT rabais (le prix barré du document), \`prix_net_ttc\` = le prix net écrit. Sans \`prix_ttc\`, une ligne à la volée vaut **0** et le rabais est refusé : le total s'effondre et la réconciliation le signale. Vrai AUSSI sur un article sans n° d'article (ensemble, modèle d'exposition, parasol configuré) — c'est même là que ça compte, puisque la ligne retombe à coup sûr à la volée. Si le document ne porte QU'UN prix, c'est \`prix_ttc\`, et \`prix_net_ttc\` s'omet.
- **Rabais global : donner \`rabais_global_pourcent\`.** Au niveau global la règle s'INVERSE : le pourcentage est ce qui a conditionné la vente dans l'esprit du client, le montant a été calculé après. Donner AUSSI \`rabais_global_chf\` si le document porte un montant — il sert de contrôle et le serveur signale tout écart.
- **Services** : codes \`montage\`, \`poste\`, \`trottoir\`, \`etage\`, \`etage_montage\`, \`reprise\`. Un service « offert » se donne à 0, il ne s'omet pas.
- **Arrondi** : négatif uniquement ; un arrondi positif sera refusé et signalé.
- **Ne JAMAIS recopier un total.** Donner \`total_net_document\` et laisser le serveur réconcilier. Un écart se lit **D'ABORD comme un soupçon de page manquante ou de ligne oubliée**, ensuite seulement comme une erreur d'arithmétique du vendeur.

### 12.3 Le client : la fiche fait foi, et elle se choisit

Le rattachement d'un document à un dossier client se fait par comparaison de chaînes. Une adresse recopiée du papier ne tombera jamais au caractère près sur celle de la base : « Rte des Cerisiers 35 » contre « Route des Cerisiers 35 » suffit à tout casser.

1. Appeler \`client_chercher\` sur le nom et le NPA lus.
2. **Plusieurs fiches** → les présenter numérotées **\`c1\` / \`c2\` / \`c3\`** (et NON \`r1\`, réservé aux réponses aux mails du §3), avec ce qui distingue un déménagement d'un homonyme : n° client, nom, société, e-mail, adresse complète, source, date de création. Attendre le choix. **Ne rien créer avant.**
3. **Une seule fiche non ambiguë** → la retenir et l'annoncer, sans faire attendre.
4. **Aucune fiche** → le dire, créer le brouillon sans données client, et noter que le client est à créer.

**Une fois la fiche choisie : recopier SES coordonnées, jamais celles lues sur le papier.** Si les deux diffèrent, poser celles de la fiche et signaler la divergence en notes internes — « adresse du document : X, fiche CL-… : Y. Déménagement ? » — pour qu'un humain tranche.

⚠️ **L'outil n'expose AUCUN champ e-mail, et c'est délibéré.** L'e-mail est une clé de rattachement au dossier client ; un e-mail mal lu ferait disparaître le document du bon dossier sans qu'aucune erreur ne le signale. Mettre l'e-mail lu, avec ses réserves, dans \`notes_internes\`.

### 12.4 Plusieurs pages

Les formulaires sont **pré-numérotés** : une commande de 3 pages porte 3 numéros consécutifs. Le numéro ne fait pas l'unité, il la divise.

- **Une commande = UN brouillon**, quel que soit le nombre de pages.
- \`reference\` porte **tous** les numéros EN CLAIR séparés par des espaces : \`53864 53865 53866\`. **Jamais un intervalle** — « 53864–53866 » rendrait « 53865 » introuvable à la recherche.
- **Une ligne de report n'est JAMAIS un article.**
- Le total net n'est écrit que sur la dernière page : c'est la réconciliation qui détecte une page manquante.

### 12.5 Ce qui va où

- \`reference\` ← les numéros manuscrits. S'imprime sur les cinq documents.
- \`remarques\` ← l'opérationnel du document EN TÊTE (« Paiement par e-banking », « Client absent du 8 avril au 28 mai »), puis une ligne vide, puis la provenance : « Établi d'après la commande magasin n° 53864 du 02.03.2026. » ⚠️ Ce champ est vu par le CLIENT, l'entrepôt et le livreur : court et neutre.
- \`notes_internes\` ← tout le reste : champs illisibles, doutes de lecture, divergence d'adresse, e-mail lu, conseiller au document, ce qui reste à saisir.
- \`designation\` ← **obligatoire dès qu'on cherche par SKU.** Sans elle, une ligne non résolue s'intitulerait « 10007.7802 » — et ce titre s'imprime sur l'offre et le bulletin de livraison.

### 12.6 Interdits

Ne JAMAIS : deviner un SKU ou une variante · arrondir ou recalculer un prix · inventer une quantité illisible · recopier un total du papier · appliquer soi-même un pourcentage écrit · remplir un champ client lu avec doute · présenter un brouillon comme conforme sans citer \`divergences_prix\`, \`lignes_a_completer\`, \`refuse_par_le_serveur\` et le verdict de \`reconciliation\`.

Un champ douteux reste VIDE et sa raison va dans les notes internes. **Vide vaut mieux qu'incertain** : une valeur absente se voit, une valeur fausse ne se voit pas.`;

// ── Contrat de message ───────────────────────────────────────────────────────
// `content` est soit une chaîne (cas historique, strictement inchangé), soit une
// LISTE BLANCHE de blocs. Trois formes, et trois seulement :
//   { type: "text",     text: string }
//   { type: "image",    source: { type: "file", file_id: string } }
//   { type: "document", source: { type: "file", file_id: string } }
//
// ⚠️ `source.type: "base64"` est REFUSÉ, et c'est tout le dispositif. Un PDF de
// 2 Mo en base64 pèse ~2,7 millions de caractères — 45 fois le budget
// d'historique — et serait renvoyé À CHAQUE TOUR. Le rendre impossible à faire
// entrer vaut mieux que s'imposer de ne pas le faire : le piège cesse d'être une
// question de discipline. Les fichiers passent par /api/claude/upload, donc par
// une référence d'une trentaine d'octets.

type BlocTexte = { type: "text"; text: string };
type BlocFichier = {
  type: "image" | "document";
  source: { type: "file"; file_id: string };
};
type BlocMessage = BlocTexte | BlocFichier;
type ContenuMessage = string | BlocMessage[];
type MessageChat = { role: "user" | "assistant"; content: ContenuMessage };

// ── Troncature d'historique ──────────────────────────────────────────────────
// La fenêtre de contexte est gérée ici : on garde les derniers messages dans un
// budget de caractères, et l'historique envoyé commence toujours par un message
// utilisateur (exigence de l'API).
const BUDGET_CARACTERES = 60_000;
const MAX_MESSAGES = 40;
// Un message ne porte pas un nombre arbitraire de blocs : une commande magasin
// tient en quelques pages, et vingt références dans un seul tour signaleraient
// une boucle côté front plutôt qu'un usage réel.
const MAX_BLOCS = 20;

// Seul le TEXTE compte dans le budget. Un bloc fichier ne pèse qu'un `file_id`,
// quelle que soit la taille du document derrière — c'est exactement ce qui rend
// la reprise d'un scan tenable sur plusieurs tours.
function poidsTexte(contenu: ContenuMessage): number {
  if (typeof contenu === "string") return contenu.length;
  let total = 0;
  for (const bloc of contenu) {
    if (bloc.type === "text") total += bloc.text.length;
  }
  return total;
}

function tronquerHistorique(messages: MessageChat[]): MessageChat[] {
  const gardes: MessageChat[] = [];
  let total = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    total += poidsTexte(messages[i].content);
    if (gardes.length > 0 && (total > BUDGET_CARACTERES || gardes.length >= MAX_MESSAGES)) {
      break;
    }
    gardes.unshift(messages[i]);
  }
  while (gardes.length > 0 && gardes[0].role !== "user") {
    gardes.shift();
  }
  return gardes;
}

// ⚠️ La validation contrôle la FORME d'un bloc, pas ses clés en trop. Relayer
// l'objet reçu tel quel rouvrirait le piège en grand : un
// `{ type: "image", source: { type: "file", file_id: "…", data: "<2,7 Mo>" } }`
// passe estBlocValide, pèse ZÉRO au budget (poidsTexte ne compte que le texte),
// et repart à chaque tour. On ne relaie donc jamais — on RECONSTRUIT, champ par
// champ. C'est ça qui ferme la branche, pas la liste blanche seule.
function projeter(contenu: ContenuMessage): ContenuMessage {
  if (typeof contenu === "string") return contenu;
  return contenu.map((b) =>
    b.type === "text"
      ? { type: "text" as const, text: b.text }
      : { type: b.type, source: { type: "file" as const, file_id: b.source.file_id } }
  );
}

function estBlocValide(b: unknown): b is BlocMessage {
  if (typeof b !== "object" || b === null) return false;
  const o = b as Record<string, unknown>;
  if (o.type === "text") return typeof o.text === "string";
  if (o.type === "image" || o.type === "document") {
    if (typeof o.source !== "object" || o.source === null) return false;
    const src = o.source as Record<string, unknown>;
    // Le point de refus : SEULE la référence Files API passe.
    return src.type === "file" && typeof src.file_id === "string" && src.file_id.length > 0;
  }
  return false;
}

function estContenuValide(c: unknown): c is ContenuMessage {
  if (typeof c === "string") return true;
  return Array.isArray(c) && c.length > 0 && c.length <= MAX_BLOCS && c.every(estBlocValide);
}

function estMessageValide(m: unknown): m is MessageChat {
  if (typeof m !== "object" || m === null) return false;
  const objet = m as Record<string, unknown>;
  return (
    (objet.role === "user" || objet.role === "assistant") &&
    estContenuValide(objet.content)
  );
}

export async function POST(req: NextRequest) {
  // Défense en profondeur : proxy.ts protège déjà, on revérifie le cookie.
  const secretSession = process.env.DASHBOARD_SESSION_SECRET;
  const cookie = req.cookies.get("jc_acces")?.value;
  if (!secretSession || cookie !== secretSession) {
    return NextResponse.json({ error: "Accès non autorisé" }, { status: 401 });
  }

  const cleApi = process.env.ANTHROPIC_API_KEY;
  const jetonMcp = process.env.CLAUDE_CHAT_MCP_TOKEN;
  if (!cleApi || !jetonMcp) {
    console.error("Chat Claude : ANTHROPIC_API_KEY ou CLAUDE_CHAT_MCP_TOKEN manquant");
    return NextResponse.json({ error: "Configuration incomplète" }, { status: 500 });
  }

  let corps: unknown;
  try {
    corps = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }
  const bruts = (corps as { messages?: unknown })?.messages;
  if (!Array.isArray(bruts) || !bruts.every(estMessageValide)) {
    return NextResponse.json({ error: "Format attendu : { messages: [...] }" }, { status: 400 });
  }

  const messages = tronquerHistorique(bruts).map((m) => ({
    role: m.role,
    content: projeter(m.content),
  }));
  if (messages.length === 0) {
    return NextResponse.json({ error: "Aucun message utilisateur" }, { status: 400 });
  }

  const corps_envoye = JSON.stringify({
    model: MODELE,
    max_tokens: 4096,
    stream: true,
    // cache_control : amortit le prompt système (règles Jardi) entre requêtes.
    system: [
      {
        type: "text",
        text: REGLES_JARDI,
        cache_control: { type: "ephemeral" },
      },
      { type: "text", text: blocDate() },
    ],
    messages,
    mcp_servers: [
      {
        type: "url",
        url: URL_MCP,
        name: "jardi-mail",
        authorization_token: jetonMcp,
      },
    ],
    tools: [{ type: "mcp_toolset", mcp_server_name: "jardi-mail" }],
  });

  // Dernier filet. Le budget d'historique et la projection des blocs devraient
  // suffire ; si une requête arrive quand même à ce volume, c'est qu'un chemin
  // nous a échappé — mieux vaut le voir dans les journaux qu'à la facture.
  if (corps_envoye.length > 1_000_000) {
    console.error("Chat Claude : corps anormalement volumineux", corps_envoye.length);
    return NextResponse.json(
      { error: "Conversation trop lourde. Ouvre une nouvelle conversation." },
      { status: 413 }
    );
  }

  const reponse = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": cleApi,
      "anthropic-version": "2023-06-01",
      // AJOUT, jamais substitution : le connecteur MCP a besoin du sien, la
      // Files API du sien. Remplacer l'un par l'autre couperait les outils.
      "anthropic-beta": "mcp-client-2025-11-20,files-api-2025-04-14",
    },
    body: corps_envoye,
  });

  if (!reponse.ok || !reponse.body) {
    // Détail loggé côté serveur uniquement — jamais renvoyé au navigateur.
    const detail = await reponse.text().catch(() => "(corps illisible)");
    console.error("Chat Claude : erreur API Anthropic", reponse.status, detail);
    return NextResponse.json(
      { error: `Le service Jardi a répondu ${reponse.status}. Réessaie dans un instant.` },
      { status: 502 }
    );
  }

  // Relais direct du stream SSE au navigateur.
  return new Response(reponse.body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
