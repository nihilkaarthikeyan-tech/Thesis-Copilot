/**
 * Week 3 task 3.1 — the minimal chapter and its source pins (PRD FR-3.3, FR-3.4, §10.4).
 *
 * Runs against the real application on real containers, because both behaviours under test are
 * about what the database ends up holding: whether Continue turns the placeholder chapter into the
 * paper's own first section, and whether a pin can be made to point somewhere it should not.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, startHarness } from './_harness.js';

let h: Harness;
let documentId: string;
let chapterId: string;
const sourceIds: string[] = [];

const extraction = {
  title: 'Rooftop solar adoption in rural Karnataka',
  abstract: 'We survey 312 households across three districts.',
  objectives: ['Measure adoption'],
  methodology: 'A structured questionnaire.',
  findings: [],
  terminology: [],
  references: [],
  sections: [
    { heading: '1. Introduction', summary: 'Sets out why rooftop solar uptake is low.' },
    { heading: '2. Method', summary: 'A survey of 312 households.' },
  ],
};

const scope = {
  workingTitle: 'Barriers to rooftop solar adoption in rural Karnataka',
  problemStatement: 'Cost, not awareness, appears to drive non-adoption.',
  objectives: ['Measure adoption', 'Identify barriers'],
  whyOpen: 'Existing work stops at the district level.',
};

beforeAll(async () => {
  h = await startHarness('w3@example.com');

  const created = await h.api('/documents', {
    method: 'POST',
    body: JSON.stringify({ title: 'Week 3', entryPath: 'B_PAPER' }),
  });
  expect(created.status).toBe(201);
  const document = (await created.json()) as { id: string; firstChapterId: string };
  documentId = document.id;
  chapterId = document.firstChapterId;

  // A read paper, as `extract-paper` would have left it.
  await h.prisma.seedPaper.create({
    data: {
      documentId,
      fileKey: `seed-papers/${documentId}/p01.pdf`,
      filename: 'p01.pdf',
      status: 'DONE',
      extraction: extraction as never,
    },
  });

  for (const title of ['A source', 'Another source']) {
    const source = await h.prisma.source.create({
      data: { documentId, status: 'RESOLVED', title, groundingLevel: 'ABSTRACT' },
    });
    sourceIds.push(source.id);
  }
}, 300_000);

afterAll(async () => {
  await h?.stop();
});

describe('3.1 Continue creates the real first chapter (FR-3.3)', () => {
  it('renames the placeholder chapter to the paper’s first section', async () => {
    const response = await h.api(`/documents/${documentId}/memory/scope`, {
      method: 'PUT',
      body: JSON.stringify(scope),
    });
    expect(response.status).toBe(200);

    const chapter = await h.prisma.chapter.findUniqueOrThrow({ where: { id: chapterId } });
    expect(chapter.title).toBe('1. Introduction');
    // The scope note is what every later prompt reads as "what this chapter is about".
    expect(chapter.scopeNote).toBe('Sets out why rooftop solar uptake is low.');
    expect(chapter.outlineNodeId).toBe('1-1-introduction');
  });

  it('writes a one-node outline that the prompt builder will read (FR-3.4)', async () => {
    const memory = await h.prisma.documentMemory.findUniqueOrThrow({ where: { documentId } });
    const outline = memory.outline as Array<{
      id: string;
      title: string;
      scopeNote: string;
      mappedFromPaperSection?: string;
      children: unknown[];
    }>;

    expect(outline).toHaveLength(1);
    expect(outline[0]?.id).toBe('1-1-introduction');
    expect(outline[0]?.mappedFromPaperSection).toBe('1. Introduction');
    expect(outline[0]?.children).toEqual([]);
  });

  it('does not overwrite an outline or a chapter the student has worked on', async () => {
    await h.prisma.chapter.update({
      where: { id: chapterId },
      data: { title: 'My own title', scopeNote: 'My own note', wordCount: 400 },
    });

    const response = await h.api(`/documents/${documentId}/memory/scope`, {
      method: 'PUT',
      body: JSON.stringify({ ...scope, workingTitle: 'A revised working title' }),
    });
    expect(response.status).toBe(200);

    const chapter = await h.prisma.chapter.findUniqueOrThrow({ where: { id: chapterId } });
    // Their words survive; only the document title moved.
    expect(chapter.title).toBe('My own title');
    expect(chapter.scopeNote).toBe('My own note');
    const document = await h.prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    expect(document.title).toBe('A revised working title');
  });
});

describe('3.1 chapter source pins (§10.4)', () => {
  it('starts with no pins, meaning the whole library is in scope', async () => {
    const response = await h.api(`/chapters/${chapterId}/pins`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sourceIds: [] });
  });

  it('stores the pins the student chose', async () => {
    const response = await h.api(`/chapters/${chapterId}/pins`, {
      method: 'PUT',
      body: JSON.stringify({ sourceIds }),
    });
    expect(response.status).toBe(200);

    const stored = (await (await h.api(`/chapters/${chapterId}/pins`)).json()) as {
      sourceIds: string[];
    };
    expect(stored.sourceIds.sort()).toEqual([...sourceIds].sort());
  });

  it('replaces rather than appends, so unpinning works', async () => {
    await h.api(`/chapters/${chapterId}/pins`, {
      method: 'PUT',
      body: JSON.stringify({ sourceIds: [sourceIds[0]] }),
    });
    const stored = (await (await h.api(`/chapters/${chapterId}/pins`)).json()) as {
      sourceIds: string[];
    };
    expect(stored.sourceIds).toEqual([sourceIds[0]]);

    await h.api(`/chapters/${chapterId}/pins`, {
      method: 'PUT',
      body: JSON.stringify({ sourceIds: [] }),
    });
    expect(
      ((await (await h.api(`/chapters/${chapterId}/pins`)).json()) as { sourceIds: string[] })
        .sourceIds,
    ).toEqual([]);
  });

  it('ignores a duplicate id rather than failing on the unique key', async () => {
    const response = await h.api(`/chapters/${chapterId}/pins`, {
      method: 'PUT',
      body: JSON.stringify({ sourceIds: [sourceIds[0], sourceIds[0]] }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sourceIds: [sourceIds[0]] });
  });

  it('refuses a source from another thesis', async () => {
    // Pins are a retrieval filter; one that reached across documents would leak another student's
    // sources into this draft.
    const other = await h.api('/documents', {
      method: 'POST',
      body: JSON.stringify({ title: 'Someone else', entryPath: 'A_TOPIC' }),
    });
    const otherDocument = (await other.json()) as { id: string };
    const foreign = await h.prisma.source.create({
      data: { documentId: otherDocument.id, status: 'RESOLVED', title: 'Not yours' },
    });

    const response = await h.api(`/chapters/${chapterId}/pins`, {
      method: 'PUT',
      body: JSON.stringify({ sourceIds: [foreign.id] }),
    });
    // VALIDATION_FAILED is 400 across this API (common/errors.ts).
    expect(response.status).toBe(400);
    expect(response.headers.get('content-type')).toContain('application/problem+json');
    const problem = (await response.json()) as { type: string };
    expect(problem.type).toBe('VALIDATION_FAILED');
  });

  it('refuses to touch a chapter that is not the caller’s', async () => {
    const response = await fetch(`${h.baseUrl}/api/v1/chapters/${chapterId}/pins`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sourceIds: [] }),
    });
    expect(response.status).toBe(401);
  });
});
