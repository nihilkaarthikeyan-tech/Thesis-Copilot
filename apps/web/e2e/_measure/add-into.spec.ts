import { expect, test } from '@playwright/test';
import { measureLayout, settle } from '../_layout.js';
import { API_URL, establishSession, freshEmail } from '../_session.js';

// R18 (ADR-0129): the "Add into" picker with a long collection name, in the 288 px panel, the
// phone drawer and on Sources; the choice holds after a reload. MEASURE=1 only, no model.
test.skip(!process.env.MEASURE, 'measurement run');

test('the Add into picker fits and remembers', async ({ page, request }) => {
  test.setTimeout(180_000);
  const session = await establishSession(request, freshEmail('add-into'));
  const headers = { cookie: `${session.cookieName}=${session.cookieValue}` };
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  const doc = (await (
    await request.post(`${API_URL}/api/v1/documents`, {
      headers,
      data: { title: 'Untitled thesis', entryPath: 'A_TOPIC' },
    })
  ).json()) as { id: string; firstChapterId: string };
  const name = 'Heat stress and labour productivity field studies, chapter 2';
  const made = await request.post(`${API_URL}/api/v1/documents/${doc.id}/collections`, {
    headers,
    data: { name },
  });
  expect(made.ok(), `collection: ${made.status()}`).toBe(true);

  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 860 });
    await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
    await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 30_000 });
    if (width === 390)
      await page.getByTestId('mobile-bar').getByText('papers', { exact: false }).first().click();
    else await page.getByRole('tab', { name: 'papers', exact: true }).click();
    const picker = page.getByTestId('papers-add-into');
    await expect(picker).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('papers-add-into-select').selectOption({ label: name });
    await settle(page);
    await page.screenshot({ path: `../../qa-shots/add-into-papers-${width}.png` });
    expect(await page.evaluate(measureLayout, false)).toEqual([]);
  }

  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto(`/app/d/${doc.id}/sources`);
  const select = page.locator('[data-testid$="-select"]').first();
  await expect(select).toBeVisible({ timeout: 20_000 });
  await page.reload();
  await expect(page.locator('[data-testid$="-select"]').first()).toHaveValue(/.+/, {
    timeout: 20_000,
  });
  const chosen = await page
    .locator('[data-testid$="-select"]')
    .first()
    .evaluate((el) => (el as HTMLSelectElement).selectedOptions[0]?.textContent ?? '');
  console.log('remembered:', chosen);
  expect(chosen).toContain('Heat stress');
  await page.screenshot({ path: '../../qa-shots/add-into-sources-1280.png' });
  expect(await page.evaluate(measureLayout, false)).toEqual([]);
});
