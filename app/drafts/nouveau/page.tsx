// app/drafts/nouveau/page.tsx
//
// Mode CRÉATION d'un brouillon.
// Toute la logique du formulaire est dans le composant partagé DraftFormulaire,
// pour éviter la duplication avec /drafts/[slug]/editer/page.tsx.
//
// Au premier save, DraftFormulaire fera un POST /api/drafts puis basculera
// l'URL vers /drafts/[slug]/editer via router.replace() — sans remount.

import DraftFormulaire from "../_components/DraftFormulaire";

export default function DraftNouveauPage() {
  return <DraftFormulaire />;
}
