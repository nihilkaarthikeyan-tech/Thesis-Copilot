import { expect, test } from '@playwright/test';
import { establishSession, freshEmail } from './_session.js';

/** A high-contrast switch that survives a reload and darkens muted text (2026-10-04). */
test('high contrast is switched on in Settings, applies at once and after a reload', async ({
  page,
  request,
}) => {
  const session = await establishSession(request, freshEmail('contrast'));
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  await page.goto('/app/settings');
  const muted = () =>
    page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--color-muted').trim(),
    );
  const before = await muted();
  const toggle = page.getByTestId('high-contrast');
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-contrast', 'high');
  expect(await muted()).not.toBe(before);

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-contrast', 'high');
  await expect(page.getByTestId('high-contrast')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('high-contrast').click();
  await expect(page.locator('html')).not.toHaveAttribute('data-contrast', 'high');
});
