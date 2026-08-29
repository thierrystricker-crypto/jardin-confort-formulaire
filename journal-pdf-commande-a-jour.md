# Journal — Chantier « PDF de commande toujours à jour »

> Branche `fix/pdf-commande-a-jour` · 23.08.2026 · session unique
> Demande de départ : la carte « Aperçu commande » du dashboard affichait le PDF
> figé de la première version validée — plus à jour dès la moindre modification.
> Le chantier a fini par couvrir tout le cycle de vie des documents d'une commande.

---

## 1. Le constat de départ (diagnostic SQL + lecture du code)

- La carte « Aperçu commande » affichait `<iframe src={pdf_url}>` — le PDF Storage,
  figé à sa dernière génération. La branche « offre » de la même carte affichait
  déjà la page vivante `/print/offre/[slug]`.
- **Qui régénérait le PDF de commande :** validation ✓, commande directe ✓,
  correction ✓ *mais sous condition*, révision ✗ (jamais), téléchargement ✗
  (fichier servi tel quel).
- La condition de la correction (`shouldRegeneratePdf`) exigeait `shopifyLocked`
  sur **toutes** les lignes : une seule ligne à la volée, un service ou un logo
  bloquait la régénération en silence. **195 commandes sur 382** étaient
  ainsi exclues à vie.
- En base : 70 commandes avec un PDF certainement périmé, 60 commandes révisées
  jamais régénérées, 18 commandes sans PDF du tout (et donc sans carte d'aperçu).
- Le QR de paiement n'était **pas** régénéré après révision → montant faux
  (constaté sur CMD-80728 : QR à l'ancien montant au lieu de 4'145.00 = 50 % de 8'290.00).
- `corrections/route.ts` écrivait `pdf_regenerated_at` sur `offres` — colonne
  inexistante sur cette table (elle existe sur `corrections`) : écriture morte,
  avalée par un catch.
- `pdf_snapshot_at` existait sur `offres`, écrite par personne, vide sur 1118 lignes.

**Le fait qui a tout débloqué :** `/api/offres/[slug]` renvoie pour une commande
les lignes **figées J0** de `data`, jamais Shopify en direct. Régénérer un PDF de
commande, aujourd'hui ou dans six mois, reproduit exactement les stocks du jour
de la commande. Il n'y avait donc rien à « protéger » contre la régénération —
le critère `shopifyLocked` défendait un risque qui n'existe pas.

## 2. La décision métier (Thierry)

Le PDF figé ne sert **pas** de preuve — la preuve, c'est l'offre signée.
Le PDF ne sert qu'à être transmis au client sur demande : il doit donc **toujours**
être la version courante de la commande, avec les stocks du jour de la commande.
Le PDF cesse d'être un artefact figé et devient un rendu, toujours frais.

## 3. Les modifications, lot par lot

### 3.1 Migration SQL (SQL Editor, projet llkyzspixrbtoprtmvoh)
- `offres.pdf_initial_url text` (nouvelle) — archive du PDF d'origine.
- `offres.pdf_snapshot_at` (existante, réutilisée) — date de génération du PDF courant.
- Les 5 RPC du connecteur vérifiées avant : aucun `SELECT` nominatif cassé par un ajout.

### 3.2 `app/dashboard/[slug]/page.tsx`
- **Carte « Aperçu commande »** : affiche `/print/offre/[slug]` (page vivante,
  clone de la branche offre) au lieu du PDF. Badge « 🔄 Page à jour · stock figé J0 »,
  bandeau bleu sur `data.stock_frozen_at`, boutons Copier l'URL / Plein écran /
  « 📄 PDF à jour ». La carte existe même sans PDF (les 18 commandes orphelines).
  Ligne grise : date de génération du PDF Storage + lien « fichier tel quel » +
  lien « version d'origine » quand l'archive existe.
- **`ouvrirPdfAJour()`** : ouvre l'onglet AVANT le fetch (anti-popup-blocker),
  affiche « Génération… », POST `/pdf`, puis redirige l'onglet sur le fichier frais.
- **`ouvrirQrAJour()`** : même mécanique sur POST `/qr` — le QR régénéré porte le
  montant courant (50 % si acompte).
- **Boutons « Commande PDF » et « QR paiement »** (groupe Documents PDF) : pour une
  commande, régénèrent avant d'ouvrir. Pour une offre, comportement inchangé.
- **`frais()`** : cache-buster `?v=` sur pdf/qr/fiches à l'hydratation — le Storage
  Supabase sert les fichiers avec un cache d'1 h, l'URL nue peut donc montrer
  l'ancienne version jusqu'à 1 h après régénération.
- **Carte fiche de travail** : onglet « Actuelle » par défaut dès qu'elle existe
  (avant : « Initiale » d'office), bascule automatique après génération (plus
  besoin de recharger), bandeau et libellés corrigés.
- **Fiche initiale retirée du groupe Documents PDF** : pièce d'archive, pas un
  document de travail — risque de préparer une livraison sur la V1. Reste
  accessible dans la carte, onglet « Initiale ». Seul subsiste le bouton de
  rattrapage quand aucune initiale n'existe.
- **Textes corrigés** (3 endroits) : le popup de confirmation, l'info-bulle du
  bouton et le bandeau ambre annonçaient « STOCK DU JOUR » — faux depuis le
  figeage J0. La fiche affiche des stocks figés ligne par ligne, chacun à sa date.

### 3.3 `app/api/offres/[slug]/pdf/route.ts`
- Avant chaque écrasement du PDF d'une commande : copie unique du fichier
  existant vers `commandes/<slug>_initial.pdf` + `pdf_initial_url` (filet,
  jamais réécrit — même logique que la fiche de travail initiale).
- Chaque génération estampille `pdf_snapshot_at`.

### 3.4 `app/api/corrections/route.ts`
- `shouldRegeneratePdf` : critère `data.stock_frozen_at` présent, au lieu de
  `shopifyLocked` sur toutes les lignes. 186 → 377 commandes régénérables
  (les 5 restantes, mai-juin 2026, n'ont pas de snapshot).
- Après une correction réussie : régénère aussi la **fiche de travail courante**
  (si elle existe — elle affiche l'adresse de facturation) et le **QR de paiement**
  (si il existe — la QR-facture suisse porte le débiteur : nom/société, rue, NPA,
  ville — exactement les champs que la correction rectifie ; ancien bug réel).

### 3.5 `app/api/offres/[slug]/reviser/route.ts`
- Après une révision réussie, `after()` best-effort : régénère PDF commande,
  QR paiement et fiche de travail courante. Acte utilisateur explicite
  (l'enregistrement de la révision), jamais un timer.

### 3.6 `app/offre/[slug]/page.tsx` + `app/offre/[slug]/confirmation/page.tsx`
- Cache-buster `frais()` sur toutes les URLs pdf/qr affichées ou ouvertes —
  la page client sert toujours la version courante du Storage.

## 4. Ce qui n'a PAS changé (vérifié, pas supposé)

- **Aucun mouvement de stock.** Les routes de régénération font : lecture page
  print → pdf.co → Storage → colonne URL. Aucune n'importe `shopify-stock`,
  aucune n'appelle `stock-movements/process`. Les décréments restent où ils étaient.
- **Stocks affichés figés.** PDF commande : lignes J0. Fiche de travail : chaque
  ligne porte son stock figé et sa date (« au 27.06.26 » origine, « au 29.06 »
  ajout en révision) — aucun appel de stock live dans la page fiche.
- **Fiches initiales et QR-facture** : `api/offres/[slug]/qr/route.ts` (sanctuarisé)
  non modifié — seulement appelé. La fiche initiale n'est jamais réécrite.
- **Les 2 QR de scan de la fiche de travail** (n° de commande, nom client « Mag ») :
  encodés à la volée à chaque rendu depuis les données fraîches — pas de correctif
  nécessaire, le bug d'antan était la non-régénération du PDF porteur, réglée ici.
  Idem `/print/all` (jeu complet) : page dynamique, QR toujours courants.

## 5. Pièges découverts (pour le doc 04 via le bilan)

1. **Cache Storage Supabase 1 h** : régénérer un fichier ne suffit pas, l'URL nue
   sert l'ancienne version jusqu'à 1 h. Tout affichage doit porter un `?v=` unique.
2. **`shopifyLocked` comme critère de « commande saine » est faux** : les lignes
   à la volée, services et logos ne le portent jamais. Le bon marqueur est
   `data.stock_frozen_at` (377/382).
3. **Trois textes UI répétaient « stock du jour »** alors que le code fige tout —
   une doc UI peut mentir plus longtemps que le code.
4. **`pdf_regenerated_at` est sur `corrections`, pas sur `offres`** — l'audit
   initial de cette session s'y est trompé aussi.
5. **`window.open` après un `await` = popup bloqué** : ouvrir l'onglet d'abord,
   le rediriger ensuite.
6. **La preview Vercel écrit dans la vraie base** : les fichiers régénérés depuis
   la preview sont les vrais fichiers Storage de la prod.

## 6. Reste à faire

- [x] **Rattrapage one-shot — FAIT le 29.08.2026** via `scripts/rattrapage-documents.mjs` :
      149/149 régénérations réussies (79 PDF, 64 QR, 6 fiches courantes) sur la
      liste fermée de 80 dossiers extraite le 24.08. Vérifié en base : les 79
      cibles PDF portent un `pdf_snapshot_at` du jour, 0 restant ; 85 archives
      `_initial.pdf` créées au passage. Incident de parcours documenté : le
      script vise l'URL de `NEXT_PUBLIC_APP_URL` — avec le `.env.local` de dev
      il tape `localhost:3000` ; poser `$env:NEXT_PUBLIC_APP_URL` sur la prod
      avant de lancer. 4 échecs pdf.co transitoires, tous passés à la relance
      (reprise via `rattrapage-log.json`, non commité).
- [ ] Backlog éventuel : purge du cache/liens dans les mails déjà envoyés — les
      liens nus vers Storage peuvent servir 1 h de cache après une régénération.
