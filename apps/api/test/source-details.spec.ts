/**
 * Jenni build plan R15 (ADR-0102) — a paper's details, corrected by the student.
 *
 * Pinned: the form reads what a citation prints now; a corrected author and year change the label
 * every citation of the paper renders; an organisation listed beside people is printed as typed;
 * a paper needs a title; another student's paper is not found.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, startHarness } from './_harness.js';

let h: Harness;
let documentId: string;
let sourceId: string;

type Details = {
  type: string;
  title: string;
  authors: Array<{ family?: string; given?: string; literal?: string }>;
  year: number | null;
  container: string;
  volume: string;
  issue: string;
  pages: string;
  publisher: string;
  doi: string;
  url: string;
};

async function label(): Promise<string> {
  const res = await h.api(`/documents/${documentId}/citations/quote?sourceId=${sourceId}`);
  return ((await res.json()) as { label: string }).label;
}

beforeAll(async () => {
  h = await startHarness('source-details@example.com');
  const document = await h.prisma.document.create({
    data: { ownerId: h.userId, title: 'Rooftop solar in Karnataka', entryPath: 'A_TOPIC' },
  });
  documentId = document.id;
  const source = await h.prisma.source.create({
    data: {
      documentId,
      status: 'RESOLVED',
      title: 'Barriers to rooftop solar',
      authors: [{ family: 'Kumr', given: 'A.' }],
      year: 2020,
      venue: 'Energy Policy',
      doi: '10.1000/abc',
      cslJson: {
        type: 'article-journal',
        title: 'Barriers to rooftop solar',
        author: [{ family: 'Kumr', given: 'A.' }],
        issued: { 'date-parts': [[2020]] },
        'container-title': 'Energy Policy',
      },
    },
  });
  sourceId = source.id;
}, 300_000);

afterAll(async () => {
  await h?.stop();
});

describe("correcting a paper's details", () => {
  it('reads what the citation prints, and a correction changes the citation', async () => {
    expect(await label()).toMatch(/Kumr, 2020/);
    const details = (await (await h.api(`/sources/${sourceId}/details`)).json()) as Details;
    expect(details).toMatchObject({ title: 'Barriers to rooftop solar', year: 2020 });

    const res = await h.api(`/sources/${sourceId}/details`, {
      method: 'PUT',
      body: JSON.stringify({
        ...details,
        authors: [{ family: 'Kumar', given: 'Asha' }, { literal: 'TERI' }],
        year: 2021,
        pages: '12-19',
      }),
    });
    expect(res.status).toBe(200);
    expect(await label()).toMatch(/Kumar & TERI, 2021|Kumar and TERI, 2021/);
    const row = await h.prisma.source.findUnique({
      where: { id: sourceId },
      select: { year: true, authors: true },
    });
    expect(row?.year).toBe(2021);
  });

  it('refuses a paper with no title, and another student’s paper', async () => {
    const details = (await (await h.api(`/sources/${sourceId}/details`)).json()) as Details;
    const empty = await h.api(`/sources/${sourceId}/details`, {
      method: 'PUT',
      body: JSON.stringify({ ...details, title: '  ' }),
    });
    expect(empty.status).toBe(400);

    const stranger = await h.prisma.user.create({
      data: { email: 'stranger-details@example.com', name: 'Stranger' },
    });
    const theirs = await h.prisma.document.create({
      data: { ownerId: stranger.id, title: 'Theirs', entryPath: 'A_TOPIC' },
    });
    const theirSource = await h.prisma.source.create({
      data: { documentId: theirs.id, status: 'RESOLVED', title: 'Theirs' },
    });
    expect((await h.api(`/sources/${theirSource.id}/details`)).status).toBe(404);
  });
});
