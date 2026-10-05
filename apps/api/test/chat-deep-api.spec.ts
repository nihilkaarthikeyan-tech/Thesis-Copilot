/**
 * Deep research in chat, through the API — ADR-0080.
 *
 * The real application on Postgres and Redis with the mock model, which plans from the question's
 * own words and answers from the passages in its prompt. Replaced, as in
 * `chat-research-api.spec.ts`: the scholarly search (`WebScopeService.searchPlan`) and the
 * embedding vectors. Pinned here: the steps in order, one `RESEARCH` unit (never a CHAT unit),
 * the two RESEARCH call-log rows and the EMBED row, a search per part, that only passages in the
 * request are cited, the plan on the stored turn, the refund when the answer fails and when
 * nothing was found, the cap (the trial's one question) refused before any call, and the cases
 * that are not deep research at all.
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

const QUESTION =
  'What stops rural women in India from using mobile banking, according to the research?';

const ON = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === 0 ? 1 : 0));
const OFF = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === 1 ? 1 : 0));

function found(i: number, over: Partial<WebResult> = {}): WebResult {
  return {
    title: `Mobile banking adoption among rural women study ${i}`,
    abstract:
      `Study ${i} surveyed rural women in Tamil Nadu about mobile banking. Low digital literacy, ` +
      'limited phone ownership and distrust of the app stopped most non-users from adopting it.',
    matchedPassage: null,
    year: 2022,
    venue: 'Journal of Rural Development',
    doi: `10.1000/deep.${i}`,
    citationCount: 4,
    isPreprint: false,
    openAccess: true,
    inLibrary: false,
    via: 'openalex',
    reference: { raw: `Mobile banking study ${i}`, doi: `10.1000/deep.${i}` },
    ...over,
  };
}

type Sse = { events: Array<{ event: string; data: Record<string, unknown> }>; status: number };

async function ask(body: Record<string, unknown> = {}): Promise<Sse> {
  const res = await h.api('/chat', {
    method: 'POST',
    body: JSON.stringify({ documentId, message: QUESTION, deep: true, ...body }),
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

async function units(action: 'CHAT' | 'RESEARCH'): Promise<number> {
  const row = await h.prisma.usageLedger.findFirst({
    where: { userId: h.userId, action, period: periodFor() },
  });
  return row?.count ?? 0;
}

async function logRows(action: 'RESEARCH' | 'EMBED' | 'CHAT'): Promise<number> {
  return h.prisma.aiCallLog.count({ where: { action, userId: h.userId } });
}

/** The question and the parts first (all ON), then each candidate ON or OFF by its index. */
function embedAs(onTopic: (index: number) => boolean) {
  vi.spyOn(providers.embeddings, 'embedWithUsage').mockImplementation(async (texts) => {
    const asked = texts.findIndex((t) =>
      /^Mobile banking adoption among rural women study/.test(t),
    );
    const head = asked < 0 ? texts.length : asked;
    return {
      vectors: texts.map((_, i) => (i < head || onTopic(i - head) ? ON : OFF)),
      tokens: texts.length * 100,
    };
  });
}

beforeAll(async () => {
  h = await startHarness('chat-deep@example.com');
  providers = h.app.get<Providers>(PROVIDERS);
  const document = await h.prisma.document.create({
    data: {
      ownerId: h.userId,
      title: 'Mobile banking and the financial inclusion of rural women in Tamil Nadu',
      entryPath: 'A_TOPIC',
    },
  });
  documentId = document.id;
  await h.prisma.chapter.create({
    data: {
      documentId,
      outlineNodeId: 'n1',
      title: 'Literature Review',
      scopeNote: 'How rural women take up mobile banking.',
      order: 1,
      content: { type: 'doc', content: [] },
    },
  });
  const source = await h.prisma.source.create({
    data: {
      documentId,
      status: 'RESOLVED',
      title: 'Fintech adoption by women in rural Virudhunagar',
      authors: [{ family: 'Mathivathana', given: 'P' }],
      year: 2025,
      groundingLevel: 'FULL_TEXT',
    },
  });
  sourceId = source.id;
  await replaceSourceChunks(h.prisma as unknown as RawClient, source.id, [
    {
      sourceId: source.id,
      ordinal: 0,
      text: 'Among rural women in Virudhunagar, adoption rose with schooling, from 11.1% of those with none to 72.2% of graduates.',
      tokenCount: 24,
      page: 6,
      charStart: 0,
      charEnd: 120,
      section: 'Findings',
      embedding: ON,
    },
    {
      sourceId: source.id,
      ordinal: 1,
      text: 'Over 70% of non-users said local-language support and a simpler interface would make them try mobile banking.',
      tokenCount: 22,
      page: 7,
      charStart: 120,
      charEnd: 240,
      section: 'Findings',
      embedding: ON,
    },
  ]);
  searchPlan = vi.spyOn(h.app.get(WebScopeService), 'searchPlan');
}, 300_000);

beforeEach(async () => {
  vi.restoreAllMocks();
  searchPlan = vi.spyOn(h.app.get(WebScopeService), 'searchPlan');
  // Each part's search returns the same three papers plus one of its own; merged, they are four.
  searchPlan.mockImplementation(async (_doc: string, _q: string, plan: { keyword: string[] }) => [
    found(1),
    found(2),
    found(3),
    found(10 + (plan.keyword[0]?.length ?? 0)),
  ]);
  vi.spyOn(providers.embeddings, 'embed').mockImplementation(async (texts) => texts.map(() => ON));
  embedAs((i) => i !== 1);
  await h.prisma.user.update({ where: { id: h.userId }, data: { settings: {} } });
  await h.prisma.usageLedger.deleteMany({
    where: { userId: h.userId, action: { in: ['CHAT', 'RESEARCH'] } },
  });
});

afterAll(async () => {
  await h?.stop();
});

describe('a deep research question', () => {
  it('plans, searches once per part, reads the library and the found abstracts, and answers part by part for one RESEARCH unit', async () => {
    const chatBefore = await units('CHAT');
    const researchRows = await logRows('RESEARCH');
    const embedRows = await logRows('EMBED');
    const sse = await ask();
    expect(sse.status).toBe(200);

    const ids = stepIds(sse);
    expect(ids.slice(0, 2)).toEqual(['plan', 'planned']);
    const parts = ids.filter((id) => id === 'part').length;
    expect(parts).toBe(3); // the mock plans three parts
    expect(ids.slice(-4)).toEqual(['read', 'read', 'kept', 'write']);
    const texts = stepTexts(sse);
    expect(texts[0]).toBe('Planning the research…');
    expect(texts[1]).toMatch(/^Planned 3 parts: /);
    expect(texts[2]).toMatch(/^Part 1 of 3, .*: searching your library and the indexes for: /);
    expect(texts.at(-4)).toBe('Reading 2 passages from 1 source');
    expect(texts.at(-3)).toMatch(/^Reading \d+ abstracts…$/);
    expect(texts.at(-1)).toBe('Writing the answer, part by part…');
    expect(searchPlan).toHaveBeenCalledTimes(3);
    // Each part's search gets its own query, and the thesis title leads the semantic search.
    for (const call of searchPlan.mock.calls) {
      const plan = call[2] as { semantic: string; keyword: string[] };
      expect(plan.keyword).toHaveLength(1);
      expect(plan.semantic).toMatch(/^Mobile banking and the financial inclusion/);
    }

    const answer = done(sse);
    expect(answer.outcome).toBe('answered');
    const research = answer.research as {
      deep: true;
      papers: number;
      queries: string[];
      plan: Array<{ title: string; question: string }>;
      libraryPapers: number;
      note: string;
    };
    expect(research.deep).toBe(true);
    expect(research.plan).toHaveLength(3);
    expect(research.queries).toHaveLength(3);
    expect(research.libraryPapers).toBe(1);
    // Six distinct papers found over the three parts (three shared, one each); the second was
    // off topic.
    expect(stepTexts(sse).at(-2)).toBe('5 of 6 are on your question');
    expect(research.papers).toBe(5);
    expect(research.note).toBe(
      'From 1 paper in your library and the abstracts of 5 found by the searches, not in your library — add the ones you use.',
    );
    expect(answer.passagesUsed).toBe(2 + 5);

    // Only what was in the request is cited: the library's passages and the kept abstracts.
    const citations = answer.citations as Array<{
      key: string;
      sourceId: string;
      beyond?: { title: string };
    }>;
    expect(citations.length).toBeGreaterThan(0);
    for (const c of citations) {
      if (c.beyond) {
        expect(c.key).toMatch(/^Sweb[1-5]#cabstract$/);
        expect(c.beyond.title).not.toMatch(/study 2$/);
      } else {
        expect(c.sourceId).toBe(sourceId);
      }
    }

    // One RESEARCH unit, no CHAT unit; two RESEARCH rows (the plan and the answer), one EMBED row.
    expect(await units('RESEARCH')).toBe(1);
    expect(await units('CHAT')).toBe(chatBefore);
    expect(await logRows('RESEARCH')).toBe(researchRows + 2);
    expect(await logRows('EMBED')).toBe(embedRows + 1);
    const rows = await h.prisma.aiCallLog.findMany({
      where: { action: 'RESEARCH', userId: h.userId },
      orderBy: { createdAt: 'desc' },
      take: 2,
    });
    expect(rows.every((r) => r.model === 'mock-strong' && r.ok)).toBe(true);

    // The thread keeps the plan, so the panel can show it after a reload.
    const history = (await (await h.api(`/chat/${documentId}`)).json()) as {
      turns: Array<{ research?: { deep?: boolean; plan?: unknown[] } }>;
    };
    expect(history.turns.at(-1)?.research?.deep).toBe(true);
    expect(history.turns.at(-1)?.research?.plan).toHaveLength(3);
  });

  it('a failed search loses only that part; a failed plan is planned in code; the question is answered', async () => {
    searchPlan.mockRejectedValue(new Error('every index down'));
    vi.spyOn(providers.llm, 'complete').mockRejectedValue(new Error('planner down'));
    const sse = await ask();
    expect(sse.events.some((e) => e.event === 'error')).toBe(false);
    expect(stepTexts(sse)[1]).toBe('Planned 1 part: The question');
    expect(stepIds(sse).filter((id) => id === 'part')).toHaveLength(1);
    const answer = done(sse);
    expect(answer.outcome).toBe('answered');
    expect((answer.research as { papers: number }).papers).toBe(0);
    expect((answer.research as { note: string }).note).toBe(
      'From 1 paper in your library; the searches found nothing closer to the question.',
    );
    expect(await units('RESEARCH')).toBe(1);
  });

  it('refunds the unit when the answer itself fails', async () => {
    vi.spyOn(providers.llm, 'stream').mockImplementation(() => {
      throw new Error('provider down');
    });
    const sse = await ask();
    expect(sse.events.some((e) => e.event === 'error')).toBe(true);
    expect(await units('RESEARCH')).toBe(0);
  });

  it('refunds the unit when neither the library nor the searches had anything', async () => {
    searchPlan.mockResolvedValue([]);
    // The library's passages fall under the relevance floor.
    vi.spyOn(providers.embeddings, 'embed').mockImplementation(async (texts) =>
      texts.map(() => OFF),
    );
    const sse = await ask();
    expect(sse.events.some((e) => e.event === 'error')).toBe(false);
    expect(done(sse).outcome).toBe('deep-empty');
    expect(String(done(sse).text)).toMatch(/^Neither your library nor a search/);
    expect(await units('RESEARCH')).toBe(0);
  });
});

describe('the cap and the cases that are not deep research', () => {
  it('at the cap (the trial’s one question) it is refused before any call, and nothing is charged', async () => {
    await h.prisma.usageLedger.upsert({
      where: {
        userId_period_action: { userId: h.userId, period: periodFor(), action: 'RESEARCH' },
      },
      create: { userId: h.userId, period: periodFor(), action: 'RESEARCH', count: 1 },
      update: { count: 1 },
    });
    const researchRows = await logRows('RESEARCH');
    const res = await h.api('/chat', {
      method: 'POST',
      body: JSON.stringify({ documentId, message: QUESTION, deep: true }),
    });
    expect(res.status).toBe(429);
    const problem = (await res.json()) as { detail?: string };
    expect(problem.detail).toContain('deep research questions');
    expect(searchPlan).not.toHaveBeenCalled();
    expect(await logRows('RESEARCH')).toBe(researchRows);
    expect(await units('RESEARCH')).toBe(1);
  });

  it('with searching turned off in Settings it is refused, with no unit taken', async () => {
    await h.api('/settings', {
      method: 'PUT',
      body: JSON.stringify({ searchBeyondLibrary: 'off' }),
    });
    const res = await h.api('/chat', {
      method: 'POST',
      body: JSON.stringify({ documentId, message: QUESTION, deep: true }),
    });
    expect(res.status).toBe(403);
    expect(await units('RESEARCH')).toBe(0);
    expect(await units('CHAT')).toBe(0);
  });

  it('with @ papers or in the document scope it is an ordinary question on a CHAT unit', async () => {
    const named = await ask({ sourceIds: [sourceId] });
    expect(named.status).toBe(200);
    expect(stepIds(named)).not.toContain('plan');
    expect(await units('RESEARCH')).toBe(0);
    expect(await units('CHAT')).toBe(1);

    // An empty thesis is refused and refunded, as the document scope always does; the point is
    // that nothing was planned or searched and no RESEARCH unit was taken.
    const own = await ask({ scope: 'document' });
    expect(own.status).toBe(200);
    expect(stepIds(own)).not.toContain('plan');
    expect(searchPlan).not.toHaveBeenCalled();
    expect(await units('RESEARCH')).toBe(0);
  });
});
