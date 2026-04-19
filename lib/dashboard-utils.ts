// lib/dashboard-utils.ts

import type { OffreRecord, DashboardStats } from "@/types/dashboard"

export function fmtDate(iso: string | null) {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("fr-CH", {
    day: "2-digit", month: "2-digit", year: "numeric"
  })
}

export function fmtMoney(v: number | null | undefined) {
  if (!v) return "—"
  return new Intl.NumberFormat("fr-CH", {
    style: "currency", currency: "CHF", maximumFractionDigits: 0
  }).format(v)
}

export function nomClient(o: OffreRecord) {
  return [o.client_prenom, o.client_nom].filter(Boolean).join(" ") || "—"
}

export function getDaysOpen(o: OffreRecord): number | null {
  if (!o.date_document) return null
  if (["Acceptée", "Convertie", "Abandonnée"].includes(o.statut)) return null
  const ms = Date.now() - new Date(o.date_document).getTime()
  return Math.floor(ms / 86400000)
}

export function getStatusColor(statut: string, type: string) {
  if (type === "Commande" || statut === "Acceptée" || statut === "Convertie")
    return "bg-emerald-500/15 text-emerald-300"
  if (statut === "Abandonnée" || statut === "Refusée")
    return "bg-rose-500/15 text-rose-300"
  if (statut === "Envoyée")
    return "bg-sky-500/15 text-sky-300"
  return "bg-amber-500/15 text-amber-300" // En cours
}

export function getDaysBadgeColor(days: number | null) {
  if (days === null) return "bg-white/5 text-zinc-400"
  if (days >= 14) return "bg-rose-500/15 text-rose-300"
  if (days >= 7) return "bg-amber-500/15 text-amber-300"
  return "bg-white/5 text-zinc-300"
}

export function computeStats(offres: OffreRecord[]): DashboardStats {
  const actives = offres.filter(o => o.type_document === "Offre" && !["Abandonnée","Convertie","Refusée"].includes(o.statut))
  const commandes = offres.filter(o => o.type_document === "Commande" || o.statut === "Acceptée")
  const abandonnes = offres.filter(o => o.statut === "Abandonnée" || o.statut === "Refusée")
  const aRelancer = actives.filter(o => {
    const days = getDaysOpen(o)
    return days !== null && days >= 7
  })

  return {
    totalOffres: actives.length,
    totalCommandes: commandes.length,
    totalAbandonnes: abandonnes.length,
    caOffres: actives.reduce((s, o) => s + (o.total_ttc || 0), 0),
    caCommandes: commandes.reduce((s, o) => s + (o.total_ttc || 0), 0),
    aRelancer: aRelancer.length,
  }
}

export const COMMERCIAUX = [
  "Brice Chappé",
  "Alejandro Gallegos",
  "Fabian Coquoz",
  "Michel Gédéon",
  "Sabrina Striberni",
  "Team Jardin-Confort",
  "Thierry Stricker",
]