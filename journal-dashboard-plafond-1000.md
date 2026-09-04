# Journal — Correctif « Dashboard : dossiers invisibles au-delà de 1000 lignes »

> Session du 04.09.2026 (une conversation Cowork, un fichier touché, un commit).
> Signalé par l'équipe : la recherche « GIRAUD » dans le dashboard ne ressort rien
> alors que la commande **CMD-80542** existe.

---

## Symptôme

Taper « giraud » dans la barre de recherche du dashboard renvoie zéro résultat.
La commande CMD-80542 (Cindy GIRAUD, Brice, 08.05.2026) et son offre d'origine
DEV-2026-019 existent bien, s'ouvrent par leur URL, et apparaissent sur la fiche
client. Seul le dashboard ne les voit pas.

## Diagnostic (SQL d'abord, code ensuite)

**Fausses pistes écartées sur pièces.** `client_nom` = `GIRAUD` exactement
(6 caractères, hex `474952415544`, ni espace ni caractère invisible). Le filtre
local de `app/dashboard/page.tsx` (`normalize` + `matchesAllWords`) est correct.
La vue `offres_dashboard` n'a aucun `WHERE` : elle expose les 1213 lignes de
`offres`.

**Cause réelle : le plafond PostgREST.** `app/api/dashboard/offres/route.ts`
faisait un unique `.from("offres_dashboard").select("*").order("created_at")`,
sans `.range()`. Supabase/PostgREST **tronque silencieusement toute réponse à
1000 lignes** (`max-rows`, réglage par défaut du projet), sans erreur ni
avertissement. Le dashboard ne recevait donc que les 1000 dossiers les plus
récents ; la commande GIRAUD était en position **1189** sur 1213.

Le bug s'est déclenché le jour où la table a franchi 1000 dossiers (fin août /
début septembre 2026) et s'aggravait à chaque nouvelle commande : tout ce qui
est antérieur à ~mi-mai 2026 avait disparu du dashboard — recherche, filtres
rapides, compteurs en tête de page (`computeStats` travaille sur la même liste).
Aucune donnée n'a été perdue ni modifiée : c'est un problème de lecture.

## Correctif

`app/api/dashboard/offres/route.ts` — remplacement complet du fichier :

- boucle de pagination `.range(from, from + 999)` par tranches de **1000**,
  arrêt dès qu'une page revient incomplète ;
- tri secondaire `.order("id", { ascending: false })` pour que les pages soient
  stables si deux dossiers partagent le même `created_at` ;
- `export const dynamic = "force-dynamic"` explicite ;
- commentaire d'explication du plafond, pour que le prochain lecteur ne
  re-diagnostique pas.

Aucun changement dans `page.tsx`, aucune migration, aucune RPC, aucun fichier
sanctuarisé. Le contrat de la route (tableau JSON trié `created_at DESC`) est
inchangé.

**Vérification en base** : avec le tri `created_at DESC, id DESC`, la page 1
contient 1000 lignes, la page 2 en contient 213, et l'id 119 (CMD-80542) tombe
bien en page 2.

**Coût** : un second appel Supabase (~10 ms sur cette vue légère, sans JSONB).
Imperceptible. Une troisième page n'apparaîtra qu'au-delà de 2000 dossiers.

## Audit des autres routes

Passées en revue le même jour : `api/dashboard/articles` (RPC
`offres_par_article`), `api/stats/*` (RPC), `api/clients` (batches de 200 / 30
avec `.in()` / `.or()`, et `.limit()` explicites), `api/drafts` (`.limit`),
`api/delais` (`.limit` ou `.in()`). **Aucune autre route ne charge une table
entière sans borne.** À garder à l'œil : `commandes_shopify` et
`factures_winbiz` (13 316 lignes) si un jour un écran veut tout lire d'un coup.

## Pièges et décisions à consigner

- 🔴 **Piège** : PostgREST plafonne à 1000 lignes **sans le dire**. Toute lecture
  « tout charger » sur une table qui grossit doit soit paginer par `.range()`,
  soit passer par une RPC. Le symptôme est un dossier ancien qui « n'existe pas »
  alors qu'il s'ouvre par son URL.
- **Décision** : paginer dans le code plutôt que remonter `max-rows` dans les
  réglages API Supabase — le réglage est global au projet, invisible dans le
  dépôt, et se perdrait à une recréation du projet.
- **Horizon** : `page.tsx` filtre toute la liste côté client. Sans problème
  jusqu'à quelques milliers de lignes ; au-delà de plusieurs dizaines de
  milliers, il faudra une recherche serveur (le composant article en a déjà
  une, `offres_par_article`, qui peut servir de modèle).

## Fichiers touchés

`app/api/dashboard/offres/route.ts` (seul).

## Smoke test attendu après déploiement

Rechercher « giraud » : DEV-2026-019 et CMD-80542 ressortent (l'offre reste
masquée si « masquer les converties » est coché). Les compteurs de tête
augmentent de ~213 dossiers, essentiellement anciens.

---

## Bilan de passation

- **Backlog 05** : aucune entrée existante fermée. Entrée nouvelle à créer,
  gravité **P0** (livrée le jour même) : « Dashboard tronqué à 1000 dossiers par
  le plafond PostgREST — paginé le 04.09 ». Entrée **P3** : « Recherche serveur
  pour le dashboard au-delà de quelques milliers de lignes ».
- **Doc 04 (pièges)** : ajouter le piège du plafond 1000 lignes ci-dessus.
- **Doc 06 (décisions)** : ajouter la décision « pagination dans le code, pas
  `max-rows` ».
- **Docs 01, 02, 07, 08, 09** : rien à changer.
- **Commit à chercher** : oui, un seul, sur `main`, message « fix(dashboard):
  paginer /api/dashboard/offres au-delà du plafond PostgREST de 1000 lignes ».
- **Greffe** : aucune entrée en greffe.
