import { expect, type Page, test } from '@playwright/test';
import { tinyPng } from './_images.js';
import { API_URL, establishSession, freshEmail } from './_session.js';

/**
 * A figure is still there when its chapter is reopened.
 *
 * A figure's link is a signed URL that lasts fifteen minutes, saved into the chapter. Until
 * 2026-09-24 nothing minted a new one, so every figure went blank once its chapter was opened a
 * quarter of an hour after the upload — a link stored on 09-21 answered 403 on 09-24. Two paths
 * fix it and each is proven here: the chapter read hands out fresh links, and the editor asks for
 * one itself when a link it holds stops loading.
 */

/** A link to the right object that no longer works: the signature is not MinIO's. */
const deadLink = (key: string) =>
  `http://localhost:9002/thesis-copilot/${key}?X-Amz-Expires=1&X-Amz-Signature=expired`;

async function chapterWithFigure(request: Parameters<typeof establishSession>[0], page: Page) {
  const session = await establishSession(request, freshEmail('figure-links'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: `Figure links ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  const doc = (await created.json()) as { id: string; firstChapterId: string };
  const uploaded = await request.post(`${API_URL}/api/v1/chapters/${doc.firstChapterId}/figures`, {
    headers: { cookie },
    multipart: { file: { name: 'sites.png', mimeType: 'image/png', buffer: tinyPng() } },
  });
  expect(uploaded.ok(), `upload: ${uploaded.status()}`).toBe(true);
  const { key } = (await uploaded.json()) as { key: string };

  const chapter = (await (
    await request.get(`${API_URL}/api/v1/chapters/${doc.firstChapterId}`, { headers: { cookie } })
  ).json()) as { version: number };
  // Saved with a link that no longer works, as every chapter older than fifteen minutes was.
  const saved = await request.put(`${API_URL}/api/v1/chapters/${doc.firstChapterId}`, {
    headers: { cookie },
    data: {
      baseVersion: chapter.version,
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'The survey sites are shown below.' }],
          },
          { type: 'image', attrs: { key, src: deadLink(key), alt: 'Survey sites' } },
        ],
      },
    },
  });
  expect(saved.ok(), `save: ${saved.status()}`).toBe(true);
  return { doc, key };
}

/** Whether the figure in the editor has actually been drawn, not just put in the page. */
const figureLoaded = (page: Page) =>
  page
    .locator('.thesis-editor img')
    .evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0);

test('a chapter reopened after its figure links expired still shows the figure', async ({
  page,
  request,
}) => {
  const { doc } = await chapterWithFigure(request, page);
  // The server's link has to work on its own: the editor's fallback must not be what saved it.
  const relinks: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/figures/link?key=')) relinks.push(r.url());
  });
  await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
  await expect(page.locator('.thesis-editor img')).toHaveCount(1, { timeout: 30_000 });
  await expect.poll(() => figureLoaded(page), { timeout: 15_000 }).toBe(true);
  expect(relinks).toEqual([]);
  const src = await page.locator('.thesis-editor img').getAttribute('src');
  expect(src).not.toContain('X-Amz-Signature=expired');
  expect((await request.get(src ?? '')).status()).toBe(200);
});

test('a link that stops working while the chapter is open is replaced', async ({
  page,
  request,
}) => {
  const { doc, key } = await chapterWithFigure(request, page);
  // The editor is handed the dead link, as it would hold one after fifteen minutes open.
  await page.route(`**/api/v1/chapters/${doc.firstChapterId}`, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const body = (await response.json()) as {
      content: { content: Array<{ type: string; attrs?: Record<string, unknown> }> };
    };
    for (const node of body.content.content) {
      if (node.type === 'image' && node.attrs) node.attrs.src = deadLink(key);
    }
    await route.fulfill({ response, json: body });
  });
  const relinked = page.waitForRequest((r) => r.url().includes('/figures/link?key='));

  await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
  await expect(page.locator('.thesis-editor img')).toHaveCount(1, { timeout: 30_000 });
  await relinked;
  await expect.poll(() => figureLoaded(page), { timeout: 15_000 }).toBe(true);
});
