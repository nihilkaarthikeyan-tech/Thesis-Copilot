import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright — PRD §15 (E2E) and §13.5 (CI smoke).
 *
 * Runs against an already-started web app and API; CI starts both before invoking this. Locally,
 * `pnpm dev` (or the Browser pane's `web` launch config) plus the API on :3001 is enough.
 *
 * PRD §13.5 names the smoke as "editor loads, suggestion streams against a mocked provider". The
 * editor is Phase 1 week 1 work and must not be started before Gate G0, so the Phase 0 smoke covers
 * what exists: the app shell, the sign-in screen and the API health endpoint. Week 1 (Appendix B.9
 * test 9) extends it to the editor and the ghost-text stream.
 */
export default defineConfig({
  testDir: './e2e',
  // These run against a live stack with the §12.1 rate limits in force, and the helpers wait
  // those out rather than weakening them. Thirty seconds was right when the suite was three
  // specs; a test that may legitimately sit through a limiter's window needs longer.
  timeout: 120_000,
  // Files run in parallel; the tests inside one do not. §12.1 allows twenty sign-in attempts a
  // minute per IP and sixty AI requests a minute per user, and a fully parallel suite signs in
  // once per test — enough to trip a limit that is right for the internet. Serialising within a
  // file lets each file's cached session serve all of its tests.
  fullyParallel: false,
  // Two, not one per core. Every spec file needs at least one account, and §12.1 allows twenty
  // sign-in attempts a minute per IP — a limit that is right for the internet and that a suite
  // running six files at once walks straight into. Two workers spread the sign-ins over the run.
  workers: 2,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
