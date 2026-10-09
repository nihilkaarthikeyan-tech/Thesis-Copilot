import { expect, test } from '@playwright/test';
import { API_URL, establishSession, freshEmail } from './_session.js';

/**
 * Chat beyond the library (ADR-0060).
 *
 * What is mocked, and why: the scholarly search runs inside the API, and OpenAlex's free daily
 * budget on a development machine is often spent, so the two `/chat` streams are supplied here,
 * shaped exactly as `ChatService.ask` sends them (the off-topic refusal with `offerBeyond`, then
 * the beyond answer with its steps). `/sources/resolve` is mocked too, because a real resolve
 * goes to Crossref. The API side — the unit, the refund, the setting — is
 * `apps/api/test/chat-beyond-api.spec.ts`. The Settings switch below uses the real API.
 */

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

/** The web app's origin, so the mocked responses pass CORS on a stack on other ports too. */
const ORIGIN = new URL(process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000').origin;

const SSE_HEADERS = {
  'content-type': 'text/event-stream',
  'access-control-allow-origin': ORIGIN,
  'access-control-allow-credentials': 'true',
};

const frame = (event: string, data: unknown) =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

test('a refused question offers the search; the answer shows its steps, its papers and Add', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const session = await establishSession(request, freshEmail('chat-beyond'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: `Chat beyond ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  const doc = (await created.json()) as { id: string; firstChapterId: string };

  const bodies: Array<Record<string, unknown>> = [];
  await page.route(`${API_URL}/api/v1/chat`, (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    bodies.push(body);
    if (body.scope !== 'beyond') {
      return route.fulfill({
        status: 200,
        headers: SSE_HEADERS,
        body: [
          frame('start', { turn: 1 }),
          frame('done', {
            text: 'This chat only answers questions about the sources in your library. Nothing in your library relates to that, so there is nothing for me to answer from.',
            outcome: 'off-topic',
            citations: [],
            passagesUsed: 0,
            latencyMs: 5,
            offerBeyond: true,
          }),
        ].join(''),
      });
    }
    const text = 'Upfront cost is the main barrier {{cite:Sweb1#cabstract}}.';
    return route.fulfill({
      status: 200,
      headers: SSE_HEADERS,
      body: [
        frame('start', { turn: 1 }),
        frame('step', { id: 'search', text: 'Searching OpenAlex, PubMed, arXiv…' }),
        frame('step', { id: 'read', text: 'Reading 8 abstracts' }),
        frame('step', { id: 'write', text: 'Writing the answer' }),
        frame('token', { t: text }),
        frame('done', {
          turnId: '01a10000-0000-7000-8000-0000000be70d',
          text,
          outcome: 'answered',
          citations: [
            {
              key: 'Sweb1#cabstract',
              sourceId: '',
              chunkId: '',
              label: 'Barriers to rooftop solar adoption…, 2022',
              beyond: PAPER,
            },
          ],
          passagesUsed: 8,
          latencyMs: 5,
          beyond: {
            papers: 8,
            outsideLibrary: 8,
            note: 'From the abstracts of 8 papers not in your library — add the ones you use.',
          },
        }),
      ].join(''),
    });
  });
  const resolved: unknown[] = [];
  await page.route(`${API_URL}/api/v1/documents/${doc.id}/sources/resolve`, (route) => {
    resolved.push(route.request().postDataJSON());
    return route.fulfill({
      status: 200,
      headers: {
        'content-type': 'application/json',
        'access-control-allow-origin': ORIGIN,
        'access-control-allow-credentials': 'true',
      },
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
  await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('tab', { name: 'chat', exact: true }).click();
  await page.locator('#chat-message').fill('What limits rooftop solar adoption?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();

  // ADR-0116: asked in the conversation — Allow this time / Always allow / Skip.
  await expect(page.getByTestId('chat-search-beyond-ask')).toContainText(
    'Search beyond your library?',
  );
  const offer = page.getByTestId('chat-search-beyond');
  await expect(offer).toHaveText('Allow this time');
  await offer.click();

  const answer = page.locator('[data-role=assistant]').last();
  await expect(answer).toContainText('Upfront cost is the main barrier');
  expect(bodies.at(-1)).toMatchObject({
    scope: 'beyond',
    message: 'What limits rooftop solar adoption?',
  });
  // The question is in the thread once, not twice.
  await expect(page.locator('[data-role=user]')).toHaveCount(1);
  await expect(offer).toHaveCount(0);

  await expect(answer.getByTestId('chat-beyond-cite')).toHaveAttribute(
    'title',
    'Not in your library',
  );
  await expect(answer.getByTestId('chat-beyond-note')).toHaveText(
    'From the abstracts of 8 papers not in your library — add the ones you use.',
  );
  const paper = answer.getByTestId('chat-beyond-paper');
  await expect(paper).toContainText('Not in your library');
  // Not thesis text: an answer from abstracts has no "Add to document".
  await expect(answer.getByTestId('chat-add-to-document')).toHaveCount(0);

  await paper.getByTestId('chat-beyond-add').click();
  await expect(paper).toContainText('Added. Once it has been read, ask on Library to cite it.');
  // R18 (ADR-0129): the thesis's "Add into" goes with it; none chosen here, so null.
  expect(resolved).toEqual([{ references: [PAPER.reference], collectionId: null }]);
});

test('Settings: Search beyond my library is Ask first until changed, and keeps the choice', async ({
  page,
  request,
}) => {
  const session = await establishSession(request, freshEmail('beyond-setting'));
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  await page.goto('/app/settings');
  await expect(page.getByTestId('search-beyond-ask')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('search-beyond-on').click();
  await expect(page.getByTestId('search-beyond-on')).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(page.getByTestId('search-beyond-on')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('search-beyond-ask')).toHaveAttribute('aria-pressed', 'false');
});
