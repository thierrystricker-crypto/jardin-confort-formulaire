"use client";
// app/v2/[slug]/page.tsx
// Dashboard 2.0 — fiche offre / commande.
//   1. En-tête v2 : nom + prénom du client et numéro du document en grand.
//   2. Dessous, la fiche v1 COMPLÈTE, inchangée (tous les boutons, l'aperçu,
//      corrections, révisions, mouvements de stock…).
//   3. Phase 2 (09.10.2026) : les groupes de boutons du haut deviennent des
//      menus déroulants (MenusFiche + v2.css §7) — les vrais boutons v1, pas
//      des copies.
import FicheV1 from "@/app/dashboard/[slug]/page";
import Legacy from "@/app/v2/_components/Legacy";
import EnteteDocument from "@/app/v2/_components/EnteteDocument";
import MenusFiche from "@/app/v2/_components/MenusFiche";

export default function Page({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <div className="v2-fiche">
      <EnteteDocument />
      <MenusFiche />
      <Legacy>
        <FicheV1 params={params} />
      </Legacy>
    </div>
  );
}
