import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],
    environment: 'node',
    // The §11.4 budget table is printed by the cost self-check so it lands in CI output and can be
    // pasted into docs/BUILD_LOG.md as evidence (PRD Appendix E.2, §0.3 rule 2).
    disableConsoleIntercept: true,
  },
});
