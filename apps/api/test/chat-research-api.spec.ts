/**
 * Chat that researches when the library is thin, through the API — ADR-0074.
 *
 * The real application on Postgres and Redis with the mock model. Two things are replaced, as in
 * `chat-beyond-api.spec.ts`: the scholarly search (`WebScopeService.searchPlan` — the indexes'
 * answers change and their budgets are not for tests), and the embedding vectors, so that "on
 * topic" is decided by the test rather than by the mock's hash. Pinned here: the steps, the one
 * CHAT unit, the EMBED row that puts the research's spend under the ₹100 ceiling, the refund when
 * the answer fails, that only passages in the request are cited, and the cases that must not
 * search at all.
 */

import type { Providers } from '@tc/ai';
import { EMBEDDING_DIMENSIONS, type RawClient, replaceSourceChunks } from '@tc/retrieval';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROVIDERS } from '../src/modules/ai/ai.module.js';
import { type WebResult, WebScopeService } from '../src/modules/assist/web-scope.service.js';
import { periodFor } from '../src/modules/usage/usage.service.js';
import { type Harness, startHarness } from './_harness.js';

let h: Harness;
let documentId: string;
let sourceId: string;
let providers: Providers;
let searchPlan: ReturnType<typeof vi.spyOn>;

const QUESTION = 'What are the financial barriers to rooftop solar adoption for rural households?';

/** "On the question" and "nowhere near it", as the embedding spy hands them out. */
const ON = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === 0 ? 1 : 0));
const OFF = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === 1 ? 1 : 0));

function found(i: number, over: Partial<WebResult> = {}): WebResult {
  return {
    title: `Financial barriers to rooftop solar adoption study ${i}`,
    abstract:
      `Study ${i} surveyed rural households about rooftop solar adoption. Financial barriers, ` +
      'upfront cost and the lack of credit, limited adoption more than any other factor.',
    matchedPassage: null,
    year: 2021,
    venue: 'Energy Policy',
    doi: `10.1000/research.${i}`,
    citationCount: 3,
    isPreprint: false,
    openAccess: true,
    inLibrary: false,
    via: 'openalex',
    reference: { raw: `Financial barriers study ${i}`, doi: `10.1000/research.${i}` },
    ...over,
  };
}

type Sse = { events: Array<{ event: string; data: Record<string, unknown> }>; status: number };

async function ask(body: Record<string, unknown> = {}): Promise<Sse> {
  const res = await h.api('/chat', {
    method: 'POST',
    body: JSON.stringify({ documentId, message: QUESTION, ...body }),
  });
  if (!res.headers.get('content-type')?.includes('text/event-stream')) {
    return { status: res.status, events: [] };
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
const stepIds = (sse: Sse) => sse.events.filter((e) => e.event === 'step').map((e) => e.data.id);
const stepTexts = (sse: Sse) =>
  sse.events.filter((e) => e.event === 'step').map((e) => String(e.data.text));

async function chatUnits(): Promise<number> {
  const row = await h.prisma.usageLedger.findFirst({
    where: { userId: h.userId, action: 'CHAT', period: periodFor() },
  });
  return row?.count ?? 0;
}

/** Candidates' vectors: the question first, then each candidate ON or OFF by its index. */
function embedAs(onTopic: (index: number) => boolean) {
  vi.spyOn(providers.embeddings, 'embedWithUsage').mockImplementation(async (texts) => ({
    vectors: texts.map((_, i) => (i === 0 || onTopic(i - 1) ? ON : OFF)),
    tokens: texts.length * 100,
  }));
}

beforeAll(async () => {
  h = await startHarness('chat-research@example.com');
  providers = h.app.get<Providers>(PROVIDERS);
  const document = await h.prisma.document.create({
    data: { ownerId: h.userId, title: 'Rooftop solar in Karnataka', entryPath: 'A_TOPIC' },
  });
  documentId = document.id;
  await h.prisma.chapter.create({
    data: {
      documentId,
      outlineNodeId: 'n1',
      title: 'Literature Review',
      scopeNote: 'Household adoption of rooftop solar.',
      order: 1,
      content: { type: 'doc', content: [] },
    },
  });
  // One paper, one passage: on the question, and thin for it.
  const source = await h.prisma.source.create({
    data: {
      documentId,
      status: 'RESOLVED',
      title: 'Solar adoption in rural Karnataka',
      authors: [{ family: 'Kumar', given: 'A' }],
      year: 2021,
      groundingLevel: 'ABSTRACT',
    },
  });
  sourceId = source.id;
  await replaceSourceChunks(h.prisma as unknown as RawClient, source.id, [
    {
      sourceId: source.id,
      ordinal: 0,
      text: 'In a survey of 312 rural households, upfront cost was the main financial barrier to rooftop solar adoption.',
      tokenCount: 20,
      page: 7,
      charStart: 0,
      charEnd: 100,
      section: 'Findings',
      embedding: ON,
    },
  ]);
  searchPlan = vi.spyOn(h.app.get(WebScopeService), 'searchPlan');
}, 300_000);

beforeEach(async () => {
  vi.restoreAllMocks();
  searchPlan = vi.spyOn(h.app.get(WebScopeService), 'searchPlan');
  searchPlan.mockResolvedValue([found(1), found(2), found(3), found(4, { abstract: null })]);
  // Retrieval's query vector: on the question, so the library passage is on topic.
  vi.spyOn(providers.embeddings, 'embed').mockImplementation(async (texts) => texts.map(() => ON));
  embedAs((i) => i !== 2);
  await h.prisma.user.update({ where: { id: h.userId }, data: { settings: {} } });
  // The trial's CHAT cap is five; each test starts with the month unused.
  await h.prisma.usageLedger.deleteMany({ where: { userId: h.userId, action: 'CHAT' } });
});

afterAll(async () => {
  await h?.stop();
});

describe('a thin library, the student having pressed Allow this time', () => {
  it('searches, reads, keeps what is on the question, and answers from both, for one CHAT unit', async () => {
    const before = await chatUnits();
    const embedRows = await h.prisma.aiCallLog.count({ where: { action: 'EMBED' } });
    const sse = await ask({ research: 'allow' });
    expect(sse.status).toBe(200);

    expect(stepIds(sse)).toEqual([
      'search',
      'read',
      'research',
      'query',
      'query',
      'query',
      'read',
      'kept',
      'write',
    ]);
    const texts = stepTexts(sse);
    expect(texts[2]).toBe(
      'Your library has 1 paper on this, so I am searching the literature too…',
    );
    expect(texts[3]).toMatch(/^Searching OpenAlex for: What are the financial barriers/);
    expect(texts[4]).toBe(
      'Searching OpenAlex, PubMed and arXiv for: financial barriers rooftop solar adoption rural households…',
    );
    expect(texts[6]).toBe('Reading 3 abstracts…');
    expect(texts[7]).toBe('2 of 3 are on your question');
    expect(texts[8]).toBe('Writing the answer…');

    const answer = done(sse);
    expect(answer.outcome).toBe('answered');
    expect(answer.passagesUsed).toBe(3);
    expect(answer.research).toEqual({
      papers: 2,
      queries: [
        'financial barriers rooftop solar adoption rural households',
        'financial barriers rooftop solar',
      ],
      note: 'From 1 paper in your library and the abstracts of 2 found by a search, not in your library — add the ones you use.',
    });

    // Only what was in the request: the library passage and the two kept abstracts.
    const citations = answer.citations as Array<{
      key: string;
      sourceId: string;
      beyond?: { title: string; inLibrary: boolean };
    }>;
    expect(citations.length).toBeGreaterThan(0);
    for (const c of citations) {
      if (c.beyond) {
        expect(c.key).toMatch(/^Sweb[12]#cabstract$/);
        expect(c.sourceId).toBe('');
        expect(c.beyond.title).not.toMatch(/study [34]$/);
        expect(c.beyond.inLibrary).toBe(false);
      } else {
        expect(c.sourceId).toBe(sourceId);
      }
    }
    expect(citations.some((c) => c.beyond)).toBe(true);

    // One unit for the question; the research's embedding is its own EMBED row, so the ₹100
    // ceiling counts it; the answer is on the configured chat tier (strong by default).
    expect(await chatUnits()).toBe(before + 1);
    expect(await h.prisma.aiCallLog.count({ where: { action: 'EMBED' } })).toBe(embedRows + 1);
    const chatLog = await h.prisma.aiCallLog.findFirst({
      where: { action: 'CHAT', userId: h.userId },
      orderBy: { createdAt: 'desc' },
    });
    expect(chatLog?.model).toBe('mock-strong');
    expect(searchPlan).toHaveBeenCalledOnce();

    // The thread keeps it, so Add still works after a reload.
    const history = (await (await h.api(`/chat/${documentId}`)).json()) as {
      turns: Array<{ research?: unknown; citations?: Array<{ beyond?: unknown }> }>;
    };
    expect(history.turns.at(-1)?.research).toBeTruthy();
  });

  it('when nothing found is on the question, it answers from the library and says so', async () => {
    embedAs(() => false);
    const before = await chatUnits();
    const sse = await ask({ research: 'allow' });
    expect(stepTexts(sse)).toContain(
      'None of them is close enough to your question; answering from your library',
    );
    expect(done(sse).research).toBeUndefined();
    expect(done(sse).passagesUsed).toBe(1);
    expect(await chatUnits()).toBe(before + 1);
  });

  it('a failed search does not fail the question: the library answers, on one unit', async () => {
    searchPlan.mockRejectedValue(new Error('every index down'));
    const before = await chatUnits();
    const sse = await ask({ research: 'allow' });
    expect(sse.events.some((e) => e.event === 'error')).toBe(false);
    expect(stepTexts(sse)).toContain(
      'The search did not answer in time; answering from your library',
    );
    expect(done(sse).outcome).toBe('answered');
    expect(await chatUnits()).toBe(before + 1);
  });

  it('refunds the unit when the answer itself fails after the research', async () => {
    vi.spyOn(providers.llm, 'stream').mockImplementation(() => {
      throw new Error('provider down');
    });
    const before = await chatUnits();
    const sse = await ask({ research: 'allow' });
    expect(sse.events.some((e) => e.event === 'error')).toBe(true);
    expect(await chatUnits()).toBe(before);
  });
});

// ADR-0116 amendment (QA 2026-10-08): under "Ask first" a thin library is offered, never searched
// unasked. The QA case: "What is a good recipe for a chocolate cake?" cleared the relevance floor
// on a thin heat-stress library, searched the web on its own and was charged.
describe('"Ask first" and a thin library', () => {
  it('stops before the model with the offer: nothing searched, nothing charged, nothing stored', async () => {
    const before = await chatUnits();
    const llm = vi.spyOn(providers.llm, 'stream');
    const sse = await ask({ newThread: true });
    expect(sse.status).toBe(200);
    expect(searchPlan).not.toHaveBeenCalled();
    expect(llm).not.toHaveBeenCalled();
    expect(stepIds(sse)).not.toContain('research');
    expect(stepIds(sse)).not.toContain('query');
    const offer = done(sse);
    expect(offer.outcome).toBe('research-offer');
    expect(offer.offerResearch).toBe(true);
    expect(offer.text).toBe(
      'Your library has 1 paper on this. I can search the literature too before answering, or answer from your library alone.',
    );
    expect(offer.threadId).toBeUndefined();
    expect(await chatUnits()).toBe(before);
  });

  it('Skip answers from the library alone, for one unit, and searches nothing', async () => {
    const before = await chatUnits();
    const sse = await ask({ research: 'skip' });
    expect(searchPlan).not.toHaveBeenCalled();
    expect(stepIds(sse)).not.toContain('research');
    expect(done(sse).outcome).toBe('answered');
    expect(done(sse).offerResearch).toBeUndefined();
    expect(done(sse).research).toBeUndefined();
    expect(await chatUnits()).toBe(before + 1);
  });

  it('"On" searches a thin library without asking', async () => {
    await h.api('/settings', {
      method: 'PUT',
      body: JSON.stringify({ searchBeyondLibrary: 'on' }),
    });
    const sse = await ask();
    expect(searchPlan).toHaveBeenCalledOnce();
    expect(done(sse).offerResearch).toBeUndefined();
    expect(stepIds(sse)).toContain('research');
  });

  it('a question with a file attached is answered without searching or asking', async () => {
    const upload = new FormData();
    upload.append(
      'file',
      new Blob(['Upfront cost limits rooftop solar in rural households.'], { type: 'text/plain' }),
      'notes.txt',
    );
    const res = await fetch(
      `${h.baseUrl}/api/v1/chat/attachments?documentId=${encodeURIComponent(documentId)}`,
      { method: 'POST', headers: { cookie: h.cookie }, body: upload },
    );
    expect(res.status).toBeLessThan(300);
    const { id } = (await res.json()) as { id: string };
    const sse = await ask({ attachmentIds: [id] });
    expect(searchPlan).not.toHaveBeenCalled();
    expect(done(sse).offerResearch).toBeUndefined();
  });
});

describe('when it must not search', () => {
  it('searching turned off in Settings: the library answers alone', async () => {
    await h.api('/settings', {
      method: 'PUT',
      body: JSON.stringify({ searchBeyondLibrary: 'off' }),
    });
    const sse = await ask();
    expect(sse.status).toBe(200);
    expect(searchPlan).not.toHaveBeenCalled();
    expect(stepIds(sse)).not.toContain('research');
    expect(done(sse).outcome).toBe('answered');
  });

  it('papers named with @: those papers are the whole ground', async () => {
    const sse = await ask({ sourceIds: [sourceId] });
    expect(sse.status).toBe(200);
    expect(done(sse).outcome).toBe('answered');
    expect(searchPlan).not.toHaveBeenCalled();
    expect(done(sse).research).toBeUndefined();
  });

  it('the document scope never searches', async () => {
    const sse = await ask({ scope: 'document' });
    expect(sse.status).toBe(200);
    expect(searchPlan).not.toHaveBeenCalled();
    expect(stepIds(sse)).not.toContain('research');
  });

  it('at the CHAT cap, nothing is searched and nothing is charged', async () => {
    await h.prisma.usageLedger.upsert({
      where: { userId_period_action: { userId: h.userId, period: periodFor(), action: 'CHAT' } },
      create: { userId: h.userId, period: periodFor(), action: 'CHAT', count: 1_000 },
      update: { count: 1_000 },
    });
    const sse = await ask();
    expect(sse.status).toBe(429);
    expect(searchPlan).not.toHaveBeenCalled();
    expect(await chatUnits()).toBe(1_000);
  });
});
