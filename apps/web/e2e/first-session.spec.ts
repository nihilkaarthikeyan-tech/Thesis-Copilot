import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { establishSession, freshEmail } from './_session.js';

/**
 * A first session without a queue — ADR-0070.
 *
 * The progress line above the page (driven here by a route-mocked `/sources/progress`, so the
 * spec does not depend on live indexes) and the next-step guide. The real timings are measured
 * separately by `e2e/_measure`.
 */

async function signIn(page: Page, request: APIRequestContext, prefix: string): Promise<void> {
  const session = await establishSession(request, freshEmail(prefix));
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
}

test('the editor says what the library is doing, and the guide moves the student on', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await signIn(page, request, 'first-session');

  // Searching, then reading, then ready — one answer per poll.
  const answers = [
    { searching: true, found: 0, ready: 0, reading: 0 },
    { searching: false, found: 5, ready: 0, reading: 5 },
    { searching: false, found: 5, ready: 5, reading: 0 },
  ];
  // By time, not by request: the editor may ask more than once a poll (a library event, a remount).
  let first = 0;
  await page.route('**/api/v1/documents/*/sources/progress', (route) => {
    first ||= Date.now();
    const step = Math.min(Math.floor((Date.now() - first) / 4_000), answers.length - 1);
    return route.fulfill({ json: answers[step] });
  });

  await page.goto('/app');
  const form = page.getByTestId('new-thesis-form');
  await expect(form).toBeVisible({ timeout: 30_000 });
  await form.getByLabel('Working title').fill('Fish drying losses in coastal Kerala villages');
  // Enter now starts writing (ADR-0070): the proposal is the second button.
  await form.getByLabel('Working title').press('Enter');
  // ADR-0087: the sources and structure steps, taken with their defaults.
  await page.getByTestId('setup-next').click();
  await page.getByTestId('setup-start').click();
  // ADR-0091: Smart headings ask a few questions first; this run skips them.
  await page.getByTestId('start-questions-skip').click();
  await expect(page).toHaveURL(/\/write\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 30_000 });

  // ADR-0137: the status line says it in a few words; Show opens the same three parts.
  await page.getByTestId('status-line-toggle').click();
  const line = page.getByTestId('library-filling');
  await expect(line).toContainText('Finding papers on your topic');
  await expect(line).toContainText('Found 5 papers · reading 5', { timeout: 10_000 });
  await expect(line).toContainText('5 papers ready', { timeout: 10_000 });
  await expect(page.getByTestId('status-line-text')).toContainText('5 papers found');
  await expect(page.getByTestId('status-line-text')).toContainText('5 ready to cite');

  const guide = page.getByTestId('first-session-guide');
  await expect(guide.locator('[aria-current="step"]')).toHaveAttribute('data-step', 'write');
  await page.locator('.thesis-editor p').first().click();
  await page.keyboard.type(
    'Fish drying in coastal villages loses a fifth of the catch every season.',
  );
  await expect(guide.locator('[aria-current="step"]')).toHaveAttribute('data-step', 'suggest');
  await expect(guide.locator('[data-step="write"]')).toHaveAttribute('data-done', 'true');

  // Hidden for good on this thesis.
  await guide.getByRole('button', { name: 'Hide' }).click();
  await expect(guide).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('first-session-guide')).toHaveCount(0);
});
