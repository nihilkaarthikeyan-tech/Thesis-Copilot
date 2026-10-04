import { expect, test } from '@playwright/test';
import { onePagePdf } from './_pdf.js';
import { API_URL, establishSession, freshEmail } from './_session.js';

/**
 * "Read beside" (2026-10-04, from the Jenni study): a source's PDF in a pane next to the chapter
 * on a wide screen, in a new tab on a phone.
 *
 * The pane is the browser's own PDF viewer in an iframe on the signed storage link, so what this
 * proves is the wiring: the Sources tab asks, the pane opens with a frame on that link, it
 * resizes, it closes. (Headless Chromium has no PDF viewer of its own; the frame's address is the
 * evidence, not the rendered page.) The citation hover card's button is covered by
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
  const frame = page.getByTestId('read-beside-frame');
  await expect(frame).toHaveAttribute('src', /\/sources\/.+X-Amz-Signature=/);
  await expect(page.getByTestId('read-beside-new-tab')).toHaveAttribute('target', '_blank');

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

test('on a phone "Read PDF" opens the PDF in a new tab instead', async ({ page, request }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const doc = await setUp(page, request, 'read-beside-phone');

  await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
  await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 30_000 });
  // On a phone the tools are a drawer, opened from the bar at the foot of the screen.
  await page.getByTestId('mobile-sources').click();
  const read = page.getByTestId('source-read-pdf');
  await expect(read).toBeVisible({ timeout: 30_000 });

  // A new tab asks for the signed PDF link. (Headless Chromium downloads a PDF rather than
  // showing it, so the request is what can be checked, not the tab's address.)
  const popup = page.waitForEvent('popup');
  const signed = page.context().waitForEvent('request', {
    predicate: (r) => r.url().includes('X-Amz-Signature='),
    timeout: 20_000,
  });
  await read.click();
  await popup;
  expect((await signed).url()).toContain('/sources/');
  await expect(page.getByTestId('read-beside')).toHaveCount(0);
});
