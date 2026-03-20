import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  async redirects() {
    return [
      {
        source: '/scan',
        destination: '/public/scan/image',
        permanent: true,
      },
      {
        source: '/scan/:id',
        destination: '/public/scan/:id',
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
