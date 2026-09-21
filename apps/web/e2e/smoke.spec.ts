import { expect, test } from '@playwright/test';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/**
 * Phase 0 smoke — see playwright.config.ts for why this stops short of the editor.
 */

test('home page renders and states the integrity position', async ({ page }) => {
  await page.goto('/');
  // The page has a level-1 heading and it is not empty. Deliberately not pinned to its words:
  // this asserted "Thesis Copilot" and the hero has since become a sentence about grounding,
  // which is marketing copy and will change again. What must not change is §12.3 below.
  const heading = page.getByRole('heading', { level: 1 });
  await expect(heading).toBeVisible();
  await expect(heading).not.toBeEmpty();
  // PRD §12.3: the marketing surface states the position plainly.
  await expect(page.getByText('No detector evasion')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in' }).first()).toBeVisible();
});

test('sign-in screen offers email OTP and asks for an address', async ({ page }) => {
  await page.goto('/sign-in');
  // "Sign in *or create an account*": there is one door, and the first code makes the account.
  await expect(page.getByRole('heading', { name: /Sign in/ })).toBeVisible();
  const email = page.getByLabel('University or personal email');
  await expect(email).toBeVisible();
  await expect(page.getByRole('button', { name: 'Email me a code' })).toBeDisabled();
  await email.fill('smoke@example.com');
  await expect(page.getByRole('button', { name: 'Email me a code' })).toBeEnabled();
});

test('unauthenticated /app redirects to sign-in', async ({ page }) => {
  await page.goto('/app');
  await expect(page).toHaveURL(/\/sign-in$/);
});

test('API health reports every dependency up', async ({ request }) => {
  const response = await request.get(`${API_URL}/api/v1/health`);
  expect(response.status()).toBe(200);
  const body = (await response.json()) as {
    status: string;
    checks: Record<string, { status: string }>;
  };
  expect(body.status).toBe('ok');
  // `llmProvider`, not `aiProvider`. The health controller has never called it that; this
  // assertion has been wrong for as long as it has existed, and the job that would have caught
  // it was skipped on every run.
  for (const name of ['database', 'redis', 'objectStorage', 'llmProvider', 'embeddings']) {
    expect(body.checks[name]?.status, name).toBe('up');
  }
});

test('API answers errors as RFC 9457 problem details', async ({ request }) => {
  const response = await request.get(`${API_URL}/api/v1/documents`);
  expect(response.status()).toBe(401);
  expect(response.headers()['content-type']).toContain('application/problem+json');
  const problem = (await response.json()) as { type: string; status: number; requestId?: string };
  expect(problem.type).toBe('UNAUTHORIZED');
  expect(problem.status).toBe(401);
  expect(problem.requestId).toBeTruthy();
});
