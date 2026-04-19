// lib/dashboard-utils.ts

type OffreRecord = {
  id: number; slug: string; type_document: string
  statut: string; date_document: string|null
  commercial: string|null; client_nom: string|null
  client_prenom: string|null; total_ttc: number
}

export function fmtDate(iso: string|null) {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("fr-CH", { day:"2-digit", month:"2-digit", year:"numeric" })
}
export function fmtMoney(v: number|null|undefined) {
  if (!v) return "—"
  return new Intl.NumberFormat("fr-CH", { style:"currency", currency:"CHF", maximumFractionDigits:0 }).format(v)
}
export function nomClient(o: OffreRecord) {
  return [o.client_prenom, o.client_nom].filter(Boolean).join(" ") || "—"
}
export function getDaysOpen(o: OffreRecord): number|null {
  if (!o.date_document) return null
  if (["Acceptée","Convertie","Abandonnée"].includes(o.statut)) return null
  return Math.floor((Date.now()-new Date(o.date_document).getTime())/86400000)
}
export function getStatusColor(statut: string, type: string) {
  if (type==="Commande"||statut==="Acceptée"||statut==="Convertie") return "bg-emerald-500/15 text-emerald-300"
  if (statut==="Abandonnée"||statut==="Refusée") return "bg-rose-500/15 text-rose-300"
  if (statut==="Envoyée") return "bg-sky-500/15 text-sky-300"
  return "bg-amber-500/15 text-amber-300"
}
export function getDaysBadgeColor(days: number|null) {
  if (days===null) return "bg-white/5 text-zinc-400"
  if (days>=14) return "bg-rose-500/15 text-rose-300"
  if (days>=7) return "bg-amber-500/15 text-amber-300"
  return "bg-white/5 text-zinc-300"
}
export const COMMERCIAUX = ["Brice Chappé","Alejandro Gallegos","Fabian Coquoz","Michel Gédéon","Sabrina Striberni","Team Jardin-Confort","Thierry Stricker"]