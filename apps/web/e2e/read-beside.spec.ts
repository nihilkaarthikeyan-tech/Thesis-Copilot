import { expect, test } from '@playwright/test';
import { onePagePdf } from './_pdf.js';
import { API_URL, establishSession, freshEmail } from './_session.js';

/**
 * "Read beside" (2026-10-04, from the Jenni study): a source's PDF in a pane next to the chapter
 * on a wide screen; on a phone, the paper reader in a new tab.
 *
 * Since ADR-0068 the pane draws the PDF with pdf.js from bytes the API streams — no iframe on a
 * storage link, which production's `X-Frame-Options: DENY` left blank. So this proves the page is
 * really drawn: the pane holds a text layer with the PDF's words, and no frame. It also resizes
 * and closes. The citation hover card's button is covered by
 * `packages/ui/test/citation-read-beside.spec.ts`.
 *
 * Needs the dev stack: web, API, the worker (to read the PDF, which makes it pinnable and so
 * listed in the Sources tab) and Compose.
 */

async function setUp(
  page: import('@playwright/test').Page,
  request: import('@playwright/test').APIRequestContext,
  prefix: string,
) {
  const session = await establishSession(request, freshEmail(prefix));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: `Read beside ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  const doc = (await created.json()) as { id: string; firstChapterId: string };
  const uploaded = await request.post(`${API_URL}/api/v1/documents/${doc.id}/sources/upload`, {
    headers: { cookie },
    multipart: {
      file: {
        name: 'Recharge wells in hard rock.pdf',
        mimeType: 'application/pdf',
        buffer: onePagePdf([
          'Recharge wells in hard rock',
          'Recharge wells raised the water table by 1.2 m over three seasons.',
        ]),
      },
    },
  });
  expect(uploaded.ok()).toBe(true);
  // The Sources tab lists only papers with something to quote, so wait for the worker to read it.
  await expect
    .poll(
      async () => {
        const res = await request.get(`${API_URL}/api/v1/documents/${doc.id}/sources`, {
          headers: { cookie },
        });
        const rows = (await res.json()) as Array<{ groundingLevel: string }>;
        return rows[0]?.groundingLevel ?? 'NONE';
      },
      { timeout: 120_000, intervals: [2_000], message: 'the uploaded PDF was never read' },
    )
    .not.toBe('NONE');
  return doc;
}

test('on a wide screen the Sources tab opens the PDF in a pane beside the chapter', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const doc = await setUp(page, request, 'read-beside');

  await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
  await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 30_000 });
  // The Sources tab is the default.
  const read = page.getByTestId('source-read-pdf');
  await expect(read).toBeVisible({ timeout: 30_000 });
  await read.click();

  const pane = page.getByTestId('read-beside');
  await expect(pane).toBeVisible();
  await expect(pane).toContainText(/Recharge wells/);
  // Drawn on the page by pdf.js: the PDF's own words in its text layer, and no frame.
  await expect(pane.getByTestId('pdf-text-layer').first()).toContainText('raised the water table', {
    timeout: 30_000,
  });
  await expect(pane.locator('iframe')).toHaveCount(0);
  const reader = page.getByTestId('read-beside-new-tab');
  await expect(reader).toHaveAttribute('target', '_blank');
  await expect(reader).toHaveAttribute('href', new RegExp(`/app/d/${doc.id}/sources/`));

  // Dragging the edge resizes the pane. At 1440 px it opens at its widest (the chapter list, the
  // tools and a readable page keep the rest), so the drag narrows it.
  const before = (await pane.boundingBox())?.width ?? 0;
  const handle = page.getByTestId('read-beside-resize');
  const box = await handle.boundingBox();
  if (!box) throw new Error('the resize handle has no box');
  await page.mouse.move(box.x + box.width / 2, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 80, box.y + 100, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await pane.boundingBox())?.width ?? 0).toBeLessThan(before);

  // The chapter is still there and still editable beside it.
  await expect(page.locator('.thesis-editor')).toBeVisible();

  await page.getByTestId('read-beside-close').click();
  await expect(pane).toHaveCount(0);
});

test('on a phone "Read PDF" opens the paper reader in a new tab instead', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const doc = await setUp(page, request, 'read-beside-phone');

  await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
  await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 30_000 });
  // On a phone the tools are a drawer, opened from the bar at the foot of the screen.
  await page.getByTestId('mobile-sources').click();
  const read = page.getByTestId('source-read-pdf');
  await expect(read).toBeVisible({ timeout: 30_000 });

  // ADR-0068: the reader, which a phone shows, rather than the raw file, which it downloads.
  const popup = page.waitForEvent('popup');
  await read.click();
  const tab = await popup;
  await expect(tab).toHaveURL(new RegExp(`/app/d/${doc.id}/sources/[0-9a-f-]{36}$`));
  await expect(tab.getByTestId('pdf-text-layer').first()).toContainText('Recharge wells', {
    timeout: 30_000,
  });
  await expect(page.getByTestId('read-beside')).toHaveCount(0);
});
