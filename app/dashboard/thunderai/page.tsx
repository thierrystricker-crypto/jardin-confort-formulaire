// app/dashboard/thunderai/page.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Historique des échanges Jardi via ThunderAI (19.08.2026) — INTÉGRÉ au chat
// Jardi le 27.08.2026 : les échanges `thunderai_echanges` apparaissent dans la
// barre latérale de /dashboard/jardi (source « ✉️ Thunderbird »), avec la même
// recherche, les mêmes aperçus, et la possibilité de CONTINUER un échange dans
// le chat. Cette page ne fait plus que rediriger ; l'API
// /api/claude/thunderai-historique reste en place.
// ─────────────────────────────────────────────────────────────────────────────

import { redirect } from "next/navigation";

export default function PageHistoriqueThunderai() {
  redirect("/dashboard/jardi?source=thunderai");
}
