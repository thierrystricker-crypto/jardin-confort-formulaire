// lib/jardi-equipe.ts
// ─────────────────────────────────────────────────────────────────────────────
// Qui parle à Jardi (27.08.2026). Liste FERMÉE : le classement de l'historique
// par utilisateur ne vaut que si chacun se présente toujours sous le même nom.
// Avant, l'auteur venait du champ libre « corrections-author » : « thierry »,
// « TS », « brice c »… et 49 conversations sur 107 sans auteur (mobile).
//
// Partagé entre la page /dashboard/jardi (sélecteur), l'API conversations
// (normalisation à l'écriture) et l'API chat (nom injecté dans le prompt).
// ─────────────────────────────────────────────────────────────────────────────

export const EQUIPE_JARDI = [
  "Thierry",
  "Michel",
  "Brice",
  "Fabian",
  "Sabrina",
  "Alejandro",
] as const;

export type MembreEquipe = (typeof EQUIPE_JARDI)[number];

// Clé localStorage, par appareil. Un iPhone et un poste de bureau se
// présentent chacun une fois — c'est voulu : le poste du magasin est partagé,
// on doit pouvoir y changer d'utilisateur en un clic.
export const CLE_UTILISATEUR = "jardi-utilisateur";

/** Ramène une saisie libre (« thierry », « TS », « brice c ») au prénom
 *  canonique, ou null si rien ne correspond. */
export function normaliserMembre(brut: unknown): MembreEquipe | null {
  if (typeof brut !== "string") return null;
  const t = brut.trim().toLowerCase();
  if (!t) return null;
  if (t === "ts") return "Thierry";
  for (const m of EQUIPE_JARDI) {
    if (t === m.toLowerCase() || t.startsWith(m.toLowerCase() + " ")) return m;
  }
  return null;
}
