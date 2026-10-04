import { expect, test } from '@playwright/test';
import { API_URL, establishSession, freshEmail } from './_session.js';

/** A student can comment on their own text (2026-10-04, from the Jenni study). */
test('a student leaves a comment on a passage and finds it under Review', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const session = await establishSession(request, freshEmail('own-comment'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: `Own comment ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  const doc = (await created.json()) as { id: string; firstChapterId: string };

  await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
  const editor = page.locator('.thesis-editor');
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await editor.locator('p').first().click();
  await page.keyboard.type('Rainfall in the district fell by a fifth between 2001 and 2020.');
  await page.keyboard.press('Shift+Home');

  await page.getByTestId('comment-on-selection').click();
  await page.getByLabel('Your comment on the selected text').fill('Check against the IMD series');
  await page.getByRole('button', { name: 'Save comment' }).click();
  await expect(page.getByTestId('notice')).toContainText('Comment added');

  await page.getByRole('tab', { name: 'review', exact: true }).click();
  await expect(page.getByText('Check against the IMD series')).toBeVisible({ timeout: 15_000 });
});
