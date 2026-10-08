"use client";
// app/v2/draft/[slug]/page.tsx
// Dashboard 2.0 — brouillon (lecture seule) v1 monté tel quel dans la coquille v2.
import PageV1 from "@/app/dashboard/draft/[slug]/page";
import Legacy from "@/app/v2/_components/Legacy";

export default function Page({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <Legacy>
      <PageV1 params={params} />
    </Legacy>
  );
}
