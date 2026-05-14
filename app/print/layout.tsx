// app/print/layout.tsx
// Layout minimaliste pour toutes les pages d'impression
// Pas de nav, pas de topbar — juste le document blanc
//
// IMPORTANT : pas de <html>/<head>/<body> ici. Ils existent déjà dans
// app/layout.tsx (root layout) et Next.js interdit de les redéclarer dans
// un layout enfant — sinon double <html> + erreur d'hydration React.
// Le <style> ci-dessous est hissé automatiquement dans <head> par React 19.

import React from "react";

export const metadata = {
  title: "Jardin-Confort — Impression",
};

export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <style>{`
        /* Reset local à la zone print + override du body root */
        body {
          background: white !important;
          font-family: 'Helvetica Neue', Arial, sans-serif !important;
        }
        body > * {
          box-sizing: border-box;
        }
        body *, body *::before, body *::after {
          box-sizing: border-box;
        }
        @media screen {
          body {
            padding: 20px !important;
            max-width: 794px;
            margin: 0 auto !important;
          }
        }
        @media print {
          @page { size: A4 portrait; margin: 12mm; }
          body { padding: 0 !important; }
        }
      `}</style>
      {children}
    </>
  );
}