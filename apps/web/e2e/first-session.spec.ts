import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { establishSession, freshEmail } from './_session.js';
import { setUpQuickly, writeFirstLine } from './_setup.js';

/**
 * A first session without a queue — ADR-0070, set up in the editor since ADR-0145.
 *
 * The progress line above the page (driven here by a route-mocked `/sources/progress`, so the
 * spec does not depend on live indexes) and the next-step guide, which waits while the setup card
 * is open and takes over once it is finished. The real timings are measured separately by
 * `e2e/_measure`.
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
  test.setTimeout(180_000);
  await signIn(page, request, 'first-session');

  // Searching until the line is looked at, then reading, then ready — one answer per poll.
  const answers = [
    { searching: true, found: 0, ready: 0, reading: 0 },
    { searching: false, found: 5, ready: 0, reading: 5 },
    { searching: false, found: 5, ready: 5, reading: 0 },
  ];
  // By time, not by request: the editor may ask more than once a poll (a library event, a remount).
  let first = 0;
  await page.route('**/api/v1/documents/*/sources/progress', (route) => {
    const step = first ? Math.min(Math.floor((Date.now() - first) / 4_000), answers.length - 1) : 0;
    return route.fulfill({ json: answers[step] });
  });

  await page.goto('/app');
  const form = page.getByTestId('new-thesis-form');
  await expect(form).toBeVisible({ timeout: 30_000 });
  await form.getByLabel('Working title').fill('Fish drying losses in coastal Kerala villages');
  // Enter starts writing (ADR-0070); ADR-0145: the editor opens with the setup card.
  await form.getByLabel('Working title').press('Enter');
  await expect(page).toHaveURL(/\/write\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('setup-title-input')).toHaveValue(
    'Fish drying losses in coastal Kerala villages',
  );
  // ADR-0145: one guide at a time — the four-step guide waits for the card.
  await expect(page.getByTestId('first-session-guide')).toHaveCount(0);
  await setUpQuickly(page);
  await writeFirstLine(page, 'Fish drying loses.');

  // ADR-0137: the status line says it in a few words; Show opens the same three parts.
  first = Date.now();
  await page.getByTestId('status-line-toggle').click();
  const line = page.getByTestId('library-filling');
  await expect(line).toContainText('Finding papers on your topic');
  await expect(line).toContainText('Found 5 papers · reading 5', { timeout: 10_000 });
  await expect(line).toContainText('5 papers ready', { timeout: 10_000 });
  await expect(page.getByTestId('status-line-text')).toContainText('5 papers found');
  await expect(page.getByTestId('status-line-text')).toContainText('5 ready to cite');

  const guide = page.getByTestId('first-session-guide');
  await expect(guide.locator('[aria-current="step"]')).toHaveAttribute('data-step', 'write');
  await page.keyboard.press('Escape');
  await page.locator('.thesis-editor p').first().click();
  await page.keyboard.press('End');
  await page.keyboard.type(' A fifth of the catch is lost every season in the coastal villages.');
  await expect(guide.locator('[aria-current="step"]')).toHaveAttribute('data-step', 'suggest');
  await expect(guide.locator('[data-step="write"]')).toHaveAttribute('data-done', 'true');

  // Hidden for good on this thesis.
  await guide.getByRole('button', { name: 'Hide' }).click();
  await expect(guide).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('first-session-guide')).toHaveCount(0);
});
