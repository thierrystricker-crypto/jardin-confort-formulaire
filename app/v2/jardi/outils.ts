// app/v2/jardi/outils.ts
// ─────────────────────────────────────────────────────────────────────────────
// Dashboard 2.0 — Jardi : les outils du connecteur regroupés par THÈME.
// Sert à deux choses : le filtre « Thèmes » de l'historique (« les
// conversations où Jardi a cherché des mails ») et les puces d'outils au-dessus
// d'une réponse (icône + libellé lisible, le nom technique reste en infobulle).
// Un outil inconnu (ajouté demain au connecteur) tombe dans « Autres ».
// ─────────────────────────────────────────────────────────────────────────────

export type Theme = { cle: string; libelle: string; icone: string; test: (outil: string) => boolean };

/** Nom sans préfixe de serveur éventuel (« jardi-mail__mail_lire » → « mail_lire »). */
export function nomCourt(outil: string): string {
  const i = outil.lastIndexOf("__");
  return i >= 0 ? outil.slice(i + 2) : outil;
}

export const THEMES: Theme[] = [
  { cle: "clients", libelle: "Clients", icone: "👤", test: (o) => o.startsWith("client_") },
  { cle: "mails", libelle: "Mails & PJ", icone: "✉️", test: (o) => o.startsWith("mail_") || o.startsWith("pj_") },
  { cle: "offres", libelle: "Brouillons d'offre", icone: "📝", test: (o) => o.startsWith("offre_") },
  { cle: "commandes", libelle: "Commandes", icone: "🧾", test: (o) => o.startsWith("commande_") },
  { cle: "stock", libelle: "Stock & produits", icone: "📦", test: (o) => o.startsWith("stock_") || o.startsWith("produit_") },
  { cle: "delais", libelle: "Délais", icone: "⏱", test: (o) => o.startsWith("delai_") },
  { cle: "stats", libelle: "Statistiques", icone: "📊", test: (o) => o.startsWith("stats_") },
  { cle: "listes", libelle: "Listes d'achat", icone: "🛒", test: (o) => o.startsWith("liste_achat") },
];

const AUTRES: Theme = { cle: "autres", libelle: "Autres", icone: "🔧", test: () => true };

export function themeDe(outil: string): Theme {
  const n = nomCourt(outil);
  return THEMES.find((t) => t.test(n)) ?? AUTRES;
}

/** Thèmes (sans doublon, dans l'ordre de THEMES) touchés par une liste d'outils. */
export function themesDe(outils: string[] | null | undefined): Theme[] {
  const vus = new Set<string>();
  for (const o of outils ?? []) if (o !== "analyse") vus.add(themeDe(o).cle);
  return [...THEMES, AUTRES].filter((t) => vus.has(t.cle));
}

/** Libellé lisible d'un outil : « mail_chercher » → « mail chercher ». */
export function libelleOutil(outil: string): string {
  if (outil === "analyse") return "analyse";
  return nomCourt(outil).replace(/_/g, " ");
}
