/**
 * The AI use statement through the API — ADR-0148. Pinned: the facts are counts of this thesis's
 * own rows (provenance word counts, call log, suggestion events, builds, library) and nothing is
 * estimated; a feature with no rows counts zero; proofreading's calls come out of the edit count;
 * the appendix becomes an ordinary chapter at the end of the outline, with the table as a real
 * table; the thesis export carries the statement after the bibliography when asked, and not
 * otherwise; and another student's thesis reads as absent.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, startHarness } from './_harness.js';

function zipEntry(zip: Buffer, name: string): string {
  for (let i = 0; i + 30 < zip.length; i++) {
    if (zip.readUInt32LE(i) !== 0x04034b50) continue;
    const method = zip.readUInt16LE(i + 8);
    const size = zip.readUInt32LE(i + 18);
    const nameLength = zip.readUInt16LE(i + 26);
    const extra = zip.readUInt16LE(i + 28);
    const start = i + 30 + nameLength + extra;
    if (zip.subarray(i + 30, i + 30 + nameLength).toString('utf8') === name) {
      const data = zip.subarray(start, start + size);
      return (method === 8 ? inflateRawSync(data) : data).toString('utf8');
    }
  }
  return '';
}

type Facts = {
  documentTitle: string;
  from: string | null;
  to: string | null;
  features: Record<string, number>;
  suggestions: { shown: number; kept: number };
  drafts: { shown: number; accepted: number };
  words: { total: number; aiUnedited: number; aiEdited: number; own: number };
  chapters: Array<{
    title: string;
    total: number;
    aiUnedited: number;
    aiEdited: number;
    own: number;
    actions: number;
  }>;
  sources: { total: number; autoAdded: number; cited: number };
};

let h: Harness;
let doc: { id: string; firstChapterId: string };
let emptyDoc: { id: string; firstChapterId: string };

const call = (action: string, extra: Record<string, unknown> = {}) => ({
  userId: h.userId,
  documentId: doc.id,
  action: action as never,
  model: 'mock-fast',
  inputTokens: 10,
  outputTokens: 10,
  costMicroInr: BigInt(0),
  latencyMs: 5,
  ...extra,
});

beforeAll(async () => {
  h = await startHarness('ai-statement@example.com');
  await h.prisma.institutionTemplate.create({
    data: {
      name: 'EXAMPLE_IN_UNIVERSITY',
      spec: JSON.parse(
        readFileSync(
          fileURLToPath(
            new URL('../../../packages/db/prisma/seed-data/example-template.json', import.meta.url),
          ),
          'utf8',
        ),
      ),
    },
  });
  for (const [title, into] of [
    ['Solar adoption in Karnataka', 'doc'],
    ['An untouched thesis', 'empty'],
  ] as const) {
    const created = await h.api('/documents', {
      method: 'POST',
      body: JSON.stringify({ title, entryPath: 'A_TOPIC' }),
    });
    const made = (await created.json()) as typeof doc;
    if (into === 'doc') doc = made;
    else emptyDoc = made;
  }

  // The chapter as the editor saves it: provenance marks on the text and the counts beside it.
  const mark = (kind: string) => [{ type: 'provenance', attrs: { kind, actionId: null } }];
  await h.prisma.chapter.update({
    where: { id: doc.firstChapterId },
    data: {
      content: {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 1 },
            content: [{ type: 'text', text: 'Introduction' }],
          },
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'Households weighed upfront cost against ',
                marks: mark('HUMAN'),
              },
              {
                type: 'text',
                text: 'the subsidy the state offered in 2022',
                marks: mark('ASSIST'),
              },
              {
                type: 'text',
                text: ' and the credit they could reach.',
                marks: mark('HUMAN_EDITED'),
              },
            ],
          },
        ],
      },
      wordCounts: { HUMAN: 5, ASSIST: 7, DRAFT: 0, COMMAND: 0, HUMAN_EDITED: 6 },
      wordCount: 18,
    },
  });

  await h.prisma.aiCallLog.createMany({
    data: [
      call('ASSIST', { createdAt: new Date('2026-09-03T10:00:00Z') }),
      call('ASSIST'),
      call('COMMAND'),
      call('COMMAND'),
      call('COMMAND'),
      call('CITE'),
      call('CHAT'),
      call('SEARCH_QUERIES'),
      call('OUTLINE'),
      call('EMBED'),
      // A failed call is not a use.
      call('VIVA', { ok: false, error: 'timed out' }),
    ],
  });
  await h.prisma.suggestionEvent.createMany({
    data: [
      {
        userId: h.userId,
        documentId: doc.id,
        chapterId: doc.firstChapterId,
        action: 'ASSIST',
        shownChars: 80,
        keptChars: 80,
        outcome: 'ACCEPTED',
        latencyMs: 900,
      },
      {
        userId: h.userId,
        documentId: doc.id,
        chapterId: doc.firstChapterId,
        action: 'ASSIST',
        shownChars: 80,
        keptChars: 0,
        outcome: 'REJECTED',
        latencyMs: 900,
      },
      {
        userId: h.userId,
        documentId: doc.id,
        chapterId: doc.firstChapterId,
        action: 'ASSIST',
        shownChars: 80,
        keptChars: 20,
        outcome: 'PARTIAL',
        latencyMs: 900,
      },
      {
        userId: h.userId,
        documentId: doc.id,
        chapterId: doc.firstChapterId,
        action: 'DRAFT',
        shownChars: 600,
        keptChars: 600,
        outcome: 'ACCEPTED',
        latencyMs: 4000,
        createdAt: new Date('2026-10-08T10:00:00Z'),
      },
    ],
  });
  // One proofreading run that made two of the three COMMAND calls.
  await h.prisma.auditEvent.create({
    data: {
      kind: 'PROOFREAD_RUN',
      userId: h.userId,
      documentId: doc.id,
      detail: { chapterId: doc.firstChapterId, calls: 2, checkedWords: 18, corrections: 1 },
    },
  });
  await h.prisma.chapterBuild.create({
    data: {
      documentId: doc.id,
      chapterId: doc.firstChapterId,
      userId: h.userId,
      status: 'DONE',
      kind: 'CHAPTER',
      profile: {},
    },
  });
  const sources = await Promise.all(
    [
      { title: 'Rooftop subsidies', autoAddedAt: null },
      { title: 'Credit access', autoAddedAt: new Date() },
      { title: 'Uncited paper', autoAddedAt: null },
    ].map((s) =>
      h.prisma.source.create({
        data: {
          documentId: doc.id,
          status: 'RESOLVED',
          title: s.title,
          year: 2024,
          autoAddedAt: s.autoAddedAt,
        },
      }),
    ),
  );
  await h.prisma.citation.createMany({
    data: [
      { chapterId: doc.firstChapterId, sourceId: sources[0]?.id as string, nodeKey: 'c1' },
      { chapterId: doc.firstChapterId, sourceId: sources[0]?.id as string, nodeKey: 'c2' },
      { chapterId: doc.firstChapterId, sourceId: sources[1]?.id as string, nodeKey: 'c3' },
    ],
  });
}, 600_000);

afterAll(async () => {
  await h?.stop();
});

const download = async (url: string) => Buffer.from(await (await fetch(url)).arrayBuffer());

describe('GET /documents/:id/ai-statement', () => {
  it('counts the stored rows and nothing else', async () => {
    const res = await h.api(`/documents/${doc.id}/ai-statement`);
    expect(res.status).toBe(200);
    const facts = (await res.json()) as Facts;
    expect(facts.documentTitle).toBe('Solar adoption in Karnataka');
    expect(facts.features).toMatchObject({
      suggestions: 3,
      drafting: 1,
      edits: 1, // three COMMAND calls, two of them the proofreading run's
      proofreading: 1,
      citations: 1,
      chat: 1,
      literatureSearch: 1,
      planning: 1,
      chapterBuild: 1,
      litReviewBuild: 0,
      research: 0,
      checks: 0,
      examinerReview: 0,
      viva: 0, // the one VIVA call failed
    });
    expect(facts.suggestions).toEqual({ shown: 3, kept: 2 });
    expect(facts.drafts).toEqual({ shown: 1, accepted: 1 });
    expect(facts.words).toEqual({ total: 18, aiUnedited: 7, aiEdited: 6, own: 5 });
    expect(facts.chapters).toHaveLength(1);
    expect(facts.chapters[0]).toMatchObject({ title: 'Chapter 1', total: 18, actions: 4 });
    expect(facts.sources).toEqual({ total: 3, autoAdded: 1, cited: 2 });
    // The range starts at the earliest call, which was back-dated.
    expect(facts.from).toBe('2026-09-03');
    // The other rows were written now, so the range ends today.
    expect(facts.to).toBe(new Date().toISOString().slice(0, 10));
  });

  it('an untouched thesis counts zero everywhere and has no date range', async () => {
    const facts = (await (await h.api(`/documents/${emptyDoc.id}/ai-statement`)).json()) as Facts;
    expect(Object.values(facts.features).every((n) => n === 0)).toBe(true);
    expect(facts.from).toBeNull();
    expect(facts.to).toBeNull();
    expect(facts.sources).toEqual({ total: 0, autoAdded: 0, cited: 0 });
  });

  it("another student's thesis is absent", async () => {
    const other = await startHarness('ai-statement-other@example.com');
    try {
      const res = await other.api(`/documents/${doc.id}/ai-statement`);
      expect(res.status).toBe(404);
    } finally {
      await other.stop();
    }
  });
});

describe('POST /documents/:id/ai-statement/appendix', () => {
  it('adds the statement as the last chapter, with the table as a real table', async () => {
    const res = await h.api(`/documents/${doc.id}/ai-statement/appendix`, {
      method: 'POST',
      body: JSON.stringify({
        title: 'Statement on the use of AI tools',
        paragraphs: [
          'In preparing this thesis I used Thesis Copilot.',
          'I take full responsibility.',
        ],
        table: {
          header: ['Chapter', 'Words', 'Began as AI text'],
          rows: [
            ['Introduction', '18', '13'],
            ['Total', '18', '13'],
          ],
        },
      }),
    });
    expect(res.status).toBe(200);
    const made = (await res.json()) as { chapterId: string; title: string };
    expect(made.title).toBe('Statement on the use of AI tools');

    const chapters = await h.prisma.chapter.findMany({
      where: { documentId: doc.id },
      orderBy: { order: 'asc' },
      select: { id: true, title: true, order: true, content: true, wordCount: true },
    });
    expect(chapters.at(-1)?.id).toBe(made.chapterId);
    expect(chapters.map((c) => c.order)).toEqual(chapters.map((_, i) => i + 1));
    const content = chapters.at(-1)?.content as { content: Array<{ type: string }> };
    expect(content.content.map((n) => n.type)).toEqual([
      'heading',
      'paragraph',
      'paragraph',
      'table',
    ]);
    expect(chapters.at(-1)?.wordCount).toBeGreaterThan(10);

    const memory = await h.prisma.documentMemory.findUniqueOrThrow({
      where: { documentId: doc.id },
    });
    const outline = memory.outline as Array<{ id: string; title: string }>;
    expect(outline.at(-1)).toMatchObject({ id: 'ai-use-statement', title: made.title });
  });

  it('a second insertion gets its own title and node, not a clash', async () => {
    const res = await h.api(`/documents/${doc.id}/ai-statement/appendix`, {
      method: 'POST',
      body: JSON.stringify({ title: 'Statement on the use of AI tools', paragraphs: ['Again.'] }),
    });
    expect(res.status).toBe(200);
    const made = (await res.json()) as { chapterId: string; title: string };
    expect(made.title).toBe('Statement on the use of AI tools (2)');
    const chapter = await h.prisma.chapter.findUniqueOrThrow({ where: { id: made.chapterId } });
    expect(chapter.outlineNodeId).toBe('ai-use-statement-2');
    const heading = (chapter.content as { content: Array<{ content: Array<{ text: string }> }> })
      .content[0];
    expect(heading?.content[0]?.text).toBe('Statement on the use of AI tools (2)');
  });

  it('refuses an empty statement', async () => {
    const res = await h.api(`/documents/${doc.id}/ai-statement/appendix`, {
      method: 'POST',
      body: JSON.stringify({ title: '', paragraphs: [] }),
    });
    expect(res.status).toBe(400);
  });
});

describe('the thesis export', () => {
  it('carries the statement as an appendix after the bibliography when asked', async () => {
    const res = await h.api(`/documents/${emptyDoc.id}/export/thesis`, {
      method: 'POST',
      body: JSON.stringify({
        format: 'docx',
        aiStatement: {
          title: 'Statement on the use of AI tools',
          paragraphs: [
            'In preparing this thesis I used Thesis Copilot, a writing tool with AI features.',
          ],
        },
      }),
    });
    expect(res.status).toBe(200);
    const { url } = (await res.json()) as { url: string };
    const xml = zipEntry(await download(url), 'word/document.xml');
    expect(xml).toContain('Statement on the use of AI tools');
    expect(xml).toContain('I used Thesis Copilot, a writing tool with AI features.');
    expect(xml.indexOf('Statement on the use of AI tools')).toBeGreaterThan(
      xml.indexOf('REFERENCES'),
    );
  });

  it('leaves it out when not asked', async () => {
    const res = await h.api(`/documents/${emptyDoc.id}/export/thesis`, {
      method: 'POST',
      body: JSON.stringify({ format: 'docx' }),
    });
    expect(res.status).toBe(200);
    const { url } = (await res.json()) as { url: string };
    expect(zipEntry(await download(url), 'word/document.xml')).not.toContain(
      'Statement on the use of AI tools',
    );
  });
});
