import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Self-contained server bundle for the Docker image (infra/docker/Dockerfile.web).
  output: 'standalone',
  // Workspace packages ship TypeScript sources alongside dist; let Next compile them if imported.
  transpilePackages: ['@tc/config', '@tc/types', '@tc/ui'],
  poweredByHeader: false,
};

export default nextConfig;
