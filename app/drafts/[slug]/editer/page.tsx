// app/drafts/[slug]/editer/page.tsx
//
// Mode ÉDITION d'un brouillon existant.
// La logique de chargement (GET /api/drafts/[slug]) est dans DraftFormulaire
// via l'effet déclenché par initialSlug. Cette page se contente d'extraire
// le slug de la route et de le passer en prop.
//
// Next.js App Router : dans une page server-side, `params` est une Promise
// depuis Next 15. On l'await ici avant de rendre le composant client.

import DraftFormulaire from "../../_components/DraftFormulaire";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export default async function DraftEditerPage({ params }: PageProps) {
  const { slug } = await params;
  return <DraftFormulaire initialSlug={slug} />;
}