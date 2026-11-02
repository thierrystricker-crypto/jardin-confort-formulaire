# Bilan de passation — Améliorations formulaire et offres (07-08.10.2026)

> À coller dans la conversation de consolidation. Aucun doc projet n'a été écrit
> par cette session. Journal du dépôt : `journal-ameliorations-octobre-2026.md`
> (racine du dépôt). Tout est **en production** au 08.10.2026.

## 0. Commits — oui, il y a du code à chercher

| Commit | Objet |
|---|---|
| `7c8a53e` | Picker Shopify : vue étendue plein écran |
| `448d96e` | Lignes d'offre : ▲▼ de quantité + badge 3D |
| `f82f93a` | Service personnalisé : libellé cliquable, avertissement prix manquant |
| `3a7abd9` | Services Offert (valeur affichée) / Inclus + libellé du service perso sur la page client |
| `3cd3536` | Bouton Prolonger une offre |

Branches `feat/picker-etendu` (4 premiers) et `feat/prolonger-offre`, toutes deux
mergées sur `main`. Prod = `3cd3536`.

## 1. Entrées du backlog 05

**Aucune entrée ne passe en ✅** : les cinq demandes venaient du terrain, sans entrée
préalable.

**Précisées, non fermées :**

- **P2-44 / P2-45 — périmètre plus large que noté, et coût réel mesuré.** Deux fois dans
  la session, une livraison correcte a été jugée « invisible en preview » (Offert,
  puis Prolonger), parce que les boutons du dashboard ouvrent la prod. En plus de
  `fiche-travail-pdf`, **`api/offres/[slug]/pdf` construit lui aussi l'URL rendue par
  pdf.co sur `NEXT_PUBLIC_APP_URL`**, et `api/corrections` régénère le PDF d'une commande
  via la même base. **Proposition : remonter P2-44/45 en P1** — le défaut fait conclure
  faux à chaque test de preview qui touche un document.
- **P3-5 (helpers dupliqués)** : 3 nouveaux modules partagés, à citer comme modèle —
  `lib/badge-stock-picker.ts`, `lib/service-affichage.ts`, `lib/validite-offre.ts`.
- **P3-2 (découper `DraftFormulaire`)** : le fichier passe de 4 394 à 4 622 lignes. La vue étendue a été écrite en **composant séparé** pour ne pas
  l'alourdir.
- **P3-49 (variantes nombreuses)** : la vue étendue répond côté formulaire (filtres et
  tri au sein des résultats) ; la limite Storefront de 20 produits × 100 variantes
  reste. Le connecteur n'est pas concerné.

## 2. Entrées nouvelles proposées

*Numéros à attribuer par la consolidation (dernier connu au 04.09 : P1-55, P2-48, P3-75).*

| Gravité | Sujet | Détail |
|---|---|---|
| **P1** | **`valider` n'applique pas l'expiration côté serveur** | Aucune occurrence de validité ni d'expiration dans `api/offres/[slug]/valider/route.ts` : seule la page masque le bouton. Une offre expirée reste signable par un appel direct. Devient plus visible maintenant que la validité se prolonge. **Hôte naturel : chantier 3** (même route, P0-3 et P0-4) |
| **P2** | **Aucun mail au client lors d'une prolongation** | La validité change sur la page et le PDF, mais personne n'est prévenu. Choix volontaire de la v1 |
| **P3** | **Le PDF d'une offre n'est pas régénéré après une correction** | `shouldRegeneratePdf` ne régénère que les commandes. Une offre corrigée ou prolongée garde son PDF stocké jusqu'au prochain clic sur le bouton PDF (qui régénère). Sans gravité tant que le bouton est utilisé avant l'envoi |
| **P3** | **Badge 3D : un appel par ouverture de brouillon** | Le cache vit dans la session du formulaire. Négligeable aujourd'hui (une requête Supabase pour toutes les lignes) |
| **P3** | **`print/offre/page.tsx` (sans slug) n'a reçu ni Offert/Inclus ni la prolongation** | Page héritée, jugée inutilisée. À supprimer avec P3-1 plutôt qu'à maintenir |

## 3. Docs à mettre à jour

- **01 architecture** :
  - nouveaux composants `ShopifyPickerEtendu`, `ProlongerOffreModal` ;
  - nouvelle route `POST /api/modeles-3d/lignes` (lecture seule, protégée) ;
  - nouveaux modules `lib/badge-stock-picker.ts`, `lib/service-affichage.ts`, `lib/validite-offre.ts`.
- **02 modèle de données** — **aucune colonne, RPC ni migration.** Trois clés JSON
  s'ajoutent à `offres.data` / `drafts.data` :
  - `servicePrices["<code>__mode"]` (`offert` | `inclus`) ;
  - `servicePrices["<code>__valeur"]` ;
  - `validiteJusquau` (`YYYY-MM-DD`).
  - `corrections.fields_changed` peut désormais porter `validiteJusquau`.
  - Les 5 RPC du connecteur ne sont pas concernées.
- **03 règles métier** :
  - **Services** : un service offert ou inclus a un prix de 0 ; « Offert » peut afficher la valeur du geste entre parenthèses ; la valeur n'entre jamais dans un total.
  - **Validité d'une offre** : date de l'offre immuable ; prolongation = nouvelle date de fin, posée par correction tracée ; interdite sur une offre Convertie, Acceptée ou Abandonnée.
  - **Service perso** : un montant est attendu, 0 accepté.
- **04 pièges** :
  - Une règle de style posée sur `.jc-check-label input` frappe **tout** input du conteneur, pas seulement la case : c'est la cause du champ « incliquable ».
  - **Pas de `aria-modal="true"`** sur un panneau rendu dans `DraftFormulaire` : le correctif TransformerModal remet margin/padding à `revert-layer` et efface les espacements.
  - Ajouter **deux fois** l'exemple vécu sous P2-44/45 : « invisible en preview » ne veut pas dire « cassé ». Vérifier d'abord la base, puis ouvrir l'alias de branche Vercel.
  - `api/corrections/route.ts` est en **LF**, contrairement au reste du dépôt (CRLF) : un script de patch qui force le CRLF le casse.
- **06 décisions** :
  - **D-a** : Offert/Inclus stockés à côté du prix, prix à 0, pour ne toucher **aucun** calcul de total ; le connecteur, qui recopie `computeTotals`, reste juste sans modification.
  - **D-b** : la prolongation passe par le système de corrections (traçabilité), pas par une route dédiée ; la date de l'offre ne bouge jamais.
  - **D-c** : stock total d'un produit dans le picker = somme des quantités positives des variantes trouvées.
  - **D-d** : le badge 3D des lignes est calculé à l'affichage, jamais figé dans le document.
- **07, 08, 09** : rien à changer. Le doc 09 peut citer ce chantier dans l'avancement.

## 4. Vérification des greffes

Aucune entrée n'a été rangée en greffe. Le seul constat hors périmètre (le serveur ne
vérifie pas l'expiration dans `valider`) a un hôte prévu : le **chantier 3**.

## 5. Ménage

- Régénérer le PDF de `DEV-2026-742` avant envoi.
- Supprimer les branches `feat/picker-etendu` et `feat/prolonger-offre` (à ajouter à P3-28).
- `DEV-2026-891`, créée le 07.10 pour tester Offert : à confirmer comme test, puis à supprimer ou garder comme témoin.
