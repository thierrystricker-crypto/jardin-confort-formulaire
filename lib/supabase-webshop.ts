// lib/supabase-webshop.ts
// Client Supabase du projet WEBSHOP (synchro stocks fournisseurs,
// eyhoeujnoclzntdxmtby) — à ne pas confondre avec lib/supabase.ts qui pointe
// sur le Supabase de l'app (offres, clients, délais des commandes).
//
// Serveur uniquement (clé secrète). Lecture seule : la page « Stock list »
// n'interroge que la vue v_recherche_delai, jamais les tables ni les
// fonctions de la synchro.
//
// Env (Vercel + .env.local) :
//   WEBSHOP_SUPABASE_URL=https://eyhoeujnoclzntdxmtby.supabase.co
//   WEBSHOP_SUPABASE_SERVICE_KEY=<clé sb_secret_ du projet webshop>

import { createClient } from "@supabase/supabase-js";

const URL = process.env.WEBSHOP_SUPABASE_URL || "";
const KEY = process.env.WEBSHOP_SUPABASE_SERVICE_KEY || "";

export const webshopConfigure = Boolean(URL && KEY);

export const supabaseWebshop = createClient(
  URL || "https://webshop-non-configure.invalid",
  KEY || "non-configure",
  { auth: { persistSession: false, autoRefreshToken: false } }
);

export type DispoFournisseur = "EN_STOCK" | "SUR_COMMANDE" | "REASSORT" | "NON_LIVRABLE" | "INCONNU";

// Une ligne de la vue v_recherche_delai (full outer join feed × shopify_variante)
export type RechercheDelaiRow = {
  fournisseur: string;
  sku: string;
  titre: string | null;              // null = SKU du relevé fournisseur absent de Shopify
  product_id: string | number | null;
  variant_id: string | number | null;
  statut_fiche: "ACTIVE" | "DRAFT" | "ARCHIVED" | null;
  stock_jc: number | null;
  stock_fournisseur: number | null;
  statut_fournisseur: string | null;       // vocabulaire brut du fournisseur (YES, DELAI_4, PROD_4_6…)
  dispo_fournisseur: DispoFournisseur | null; // catégorie uniformisée calculée par la vue
  date_dispo_fournisseur: string | null;   // YYYY-MM-DD
  transport_semaines: number | null;
  delai_client_semaines: string | null;    // ex. "2-3", déjà calculé par la vue
  releve_fournisseur_le: string | null;
  miroir_maj_le: string | null;
};

// Complément Shopify d'une ligne (image, lien boutique, lien admin) — rendu par
// POST /api/stock-list/shopify.
export type StockListShopifyInfo = {
  varianteTitre: string | null;   // ex. "260x260cm / 605 Clay" (null si "Default Title")
  options: string[];              // valeurs d'options une par une : ["260x260cm", "605 Clay"]
  prixTTC: number | null;         // prix de vente Shopify à l'instant, jamais stocké
  imageUrl: string | null;
  onlineStoreUrl: string | null;
  adminUrl: string | null;
};
