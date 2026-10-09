"use client";
// app/v2/_components/MenusFiche.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Dashboard 2.0 — phase 2 de la fiche : les groupes de boutons du haut de la
// fiche v1 (Documents PDF, Pages web, Navigation & contact, Outils internes)
// deviennent des MENUS déroulants.
//
// Principe : on ne recopie AUCUN bouton. Les vrais boutons de la fiche v1
// restent dans la page, avec leur logique, leurs états (« Génération… »,
// « ✓ Lien copié »), le composant Wallee, le bandeau de rappel PDF… On se
// contente de marquer leurs conteneurs (classes v2-*) et d'ouvrir / fermer le
// panneau au clic sur l'intitulé du groupe. La mise en forme est dans v2.css §7.
// Conséquence : un bouton ajouté demain dans un de ces groupes de la v1
// apparaît tout seul dans le bon menu.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect } from "react";

const ORDRE: [RegExp, string][] = [
  [/^Documents PDF/, "1"],
  [/^Pages web/, "2"],
  [/^Navigation/, "3"],
  [/^Outils internes/, "4"],
];

function appliquer() {
  const racine = document.querySelector(".v2-fiche .v2-legacy");
  if (!racine) return;
  const entetes = Array.from(racine.querySelectorAll<HTMLElement>("div.uppercase.tracking-wide")).filter(
    (h) => h.parentElement && h.parentElement.children.length >= 2 && ORDRE.some(([r]) => r.test(h.textContent?.trim() || "")),
  );
  if (!entetes.length) return;
  const top = entetes[0].closest(".rounded-2xl");
  if (!top) return;
  top.classList.add("v2-top");
  for (const h of entetes) {
    const g = h.parentElement!;
    if (!g.classList.contains("v2-groupe")) {
      g.classList.add("v2-groupe");
      const o = ORDRE.find(([r]) => r.test(h.textContent?.trim() || ""));
      if (o) g.dataset.v2Ordre = o[1];
      h.setAttribute("role", "button");
      h.setAttribute("aria-haspopup", "true");
      h.tabIndex = 0;
    }
  }
  top.querySelector("h1")?.closest(".pt-2")?.classList.add("v2-dossier");

  // Raccourci direct à côté des menus (09.10.2026) : « Page commande client »
  // ou « Page de l'offre ». C'est une COPIE du lien v1 du menu Pages web
  // (même adresse, même libellé), recréée si la v1 le change.
  const grille = top.querySelector<HTMLElement>(":scope > .grid");
  const source = top.querySelector<HTMLAnchorElement>('.v2-groupe[data-v2-ordre="2"] a[href*="/print/offre/"]');
  const existant = grille?.querySelector<HTMLAnchorElement>(":scope > a.v2-raccourci") ?? null;
  if (grille && source) {
    if (!existant || existant.getAttribute("href") !== source.getAttribute("href") || existant.textContent !== source.textContent) {
      existant?.remove();
      const copie = source.cloneNode(true) as HTMLAnchorElement;
      copie.classList.add("v2-raccourci");
      grille.appendChild(copie);
    }
  } else {
    existant?.remove();
  }
}

function fermerTout(sauf?: Element | null) {
  document.querySelectorAll(".v2-fiche .v2-groupe.v2-ouvert").forEach((g) => {
    if (g !== sauf) g.classList.remove("v2-ouvert");
  });
}

export default function MenusFiche() {
  useEffect(() => {
    let rafId = 0;
    const planifier = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(appliquer);
    };
    planifier();
    // La fiche v1 se monte après son propre chargement, et certains groupes
    // n'apparaissent qu'une fois les données connues : on ré-applique.
    const mo = new MutationObserver(planifier);
    mo.observe(document.body, { childList: true, subtree: true });

    const basculer = (entete: Element) => {
      const g = entete.parentElement;
      if (!g) return;
      const ouvrir = !g.classList.contains("v2-ouvert");
      fermerTout(g);
      g.classList.toggle("v2-ouvert", ouvrir);
    };
    const clic = (e: MouseEvent) => {
      const t = e.target as Element | null;
      const entete = t?.closest?.(".v2-fiche .v2-groupe > div:first-child");
      if (entete) {
        basculer(entete);
        return;
      }
      // Un clic DANS un panneau le laisse ouvert : les retours des boutons
      // (« Génération… », « ✓ Lien copié », état Wallee) restent visibles.
      if (!t?.closest?.(".v2-fiche .v2-groupe")) fermerTout();
    };
    const touche = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        fermerTout();
        return;
      }
      if (e.key !== "Enter" && e.key !== " ") return;
      const entete = (e.target as Element | null)?.closest?.(".v2-fiche .v2-groupe > div:first-child");
      if (entete) {
        e.preventDefault();
        basculer(entete);
      }
    };
    document.addEventListener("click", clic);
    document.addEventListener("keydown", touche);
    return () => {
      cancelAnimationFrame(rafId);
      mo.disconnect();
      document.removeEventListener("click", clic);
      document.removeEventListener("keydown", touche);
    };
  }, []);

  return null;
}
