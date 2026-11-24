// lib/service-affichage.ts
//
// Services « Offert » et « Inclus » (07.10.2026).
//
// Un service offert ou inclus garde un PRIX A 0 dans servicePrices[code] :
// tous les calculs de totaux existants (formulaire, documents, export WinBiz,
// connecteur jardi-mail-mcp qui recopie computeTotals) restent donc justes sans
// etre touches. Le mode et la valeur offerte vivent dans deux cles a cote :
//
//   servicePrices["<code>__mode"]   = "offert" | "inclus"   (absent = normal)
//   servicePrices["<code>__valeur"] = "119"                 (valeur du cadeau)
//
// Affichage sur les documents :
//   prix > 0                 -> CHF 119.00   (inchange)
//   0 + mode inclus          -> Inclus
//   0 + mode offert + valeur -> (119.-) Offert
//   0 sinon                  -> Offert       (comportement historique)
//
// Le mode n'est lu que si le prix vaut 0 : une donnee incoherente (mode pose
// mais prix > 0) affiche le prix, celui qui est compte dans le total.

export type ModeService = "offert" | "inclus";

export type InfoService = { mode: ModeService | null; valeur: number | null };

export function cleModeService(code: string): string {
  return `${code}__mode`;
}

export function cleValeurService(code: string): string {
  return `${code}__valeur`;
}

export function infoService(prices: Record<string, string> | null | undefined, code: string): InfoService {
  const m = prices?.[cleModeService(code)];
  const mode: ModeService | null = m === "offert" || m === "inclus" ? m : null;
  const v = parseFloat(prices?.[cleValeurService(code)] ?? "");
  return { mode, valeur: mode === "offert" && Number.isFinite(v) && v > 0 ? v : null };
}

// 119 -> "119.-" ; 1190 -> "1'190.-" ; 119.5 -> "119.50"
export function montantCourt(n: number): string {
  const entier = Math.abs(n - Math.round(n)) < 0.005;
  const s = entier ? Math.round(n).toString() : n.toFixed(2);
  const [ent, dec] = s.split(".");
  const avecSep = ent.replace(/\B(?=(\d{3})+(?!\d))/g, "'");
  return entier ? `${avecSep}.-` : `${avecSep}.${dec}`;
}

export function texteMontantService(
  srv: { amount: number; mode?: ModeService | null; valeur?: number | null },
  formatMoney: (n: number) => string
): string {
  if (srv.amount !== 0) return formatMoney(srv.amount);
  if (srv.mode === "inclus") return "Inclus";
  if (srv.mode === "offert" && srv.valeur) return `(${montantCourt(srv.valeur)}) Offert`;
  return "Offert";
}

// ─────────────────────────────────────────────────────────────────────────────
// Services personnalises MULTIPLES (24.11.2026).
//
// La 1re ligne garde ses cles historiques (aucune migration, anciens documents
// intacts) :            servicePrices["custom"]   / ["custom_label"]
// Les lignes ajoutees par le « + » :
//                       servicePrices["custom_2"] / ["custom_2_label"] … custom_5
// Mode et valeur (Offert / Inclus) suivent la regle generale :
//                       servicePrices["custom_2__mode"], ["custom_2__valeur"]
//
// Une ligne ajoutee EXISTE des que son code est present dans enabledServices
// (meme a false) ou que son libelle est present dans servicePrices. La supprimer
// = effacer ses quatre cles (voir clesServicePerso).
//
// Tous les documents et tous les totaux passent par servicesPersoActifs /
// totalServicesPerso : ne jamais relire "custom" en dur.
// ─────────────────────────────────────────────────────────────────────────────

export const MAX_SERVICES_PERSO = 5;
export const LIBELLE_SERVICE_PERSO_DEFAUT = "Service personnalisé";

const RE_CODE_PERSO = /^custom(?:_(\d+))?$/;

export function estCodeServicePerso(code: string): boolean {
  return RE_CODE_PERSO.test(code);
}

function rangPerso(code: string): number {
  const m = RE_CODE_PERSO.exec(code);
  return m ? (m[1] ? parseInt(m[1], 10) : 1) : 0;
}

export function cleLibelleServicePerso(code: string): string {
  return code === "custom" ? "custom_label" : `${code}_label`;
}

/** Les cles a effacer pour supprimer une ligne personnalisee. */
export function clesServicePerso(code: string): string[] {
  return [code, cleLibelleServicePerso(code), cleModeService(code), cleValeurService(code)];
}

/** Codes de toutes les lignes personnalisees existantes, "custom" toujours en tete. */
export function codesServicesPerso(
  enabled: Record<string, boolean> | null | undefined,
  prices: Record<string, string> | null | undefined
): string[] {
  const codes = new Set<string>(["custom"]);
  for (const k of Object.keys(enabled || {})) if (estCodeServicePerso(k)) codes.add(k);
  for (const k of Object.keys(prices || {})) {
    const m = /^(custom_\d+)_label$/.exec(k);
    if (m) codes.add(m[1]);
  }
  return [...codes].sort((a, b) => rangPerso(a) - rangPerso(b));
}

/** Prochain code libre ("custom_2", "custom_3"…), null si le plafond est atteint. */
export function prochainCodeServicePerso(
  enabled: Record<string, boolean> | null | undefined,
  prices: Record<string, string> | null | undefined
): string | null {
  const codes = codesServicesPerso(enabled, prices);
  if (codes.length >= MAX_SERVICES_PERSO) return null;
  const pris = new Set(codes.map(rangPerso));
  for (let r = 2; r <= 99; r++) if (!pris.has(r)) return `custom_${r}`;
  return null;
}

export type ServicePersoActif = { code: string; label: string; amount: number } & InfoService;

/** Lignes personnalisees COCHEES, dans l'ordre de saisie, pretes pour les documents. */
export function servicesPersoActifs(
  enabled: Record<string, boolean> | null | undefined,
  prices: Record<string, string> | null | undefined,
  libelleDefaut: string = LIBELLE_SERVICE_PERSO_DEFAUT
): ServicePersoActif[] {
  return codesServicesPerso(enabled, prices)
    .filter((code) => !!enabled?.[code])
    .map((code) => ({
      code,
      label: (prices?.[cleLibelleServicePerso(code)] || "").trim() || libelleDefaut,
      amount: Number(prices?.[code] || 0),
      ...infoService(prices, code),
    }));
}

/** Somme des lignes personnalisees cochees (meme regle que l'historique "custom"). */
export function totalServicesPerso(
  enabled: Record<string, boolean> | null | undefined,
  prices: Record<string, string> | null | undefined
): number {
  return servicesPersoActifs(enabled, prices).reduce((s, x) => s + x.amount, 0);
}
