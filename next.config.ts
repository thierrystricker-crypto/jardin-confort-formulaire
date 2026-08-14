import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
