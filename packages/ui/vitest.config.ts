import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['test/**/*.spec.ts', 'test/**/*.spec.tsx'],
    environment: 'jsdom',
    setupFiles: ['test/setup.ts'],
    disableConsoleIntercept: true,
  },
});
