// app/v2/configurateur/page.tsx
// Dashboard 2.0 — « Configurateur parasol » (21.10.2026).
// L'app elle-même (parasols, tailles, toiles, fixations Glatz, accessoires) est celle du
// site : elle est chargée depuis le thème Shopify publié (voir /api/configurateur).
import type { Metadata } from "next";
import ConfigurateurApp from "./ConfigurateurApp";

export const metadata: Metadata = {
  title: "Configurateur parasol",
};

export default function Page() {
  return <ConfigurateurApp />;
}
