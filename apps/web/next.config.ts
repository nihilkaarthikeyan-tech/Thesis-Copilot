import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Self-contained server bundle for the Docker image (infra/docker/Dockerfile.web).
  output: 'standalone',
  // Workspace packages ship TypeScript sources alongside dist; let Next compile them if imported.
  transpilePackages: ['@tc/config', '@tc/types', '@tc/ui'],
  poweredByHeader: false,
  // The development "N" badge sits bottom-left, which is where the editor's bar puts "Chapters" on
  // a phone; every other corner covers a real control too. It only ever exists under `next dev`,
  // and it was intercepting taps in the mobile specs. Build and runtime errors still show.
  devIndicators: false,
};

export default nextConfig;
