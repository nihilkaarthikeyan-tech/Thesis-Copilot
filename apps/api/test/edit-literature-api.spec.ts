/**
 * ADR-0133 — "Search the literature" on an AI edit, through the API.
 *
 * The real application on Postgres and Redis with the mock model. Replaced, as in
 * `chat-research-api.spec.ts`: the scholarly search (`WebScopeService.searchPlan`) and the
 * embedding vectors (so "on topic" is the test's decision). No worker runs, which is the point:
 * the edit is sent the added papers' abstracts from their new rows without waiting for one.
 * Pinned:
 * - the search is for the subject, led by the thesis, chapter and scope note;
 * - the found papers on topic are added to the library, marked found, filed into "Add into";
 * - the edit's passages include their abstracts, and every citation it makes is to a library
 *   paper (a new one with no chunk id);
 * - one COMMAND unit, taken before anything is searched; nothing searched at the cap;
 * - an empty or failed search is the library alone, with one line saying so;
 * - someone else's chapter is a 404 before anything is searched;
 * - an edit that takes no passages never searches.
 */

import type { LlmRequest, Providers } from '@tc/ai';
import { EMBEDDING_DIMENSIONS, type RawClient, replaceSourceChunks } from '@tc/retrieval';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setMetaKey } from '../src/common/document-meta.js';
import { PROVIDERS } from '../src/modules/ai/ai.module.js';
import { type WebResult, WebScopeService } from '../src/modules/assist/web-scope.service.js';
import { periodFor } from '../src/modules/usage/usage.service.js';
import { type Harness, startHarness } from './_harness.js';

let h: Harness;
let documentId: string;
let chapterId: string;
let librarySourceId: string;
let collectionId: string;
let providers: Providers;
let searchPlan: ReturnType<typeof vi.spyOn>;

const SELECTION = 'Upfront cost limits rooftop solar adoption among rural households.';
const INSTRUCTION = 'Add one sentence of evidence on credit access';

const ON = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === 0 ? 1 : 0));
const OFF = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === 1 ? 1 : 0));

function found(i: number, over: Partial<WebResult> = {}): WebResult {
  return {
    title: `Credit access and rooftop solar adoption ${i}`,
    abstract:
      `Study ${i} surveyed rural households. Access to credit raised rooftop solar adoption ` +
      'by a third where upfront cost was the main barrier.',
    matchedPassage: null,
    year: 2022,
    venue: 'Energy Policy',
    doi: `10.1000/edit.${i}`,
    citationCount: 4,
    isPreprint: false,
    openAccess: false,
    inLibrary: false,
    via: 'openalex',
    reference: { raw: `Credit access and rooftop solar adoption ${i}. Energy Policy. 2022` },
    ...over,
  };
}

type RunResult = {
  text: string;
  citations: Array<{ key: string; sourceId: string; chunkId: string | null; rendered: string }>;
  literature?: {
    added: Array<{ sourceId: string; shortRef: string; title: string }>;
    collection: { id: string; name: string } | null;
    note: string | null;
  };
};

async function run(body: Record<string, unknown>): Promise<Response> {
  return h.api('/commands/run', {
    method: 'POST',
    body: JSON.stringify({ chapterId, selection: SELECTION, ...body }),
  });
}

async function units(): Promise<number> {
  const row = await h.prisma.usageLedger.findFirst({
    where: { userId: h.userId, action: 'COMMAND', period: periodFor() },
  });
  return row?.count ?? 0;
}

/** Answers the next structured call with whatever `text(req)` returns, recording the request. */
function answerWith(text: (req: LlmRequest) => string): { seen: LlmRequest[] } {
  const seen: LlmRequest[] = [];
  vi.spyOn(providers.llm, 'complete').mockImplementationOnce(async (req) => {
    seen.push(req as LlmRequest);
    return {
      value: { text: text(req as LlmRequest) } as never,
      usage: { inputTokens: 400, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 60 },
      modelId: 'mock-strong',
      finishReason: 'stop',
    };
  });
  return { seen };
}

/** The passage ids in the prompt, in order. */
const passageIds = (req: LlmRequest | undefined) =>
  [...String(req?.messages[0]?.content ?? '').matchAll(/<passage id="([^"]+)"/g)].map((m) => m[1]);

beforeAll(async () => {
  h = await startHarness('edit-literature@example.com');
  providers = h.app.get<Providers>(PROVIDERS);
  const document = await h.prisma.document.create({
    data: { ownerId: h.userId, title: 'Rooftop solar in Karnataka', entryPath: 'A_TOPIC' },
  });
  documentId = document.id;
  const chapter = await h.prisma.chapter.create({
    data: {
      documentId,
      outlineNodeId: 'n1',
      title: 'Literature Review',
      scopeNote: 'Household adoption of rooftop solar.',
      order: 1,
      content: { type: 'doc', content: [] },
    },
  });
  chapterId = chapter.id;
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
  librarySourceId = source.id;
  await replaceSourceChunks(h.prisma as unknown as RawClient, source.id, [
    {
      sourceId: source.id,
      ordinal: 0,
      text: 'In a survey of 312 rural households, upfront cost was the main barrier to rooftop solar.',
      tokenCount: 20,
      page: 7,
      charStart: 0,
      charEnd: 90,
      section: 'Findings',
      embedding: ON,
    },
  ]);
  const collection = await h.prisma.sourceCollection.create({
    data: { documentId, name: 'Finance' },
  });
  collectionId = collection.id;
  await setMetaKey(h.prisma as never, documentId, 'addInto', collectionId);
}, 300_000);

beforeEach(async () => {
  vi.restoreAllMocks();
  searchPlan = vi.spyOn(h.app.get(WebScopeService), 'searchPlan');
  searchPlan.mockResolvedValue([found(1), found(2), found(3)]);
  vi.spyOn(providers.embeddings, 'embed').mockImplementation(async (texts) => texts.map(() => ON));
  // The question, then each candidate: the third is off topic.
  vi.spyOn(providers.embeddings, 'embedWithUsage').mockImplementation(async (texts) => ({
    vectors: texts.map((_, i) => (i === 3 ? OFF : ON)),
    tokens: texts.length * 100,
  }));
  await h.prisma.usageLedger.upsert({
    where: { userId_period_action: { userId: h.userId, period: periodFor(), action: 'COMMAND' } },
    create: { userId: h.userId, action: 'COMMAND', period: periodFor(), count: 0, bonus: 40 },
    update: { count: 0, bonus: 40 },
  });
  // Each test starts from the one library paper.
  await h.prisma.source.deleteMany({ where: { documentId, id: { not: librarySourceId } } });
});

afterAll(async () => {
  await h?.stop();
});

describe('Search the literature on your own instruction', () => {
  it('adds the papers on topic to the library and the edit cites only library papers', async () => {
    const before = await units();
    const embedRows = await h.prisma.aiCallLog.count({ where: { action: 'EMBED' } });
    // The model cites the first passage it was sent, and one it was not: the latter is stripped.
    const model = answerWith((req) => {
      const first = passageIds(req)[0] ?? 'none';
      return `${SELECTION.slice(0, -1)} {{cite:${first}}}. Credit helps {{cite:S9#c9}}.`;
    });
    const res = await run({
      command: 'custom',
      instruction: INSTRUCTION,
      useLibrary: true,
      searchLiterature: true,
    });
    expect(res.status).toBe(200);
    const result = (await res.json()) as RunResult;

    // 1. Searched for the subject: the thesis, the chapter and its scope lead; the instruction
    // reaches only the semantic search, never the keyword queries or the relevance text.
    expect(searchPlan).toHaveBeenCalledOnce();
    const [, relevance, plan] = searchPlan.mock.calls[0] as [
      string,
      string,
      { semantic: string; keyword: string[] },
    ];
    expect(relevance).toBe(
      `Rooftop solar in Karnataka. Literature Review. Household adoption of rooftop solar.. ${SELECTION}`,
    );
    expect(plan.semantic.startsWith('Rooftop solar in Karnataka. Literature Review.')).toBe(true);
    expect(plan.semantic).toContain(INSTRUCTION);
    expect(plan.keyword[0]).toBe('upfront cost limits rooftop solar adoption among rural');

    // 2. The two on topic are in the library, found for the student, filed into "Add into".
    const added = await h.prisma.source.findMany({
      where: { documentId, id: { not: librarySourceId } },
      select: { id: true, title: true, autoAddedAt: true, cslJson: true },
      orderBy: { title: 'asc' },
    });
    expect(added.map((s) => s.title)).toEqual([
      'Credit access and rooftop solar adoption 1',
      'Credit access and rooftop solar adoption 2',
    ]);
    for (const s of added) {
      expect(s.autoAddedAt).not.toBeNull();
      expect((s.cslJson as { abstract?: string }).abstract).toMatch(/Access to credit/);
    }
    const filed = await h.prisma.sourceCollectionItem.findMany({ where: { collectionId } });
    expect(filed.map((f) => f.sourceId).sort()).toEqual(added.map((s) => s.id).sort());

    // 3. The prompt carries their abstracts beside the library's passage.
    const message = String(model.seen[0]?.messages[0]?.content);
    expect(message).toContain('Access to credit raised rooftop solar adoption');
    expect(message).toContain('upfront cost was the main barrier to rooftop solar');
    expect(passageIds(model.seen[0])).toHaveLength(3);
    // Nothing waited for the worker: the new papers have no chunks yet, and are cited anyway.
    expect(
      await h.prisma.sourceChunk.count({ where: { sourceId: { in: added.map((s) => s.id) } } }),
    ).toBe(0);

    // Every citation the result carries is a library row of this thesis; the invented one is gone.
    expect(result.text).not.toContain('S9#c9');
    expect(result.citations).toHaveLength(1);
    const libraryIds = new Set([librarySourceId, ...added.map((s) => s.id)]);
    for (const c of result.citations) expect(libraryIds.has(c.sourceId)).toBe(true);
    expect(added.map((s) => s.id)).toContain(result.citations[0]?.sourceId);
    // Cited by the abstract it was sent: no chunk id leaves the server (the card says so).
    expect(result.citations[0]?.chunkId).toBeNull();

    // 4. What the panel lists.
    expect(result.literature?.note).toBeNull();
    expect(result.literature?.collection).toEqual({ id: collectionId, name: 'Finance' });
    expect(result.literature?.added).toHaveLength(2);
    for (const paper of result.literature?.added ?? []) {
      // Authors arrive with the resolver; until then the title and year name it.
      expect(paper.shortRef).toMatch(/^Credit access and rooftop solar adoption.* 2022$/);
    }

    // One unit; the relevance embedding is its own EMBED row.
    expect(await units()).toBe(before + 1);
    expect(await h.prisma.aiCallLog.count({ where: { action: 'EMBED' } })).toBe(embedRows + 1);
  });

  it('takes the unit before searching, and at the cap searches nothing and adds nothing', async () => {
    await h.prisma.usageLedger.update({
      where: { userId_period_action: { userId: h.userId, period: periodFor(), action: 'COMMAND' } },
      data: { count: 1_000 },
    });
    const res = await run({ command: 'custom', instruction: INSTRUCTION, searchLiterature: true });
    expect(res.status).toBe(429);
    expect(searchPlan).not.toHaveBeenCalled();
    expect(await h.prisma.source.count({ where: { documentId } })).toBe(1);
  });

  it('an empty search is the library alone, said in one line, on one unit', async () => {
    searchPlan.mockResolvedValue([]);
    const model = answerWith(() => SELECTION);
    const before = await units();
    const res = await run({ command: 'custom', instruction: INSTRUCTION, searchLiterature: true });
    expect(res.status).toBe(200);
    const result = (await res.json()) as RunResult;
    expect(result.literature).toEqual({
      added: [],
      collection: null,
      note: 'The search found nothing close enough to this passage; this edit used your library alone.',
    });
    // The switch implies the library: its passage was still sent.
    expect(String(model.seen[0]?.messages[0]?.content)).toContain(
      'upfront cost was the main barrier',
    );
    expect(await units()).toBe(before + 1);
  });

  it('nothing on topic is the library alone too, and nothing is added', async () => {
    vi.spyOn(providers.embeddings, 'embedWithUsage').mockImplementation(async (texts) => ({
      vectors: texts.map((_, i) => (i === 0 ? ON : OFF)),
      tokens: texts.length * 100,
    }));
    answerWith(() => SELECTION);
    const res = await run({ command: 'custom', instruction: INSTRUCTION, searchLiterature: true });
    const result = (await res.json()) as RunResult;
    expect(result.literature?.added).toEqual([]);
    expect(result.literature?.note).toMatch(/nothing close enough/);
    expect(await h.prisma.source.count({ where: { documentId } })).toBe(1);
  });

  it('a failed search does not fail the edit', async () => {
    searchPlan.mockRejectedValue(new Error('every index down'));
    answerWith(() => SELECTION);
    const res = await run({ command: 'custom', instruction: INSTRUCTION, searchLiterature: true });
    expect(res.status).toBe(200);
    const result = (await res.json()) as RunResult;
    expect(result.literature?.note).toBe(
      'The literature search did not answer in time; this edit used your library alone.',
    );
  });

  it('refunds the unit when the edit itself fails after the search', async () => {
    vi.spyOn(providers.llm, 'complete').mockRejectedValueOnce(new Error('provider down'));
    const before = await units();
    const res = await run({ command: 'custom', instruction: INSTRUCTION, searchLiterature: true });
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(await units()).toBe(before);
  });
});

describe('when it must not search', () => {
  it('an edit that takes no passages ignores the switch', async () => {
    answerWith(() => SELECTION);
    const res = await run({ command: 'formalise', searchLiterature: true });
    expect(res.status).toBe(200);
    expect(searchPlan).not.toHaveBeenCalled();
    expect(((await res.json()) as RunResult).literature).toBeUndefined();
  });

  it('the switch off searches nothing', async () => {
    answerWith(() => SELECTION);
    await run({ command: 'custom', instruction: INSTRUCTION, useLibrary: true });
    expect(searchPlan).not.toHaveBeenCalled();
  });

  it("someone else's chapter is a 404 before anything is searched or spent", async () => {
    const other = await h.prisma.user.create({ data: { email: 'someone-else@example.edu' } });
    const theirs = await h.prisma.document.create({
      data: { ownerId: other.id, title: 'Their thesis', entryPath: 'A_TOPIC' },
    });
    const theirChapter = await h.prisma.chapter.create({
      data: {
        documentId: theirs.id,
        outlineNodeId: 'n1',
        title: 'Theirs',
        order: 1,
        content: { type: 'doc', content: [] },
      },
    });
    const before = await units();
    const res = await h.api('/commands/run', {
      method: 'POST',
      body: JSON.stringify({
        chapterId: theirChapter.id,
        selection: SELECTION,
        command: 'custom',
        instruction: INSTRUCTION,
        searchLiterature: true,
      }),
    });
    expect(res.status).toBe(404);
    expect(searchPlan).not.toHaveBeenCalled();
    expect(await units()).toBe(before);
    expect(await h.prisma.source.count({ where: { documentId: theirs.id } })).toBe(0);
  });
});
