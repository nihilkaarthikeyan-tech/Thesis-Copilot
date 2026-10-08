/**
 * "Open as a document" through the API — R38, ADR-0123. Pinned: the stored claims map becomes a
 * new chapter at the end of the outline, six pending drafts with their suggestion events, every
 * citation a row pointing at a paper of this thesis and the passage the map read; no model call
 * and no allowance; the same map opens the same chapter; a section accepts like any draft; a
 * thesis with no outline keeps its chapter first; refused while a plan is written, without a map,
 * and for another student's thesis.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, startHarness } from './_harness.js';

type Node = { type?: string; attrs?: Record<string, unknown>; content?: Node[] };

let h: Harness;
let documentId: string;
let ids: string[];
const chunkIds = new Map<string, string>();

const nodesOf = (doc: unknown, type: string): Node[] => {
  const out: Node[] = [];
  const visit = (node: Node) => {
    if (node.type === type) out.push(node);
    for (const child of node.content ?? []) visit(child);
  };
  visit(doc as Node);
  return out;
};

async function library(docId: string, titles: readonly string[]): Promise<string[]> {
  const made: string[] = [];
  for (const title of titles) {
    const source = await h.prisma.source.create({
      data: {
        documentId: docId,
        status: 'RESOLVED',
        title,
        year: 2025,
        groundingLevel: 'ABSTRACT',
      },
    });
    const chunk = await h.prisma.sourceChunk.create({
      data: {
        sourceId: source.id,
        ordinal: 0,
        text: `${title}. Upfront cost and credit access shaped adoption among the households surveyed.`,
        tokenCount: 20,
      },
    });
    chunkIds.set(source.id, chunk.id);
    made.push(source.id);
  }
  return made;
}

beforeAll(async () => {
  h = await startHarness('claims-document@example.com');
  const document = await h.prisma.document.create({
    data: {
      ownerId: h.userId,
      title: 'Rooftop solar in Karnataka',
      entryPath: 'A_TOPIC',
      memory: {
        create: {
          scope: {},
          outline: [{ id: 'ch-1', title: 'Introduction', scopeNote: '', children: [] }],
          glossary: {},
        },
      },
      chapters: {
        create: {
          outlineNodeId: 'ch-1',
          title: 'Introduction',
          order: 1,
          content: {
            type: 'doc',
            content: [
              {
                type: 'heading',
                attrs: { level: 1 },
                content: [{ type: 'text', text: 'Introduction' }],
              },
            ],
          },
        },
      },
    },
  });
  documentId = document.id;
  ids = await library(documentId, [
    'Household frictions in rooftop solar adoption',
    'Financing rural solar: a survey',
    'Subsidy delivery in Karnataka',
  ]);
}, 300_000);

afterAll(async () => {
  await h?.stop();
});

describe('the claims map, opened as a document', () => {
  let chapterId: string;

  it('refuses before the claims are mapped', async () => {
    const res = await h.api(`/documents/${documentId}/claims/document`, {
      method: 'POST',
      body: '{}',
    });
    expect(res.status).toBe(400);
  });

  it('becomes a chapter of pending drafts, every claim cited from what was read', async () => {
    const mapped = await h.api(`/documents/${documentId}/claims`, { method: 'POST', body: '{}' });
    expect(mapped.status).toBe(200);
    const { map } = (await mapped.json()) as {
      map: { papers: Array<{ id: string; chunkId: string | null }>; claims: unknown[] };
    };
    // The map now keeps the passage each paper was read from.
    for (const paper of map.papers) expect(paper.chunkId).toBe(chunkIds.get(paper.id));

    const calls = await h.prisma.aiCallLog.count({ where: { userId: h.userId } });
    const res = await h.api(`/documents/${documentId}/claims/document`, {
      method: 'POST',
      body: '{}',
    });
    expect(res.status).toBe(200);
    const opened = (await res.json()) as {
      chapterId: string;
      title: string;
      created: boolean;
      claims: number;
      leftOut: number;
    };
    expect(opened).toMatchObject({
      title: 'Research gap analysis',
      created: true,
      claims: map.claims.length,
      leftOut: 0,
    });
    chapterId = opened.chapterId;

    // No model call, no allowance: the analysis was paid for when it was mapped.
    expect(await h.prisma.aiCallLog.count({ where: { userId: h.userId } })).toBe(calls);
    expect(await h.prisma.usageLedger.count({ where: { userId: h.userId } })).toBe(0);

    const chapter = await h.prisma.chapter.findUniqueOrThrow({ where: { id: chapterId } });
    expect(chapter).toMatchObject({ outlineNodeId: 'gap-analysis', order: 2, documentId });
    const drafts = nodesOf(chapter.content, 'draftBlock');
    expect(drafts).toHaveLength(6);
    for (const d of drafts) expect(d.attrs?.status).toBe('pending');
    const counts = chapter.wordCounts as Record<string, number>;
    expect(counts.DRAFT).toBeGreaterThan(50);
    expect(counts.HUMAN).toBe(3); // the chapter's own title

    // Every citation node has its row, on a paper of this thesis, at the passage the map read.
    const nodes = nodesOf(chapter.content, 'citation');
    const rows = await h.prisma.citation.findMany({ where: { chapterId } });
    expect(nodes.length).toBeGreaterThan(0);
    expect(rows).toHaveLength(nodes.length);
    for (const row of rows) {
      expect(ids).toContain(row.sourceId);
      expect(row.chunkId).toBe(chunkIds.get(row.sourceId));
    }

    const events = await h.prisma.suggestionEvent.findMany({
      where: { chapterId },
      orderBy: { id: 'asc' },
    });
    expect(events).toHaveLength(6);
    expect(new Set(events.map((e) => e.id))).toEqual(
      new Set(drafts.map((d) => String(d.attrs?.draftId))),
    );
    for (const e of events) {
      expect(e).toMatchObject({ action: 'CROSS_PAPER', outcome: 'SHOWN', userId: h.userId });
      expect(e.shownChars).toBeGreaterThan(0);
    }

    const memory = await h.prisma.documentMemory.findUniqueOrThrow({ where: { documentId } });
    const outline = memory.outline as Array<{ id: string; title: string }>;
    expect(outline.map((n) => n.id)).toEqual(['ch-1', 'gap-analysis']);
    expect(outline[1]?.title).toBe('Research gap analysis');

    const read = (await (await h.api(`/documents/${documentId}/claims`)).json()) as {
      document: { chapterId: string } | null;
    };
    expect(read.document?.chapterId).toBe(chapterId);
  });

  it('opens the same chapter again for the same map', async () => {
    const res = await h.api(`/documents/${documentId}/claims/document`, {
      method: 'POST',
      body: '{}',
    });
    expect(res.status).toBe(200);
    const again = (await res.json()) as { chapterId: string; created: boolean };
    expect(again).toMatchObject({ chapterId, created: false });
    expect(await h.prisma.chapter.count({ where: { documentId } })).toBe(2);
  });

  it('accepts a section the way any draft is accepted', async () => {
    const event = await h.prisma.suggestionEvent.findFirstOrThrow({ where: { chapterId } });
    const res = await h.api(`/draft/${event.id}/accept`, { method: 'POST', body: '{}' });
    expect(res.status).toBe(201);
    const after = await h.prisma.suggestionEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(after.outcome).toBe('ACCEPTED');
  });

  it('opens as a new chapter once the old one is deleted', async () => {
    const chapter = await h.prisma.chapter.findUniqueOrThrow({ where: { id: chapterId } });
    const deleted = await h.api(`/documents/${documentId}/chapters/${chapterId}`, {
      method: 'DELETE',
      body: JSON.stringify({ wordCount: chapter.wordCount }),
    });
    expect(deleted.status).toBe(200);
    const res = await h.api(`/documents/${documentId}/claims/document`, {
      method: 'POST',
      body: '{}',
    });
    const opened = (await res.json()) as { chapterId: string; created: boolean };
    expect(opened.created).toBe(true);
    expect(opened.chapterId).not.toBe(chapterId);
    const row = await h.prisma.chapter.findUniqueOrThrow({ where: { id: opened.chapterId } });
    expect(row).toMatchObject({ title: 'Research gap analysis', order: 2 });
  });
});

describe('edge cases', () => {
  /** A map stored as ADR-0086 stored it, before passages were recorded. */
  const oldMap = (paperIds: readonly string[]) => ({
    computedAt: new Date().toISOString(),
    papers: paperIds.map((id, i) => ({ id, title: `Paper ${i + 1}`, year: 2024 })),
    claims: [
      {
        claim: 'Upfront cost limits adoption',
        status: 'well-supported',
        supporting: [...paperIds],
        contrasting: [],
        direction: 'Test it in Karnataka.',
        limits: 'Surveys only.',
      },
    ],
  });

  it('keeps a thesis’s first chapter first when it had no outline yet, and cites an old map’s papers without a passage', async () => {
    const doc = await h.prisma.document.create({
      data: {
        ownerId: h.userId,
        title: 'No outline yet',
        entryPath: 'A_TOPIC',
        memory: { create: { scope: {}, outline: [], glossary: {} } },
        chapters: {
          create: {
            outlineNodeId: 'ch-1',
            title: 'Chapter 1',
            order: 1,
            content: { type: 'doc', content: [{ type: 'paragraph' }] },
          },
        },
      },
    });
    const papers = await library(doc.id, ['One', 'Two', 'Three']);
    await h.prisma.document.update({
      where: { id: doc.id },
      data: { meta: { claims: oldMap(papers) } },
    });
    const res = await h.api(`/documents/${doc.id}/claims/document`, { method: 'POST', body: '{}' });
    expect(res.status).toBe(200);
    const { chapterId } = (await res.json()) as { chapterId: string };
    const memory = await h.prisma.documentMemory.findUniqueOrThrow({
      where: { documentId: doc.id },
    });
    expect((memory.outline as Array<{ id: string }>).map((n) => n.id)).toEqual([
      'ch-1',
      'gap-analysis',
    ]);
    const chapters = await h.prisma.chapter.findMany({
      where: { documentId: doc.id },
      orderBy: { order: 'asc' },
      select: { id: true, outlineNodeId: true, order: true },
    });
    expect(chapters.map((c) => [c.outlineNodeId, c.order])).toEqual([
      ['ch-1', 1],
      ['gap-analysis', 2],
    ]);
    expect(chapters[1]?.id).toBe(chapterId);
    const rows = await h.prisma.citation.findMany({ where: { chapterId } });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(papers).toContain(row.sourceId);
      expect(row.chunkId).toBeNull();
    }
  });

  it('is refused while the chapters are being planned', async () => {
    const doc = await h.prisma.document.create({
      data: {
        ownerId: h.userId,
        title: 'Planning',
        entryPath: 'A_TOPIC',
        memory: { create: { scope: {}, outline: [], glossary: {} } },
      },
    });
    const papers = await library(doc.id, ['Uno', 'Dos', 'Tres']);
    await h.prisma.document.update({
      where: { id: doc.id },
      data: {
        meta: {
          claims: oldMap(papers),
          outlineRun: { status: 'RUNNING', startedAt: new Date().toISOString(), from: 'title' },
        },
      },
    });
    const res = await h.api(`/documents/${doc.id}/claims/document`, { method: 'POST', body: '{}' });
    expect(res.status).toBe(409);
    expect(await h.prisma.chapter.count({ where: { documentId: doc.id } })).toBe(0);
  });

  it('is refused when every paper the claims rested on has gone', async () => {
    const doc = await h.prisma.document.create({
      data: {
        ownerId: h.userId,
        title: 'Emptied',
        entryPath: 'A_TOPIC',
        memory: { create: { scope: {}, outline: [], glossary: {} } },
      },
    });
    const papers = await library(doc.id, ['Gone one', 'Gone two', 'Gone three']);
    await h.prisma.document.update({
      where: { id: doc.id },
      data: { meta: { claims: oldMap(papers) } },
    });
    await h.prisma.source.deleteMany({ where: { documentId: doc.id } });
    const res = await h.api(`/documents/${doc.id}/claims/document`, { method: 'POST', body: '{}' });
    expect(res.status).toBe(400);
    expect(await h.prisma.chapter.count({ where: { documentId: doc.id } })).toBe(0);
  });

  it('another student’s thesis is not found', async () => {
    const other = await h.prisma.user.create({
      data: { email: `other-claims-doc-${Date.now()}@example.com`, name: 'Other' },
    });
    const theirs = await h.prisma.document.create({
      data: { ownerId: other.id, title: 'Theirs', entryPath: 'A_TOPIC' },
    });
    const res = await h.api(`/documents/${theirs.id}/claims/document`, {
      method: 'POST',
      body: '{}',
    });
    expect(res.status).toBe(404);
  });
});
