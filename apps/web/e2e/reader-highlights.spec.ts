import { type APIRequestContext, expect, type Locator, type Page, test } from '@playwright/test';
import { onePagePdf } from './_pdf.js';
import { API_URL, establishSession, freshEmail, type Session } from './_session.js';

/**
 * Highlights and notes in the reader (ADR-0130). What only a browser shows: that a highlight is
 * drawn over pdf.js's text layer, drawn again after a reload, listed beside the paper, that a note
 * goes to the chat box only on "Put in chat", and that the list fits a phone.
 *
 * Needs the dev stack: web, API, the worker (to read the uploaded PDF) and Compose, with
 * migration 0051 applied.
 */

test.describe.configure({ mode: 'serial' });

let session: Session;
let cookie = '';
let documentId = '';
let sourceId = '';

const LINES = [
  'Recharge wells in hard rock aquifers',
  'Recharge wells raised the water table by 1.2 m over three seasons.',
  'Farmers near each recharge well reported a second crop.',
];

async function signIn(page: Page) {
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
}

async function readSources(request: APIRequestContext) {
  const res = await request.get(`${API_URL}/api/v1/documents/${documentId}/sources`, {
    headers: { cookie },
  });
  return (await res.json()) as Array<{ id: string; groundingLevel: string }>;
}

async function select(root: Locator, words: string) {
  await root.evaluate((el, needle) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node as Text;
      const at = text.data.indexOf(needle);
      if (at === -1) continue;
      const range = document.createRange();
      range.setStart(text, at);
      range.setEnd(text, at + needle.length);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      return;
    }
    throw new Error(`no "${needle}" to select`);
  }, words);
}

/** The text drawn under each highlight colour, as the CSS Highlight API holds it. */
async function drawn(page: Page, colour: string): Promise<string[]> {
  return page.evaluate((name) => {
    const registry = (CSS as unknown as { highlights: Map<string, Set<Range>> }).highlights;
    const set = registry.get(`reader-hl-${name}`);
    return set ? [...set].map((r) => r.toString()) : [];
  }, colour);
}

test.beforeAll(async ({ request }) => {
  test.setTimeout(180_000);
  session = await establishSession(request, freshEmail('reader-highlights'));
  cookie = `${session.cookieName}=${session.cookieValue}`;
  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: `Reader highlights ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  documentId = ((await created.json()) as { id: string }).id;
  const uploaded = await request.post(`${API_URL}/api/v1/documents/${documentId}/sources/upload`, {
    headers: { cookie },
    multipart: {
      file: { name: 'Recharge wells.pdf', mimeType: 'application/pdf', buffer: onePagePdf(LINES) },
    },
  });
  expect(uploaded.ok()).toBe(true);
  await expect
    .poll(async () => (await readSources(request))[0]?.groundingLevel ?? 'NONE', {
      timeout: 120_000,
      intervals: [2_000],
    })
    .toBe('FULL_TEXT');
  sourceId = (await readSources(request))[0]?.id ?? '';
});

test('a highlight is drawn on the PDF, kept, and drawn again after a reload', async ({ page }) => {
  await signIn(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/app/d/${documentId}/sources/${sourceId}`);
  const layer = page.getByTestId('pdf-text-layer').first();
  await expect(layer).toContainText('raised the water table', { timeout: 30_000 });

  await select(layer, 'raised the water table');
  await page.getByTestId('reader-highlight-green').click();
  await expect(page.getByTestId('reader-highlights-count')).toHaveText('1');
  await expect.poll(() => drawn(page, 'green')).toEqual(['raised the water table']);

  await page.reload();
  await expect(page.getByTestId('pdf-text-layer').first()).toContainText('water table', {
    timeout: 30_000,
  });
  await expect
    .poll(() => drawn(page, 'green'), { timeout: 15_000 })
    .toEqual(['raised the water table']);
  // And in the Text view, found by its words.
  await page.getByTestId('reader-view-text').click();
  await expect.poll(() => drawn(page, 'green')).toEqual(['raised the water table']);
});

test('a note is written in the side list and goes to the chat box only when asked', async ({
  page,
}) => {
  await signIn(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/app/d/${documentId}/sources/${sourceId}?view=text`);
  const text = page.getByTestId('text-view');
  await expect(text).toContainText('second crop', { timeout: 30_000 });
  await select(text, 'reported a second crop');
  await page.getByTestId('reader-note').click();

  const list = page.getByTestId('reader-highlights');
  await expect(list).toBeVisible();
  const box = page.getByTestId('reader-note-box');
  await expect(box).toBeFocused();
  await box.fill('Use in 2.3 against the yield claim.');
  await page.getByTestId('reader-note-save').click();
  await expect(list.getByTestId('reader-note-text')).toHaveText(
    'Use in 2.3 against the yield claim.',
  );
  await expect(list.getByTestId('reader-highlight-item')).toHaveCount(2);

  // Side list beside the paper, nothing sideways.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1280);

  await list
    .getByTestId('reader-highlight-item')
    .filter({ hasText: 'second crop' })
    .getByTestId('reader-highlight-chat')
    .click();
  await expect(page).toHaveURL(/\/write\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await expect(page.locator('#chat-message')).toHaveValue(
    /^About this passage: "reported a second crop( \(p\. 1\))?" — my note: Use in 2\.3 against the yield claim\. — $/,
    { timeout: 30_000 },
  );
});

test('on a phone the list is a sheet that fits, and a highlight is deleted', async ({
  browser,
}) => {
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await phone.newPage();
  await signIn(page);
  await page.goto(`/app/d/${documentId}/sources/${sourceId}?view=text`);
  await expect(page.getByTestId('text-view')).toContainText('second crop', { timeout: 30_000 });
  await page.getByTestId('reader-highlights-open').click();
  const list = page.getByTestId('reader-highlights');
  await expect(list.getByTestId('reader-highlight-item')).toHaveCount(2);
  const box = await list.boundingBox();
  expect(box?.width ?? 0).toBeLessThanOrEqual(390);
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(844 + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  await list.getByTestId('reader-highlight-delete').first().click();
  await expect(list.getByTestId('reader-highlight-item')).toHaveCount(1);
  await phone.close();
});
