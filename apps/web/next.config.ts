import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript sources alongside dist; let Next compile them if imported.
  transpilePackages: ['@tc/config', '@tc/types', '@tc/ui'],
  poweredByHeader: false,
};

export default nextConfig;
