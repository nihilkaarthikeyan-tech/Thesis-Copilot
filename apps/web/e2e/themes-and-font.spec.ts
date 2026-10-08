import { expect, test } from '@playwright/test';
import { type LayoutFault, measureLayout, settle } from './_layout.js';
import { API_URL, establishSession, freshEmail } from './_session.js';

/**
 * R33 (ADR-0120): the paper themes and the font style — chosen in Settings, held across a reload,
 * drawn in the editor, and fitting the settings page at five widths.
 */
test('paper themes and the font style apply in the editor and survive a reload', async ({
  page,
  request,
}) => {
  test.setTimeout(240_000);
  const session = await establishSession(request, freshEmail('themes-font'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: `Themes ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  const doc = (await created.json()) as { id: string; firstChapterId: string };

  const found: Array<{ where: string } & LayoutFault> = [];
  for (const width of [1440, 1280, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/app/settings');
    await settle(page);
    for (const fault of await page.evaluate(measureLayout, false)) {
      found.push({ where: `${width} settings`, ...fault });
    }
  }
  expect(found, found.map((f) => `${f.where}: ${f.kind} ${f.el ?? ''}`).join('\n')).toEqual([]);

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/app/settings');
  const html = page.locator('html');

  // Paper dark: stamped, dark ground, kept on reload.
  await page.getByTestId('theme-select').selectOption('paper-dark');
  await expect(html).toHaveAttribute('data-theme', 'paper-dark');
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
    .toBe('rgb(28, 24, 19)');
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'paper-dark');
  await page.getByTestId('theme-select').selectOption('paper-light');
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
    .toBe('rgb(244, 239, 230)');

  // Font style: saved on the account, drawn in the editor.
  await page.getByTestId('font-style').selectOption('sans');
  await expect(html).toHaveAttribute('data-font-style', 'sans');
  await expect
    .poll(
      async () =>
        (
          (await (
            await request.get(`${API_URL}/api/v1/settings`, { headers: { cookie } })
          ).json()) as { fontStyle?: string }
        ).fontStyle,
    )
    .toBe('sans');

  await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
  const editor = page.locator('.thesis-editor');
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(() => editor.evaluate((el) => getComputedStyle(el).fontFamily))
    .toMatch(/Inter/i);

  // Back to the defaults.
  await page.goto('/app/settings');
  await page.getByTestId('font-style').selectOption('default');
  await expect(html).not.toHaveAttribute('data-font-style', /.+/);
  await page.getByTestId('theme-select').selectOption('system');
  await expect(html).not.toHaveAttribute('data-theme', /.+/);
});
