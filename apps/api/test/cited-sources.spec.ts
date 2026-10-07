/**
 * Jenni build plan R19 (ADR-0106) — "Sources in this thesis" and "Save all to library".
 *
 * Pinned: every cited paper, most cited first, with its chapters in order and whether it was found
 * for the student; keeping makes the cited found papers the student's own, and leaves a found paper
 * that is not cited as it was.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, startHarness } from './_harness.js';

let h: Harness;
let documentId: string;
const ids: Record<string, string> = {};

beforeAll(async () => {
  h = await startHarness('cited-sources@example.com');
  const document = await h.prisma.document.create({
    data: { ownerId: h.userId, title: 'Rooftop solar in Karnataka', entryPath: 'A_TOPIC' },
  });
  documentId = document.id;
  const chapter = async (title: string, order: number) =>
    (
      await h.prisma.chapter.create({
        data: {
          documentId,
          outlineNodeId: `n${order}`,
          title,
          order,
          content: { type: 'doc', content: [] },
        },
      })
    ).id;
  const intro = await chapter('Introduction', 1);
  const review = await chapter('Literature review', 2);
  const source = async (name: string, found: boolean) => {
    ids[name] = (
      await h.prisma.source.create({
        data: {
          documentId,
          status: 'RESOLVED',
          title: name,
          ...(found ? { autoAddedAt: new Date() } : {}),
        },
      })
    ).id;
  };
  await source('Own paper', false);
  await source('Found and cited', true);
  await source('Found, not cited', true);
  let n = 0;
  const cite = (chapterId: string, sourceId: string) =>
    h.prisma.citation.create({ data: { chapterId, sourceId, nodeKey: `k${n++}` } });
  await cite(review, ids['Found and cited'] as string);
  await cite(intro, ids['Found and cited'] as string);
  await cite(review, ids['Found and cited'] as string);
  await cite(intro, ids['Own paper'] as string);
}, 300_000);

afterAll(async () => {
  await h?.stop();
});

describe('the sources this thesis cites', () => {
  it('lists every cited paper, most cited first, its chapters in order', async () => {
    const res = await h.api(`/documents/${documentId}/cited-sources`);
    expect(res.status).toBe(200);
    const list = (await res.json()) as Array<{
      title: string;
      citations: number;
      chapters: string[];
      found: boolean;
    }>;
    expect(list.map((s) => [s.title, s.citations, s.chapters, s.found])).toEqual([
      ['Found and cited', 3, ['Introduction', 'Literature review'], true],
      ['Own paper', 1, ['Introduction'], false],
    ]);
  });

  it('keeps the cited found papers as the student’s own, and only those', async () => {
    const res = await h.api(`/documents/${documentId}/cited-sources/keep`, {
      method: 'POST',
      body: '{}',
    });
    expect(await res.json()).toEqual({ kept: 1 });
    const rows = await h.prisma.source.findMany({
      where: { documentId },
      select: { title: true, autoAddedAt: true },
    });
    const found = Object.fromEntries(rows.map((r) => [r.title, r.autoAddedAt !== null]));
    expect(found).toEqual({
      'Own paper': false,
      'Found and cited': false,
      'Found, not cited': true,
    });
  });
});
