// app/v2/echantillons/page.tsx
// Dashboard 2.0 — page v1 montée telle quelle dans la coquille v2.
import PageV1 from "@/app/dashboard/echantillons/page";
import Legacy from "@/app/v2/_components/Legacy";

export default function Page() {
  return (
    <Legacy>
      <PageV1 />
    </Legacy>
  );
}
