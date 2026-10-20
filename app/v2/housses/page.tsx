// app/v2/housses/page.tsx
// Dashboard 2.0 — « Trouver une housse » (20.10.2026).
// L'app elle-même (calcul, dessins, filtres Glatz / Suncomfort) est celle du
// site : elle est chargée depuis le thème Shopify publié (voir /api/housses).
import type { Metadata } from "next";
import HoussesApp from "./HoussesApp";

export const metadata: Metadata = {
  title: "Trouver une housse",
};

export default function Page() {
  return <HoussesApp />;
}
