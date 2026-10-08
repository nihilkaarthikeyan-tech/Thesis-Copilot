import { expect, test } from '@playwright/test';
import { docxEntry } from './_docx.js';
import { type LayoutFault, measureLayout, settle } from './_layout.js';
import { API_URL, establishSession, freshEmail } from './_session.js';

/**
 * R27 (ADR-0121): one export dialog. A preset changes the preview at once, the file matches what
 * the preview said, the dialog fits the screen at five widths, and the submission page opens the
 * same dialog for the whole thesis.
 */
test('the export dialog: presets change the preview, the file matches, it fits every width', async ({
  page,
  request,
}) => {
  test.setTimeout(300_000);
  const session = await establishSession(request, freshEmail('export-dialog'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: `Export dialog ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  const doc = (await created.json()) as { id: string; firstChapterId: string };
  const chapter = (await (
    await request.get(`${API_URL}/api/v1/chapters/${doc.firstChapterId}`, { headers: { cookie } })
  ).json()) as { version: number };
  await request.put(`${API_URL}/api/v1/chapters/${doc.firstChapterId}`, {
    headers: { cookie },
    data: {
      baseVersion: chapter.version,
      content: {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 1 },
            content: [{ type: 'text', text: 'Introduction' }],
          },
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Night-time heat keeps outdoor workers from recovering.' },
            ],
          },
        ],
      },
    },
  });

  const found: Array<{ where: string } & LayoutFault> = [];
  for (const width of [1440, 1280, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
    await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 30_000 });
    await settle(page);
    await page.getByTestId('open-export').click();
    const dialog = page.getByTestId('export-dialog');
    await expect(dialog.getByTestId('layout-preview')).toBeVisible({ timeout: 20_000 });
    await dialog.getByTestId('export-advanced').locator('summary').click();
    const box = await dialog.boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= width, `${width} dialog inside`).toBe(true);
    for (const fault of await page.evaluate(measureLayout, false)) {
      found.push({ where: `${width} export dialog`, ...fault });
    }
    await page.keyboard.press('Escape');
  }
  expect(
    found,
    found
      .map((f) => `${f.where}: ${f.kind} ${f.by ?? ''}px ${f.el ?? ''} in ${f.box ?? ''}`)
      .join('\n'),
  ).toEqual([]);

  // A preset changes the preview at once.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByTestId('open-export').click();
  const preview = page.getByTestId('layout-preview');
  await expect(preview.locator('[data-columns="1"]')).toBeVisible();
  await page.getByTestId('export-preset-two-column').check();
  await expect(preview.locator('[data-columns="2"]')).toBeVisible();
  await page.getByTestId('export-advanced').locator('summary').click();
  await page.getByTestId('export-paper').selectOption('Letter');
  await expect(preview.locator('[data-paper="Letter"]')).toBeVisible();

  // …and the file matches: two columns, Letter paper.
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/export') && r.request().method() === 'POST',
  );
  await page.getByTestId('export-download').click();
  const result = await response;
  expect(result.ok()).toBe(true);
  const { url } = (await result.json()) as { url: string };
  const xml = docxEntry(Buffer.from(await (await request.get(url)).body()), 'word/document.xml');
  expect(xml).toMatch(/<w:cols [^>]*w:num="2"/);
  expect(xml).toContain('w:w="12240"');
  await expect(page.getByTestId('export-link')).toBeVisible();

  // The whole thesis: a title page and contents in the preview; a non-template layout is said so.
  await page.getByTestId('export-scope-thesis').check();
  await expect(page.getByTestId('export-not-template')).toBeVisible();
  await page.getByTestId('export-preset-thesis').check();
  await expect(page.getByTestId('export-not-template')).toHaveCount(0);
  await expect(page.getByTestId('preview-pager')).toContainText('of 3');
  await page.keyboard.press('Escape');

  // The submission page opens the same dialog, for the whole thesis.
  await page.goto(`/app/d/${doc.id}/submit`);
  await page.getByTestId('open-export').click();
  await expect(page.getByTestId('export-dialog').getByTestId('layout-preview')).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByTestId('export-format-latex')).toBeVisible();
  await expect(page.getByTestId('export-scope-chapter')).toHaveCount(0);
});
