"use client";
// app/v2/clients/[id]/page.tsx
// Dashboard 2.0 — fiche client v1 montée telle quelle dans la coquille v2.
import PageV1 from "@/app/dashboard/clients/[id]/page";
import Legacy from "@/app/v2/_components/Legacy";

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Legacy>
      <PageV1 params={params} />
    </Legacy>
  );
}
