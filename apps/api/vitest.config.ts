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
  },
});
