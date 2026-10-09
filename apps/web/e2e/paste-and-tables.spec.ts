import { expect, test } from '@playwright/test';
import { openFormatMore } from './_editor.js';
import { tinyPng } from './_images.js';
import { API_URL, establishSession, freshEmail } from './_session.js';

/**
 * A pasted screenshot becomes a figure, and table cells merge — both reaching the export
 * (2026-09-25). Until then the only way in for a picture was the file picker, and no exporter
 * knew what a merged cell was.
 */

test('a pasted picture becomes a figure; merged cells keep their shape in the export', async ({
  page,
  request,
}) => {
  test.setTimeout(150_000);
  const session = await establishSession(request, freshEmail('paste-tables'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: `Paste ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  const doc = (await created.json()) as { id: string; firstChapterId: string };
  await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
  const editor = page.locator('.thesis-editor');
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await editor.locator('p').first().click();
  await page.keyboard.type('A screenshot follows. ');

  // Paste, as the clipboard hands a screenshot over: a file on the event.
  const png = tinyPng().toString('base64');
  await editor.evaluate((el, b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], 'screenshot.png', { type: 'image/png' }));
    el.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    );
  }, png);
  const img = editor.locator('img');
  await expect(img).toHaveCount(1, { timeout: 30_000 });
  await expect
    .poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
    .toBe(true);

  // A table, two cells of the first row merged.
  await editor.locator('p').last().click();
  await page.getByTestId('fmt-table').click();
  const cells = editor.locator('table tr').first().locator('th, td');
  await cells.nth(0).click();
  await page.keyboard.type('Merged heading');
  await cells.nth(1).click({ modifiers: ['Shift'] });
  await openFormatMore(page);
  await page.getByTestId('fmt-merge-cells').click();
  await expect(editor.locator('table tr').first().locator('[colspan="2"]')).toHaveCount(1);
  await expect(page.getByTestId('fmt-split-cell')).toBeVisible();

  await page.keyboard.press('Control+s');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 20_000 });

  const exported = await request.post(`${API_URL}/api/v1/documents/${doc.id}/export/thesis`, {
    headers: { cookie },
    data: { format: 'html' },
  });
  expect(exported.ok(), `export: ${exported.status()}`).toBe(true);
  const { url } = (await exported.json()) as { url: string };
  const html = await (await request.get(url)).text();
  expect(html).toContain('data:image/png;base64,');
  expect(html).toMatch(/<th colspan="2">[^<]*<p>Merged heading<\/p>/);
});
