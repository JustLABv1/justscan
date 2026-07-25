import { createMDX } from 'fumadocs-mdx/next';

/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: '/docs',
  output: 'standalone',
  reactStrictMode: true,
};

export default createMDX()(nextConfig);
