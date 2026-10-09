import { expect, type Page, test } from '@playwright/test';
import { type LayoutFault, measureLayout, settle } from './_layout.js';
import { API_URL, establishSession, freshEmail } from './_session.js';

/**
 * Ask a research question with no thesis, or across all theses (ADR-0132), in a browser.
 *
 * What is mocked, and why: the `/research-chats` routes, shaped exactly as
 * `ResearchChatService` answers — the asking goes to the scholarly indexes (whose free budget a
 * suite should not spend) and the model, and the API side (the unit before the call, the
 * refusals, ownership, erasure, only the student's own non-archived theses) is
 * `apps/api/test/research-chat-api.spec.ts`. `/sources/resolve` and the new thesis's `POST
 * /documents` are mocked too: a real resolve goes to Crossref, and a real Start writing now
 * plans chapters. Everything else is the real API on the mock stack (`api-mock`).
 *
 * Every other API response passes through with its CORS header set for this page's origin, so the
 * spec also runs against a web server on another port than the API was configured for.
 */

const ORIGIN = new URL(process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000').origin;
const CORS = { 'access-control-allow-origin': ORIGIN, 'access-control-allow-credentials': 'true' };
const SSE_HEADERS = { 'content-type': 'text/event-stream', ...CORS };
const JSON_HEADERS = { 'content-type': 'application/json', ...CORS };
const frame = (event: string, data: unknown) =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

const QUESTION = 'What limits rooftop solar adoption among rural households?';
const CHAT_ID = '0192a000-0000-7000-8000-00000000c4a7';

const PAPER = {
  title: 'Barriers to rooftop solar adoption among Indian households',
  year: 2022,
  venue: 'Energy Policy',
  doi: '10.1000/solar.2',
  inLibrary: false,
  reference: {
    raw: 'Barriers to rooftop solar adoption. Energy Policy. 2022',
    doi: '10.1000/solar.2',
  },
};

async function passThroughWithCors(page: Page) {
  await page.route(`${API_URL}/api/v1/**`, async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), ...CORS } });
  });
}

test('a research question with no thesis: the answer, Add to a thesis, Start a thesis from this', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const session = await establishSession(request, freshEmail('ask'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  const stamp = Date.now();
  const thesisTitle = `Night-time urban heat islands among outdoor workers in coastal cities ${stamp}`;
  const made = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: thesisTitle, entryPath: 'A_TOPIC' },
  });
  const thesis = (await made.json()) as { id: string };

  // Registered first, so it runs last: the routes below handle their own URLs first.
  await passThroughWithCors(page);

  const asked: Array<Record<string, unknown>> = [];
  let stored = false;
  await page.route(`${API_URL}/api/v1/research-chats**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/research-chats/ask')) {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      asked.push(body);
      stored = true;
      const across = body.source === 'theses';
      const citations = across
        ? [
            {
              key: 'S1#c1',
              sourceId: '0192a000-0000-7000-8000-0000000050a1',
              chunkId: '0192a000-0000-7000-8000-0000000c4a01',
              label: 'Rao 2022',
              thesis: { id: thesis.id, title: thesisTitle },
              paper: { ...PAPER, inLibrary: true },
            },
          ]
        : [
            {
              key: 'Sweb1#cabstract',
              sourceId: '',
              chunkId: '',
              label: 'Barriers to rooftop solar…, 2022',
              beyond: PAPER,
            },
          ];
      const text = across
        ? 'Heat exposure peaks at night in dense wards {{cite:S1#c1}}.'
        : 'Upfront cost is the main barrier {{cite:Sweb1#cabstract}}.';
      return route.fulfill({
        status: 200,
        headers: SSE_HEADERS,
        body: [
          frame('start', { turn: 1 }),
          frame('step', {
            id: 'search',
            text: across ? 'Searching your thesis…' : 'Searching OpenAlex, PubMed, arXiv…',
          }),
          frame('step', {
            id: 'read',
            text: across ? 'Reading 1 passage from 1 thesis' : 'Reading 1 abstract',
          }),
          frame('step', { id: 'write', text: 'Writing the answer' }),
          frame('token', { t: text }),
          frame('done', {
            turnId: crypto.randomUUID(),
            text,
            outcome: 'answered',
            citations,
            passagesUsed: 1,
            latencyMs: 9,
            beyond: {
              papers: 1,
              outsideLibrary: across ? 0 : 1,
              note: across
                ? 'From 1 passage in the library of one of your theses. Each citation names its thesis.'
                : 'From the abstracts of 1 paper the search found, none of them in a thesis yet. Add the ones you use to a thesis, or start one from this chat.',
            },
            ...(across ? { across: true } : {}),
            threadId: CHAT_ID,
          }),
        ].join(''),
      });
    }
    if (url.pathname.endsWith(`/research-chats/${CHAT_ID}`)) {
      return route.fulfill({
        status: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          id: CHAT_ID,
          title: QUESTION,
          turns: [
            { id: 'u1', role: 'user', text: QUESTION },
            {
              id: 'a1',
              role: 'assistant',
              text: 'Upfront cost is the main barrier {{cite:Sweb1#cabstract}}.',
              citations: [
                {
                  key: 'Sweb1#cabstract',
                  sourceId: '',
                  chunkId: '',
                  label: 'Barriers to rooftop solar…, 2022',
                  beyond: PAPER,
                },
              ],
            },
          ],
          papers: [PAPER],
          suggestedTitle: QUESTION,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
      });
    }
    return route.fulfill({
      status: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        chats: stored
          ? [
              {
                id: CHAT_ID,
                title: QUESTION,
                questions: 1,
                createdAt: '2026-10-09T00:00:00Z',
                updatedAt: '2026-10-09T00:00:00Z',
              },
            ]
          : [],
      }),
    });
  });

  const resolved: Array<{ path: string; body: unknown }> = [];
  await page.route(`${API_URL}/api/v1/documents/*/sources/resolve`, (route) => {
    resolved.push({
      path: new URL(route.request().url()).pathname,
      body: route.request().postDataJSON(),
    });
    return route.fulfill({
      status: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({ queued: 1, alreadyPresent: 0, sourceIds: ['x'] }),
    });
  });
  let created: Record<string, unknown> | null = null;
  await page.route(`${API_URL}/api/v1/documents`, async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    created = route.request().postDataJSON() as Record<string, unknown>;
    return route.fulfill({
      status: 201,
      headers: JSON_HEADERS,
      body: JSON.stringify({ id: thesis.id, firstChapterId: null, title: created.title }),
    });
  });

  // The entry on the thesis list, and in New ▾.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/app');
  await page.getByTestId('new-menu-button').click();
  await expect(page.getByTestId('new-menu-ask')).toHaveAttribute('href', '/app/ask');
  await page.keyboard.press('Escape');
  await page.getByTestId('list-ask').click();
  await expect(page).toHaveURL(/\/app\/ask$/);
  await expect(page.getByRole('heading', { name: 'Ask a research question' })).toBeVisible();

  // The literature: one question, its steps, the answer, the paper "Not in your library".
  await page.getByTestId('ask-input').fill(QUESTION);
  await page.getByTestId('ask-submit').click();
  const answer = page.getByTestId('ask-answer').last();
  await expect(answer).toContainText('Upfront cost is the main barrier');
  await expect(answer.getByTestId('chat-beyond-cite')).toHaveText(
    'Barriers to rooftop solar…, 2022',
  );
  await expect(answer.getByTestId('ask-paper')).toContainText('Not in your library');
  expect(asked[0]).toEqual({ message: QUESTION, source: 'web' });
  await expect(page).toHaveURL(new RegExp(`/app/ask\\?chat=${CHAT_ID}$`));
  await expect(page.getByTestId('ask-history-item')).toHaveCount(1);
  // The answer stays as streamed when the address takes the chat's id (no reload over it).
  await expect(answer.getByTestId('ask-note')).toContainText('From the abstracts of 1 paper');

  // Nothing went into a thesis until the press.
  expect(resolved).toHaveLength(0);
  await answer.getByTestId('ask-add-to-thesis').click();
  await answer.getByTestId('ask-thesis-choice').filter({ hasText: thesisTitle }).click();
  await expect(answer.getByTestId('ask-paper-added')).toContainText(thesisTitle);
  expect(resolved).toEqual([
    {
      path: `/api/v1/documents/${thesis.id}/sources/resolve`,
      body: { references: [PAPER.reference] },
    },
  ]);

  // All my theses: the citation names its thesis.
  await page.getByTestId('ask-source-theses').check();
  await page.getByTestId('ask-input').fill('Where is heat exposure worst?');
  await page.getByTestId('ask-submit').click();
  const across = page.getByTestId('ask-answer').last();
  await expect(across).toContainText('Heat exposure peaks at night');
  await expect(across.getByRole('button', { name: /^Rao 2022 · / })).toBeVisible();
  await expect(across.getByTestId('ask-paper-thesis')).toContainText(thesisTitle);
  expect(asked[1]).toMatchObject({ source: 'theses', chatId: CHAT_ID });

  // Measured at the two widths the owner checks, with the long title on screen.
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 860 });
    await settle(page);
    const faults: LayoutFault[] = await page.evaluate(measureLayout, false);
    expect(faults, `layout at ${width}px`).toEqual([]);
    // SHOTS=<dir>: a picture at each width, to look at as well as measure.
    if (process.env.SHOTS) {
      await page.screenshot({ path: `${process.env.SHOTS}/ask-${width}.png`, fullPage: true });
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });

  // Start a thesis from this: the question as working title, the cited papers ticked.
  await page.getByTestId('ask-start-thesis').click();
  const dialog = page.getByTestId('ask-start-dialog');
  await expect(dialog.getByTestId('ask-start-title')).toHaveValue(QUESTION);
  await expect(dialog.getByTestId('ask-start-paper')).toHaveCount(1);
  resolved.length = 0;
  await dialog.getByTestId('ask-start-create').click();
  await expect(page).toHaveURL(new RegExp(`/app/d/${thesis.id}/outline`));
  expect(created).toMatchObject({ title: QUESTION, entryPath: 'A_TOPIC', start: 'writing' });
  expect(resolved).toEqual([
    {
      path: `/api/v1/documents/${thesis.id}/sources/resolve`,
      body: { references: [PAPER.reference] },
    },
  ]);
  // The new thesis's own screen is still loading through the pass-through route.
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});
