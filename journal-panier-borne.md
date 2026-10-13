# Bilan chantier — Panier borne magasin (01.10.2026)

> Bilan à consolider dans les docs projet (01 architecture, 03 règles métier, 04 pièges, 05 backlog, 06 décisions, 09 prompts). Ce chantier n'a écrit dans aucun doc.

## Besoin

Les bornes PC du magasin (semi-publiques) affichent jardin-confort.ch. Le client y compose un panier ; on veut le transmettre au vendeur **sans exposer l'app** sur ces postes.

## Solution retenue

Panier Shopify de la borne → **liste d'achat ouverte** (table `listes_achat`, Supabase app `llkyzspixrbtoprtmvoh`) → circuit existant (`/dashboard/listes-achat` → « Créer le brouillon » DRA, ou onglet « 🛒 Liste d'achat » du formulaire). **Rien de neuf côté vendeur.**

Flux : bouton thème → `GET /cart.js` → `POST https://offres.jardin-confort.ch/api/listes-achat/borne` (`text/plain`, sans preflight) → code à 4 chiffres affiché en grand → `/cart/clear.js` (panier vidé pour le client suivant). Liste nommée **« 🖥 Borne · CODE · HH:MM »**.

## Côté app — PR #61, merge `7348951` (prod)

| Fichier | Rôle |
|---|---|
| `app/api/listes-achat/borne/route.ts` (nouveau) | POST + OPTIONS. Lit **seulement** `variant_id` + `qty` ; titre, SKU, marque (`vendor` → `fournisseur`), image, statut relus chez Shopify (`nodes`). SKU vide → `VAR-<id>`. Passe par `normaliserLignes`. Aucun prix stocké, aucun stock exposé. Réponse = `{ code, nb }` seulement |
| `proxy.ts` | +4 lignes : `/api/listes-achat/borne` POST/OPTIONS en route publique |

**Verrous** : (1) IP ∈ `BORNE_IPS` — **fermé si variable absente** ; (2) CORS limité à jardin-confort.ch / www / *.myshopify.com ; (3) max **20 paniers borne / heure** (compté en base) ; (4) écriture seule, aucune lecture ; (5) max 100 articles.

**Env Vercel** : `BORNE_IPS` = `188.61.42.195,2a02:1210:7e1c:c4*` (Production). Entrée exacte ou préfixe terminé par `*` (le /56 IPv6 du magasin).

## Côté thème Shopify

Posé sur la copie **« Copie de Copie de Copie avec jardi-filtre et AR... »** (`182408708475`), vérifié par MD5 après upload. **À publier.**

| Fichier | Modif |
|---|---|
| `assets/jc-borne.js` | nouveau |
| `snippets/jc-borne.liquid` | nouveau — `mode: 'assets'` / `'bouton'` / les deux |
| `snippets/cart-drawer.liquid` | `render 'jc-borne', mode: 'assets'` sous `cart-drawer.js` (toujours rendu au chargement) + `mode: 'bouton'` sous le bouton Paiement |
| `sections/main-cart.liquid` | `render 'jc-borne'` sous le bouton Paiement |

Bouton invisible partout (CSS) sauf `html.jc-borne`, posé par le JS si `localStorage['jc-borne']==='1'`. Marquage : `?borne=on` / démarquage `?borne=off`.

## Validé le 01.10.2026

- Test bout en bout depuis le réseau du magasin : code **3533**, liste créée (Nardi Komodo, SKU 40374.00.066, marque Nardi relue chez Shopify), panier vidé.
- Bouton présent dans le tiroir **et** sur `/cart`.
- Autres PC du bureau : OK une fois l'URL d'aperçu + `borne=on` ouverte sur chacun.

## Pièges rencontrés

1. **Script dans le tiroir re-rendu en AJAX ne s'exécute pas** (panier vide au chargement → ajout → tiroir réinjecté). D'où le `mode: 'assets'` placé hors de `{% if cart != empty %}`.
2. **La barre noire d'aperçu Shopify cache le bouton** en bas du tiroir. N'existe qu'en aperçu.
3. **Le thème d'aperçu est un cookie par navigateur** : Ctrl+F5 / redémarrage ne changent rien ; seule l'URL `?preview_theme_id=…` force la copie.
4. **Navigation privée** : le marquage `localStorage` meurt à la fermeture → mettre `https://jardin-confort.ch/?borne=on` en **page de démarrage** des bornes.
5. **Backup 4G de la box** (Centro Business 3.0) : en panne fibre, l'IP sort en mobile dynamique → bouton refusé (« réservé aux bornes »). Accepté, non contourné.
6. **Type de connexion « DHCP »** malgré Business Internet : IP fixe non confirmée par contrat. Si elle change → logs Vercel `Panier borne refusé — IP …` → mettre à jour `BORNE_IPS`.
7. `proxy.ts` est en **CRLF** ; écriture par script en préservant les fins de ligne.
8. GitHub « Checking for the ability to merge » bloqué ~2 min → résolu par F5.

## Reste à faire

- [ ] Publier la copie du thème.
- [ ] Page de démarrage `https://jardin-confort.ch/?borne=on` sur chaque borne.
- [ ] Archiver les listes de test (« 🖥 Borne · 3533 » et suivantes).
- [ ] Confirmer IP fixe dans le contrat Swisscom.
- [ ] Vérifier que `BORNE_IPS` contient bien la partie IPv6 (valeur « sensitive », illisible via API).

## Backlog proposé

- **Outil Jardi `panier_borne(code)`** : « fais une offre avec le panier 4821 » → brouillon direct via le circuit liste d'achat.
- **`orderUnit` ignoré** par la route borne (même famille que P3-64) : un article vendu par 2 peut arriver en qty 1. Sans gravité : un humain relit le brouillon.
- Purge automatique des listes borne ouvertes > 7 jours (aujourd'hui elles restent jusqu'à archivage manuel).
- Codes/remises du panier Shopify **non transmis** : le brouillon repart aux prix catalogue (promos compareAtPrice reprises en `lineDiscount` comme le picker).

## Décisions

- Pas d'extension Chrome (déploiement/maintenance sur chaque poste, désactivable par le client).
- Pas de lecture possible depuis la borne : le code est un identifiant, pas un accès.
- Le verrou est l'**IP**, pas le marquage `borne=on` (qui n'est qu'un affichage).
- Réutilisation de `listes_achat` sans migration plutôt qu'une table dédiée.
