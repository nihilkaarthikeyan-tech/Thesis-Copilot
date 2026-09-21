import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['test/**/*.spec.ts', 'test/**/*.spec.tsx'],
    environment: 'jsdom',
    setupFiles: ['test/setup.ts'],
    disableConsoleIntercept: true,
    /**
     * The ghost-text specs drive a paced fake stream on real timers and measure the 400 ms accept
     * fade, so they are wall-clock tests. ~2 s locally, and one of them timed out at the 5 s
     * default on a CI runner that was also building three Testcontainers stacks. Fifteen seconds
     * is far outside anything the code does and still fails fast on a genuine hang.
     */
    testTimeout: 15_000,
  },
});
