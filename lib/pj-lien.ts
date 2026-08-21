// lib/pj-lien.ts
// Fabrique un lien SIGNÉ et EXPIRANT (4 h) vers une pièce jointe servie par
// le proxy /attachment de jardi-mail-mcp — même mécanique HMAC que là-bas.
// Le chemin Dropbox est permanent (stocké dans delais_evenements.pj_chemin) ;
// le lien, lui, est périssable par design : on le régénère à chaque affichage.
// Nécessite ATTACHMENT_SIGN_SECRET dans l'environnement (même valeur que le
// projet Vercel jardi-mail-mcp). Aucun identifiant Dropbox ici : ce secret ne
// permet que de signer des liens, jamais d'accéder à Dropbox directement.
import crypto from "crypto"

const BASE_ATTACHMENT = process.env.JARDI_MAIL_BASE_URL || "https://jardi-mail-mcp.vercel.app"

export function lienPJ(chemin: string | null | undefined, ttlSecondes = 4 * 3600): string | null {
  const secret = process.env.ATTACHMENT_SIGN_SECRET
  if (!secret || !chemin) return null
  const exp = Math.floor(Date.now() / 1000) + ttlSecondes
  const sig = crypto.createHmac("sha256", secret).update(`${chemin}:${exp}`).digest("hex")
  return `${BASE_ATTACHMENT}/attachment?p=${encodeURIComponent(chemin)}&exp=${exp}&sig=${sig}`
}
