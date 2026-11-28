// app/v2/traductions/page.tsx
// Dashboard 2.0 — sentinelle des traductions DE / EN du webshop (28.11.2026) :
// page v1 montée telle quelle dans la coquille v2 (mode clair via le pont de
// v2.css). Sans cette page, /dashboard/traductions était redirigé par le proxy
// vers /v2/traductions, pris pour une fiche document introuvable.
import PageV1 from "@/app/dashboard/traductions/page";
import Legacy from "@/app/v2/_components/Legacy";

export default function Page() {
  return (
    <Legacy>
      <PageV1 />
    </Legacy>
  );
}
