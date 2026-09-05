import { defineConfig } from 'vitest/config';

/**
 * Unit tests for the web app. `e2e/` belongs to Playwright (see playwright.config.ts) and must be
 * excluded here, or Vitest loads those specs and fails on Playwright's own `test()`.
 */
export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],
    environment: 'node',
  },
});
