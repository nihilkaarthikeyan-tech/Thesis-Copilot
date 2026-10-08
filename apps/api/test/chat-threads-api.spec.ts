/**
 * Chat threads and a chat on one collection, through the API — ADR-0116 (Jenni build plan R30).
 *
 * The real application on Postgres and Redis with the mock model. Retrieval's query vector is
 * replaced (as in `chat-research-api.spec.ts`) so "on the question" is decided by the test, and
 * the scholarly search is a spy, so a chat on a collection can be shown never to search. Pinned
 * here: a thesis's chats, listed and reopened; a question that names no chat continues the last
 * whole-library one (the old single chat); a new chat is not a row until it has an answer; delete;
 * thumbs in a named chat; and a chat on a collection that answers from its papers alone, refuses
 * everything else before a unit is taken, and says so when its collection is deleted.
 */

import type { Providers } from '@tc/ai';
import { EMBEDDING_DIMENSIONS, type RawClient, replaceSourceChunks } from '@tc/retrieval';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROVIDERS } from '../src/modules/ai/ai.module.js';
import { WebScopeService } from '../src/modules/assist/web-scope.service.js';
import { periodFor } from '../src/modules/usage/usage.service.js';
import { type Harness, startHarness } from './_harness.js';

let h: Harness;
let providers: Providers;
let documentId: string;
let otherDocumentId: string;
let surveyPaper: string;
let costPaper: string;
let methods: string;
let empty: string;
let foreign: string;

const ON = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === 0 ? 1 : 0));
const OFF = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === 1 ? 1 : 0));

const QUESTION = 'What did the survey find about upfront cost of rooftop solar?';

type Sse = {
  status: number;
  events: Array<{ event: string; data: Record<string, unknown> }>;
  problem?: { detail?: string; status?: number };
};

async function ask(body: Record<string, unknown>): Promise<Sse> {
  const res = await h.api('/chat', {
    method: 'POST',
    body: JSON.stringify({ documentId, message: QUESTION, ...body }),
  });
  if (!res.headers.get('content-type')?.includes('text/event-stream')) {
    return { status: res.status, events: [], problem: (await res.json()) as Sse['problem'] };
  }
  const events = (await res.text())
    .split('\n\n')
    .filter(Boolean)
    .map((block) => ({
      event: /^event: (.*)$/m.exec(block)?.[1] ?? '',
      data: JSON.parse(/^data: (.*)$/m.exec(block)?.[1] ?? '{}') as Record<string, unknown>,
    }));
  return { status: res.status, events };
}

const done = (sse: Sse) => sse.events.find((e) => e.event === 'done')?.data ?? {};

type Summary = {
  id: string;
  title: string;
  questions: number;
  collection: { id: string; name: string } | null;
  collectionDeleted: boolean;
};

async function threads(): Promise<Summary[]> {
  const res = await h.api(`/chat/${documentId}/threads`);
  expect(res.status).toBe(200);
  return ((await res.json()) as { threads: Summary[] }).threads;
}

async function units(action: 'CHAT' | 'RESEARCH' = 'CHAT'): Promise<number> {
  const row = await h.prisma.usageLedger.findFirst({
    where: { userId: h.userId, action, period: periodFor() },
  });
  return row?.count ?? 0;
}

async function paper(title: string, text: string): Promise<string> {
  const source = await h.prisma.source.create({
    data: {
      documentId,
      status: 'RESOLVED',
      title,
      authors: [{ family: title.split(' ')[0] ?? 'Author', given: 'A' }],
      year: 2021,
      groundingLevel: 'ABSTRACT',
    },
  });
  await replaceSourceChunks(h.prisma as unknown as RawClient, source.id, [
    {
      sourceId: source.id,
      ordinal: 0,
      text,
      tokenCount: 20,
      page: 3,
      charStart: 0,
      charEnd: text.length,
      section: 'Findings',
      embedding: ON,
    },
  ]);
  return source.id;
}

async function collection(docId: string, name: string, sourceIds: string[]): Promise<string> {
  const made = await h.api(`/documents/${docId}/collections`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
  expect(made.status).toBeLessThan(300);
  const { id } = (await made.json()) as { id: string };
  if (sourceIds.length > 0) {
    const filed = await h.api(`/collections/${id}/sources`, {
      method: 'POST',
      body: JSON.stringify({ sourceIds }),
    });
    expect(filed.status).toBeLessThan(300);
  }
  return id;
}

beforeAll(async () => {
  h = await startHarness('chat-threads@example.com');
  providers = h.app.get<Providers>(PROVIDERS);
  const make = async (title: string) => {
    const document = await h.prisma.document.create({
      data: { ownerId: h.userId, title, entryPath: 'A_TOPIC' },
    });
    await h.prisma.chapter.create({
      data: {
        documentId: document.id,
        outlineNodeId: 'n1',
        title: 'Literature Review',
        scopeNote: 'Household adoption of rooftop solar.',
        order: 1,
        content: { type: 'doc', content: [] },
      },
    });
    return document.id;
  };
  documentId = await make('Rooftop solar in Karnataka');
  otherDocumentId = await make('Another thesis');
  surveyPaper = await paper(
    'Rao installer survey',
    'A survey of forty installers found that upfront cost slowed rooftop solar sales.',
  );
  costPaper = await paper(
    'Kumar household study',
    'Upfront cost was the barrier rural households named first for rooftop solar.',
  );
  methods = await collection(documentId, 'Methods', [surveyPaper]);
  empty = await collection(documentId, 'Empty shelf', []);
  foreign = await collection(otherDocumentId, 'Not this thesis', []);
}, 300_000);

let search: ReturnType<typeof vi.spyOn>;
let searchPlan: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.spyOn(providers.embeddings, 'embed').mockImplementation(async (texts) => texts.map(() => ON));
  search = vi.spyOn(h.app.get(WebScopeService), 'search');
  search.mockResolvedValue({ query: QUESTION, results: [] });
  searchPlan = vi.spyOn(h.app.get(WebScopeService), 'searchPlan');
  searchPlan.mockResolvedValue([]);
  // "Off": the library answers alone, so the whole-library questions here never search.
  await h.prisma.user.update({
    where: { id: h.userId },
    data: { settings: { searchBeyondLibrary: 'off' } },
  });
  await h.prisma.usageLedger.deleteMany({ where: { userId: h.userId } });
});

afterAll(async () => {
  await h?.stop();
});

describe('a thesis’s chats', () => {
  let first: string;
  let second: string;

  it('has none until the first answer, and the first question names it', async () => {
    const before = (await (await h.api(`/chat/${documentId}`)).json()) as {
      threadId: string | null;
      turns: unknown[];
    };
    expect(before).toMatchObject({ threadId: null, turns: [] });
    expect(await threads()).toEqual([]);

    const sse = await ask({});
    expect(sse.status).toBe(200);
    first = String(done(sse).threadId);
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    const list = await threads();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: first,
      title: QUESTION,
      questions: 1,
      collection: null,
      collectionDeleted: false,
    });
  });

  it('continues the last whole-library chat when a question names none (the old single chat)', async () => {
    const sse = await ask({ message: 'And what did the households say about upfront cost?' });
    expect(done(sse).threadId).toBe(first);
    expect((await threads())[0]?.questions).toBe(2);
  });

  it('starts a new chat on request, and keeps the old one whole', async () => {
    const sse = await ask({ newThread: true, message: 'Which survey counted installers?' });
    second = String(done(sse).threadId);
    expect(second).not.toBe(first);
    const list = await threads();
    expect(list.map((t) => t.id)).toEqual([second, first]);

    const old = (await (await h.api(`/chat/${documentId}?threadId=${first}`)).json()) as {
      threadId: string;
      title: string;
      turns: Array<{ role: string; text: string }>;
    };
    expect(old.threadId).toBe(first);
    expect(old.title).toBe(QUESTION);
    expect(old.turns.map((t) => t.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    // Without a name the panel opens the one used last.
    const latest = (await (await h.api(`/chat/${documentId}`)).json()) as { threadId: string };
    expect(latest.threadId).toBe(second);
  });

  it('reopening and asking in an old chat continues it, and moves it to the top', async () => {
    const sse = await ask({ threadId: first, message: 'Did cost matter more than awareness?' });
    expect(done(sse).threadId).toBe(first);
    const list = await threads();
    expect(list.map((t) => t.id)).toEqual([first, second]);
    expect(list[0]?.questions).toBe(3);
  });

  it('a thumbs in a named chat stays on that answer and does not reorder the list', async () => {
    const view = (await (await h.api(`/chat/${documentId}?threadId=${second}`)).json()) as {
      turns: Array<{ id: string; role: string; rating?: number }>;
    };
    const answer = view.turns.find((t) => t.role === 'assistant');
    const rated = await h.api(`/chat/${documentId}/turns/${answer?.id}/rating`, {
      method: 'POST',
      body: JSON.stringify({ rating: 1, threadId: second }),
    });
    expect(rated.status).toBe(200);
    // Found by the answer's id when the chat is not named.
    const again = await h.api(`/chat/${documentId}/turns/${answer?.id}/rating`, {
      method: 'POST',
      body: JSON.stringify({ rating: -1 }),
    });
    expect(again.status).toBe(200);
    const after = (await (await h.api(`/chat/${documentId}?threadId=${second}`)).json()) as {
      turns: Array<{ id: string; rating?: number }>;
    };
    expect(after.turns.find((t) => t.id === answer?.id)?.rating).toBe(-1);
    expect((await threads()).map((t) => t.id)).toEqual([first, second]);
  });

  it('refuses a chat that is not this thesis’s, and a bad id, before any unit', async () => {
    const elsewhere = await h.prisma.chatThread.create({
      data: { documentId: otherDocumentId, title: 'Elsewhere', turns: [] },
    });
    expect((await ask({ threadId: elsewhere.id })).status).toBe(404);
    expect((await h.api(`/chat/${documentId}?threadId=${elsewhere.id}`)).status).toBe(404);
    expect((await h.api(`/chat/${documentId}?threadId=nope`)).status).toBe(400);
    expect((await ask({ threadId: first, newThread: true })).status).toBe(400);
    expect(await units()).toBe(0);
  });

  it('deletes one chat on request, and only that one', async () => {
    // `{}`: the harness sends JSON's content-type on every call, and Fastify refuses an empty JSON
    // body. The web's `api()` sets the type only when there is a body, so it sends none.
    const res = await h.api(`/chat/${documentId}/threads/${second}`, {
      method: 'DELETE',
      body: '{}',
    });
    expect(res.status).toBe(200);
    expect((await threads()).map((t) => t.id)).toEqual([first]);
    expect((await h.api(`/chat/${documentId}?threadId=${second}`)).status).toBe(404);
    expect(
      (await h.api(`/chat/${documentId}/threads/${second}`, { method: 'DELETE', body: '{}' }))
        .status,
    ).toBe(404);
  });
});

describe('a chat on one collection', () => {
  let shelf: string;

  it('answers from the collection’s papers alone, for one CHAT unit', async () => {
    // "On" would search on every question in a whole-library chat (ADR-0081); never here.
    await h.prisma.user.update({
      where: { id: h.userId },
      data: { settings: { searchBeyondLibrary: 'on' } },
    });
    const sse = await ask({ newThread: true, collectionId: methods });
    expect(sse.status).toBe(200);
    const answer = done(sse);
    expect(answer.outcome).toBe('answered');
    expect(answer.passagesUsed).toBe(1);
    const citations = answer.citations as Array<{ sourceId: string }>;
    expect(citations.length).toBeGreaterThan(0);
    for (const c of citations) expect(c.sourceId).toBe(surveyPaper);
    expect(search).not.toHaveBeenCalled();
    expect(searchPlan).not.toHaveBeenCalled();
    expect(sse.events.some((e) => e.event === 'step' && e.data.id === 'research')).toBe(false);
    expect(await units()).toBe(1);

    shelf = String(answer.threadId);
    const list = await threads();
    expect(list[0]).toMatchObject({
      id: shelf,
      collection: { id: methods, name: 'Methods' },
      collectionDeleted: false,
    });
    const view = (await (await h.api(`/chat/${documentId}?threadId=${shelf}`)).json()) as {
      collection: { name: string } | null;
    };
    expect(view.collection?.name).toBe('Methods');

    // The same question on the whole library reads both papers.
    await h.prisma.user.update({
      where: { id: h.userId },
      data: { settings: { searchBeyondLibrary: 'off' } },
    });
    const whole = done(await ask({ newThread: true }));
    expect(whole.passagesUsed).toBe(2);
    expect(costPaper).toBeTruthy();
  });

  it('continues on the collection when asked again in it', async () => {
    const sse = await ask({ threadId: shelf, message: 'How many installers were surveyed?' });
    const answer = done(sse);
    expect(answer.threadId).toBe(shelf);
    for (const c of answer.citations as Array<{ sourceId: string }>) {
      expect(c.sourceId).toBe(surveyPaper);
    }
  });

  it('is not deep research: an ordinary question on the CHAT unit', async () => {
    await h.prisma.user.update({
      where: { id: h.userId },
      data: { settings: { searchBeyondLibrary: 'ask' } },
    });
    const sse = await ask({ threadId: shelf, deep: true });
    expect(done(sse).outcome).toBe('answered');
    expect(await units('RESEARCH')).toBe(0);
    expect(await units('CHAT')).toBe(1);
  });

  it('refuses, before any unit, what would reach past the collection', async () => {
    const refused = [
      await ask({ threadId: shelf, scope: 'beyond' }),
      await ask({ threadId: shelf, scope: 'document' }),
      await ask({ threadId: shelf, sourceIds: [costPaper] }),
      await ask({ newThread: true, collectionId: empty }),
      await ask({ collectionId: methods }),
    ];
    expect(refused.map((r) => r.status)).toEqual([400, 400, 400, 400, 400]);
    expect(refused[0]?.problem?.detail).toContain('only from the collection “Methods”');
    expect(refused[3]?.problem?.detail).toContain('“Empty shelf” has no papers yet');
    expect((await ask({ newThread: true, collectionId: foreign })).status).toBe(404);
    expect(await units()).toBe(0);
    expect(search).not.toHaveBeenCalled();
  });

  it('an off-topic question is refused in the collection’s words, free, with no offer to search', async () => {
    vi.spyOn(providers.embeddings, 'embed').mockImplementation(async (texts) =>
      texts.map(() => OFF),
    );
    const sse = await ask({ threadId: shelf, message: 'What is the weather in Chennai today?' });
    const answer = done(sse);
    expect(answer.outcome).toBe('off-topic');
    expect(String(answer.text)).toContain('only from the papers in the collection “Methods”');
    expect(answer.offerBeyond).toBeUndefined();
    expect(answer.threadId).toBe(shelf);
    expect(await units()).toBe(0);
    expect(search).not.toHaveBeenCalled();
  });

  it('a whole-library chat still offers the search under the same refusal (Ask first)', async () => {
    vi.spyOn(providers.embeddings, 'embed').mockImplementation(async (texts) =>
      texts.map(() => OFF),
    );
    await h.prisma.user.update({ where: { id: h.userId }, data: { settings: {} } });
    const answer = done(await ask({ newThread: true, message: 'What is the weather in Chennai?' }));
    expect(answer.outcome).toBe('off-topic');
    expect(answer.offerBeyond).toBe(true);
    // A refused new chat is not a row.
    expect(answer.threadId).toBeUndefined();
  });

  it('says so when its collection is deleted: readable, not askable', async () => {
    const res = await h.api(`/collections/${methods}`, { method: 'DELETE', body: '{}' });
    expect(res.status).toBeLessThan(300);
    const view = (await (await h.api(`/chat/${documentId}?threadId=${shelf}`)).json()) as {
      collection: unknown;
      collectionDeleted: boolean;
      collectionName: string | null;
      turns: unknown[];
    };
    expect(view.collection).toBeNull();
    expect(view.collectionDeleted).toBe(true);
    // Still named, so the panel can say which collection it was.
    expect(view.collectionName).toBe('Methods');
    expect(view.turns.length).toBeGreaterThan(0);
    expect((await threads()).find((t) => t.id === shelf)?.collectionDeleted).toBe(true);

    const refused = await ask({ threadId: shelf });
    expect(refused.status).toBe(409);
    expect(refused.problem?.detail).toContain('“Methods”, which has been deleted');
    expect(await units()).toBe(0);
  });
});
