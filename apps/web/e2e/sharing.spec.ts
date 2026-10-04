import { expect, test } from '@playwright/test';
import { API_URL, establishSession, freshEmail } from './_session.js';

/**
 * ADR-0057 in a browser: the roles screen, the read-only link (on, read signed out, off), and
 * "Make a copy" from the thesis list.
 */

async function signedInWithThesis(
  page: import('@playwright/test').Page,
  request: import('@playwright/test').APIRequestContext,
  label: string,
  title: string,
) {
  const session = await establishSession(request, freshEmail(label));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title, entryPath: 'A_TOPIC' },
  });
  return { cookie, doc: (await created.json()) as { id: string; firstChapterId: string } };
}

test('the owner turns on a read-only link, a stranger reads it, and it dies when turned off', async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(120_000);
  const title = `Linked thesis ${Date.now()}`;
  const { doc } = await signedInWithThesis(page, request, 'share-link', title);

  await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
  const editor = page.locator('.thesis-editor');
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await editor.locator('p').first().click();
  await page.keyboard.type('Rainfall in the district fell by a fifth between 2001 and 2020.');
  // Let autosave land before anyone reads it.
  await page.waitForTimeout(3_000);

  await page.getByTestId('share-button').click();
  await expect(page.getByTestId('share-list')).toContainText('Owner');
  await page.getByTestId('share-link-on').click();
  const url = await page.getByTestId('share-link-url').inputValue();
  expect(url).toContain('/read/');

  // Someone with no account at all.
  const stranger = await browser.newContext();
  const reader = await stranger.newPage();
  await reader.goto(url);
  await expect(reader.getByTestId('read-title')).toHaveText(title);
  await expect(reader.getByTestId('read-chapter')).toContainText('Rainfall in the district');
  await expect(reader.locator('textarea, [contenteditable="true"]')).toHaveCount(0);

  await page.getByTestId('share-link-off').click();
  await expect(page.getByTestId('share-link-on')).toBeVisible();
  await reader.reload();
  await expect(reader.getByTestId('read-error')).toContainText('does not work');
  await stranger.close();
});

test('a Reader is listed with their role and the owner can change it', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const { doc } = await signedInWithThesis(page, request, 'share-role', `Roles ${Date.now()}`);
  await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
  await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 30_000 });

  await page.getByTestId('share-button').click();
  await page.getByTestId('share-email').fill(freshEmail('reader'));
  await page.getByTestId('share-role').selectOption('READER');
  await page.getByTestId('share-send').click();
  const row = page.getByTestId('share-row').first();
  await expect(row).toContainText('can read');
  await row.getByTestId('share-row-role').selectOption('GUIDE');
  await expect(row).toContainText('can comment and suggest');
});

test('Make a copy from the thesis list puts "Copy of …" at the top', async ({ page, request }) => {
  test.setTimeout(120_000);
  const title = `Copyable ${Date.now()}`;
  await signedInWithThesis(page, request, 'copy', title);
  await page.goto('/app');
  const card = page.locator('li', { hasText: title }).first();
  await card.getByText('More', { exact: true }).click();
  await card.getByTestId('copy-thesis').click();
  await expect(page.getByText(`Copy of ${title}`)).toBeVisible({ timeout: 15_000 });
});
