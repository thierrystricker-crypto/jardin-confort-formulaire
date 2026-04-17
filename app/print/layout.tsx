// app/print/layout.tsx
// Layout minimaliste pour toutes les pages d'impression
// Pas de nav, pas de topbar — juste le document blanc

export const metadata = {
  title: "Jardin-Confort — Impression",
};

export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>{`
          *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
          html, body { background: white; font-family: 'Helvetica Neue', Arial, sans-serif; }
          @media screen {
            body { padding: 20px; max-width: 794px; margin: 0 auto; }
          }
          @media print {
            @page { size: A4 portrait; margin: 12mm; }
            body { padding: 0; }
          }
        `}</style>
      </head>
      <body>{children}</body>
    </html>
  );
}

import React from "react";