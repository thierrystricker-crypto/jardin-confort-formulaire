// app/dashboard/[slug]/reviser/page.tsx
// Page de révision d'une commande validée.
// Monte DraftFormulaire en mode révision (revisionMode + commandeSlug).
// Le formulaire hydrate depuis la commande et sauvegarde via /api/offres/[slug]/reviser.

import DraftFormulaire from "@/app/drafts/_components/DraftFormulaire";

export default async function ReviserCommandePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <DraftFormulaire revisionMode commandeSlug={slug} />;
}