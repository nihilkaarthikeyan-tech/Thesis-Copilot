/**
 * The first minutes of a new student — 2026-10-04 journey audit. Each assertion is a place a new
 * student used to get stuck: creating a thesis led nowhere, the editor had no focus so Ctrl+/ did
 * nothing, asking in a heading failed silently, an empty library pointed at the wrong screen, and
 * the Sources page had no way back to writing.
 */

import { expect, test } from '@playwright/test';
import { API_URL, establishSession, freshEmail } from './_session';

test('a new thesis opens its proposal; a new chapter is ready to write and says how to cite', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const s = await establishSession(request, freshEmail('journey'));
  await page
    .context()
    .addCookies([{ name: s.cookieName, value: s.cookieValue, domain: 'localhost', path: '/' }]);

  // Create from the list: it goes straight on.
  await page.goto('/app');
  await page.getByLabel('Working title').fill(`Journey ${Date.now()}`);
  await page.getByRole('button', { name: 'Create thesis' }).click();
  await expect(page).toHaveURL(/\/app\/d\/[0-9a-f-]{36}\/proposal$/, { timeout: 20_000 });
  const documentId = /\/app\/d\/([0-9a-f-]{36})\//.exec(page.url())?.[1] ?? '';

  const doc = (await (
    await request.get(`${API_URL}/api/v1/documents/${documentId}`, {
      headers: { cookie: `${s.cookieName}=${s.cookieValue}` },
    })
  ).json()) as { chapters: Array<{ id: string }> };
  await page.goto(`/app/d/${documentId}/write/${doc.chapters[0]?.id}`);

  // The cursor is already in the empty paragraph: typing goes into the chapter.
  const editor = page.locator('.thesis-editor');
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await page.keyboard.type('Typed without clicking first.');
  await expect(editor.locator('p').first()).toContainText('Typed without clicking first.');

  // A visible Suggest button exists, and the legend names Draft and @.
  await expect(page.getByTestId('suggest-button')).toBeVisible();
  await expect(page.getByText('draft a section')).toBeVisible();

  // Asking in a heading says why instead of doing nothing. The keyboard, not a click: under load
  // a late layout shift can land a click on the paragraph below.
  await page.keyboard.press('Control+Home');
  await expect
    .poll(() =>
      page.evaluate(() => window.getSelection()?.anchorNode?.parentElement?.closest('h1') !== null),
    )
    .toBe(true);
  await page.keyboard.press('Control+/');
  await expect(page.getByTestId('notice')).toContainText('not headings');

  // An empty library offers Find papers, which opens Discover; Sources links back to writing.
  await page.getByTestId('find-papers').click();
  await expect(page).toHaveURL(/\/sources\?tab=discover$/);
  await expect(page.getByRole('button', { name: /discover literature/i })).toBeVisible({
    timeout: 20_000,
  });
  await page.getByTestId('back-to-writing').click();
  await expect(page).toHaveURL(/\/write\/[0-9a-f-]{36}$/);
});
