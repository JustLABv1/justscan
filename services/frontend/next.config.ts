import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  async rewrites() {
    const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';
    return [
      {
        source: '/swagger/:path*',
        destination: `${api}/swagger/:path*`,
      },
      {
        source: '/api/v1/swagger/:path*',
        destination: `${api}/api/v1/swagger/:path*`,
      },
    ];
  },
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
