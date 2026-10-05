/**
 * The claims map through the API — ADR-0086. Pinned: the map from the library's papers, every
 * paper id in it one of the thesis's, stored and read again; one CROSS_PAPER row, no unit; the
 * hour's cooldown; too few papers refused; another student's thesis unseen.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, startHarness } from './_harness.js';

let h: Harness;
let documentId: string;
let ids: string[];

beforeAll(async () => {
  h = await startHarness('claims@example.com');
  const document = await h.prisma.document.create({
    data: { ownerId: h.userId, title: 'Rooftop solar in Karnataka', entryPath: 'A_TOPIC' },
  });
  documentId = document.id;
  const titles = [
    'Household frictions in rooftop solar adoption',
    'Financing rural solar: a survey',
    'Subsidy delivery in Karnataka',
  ];
  ids = [];
  for (const title of titles) {
    const source = await h.prisma.source.create({
      data: { documentId, status: 'RESOLVED', title, year: 2025, groundingLevel: 'ABSTRACT' },
    });
    await h.prisma.sourceChunk.create({
      data: {
        sourceId: source.id,
        ordinal: 0,
        text: `${title}. Upfront cost and credit access shaped adoption among the households surveyed.`,
        tokenCount: 20,
      },
    });
    ids.push(source.id);
  }
}, 300_000);

afterAll(async () => {
  await h?.stop();
});

describe('the claims map', () => {
  it('is empty until mapped, then maps the library’s papers and stores the map', async () => {
    const before = (await (await h.api(`/documents/${documentId}/claims`)).json()) as {
      map: unknown;
    };
    expect(before.map).toBeNull();
    const rows = await h.prisma.aiCallLog.count({
      where: { action: 'CROSS_PAPER', userId: h.userId },
    });

    const res = await h.api(`/documents/${documentId}/claims`, { method: 'POST', body: '{}' });
    expect(res.status).toBe(200);
    const { map } = (await res.json()) as {
      map: {
        computedAt: string;
        papers: Array<{ id: string }>;
        claims: Array<{ status: string; supporting: string[]; contrasting: string[] }>;
      };
    };
    expect(map.papers.map((p) => p.id).sort()).toEqual([...ids].sort());
    expect(map.claims.length).toBe(3);
    for (const c of map.claims) {
      for (const id of [...c.supporting, ...c.contrasting]) expect(ids).toContain(id);
      expect(c.supporting.length).toBeGreaterThan(0);
    }
    expect(new Set(map.claims.map((c) => c.status))).toEqual(
      new Set(['well-supported', 'contested', 'under-explored']),
    );
    expect(
      await h.prisma.aiCallLog.count({ where: { action: 'CROSS_PAPER', userId: h.userId } }),
    ).toBe(rows + 1);
    expect(await h.prisma.usageLedger.count({ where: { userId: h.userId } })).toBe(0);

    const again = (await (await h.api(`/documents/${documentId}/claims`)).json()) as {
      map: { computedAt: string };
    };
    expect(again.map.computedAt).toBe(map.computedAt);
  });

  it('is mapped once an hour', async () => {
    const res = await h.api(`/documents/${documentId}/claims`, { method: 'POST', body: '{}' });
    expect(res.status).toBe(409);
  });

  it('needs three readable papers', async () => {
    const thin = await h.prisma.document.create({
      data: { ownerId: h.userId, title: 'Thin', entryPath: 'A_TOPIC' },
    });
    const only = await h.prisma.source.create({
      data: {
        documentId: thin.id,
        status: 'RESOLVED',
        title: 'Only one',
        groundingLevel: 'ABSTRACT',
      },
    });
    await h.prisma.sourceChunk.create({
      data: { sourceId: only.id, ordinal: 0, text: 'Some text here.', tokenCount: 4 },
    });
    const res = await h.api(`/documents/${thin.id}/claims`, { method: 'POST', body: '{}' });
    expect(res.status).toBe(400);
  });

  it('another student’s thesis is not found', async () => {
    const other = await h.prisma.user.create({
      data: { email: `other-claims-${Date.now()}@example.com`, name: 'Other' },
    });
    const theirs = await h.prisma.document.create({
      data: { ownerId: other.id, title: 'Theirs', entryPath: 'A_TOPIC' },
    });
    const res = await h.api(`/documents/${theirs.id}/claims`);
    expect(res.status).toBe(404);
  });
});
