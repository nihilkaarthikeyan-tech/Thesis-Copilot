import { expect, test } from '@playwright/test';
import { API_URL, establishSession, freshEmail } from './_session.js';

/** On a phone, Suggest is on the screen, and a suggestion can be kept without a Tab key. */
test('a phone student asks for a suggestion and keeps it, all by touch', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const session = await establishSession(request, freshEmail('phone-suggest'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: `Phone ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  const doc = (await created.json()) as { id: string; firstChapterId: string };

  await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
  const editor = page.locator('.thesis-editor');
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await editor.locator('p').first().click();
  await page.keyboard.type('Uptake of drip irrigation is uneven across districts. ');

  const floating = page.getByTestId('suggest-floating');
  await expect(floating).toBeInViewport();
  await floating.click();
  const bar = page.getByTestId('suggestion-bar');
  await expect(bar).toBeVisible({ timeout: 30_000 });
  // While a suggestion is up, the floating button gives way to the bar.
  await expect(floating).toHaveCount(0);
  await expect(bar.getByRole('button', { name: 'Accept', exact: true })).toBeInViewport();
  await expect(page.locator('.thesis-editor span.ghost[data-status="shown"]')).toBeVisible({
    timeout: 30_000,
  });
  await bar.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect(bar).toHaveCount(0);
  await expect(page.getByTestId('suggest-floating')).toBeVisible();
});
