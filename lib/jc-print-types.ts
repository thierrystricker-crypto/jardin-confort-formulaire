// ═══════════════════════════════════════════════════════
//  Jardin-Confort — Types & constantes partagés
//  Utilisés par le formulaire ET les templates print
// ═══════════════════════════════════════════════════════

export type FormType     = "Offre" | "Commande";
export type ClientType   = "Privé (prix TTC)" | "Pro (prix HT)";
export type PaymentMode  =
  | "Paiement d'avance à la commande"
  | "Acompte de 50% à la commande"
  | "Paiement à 30 jours";
export type OfferStatus  = "En cours" | "Envoyée" | "Acceptée" | "Refusée";

export type QuoteLine = {
  id: string;
  type: "product" | "custom" | "comment" | "media";
  image?: string;
  sku: string;
  title: string;
  unitPrice: number;
  qty: number;
  stock?: number | null | "sur_commande";
  inventoryPolicy?: "DENY" | "CONTINUE";
  shopifyLocked?: boolean;
  lineDiscount?: number;          // total ligne (= qty × lineDiscountPerUnit), dérivé
  lineDiscountPerUnit?: number;   // rabais à la pièce en CHF — source de vérité
  shopifyVariantId?: string;      // gid variante Shopify — matching stock fiable (SKU non unique)
  // ── Lignes média (logo / image de marque) ──
  mediaUrl?: string;
  mediaSize?: "small" | "medium" | "large";
  mediaSource?: "library" | "upload";
};

export type AmbianceImage = {
  id: string;
  dataUrl: string;
  legende: string;
};

export type PrintData = {
  // Document
  formType: FormType;
  clientType: ClientType;
  paymentMode: PaymentMode;
  offerStatus: OfferStatus;
  date: string;
  commercial: string;
  offerNumber: string;
  reference: string;

  // Adresse facturation
  societe: string;
  nom: string;
  prenom: string;
  complement_nom?: string;
  rue: string;
  numero: string;
  npa: string;
  ville: string;
  telephone1: string;
  telephone2: string;
  email: string;
  customerNumber: string;

  // Adresse livraison
  livrDiff: boolean;
  livrSociete: string;
  livrNom: string;
  livrPrenom: string;
  livr_complement_nom?: string;
  livrTel: string;
  livrRue: string;
  livrNumero: string;
  livrNpa: string;
  livrVille: string;

  // Articles
  lines: QuoteLine[];

  // Totaux
  discount: string;
  discountPercent: string;
  manualRounding: string;
  enabledServices: Record<string, boolean>;
  servicePrices: Record<string, string>;

  // Infos complémentaires
  remarks: string;
  leadTime: string;

  // Accès livraison / étage (notes pour l'équipe livraison)
  accesLivraison?: string;
  // Images d'ambiance (page 2)
  ambianceImages: AmbianceImage[];
};

// ── Services fixes ──
export const serviceOptions = [
  { code: "montage",       label: "Frais de montage",                                    defaultPrice: 0   },
  { code: "poste",         label: "Livraison des colis par La Poste",                    defaultPrice: 9   },
  { code: "trottoir",      label: "Livraison colis franco trottoir par transporteur",    defaultPrice: 59  },
  { code: "etage",         label: "Livraison « à l'étage » et déballage des articles",  defaultPrice: 79  },
  { code: "etage_montage", label: "Livraison « à l'étage », déballage et montage",      defaultPrice: 119 },
  { code: "reprise",       label: "Reprise et recyclage des anciens meubles",            defaultPrice: 60  },
];

export const TVA_RATE    = 0.081;
export const STORAGE_KEY = "jc-offre-v15-draft";

// ── Helpers ──

/**
 * Détermine si une ligne Shopify est "non-réassortable" (vente bloquée à 0).
 * Source unique de vérité utilisée par toutes les UI internes.
 */
export function isNonReassortable(line: QuoteLine): boolean {
  return line.type === "product"
    && line.shopifyLocked === true
    && line.inventoryPolicy === "DENY";
}

/**
 * Détermine si une ligne est en rupture critique (non-réassortable + qté > stock).
 * Déclenche le badge rouge dans le formulaire.
 */
export function isStockCritical(line: QuoteLine): boolean {
  if (!isNonReassortable(line)) return false;
  // Rupture totale : article non-réassortable sans stock vendable.
  //   - "sur_commande" : converti depuis stock 0 par le picker Shopify
  //   - 0              : stock nul brut
  //   - null/undefined : SKU introuvable côté Shopify (filet de sécurité refreshStock)
  if (line.stock === "sur_commande" || line.stock === 0 || line.stock == null) return true;
  // Rupture partielle : quantité demandée supérieure au stock numérique disponible.
  const stock = typeof line.stock === "number" ? line.stock : 0;
  const qty = line.qty || 0;
  return qty > stock;
}

export function formatMoney(value: number): string {
  const formatted = new Intl.NumberFormat("de-CH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
  return `CHF ${formatted}`;
}

export function formatDate(iso: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("fr-CH", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
}

export function generateCustomerNumber(email: string): string {
  if (!email.trim()) return "";
  let hash = 0;
  for (let i = 0; i < email.length; i++)
    hash = (hash * 31 + email.charCodeAt(i)) % 100000;
  return `CL-${String(hash).padStart(5, "0")}`;
}

// ── Calculs totaux (réutilisés par tous les templates) ──
export function computeTotals(data: PrintData) {
  const isPrivateTTC = data.clientType === "Privé (prix TTC)";

  const subTotal = data.lines.reduce((s, l) => {
    if (l.type === "comment" || l.type === "media") return s;
    return s + l.qty * l.unitPrice - (l.lineDiscount || 0);
  }, 0);

  const discountPct = Number(data.discountPercent || 0);
  const discountValue = discountPct > 0
    ? Math.round(subTotal * discountPct) / 100
    : Number(data.discount || 0);

  const serviceTotal = serviceOptions.reduce((s, srv) => {
    if (!data.enabledServices[srv.code]) return s;
    return s + Number(data.servicePrices[srv.code] || 0);
  }, 0) + (data.enabledServices["custom"] ? Number(data.servicePrices["custom"] || 0) : 0);

  const totalAfterDiscount  = subTotal - discountValue;
  const totalPlusServices   = totalAfterDiscount + serviceTotal;
  const roundingValue       = Math.min(0, Number(data.manualRounding) || 0);
  const totalAfterRounding  = totalPlusServices + roundingValue;

  const tvaAmount = isPrivateTTC
    ? totalAfterRounding - totalAfterRounding / (1 + TVA_RATE)
    : totalAfterRounding * TVA_RATE;

  const finalTotal = isPrivateTTC
    ? totalAfterRounding
    : totalAfterRounding + tvaAmount;

  return {
    isPrivateTTC,
    subTotal,
    discountValue,
    serviceTotal,
    totalAfterDiscount,
    totalPlusServices,
    roundingValue,
    totalAfterRounding,
    tvaAmount,
    finalTotal,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper : distinguer les lignes Shopify (catalogue) des lignes à la volée
// ─────────────────────────────────────────────────────────────────────────────
// Une ligne est considérée comme une ligne Shopify quand elle reflète un
// produit du catalogue Jardin-Confort.ch dont le stock/prix sont gérés par
// Shopify. Concrètement :
//   - flag explicite shopifyLocked === true (lignes créées via le picker
//     Shopify depuis Session 14/05/2026)
//   - fallback rétroactif via id préfixé "shopify-" (lignes créées avant
//     l'ajout du flag, garanties Shopify d'origine)
//
// Toute autre ligne (custom à la volée, comment, media, logo) est par
// définition hors-Shopify et NE DOIT PAS être envoyée à l'API Shopify :
//   - en lecture  : refresh stock côté offre (refreshStock)
//   - en écriture : décrémentation stock à la conversion en commande
//                   (stock-movements/process)
//
// Cet helper est la source unique de vérité pour cette distinction.
// ─────────────────────────────────────────────────────────────────────────────
export function isShopifyLine(line: {
  type?: string;
  sku?: string;
  shopifyLocked?: boolean;
  id?: string;
}): boolean {
  if (line.type === "comment" || line.type === "media") return false;
  if (!line.sku || line.sku.trim().length === 0) return false;
  return line.shopifyLocked === true || (typeof line.id === "string" && line.id.startsWith("shopify-"));
}