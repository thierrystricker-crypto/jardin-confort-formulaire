// app/v2/emu/page.tsx
// Dashboard 2.0 — « Accords couleurs EMU » (13.11.2026).
// L'app elle-même (tables ↔ sièges de la même couleur, coussins compatibles) est celle du
// site : elle est chargée depuis le thème Shopify publié (voir /api/emu).
import type { Metadata } from "next";
import EmuApp from "./EmuApp";

export const metadata: Metadata = {
  title: "Accords couleurs EMU",
};

export default function Page() {
  return <EmuApp />;
}
