"use client";

import { useEffect, useState } from "react";

/**
 * Popup d'annonces "Release Notes" pour la mise à jour du 18.05.2026.
 *
 * Comportement :
 *  - S'affiche à chaque ouverture de /drafts/nouveau jusqu'au SHOW_UNTIL
 *  - Fermable par : bouton "Compris", touche Escape, clic overlay, bouton ✕
 *  - Checkbox "Ne plus afficher pendant 24h" → écrit un timestamp en
 *    localStorage qui supprime le popup pendant 24 heures
 *  - Versionné par la clé localStorage : changer SHOW_UNTIL OU le nom de la
 *    clé permet de relancer un nouveau popup sans toucher au précédent
 *
 * Pour DÉSACTIVER instantanément : commenter l'import + utilisation dans
 * app/drafts/nouveau/page.tsx (rollback chirurgical, voir PR #5 onboarding).
 */

// Date butoir (exclusif) : popup actif jusqu'au 28/05/2026 23:59 UTC
const SHOW_UNTIL = new Date("2026-05-29T00:00:00Z");
// Clé localStorage pour la fonction "ne plus afficher pendant 24h".
// Le nom contient la date du release pour permettre des popups futurs sans
// collision. Mise à jour 22.05.2026 : nouvelle clé pour que les commerciaux
// qui avaient masqué le popup 18.05 voient bien la nouvelle entrée Michel 2.0.
const HIDE_KEY = "jc-release-notes-hidden-until-2026-05-22";

export default function ReleaseNotesPopup() {
  const [open, setOpen] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);

  useEffect(() => {
    // Date butoir dépassée → ne jamais afficher
    if (new Date() >= SHOW_UNTIL) return;

    // Vérifier le timestamp "ne plus afficher"
    try {
      const hiddenUntil = localStorage.getItem(HIDE_KEY);
      if (hiddenUntil) {
        const until = new Date(hiddenUntil);
        if (!isNaN(until.getTime()) && new Date() < until) {
          // Encore dans la fenêtre de 24h → on masque
          return;
        }
      }
    } catch {
      // localStorage inaccessible (mode privé etc.) → on affiche quand même
    }

    setOpen(true);
  }, []);

  // Gestion touche Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, dontShowAgain]);

  function handleClose() {
    if (dontShowAgain) {
      try {
        const until = new Date(Date.now() + 24 * 60 * 60 * 1000);
        localStorage.setItem(HIDE_KEY, until.toISOString());
      } catch {
        // ignore
      }
    }
    setOpen(false);
  }

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="release-notes-title"
      onClick={handleClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(0,0,0,0.65)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
        backdropFilter: "blur(2px)",
      }}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "relative",
          maxWidth: 620,
          width: "100%",
          maxHeight: "90vh",
          overflowY: "auto",
          background: "#ffffff",
          borderRadius: 16,
          boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
          fontFamily: "Verdana, Arial, Helvetica, sans-serif",
          color: "#0a1551",
        }}>

        {/* Bouton fermer en haut à droite */}
        <button
          type="button"
          onClick={handleClose}
          aria-label="Fermer"
          style={{
            position: "absolute",
            top: 12,
            right: 12,
            width: 32,
            height: 32,
            borderRadius: "50%",
            border: "none",
            background: "rgba(0,0,0,0.05)",
            color: "#0a1551",
            fontSize: 18,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}>
          ✕
        </button>

        {/* Header */}
        <div style={{ padding: "28px 28px 14px 28px", textAlign: "center" }}>
          <div style={{
            display: "inline-block",
            padding: "4px 12px",
            borderRadius: 999,
            background: "#EEF7FF",
            border: "1px solid #B7D8F0",
            fontSize: 11,
            fontWeight: 700,
            color: "#2B8AD1",
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            marginBottom: 10,
          }}>
            🆕 Mises à jour · 18.05 & 22.05.2026
          </div>
          <h2 id="release-notes-title" style={{
            margin: 0,
            fontSize: 22,
            fontWeight: 700,
            color: "#0a1551",
          }}>
            Quoi de neuf sur le système d&apos;offres
          </h2>
        </div>

        {/* ─── Section Michel 2.0 (22.05.2026) ─── */}
        {/* Bloc visuellement différencié (fond vert pâle) pour mettre en
            évidence la nouveauté ajoutée le 22.05 par-dessus le popup 18.05. */}
        <div style={{ padding: "0 28px 18px 28px" }}>
          <div style={{
            background: "#ecfdf5",
            border: "1px solid #a7f3d0",
            borderLeft: "4px solid #10b981",
            borderRadius: 12,
            padding: "16px 18px",
          }}>
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 10,
              fontSize: 12,
              fontWeight: 700,
              color: "#047857",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}>
              <span style={{
                background: "#10b981",
                color: "#ffffff",
                padding: "2px 8px",
                borderRadius: 999,
                fontSize: 10,
                letterSpacing: "0.05em",
              }}>NOUVEAU</span>
              Mise à jour Michel 2.0 · 22.05.2026
            </div>

            <div style={{
              fontSize: 15,
              fontWeight: 700,
              color: "#064e3b",
              marginBottom: 8,
            }}>
              📋 Duplication d&apos;offre/brouillon enfin complète
            </div>

            <div style={{
              fontSize: 14,
              lineHeight: 1.6,
              color: "#064e3b",
              marginBottom: 10,
            }}>
              La duplication d&apos;une offre, d&apos;une commande ou d&apos;un brouillon
              copie maintenant <strong>tous les champs</strong> :
            </div>

            <ul style={{
              margin: 0,
              padding: "0 0 0 22px",
              fontSize: 13.5,
              lineHeight: 1.7,
              color: "#064e3b",
            }}>
              <li><strong>Adresse de livraison différente</strong> (tous les champs livraison)</li>
              <li><strong>Notes internes</strong> et <strong>note commerciale</strong></li>
              <li>Délai de livraison, mode de paiement, accès livraison</li>
              <li>Validité de l&apos;offre, remises, services, et tous les autres champs</li>
            </ul>

            <div style={{
              marginTop: 12,
              padding: "8px 12px",
              background: "rgba(255,255,255,0.6)",
              borderRadius: 8,
              fontSize: 13,
              color: "#065f46",
            }}>
              ⚠️ Seule <strong>la date n&apos;est pas reprise</strong> — elle prend automatiquement la date du jour.
            </div>

            <div style={{
              marginTop: 10,
              fontSize: 13,
              fontStyle: "italic",
              color: "#047857",
            }}>
              Particulièrement utile pour refaire des variantes d&apos;offres complexes.
            </div>
          </div>
        </div>

        {/* Section Majeures */}
        <div style={{ padding: "0 28px 14px 28px" }}>
          <div style={{
            fontSize: 12,
            fontWeight: 700,
            color: "#2B8AD1",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            marginBottom: 10,
            borderBottom: "1px solid #E8EAF3",
            paddingBottom: 6,
          }}>
            ⛹ Évolutions majeures (18.05.2026)
          </div>

          <ul style={{
            margin: 0,
            padding: "0 0 0 0",
            listStyle: "none",
            fontSize: 14,
            lineHeight: 1.65,
            color: "#0a1551",
          }}>
            <li style={{ marginBottom: 12, paddingLeft: 24, position: "relative" }}>
              <span style={{ position: "absolute", left: 0, top: 0 }}>✏️</span>
              <strong>Correction des offres et commandes existantes</strong> — un bouton{" "}
              <code style={{
                background: "#F3F5F6",
                padding: "1px 6px",
                borderRadius: 4,
                fontSize: 12,
                fontFamily: "Consolas, monospace",
              }}>✏️ Corriger</code> sur les pages dashboard permet désormais de modifier les champs d&apos;adresse et les notes sur les documents déjà créés. Les corrections sont listées sur la fiche de travail et dans le dashboard pour traçabilité complète.
            </li>

            <li style={{ marginBottom: 12, paddingLeft: 24, position: "relative" }}>
              <span style={{ position: "absolute", left: 0, top: 0 }}>⚡</span>
              <strong>Transformer un brouillon en offre directement</strong> — bouton{" "}
              <code style={{
                background: "#F3F5F6",
                padding: "1px 6px",
                borderRadius: 4,
                fontSize: 12,
                fontFamily: "Consolas, monospace",
              }}>⚡ Transformer en offre</code> accessible désormais directement sur la page d&apos;édition du brouillon (plus besoin de repasser par le dashboard).
            </li>

            <li style={{ marginBottom: 4, paddingLeft: 24, position: "relative" }}>
              <span style={{ position: "absolute", left: 0, top: 0 }}>📧</span>
              <strong>Nouveaux modèles d&apos;email pour les commandes</strong> — modèle dédié à l&apos;envoi de la commande (avec lien vers la commande et QR de paiement) et nouveau modèle de rappel d&apos;acompte chaleureux.
            </li>
          </ul>
        </div>

        {/* Section Mineures */}
        <div style={{ padding: "8px 28px 0 28px" }}>
          <div style={{
            fontSize: 12,
            fontWeight: 700,
            color: "#6f76a7",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            marginBottom: 10,
            borderBottom: "1px solid #E8EAF3",
            paddingBottom: 6,
          }}>
            ✨ Améliorations mineures
          </div>

          <ul style={{
            margin: 0,
            padding: 0,
            listStyle: "none",
            fontSize: 14,
            lineHeight: 1.65,
            color: "#0a1551",
          }}>
            <li style={{ marginBottom: 10, paddingLeft: 24, position: "relative" }}>
              <span style={{ position: "absolute", left: 0, top: 0 }}>📋</span>
              <strong>Copier l&apos;adresse client en un clic</strong> — un bouton{" "}
              <code style={{
                background: "#F3F5F6",
                padding: "1px 6px",
                borderRadius: 4,
                fontSize: 12,
                fontFamily: "Consolas, monospace",
              }}>📋 Copier adresse</code> sur la fiche client et sur les pages d&apos;une offre ou commande permet de copier l&apos;adresse complète dans le presse-papier.
            </li>

            <li style={{ marginBottom: 4, paddingLeft: 24, position: "relative" }}>
              <span style={{ position: "absolute", left: 0, top: 0 }}>🏷️</span>
              <strong>27 logos de marques disponibles</strong> pour ajouter des titres dans les offres (sélecteur de logo enrichi).
            </li>
          </ul>
        </div>

        {/* Footer : checkbox + bouton */}
        <div style={{
          padding: "20px 28px 24px 28px",
          marginTop: 16,
          borderTop: "1px solid #E8EAF3",
          background: "#F8FAFC",
          borderRadius: "0 0 16px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}>
          <label style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 13,
            color: "#5e678f",
            cursor: "pointer",
          }}>
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
              style={{ width: 16, height: 16, cursor: "pointer" }}
            />
            Ne plus afficher pendant 24h
          </label>

          <button
            type="button"
            onClick={handleClose}
            style={{
              padding: "10px 24px",
              borderRadius: 26,
              border: "none",
              background: "#2B8AD1",
              color: "#ffffff",
              fontSize: 14,
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "inherit",
            }}>
            Compris, je continue
          </button>
        </div>

      </div>
    </div>
  );
}