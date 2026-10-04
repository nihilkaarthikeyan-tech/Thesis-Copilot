import { expect, test } from '@playwright/test';
import { API_URL, establishSession, freshEmail } from './_session.js';

/**
 * Help pages, the changelog and the citation style preview (2026-10-04, from the Jenni study).
 * Help and the changelog are public; the preview is rendered by the API from an example
 * reference and labelled as one.
 */

test('help opens without signing in, and every article is reachable from it', async ({ page }) => {
  await page.goto('/help');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Help');
  const index = page.getByTestId('help-index');
  for (const title of [
    'Getting started: proposal, outline, writing',
    'Suggestions',
    'Citations and styles',
    'Your library',
    'Chat',
    'Checks before submission',
    'Working with your guide',
    'Allowances and the free trial',
    'Privacy',
  ]) {
    await expect(index.getByRole('link', { name: new RegExp(`^${title}`) })).toBeVisible();
  }
  await index.getByRole('link', { name: /^Suggestions/ }).click();
  // 20 s: in a dev-server run the article route compiles on its first visit.
  await expect(page).toHaveURL(/\/help\/[a-z-]+$/, { timeout: 20_000 });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Suggestions');
  await expect(page.getByTestId('help-article')).toContainText('Refine');

  await page.goto('/help/allowances');
  await expect(page.getByTestId('help-allowances')).toContainText('Assist suggestions');

  // The home page footer reaches both pages.
  await page.goto('/');
  await expect(page.locator('footer').getByRole('link', { name: 'Help' })).toHaveAttribute(
    'href',
    '/help',
  );
  await expect(page.locator('footer').getByRole('link', { name: 'What changed' })).toHaveAttribute(
    'href',
    '/changelog',
  );
});

test('the changelog lists releases, newest first', async ({ page }) => {
  await page.goto('/changelog');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('What changed');
  const entries = page.getByTestId('changelog-entry');
  expect(await entries.count()).toBeGreaterThan(5);
  await expect(page.getByText('v0.1.24')).toBeVisible();
});

test('the Citations tab previews the style in use, from an example reference', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const session = await establishSession(request, freshEmail('style-preview'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: `Style preview ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  const doc = (await created.json()) as { id: string; firstChapterId: string };

  await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
  await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('tab', { name: 'citations', exact: true }).click();

  const preview = page.getByTestId('style-preview');
  await expect(preview).toContainText('not a real paper', { timeout: 15_000 });
  await expect(page.getByTestId('style-preview-intext')).toHaveText('(Example & Sample, 2024)');

  // Highlighting a search result previews that style instead.
  await page.getByPlaceholder(/Search all/).fill('ieee');
  await expect(page.getByTestId('style-result').first()).toContainText('IEEE', {
    timeout: 15_000,
  });
  await page.getByTestId('style-result').first().hover();
  await expect(preview).toContainText('IEEE', { timeout: 15_000 });
});

test('choosing a style for a new thesis shows its preview', async ({ page, request }) => {
  test.setTimeout(120_000);
  const session = await establishSession(request, freshEmail('start-style-preview'));
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  await page.goto('/app/new');
  await page.getByTestId('starting-style').getByText('IEEE', { exact: true }).click();
  await expect(page.getByTestId('style-preview-intext')).toHaveText('[1]', { timeout: 15_000 });
});
