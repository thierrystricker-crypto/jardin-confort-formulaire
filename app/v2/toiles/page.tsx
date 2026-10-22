// app/v2/toiles/page.tsx
// Dashboard 2.0 — « Toiles Glatz » (23.10.2026).
// Le nuancier lui-même (parasol, filtres, fiches, best-sellers) est celui du
// site : il est chargé depuis le thème Shopify publié (voir /api/toiles).
import type { Metadata } from "next";
import ToilesApp from "./ToilesApp";

export const metadata: Metadata = {
  title: "Toiles Glatz",
};

export default function Page() {
  return <ToilesApp />;
}
