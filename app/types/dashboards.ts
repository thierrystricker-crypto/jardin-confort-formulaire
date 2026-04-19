// types/dashboard.ts
// Types basés sur le schéma Supabase table "offres"

export type OffreStatut =
  | "En cours"
  | "Envoyée"
  | "Convertie"
  | "Acceptée"
  | "Abandonnée"
  | "Refusée"

export type TypeDocument = "Offre" | "Commande"

export type OffreRecord = {
  id: number
  slug: string
  type_document: TypeDocument
  numero_offre: string | null
  numero_commande: string | null
  offre_origine: string | null
  numero_affiche: string
  statut: OffreStatut
  date_document: string | null
  commercial: string | null
  payment_mode: string | null
  delivery_mode: string | null
  lead_time: string | null
  client_societe: string | null
  client_nom: string | null
  client_prenom: string | null
  client_email: string | null
  client_tel1: string | null
  client_tel2: string | null
  client_rue: string | null
  client_npa: string | null
  client_ville: string | null
  sous_total: number
  remise_chf: number
  services_total: number
  tva_montant: number
  total_ttc: number
  nb_articles: number
  remarques: string | null
  notes_internes: string | null
  note_commerciale: string | null
  data: Record<string, unknown>
  created_at: string
  updated_at: string | null
}

export type DashboardStats = {
  totalOffres: number
  totalCommandes: number
  totalAbandonnes: number
  caOffres: number
  caCommandes: number
  aRelancer: number
}