/**
 * Jenni build plan R25 (ADR-0112) — `GET /documents/:id/sources/quality?chapterId=` on the real
 * application and Postgres.
 *
 * Pinned: the notes cover the papers the named chapter cites, each once however often, and nothing
 * the other chapters cite; without a chapter there are no notes; a chapter of another thesis is a
 * 404 and a malformed id a 400.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, startHarness } from './_harness.js';

let h: Harness;
let documentId: string;
let intro: string;
let review: string;
let otherChapter: string;
// Years relative to today, so "over a decade old" means the same thing every year this runs.
const thisYear = new Date().getUTCFullYear();

type Notes = {
  works: number;
  years: { known: number; median: number | null; overDecade: number; bins: unknown[] };
  venues: { known: number; unique: number; top: Array<{ name: string; works: number }> };
};

beforeAll(async () => {
  h = await startHarness('bibliography-notes@example.com');
  const document = await h.prisma.document.create({
    data: { ownerId: h.userId, title: 'Groundwater in Kolar', entryPath: 'A_TOPIC' },
  });
  documentId = document.id;
  const chapter = async (docId: string, title: string, order: number) =>
    (
      await h.prisma.chapter.create({
        data: {
          documentId: docId,
          outlineNodeId: `n${order}`,
          title,
          order,
          content: { type: 'doc', content: [] },
        },
      })
    ).id;
  intro = await chapter(documentId, 'Introduction', 1);
  review = await chapter(documentId, 'Literature review', 2);
  const other = await h.prisma.document.create({
    data: { ownerId: h.userId, title: 'Another thesis', entryPath: 'A_TOPIC' },
  });
  otherChapter = await chapter(other.id, 'Elsewhere', 1);

  const source = async (title: string, year: number | null, venue: string | null) =>
    (
      await h.prisma.source.create({
        data: { documentId, status: 'RESOLVED', title, year, venue },
      })
    ).id;
  const a = await source('Aquifer recharge', thisYear - 5, 'Journal of Hydrology');
  const b = await source('Borewell failure', thisYear - 14, 'Journal of Hydrology');
  const c = await source('Tank irrigation', null, null);
  const d = await source('Only in the review', thisYear - 2, 'Water Policy');
  let n = 0;
  const cite = (chapterId: string, sourceId: string) =>
    h.prisma.citation.create({ data: { chapterId, sourceId, nodeKey: `k${n++}` } });
  await cite(intro, a);
  await cite(intro, a);
  await cite(intro, b);
  await cite(intro, c);
  await cite(review, d);
}, 300_000);

afterAll(async () => {
  await h?.stop();
});

describe('bibliography notes for a chapter', () => {
  it('covers the papers that chapter cites, each once, and no other chapter’s', async () => {
    const res = await h.api(`/documents/${documentId}/sources/quality?chapterId=${intro}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { notes: Notes };
    expect(body.notes.works).toBe(3);
    expect(body.notes.years).toMatchObject({ known: 2, median: thisYear - 14, overDecade: 1 });
    expect(body.notes.venues).toMatchObject({
      known: 2,
      unique: 1,
      top: [{ name: 'Journal of Hydrology', works: 2 }],
    });
  });

  it('is empty for a chapter that cites nothing', async () => {
    const empty = await h.prisma.chapter.create({
      data: {
        documentId,
        outlineNodeId: 'n3',
        title: 'Methods',
        order: 3,
        content: { type: 'doc', content: [] },
      },
    });
    const res = await h.api(`/documents/${documentId}/sources/quality?chapterId=${empty.id}`);
    const body = (await res.json()) as { notes: Notes };
    expect(body.notes).toMatchObject({ works: 0, years: { known: 0, bins: [] } });
  });

  it('has no notes without a chapter, as before', async () => {
    const res = await h.api(`/documents/${documentId}/sources/quality`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { notes: unknown; checked: number };
    expect(body.notes).toBeNull();
    expect(body.checked).toBe(4);
  });

  it('refuses a chapter of another thesis, and a malformed id', async () => {
    const elsewhere = await h.api(
      `/documents/${documentId}/sources/quality?chapterId=${otherChapter}`,
    );
    expect(elsewhere.status).toBe(404);
    const malformed = await h.api(`/documents/${documentId}/sources/quality?chapterId=nope`);
    expect(malformed.status).toBe(400);
  });
});
