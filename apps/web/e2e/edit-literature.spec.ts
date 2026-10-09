/**
 * ADR-0133 — "Search the literature" on an AI edit, in the browser.
 *
 * The search, the adding and the edit are the API's (`apps/api/test/edit-literature-api.spec.ts`
 * runs them against Postgres with the indexes replaced); the indexes are not for a browser suite.
 * So `POST /commands/run` is answered here with what the API returns when it added two papers,
 * and the screen is held to what only a browser shows:
 * - the switch sits beside "Use my library", turning it on keeps the library on, and the edit is
 *   sent with `searchLiterature` and the library;
 * - the result lists "Added to your library", each paper opening in the reader;
 * - nothing enters the chapter until Replace;
 * - at phone width the panel's switches wrap rather than push the page sideways.
 */

import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { API_URL, establishSession, freshEmail, type Session } from './_session.js';

async function use(page: Page, s: Session): Promise<Session> {
  await page
    .context()
    .addCookies([{ name: s.cookieName, value: s.cookieValue, domain: 'localhost', path: '/' }]);
  return s;
}

async function thesis(
  request: APIRequestContext,
  s: Session,
): Promise<{ documentId: string; chapterId: string }> {
  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie: `${s.cookieName}=${s.cookieValue}` },
    data: { title: `Literature edit ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  expect(created.ok(), 'creating the thesis').toBe(true);
  const { id, firstChapterId } = (await created.json()) as { id: string; firstChapterId: string };
  return { documentId: id, chapterId: firstChapterId };
}

const SENTENCE =
  'Upfront cost limits rooftop solar adoption among rural households in coastal Karnataka.';

const PAPER_A = '01890000-0000-7000-8000-00000000000a';
const PAPER_B = '01890000-0000-7000-8000-00000000000b';

async function openPanel(page: Page) {
  const editor = page.locator('.thesis-editor');
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await editor.locator('p').first().click();
  await page.keyboard.type(SENTENCE);
  await page.keyboard.down('Shift');
  for (let i = 0; i < SENTENCE.length; i++) await page.keyboard.press('ArrowLeft');
  await page.keyboard.up('Shift');
  const toolbar = page.getByTestId('command-toolbar');
  await expect(toolbar).toBeVisible({ timeout: 10_000 });
  return { editor, toolbar };
}

test('Search the literature: sends the switch, lists the papers added, changes nothing until Replace', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const s = await use(page, await establishSession(request, freshEmail('edit-lit')));
  const { documentId, chapterId } = await thesis(request, s);

  let sent: Record<string, unknown> | null = null;
  await page.route('**/api/v1/commands/run', async (route) => {
    sent = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        command: 'custom',
        text: `${SENTENCE} Access to credit raised adoption by a third.`,
        diff: [
          { type: 'same', text: SENTENCE },
          { type: 'add', text: ' Access to credit raised adoption by a third.' },
        ],
        words: 19,
        originalWords: 12,
        droppedCitations: [],
        citations: [],
        unchanged: false,
        movedCitations: [],
        doubledCitations: [],
        repeatedCitations: [],
        runId: '01890000-0000-7000-8000-0000000000ff',
        literature: {
          added: [
            {
              sourceId: PAPER_A,
              shortRef: 'Rao 2022',
              title: 'Credit and solar',
              year: 2022,
              ready: true,
            },
            {
              sourceId: PAPER_B,
              shortRef: 'Iyer 2021',
              title: 'Solar loans',
              year: 2021,
              ready: false,
            },
          ],
          collection: { id: '01890000-0000-7000-8000-0000000000cc', name: 'Finance' },
          note: null,
        },
      }),
    });
  });
  await page.route('**/api/v1/commands/explain', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"reasons":[]}' }),
  );

  await page.goto(`/app/d/${documentId}/write/${chapterId}`);
  const { editor, toolbar } = await openPanel(page);

  const library = page.getByTestId('ai-edit-library');
  const literature = page.getByTestId('ai-edit-literature');
  await expect(literature).not.toBeChecked();
  await library.uncheck();
  await literature.check();
  // The switch implies the library: what it finds is added there.
  await expect(library).toBeChecked();
  await expect(library).toBeDisabled();

  await page.getByTestId('ai-edit-input').fill('Add one sentence of evidence on credit access');
  await page.getByTestId('ai-edit-send').click();

  const block = page.getByTestId('command-literature');
  await expect(block).toBeVisible({ timeout: 15_000 });
  expect(sent).toMatchObject({
    chapterId,
    command: 'custom',
    instruction: 'Add one sentence of evidence on credit access',
    useLibrary: true,
    searchLiterature: true,
  });
  await expect(block).toContainText('Added to your library (in Finance) — 2 papers:');
  const papers = page.getByTestId('command-literature-paper');
  await expect(papers).toHaveCount(2);
  await expect(papers.nth(0)).toHaveText('Rao 2022');
  await expect(papers.nth(0)).toHaveAttribute('href', `/app/d/${documentId}/sources/${PAPER_A}`);
  await expect(papers.nth(1)).toHaveText('Iyer 2021 (still being read)');

  // Nothing is in the chapter until Replace.
  await expect(editor).not.toContainText('Access to credit');
  await page.getByTestId('command-apply').click();
  await expect(editor).toContainText('Access to credit raised adoption by a third.');
  await expect(toolbar.getByTestId('command-literature')).toHaveCount(0);
});

test('at phone width the switches wrap inside the panel', async ({ page, request }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 375, height: 812 });
  const s = await use(page, await establishSession(request, freshEmail('edit-lit-phone')));
  const { documentId, chapterId } = await thesis(request, s);
  await page.goto(`/app/d/${documentId}/write/${chapterId}`);
  const { toolbar } = await openPanel(page);
  await expect(page.getByTestId('ai-edit-literature')).toBeVisible();
  const fits = await toolbar.evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
  expect(fits, 'the panel has no sideways overflow').toBe(true);
  const box = await toolbar.boundingBox();
  expect(box && box.x >= 0 && box.x + box.width <= 375).toBe(true);
  const page_ = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  );
  expect(page_, 'the page does not scroll sideways').toBe(true);
});
