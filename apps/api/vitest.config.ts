import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // NestJS relies on emitDecoratorMetadata, which esbuild does not implement. SWC does.
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/**/*.spec.ts'],
    environment: 'node',
    disableConsoleIntercept: true,
    // The cap concurrency test starts a Postgres container.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    /**
     * Most of these files boot their own Postgres, Redis and MinIO through Testcontainers, so the
     * worker count is really "how many three-container stacks exist at once". Left at the core
     * count, a CI runner ends up asking the Docker daemon for a dozen at a time and it answers
     * `503 Service Unavailable` — which surfaces as one arbitrary spec file failing to start,
     * looking nothing like a resource limit.
     *
     * Three is enough to keep the suite around three minutes and few enough that the daemon keeps
     * up. A developer machine with more headroom can raise it: `VITEST_MAX_WORKERS=6 pnpm test`.
     */
    maxWorkers: Number(process.env.VITEST_MAX_WORKERS ?? 3),
  },
});
