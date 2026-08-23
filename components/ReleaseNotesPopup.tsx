"use client";

import { useEffect, useState } from "react";

/**
 * Popup d'annonces "Release Notes" — mise à jour du 23.08.2026.
 *
 * Comportement :
 *  - S'affiche à chaque ouverture du dashboard jusqu'au SHOW_UNTIL
 *  - Fermable par : bouton "Compris", touche Escape, clic overlay, bouton ✕
 *  - Checkbox "Ne plus afficher pendant 24h" → écrit un timestamp en
 *    localStorage qui supprime le popup pendant 24 heures
 *  - Versionné par la clé localStorage : changer SHOW_UNTIL OU le nom de la
 *    clé permet de relancer un nouveau popup sans toucher au précédent
 *
 * Pour DÉSACTIVER instantanément : commenter l'import + utilisation dans
 * app/dashboard/page.tsx (rollback chirurgical, voir PR #5 onboarding).
 *
 * Historique d'emplacement : monté sur /drafts/nouveau jusqu'au 23.08.2026,
 * déplacé sur le dashboard — deux des trois nouveautés annoncées y vivent,
 * et c'est la page que tout le monde ouvre en premier.
 */

// Date butoir (exclusif) : popup actif jusqu'au 30/08/2026 inclus
const SHOW_UNTIL = new Date("2026-08-31T00:00:00Z");
// Clé localStorage pour la fonction "ne plus afficher pendant 24h".
// Le nom contient la date du release pour permettre des popups futurs sans
// collision : les commerciaux qui avaient masqué un popup précédent voient
// bien celui-ci.
const HIDE_KEY = "jc-release-notes-hidden-until-2026-08-23";

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

  const codeStyle = {
    background: "#F3F5F6",
    padding: "1px 6px",
    borderRadius: 4,
    fontSize: 12,
    fontFamily: "Consolas, monospace",
  } as const;

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
          maxWidth: 660,
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
            🆕 Mise à jour · 23.08.2026
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

        {/* ─── Section nouveauté du jour : flèches de déplacement ─── */}
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
              Dans le formulaire
            </div>

            <div style={{
              fontSize: 15,
              fontWeight: 700,
              color: "#064e3b",
              marginBottom: 8,
            }}>
              ▲▼ Déplacer une ligne d&apos;article au clic
            </div>

            <div style={{
              fontSize: 14,
              lineHeight: 1.6,
              color: "#064e3b",
              marginBottom: 10,
            }}>
              Deux petites flèches apparaissent dans la colonne{" "}
              <code style={codeStyle}>#</code> de chaque ligne. Un clic la fait monter
              ou descendre d&apos;un cran — plus besoin de viser un glisser-déposer.
            </div>

            <ul style={{
              margin: 0,
              padding: "0 0 0 22px",
              fontSize: 13.5,
              lineHeight: 1.7,
              color: "#064e3b",
            }}>
              <li>Fonctionne sur les articles, les commentaires 💬 et les images 🖼️</li>
              <li>Disponible dans un brouillon <strong>et</strong> dans la révision d&apos;une commande</li>
              <li>Le glisser-déposer continue de marcher exactement comme avant</li>
              <li>Un déplacement de trop se défait avec le bouton « Annuler »</li>
            </ul>
          </div>
        </div>

        {/* ─── Section : le chat Jardi et ses outils ─── */}
        <div style={{ padding: "0 28px 18px 28px" }}>
          <div style={{
            background: "#f0f9ff",
            border: "1px solid #bae6fd",
            borderLeft: "4px solid #0ea5e9",
            borderRadius: 12,
            padding: "16px 18px",
          }}>
            <div style={{
              fontSize: 15,
              fontWeight: 700,
              color: "#075985",
              marginBottom: 6,
            }}>
              💬 Jardi — l&apos;assistant du dashboard
            </div>

            <div style={{
              fontSize: 13.5,
              lineHeight: 1.6,
              color: "#075985",
              marginBottom: 10,
            }}>
              Le bouton <strong>💬 Jardi</strong> en haut du dashboard ouvre un chat qui
              a accès aux vrais outils de la maison — catalogue, stock, clients,
              commandes, mails, factures. Quelques exemples de ce qu&apos;on peut lui
              demander en une phrase :
            </div>

            <ul style={{
              margin: 0,
              padding: "0 0 0 22px",
              fontSize: 13,
              lineHeight: 1.75,
              color: "#075985",
            }}>
              <li>
                <strong>Créer un brouillon d&apos;offre</strong> à partir d&apos;un texte
                dicté — ou de la <strong>photo d&apos;une commande manuscrite</strong>
                déposée dans le chat : il résout les articles au catalogue et rend un{" "}
                <code style={codeStyle}>DRA-XXX</code> prêt à compléter.
              </li>
              <li>
                <strong>Chercher un article</strong> par désignation, SKU ou code-barres,
                avec le <strong>stock exact par variante</strong> et le prix.
              </li>
              <li>
                <strong>Ouvrir une commande</strong> par son numéro (JAR, LUM, AM, CMD,
                DEV) et donner le suivi du colis — ou répondre à{" "}
                <em>« qui a commandé ce parasol ? »</em>.
              </li>
              <li>
                <strong>Sortir le dossier complet d&apos;un client</strong> : coordonnées,
                offres, commandes web, factures WinBiz et derniers échanges, d&apos;un seul
                coup.
              </li>
              <li>
                <strong>Retrouver un mail ou une pièce jointe</strong> — recherche par
                nom de fichier <em>ou par contenu</em> dans les PDF archivés.
              </li>
              <li>
                <strong>Préparer une réponse</strong> dans la bonne boîte mail, avec la
                bonne signature.
              </li>
              <li>
                <strong>Chiffres de vente</strong> d&apos;une période, meilleures ventes,
                et l&apos;état des <strong>délais fournisseurs</strong>.
              </li>
            </ul>

            <div style={{
              marginTop: 12,
              padding: "8px 12px",
              background: "rgba(255,255,255,0.7)",
              borderRadius: 8,
              fontSize: 12.5,
              lineHeight: 1.6,
              color: "#0c4a6e",
            }}>
              🔒 <strong>Jardi ne fait que des brouillons.</strong> Une offre n&apos;est
              jamais créée ni validée, un mail n&apos;est jamais envoyé : il prépare, vous
              relisez et vous cliquez. Deux limites à connaître : la recherche dans les
              mails peut ignorer <strong>la dernière heure ou deux</strong>, et la boîte
              amook n&apos;y est pas indexée.
            </div>

            <div style={{
              marginTop: 10,
              fontSize: 12.5,
              fontStyle: "italic",
              color: "#0369a1",
            }}>
              Le même Jardi répond aussi directement dans Thunderbird, pour rédiger les
              réponses aux clients.
            </div>
          </div>
        </div>

        {/* ─── Section : les deux tableaux du dashboard ─── */}
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
            📊 Deux nouveaux tableaux sur le dashboard
          </div>

          <ul style={{
            margin: 0,
            padding: 0,
            listStyle: "none",
            fontSize: 14,
            lineHeight: 1.65,
            color: "#0a1551",
          }}>
            <li style={{ marginBottom: 14, paddingLeft: 26, position: "relative" }}>
              <span style={{ position: "absolute", left: 0, top: 0 }}>📦</span>
              <strong>Arrivages</strong> — la réception, article par article.
              Scannez la fiche de travail (douchette du comptoir ou caméra du
              téléphone) : la commande s&apos;ouvre, et vous pointez ce qui est arrivé
              ligne par ligne, avec la quantité. <strong>Tout reçu</strong> solde d&apos;un
              coup ce qui attend encore. Une erreur se corrige par une ligne
              d&apos;annulation — rien n&apos;est jamais écrasé, l&apos;historique reste entier.
            </li>

            <li style={{ marginBottom: 4, paddingLeft: 26, position: "relative" }}>
              <span style={{ position: "absolute", left: 0, top: 0 }}>⏱</span>
              <strong>Délais fournisseurs</strong> — une ligne par commande et par
              marque : le départ annoncé par le fabricant, l&apos;arrivage qui en découle,
              et surtout la comparaison avec <strong>ce qu&apos;on a promis au client</strong>.
              Un badge{" "}
              <span style={{
                background: "#fdf2f8",
                border: "1px solid #fbcfe8",
                borderRadius: 6,
                padding: "1px 6px",
                fontSize: 12,
                color: "#9d174d",
                whiteSpace: "nowrap",
              }}>⚠️ +X j vs promis</span>{" "}
              signale les commandes où la promesse ne tient plus. Filtres par marque,
              boutique, retard et échéance.
            </li>
          </ul>
        </div>

        {/* ─── Encadré : d'où viennent les dates de délai ─── */}
        <div style={{ padding: "8px 28px 0 28px" }}>
          <div style={{
            background: "#f5f8ff",
            border: "1px solid #d8e3f8",
            borderLeft: "4px solid #2B8AD1",
            borderRadius: 12,
            padding: "16px 18px",
          }}>
            <div style={{
              fontSize: 14,
              fontWeight: 700,
              color: "#12306b",
              marginBottom: 8,
            }}>
              📬 D&apos;où viennent ces dates ? Des mails fournisseurs, tout seuls
            </div>

            <div style={{
              fontSize: 13.5,
              lineHeight: 1.65,
              color: "#12306b",
              marginBottom: 10,
            }}>
              Personne ne les saisit. <strong>Toutes les 3 heures</strong>, un automate
              relit les mails des fournisseurs et leurs pièces jointes — accusés de
              réception Fermob, factures Glatz — en extrait la date de départ et la
              pose sur la bonne commande. L&apos;arrivage se déduit ensuite d&apos;une règle
              de transit propre à chaque marque (Fermob : le jeudi de la semaine
              suivante ; Glatz : +3 jours ouvrés ; Fatboy : +5).
            </div>

            <ul style={{
              margin: 0,
              padding: "0 0 0 22px",
              fontSize: 13,
              lineHeight: 1.7,
              color: "#12306b",
            }}>
              <li>
                Ce dont il n&apos;est <strong>pas sûr</strong> part dans le volet
                « À valider » en bas de page : vous tranchez d&apos;un clic.
              </li>
              <li>
                Ce qu&apos;il ne sait <strong>pas rattacher</strong> à une commande reste
                visible dans « Orphelines ». <strong>Rien n&apos;est jeté en silence.</strong>
              </li>
              <li>
                Le bouton <strong>Reçu</strong> d&apos;une ligne sert à recaler les règles
                de transit sur le réel — c&apos;est ce qui rend les prévisions plus justes
                avec le temps.
              </li>
            </ul>
          </div>
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
