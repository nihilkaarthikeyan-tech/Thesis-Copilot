import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],
    environment: 'node',
    disableConsoleIntercept: true,
    // citeproc compiles a CSL stylesheet per style, and `render.spec.ts` walks all 22. Alone that
    // is ~4 s; under `pnpm test`, sharing cores with every other package, it crossed vitest's 5 s
    // default and failed a different case on each run. The work is CPU-bound and correct — only
    // the budget was wrong.
    testTimeout: 60_000,
  },
});
