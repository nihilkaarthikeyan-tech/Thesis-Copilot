import { expect, test } from '@playwright/test';
import { API_URL, establishSession, freshEmail } from '../_session.js';

// QA 2026-10-09: the format toolbar scrolled away with a long chapter. MEASURE=1 only.
test.skip(!process.env.MEASURE, 'measurement run');

test('the format toolbar stays at the top of a long chapter', async ({ page, request }) => {
  const session = await establishSession(request, freshEmail('sticky'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  const doc = (await (
    await request.post(`${API_URL}/api/v1/documents`, {
      headers: { cookie },
      data: { title: `Sticky toolbar ${Date.now()}`, entryPath: 'A_TOPIC' },
    })
  ).json()) as { id: string; firstChapterId: string };
  const chapter = (await (
    await request.get(`${API_URL}/api/v1/chapters/${doc.firstChapterId}`, { headers: { cookie } })
  ).json()) as { version: number };
  const content = {
    type: 'doc',
    content: Array.from({ length: 30 }, (_, i) => ({
      type: 'paragraph',
      content: [
        { type: 'text', text: `Paragraph ${i + 1}. ${'Words fill the line here. '.repeat(8)}` },
      ],
    })),
  };
  await request.put(`${API_URL}/api/v1/chapters/${doc.firstChapterId}`, {
    headers: { cookie },
    data: { content, baseVersion: chapter.version },
  });
  for (const [w, h] of [
    [1280, 600],
    [390, 700],
  ] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
    await page.locator('.ProseMirror').waitFor();
    await page.getByText('Paragraph 20.').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const box = await page.getByTestId('format-toolbar').boundingBox();
    const position = await page
      .getByTestId('format-toolbar')
      .evaluate((el) => getComputedStyle(el).position);
    console.log(w, position, box?.y);
    await page.screenshot({ path: `../../qa-shots/sticky-${w}.png` });
    expect(position).toBe('sticky');
    expect(box?.y ?? -1).toBeGreaterThanOrEqual(0);
    expect(box?.y ?? 9999).toBeLessThan(h / 2);
  }
});
