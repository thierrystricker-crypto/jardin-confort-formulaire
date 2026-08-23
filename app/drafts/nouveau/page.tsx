// app/drafts/nouveau/page.tsx
//
// Mode CRÉATION d'un brouillon.
// Toute la logique du formulaire est dans le composant partagé DraftFormulaire,
// pour éviter la duplication avec /drafts/[slug]/editer/page.tsx.
//
// Au premier save, DraftFormulaire fera un POST /api/drafts puis basculera
// l'URL vers /drafts/[slug]/editer via router.replace() — sans remount.

import DraftFormulaire from "../_components/DraftFormulaire";
// Note 23.08.2026 : ReleaseNotesPopup a été déplacé sur le dashboard — les
// nouveautés annoncées portent surtout sur des pages qu'on atteint depuis là.
import OnboardingDraftPopup from "@/components/OnboardingDraftPopup";

export default function DraftNouveauPage() {
  return (
    <>
      <OnboardingDraftPopup />
      <DraftFormulaire />
    </>
  );
}
