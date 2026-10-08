import { expect, type Page, type Route, test } from '@playwright/test';
import { measureLayout, settle } from './_layout.js';
import { API_URL, establishSession, freshEmail } from './_session.js';

/**
 * Chat threads, a chat on one collection, and the inline "search beyond your library?" ask
 * (ADR-0116, Jenni build plan R30).
 *
 * What is mocked, and why: the chat routes are supplied here, shaped exactly as
 * `ChatThreadsService` and `ChatService.ask` send them, because a real answer needs a library
 * with read, embedded papers and the scholarly search; the API side — the rows, the migration, the
 * collection scope, the refunds — is `apps/api/test/chat-threads-api.spec.ts`. Settings (Always
 * allow) uses the real API.
 */

const ORIGIN = new URL(process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000').origin;
const CORS = {
  'access-control-allow-origin': ORIGIN,
  'access-control-allow-credentials': 'true',
  'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'access-control-allow-headers': 'content-type, accept',
};
const frame = (event: string, data: unknown) =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

const OLD = '01a20000-0000-7000-8000-00000000a001';
const LATEST = '01a20000-0000-7000-8000-00000000a002';
const CREATED = '01a20000-0000-7000-8000-00000000a003';
const SHELF = '01a20000-0000-7000-8000-00000000c001';
const LONG_TITLE =
  'What do the studies in my library say about the financial barriers to rooftop solar adoption';

function turn(id: string, role: 'user' | 'assistant', text: string) {
  return { id, role, text, citations: [] };
}

const VIEWS: Record<string, unknown> = {
  [LATEST]: {
    threadId: LATEST,
    title: 'Which survey counted installers?',
    collection: null,
    collectionDeleted: false,
    collectionName: null,
    turns: [
      turn('q2', 'user', 'Which survey counted installers?'),
      turn('a2', 'assistant', 'The installer survey counted forty.'),
    ],
  },
  [OLD]: {
    threadId: OLD,
    title: LONG_TITLE,
    collection: null,
    collectionDeleted: false,
    collectionName: null,
    turns: [
      turn('q1', 'user', LONG_TITLE),
      turn('a1', 'assistant', 'Upfront cost comes first in every study.'),
    ],
  },
  // The chat the first test creates on the collection, as the server would then return it.
  [CREATED]: {
    threadId: CREATED,
    title: 'What did the installer survey measure?',
    collection: { id: SHELF, name: 'Methods and measurement papers for chapter three' },
    collectionDeleted: false,
    collectionName: 'Methods and measurement papers for chapter three',
    turns: [
      turn('q3', 'user', 'What did the installer survey measure?'),
      turn('a3', 'assistant', 'An answer.'),
    ],
  },
};

const THREADS = [
  {
    id: LATEST,
    title: 'Which survey counted installers?',
    questions: 1,
    collection: null,
    collectionDeleted: false,
    collectionName: null,
    createdAt: new Date(Date.now() - 3_600_000).toISOString(),
    updatedAt: new Date(Date.now() - 600_000).toISOString(),
  },
  {
    id: OLD,
    title: LONG_TITLE,
    questions: 4,
    collection: null,
    collectionDeleted: false,
    collectionName: null,
    createdAt: new Date(Date.now() - 86_400_000 * 3).toISOString(),
    updatedAt: new Date(Date.now() - 86_400_000 * 3).toISOString(),
  },
  // A chat on a collection whose long name has to give way in a 288 px row.
  {
    id: '01a20000-0000-7000-8000-00000000a004',
    title: 'How was installer experience measured across the survey studies?',
    questions: 2,
    collection: { id: SHELF, name: 'Methods and measurement papers for chapter three' },
    collectionDeleted: false,
    collectionName: 'Methods and measurement papers for chapter three',
    createdAt: new Date(Date.now() - 86_400_000 * 9).toISOString(),
    updatedAt: new Date(Date.now() - 86_400_000 * 9).toISOString(),
  },
];

type Setup = { docId: string; chapterId: string; bodies: Array<Record<string, unknown>> };

async function setUp(
  page: Page,
  request: import('@playwright/test').APIRequestContext,
  prefix: string,
): Promise<Setup> {
  const session = await establishSession(request, freshEmail(prefix));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: `Chat threads ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  const doc = (await created.json()) as { id: string; firstChapterId: string };
  const bodies: Array<Record<string, unknown>> = [];
  const json = (route: Route, body: unknown) =>
    route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/json', ...CORS },
      body: JSON.stringify(body),
    });

  await page.route(
    (url) => url.pathname === `/api/v1/documents/${doc.id}/collections`,
    (route) =>
      route.request().method() === 'OPTIONS'
        ? route.fulfill({ status: 204, headers: CORS })
        : json(route, [
            {
              id: SHELF,
              name: 'Methods and measurement papers for chapter three',
              order: 0,
              count: 2,
            },
            { id: '01a20000-0000-7000-8000-00000000c002', name: 'Empty', order: 1, count: 0 },
          ]),
  );
  await page.route(
    (url) => url.pathname.startsWith(`/api/v1/chat/${doc.id}`),
    (route) => {
      const req = route.request();
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
      const url = new URL(req.url());
      if (url.pathname.endsWith('/threads')) return json(route, { threads: THREADS });
      if (req.method() === 'DELETE') return json(route, { deleted: true });
      const asked = url.searchParams.get('threadId');
      return json(route, VIEWS[asked ?? LATEST]);
    },
  );
  await page.route(`${API_URL}/api/v1/chat`, (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const body = req.postDataJSON() as Record<string, unknown>;
    bodies.push(body);
    const headers = { 'content-type': 'text/event-stream', ...CORS };
    if (String(body.message).includes('weather') && body.scope !== 'beyond') {
      return route.fulfill({
        status: 200,
        headers,
        body: [
          frame('start', { turn: 1 }),
          frame('done', {
            text: 'This chat only answers questions about the sources in your library. Nothing in your library relates to that, so there is nothing for me to answer from.',
            outcome: 'off-topic',
            citations: [],
            passagesUsed: 0,
            latencyMs: 5,
            offerBeyond: true,
            ...(typeof body.threadId === 'string' ? { threadId: body.threadId } : {}),
          }),
        ].join(''),
      });
    }
    const threadId = typeof body.threadId === 'string' ? body.threadId : CREATED;
    return route.fulfill({
      status: 200,
      headers,
      body: [
        frame('start', { turn: 1 }),
        frame('step', { id: 'search', text: 'Searching your library…' }),
        frame('token', { t: 'An answer.' }),
        frame('done', {
          turnId: crypto.randomUUID(),
          text: 'An answer.',
          outcome: 'answered',
          citations: [],
          passagesUsed: 1,
          latencyMs: 5,
          threadId,
        }),
      ].join(''),
    });
  });
  return { docId: doc.id, chapterId: doc.firstChapterId, bodies };
}

async function openChat(page: Page, setup: Setup, phone = false) {
  await page.goto(`/app/d/${setup.docId}/write/${setup.chapterId}`);
  await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 30_000 });
  if (phone) await page.getByTestId('mobile-bar').getByTestId('mobile-chat').click();
  else await page.getByRole('tab', { name: 'chat', exact: true }).click();
  await expect(page.getByTestId('chat-panel')).toBeVisible();
}

test('the chats of a thesis: listed, reopened, and a new one on a collection', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const setup = await setUp(page, request, 'chat-threads');
  await openChat(page, setup);

  // Opens on the chat used last.
  await expect(page.getByTestId('chat-thread-title')).toHaveText(
    'Which survey counted installers?',
  );
  await expect(page.locator('[data-role=assistant]')).toContainText('counted forty');

  // The list, newest first, and an older chat reopened.
  await page.getByTestId('chat-threads-toggle').click();
  const rows = page.getByTestId('chat-thread');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toHaveAttribute('aria-current', 'true');
  await expect(rows.nth(1)).toContainText('4 questions');
  await expect(rows.nth(2)).toContainText('Methods and measurement papers');
  await rows.nth(1).getByTestId('chat-thread-open').click();
  await expect(page.getByTestId('chat-threads')).toHaveCount(0);
  await expect(page.locator('[data-role=assistant]')).toContainText('Upfront cost comes first');

  // Asking in it names it.
  await page.locator('#chat-message').fill('And what about credit?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(page.locator('[data-role=assistant]').last()).toContainText('An answer.');
  expect(setup.bodies.at(-1)).toMatchObject({ threadId: OLD });

  // New ▸ a collection: the chat says what it answers from, and offers no other scope.
  await page.getByTestId('chat-new').click();
  const menu = page.getByTestId('chat-new-menu');
  await expect(menu).toContainText('Your whole library');
  await expect(menu.getByTestId('chat-new-collection').nth(1)).toBeDisabled();
  await menu.getByTestId('chat-new-collection').first().click();
  await expect(page.getByTestId('chat-thread-title')).toHaveText('New chat');
  await expect(page.getByTestId('chat-collection-scope')).toContainText('Collection: Methods');
  await expect(page.getByTestId('chat-scope-library')).toHaveCount(0);
  await expect(page.getByTestId('chat-deep-toggle')).toHaveCount(0);
  await expect(page.locator('[data-role]')).toHaveCount(0);

  await page.locator('#chat-message').fill('What did the installer survey measure?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(page.locator('[data-role=assistant]')).toContainText('An answer.');
  expect(setup.bodies.at(-1)).toMatchObject({ newThread: true, collectionId: SHELF });
  expect(setup.bodies.at(-1)).not.toHaveProperty('threadId');
  // Stored now: titled by its question, and the next question continues it.
  await expect(page.getByTestId('chat-thread-title')).toHaveText(
    'What did the installer survey measure?',
  );
  await page.locator('#chat-message').fill('How many installers?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(page.locator('[data-role=assistant]')).toHaveCount(2);
  expect(setup.bodies.at(-1)).toMatchObject({ threadId: CREATED });

  // Leaving the Chat tab and coming back keeps the chat that was open, collection and all.
  const tabs = page.getByTestId('tool-panel').locator('[role="tablist"] [role="tab"]');
  await tabs.first().click();
  await page.getByRole('tab', { name: 'chat', exact: true }).click();
  await expect(page.getByTestId('chat-thread-title')).toHaveText(
    'What did the installer survey measure?',
  );
  await expect(page.getByTestId('chat-collection-scope')).toBeVisible();

  // Delete asks on the row first.
  await page.getByTestId('chat-threads-toggle').click();
  await expect(rows).toHaveCount(3);
  await rows.nth(0).getByTestId('chat-thread-delete').click();
  await rows.nth(0).getByTestId('chat-thread-delete-confirm').click();
  await expect(rows).toHaveCount(2);
});

test('web search is asked in the conversation: Allow this time, Always allow, Skip', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const setup = await setUp(page, request, 'chat-web-ask');
  await openChat(page, setup);

  await page.locator('#chat-message').fill('What is the weather in Chennai?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  const ask = page.getByTestId('chat-search-beyond-ask');
  await expect(ask).toContainText('Search beyond your library?');
  await expect(ask.getByRole('button')).toHaveText(['Allow this time', 'Always allow', 'Skip']);

  // Skip: the refusal stands and nothing is sent.
  const before = setup.bodies.length;
  await ask.getByTestId('chat-search-beyond-skip').click();
  await expect(ask).toHaveCount(0);
  await expect(page.getByTestId('chat-search-beyond-skipped')).toHaveText('Not searched.');
  expect(setup.bodies.length).toBe(before);

  // Always allow: saved as "On" where the setting lives, then the same question searched.
  await page.locator('#chat-message').fill('And the weather in Madurai?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await page.getByTestId('chat-search-beyond-always').click();
  await expect(page.getByTestId('chat-search-beyond-always-note')).toContainText('now On');
  expect(setup.bodies.at(-1)).toMatchObject({
    scope: 'beyond',
    message: 'And the weather in Madurai?',
  });
  const settings = await page.evaluate(
    async (api) =>
      (await (await fetch(`${api}/api/v1/settings`, { credentials: 'include' })).json()) as {
        searchBeyondLibrary: string;
      },
    API_URL,
  );
  expect(settings.searchBeyondLibrary).toBe('on');
});

test('on a phone the chat list and the ask fit the drawer', async ({ page, request }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const setup = await setUp(page, request, 'chat-threads-phone');
  await openChat(page, setup, true);
  await page.getByTestId('chat-threads-toggle').click();
  await expect(page.getByTestId('chat-thread')).toHaveCount(3);
  await settle(page);
  expect(await page.evaluate(measureLayout, false)).toEqual([]);

  await page.getByTestId('chat-threads-toggle').click();
  await page.getByTestId('chat-new').click();
  await expect(page.getByTestId('chat-new-menu')).toBeVisible();
  expect(await page.evaluate(measureLayout, false)).toEqual([]);

  await page.getByTestId('chat-new-library').click();
  await page.locator('#chat-message').fill('What is the weather in Chennai?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(page.getByTestId('chat-search-beyond-ask')).toBeVisible();
  expect(await page.evaluate(measureLayout, false)).toEqual([]);
});
