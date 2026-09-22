// lib/planner-ambiance-cadre.ts
// Cadrage de la demande d'ambiance IA (22.09.2026) — partagé navigateur /
// serveur. Constat : une phrase libre du type « change la teinte des meubles
// en bleu abyss » entre en conflit avec le prompt maître (« couleurs
// identiques au rendu 3D ») et l'IA fait n'importe quoi : meubles à moitié
// recolorés, rocking-chair inventé. D'où :
//   - des décors et moments PRÉDÉFINIS (texte validé) au lieu d'une saisie libre ;
//   - le coloris des meubles choisi dans une LISTE (nuancier), jamais en texte ;
//   - un filtre : toute phrase de précision qui parle des meubles (couleur,
//     ajout, retrait…) est écartée avant l'envoi et signalée au conseiller.

export type Preset = { id: string; nom: string; texte: (sol: string) => string };

export const DECORS: Preset[] = [
  { id: "lavaux", nom: "Lavaux, face au Léman", texte: (sol) => `Terrasse extérieure haut de gamme en ${sol} face au lac Léman, dans l'esprit des terrasses du Lavaux. Vignes en terrasses en arrière-plan, lac visible au loin et relief des Alpes sur l'autre rive. Architecture suisse discrète et raffinée.` },
  { id: "jardin", nom: "Jardin arboré", texte: (sol) => `Terrasse en ${sol} au bord d'un jardin paysager soigné : pelouse, massifs de graminées et de vivaces, quelques arbres, haie en arrière-plan. Maison contemporaine discrète hors champ.` },
  { id: "mediterranee", nom: "Méditerranée", texte: (sol) => `Terrasse en ${sol} d'une villa méditerranéenne : oliviers, lavande, murets de pierre sèche, mer en contrebas, ciel dégagé.` },
  { id: "alpes", nom: "Chalet alpin", texte: (sol) => `Terrasse en ${sol} d'un chalet contemporain en montagne : mélèzes, prairie, sommets alpins en arrière-plan.` },
  { id: "piscine", nom: "Bord de piscine", texte: (sol) => `Terrasse en ${sol} au bord d'une piscine à débordement d'une maison contemporaine, jardin minéral et végétal sobre.` },
  { id: "ville", nom: "Toit-terrasse en ville", texte: (sol) => `Toit-terrasse en ${sol} en ville, garde-corps en verre, bacs plantés sobres, vue dégagée sur les toits.` },
];

export const MOMENTS: Preset[] = [
  { id: "golden", nom: "Fin d'après-midi (golden hour)", texte: () => "Fin d'après-midi d'été, lumière chaude et naturelle de golden hour." },
  { id: "midi", nom: "Plein jour", texte: () => "Plein jour d'été, lumière naturelle douce, ciel bleu légèrement nuageux." },
  { id: "matin", nom: "Matin", texte: () => "Matin d'été, lumière fraîche et rasante, légère brume sur le paysage." },
  { id: "coucher", nom: "Coucher de soleil", texte: () => "Coucher de soleil : le soleil touche l'horizon, ciel orangé et rosé, lumière chaude et rasante, longues ombres." },
  // Formulation appuyée : « heure bleue » seule ne suffisait pas, l'IA rendait
  // un plein jour (constaté 22.09.2026).
  { id: "soir", nom: "Soirée éclairée", texte: () => "SCÈNE DE SOIRÉE, APRÈS LE COUCHER DU SOLEIL (ce n'est pas une scène de jour) : heure bleue, ciel bleu profond qui s'assombrit, plus aucun soleil ni ombre portée de soleil, paysage dans la pénombre avec quelques lumières au loin. Éclairage artificiel chaud et discret sur la terrasse (lanternes au sol, guirlande lumineuse, bougies) qui éclaire doucement les meubles sans les masquer." },
];

// Mots qui font d'une phrase une consigne sur les MEUBLES (à écarter).
const MOTS_MEUBLES = /\b(meubles?|mobilier|chaises?|fauteuils?|bancs?|tables?|canap[eé]s?|sofas?|rocking|transats?|daybeds?|poufs?|tabourets?|coussins?|plaids?|teintes?|couleurs?|coloris|peint\w*|repein\w*|recolor\w*|ajout\w*|rajout\w*|supprim\w*|enl[eè]v\w*|retir\w*|remplac\w*)\b/i;

// Sépare les précisions en phrases, écarte celles qui parlent des meubles.
export function filtrerDecor(texte: string): { decor: string; ignores: string[] } {
  const phrases = String(texte || "").split(/(?<=[.;!?])\s+|\n+/).map((p) => p.trim()).filter(Boolean);
  const gardees: string[] = [], ignores: string[] = [];
  for (const p of phrases) (MOTS_MEUBLES.test(p) ? ignores : gardees).push(p);
  return { decor: gardees.join(" "), ignores };
}

export function composerDescription(decorId: string, momentId: string, precisions: string, sol: string): { description: string; ignores: string[] } {
  const d = DECORS.find((x) => x.id === decorId) || DECORS[0];
  const m = MOMENTS.find((x) => x.id === momentId) || MOMENTS[0];
  const { decor, ignores } = filtrerDecor(precisions);
  return { description: [d.texte(sol), m.texte(sol), decor].filter(Boolean).join(" "), ignores };
}
