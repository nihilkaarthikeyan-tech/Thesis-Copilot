/**
 * R35 (ADR-0118) — the Keyboard shortcuts window lists the keys and the Markdown, and the
 * Markdown works when typed. Checked at a desktop width and on a 390 px phone.
 */

import { expect, type Page, test } from '@playwright/test';
import { API_URL, establishSession, freshEmail } from './_session';

async function open(page: Page, request: Parameters<typeof establishSession>[0]) {
  const s = await establishSession(request, freshEmail('shortcuts'));
  await page
    .context()
    .addCookies([{ name: s.cookieName, value: s.cookieValue, domain: 'localhost', path: '/' }]);
  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie: `${s.cookieName}=${s.cookieValue}` },
    data: { title: `Shortcuts ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  const doc = (await created.json()) as { id: string; firstChapterId: string };
  await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
  await expect(page.locator('.ProseMirror.thesis-editor')).toBeVisible({ timeout: 20_000 });
}

for (const width of [1280, 390]) {
  test(`the shortcuts window lists keys and Markdown, and fits at ${width} px`, async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 844 });
    await open(page, request);

    await page.getByTestId('keyboard-shortcuts-button').click();
    const dialog = page.getByTestId('keyboard-shortcuts');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Ask for a suggestion at the cursor');
    await dialog.getByTestId('shortcuts-tab-markdown').click();
    const list = dialog.getByTestId('shortcuts-markdown');
    await expect(list).toContainText('Section heading');
    await expect(list).toContainText('**bold**');

    const box = await dialog.boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= width).toBe(true);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });
}

test('the listed Markdown turns into formatting as it is typed', async ({ page, request }) => {
  test.setTimeout(120_000);
  await open(page, request);
  const editor = page.locator('.ProseMirror.thesis-editor');
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('## Methods');
  await expect(editor.locator('h2', { hasText: 'Methods' })).toBeVisible();
  await page.keyboard.press('Enter');
  await page.keyboard.type('This is **firm** ground.');
  await expect(editor.locator('strong', { hasText: 'firm' })).toBeVisible();
  await page.keyboard.press('Enter');
  await page.keyboard.type('- one');
  await expect(editor.locator('ul li', { hasText: 'one' })).toBeVisible();
});
