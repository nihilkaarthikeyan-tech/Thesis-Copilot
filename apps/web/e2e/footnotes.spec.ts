import { expect, test } from '@playwright/test';
import { docxEntry } from './_docx.js';
import { API_URL, establishSession, freshEmail } from './_session.js';

/**
 * Footnotes (2026-09-25): inserted from the toolbar, numbered in the text, edited in place, and
 * real Word footnotes in the submitted thesis.
 */

test('a footnote is inserted, numbered, edited, and exported as a real footnote', async ({
  page,
  request,
}) => {
  test.setTimeout(150_000);
  const session = await establishSession(request, freshEmail('footnotes'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: `Footnotes ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  const doc = (await created.json()) as { id: string; firstChapterId: string };
  await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
  const editor = page.locator('.thesis-editor');
  await expect(editor).toBeVisible({ timeout: 30_000 });

  await editor.locator('p').first().click();
  await page.keyboard.type('Uptake stayed low');
  await page.getByTestId('fmt-footnote').click();
  await page
    .getByTestId('inline-prompt')
    .getByRole('textbox')
    .fill('The survey predates the 2020 subsidy.');
  await page.getByTestId('inline-prompt-apply').click();
  await page.keyboard.type(' in both districts');
  await page.getByTestId('fmt-footnote').click();
  await page.locator('#inline-prompt-field').fill('District office data.');
  await page.getByTestId('inline-prompt-apply').click();

  const refs = editor.locator('sup.footnote-ref');
  await expect(refs).toHaveCount(2);
  await expect(refs.first()).toHaveAttribute('title', 'The survey predates the 2020 subsidy.');
  // The numbers are a CSS counter, which no DOM query can read; the screenshot is the check.
  await editor.locator('p').first().screenshot({ path: 'test-results/footnotes-numbered.png' });

  // Selecting a footnote and pressing the button edits it.
  await refs.nth(1).click();
  await expect(page.getByTestId('fmt-footnote')).toHaveAccessibleName('Edit footnote');
  await page.getByTestId('fmt-footnote').click();
  await expect(page.locator('#inline-prompt-field')).toHaveValue('District office data.');
  await page
    .getByTestId('inline-prompt')
    .getByRole('textbox')
    .fill('Data from the district offices.');
  await page.getByTestId('inline-prompt-apply').click();
  await expect(refs.nth(1)).toHaveAttribute('title', 'Data from the district offices.');

  await page.keyboard.press('Control+s');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 20_000 });

  const exported = await request.post(`${API_URL}/api/v1/documents/${doc.id}/export/thesis`, {
    headers: { cookie },
    data: { format: 'docx' },
  });
  expect(exported.ok(), `export: ${exported.status()}`).toBe(true);
  const { url } = (await exported.json()) as { url: string };
  const bytes = Buffer.from(await (await request.get(url)).body());
  const body = docxEntry(bytes, 'word/document.xml');
  const notes = docxEntry(bytes, 'word/footnotes.xml');
  expect(body.match(/<w:footnoteReference w:id="\d+"\/>/g)).toHaveLength(2);
  expect(notes).toContain('The survey predates the 2020 subsidy.');
  expect(notes).toContain('Data from the district offices.');
});
