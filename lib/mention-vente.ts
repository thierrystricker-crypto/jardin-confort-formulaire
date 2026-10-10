// Mentions de vente « Expo » / « Soldes » sur une ligne d'article (10.10.2026).
//
// La mention est ecrite DANS le titre de la ligne, a la fin, apres " — ".
// Choix voulu : tous les rendus (page client /offre/[slug], impressions,
// fiche bleue, bulletin, export WinBiz, connecteur Jardi) affichent deja le
// titre — aucun rendu a toucher, aucune colonne, aucune RPC.
//
// L'etat (expo / soldes) n'est pas stocke a part : il se RELIT a la fin du
// titre. Une seule source de verite, impossible de desynchroniser un drapeau
// et un texte. Si un commercial retouche la mention a la main, elle n'est
// simplement plus reconnue (les boutons repassent a « off »), rien ne casse.
//
// Les impressions ne gardent pas les retours a la ligne du titre et WinBiz les
// remplace par des espaces : d'ou un separateur sur une seule ligne.

export type EtatMention = { expo: boolean; soldes: boolean };

export const MENTION_EXPO =
  "Article d'exposition ni repris ni échangé. Vendu en l'état tel que vu et essayé.";
export const MENTION_SOLDES = "Article soldé ni repris ni échangé.";
export const MENTION_EXPO_SOLDES =
  "Article d'exposition soldé ni repris ni échangé. Vendu en l'état tel que vu et essayé.";

const SEPARATEUR = " — ";

// La combinee d'abord (par prudence : aucune mention n'est le suffixe d'une autre).
const MENTIONS: [string, EtatMention][] = [
  [MENTION_EXPO_SOLDES, { expo: true, soldes: true }],
  [MENTION_EXPO, { expo: true, soldes: false }],
  [MENTION_SOLDES, { expo: false, soldes: true }],
];

export const AUCUNE_MENTION: EtatMention = { expo: false, soldes: false };

export function texteMention(e: EtatMention): string {
  if (e.expo && e.soldes) return MENTION_EXPO_SOLDES;
  if (e.expo) return MENTION_EXPO;
  if (e.soldes) return MENTION_SOLDES;
  return "";
}

export function lireMention(titre: string | null | undefined): EtatMention {
  const t = (titre ?? "").trimEnd();
  for (const [texte, etat] of MENTIONS) if (t.endsWith(texte)) return { ...etat };
  return { ...AUCUNE_MENTION };
}

export function retirerMention(titre: string | null | undefined): string {
  const t = (titre ?? "").trimEnd();
  for (const [texte] of MENTIONS) {
    if (t.endsWith(texte)) {
      let base = t.slice(0, t.length - texte.length).trimEnd();
      if (base.endsWith("—")) base = base.slice(0, -1).trimEnd();
      return base;
    }
  }
  return titre ?? "";
}

/** Remplace la mention en fin de titre (ou la retire si aucune case n'est cochee). */
export function ecrireMention(titre: string | null | undefined, e: EtatMention): string {
  const base = retirerMention(titre);
  const m = texteMention(e);
  if (!m) return base;
  return base ? base + SEPARATEUR + m : m;
}
