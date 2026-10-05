/**
 * Chat beyond the library through the API — ADR-0060.
 *
 * The real application on Postgres and Redis with the mock model. The scholarly search itself is
 * replaced with a spy on `WebScopeService.search` — OpenAlex's free daily budget is not something
 * a test suite should spend, and its answers change — so what is pinned here is everything around
 * it: the setting, the one CHAT unit, the refund when the search has nothing to read, the steps,
 * and that the answer cites only the abstracts it was given.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { type WebResult, WebScopeService } from '../src/modules/assist/web-scope.service.js';
import { periodFor } from '../src/modules/usage/usage.service.js';
import { type Harness, startHarness } from './_harness.js';

let h: Harness;
let documentId: string;
let search: ReturnType<typeof vi.spyOn>;

const QUESTION = 'What limits rooftop solar adoption among households?';

function paper(i: number, over: Partial<WebResult> = {}): WebResult {
  return {
    title: `Rooftop solar adoption study ${i}`,
    matchedPassage: null,
    abstract:
      `Study ${i} surveyed households about rooftop solar adoption. Upfront cost limits adoption ` +
      'more than any other factor the households reported.',
    year: 2020 + (i % 5),
    venue: 'Energy Policy',
    doi: `10.1000/solar.${i}`,
    citationCount: 10,
    isPreprint: false,
    openAccess: true,
    inLibrary: false,
    via: 'openalex',
    reference: {
      raw: `Rooftop solar adoption study ${i}. Energy Policy`,
      doi: `10.1000/solar.${i}`,
    },
    ...over,
  };
}

type Sse = { events: Array<{ event: string; data: Record<string, unknown> }>; status: number };

async function ask(body: Record<string, unknown>): Promise<Sse & { problem?: unknown }> {
  const res = await h.api('/chat', {
    method: 'POST',
    body: JSON.stringify({ documentId, message: QUESTION, ...body }),
  });
  if (!res.headers.get('content-type')?.includes('text/event-stream')) {
    return { status: res.status, events: [], problem: await res.json() };
  }
  const text = await res.text();
  const events = text
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

async function chatUnits(): Promise<number> {
  const row = await h.prisma.usageLedger.findFirst({
    where: { userId: h.userId, action: 'CHAT', period: periodFor() },
  });
  return row?.count ?? 0;
}

async function setBeyond(value: unknown): Promise<Response> {
  return h.api('/settings', {
    method: 'PUT',
    body: JSON.stringify({ searchBeyondLibrary: value }),
  });
}

beforeAll(async () => {
  h = await startHarness('chat-beyond@example.com');
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
  // An empty library: every library question is refused by the relevance floor.
  search = vi.spyOn(h.app.get(WebScopeService), 'search');
}, 300_000);

beforeEach(() => {
  search.mockReset();
  search.mockResolvedValue({
    query: QUESTION,
    results: [paper(1, { abstract: null }), paper(2), paper(3, { inLibrary: true }), paper(4)],
  });
});

afterAll(async () => {
  await h?.stop();
});

describe('the setting', () => {
  it('is "ask first" until the student chooses, and refuses anything else', async () => {
    const settings = (await (await h.api('/settings')).json()) as Record<string, unknown>;
    expect(settings.searchBeyondLibrary).toBe('ask');
    expect((await setBeyond('sometimes')).status).toBe(400);
  });
});

describe('ask first (the default)', () => {
  it('a refused library question offers the search, costs nothing, and searches nothing', async () => {
    const before = await chatUnits();
    const sse = await ask({});
    expect(done(sse).outcome).toBe('off-topic');
    expect(done(sse).offerBeyond).toBe(true);
    expect(search).not.toHaveBeenCalled();
    expect(await chatUnits()).toBe(before);
  });

  it('pressing it answers from the abstracts, with the steps, for one CHAT unit', async () => {
    const before = await chatUnits();
    const sse = await ask({ scope: 'beyond' });
    expect(sse.status).toBe(200);
    expect(steps(sse)).toEqual([
      expect.stringMatching(/^Searching OpenAlex.*…$/),
      'Reading 3 abstracts',
      'Writing the answer',
    ]);
    const answer = done(sse);
    expect(answer.outcome).toBe('answered');
    expect(answer.passagesUsed).toBe(3);
    expect(answer.beyond).toEqual({
      papers: 3,
      outsideLibrary: 2,
      note: 'From the abstracts of 3 papers, 2 not in your library — add the ones you use.',
    });
    const citations = answer.citations as Array<{
      key: string;
      sourceId: string;
      beyond?: { title: string; inLibrary: boolean; reference: { doi?: string } };
    }>;
    expect(citations.length).toBeGreaterThan(0);
    for (const c of citations) {
      // Only the abstracts that were sent, never the record that had none.
      expect(c.key).toMatch(/^Sweb[1-3]#cabstract$/);
      expect(c.sourceId).toBe('');
      expect(c.beyond?.title).not.toBe('Rooftop solar adoption study 1');
      expect(c.beyond?.reference.doi).toMatch(/^10\.1000\/solar\./);
    }
    expect(await chatUnits()).toBe(before + 1);
    expect(search).toHaveBeenCalledOnce();

    // The thread keeps it, with the papers, so Add still works after a reload.
    const history = (await (await h.api(`/chat/${documentId}`)).json()) as {
      turns: Array<{ role: string; beyond?: unknown; citations?: Array<{ beyond?: unknown }> }>;
    };
    const stored = history.turns.at(-1);
    expect(stored?.beyond).toBeTruthy();
    expect(stored?.citations?.[0]?.beyond).toBeTruthy();
  });

  it('refunds the unit when nothing the search returned has an abstract', async () => {
    search.mockResolvedValue({
      query: QUESTION,
      results: [paper(1, { abstract: null }), paper(2, { abstract: 'Abstract not available.' })],
    });
    const before = await chatUnits();
    const sse = await ask({ scope: 'beyond' });
    expect(done(sse).outcome).toBe('beyond-empty');
    expect(steps(sse)).toHaveLength(1);
    expect(await chatUnits()).toBe(before);
  });

  it('refunds the unit when the search fails', async () => {
    search.mockRejectedValue(new Error('index down'));
    const before = await chatUnits();
    const sse = await ask({ scope: 'beyond' });
    expect(sse.events.some((e) => e.event === 'error')).toBe(true);
    expect(await chatUnits()).toBe(before);
  });
});

describe('on', () => {
  it('a library question with nothing in the library goes straight to the search', async () => {
    expect((await setBeyond('on')).status).toBe(200);
    const before = await chatUnits();
    const sse = await ask({});
    // ADR-0073: the library is searched first (one step), then the three beyond-the-library steps.
    expect(steps(sse)).toHaveLength(4);
    expect(done(sse).outcome).toBe('answered');
    expect(done(sse).beyond).toBeTruthy();
    expect(done(sse).offerBeyond).toBeUndefined();
    // Still one unit for the question, not one for the refusal and one for the search.
    expect(await chatUnits()).toBe(before + 1);
  });
});

describe('off', () => {
  it('never offers it, and refuses the scope before taking a unit', async () => {
    expect((await setBeyond('off')).status).toBe(200);
    const before = await chatUnits();
    const refused = await ask({});
    expect(done(refused).outcome).toBe('off-topic');
    expect(done(refused).offerBeyond).toBeUndefined();

    const direct = await ask({ scope: 'beyond' });
    expect(direct.status).toBe(403);
    expect(search).not.toHaveBeenCalled();
    expect(await chatUnits()).toBe(before);
  });
});

describe('the cap', () => {
  it('a student at the CHAT cap is refused before the search runs', async () => {
    await setBeyond('ask');
    await h.prisma.usageLedger.upsert({
      where: { userId_period_action: { userId: h.userId, period: periodFor(), action: 'CHAT' } },
      create: { userId: h.userId, period: periodFor(), action: 'CHAT', count: 1_000 },
      update: { count: 1_000 },
    });
    const sse = await ask({ scope: 'beyond' });
    expect(sse.status).toBe(429);
    expect(search).not.toHaveBeenCalled();
  });
});
