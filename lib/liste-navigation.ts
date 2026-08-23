"use client";
// lib/liste-navigation.ts
// Navigation des listes (dashboard, clients, délais). Deux besoins, une seule
// cause : une liste filtrée est un travail, et on le perdait à chaque clic.
//
//  1. `clicLigne` / `clicMilieuLigne` : Ctrl/Cmd/Maj+clic et clic milieu
//     ouvrent la fiche dans un nouvel onglet. La liste reste derrière, intacte.
//  2. `useFiltresMemorises` : recherche, filtres rapides et tri survivent au
//     retour arrière et au rafraîchissement, dans la limite de l'onglet.
//
// Ajouté le 23.08.2026.

import { useEffect, useRef, useState } from "react";

type ClicSouris = {
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  preventDefault: () => void;
};

/** onClick d'une ligne de liste. Ctrl/Cmd/Maj+clic → nouvel onglet. */
export function clicLigne(url: string, e: ClicSouris) {
  if (e.ctrlKey || e.metaKey || e.shiftKey) {
    e.preventDefault();
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  window.location.href = url;
}

/** onAuxClick d'une ligne de liste. Clic milieu → nouvel onglet. */
export function clicMilieuLigne(url: string, e: ClicSouris & { button: number }) {
  if (e.button !== 1) return;
  e.preventDefault();
  window.open(url, "_blank", "noopener,noreferrer");
}

/**
 * Mémorise les filtres d'une liste et les restaure au montage.
 *
 * `valeurs` est l'objet à mémoriser (recréé à chaque rendu, c'est voulu) ;
 * `restaurer` reçoit l'objet relu et applique les setState de la page. La
 * sauvegarde n'est armée qu'au rendu qui suit la restauration, pour qu'un
 * premier rendu aux valeurs par défaut n'efface pas ce qui était mémorisé.
 *
 * sessionStorage et non localStorage : la mémoire meurt avec l'onglet. On ne
 * veut pas retrouver le lendemain un filtre posé la veille sans s'en souvenir.
 */
export function useFiltresMemorises(
  cle: string,
  valeurs: Record<string, unknown>,
  restaurer: (v: Record<string, unknown>) => void,
) {
  const [arme, setArme] = useState(false);
  const restaurerRef = useRef(restaurer);
  restaurerRef.current = restaurer;

  useEffect(() => {
    try {
      const brut = window.sessionStorage.getItem(cle);
      if (brut) {
        const lu: unknown = JSON.parse(brut);
        if (lu && typeof lu === "object") {
          restaurerRef.current(lu as Record<string, unknown>);
        }
      }
    } catch {
      /* sessionStorage indisponible ou contenu illisible : on part des défauts */
    }
    setArme(true);
  }, [cle]);

  const serialise = JSON.stringify(valeurs);
  useEffect(() => {
    if (!arme) return;
    try {
      window.sessionStorage.setItem(cle, serialise);
    } catch {
      /* quota plein ou mode privé : la mémorisation est un confort, pas une preuve */
    }
  }, [arme, cle, serialise]);
}
