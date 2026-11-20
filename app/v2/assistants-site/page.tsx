// app/v2/assistants-site/page.tsx
// Dashboard 2.0 — « Assistants du site » (20.11.2026).
// Consultation (lecture seule) des journaux anonymes de jardi-chat-public et
// de jardi-filtre (Supabase webshop), via GET /api/assistants-site.
import type { Metadata } from "next";
import AssistantsApp from "./AssistantsApp";

export const metadata: Metadata = {
  title: "Assistants du site",
};

export default function Page() {
  return <AssistantsApp />;
}
