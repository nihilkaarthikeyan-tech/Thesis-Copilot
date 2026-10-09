import { expect, test } from '@playwright/test';
import { docxEntry } from './_docx.js';
import { openFormatMore } from './_editor.js';
import { type LayoutFault, measureLayout, settle } from './_layout.js';
import { API_URL, establishSession, freshEmail } from './_session.js';

/**
 * R28 (ADR-0119): text colour, highlight, the contents block and the horizontal rule — each
 * inserted in the browser, each fitting the screen at five widths, and each in the `.docx`.
 */

const heading = (level: number, text: string) => ({
  type: 'heading',
  attrs: { level },
  content: [{ type: 'text', text }],
});
const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });

test('colours, a contents block and a rule insert, fit every width, and reach the .docx', async ({
  page,
  request,
}) => {
  test.setTimeout(300_000);
  const session = await establishSession(request, freshEmail('blocks-colors'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: `Blocks and colours ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  const doc = (await created.json()) as { id: string; firstChapterId: string };
  const chapter = (await (
    await request.get(`${API_URL}/api/v1/chapters/${doc.firstChapterId}`, { headers: { cookie } })
  ).json()) as { version: number };
  const put = await request.put(`${API_URL}/api/v1/chapters/${doc.firstChapterId}`, {
    headers: { cookie },
    data: {
      baseVersion: chapter.version,
      content: {
        type: 'doc',
        content: [
          heading(1, 'Introduction'),
          heading(2, 'Study area and the districts sampled'),
          para('Rainfall fell sharply over the decade'),
          heading(3, 'Climate'),
          para('The last line'),
        ],
      },
    },
  });
  expect(put.ok(), `chapter: ${put.status()}`).toBe(true);

  const editor = page.locator('.thesis-editor');
  const found: Array<{ where: string } & LayoutFault> = [];

  for (const width of [1440, 1280, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
    await expect(editor).toBeVisible({ timeout: 30_000 });
    await settle(page);

    // Each picker opens inside the window, beside its button, and closes on Esc.
    for (const [button, panel] of [
      ['fmt-text-color', 'text-color-picker'],
      ['fmt-highlight', 'highlight-picker'],
    ] as const) {
      await openFormatMore(page);
      await page.getByTestId(button).click();
      const box = await page.getByTestId(panel).boundingBox();
      expect(box, `${width} ${panel}`).not.toBeNull();
      if (box) {
        expect(box.x, `${width} ${panel} left`).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, `${width} ${panel} right`).toBeLessThanOrEqual(width);
      }
      for (const fault of await page.evaluate(measureLayout, false)) {
        found.push({ where: `${width} ${panel}`, ...fault });
      }
      await page.keyboard.press('Escape');
      await expect(page.getByTestId(panel)).toHaveCount(0);
    }
    for (const fault of await page.evaluate(measureLayout, false)) {
      found.push({ where: `${width} editor`, ...fault });
    }
  }
  expect(
    found,
    found
      .map((f) => `${f.where}: ${f.kind} ${f.by ?? ''}px ${f.el ?? ''} in ${f.box ?? ''}`)
      .join('\n'),
  ).toEqual([]);

  // Colour a word: select "sharply", choose red; then highlight "decade" in green.
  await page.setViewportSize({ width: 1280, height: 900 });
  const selectWord = async (word: string) => {
    await editor.evaluate((el, w) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const at = (n.textContent ?? '').indexOf(w);
        if (at < 0) continue;
        const range = document.createRange();
        range.setStart(n, at);
        range.setEnd(n, at + w.length);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        return;
      }
    }, word);
    await page.waitForTimeout(200);
  };
  await editor.click();
  await selectWord('sharply');
  await openFormatMore(page);
  await page.getByTestId('fmt-text-color').click();
  await page.getByTestId('text-color-red').click();
  await expect(editor.locator('span[data-text-color="red"]')).toHaveText('sharply');
  await selectWord('decade');
  await openFormatMore(page);
  await page.getByTestId('fmt-highlight').click();
  await page.getByTestId('highlight-green').click();
  await expect(editor.locator('mark[data-color="green"]')).toHaveText('decade');

  // "/" → a contents block that lists the headings, and a rule.
  await editor.getByText('The last line').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/toc');
  await expect(page.getByTestId('slash-item-tableOfContents')).toBeVisible();
  await page.keyboard.press('Enter');
  const toc = editor.getByTestId('toc-block');
  await expect(toc).toBeVisible();
  await expect(toc.locator('.tc-toc-entry')).toHaveText([
    'Introduction',
    'Study area and the districts sampled',
    'Climate',
  ]);
  await page.keyboard.type('/divider');
  await page.keyboard.press('Enter');
  await expect(editor.locator('hr')).toHaveCount(1);
  await expect(editor).not.toContainText('/divider');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 20_000 });

  // A click on an entry goes to that heading.
  await toc.getByRole('button', { name: 'Climate', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const n = window.getSelection()?.anchorNode;
        const el = n instanceof Element ? n : n?.parentElement;
        return el?.closest('h3')?.textContent ?? null;
      }),
    )
    .toBe('Climate');

  // The chapter .docx carries all four.
  const exported = await request.post(`${API_URL}/api/v1/documents/${doc.id}/export`, {
    headers: { cookie },
    data: { chapterId: doc.firstChapterId, format: 'docx' },
  });
  expect(exported.ok(), `export: ${exported.status()}`).toBe(true);
  const { url } = (await exported.json()) as { url: string };
  const xml = docxEntry(Buffer.from(await (await request.get(url)).body()), 'word/document.xml');
  expect(xml).toContain('<w:color w:val="B42318"/>');
  expect(xml).toContain('<w:highlight w:val="green"/>');
  expect(xml).toContain('TOC \\h \\o &quot;1-3&quot;');
  expect(xml).toMatch(/<w:pBdr><w:bottom [^>]*w:val="single"/);
});
