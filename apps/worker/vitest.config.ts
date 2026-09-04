import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],
    environment: 'node',
    disableConsoleIntercept: true,
    testTimeout: 120_000,
    hookTimeout: 180_000,
  },
});
