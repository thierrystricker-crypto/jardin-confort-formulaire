import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Échantillons de fibre Dedon lus par la route d'ambiance IA (fs.readFile) :
  // ils doivent être embarqués dans la fonction serverless.
  outputFileTracingIncludes: {
    "/api/planner/scenes/[id]/ambiance": ["./public/textures/dedon/**/*"],
  },
  async redirects() {
    return [
      // Le chat s'appelait /dashboard/claude avant d'être rebaptisé Jardi (14.08.2026)
      {
        source: "/dashboard/claude",
        destination: "/dashboard/jardi",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
