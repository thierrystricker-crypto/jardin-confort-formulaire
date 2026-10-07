// lib/validite-offre.ts
//
// Validité d'une offre et prolongation (08.10.2026).
//
// Par défaut une offre expire à date_document + validiteDuree (« 30 jours »).
// La date de l'offre ne bouge JAMAIS : c'est la preuve de ce qui a été proposé
// et quand. Une prolongation pose seulement data.validiteJusquau ("YYYY-MM-DD"),
// par une CORRECTION tracée (/api/corrections : qui, quand, pourquoi, ancienne
// et nouvelle date). Si elle est présente, elle remplace le calcul.

export const CHAMP_PROLONGATION = "validiteJusquau";

export function joursValidite(validiteDuree: string | null | undefined): number {
  return parseInt(validiteDuree || "", 10) || 30;
}

function dateIsoValide(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

/** Date de fin de validité, ou null si la date du document est inconnue. */
export function dateExpirationOffre(
  dateDocument: string | null | undefined,
  validiteDuree: string | null | undefined,
  validiteJusquau?: unknown
): Date | null {
  if (dateIsoValide(validiteJusquau)) return new Date(`${validiteJusquau}T23:59:59`);
  if (!dateDocument) return null;
  const d = new Date(dateDocument);
  if (isNaN(d.getTime())) return null;
  return new Date(d.getTime() + joursValidite(validiteDuree) * 86400000);
}

export function estProlongee(validiteJusquau: unknown): boolean {
  return dateIsoValide(validiteJusquau);
}

/** "2026-12-15" -> "15.12.2026" */
export function formatJourCH(iso: string): string {
  const [a, m, j] = iso.split("-");
  return `${j}.${m}.${a}`;
}

/** Date locale -> "YYYY-MM-DD" (sans passer par l'UTC). */
export function versIsoJour(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
