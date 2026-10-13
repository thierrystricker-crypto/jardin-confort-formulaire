// lib/revision-diff.ts
// Compare l'état AVANT et APRÈS d'une révision de commande.
// Matching par `id` de ligne (stable : "shopify-XXX", "custom-XXX").
// Produit :
//   - un diff lisible (audit + fiche de travail)
//   - la liste des retraits à remettre en stock (tous types : Shopify ET à la volée)
//   - la liste des ajouts/augmentations (delta à décrémenter sur Shopify)
//   - depuis le 10.10.2026, autresChanges : texte / SKU / image d'une ligne,
//     commentaires, logos, ordre — sans effet sur le stock, mais suffisant
//     pour creer une version (avant : « Aucun changement detecte »).

import { isShopifyLine } from "@/lib/jc-print-types";
import { AFFICHAGES_MOODBOARD, lireReglagesMoodboard } from "@/lib/moodboard";

// Forme minimale d'une ligne (on ne dépend que de ce dont on a besoin)
export type RevisionLine = {
  id?: string;
  type?: "product" | "custom" | "comment" | "media";
  sku?: string;
  title?: string;
  qty?: number;
  unitPrice?: number;
  lineDiscount?: number;
  shopifyLocked?: boolean;
  inventoryPolicy?: "DENY" | "CONTINUE";
  variantId?: string;
  inventoryItemId?: string;
  locationId?: string;
  // tolérance aux variantes de nommage rencontrées dans le data
  variant_id?: string;
  inventory_item_id?: string;
  location_id?: string;
  // Cle REELLEMENT portee par les lignes du data. Releve en base le 15.08.2026
  // sur les 219 lignes des snapshots : 219 shopifyVariantId, 0 variantId/variant_id.
  shopifyVariantId?: string;
  // Champs suivis par autresChanges (10.10.2026) — aucun effet sur le stock.
  image?: string;
  stock?: number | string | null;
  mediaUrl?: string;
  mediaSize?: string;
};

// Un retrait à insérer dans stock_remises_attente
export type Retrait = {
  sku: string;
  product_title: string;
  variant_id: string | null;
  inventory_item_id: string | null;
  location_id: string | null;
  quantity: number;
  inventory_policy: string | null;
  is_shopify: boolean;
};

// Un ajout/augmentation à décrémenter sur Shopify (delta)
export type Ajout = {
  id: string;
  sku: string;
  title: string;
  quantity: number; // delta positif à sortir du stock
  is_shopify: boolean;
};

// Le diff lisible complet
export type RevisionDiff = {
  ajouts: { sku: string; title: string; qty: number }[];
  retraits: { sku: string; title: string; qty: number }[];
  qtyChanges: { sku: string; title: string; avant: number; apres: number }[];
  prixChanges: { sku: string; title: string; avant: number; apres: number }[];
  remiseChanges: { sku: string; title: string; avant: number; apres: number }[];
  enteteChanges: { champ: string; avant: string; apres: string }[];
  // Ajoute le 10.10.2026. Tout ce qui change le DOCUMENT sans toucher au stock
  // ni aux montants : texte ou SKU d'une ligne, image, stock saisi d'un article
  // a la volee, lignes commentaire / logo, ordre des lignes. Avant, ces
  // changements seuls etaient refuses (« Aucun changement detecte »).
  // Optionnel : les diffs archives avant cette date ne le portent pas.
  autresChanges?: AutreChange[];
};

// Une valeur vide (avant ou apres) = pas de texte a montrer (image, ordre…).
export type AutreChange = {
  quoi: string;
  sku?: string;
  title?: string;
  avant?: string;
  apres?: string;
};

// Le résultat complet du calcul
export type RevisionComputation = {
  diff: RevisionDiff;
  retraits: Retrait[]; // pour stock_remises_attente (RPC)
  ajouts: Ajout[];     // pour décrément Shopify (côté route)
  hasChanges: boolean;
};

// Helpers d'acces aux identifiants Shopify d'une ligne.
// Releve en base le 15.08.2026 sur les 219 lignes des snapshots commandes_revisions :
// seules 3 cles Shopify existent dans le data -- shopifyLocked, shopifyVariantId,
// inventoryPolicy. AUCUNE cle d'inventory item ni de location, sous aucune orthographe.
function getVariantId(l: RevisionLine): string | null {
  return l.shopifyVariantId || l.variantId || l.variant_id || null;
}
// Sans objet : la donnee n'est pas capturee au moment du retrait. Ce n'est PAS un
// probleme de nommage -- la recuperer supposerait un appel Shopify ici. Conserve
// pour ne pas changer la forme de Retrait ; renvoie donc toujours null.
function getInventoryItemId(l: RevisionLine): string | null {
  return l.inventoryItemId || l.inventory_item_id || null;
}
// Idem. SHOPIFY_LOCATION_ID existe dans lib/shopify-stock, mais l'ecrire ici
// serait inventer une donnee plutot que la restituer.
function getLocationId(l: RevisionLine): string | null {
  return l.locationId || l.location_id || null;
}

// On ignore les lignes non-matérielles pour le stock (commentaires, media)
function isStockRelevant(l: RevisionLine): boolean {
  return l.type !== "comment" && l.type !== "media";
}

// ── autresChanges : helpers ──
// Comparaison tolerante : undefined, null et "" sont la meme absence, et les
// espaces de bord ne comptent pas (un titre retape a l'identique n'est pas
// une version).
function txt(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

// Texte court pour le resume (un commentaire peut etre long).
function court(s: string, max = 160): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function libelleLigne(l: RevisionLine): string {
  return txt(l.title) || txt(l.sku) || "(ligne sans titre)";
}

// Changements d'une ligne CONSERVEE (meme id avant / apres), hors qty / prix /
// remise qui ont deja leurs listes.
function changementsLigne(b: RevisionLine, a: RevisionLine): AutreChange[] {
  const out: AutreChange[] = [];
  const sku = txt(a.sku), title = libelleLigne(a);
  if (a.type === "comment") {
    if (txt(b.title) !== txt(a.title)) {
      out.push({ quoi: "Commentaire modifié", avant: court(txt(b.title)), apres: court(txt(a.title)) });
    }
    return out;
  }
  if (a.type === "media") {
    if (txt(b.mediaUrl) !== txt(a.mediaUrl) || txt(b.title) !== txt(a.title)) {
      out.push({ quoi: "Image / logo remplacé", title: txt(a.title) || undefined });
    }
    if (txt(b.mediaSize) !== txt(a.mediaSize)) {
      out.push({ quoi: "Taille de l'image / logo", avant: txt(b.mediaSize), apres: txt(a.mediaSize) });
    }
    return out;
  }
  if (txt(b.title) !== txt(a.title)) {
    out.push({ quoi: "Désignation", sku, avant: court(txt(b.title), 300), apres: court(txt(a.title), 300) });
  }
  if (txt(b.sku) !== txt(a.sku)) {
    out.push({ quoi: "SKU", title, avant: txt(b.sku), apres: txt(a.sku) });
  }
  if (txt(b.image) !== txt(a.image)) {
    out.push({ quoi: "Image de l'article", sku, title });
  }
  // Stock SAISI d'un article a la volee. Celui d'une ligne Shopify est fige J0 :
  // il ne bouge pas en revision, et s'il bougeait ce ne serait pas a annoncer ici.
  if (!isShopifyLine(a) && txt(b.stock) !== txt(a.stock)) {
    out.push({ quoi: "Stock indiqué", sku, title, avant: txt(b.stock), apres: txt(a.stock) });
  }
  return out;
}

/**
 * Calcule le diff entre l'ancienne et la nouvelle liste de lignes.
 * @param before lignes de la commande AVANT révision
 * @param after  lignes de la commande APRÈS révision
 */
// Champs à NE PAS comparer dans l'en-tête :
//  - lines : géré séparément (ajouts/retraits/qty/prix/remise)
//  - _totals : dérivé des lignes/rabais, changerait mécaniquement (double comptage)
//  - offerNumber / formType : immuables par nature (numéro + type de document)
const ENTETE_IGNORE = new Set(["lines", "_totals", "offerNumber", "formType"]);

// Cles racine du data que le snapshot du formulaire ne transporte JAMAIS.
// Depuis la fusion RPC du 14.08.2026 (data = data || p_new_data) elles sont
// preservees : les signaler comme « -> (vide) » est un faux positif.
// Le diff neuf ne les produit plus (voir computeRevisionDiff). Cette liste sert a
// filtrer les diffs DEJA archives, figes en base -- releve du 15.08.2026 :
// 302 lignes de bruit sur 57 des 89 revisions.
export const CLES_HORS_FORMULAIRE = new Set([
  "signataire",
  "date_signature",
  "date_validation",
  "stock_frozen_at",
  "fromDraftSlug",
  "copiedFromOffreSlug",
  "copiedFromOffreNumero",
]);

// Réglage de la planche couleurs (13.10.2026). Le formulaire envoie toujours
// un data.moodboard complet ; un document plus ancien n'en a pas, ou n'a que
// { actif, mode, sens }. Comparés tels quels, ils produisaient un FAUX
// changement à chaque révision (« (vide) → {...} »), donc une version de plus
// sans que rien n'ait bougé. On compare la forme NORMALISÉE, en clair.
function normPlanche(v: unknown): string {
  const r = lireReglagesMoodboard(v);
  const lib = AFFICHAGES_MOODBOARD.find((a) => a.valeur === r.affichage)?.libelle ?? r.affichage;
  if (r.affichage === "aucune") return lib;
  return r.mode === "degrade"
    ? `${lib} · dégradé ${r.sens === "fonce-clair" ? "foncé → clair" : "clair → foncé"}`
    : `${lib} · par valeur`;
}

// Normalise une valeur de champ en chaîne comparable (objets/tableaux → JSON stable).
function normEntete(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    try {
      // Sérialisation déterministe : clés triées récursivement, pour que
      // deux objets identiques au ré-ordonnancement près soient égaux.
      return JSON.stringify(v, (_key, val) =>
        val && typeof val === "object" && !Array.isArray(val)
          ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b)))
          : val
      );
    } catch { return String(v); }
  }
  return String(v);
}

export function computeRevisionDiff(
  before: RevisionLine[],
  after: RevisionLine[],
  beforeData?: Record<string, unknown>,
  afterData?: Record<string, unknown>
): RevisionComputation {
  const beforeById = new Map<string, RevisionLine>();
  for (const l of before) {
    if (l.id) beforeById.set(l.id, l);
  }
  const afterById = new Map<string, RevisionLine>();
  for (const l of after) {
    if (l.id) afterById.set(l.id, l);
  }

  const diff: RevisionDiff = {
    ajouts: [],
    retraits: [],
    qtyChanges: [],
    prixChanges: [],
    remiseChanges: [],
    enteteChanges: [],
    autresChanges: [],
  };
  const autres = diff.autresChanges as AutreChange[];
  const retraits: Retrait[] = [];
  const ajouts: Ajout[] = [];

  const buildRetrait = (l: RevisionLine, qty: number): Retrait => ({
    sku: l.sku || "",
    product_title: l.title || "",
    variant_id: getVariantId(l),
    inventory_item_id: getInventoryItemId(l),
    location_id: getLocationId(l),
    quantity: qty,
    inventory_policy: l.inventoryPolicy || null,
    is_shopify: isShopifyLine(l),
  });

  // 1. Parcours des lignes APRÈS → détecte ajouts et lignes conservées
  for (const a of after) {
    if (!a.id) continue;
    const b = beforeById.get(a.id);

    if (!b) {
      // Ligne AJOUTÉE (id absent avant)
      if (isStockRelevant(a)) {
        const qty = a.qty || 0;
        if (qty > 0) {
          diff.ajouts.push({ sku: a.sku || "", title: a.title || "", qty });
          ajouts.push({
            id: a.id,
            sku: a.sku || "",
            title: a.title || "",
            quantity: qty,
            is_shopify: isShopifyLine(a),
          });
        }
      } else if (a.type === "comment") {
        // Ligne commentaire / logo ajoutee : rien pour le stock, mais le
        // document change.
        autres.push({ quoi: "Commentaire ajouté", apres: court(txt(a.title)) });
      } else if (a.type === "media") {
        autres.push({ quoi: "Image / logo ajouté", title: txt(a.title) || undefined });
      }
      continue;
    }

    // Ligne CONSERVEE : texte, SKU, image, commentaires, logos.
    autres.push(...changementsLigne(b, a));

    // Ligne CONSERVÉE → comparer qty, prix, remise
    const qtyAvant = b.qty || 0;
    const qtyApres = a.qty || 0;
    const prixAvant = b.unitPrice || 0;
    const prixApres = a.unitPrice || 0;
    const remiseAvant = b.lineDiscount || 0;
    const remiseApres = a.lineDiscount || 0;

    if (qtyApres !== qtyAvant) {
      diff.qtyChanges.push({
        sku: a.sku || "", title: a.title || "",
        avant: qtyAvant, apres: qtyApres,
      });
      if (isStockRelevant(a)) {
        // RÈGLE MÉTIER : sur une ligne EXISTANTE (héritée de la commande),
        // seule la RÉDUCTION est possible. La qté ne peut pas augmenter
        // (le stock figé du jour J ne doit jamais être confronté au temps réel).
        // Un supplément se fait via une NOUVELLE ligne (picker, stock frais).
        // L'UI bride le champ qté à sa valeur d'origine — ce cas ne devrait
        // donc pas se produire, mais par sécurité on ne traite QUE la baisse.
        if (qtyApres < qtyAvant) {
          // Réduction → retrait du delta à remettre en stock
          retraits.push(buildRetrait(a, qtyAvant - qtyApres));
        }
        // qtyApres > qtyAvant : ignoré côté stock (ne devrait pas arriver,
        // bridé par l'UI). On garde quand même le qtyChanges pour l'audit.
      }
    }

    if (prixApres !== prixAvant) {
      diff.prixChanges.push({
        sku: a.sku || "", title: a.title || "",
        avant: prixAvant, apres: prixApres,
      });
    }
    if (remiseApres !== remiseAvant) {
      diff.remiseChanges.push({
        sku: a.sku || "", title: a.title || "",
        avant: remiseAvant, apres: remiseApres,
      });
    }
  }

  // 2. Parcours des lignes AVANT → détecte les retraits complets (id absent après)
  for (const b of before) {
    if (!b.id) continue;
    if (afterById.has(b.id)) continue; // conservée, déjà traitée
    if (b.type === "comment") {
      autres.push({ quoi: "Commentaire supprimé", avant: court(txt(b.title)) });
      continue;
    }
    if (b.type === "media") {
      autres.push({ quoi: "Image / logo supprimé", title: txt(b.title) || undefined });
      continue;
    }
    if (!isStockRelevant(b)) continue;

    const qty = b.qty || 0;
    if (qty > 0) {
      diff.retraits.push({ sku: b.sku || "", title: b.title || "", qty });
      retraits.push(buildRetrait(b, qty));
    }
  }

  // Ordre des lignes : on compare l'ordre RELATIF des lignes presentes des deux
  // cotes. Un ajout ou un retrait seul ne compte donc pas comme un reordonnancement.
  const ordreAvant = before.map((l) => l.id).filter((id): id is string => !!id && afterById.has(id));
  const ordreApres = after.map((l) => l.id).filter((id): id is string => !!id && beforeById.has(id));
  if (ordreAvant.join("|") !== ordreApres.join("|")) {
    autres.push({ quoi: "Ordre des lignes modifié" });
  }

  // Comparaison des champs d'en-tête (tout sauf lines/_totals/immuables).
  // Une seule différence suffit à déclencher une révision.
  if (beforeData && afterData) {
    // On n'itere QUE sur les cles reellement transmises par le formulaire. Une cle
    // absente de afterData est preservee par la fusion jsonb de la RPC (decision du
    // 14.08.2026) : la comparer reviendrait a annoncer un vidage qui n'a pas lieu.
    // Une cle PRESENTE mais vide ("") reste un vrai changement -- le formulaire
    // envoie "" pour les champs qu'il gere.
    const keys = new Set(Object.keys(afterData));
    for (const k of keys) {
      if (ENTETE_IGNORE.has(k)) continue;
      const norm = k === "moodboard" ? normPlanche : normEntete;
      const av = norm(beforeData[k]);
      const ap = norm(afterData[k]);
      if (av !== ap) {
        diff.enteteChanges.push({ champ: k, avant: av, apres: ap });
      }
    }
  }

  const hasChanges =
    diff.ajouts.length > 0 ||
    diff.retraits.length > 0 ||
    diff.qtyChanges.length > 0 ||
    diff.prixChanges.length > 0 ||
    diff.remiseChanges.length > 0 ||
    diff.enteteChanges.length > 0 ||
    autres.length > 0;

  return { diff, retraits, ajouts, hasChanges };
}