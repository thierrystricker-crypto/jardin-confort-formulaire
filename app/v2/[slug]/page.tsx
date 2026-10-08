"use client";
// app/v2/[slug]/page.tsx
// Dashboard 2.0 — fiche offre / commande.
//   1. En-tête v2 : nom + prénom du client et numéro du document en grand.
//   2. Dessous, la fiche v1 COMPLÈTE, inchangée (tous les boutons, l'aperçu,
//      corrections, révisions, mouvements de stock…). Phase 2 : ranger ses
//      boutons en menus Documents / Paiement / ⋯.
import FicheV1 from "@/app/dashboard/[slug]/page";
import Legacy from "@/app/v2/_components/Legacy";
import EnteteDocument from "@/app/v2/_components/EnteteDocument";

export default function Page({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <>
      <EnteteDocument />
      <Legacy>
        <FicheV1 params={params} />
      </Legacy>
    </>
  );
}
