import { expect, test } from '@playwright/test';
import { API_URL, establishSession, freshEmail } from './_session.js';

/**
 * Chat that researches when the library is thin (ADR-0074).
 *
 * What is mocked, and why: as in `chat-beyond.spec.ts`, the scholarly search runs inside the API
 * against indexes whose budgets and answers change, so the `/chat` streams are supplied here,
 * shaped exactly as `ChatService.ask` sends them. `/sources/resolve` is mocked because a real
 * resolve goes to Crossref. The API side — the unit, the EMBED row, the refund, only request
 * passages cited — is `apps/api/test/chat-research-api.spec.ts`.
 */

const PAPERS = [1, 2].map((i) => ({
  title: `Financing rooftop solar for rural households ${i}`,
  year: 2023,
  venue: 'Energy Policy',
  doi: `10.1000/fin.${i}`,
  inLibrary: false,
  reference: { raw: `Financing rooftop solar ${i}. Energy Policy. 2023`, doi: `10.1000/fin.${i}` },
}));

const frame = (event: string, data: unknown) =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

const STEPS = [
  { id: 'search', text: 'Searching your library…' },
  { id: 'read', text: 'Reading 8 passages from 3 sources' },
  {
    id: 'research',
    text: 'Your library has 3 papers on this, so I am searching the literature too…',
    params: { papers: 3 },
  },
  {
    id: 'query',
    text: 'Searching OpenAlex for: What are the financial barriers?…',
    params: { indexes: 'OpenAlex', query: 'What are the financial barriers?' },
  },
  {
    id: 'query',
    text: 'Searching OpenAlex, PubMed and arXiv for: financial barriers rooftop solar…',
    params: { indexes: 'OpenAlex, PubMed and arXiv', query: 'financial barriers rooftop solar' },
  },
  { id: 'read', text: 'Reading 12 abstracts…', params: { count: 12 } },
];

const ANSWER =
  'Upfront cost and credit are the main financial barriers {{cite:S1#c1}}.\n\n' +
  '### Upfront cost\nThe purchase price deters most households {{cite:S1#c1}}.\n\n' +
  '### Access to credit\nFew rural households can borrow for a system {{cite:Sweb1#cabstract}}. ' +
  'Instalment plans raise uptake {{cite:Sweb2#cabstract}}.';

test('a thin library: the steps show while it works, the answer comes in parts, found papers can be added', async ({
  page,
  request,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const origin = new URL(baseURL ?? 'http://localhost:3000').origin;
  const headers = {
    'content-type': 'text/event-stream',
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
  };
  const session = await establishSession(request, freshEmail('chat-research'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: `Chat research ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  const doc = (await created.json()) as { id: string; firstChapterId: string };

  let calls = 0;
  await page.route(`${API_URL}/api/v1/chat`, (route) => {
    calls++;
    // The first question's stream stops mid-search, as the student sees it while it works.
    if (calls === 1) {
      return route.fulfill({
        status: 200,
        headers,
        body: [frame('start', { turn: 1 }), ...STEPS.map((s) => frame('step', s))].join(''),
      });
    }
    return route.fulfill({
      status: 200,
      headers,
      body: [
        frame('start', { turn: 1 }),
        ...STEPS.map((s) => frame('step', s)),
        frame('step', {
          id: 'kept',
          text: '2 of 12 are on your question',
          params: { kept: 2, read: 12 },
        }),
        frame('step', { id: 'write', text: 'Writing the answer…' }),
        frame('token', { t: ANSWER }),
        frame('done', {
          turnId: '01a10000-0000-7000-8000-00000000c2a1',
          text: ANSWER,
          outcome: 'answered',
          citations: [
            {
              key: 'S1#c1',
              sourceId: '01a10000-0000-7000-8000-0000000005c1',
              chunkId: '01a10000-0000-7000-8000-0000000005c2',
              label: 'Kumar 2021',
            },
            {
              key: 'Sweb1#cabstract',
              sourceId: '',
              chunkId: '',
              label: 'Financing rooftop solar for…, 2023',
              beyond: PAPERS[0],
            },
            {
              key: 'Sweb2#cabstract',
              sourceId: '',
              chunkId: '',
              label: 'Financing rooftop solar for…, 2023',
              beyond: PAPERS[1],
            },
          ],
          passagesUsed: 10,
          latencyMs: 5,
          research: {
            papers: 2,
            queries: ['financial barriers rooftop solar'],
            note: 'From 3 papers in your library and the abstracts of 2 found by a search, not in your library — add the ones you use.',
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
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
  await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('tab', { name: 'chat', exact: true }).click();

  // While it works: every step in plain words; the two searches run side by side, so both are
  // still "now" until the reading starts, and everything before is ticked.
  await page.locator('#chat-message').fill('What are the financial barriers?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  const steps = page.getByTestId('chat-steps');
  await expect(steps).toContainText(
    'Your library has 3 papers on this, so I am searching the literature too…',
  );
  await expect(steps).toContainText(
    'Searching OpenAlex, PubMed and arXiv for: financial barriers rooftop solar…',
  );
  await expect(steps.locator('li[data-step=query]').first()).toHaveAttribute('data-done', 'true');
  await expect(steps.locator('li').last()).toHaveText(/Reading 12 abstracts…$/);
  await expect(steps.locator('li').last()).toHaveAttribute('data-done', 'false');

  // The answer: headings as headings, library citations as buttons, found papers listed with Add.
  await page.locator('#chat-message').fill('What are the financial barriers?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  const answer = page.locator('[data-role=assistant]').last();
  await expect(answer.getByTestId('chat-answer-heading')).toHaveText([
    'Upfront cost',
    'Access to credit',
  ]);
  await expect(answer).not.toContainText('###');
  await expect(answer.getByRole('button', { name: 'Kumar 2021' }).first()).toBeVisible();
  await expect(answer.getByTestId('chat-beyond-cite')).toHaveCount(2);
  await expect(answer.getByTestId('chat-research-note')).toHaveText(
    'From 3 papers in your library and the abstracts of 2 found by a search, not in your library — add the ones you use.',
  );
  await expect(answer.getByTestId('chat-research-paper')).toHaveCount(2);
  // Not thesis text until the found papers are sources.
  await expect(answer.getByTestId('chat-add-to-document')).toHaveCount(0);

  await answer.getByTestId('chat-research-add-all').click();
  await expect(answer.getByTestId('chat-research-paper').first()).toContainText('Added.');
  expect(resolved).toEqual([{ references: PAPERS.map((p) => p.reference) }]);
  await expect(answer.getByTestId('chat-research-add-all')).toHaveCount(0);
});
