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
// Droite : palette de blocs jointifs, SANS texte, remplis avec la VRAIE image
// de la matière (pas la couleur moyenne, qui aplatit bois, galvanisé, tissus).
// Par valeur (mosaïque) ou en dégradé (bandes triées par clarté du hex).
// Les positions sont en %, calculées sur un format fixe : rendu identique
// partout, sans mesure d'écran.
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
  urlCdn,
  clarte,
  COTE_MIN_ETIREE,
} from "@/lib/moodboard";

// Format du corps de planche : 180 × 215 (mm sur A4, marges déduites).
// Colonne gauche 36 %, espace 4 %, palette 60 % → ratio du panneau de droite.
const LARGEUR = 180;
const HAUTEUR = 215;
const PART_GAUCHE = 0.36;
const PART_DROITE = 0.6;
const RATIO_PALETTE = (LARGEUR * PART_DROITE) / HAUTEUR;
// Pastille très claire (L* au-dessus) : fin cercle gris, comme sur le webshop,
// pour qu'un blanc ne se perde pas sur le fond blanc.
const CLARTE_CERCLE_GRIS = 85;
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
  // "mixte"   : carte d'échantillon — un carré avec la matière entière (échelle
  //             naturelle), le reste du bloc en gros plan. Défaut.
  // "naturel" : chaque image à la taille d'un échantillon (TAILLE_ECHANTILLON),
  //             répétée pour remplir le bloc — même grain pour toutes les matières.
  // "etire"   : image agrandie pour couvrir tout le bloc (grain zoomé).
  rendu?: "mixte" | "naturel" | "etire";
};

// Taille d'affichage d'un échantillon en rendu naturel (sur l'A4 imprimé).
const TAILLE_ECHANTILLON = "45mm";
// Panneau de palette en mm (sert au rendu mixte pour tracer des carrés vrais).
const PALETTE_L_MM = LARGEUR * PART_DROITE;
const PALETTE_H_MM = HAUTEUR;
// Gros plan du rendu mixte : agrandissement de l'image dans la zone de détail.
const ZOOM_DETAIL = 2;

export default function MoodboardPlanche({
  matieres, couverture, mode, sens,
  interactif = false, compact = false, mention = true, rendu = "mixte",
}: Props) {
  const [survol, setSurvol] = useState<string | null>(null);

  const familles = useMemo(() => grouperParFamille(matieres), [matieres]);
  const blocs = useMemo(
    () => (mode === "degrade" ? disposerEnDegrade(matieres, sens) : disposerParPoids(matieres, RATIO_PALETTE)),
    [matieres, mode, sens]
  );

  // Taille réelle (mm) du carré « matière entière » de chaque bloc → pastilles.
  const carres = useMemo(
    () => new Map(blocs.map((b) => [b.matiere.cle, geometrieCarte(b.w, b.h).coteMm])),
    [blocs]
  );

  if (matieres.length === 0) return null;

  const dense = matieres.length > SEUIL_DENSE;
  const texte = texteCouverture(couverture);
  const actif = interactif ? survol : null;

  // Phrase sur les gros plans : seulement en rendu mixte et si au moins une
  // matière en a un ; « lorsque l'image le permet » si certaines n'en ont pas.
  const nbGrosPlans = rendu === "mixte" ? matieres.filter((m) => !estPetite(m)).length : 0;
  const texteZoom =
    nbGrosPlans === 0
      ? null
      : `Dans la palette, chaque matière est présentée en entier, puis en détail agrandi ×${ZOOM_DETAIL}${
          nbGrosPlans < matieres.length ? " lorsque l'image le permet" : ""
        }.`;

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
                    <Pastille m={m} survolee={actif === m.cle} carreMm={rendu === "mixte" ? carres.get(m.cle) ?? null : null} />
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
            const m = b.matiere;
            const source = m.url_maitre || m.url_vignette;
            // Rendu naturel : toujours en échantillons répétés à taille fixe.
            // Rendu étiré : image agrandie, sauf si elle est trop petite (motif).
            const petite = estPetite(m);
            const repetee = rendu === "naturel" || (rendu === "etire" && petite);
            const tuile = rendu === "naturel" ? TAILLE_ECHANTILLON : `${m.cote}px`;
            return (
              <div
                key={b.matiere.cle}
                className={`mbp-bloc${actif === b.matiere.cle ? " on" : ""}`}
                onMouseEnter={entrer(b.matiere.cle)}
                onMouseLeave={sortir}
                style={{
                  left: `${b.x}%`,
                  top: `${b.y}%`,
                  // +0.15 % : évite les filets blancs d'arrondi entre deux blocs —
                  // sauf sur les bords du panneau, où le débord rognerait le contour.
                  width: `${b.x + b.w < 99.9 ? b.w + 0.15 : 100 - b.x}%`,
                  height: `${b.y + b.h < 99.9 ? b.h + 0.15 : 100 - b.y}%`,
                  backgroundColor: m.hex || "#ddd",
                  ...(repetee
                    ? {
                        backgroundImage: `url("${urlCdn(source, 600) || source}")`,
                        backgroundRepeat: "repeat",
                        backgroundSize: `${tuile} ${tuile}`,
                      }
                    : {}),
                }}
              >
                {rendu === "etire" && !repetee ? <img src={urlCdn(source, 1200) || source} alt="" /> : null}
                {rendu === "mixte" ? <CarteEchantillon source={source} w={b.w} h={b.h} petite={petite} /> : null}
              </div>
            );
          })}
        </div>
      </div>

      {(texte || texteZoom || mention) && (
        <div className="mbp-pied">
          {texte ? <div>{texte}</div> : null}
          {texteZoom ? <div>{texteZoom}</div> : null}
          {mention ? (
            <div>Teintes et matières présentées à titre indicatif, non contractuelles : le rendu varie selon l&apos;écran, l&apos;impression et les lots de fabrication. Échantillons disponibles dans notre exposition.</div>
          ) : null}
        </div>
      )}
    </div>
  );
}

// Image maître trop petite pour être agrandie sans flou (taille connue via SQL 032).
function estPetite(m: MatiereMoodboard): boolean {
  return typeof m.cote === "number" && m.cote > 0 && m.cote < COTE_MIN_ETIREE;
}

// Géométrie de la carte d'échantillon d'un bloc (rendu mixte), en mm réels.
// Partagée par le bloc ET par sa pastille, pour qu'ils aient la même échelle.
function geometrieCarte(w: number, h: number) {
  const lMm = (w / 100) * PALETTE_L_MM;
  const hMm = (h / 100) * PALETTE_H_MM;
  const horizontal = lMm >= hMm;
  // Côté du carré : la petite dimension, sans dépasser la moitié de la grande.
  const coteMm = horizontal ? Math.min(hMm, lMm / 2) : Math.min(lMm, hMm / 2);
  const partCarre = horizontal ? (coteMm / lMm) * 100 : (coteMm / hMm) * 100;
  return { horizontal, coteMm, partCarre };
}

// Grossissement de la pastille au survol (doit rester égal au scale() du CSS).
const ECHELLE_SURVOL = 2.4;

// Pastille = reflet exact de son bloc de palette (rendu mixte) :
//   • au repos  : la même image que le carré « matière entière », en rond ;
//   • au survol : le gros plan ×ZOOM_DETAIL, comme la 2e partie du bloc.
// Image trop petite : pas de gros plan dans la palette → pas de zoom ici non plus.
// Les deux images sont chargées d'avance (2 calques) : bascule sans attente.
// La pastille n'est PAS le carré réduit (une toile fine y deviendrait une
// bouillie grise) : c'est une FENÊTRE sur le carré, à la même échelle — l'image
// est dimensionnée à la taille réelle du carré (carreMm) et centrée, la
// pastille n'en montre que le centre. Idem pour le gros plan au survol, en
// compensant le grossissement de la pastille.
function Pastille({ m, survolee, carreMm }: { m: MatiereMoodboard; survolee: boolean; carreMm: number | null }) {
  const source = m.url_maitre || m.url_vignette;
  const entiere = urlCdn(source, 600) || source;
  const detail = urlCdn(source, 1200) || source;
  const zoom = !estPetite(m);
  const tailleRepos = carreMm ? `${carreMm}mm ${carreMm}mm` : "cover";
  const tailleZoom = carreMm
    ? `${(carreMm * ZOOM_DETAIL) / ECHELLE_SURVOL}mm ${(carreMm * ZOOM_DETAIL) / ECHELLE_SURVOL}mm`
    : `${ZOOM_DETAIL * 100}%`;
  return (
    <div
      role="img"
      aria-label={m.nom}
      className={`mbp-rond${(clarte(m.hex) ?? 0) > CLARTE_CERCLE_GRIS ? " mbp-rond-clair" : ""}`}
      style={{ backgroundColor: m.hex || "#eee" }}
    >
      <span className="mbp-rond-calque" style={{ backgroundImage: `url("${entiere}")`, backgroundSize: tailleRepos }} />
      {zoom ? (
        <span
          className="mbp-rond-calque mbp-rond-zoom"
          style={{ backgroundImage: `url("${detail}")`, backgroundSize: tailleZoom, opacity: survolee ? 1 : 0 }}
        />
      ) : null}
    </div>
  );
}

// Rendu mixte : un carré « matière entière » + le reste en gros plan.
// w, h en % du panneau de palette ; on repasse en mm pour tracer un vrai carré.
// Image trop petite (petite = true) : pas de gros plan flou, la matière
// entière est répétée à la même échelle dans le reste du bloc.
function CarteEchantillon({ source, w, h, petite }: { source: string; w: number; h: number; petite: boolean }) {
  const { horizontal, coteMm, partCarre } = geometrieCarte(w, h);
  const entiere = urlCdn(source, 600) || source;
  const detail = urlCdn(source, 1200) || source;
  return (
    <div className={`mbp-carte ${horizontal ? "mbp-carte-h" : "mbp-carte-v"}`}>
      <div className="mbp-entiere" style={horizontal ? { width: `${partCarre}%` } : { height: `${partCarre}%` }}>
        <img src={entiere} alt="" />
      </div>
      {petite ? (
        <div
          className="mbp-detail"
          style={{
            backgroundImage: `url("${entiere}")`,
            backgroundRepeat: "repeat",
            backgroundSize: `${coteMm}mm ${coteMm}mm`,
          }}
        />
      ) : (
        <div className="mbp-detail">
          <img src={detail} alt="" style={{ transform: `scale(${ZOOM_DETAIL})` }} />
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
.mbp-bloc.on { z-index: 2; }
.mbp-bloc.on::after { content: ""; position: absolute; inset: 0; border: 2px solid #000; pointer-events: none; z-index: 3; }
.mbp-rond-clair { box-shadow: 0 0 0 1px #d4d4d4; }
.mbp-rond { overflow: hidden; }
.mbp-rond-calque { position: absolute; inset: 0; border-radius: 50%; background-position: center; background-repeat: no-repeat; }
.mbp-rond-zoom { transition: opacity .2s; }
.mbp-carte { position: absolute; inset: 0; display: flex; }
.mbp-carte-h { flex-direction: row; }
.mbp-carte-v { flex-direction: column; }
.mbp-entiere { flex: 0 0 auto; overflow: hidden; }
.mbp-carte-h .mbp-entiere { height: 100%; }
.mbp-carte-v .mbp-entiere { width: 100%; }
.mbp-detail { flex: 1 1 auto; overflow: hidden; position: relative; }
.mbp-detail img { position: absolute; inset: 0; transform-origin: center; }
.mbp-hl .mbp-item { opacity: .35; }
.mbp-hl .mbp-item.on { opacity: 1; }
.mbp-hl .mbp-bloc { opacity: .25; }
.mbp-hl .mbp-bloc.on { opacity: 1; }
.mbp-item.on .mbp-rond { transform: scale(${ECHELLE_SURVOL}); z-index: 5; }
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
@media print { .mbp-item, .mbp-bloc { opacity: 1 !important; } .mbp-rond, .mbp-texte { transform: none !important; } .mbp-bloc.on::after { display: none; } .mbp-rond-zoom { opacity: 0 !important; } }
`;
