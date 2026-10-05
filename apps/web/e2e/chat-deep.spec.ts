import { expect, test } from '@playwright/test';
import { API_URL, establishSession, freshEmail } from './_session.js';

/**
 * Deep research in chat (ADR-0080): the switch under the box, the request it sends, the steps
 * while it works, and the answer with its plan and the papers it found.
 *
 * What is mocked, and why: as in `chat-research.spec.ts`, the `/chat` stream is supplied here,
 * shaped exactly as `ChatService.askDeep` sends it, because the real path runs two model calls and
 * several index searches. The API side is `apps/api/test/chat-deep-api.spec.ts`.
 */

const PAPERS = [1, 2].map((i) => ({
  title: `Mobile banking adoption among rural women ${i}`,
  year: 2022,
  venue: 'Journal of Rural Development',
  doi: `10.1000/deep.${i}`,
  inLibrary: false,
  reference: { raw: `Mobile banking adoption ${i}. 2022`, doi: `10.1000/deep.${i}` },
}));

const frame = (event: string, data: unknown) =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

const PLAN = [
  { title: 'Digital literacy', question: 'How does digital literacy limit use?' },
  { title: 'Phone ownership', question: 'Who owns and controls the phone?' },
  { title: 'Trust', question: 'What role does trust in the app play?' },
];

const STEPS = [
  { id: 'plan', text: 'Planning the research…', params: {} },
  {
    id: 'planned',
    text: 'Planned 3 parts: Digital literacy · Phone ownership · Trust',
    params: { parts: 3, titles: 'Digital literacy · Phone ownership · Trust' },
  },
  {
    id: 'part',
    text: 'Part 1 of 3, Digital literacy: searching your library and the indexes for: digital literacy rural women mobile banking…',
    params: {
      index: 1,
      total: 3,
      title: 'Digital literacy',
      query: 'digital literacy rural women mobile banking',
    },
  },
  {
    id: 'part',
    text: 'Part 2 of 3, Phone ownership: searching your library and the indexes for: phone ownership rural women India…',
    params: {
      index: 2,
      total: 3,
      title: 'Phone ownership',
      query: 'phone ownership rural women India',
    },
  },
  {
    id: 'part',
    text: 'Part 3 of 3, Trust: searching your library and the indexes for: trust mobile banking rural India…',
    params: { index: 3, total: 3, title: 'Trust', query: 'trust mobile banking rural India' },
  },
  { id: 'read', text: 'Reading 9 passages from 3 sources' },
  { id: 'read', text: 'Reading 21 abstracts…', params: { count: 21 } },
  { id: 'kept', text: '2 of 21 are on your question', params: { kept: 2, read: 21 } },
  { id: 'write', text: 'Writing the answer, part by part…' },
];

const ANSWER =
  'Three things stop them: literacy, the phone, and trust {{cite:S1#c1}}.\n\n' +
  '### Digital literacy\nAdoption rose with schooling, from 11% to 72% {{cite:S1#c1}}.\n\n' +
  '### Phone ownership\nMost non-users share a phone {{cite:Sweb1#cabstract}}.\n\n' +
  '### Trust\nDistrust of the app was named by half {{cite:Sweb2#cabstract}}.\n\n' +
  '### For your thesis\nLead with literacy; add the two found papers for ownership and trust.';

test('research deeply: the switch, the steps, the answer with its plan and found papers', async ({
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
  const session = await establishSession(request, freshEmail('chat-deep'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: `Chat deep ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  const doc = (await created.json()) as { id: string; firstChapterId: string };

  const bodies: Array<Record<string, unknown>> = [];
  await page.route(`${API_URL}/api/v1/chat`, (route) => {
    bodies.push(route.request().postDataJSON() as Record<string, unknown>);
    return route.fulfill({
      status: 200,
      headers,
      body: [
        frame('start', { turn: 1 }),
        ...STEPS.map((s) => frame('step', s)),
        frame('token', { t: ANSWER }),
        frame('done', {
          turnId: '01a10000-0000-7000-8000-00000000d2a1',
          text: ANSWER,
          outcome: 'answered',
          citations: [
            {
              key: 'S1#c1',
              sourceId: '01a10000-0000-7000-8000-0000000005c1',
              chunkId: '01a10000-0000-7000-8000-0000000005c2',
              label: 'Mathivathana 2025',
            },
            {
              key: 'Sweb1#cabstract',
              sourceId: '',
              chunkId: '',
              label: 'Mobile banking adoption…, 2022',
              beyond: PAPERS[0],
            },
            {
              key: 'Sweb2#cabstract',
              sourceId: '',
              chunkId: '',
              label: 'Mobile banking adoption…, 2022',
              beyond: PAPERS[1],
            },
          ],
          passagesUsed: 11,
          latencyMs: 61_000,
          research: {
            deep: true,
            papers: 2,
            queries: STEPS.filter((s) => s.id === 'part').map((s) => String(s.params?.query)),
            note: 'From 3 papers in your library and the abstracts of 2 found by the searches, not in your library — add the ones you use.',
            plan: PLAN,
            libraryPapers: 3,
          },
        }),
      ].join(''),
    });
  });

  await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
  await page.getByRole('tab', { name: 'chat', exact: true }).click();
  const panel = page.getByTestId('chat-panel');

  // The switch is offered in the library scope, and says what it does.
  const toggle = panel.getByTestId('chat-deep-toggle');
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.getByTestId('chat-box-hint')).toHaveText(
    'Deep research is on for the next question',
  );

  await panel
    .locator('textarea, input#chat-message')
    .first()
    .fill('What stops rural women using mobile banking?');
  await panel.getByRole('button', { name: 'Ask', exact: true }).click();

  // The request asked for deep research, and the switch is off again for the next question.
  await expect.poll(() => bodies.length).toBe(1);
  expect(bodies[0]?.deep).toBe(true);
  expect(bodies[0]?.scope).toBe('library');

  // The answer, with headings, its plan and the found papers.
  const answer = panel.locator('[data-role="assistant"]').last();
  await expect(answer).toContainText('Three things stop them');
  await expect(answer.getByTestId('chat-answer-heading')).toHaveCount(4);
  await expect(answer.getByTestId('chat-research-plan')).toHaveText(
    'Parts: Digital literacy · Phone ownership · Trust',
  );
  await expect(answer.getByTestId('chat-research-note')).toContainText(
    'From 3 papers in your library and the abstracts of 2 found by the searches',
  );
  await expect(answer.getByTestId('chat-research-paper')).toHaveCount(2);
  await expect(answer.getByTestId('chat-research-add-all')).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');

  // Not offered where it does not apply: the document scope.
  await panel.getByRole('button', { name: 'This thesis' }).click();
  await expect(panel.getByTestId('chat-deep-toggle')).toHaveCount(0);
});
