import { expect, test } from '@playwright/test';
import { API_URL, establishSession, freshEmail } from './_session.js';

/** The open chapter's headings under its name, live (2026-10-04, Jenni study row 73). */
test('a heading typed in the chapter is listed beside it, and pressing it goes there', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const session = await establishSession(request, freshEmail('contents'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: `Contents ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  const doc = (await created.json()) as { id: string; firstChapterId: string };

  await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
  const editor = page.locator('.thesis-editor');
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await editor.locator('p').first().click();
  await page.keyboard.type('## Study area');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Two districts of Tamil Nadu.');
  await page.keyboard.press('Enter');
  await page.keyboard.type('### Rainfall');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Rainfall fell by a fifth.');

  const contents = page.getByTestId('chapter-contents');
  await expect(contents.getByTestId('section-go')).toHaveText(['Study area', 'Rainfall']);
  await contents.getByRole('button', { name: 'Study area', exact: true }).click();
  // The cursor is now in that heading: what is typed lands there.
  await page.keyboard.press('End');
  await page.keyboard.type(' and data');
  await expect(editor.getByRole('heading', { name: 'Study area and data' })).toBeVisible();
  await expect(contents.getByTestId('section-go').first()).toHaveText('Study area and data');
});
