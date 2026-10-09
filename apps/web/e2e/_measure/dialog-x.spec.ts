import { expect, test } from '@playwright/test';
import { API_URL, establishSession, freshEmail } from '../_session.js';

// QA 2026-10-09: a long dialog on a phone had no way out at the top. MEASURE=1 only.
test.skip(!process.env.MEASURE, 'measurement run');

test('the export dialog keeps its × in reach on a phone', async ({ page, request }) => {
  const session = await establishSession(request, freshEmail('dialog-x'));
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  const doc = (await (
    await request.post(`${API_URL}/api/v1/documents`, {
      headers: { cookie: `${session.cookieName}=${session.cookieValue}` },
      data: { title: `Dialog x ${Date.now()}`, entryPath: 'A_TOPIC' },
    })
  ).json()) as { id: string; firstChapterId: string };
  await page.setViewportSize({ width: 390, height: 760 });
  await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
  await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('open-export').click();
  const dialog = page.getByTestId('export-dialog');
  await expect(dialog.getByTestId('layout-preview')).toBeVisible({ timeout: 20_000 });
  await dialog.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await page.waitForTimeout(300);
  const x = dialog.getByTestId('export-dialog-x');
  const box = await x.boundingBox();
  await page.screenshot({ path: '../../qa-shots/dialog-x-390.png' });
  expect(box?.y ?? -1).toBeGreaterThanOrEqual(0);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
  await x.click();
  await expect(dialog).toBeHidden();
});
