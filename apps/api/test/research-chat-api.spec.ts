/**
 * A research question with no thesis, through the API — ADR-0132.
 *
 * The real application on Postgres and Redis with the mock model. As in `chat-beyond-api.spec.ts`
 * the scholarly search is a spy on `WebScopeService.search`, and the embedding vectors are handed
 * out by the test, so "near the question" is decided here rather than by the mock's hash. Pinned:
 * the CHAT unit is taken before the provider is called and refunded on every refusal after it,
 * the relevance floor, the setting, ownership (404), "All my theses" (only the student's own,
 * never an archived one, every citation naming its thesis, only passages sent are cited), and
 * that erasing the account erases these chats.
 */

import type { LlmRequest, Providers } from '@tc/ai';
import { EMBEDDING_DIMENSIONS, type RawClient, replaceSourceChunks } from '@tc/retrieval';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeletionService } from '../src/modules/account/deletion.service.js';
import { PROVIDERS } from '../src/modules/ai/ai.module.js';
import { type WebResult, WebScopeService } from '../src/modules/assist/web-scope.service.js';
import { periodFor } from '../src/modules/usage/usage.service.js';
import { type Harness, startHarness } from './_harness.js';

let h: Harness;
let providers: Providers;
let search: ReturnType<typeof vi.spyOn>;
let otherUserId: string;

const QUESTION = 'What limits rooftop solar adoption among rural households?';

const ON = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === 0 ? 1 : 0));
const OFF = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === 1 ? 1 : 0));

function paper(i: number, over: Partial<WebResult> = {}): WebResult {
  return {
    title: `Rooftop solar adoption study ${i}`,
    matchedPassage: null,
    abstract:
      `Study ${i} surveyed rural households about rooftop solar adoption. Upfront cost limits ` +
      'adoption more than any other factor the households reported.',
    year: 2021,
    venue: 'Energy Policy',
    doi: `10.1000/nothesis.${i}`,
    citationCount: 4,
    isPreprint: false,
    openAccess: true,
    inLibrary: false,
    via: 'openalex',
    reference: {
      raw: `Rooftop solar adoption study ${i}. Energy Policy`,
      doi: `10.1000/nothesis.${i}`,
    },
    ...over,
  };
}

type Sse = {
  events: Array<{ event: string; data: Record<string, unknown> }>;
  status: number;
  problem?: Record<string, unknown>;
};

async function ask(body: Record<string, unknown> = {}): Promise<Sse> {
  const res = await h.api('/research-chats/ask', {
    method: 'POST',
    body: JSON.stringify({ message: QUESTION, ...body }),
  });
  if (!res.headers.get('content-type')?.includes('text/event-stream')) {
    return {
      status: res.status,
      events: [],
      problem: (await res.json()) as Record<string, unknown>,
    };
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
const steps = (sse: Sse) => sse.events.filter((e) => e.event === 'step').map((e) => e.data.text);

async function chatUnits(userId = h.userId): Promise<number> {
  const row = await h.prisma.usageLedger.findFirst({
    where: { userId, action: 'CHAT', period: periodFor() },
  });
  return row?.count ?? 0;
}

/** The question and then each text: ON or OFF by the text's index (0 is the question). */
function embedAs(onTopic: (index: number) => boolean) {
  vi.spyOn(providers.embeddings, 'embedWithUsage').mockImplementation(async (texts) => ({
    vectors: texts.map((_, i) => (i === 0 || onTopic(i - 1) ? ON : OFF)),
    tokens: texts.length * 50,
  }));
}

/** The model calls made so far. */
function modelCalls(): LlmRequest[] {
  return (providers.llm as unknown as { calls: LlmRequest[] }).calls;
}

async function thesisWithPaper(
  ownerId: string,
  title: string,
  text: string,
  over: { archivedAt?: Date } = {},
): Promise<{ documentId: string; sourceId: string }> {
  const document = await h.prisma.document.create({
    data: { ownerId, title, entryPath: 'A_TOPIC', ...over },
  });
  const source = await h.prisma.source.create({
    data: {
      documentId: document.id,
      status: 'RESOLVED',
      title: `${title}: the paper`,
      authors: [{ family: 'Rao', given: 'S' }],
      year: 2022,
      doi: `10.1000/${document.id.slice(0, 8)}`,
      groundingLevel: 'FULL_TEXT',
    },
  });
  await replaceSourceChunks(h.prisma as unknown as RawClient, source.id, [
    {
      sourceId: source.id,
      ordinal: 0,
      text,
      tokenCount: 20,
      page: 4,
      charStart: 0,
      charEnd: text.length,
      section: 'Findings',
      embedding: ON,
    },
  ]);
  return { documentId: document.id, sourceId: source.id };
}

beforeAll(async () => {
  h = await startHarness('research-chat@example.com');
  providers = h.app.get<Providers>(PROVIDERS);
  const other = await h.prisma.user.create({ data: { email: 'someone-else@example.com' } });
  otherUserId = other.id;
}, 300_000);

beforeEach(() => {
  vi.restoreAllMocks();
  search = vi.spyOn(h.app.get(WebScopeService), 'search');
  search.mockResolvedValue({ query: QUESTION, results: [paper(1), paper(2), paper(3)] });
  embedAs(() => true);
});

afterAll(async () => {
  await h?.stop();
});

describe('a question with no thesis, from the literature', () => {
  it('takes the CHAT unit before the model is called, answers from the abstracts and keeps the chat', async () => {
    const before = await chatUnits();
    let unitsWhenCalled = -1;
    const original = providers.llm.stream.bind(providers.llm);
    vi.spyOn(providers.llm, 'stream').mockImplementation((request) => {
      return (async function* () {
        unitsWhenCalled = await chatUnits();
        yield* original(request);
      })();
    });

    const sse = await ask();
    expect(sse.status).toBe(200);
    expect(unitsWhenCalled).toBe(before + 1);
    expect(await chatUnits()).toBe(before + 1);
    expect(search).toHaveBeenCalledWith(h.userId, null, QUESTION, expect.anything(), 20);
    expect(steps(sse)).toEqual([
      expect.stringMatching(/^Searching OpenAlex/),
      'Reading 3 abstracts',
      'Writing the answer',
    ]);
    const answer = done(sse);
    expect(answer.outcome).toBe('answered');
    const citations = answer.citations as Array<{ key: string; beyond?: { inLibrary: boolean } }>;
    expect(citations.length).toBeGreaterThan(0);
    for (const c of citations) {
      expect(c.key).toMatch(/^Sweb[1-3]#cabstract$/);
      expect(c.beyond?.inLibrary).toBe(false);
    }
    // No thesis was written to, and the call is logged without one.
    const logged = await h.prisma.aiCallLog.findFirst({
      where: { userId: h.userId, action: 'CHAT' },
      orderBy: { createdAt: 'desc' },
    });
    expect(logged?.documentId).toBeNull();

    const chatId = answer.threadId as string;
    const list = (await (await h.api('/research-chats')).json()) as {
      chats: Array<{ id: string; title: string; questions: number }>;
    };
    expect(list.chats[0]).toMatchObject({ id: chatId, title: QUESTION, questions: 1 });
    const view = (await (await h.api(`/research-chats/${chatId}`)).json()) as {
      turns: unknown[];
      papers: Array<{ reference: { doi?: string } }>;
      suggestedTitle: string;
    };
    expect(view.turns).toHaveLength(2);
    expect(view.suggestedTitle).toBe(QUESTION);
    expect(view.papers.length).toBe(citations.length);

    // A second question continues it.
    const again = await ask({ chatId });
    expect(done(again).threadId).toBe(chatId);
  });

  it('refuses for nothing when nothing the search found is near the question (the relevance floor)', async () => {
    embedAs(() => false);
    const before = await chatUnits();
    const calls = modelCalls().length;
    const sse = await ask();
    expect(done(sse).outcome).toBe('off-topic');
    expect(String(done(sse).text)).toMatch(/^Nothing the search found relates to that/);
    expect(await chatUnits()).toBe(before);
    expect(modelCalls().length).toBe(calls);
  });

  it('drops the abstracts under the floor and cites only those it sent', async () => {
    embedAs((i) => i !== 1);
    const sse = await ask();
    const answer = done(sse);
    expect(answer.passagesUsed).toBe(2);
    for (const c of answer.citations as Array<{ key: string }>) {
      expect(c.key).not.toBe('Sweb2#cabstract');
    }
  });

  it('refunds when the search has nothing with an abstract, and when it fails', async () => {
    const before = await chatUnits();
    search.mockResolvedValue({ query: QUESTION, results: [paper(1, { abstract: null })] });
    expect(done(await ask()).outcome).toBe('beyond-empty');
    search.mockRejectedValue(new Error('index down'));
    const failed = await ask();
    expect(failed.events.some((e) => e.event === 'error')).toBe(true);
    expect(await chatUnits()).toBe(before);
  });

  it('is refused before the unit when the student turned the search off', async () => {
    await h.api('/settings', {
      method: 'PUT',
      body: JSON.stringify({ searchBeyondLibrary: 'off' }),
    });
    const before = await chatUnits();
    const sse = await ask();
    expect(sse.status).toBe(403);
    expect(await chatUnits()).toBe(before);
    await h.api('/settings', {
      method: 'PUT',
      body: JSON.stringify({ searchBeyondLibrary: 'ask' }),
    });
  });

  it('at the cap answers 429 and never calls the model', async () => {
    const period = periodFor();
    const was = await chatUnits();
    await h.prisma.usageLedger.upsert({
      where: { userId_period_action: { userId: h.userId, period, action: 'CHAT' } },
      create: { userId: h.userId, period, action: 'CHAT', count: 100_000 },
      update: { count: 100_000 },
    });
    const calls = modelCalls().length;
    const sse = await ask();
    expect(sse.status).toBe(429);
    expect(modelCalls().length).toBe(calls);
    expect(search).not.toHaveBeenCalled();
    await h.prisma.usageLedger.update({
      where: { userId_period_action: { userId: h.userId, period, action: 'CHAT' } },
      data: { count: was },
    });
  });
});

describe('ownership', () => {
  it("another student's chat is a 404 to read, rename, delete or continue", async () => {
    const theirs = await h.prisma.researchChat.create({
      data: { userId: otherUserId, title: 'Their question', turns: [] },
    });
    expect((await h.api(`/research-chats/${theirs.id}`)).status).toBe(404);
    expect(
      (
        await h.api(`/research-chats/${theirs.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ title: 'Mine now' }),
        })
      ).status,
    ).toBe(404);
    expect(
      (await h.api(`/research-chats/${theirs.id}`, { method: 'DELETE', body: '{}' })).status,
    ).toBe(404);
    const before = await chatUnits();
    expect((await ask({ chatId: theirs.id })).status).toBe(404);
    expect(await chatUnits()).toBe(before);
    const list = (await (await h.api('/research-chats')).json()) as {
      chats: Array<{ id: string }>;
    };
    expect(list.chats.map((c) => c.id)).not.toContain(theirs.id);
    expect((await h.api('/research-chats/not-a-uuid')).status).toBe(400);
  });

  it('the student renames and deletes their own', async () => {
    const mine = await h.prisma.researchChat.create({
      data: { userId: h.userId, title: 'Old name', turns: [] },
    });
    const renamed = await h.api(`/research-chats/${mine.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: '  New   name ' }),
    });
    expect(((await renamed.json()) as { title: string }).title).toBe('New name');
    expect(
      (await h.api(`/research-chats/${mine.id}`, { method: 'DELETE', body: '{}' })).status,
    ).toBe(200);
    expect((await h.api(`/research-chats/${mine.id}`)).status).toBe(404);
  });
});

describe('all my theses', () => {
  it('is refused for nothing when no thesis has a readable paper', async () => {
    const before = await chatUnits();
    const sse = await ask({ source: 'theses' });
    expect(sse.status).toBe(400);
    expect(await chatUnits()).toBe(before);
  });

  it("answers from the student's own non-archived theses only, each citation naming its thesis", async () => {
    const first = await thesisWithPaper(
      h.userId,
      'Rooftop solar in Karnataka',
      'In a survey of 312 rural households, upfront cost was the main barrier to rooftop solar.',
    );
    const second = await thesisWithPaper(
      h.userId,
      'Credit for clean energy',
      'Households without access to credit adopted rooftop solar at half the rate of others.',
    );
    const archived = await thesisWithPaper(
      h.userId,
      'An archived thesis',
      'ARCHIVED passage that must never be sent.',
      { archivedAt: new Date() },
    );
    const someoneElses = await thesisWithPaper(
      otherUserId,
      'Someone else’s thesis',
      'FOREIGN passage that must never be sent.',
    );

    const before = await chatUnits();
    const calls = modelCalls().length;
    const sse = await ask({ source: 'theses' });
    expect(sse.status).toBe(200);
    expect(await chatUnits()).toBe(before + 1);
    expect(search).not.toHaveBeenCalled();
    expect(steps(sse)).toEqual([
      'Searching your 2 theses…',
      'Reading 2 passages from 2 theses',
      'Writing the answer',
    ]);

    const request = modelCalls()[calls];
    const sent = JSON.stringify(request?.messages ?? []);
    expect(sent).toContain('upfront cost was the main barrier');
    expect(sent).toContain('without access to credit');
    expect(sent).not.toContain('ARCHIVED passage');
    expect(sent).not.toContain('FOREIGN passage');

    const answer = done(sse);
    expect(answer.across).toBe(true);
    const citations = answer.citations as Array<{
      key: string;
      sourceId: string;
      thesis?: { id: string; title: string };
      paper?: { inLibrary: boolean };
    }>;
    expect(citations.length).toBeGreaterThan(0);
    const mine = new Map([
      [first.documentId, 'Rooftop solar in Karnataka'],
      [second.documentId, 'Credit for clean energy'],
    ]);
    for (const c of citations) {
      expect(c.key).toMatch(/^S\d+#c\d+$/);
      expect(mine.get(c.thesis?.id ?? '')).toBe(c.thesis?.title);
      expect([first.sourceId, second.sourceId]).toContain(c.sourceId);
      expect(c.sourceId).not.toBe(archived.sourceId);
      expect(c.sourceId).not.toBe(someoneElses.sourceId);
    }
  });

  it('refuses for nothing when nothing in the theses is near the question', async () => {
    vi.spyOn(providers.embeddings, 'embedWithUsage').mockResolvedValue({
      vectors: [OFF],
      tokens: 10,
    });
    const before = await chatUnits();
    const calls = modelCalls().length;
    const sse = await ask({ source: 'theses' });
    expect(done(sse).outcome).toBe('off-topic');
    expect(await chatUnits()).toBe(before);
    expect(modelCalls().length).toBe(calls);
  });

  it('is not stopped by the literature search being turned off', async () => {
    await h.api('/settings', {
      method: 'PUT',
      body: JSON.stringify({ searchBeyondLibrary: 'off' }),
    });
    const sse = await ask({ source: 'theses' });
    expect(sse.status).toBe(200);
    await h.api('/settings', {
      method: 'PUT',
      body: JSON.stringify({ searchBeyondLibrary: 'ask' }),
    });
  });
});

describe('erasure', () => {
  it("erasing the account erases the student's research chats, and only theirs", async () => {
    const victim = await h.prisma.user.create({ data: { email: 'erase-me@example.com' } });
    await h.prisma.researchChat.create({ data: { userId: victim.id, title: 'Asked', turns: [] } });
    const kept = await h.prisma.researchChat.create({
      data: { userId: otherUserId, title: 'Stays', turns: [] },
    });
    await h.app.get(DeletionService).erase(victim.id);
    expect(await h.prisma.researchChat.count({ where: { userId: victim.id } })).toBe(0);
    expect(await h.prisma.researchChat.findUnique({ where: { id: kept.id } })).not.toBeNull();
  });
});
