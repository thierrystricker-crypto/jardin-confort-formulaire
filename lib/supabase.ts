// lib/supabase.ts
// Client Supabase — utilisé par les routes API (côté serveur uniquement)

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SUPABASE_SECRET = process.env.SUPABASE_SECRET_KEY;

// Client public (lecture depuis le navigateur — pages offre client)
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

// Client admin (écriture depuis les routes API serveur)
export const supabaseAdmin = createClient(
  SUPABASE_URL,
  SUPABASE_SECRET || SUPABASE_ANON
);

// Type pour une ligne de la table offres
export type OffreRow = {
  id: number;
  slug: string;
  type_document: string;
  numero: string;
  reference: string | null;
  statut: string;
  date_document: string | null;
  commercial: string | null;
  client_societe: string | null;
  client_nom: string | null;
  client_prenom: string | null;
  client_email: string | null;
  client_tel1: string | null;
  client_npa: string | null;
  client_ville: string | null;
  total_ttc: number | null;
  nb_articles: number;
  data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  snapshot_at: string | null;
  data_snapshot: Record<string, unknown> | null;
};