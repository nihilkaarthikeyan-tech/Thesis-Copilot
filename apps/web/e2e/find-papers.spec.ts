import { expect, test } from '@playwright/test';
import { API_URL, establishSession, freshEmail } from './_session.js';

/**
 * Find papers beside the text (2026-10-04, from the Jenni study): search from the editor, add a
 * result to the library, and cite it at the cursor once it is ready — without leaving the chapter.
 */
test('a paper can be found, added and cited without leaving the chapter', async ({
  page,
  request,
}) => {
  test.setTimeout(300_000);
  const session = await establishSession(request, freshEmail('find-papers'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: 'Protein structure prediction with deep learning', entryPath: 'A_TOPIC' },
  });
  const doc = (await created.json()) as { id: string; firstChapterId: string };

  await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
  const editor = page.locator('.thesis-editor');
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await editor.locator('p').first().click();
  await page.keyboard.type('Deep learning changed protein structure prediction ');

  await page.getByRole('tab', { name: 'papers', exact: true }).click();
  const panel = page.getByTestId('find-papers');
  // The thesis title is offered as the first search.
  await panel
    .getByRole('button', { name: 'Protein structure prediction with deep learning' })
    .click();
  const results = panel.getByTestId('paper-result');
  await expect(results.first()).toBeVisible({ timeout: 60_000 });

  // Under a result, the abstract's sentence that matches the search, with the searched words in
  // bold (coverage-map row 23). Every word in bold is a form of one of the query's.
  const passage = panel.getByTestId('paper-passage').first();
  await expect(passage).toContainText('From the abstract');
  const marked = await passage.locator('strong').allTextContents();
  expect(marked.length).toBeGreaterThan(0);
  const stems = ['protein', 'structur', 'predict', 'deep', 'learn'];
  for (const word of marked) {
    expect(stems.some((stem) => word.toLowerCase().startsWith(stem))).toBe(true);
  }

  await results.first().getByTestId('paper-add').click();
  const cite = results.first().getByTestId('paper-cite');
  await expect(cite).toBeVisible({ timeout: 120_000 });

  // Put the cursor back at the end of the sentence, then cite there.
  await editor.locator('p').first().click();
  await page.keyboard.press('End');
  await cite.click();
  await expect(editor.locator('[data-type="citation"], .citation').first()).toBeVisible({
    timeout: 15_000,
  });
});
