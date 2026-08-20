import { createMDX } from 'fumadocs-mdx/next';

/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: '/docs',
  output: 'standalone',
  // Node can resolve @swc/helpers through its module-sync export at runtime,
  // so keep the ESM helpers in the standalone trace alongside the CJS files.
  outputFileTracingIncludes: {
    '/*': [
      './node_modules/.pnpm/@swc+helpers@*/node_modules/@swc/helpers/esm/**/*',
    ],
  },
  reactStrictMode: true,
};

export default createMDX()(nextConfig);
