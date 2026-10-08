// app/v2/layout.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Dashboard 2.0 — « plan B » construit À CÔTÉ de /dashboard (09.10.2026).
// Rien sous app/dashboard n'est modifié. Pour abandonner : supprimer app/v2
// et app/api/v2, c'est tout. Les pages pas encore redessinées sont les pages
// v1 montées telles quelles (voir _components/Legacy.tsx).
// ─────────────────────────────────────────────────────────────────────────────

import type { Metadata } from "next";
import "./v2.css";
import V2Shell from "./_components/V2Shell";

export const metadata: Metadata = {
  title: "Dashboard",
};

export default function V2Layout({ children }: { children: React.ReactNode }) {
  return <V2Shell>{children}</V2Shell>;
}
