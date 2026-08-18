// lib/preparer-fichier.ts
// ─────────────────────────────────────────────────────────────────────────────
// Préparation d'un fichier côté NAVIGATEUR avant upload (code extrait de
// app/dashboard/jardi/page.tsx au chantier annexes, 18.08.2026 — partagé entre
// le chat Jardi et la carte Annexes du dashboard).
//
// Le redimensionnement n'est PAS une optimisation, c'est une CONDITION DE
// FONCTIONNEMENT : une fonction Vercel refuse un corps au-delà de ~4,5 Mo — les
// plafonds amont (32 Mo API Anthropic, 20 Mo bucket) sont donc hors d'atteinte —
// et une photo de téléphone les dépasse vite. Côté long plafonné à 2000 px :
// largement lisible pour du manuscrit sur A4 (les scans du pilote font ~750 Ko).
//
// ⚠️ Module navigateur uniquement (canvas, createImageBitmap) : à n'importer
// que depuis des composants client.
// ─────────────────────────────────────────────────────────────────────────────

export const COTE_MAX = 2000;
export const QUALITE_JPEG = 0.85;
export const TAILLE_MAX = 4 * 1024 * 1024;

export function nomEnJpg(nom: string): string {
  // L'extension change, le reste du nom NON : il porte le n° manuscrit
  // (« Scan_Copie_Commande_53864_… »), qui sert à retrouver le scan en base.
  return nom.replace(/\.[^.]+$/, "") + ".jpg";
}

export async function preparerFichier(f: File): Promise<File> {
  if (f.type === "application/pdf") {
    if (f.size > TAILLE_MAX) {
      throw new Error("PDF trop lourd (max 4 Mo) — photographie les pages une à une");
    }
    return f;
  }
  if (!f.type.startsWith("image/")) {
    throw new Error("format non accepté (photo ou PDF)");
  }

  let bitmap: ImageBitmap;
  try {
    // `from-image` applique l'orientation EXIF. Sans elle, une photo prise en
    // portrait arrive couchée — et la lecture du manuscrit s'en ressent.
    const options = { imageOrientation: "from-image" } as unknown as ImageBitmapOptions;
    bitmap = await createImageBitmap(f, options);
  } catch {
    // Un HEIC d'iPhone atterrit ici hors de Safari : le navigateur ne sait pas
    // le décoder. iOS convertit normalement en JPEG à la prise de vue.
    throw new Error("image illisible par le navigateur — réessaie en JPEG");
  }

  const facteur = Math.min(1, COTE_MAX / Math.max(bitmap.width, bitmap.height));
  const largeur = Math.max(1, Math.round(bitmap.width * facteur));
  const hauteur = Math.max(1, Math.round(bitmap.height * facteur));
  const toile = document.createElement("canvas");
  toile.width = largeur;
  toile.height = hauteur;
  const ctx = toile.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("redimensionnement impossible");
  }
  // Sans fond blanc, `toBlob("image/jpeg")` aplatit la transparence en NOIR :
  // une capture PNG à fond transparent arrive en écriture noire sur noir, et la
  // lecture échoue sans qu'aucune erreur ne l'explique.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, largeur, hauteur);
  ctx.drawImage(bitmap, 0, 0, largeur, hauteur);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resoudre) =>
    toile.toBlob(resoudre, "image/jpeg", QUALITE_JPEG)
  );
  if (!blob) throw new Error("redimensionnement impossible");
  if (blob.size > TAILLE_MAX) throw new Error("image trop lourde même après réduction");
  return new File([blob], nomEnJpg(f.name || "photo"), { type: "image/jpeg" });
}
