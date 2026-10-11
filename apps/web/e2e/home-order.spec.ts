import { expect, test } from '@playwright/test';
import { API_URL, establishSession, freshEmail } from './_session.js';

/**
 * The owner (2026-10-11): starting a new thesis sits ABOVE the list of theses, not under it, at
 * every width.
 */
test('Start another thesis comes before the theses list, on a laptop and on a phone', async ({
  page,
  request,
}) => {
  const session = await establishSession(request, freshEmail('home-order'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  const first = `Groundwater recharge in hard-rock aquifers ${Date.now()}`;
  for (const title of [first, `Heat illness among outdoor workers ${Date.now()}`]) {
    const created = await request.post(`${API_URL}/api/v1/documents`, {
      headers: { cookie },
      data: { title, entryPath: 'A_TOPIC' },
    });
    expect(created.ok()).toBe(true);
  }
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/app');
    const another = page.getByTestId('start-another');
    await expect(another).toBeVisible({ timeout: 30_000 });
    const thesis = page.getByText(first).first();
    await expect(thesis).toBeVisible();
    const a = await another.boundingBox();
    const t = await thesis.boundingBox();
    expect(a && t ? a.y < t.y : false).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`home-${width}.png`) });
  }
});
