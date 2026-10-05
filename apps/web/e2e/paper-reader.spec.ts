import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { seedAbstractOnlySource } from './_db.js';
import { onePagePdf } from './_pdf.js';
import { API_URL, establishSession, freshEmail, type Session } from './_session.js';

/**
 * The paper reader (ADR-0068): a paper in the library is read inside Thesis Copilot.
 *
 * What only a browser shows: that pdf.js actually draws the PDF on our own page with a text layer
 * (no frame, so production's `X-Frame-Options` cannot blank it), that Ctrl+F finds a word and
 * counts "x of y", that a selection becomes a quotation with the thesis's own citation label on
 * the clipboard, and that an abstract-only paper says so and offers "Add the PDF".
 *
 * Needs the dev stack: web, API, the worker (to read the uploaded PDF) and Compose.
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
  return (await res.json()) as Array<{ id: string; groundingLevel: string; status: string }>;
}

test.beforeAll(async ({ request }) => {
  test.setTimeout(180_000);
  session = await establishSession(request, freshEmail('paper-reader'));
  cookie = `${session.cookieName}=${session.cookieValue}`;
  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: `Paper reader ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  documentId = ((await created.json()) as { id: string }).id;
  const uploaded = await request.post(`${API_URL}/api/v1/documents/${documentId}/sources/upload`, {
    headers: { cookie },
    multipart: {
      file: {
        name: 'Recharge wells in hard rock.pdf',
        mimeType: 'application/pdf',
        buffer: onePagePdf(LINES),
      },
    },
  });
  expect(uploaded.ok()).toBe(true);
  // The worker reads it; the reader is tested on a paper that has been read.
  await expect
    .poll(async () => (await readSources(request))[0]?.groundingLevel ?? 'NONE', {
      timeout: 120_000,
      intervals: [2_000],
      message: 'the uploaded PDF was never read',
    })
    .toBe('FULL_TEXT');
  sourceId = (await readSources(request))[0]?.id ?? '';
});

test('a paper opens from the library in the reader, drawn by pdf.js with a text layer', async ({
  page,
}) => {
  await signIn(page);
  await page.goto(`/app/d/${documentId}/sources`);
  const title = page.getByTestId('library-read-title').first();
  await expect(title).toBeVisible({ timeout: 30_000 });
  await title.click();
  await expect(page).toHaveURL(new RegExp(`/app/d/${documentId}/sources/${sourceId}$`));
  await expect(page.getByTestId('paper-reader')).toBeVisible();

  // Drawn on our own page: a canvas and a text layer, and no frame anywhere.
  const pdfPage = page.getByTestId('pdf-page').first();
  await expect(pdfPage.locator('canvas')).toBeVisible({ timeout: 30_000 });
  const layer = page.getByTestId('pdf-text-layer').first();
  await expect(layer).toContainText('Recharge wells raised the water table', { timeout: 30_000 });
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(page.getByTestId('reader-page')).toHaveText('Page 1 of 1');

  // The canvas really has ink on it — pdf.js drew the page, not just an empty box.
  const inked = await pdfPage.locator('canvas').evaluate((canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < data.length; i += 4) {
      if ((data[i] ?? 255) < 128) return true;
    }
    return false;
  });
  expect(inked).toBe(true);

  // Text is the other view, the passages we extracted.
  await page.getByTestId('reader-view-text').click();
  await expect(page.getByTestId('text-view')).toContainText('second crop');
  await page.getByTestId('reader-view-pdf').click();
  await expect(layer).toBeVisible();
});

test('Ctrl+F searches the PDF and counts the matches as "x of y"', async ({ page }) => {
  await signIn(page);
  await page.goto(`/app/d/${documentId}/sources/${sourceId}`);
  await expect(page.getByTestId('pdf-text-layer').first()).toContainText('Recharge', {
    timeout: 30_000,
  });
  await page.keyboard.press('Control+f');
  const box = page.getByTestId('reader-search');
  await expect(box).toBeFocused();
  await box.fill('recharge');
  const count = page.getByTestId('reader-search-count');
  await expect(count).toHaveText('1 of 3', { timeout: 15_000 });
  await box.press('Enter');
  await expect(count).toHaveText('2 of 3');
  await box.press('Shift+Enter');
  await expect(count).toHaveText('1 of 3');
  await box.fill('groundwater mining');
  await expect(count).toHaveText('No matches');
  await box.press('Escape');
  await expect(box).toHaveCount(0);

  // The Text view searches too.
  await page.getByTestId('reader-view-text').click();
  await page.keyboard.press('Control+f');
  await page.getByTestId('reader-search').fill('water table');
  await expect(count).toHaveText('1 of 1', { timeout: 15_000 });
});

test('a citation’s passage opens marked in the PDF ("Open in reader" from the hover card)', async ({
  page,
  request,
}) => {
  const { passages } = (await (
    await request.get(`${API_URL}/api/v1/sources/${sourceId}/text`, { headers: { cookie } })
  ).json()) as { passages: Array<{ id: string; text: string }> };
  const passage = passages[0];
  expect(passage).toBeTruthy();
  await signIn(page);
  await page.goto(`/app/d/${documentId}/sources/${sourceId}?page=1&chunk=${passage?.id}`);
  await expect(page.getByTestId('pdf-text-layer').first()).toContainText('Recharge', {
    timeout: 30_000,
  });
  // The passage's opening words are marked as the current match (CSS Custom Highlight API).
  await expect
    .poll(() =>
      page.evaluate(() => {
        const registry = (CSS as unknown as { highlights?: Map<string, Set<Range>> }).highlights;
        const current = registry?.get('reader-current');
        return current ? [...current].map((r) => r.toString()).join(' ') : '';
      }),
    )
    .toContain('Recharge wells');
});

test('a selected passage is copied with the thesis’s own citation label', async ({
  page,
  request,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await signIn(page);
  await page.goto(`/app/d/${documentId}/sources/${sourceId}`);
  const layer = page.getByTestId('pdf-text-layer').first();
  await expect(layer).toContainText('raised the water table', { timeout: 30_000 });

  // Select the second line of the page in the text layer, as a mouse drag would.
  await layer.evaluate((root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node as Text;
      const at = text.data.indexOf('raised the water table');
      if (at === -1) continue;
      const range = document.createRange();
      range.setStart(text, at);
      range.setEnd(text, at + 'raised the water table'.length);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      return;
    }
    throw new Error('the text layer has no such line');
  });

  const menu = page.getByTestId('reader-selection-menu');
  await expect(menu).toBeVisible();
  await page.getByTestId('reader-copy-cite').click();
  await expect(page.getByTestId('reader-notice')).toContainText('Copied', { timeout: 15_000 });

  const expected = (await (
    await request.get(
      `${API_URL}/api/v1/documents/${documentId}/citations/quote?sourceId=${sourceId}&page=1`,
      { headers: { cookie } },
    )
  ).json()) as { label: string };
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe(`“raised the water table” ${expected.label}`);
});

/** Selects `words` inside the first element under `root` that holds them, as a drag would. */
async function select(root: import('@playwright/test').Locator, words: string) {
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

test('"Ask chat about this" opens the chapter’s chat with the passage and the paper named', async ({
  page,
}) => {
  await signIn(page);
  await page.goto(`/app/d/${documentId}/sources/${sourceId}?view=text`);
  const text = page.getByTestId('text-view');
  await expect(text).toContainText('second crop', { timeout: 30_000 });
  await select(text, 'reported a second crop');
  await page.getByTestId('reader-ask').click();

  await expect(page).toHaveURL(/\/write\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  const box = page.locator('#chat-message');
  await expect(box).toHaveValue(/^About this passage: "reported a second crop"/, {
    timeout: 30_000,
  });
  await expect(page.getByTestId('chat-mention')).toHaveCount(1);
});

test('"Cite in my chapter" puts a citation where the student clicks, after they press Cite here', async ({
  page,
}) => {
  await signIn(page);
  await page.goto(`/app/d/${documentId}/sources/${sourceId}?view=text`);
  const text = page.getByTestId('text-view');
  await expect(text).toContainText('water table', { timeout: 30_000 });
  await select(text, 'raised the water table');
  await page.getByTestId('reader-cite').click();

  await expect(page).toHaveURL(/\/write\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  const bar = page.getByTestId('reader-cite-bar');
  await expect(bar).toBeVisible({ timeout: 30_000 });
  // Nothing has entered the chapter yet: the student chooses the place.
  const editor = page.locator('.thesis-editor');
  await expect(editor.locator('span.citation')).toHaveCount(0);
  await editor.locator('p').first().click();
  await page.keyboard.type('Recharge raised water levels');
  await page.getByTestId('reader-cite-here').click();
  await expect(bar).toHaveCount(0);
  await expect(editor.locator('span.citation')).toHaveCount(1);
});

test('an abstract-only paper shows its abstract and offers "Add the PDF"', async ({ page }) => {
  const abstract =
    'We measured storage in fractured basalt aquifers across four monsoon seasons in Maharashtra.';
  const abstractOnly = await seedAbstractOnlySource(documentId, {
    title: 'Aquifer storage in fractured basalt',
    abstract,
    doi: `10.5555/e2e.${Date.now()}`,
    year: 2018,
    family: 'Deshpande',
  });
  await signIn(page);
  await page.goto(`/app/d/${documentId}/sources/${abstractOnly}`);
  await expect(page.getByTestId('reader-title')).toHaveText('Aquifer storage in fractured basalt');
  const banner = page.getByTestId('reader-state-abstract');
  await expect(banner).toContainText('We hold only the abstract of this paper');
  await expect(banner.getByText('Add the PDF')).toBeVisible();
  await expect(banner.getByRole('link', { name: /Publisher’s page/ })).toHaveAttribute(
    'href',
    /^https:\/\/doi\.org\/10\.5555\/e2e\./,
  );
  await expect(page.getByTestId('text-view')).toContainText(abstract);
  // No PDF, so no PDF view and no zoom.
  await expect(page.getByTestId('pdf-view')).toHaveCount(0);
});

test('on a phone the PDF fits the width and the selection menu sits at the foot', async ({
  browser,
}) => {
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await phone.newPage();
  await signIn(page);
  await page.goto(`/app/d/${documentId}/sources/${sourceId}`);
  const pdfPage = page.getByTestId('pdf-page').first();
  await expect(pdfPage.locator('canvas')).toBeVisible({ timeout: 30_000 });
  const width = (await pdfPage.boundingBox())?.width ?? 0;
  expect(width).toBeGreaterThan(300);
  expect(width).toBeLessThanOrEqual(390);
  // Nothing scrolls sideways.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  const layer = page.getByTestId('pdf-text-layer').first();
  await expect(layer).toContainText('second crop', { timeout: 30_000 });
  await layer.evaluate((root) => {
    const range = document.createRange();
    range.selectNodeContents(root.querySelector('span') as Node);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
  });
  const menu = page.getByTestId('reader-selection-menu');
  await expect(menu).toBeVisible();
  const box = await menu.boundingBox();
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeGreaterThan(800);
  await phone.close();
});
