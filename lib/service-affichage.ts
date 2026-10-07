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
