// app/v2/_components/Legacy.tsx
// Monte une page de la version actuelle (v1) telle quelle dans la coquille v2.
// La classe `v2-legacy` active le « pont » de v2.css : en mode clair, les
// couleurs sombres codées en dur des pages v1 sont converties, sans toucher
// une seule ligne de ces pages. En mode sombre, rien ne change.

import React from "react";

export default function Legacy({ children }: { children: React.ReactNode }) {
  return <div className="v2-legacy">{children}</div>;
}
