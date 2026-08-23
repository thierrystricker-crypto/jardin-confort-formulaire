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

// Lien cliquable vers le MAIL D'ORIGINE dans Thunderbird, via la passerelle
// /mid/<mid> de jardi-mail-mcp (même construction que lienThunderbird côté
// connecteur). `mid` vient de mails.thunderbird_link (« mid:<message-id> »).
// Les mails sans Message-ID (robot Fermob paiement@) n'en ont pas : null,
// et l'interface n'affiche rien — jamais de lien de secours inventé.
export function lienThunderbird(mid: string | null | undefined): string | null {
  if (!mid || !String(mid).startsWith("mid:")) return null
  return `${BASE_ATTACHMENT}/mid/${encodeURIComponent(mid)}`
}

// Nom lisible du document source : nom de fichier débarrassé du préfixe
// technique de l'archivage (uid_xxx_n_). Les PDF au nom générique (ARC
// Fermob « jobrpt_ARCCLIENT_… ») sont remplacés par la référence de commande
// fournisseur extraite du commentaire de l'événement (BTBx / SAVx).
export function nomDocument(chemin: string | null | undefined, commentaire?: string | null): string | null {
  if (!chemin) return null
  const base = decodeURIComponent(String(chemin).split("/").pop() || "")
  const nettoye = base.replace(/^[0-9a-f]{6,12}_\d+(_\d+)?_/i, "").replace(/\.pdf$/i, "").trim()
  if (/arcclient/i.test(nettoye)) {
    const ref = /(BTB\d+|SAV\d*FE\d+)/i.exec(commentaire || "")?.[1]
    return ref ? `ARC ${ref.toUpperCase()}` : "ARC Fermob"
  }
  return nettoye || null
}
