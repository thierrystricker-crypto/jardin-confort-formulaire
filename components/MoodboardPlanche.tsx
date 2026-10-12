"use client";
// components/MoodboardPlanche.tsx
// Planche « Vos couleurs et matières » (chantier moodboard, 12.10.2026).
//
// Un seul composant pour les trois usages :
//   • page d'impression / PDF (pdf.co)   → interactif = false
//   • page web client /offre/[slug]      → interactif = true (survol croisé)
//   • aperçu dans le formulaire          → interactif = true, compact = true
//
// Gauche : pastilles rondes classées par famille (nom, code, marque).
// Droite : palette de blocs jointifs, SANS texte — par valeur (mosaïque) ou en
// dégradé (bandes triées par clarté). Les positions sont en %, calculées sur
// un format fixe : le rendu est le même partout, sans mesure d'écran.
//
// Rond = CSS (border-radius + object-fit) : les vignettes sont carrées, on ne
// les recadre ni ne les compresse.

import React, { useMemo, useState } from "react";
import {
  type MatiereMoodboard,
  type ModeMoodboard,
  type SensMoodboard,
  grouperParFamille,
  disposerParPoids,
  disposerEnDegrade,
  texteCouverture,
} from "@/lib/moodboard";

// Format du corps de planche : 180 × 215 (mm sur A4, marges déduites).
// Colonne gauche 36 %, espace 4 %, palette 60 % → ratio du panneau de droite.
const LARGEUR = 180;
const HAUTEUR = 215;
const PART_GAUCHE = 0.36;
const PART_DROITE = 0.6;
const RATIO_PALETTE = (LARGEUR * PART_DROITE) / HAUTEUR;
// Au-delà, les pastilles passent sur deux colonnes, en plus petit.
const SEUIL_DENSE = 12;

type Props = {
  matieres: MatiereMoodboard[];
  couverture: { articles: number; representes: number };
  mode: ModeMoodboard;
  sens: SensMoodboard;
  interactif?: boolean;
  compact?: boolean;
  mention?: boolean; // « Teintes indicatives… » (document client)
};

export default function MoodboardPlanche({
  matieres, couverture, mode, sens,
  interactif = false, compact = false, mention = true,
}: Props) {
  const [survol, setSurvol] = useState<string | null>(null);

  const familles = useMemo(() => grouperParFamille(matieres), [matieres]);
  const blocs = useMemo(
    () => (mode === "degrade" ? disposerEnDegrade(matieres, sens) : disposerParPoids(matieres, RATIO_PALETTE)),
    [matieres, mode, sens]
  );

  if (matieres.length === 0) return null;

  const dense = matieres.length > SEUIL_DENSE;
  const texte = texteCouverture(couverture);
  const actif = interactif ? survol : null;

  const entrer = (cle: string) => () => { if (interactif) setSurvol(cle); };
  const sortir = () => { if (interactif) setSurvol(null); };

  return (
    <div className={`mbp${dense ? " mbp-dense" : ""}${compact ? " mbp-compact" : ""}${actif ? " mbp-hl" : ""}`}>
      <style>{CSS}</style>

      <div className="mbp-corps" style={{ aspectRatio: `${LARGEUR} / ${HAUTEUR}` }}>
        <div className="mbp-gauche" style={{ width: `${PART_GAUCHE * 100}%` }}>
          {familles.map((g) => (
            <div key={g.famille} className="mbp-famille">
              <div className="mbp-famille-titre">{g.libelle}</div>
              <div className="mbp-famille-liste">
                {g.matieres.map((m) => (
                  <div
                    key={m.cle}
                    className={`mbp-item${actif === m.cle ? " on" : ""}`}
                    onMouseEnter={entrer(m.cle)}
                    onMouseLeave={sortir}
                  >
                    <img
                      className="mbp-rond"
                      src={m.url_vignette}
                      alt={m.nom}
                      style={{ backgroundColor: m.hex || "#eee" }}
                    />
                    <div className="mbp-texte">
                      <span className="mbp-nom">{m.nom}</span>
                      {m.code ? <span className="mbp-code"> {m.code}</span> : null}
                      <br />
                      <span className="mbp-marque">{m.marque}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mbp-droite" style={{ width: `${PART_DROITE * 100}%` }}>
          {blocs.map((b) => {
            const imageDansBloc = b.matiere.motif || !b.matiere.hex;
            return (
              <div
                key={b.matiere.cle}
                className={`mbp-bloc${actif === b.matiere.cle ? " on" : ""}`}
                onMouseEnter={entrer(b.matiere.cle)}
                onMouseLeave={sortir}
                style={{
                  left: `${b.x}%`,
                  top: `${b.y}%`,
                  // +0.15 % : évite les filets blancs d'arrondi entre deux blocs
                  width: `${b.w + 0.15}%`,
                  height: `${b.h + 0.15}%`,
                  backgroundColor: b.matiere.hex || "#ddd",
                }}
              >
                {imageDansBloc ? <img src={b.matiere.url_vignette} alt="" /> : null}
              </div>
            );
          })}
        </div>
      </div>

      {(texte || mention) && (
        <div className="mbp-pied">
          {texte ? <div>{texte}</div> : null}
          {mention ? (
            <div>Teintes indicatives : le rendu varie selon l&apos;écran et l&apos;impression. Échantillons disponibles dans notre exposition.</div>
          ) : null}
        </div>
      )}
    </div>
  );
}

const CSS = `
.mbp { width: 100%; color: #333; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
.mbp-corps { display: flex; justify-content: space-between; width: 100%; }
.mbp-gauche { overflow: hidden; }
.mbp-droite { position: relative; overflow: hidden; }
.mbp-famille { margin-bottom: 9px; break-inside: avoid; }
.mbp-famille-titre { font-size: 9.5px; letter-spacing: .08em; text-transform: uppercase; color: #999; border-bottom: 1px solid #e6e6e6; padding-bottom: 2px; margin-bottom: 6px; }
.mbp-item { display: flex; align-items: center; gap: 9px; margin-bottom: 7px; transition: opacity .15s; }
.mbp-rond { width: 38px; height: 38px; flex: 0 0 38px; border-radius: 50%; object-fit: cover; display: block; transition: transform .2s; transform-origin: left center; position: relative; }
.mbp-texte { font-size: 11px; line-height: 1.3; transition: transform .2s; }
.mbp-nom { font-weight: 700; color: #222; }
.mbp-code, .mbp-marque { color: #888; font-size: 10.5px; }
.mbp-bloc { position: absolute; overflow: hidden; transition: opacity .15s; }
.mbp-bloc img { width: 100%; height: 100%; object-fit: cover; display: block; }
.mbp-hl .mbp-item { opacity: .35; }
.mbp-hl .mbp-item.on { opacity: 1; }
.mbp-hl .mbp-bloc { opacity: .25; }
.mbp-hl .mbp-bloc.on { opacity: 1; }
.mbp-item.on .mbp-rond { transform: scale(2.4); z-index: 5; }
.mbp-item.on .mbp-texte { transform: translateX(54px); }
.mbp-pied { margin-top: 4mm; text-align: center; font-size: 10px; color: #888; line-height: 1.6; }
.mbp-dense .mbp-famille-liste { display: grid; grid-template-columns: 1fr 1fr; column-gap: 6px; }
.mbp-dense .mbp-rond { width: 28px; height: 28px; flex-basis: 28px; }
.mbp-dense .mbp-texte { font-size: 9.5px; }
.mbp-dense .mbp-code, .mbp-dense .mbp-marque { font-size: 9px; }
.mbp-dense .mbp-item.on .mbp-texte { transform: translateX(40px); }
.mbp-compact .mbp-rond { width: 26px; height: 26px; flex-basis: 26px; }
.mbp-compact .mbp-texte { font-size: 10px; }
.mbp-compact .mbp-famille-titre { font-size: 9px; }
.mbp-compact .mbp-item.on .mbp-texte { transform: translateX(38px); }
@media screen and (max-width: 600px) {
  .mbp:not(.mbp-compact) .mbp-corps { flex-direction: column-reverse; aspect-ratio: auto !important; }
  .mbp:not(.mbp-compact) .mbp-gauche, .mbp:not(.mbp-compact) .mbp-droite { width: 100% !important; }
  .mbp:not(.mbp-compact) .mbp-droite { aspect-ratio: ${(LARGEUR * PART_DROITE).toFixed(0)} / ${HAUTEUR}; max-height: 70vh; margin-bottom: 14px; }
}
@media print { .mbp-item, .mbp-bloc { opacity: 1 !important; } .mbp-rond, .mbp-texte { transform: none !important; } }
`;
