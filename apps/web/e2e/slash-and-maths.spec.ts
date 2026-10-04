import { expect, test } from '@playwright/test';
import { API_URL, establishSession, freshEmail } from './_session.js';

/**
 * The "/" insert menu and the equation help (2026-10-04, from the Jenni study).
 */
test('"/" inserts blocks without leaving debris, and an equation can be built without LaTeX', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const session = await establishSession(request, freshEmail('slash-maths'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: `Slash ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  const doc = (await created.json()) as { id: string; firstChapterId: string };

  await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
  const editor = page.locator('.thesis-editor');
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await editor.locator('p').first().click();

  // Esc closes the menu and takes the typed "/query" with it.
  await page.keyboard.type('/tab');
  const menu = page.getByTestId('slash-menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('option').first()).toContainText('Table');
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(editor).not.toContainText('/tab');

  // Choosing an item inserts it and leaves no "/" behind.
  await page.keyboard.type('/ai');
  await expect(page.getByTestId('slash-item-aiDeclaration')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(editor.getByRole('heading', { name: 'Declaration of AI use' })).toBeVisible();
  await expect(editor).not.toContainText('/ai');

  // The equation field: an example fills it, and the preview draws it.
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.getByTestId('fmt-math').click();
  const help = page.getByTestId('math-help');
  await expect(help).toBeVisible();
  await help.getByRole('button', { name: 'Insert fraction' }).first().click();
  await expect(page.getByTestId('math-preview').locator('.katex')).toBeVisible();
  await help.getByTestId('math-cheat-sheet').locator('summary').click();
  await expect(help.getByTestId('math-cheat-sheet')).toContainText('Integral');

  // ADR-0063: described in words, written as LaTeX into the field, read back, nothing inserted yet.
  const words = help.getByTestId('math-words');
  await words.getByLabel(/describe it in words/i).fill('alpha over n');
  await words.getByRole('button', { name: 'Write it' }).click();
  await expect(help.getByTestId('math-words-reading')).toContainText('alpha over n');
  await expect(page.locator('#inline-prompt-field')).toHaveValue(String.raw`\frac{\alpha}{n}`);
  await expect(page.getByTestId('math-preview').locator('.katex')).toBeVisible();
});
