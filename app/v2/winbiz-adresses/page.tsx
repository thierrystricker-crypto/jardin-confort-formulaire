// app/v2/winbiz-adresses/page.tsx
// Dashboard 2.0 — page v1 montée telle quelle dans la coquille v2
// (mode clair via le pont de v2.css). À redessiner plus tard, ou pas.
import PageV1 from "@/app/dashboard/winbiz-adresses/page";
import Legacy from "@/app/v2/_components/Legacy";

export default function Page() {
  return (
    <Legacy>
      <PageV1 />
    </Legacy>
  );
}
