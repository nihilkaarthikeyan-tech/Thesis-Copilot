/**
 * The library list and the citation passage carry what was fetched about a paper — cited-by,
 * open-access status and its journal's 2-year mean citedness (coverage map rows 21, 32, 46) — and
 * carry "not known" as null, never as 0 or as closed.
 *
 * Prisma is faked: these pin the shape of the two responses, not the query.
 */

import { describe, expect, it } from 'vitest';
import { SourcesService } from '../src/modules/sources/sources.service.js';

type Row = {
  id: string;
  status: string;
  title: string;
  authors: Array<{ family: string; given: string }>;
  year: number;
  venue: string;
  doi: string;
  groundingLevel: string;
  citationCount: number | null;
  venueCitedness: number | null;
  oaStatus: string | null;
  isPreprint: boolean;
  isRetracted: boolean;
  fileKey: string | null;
  rawReference: string | null;
  autoAddedAt: Date | null;
};

const row: Row = {
  id: 'src-1',
  status: 'RESOLVED',
  title: 'More than 75 percent decline over 27 years in total flying insect biomass',
  authors: [{ family: 'Hallmann', given: 'C. A.' }],
  year: 2017,
  venue: 'PLoS ONE',
  doi: '10.1371/journal.pone.0185809',
  groundingLevel: 'FULL_TEXT',
  citationCount: 3595,
  venueCitedness: 3.1,
  oaStatus: 'gold',
  isPreprint: false,
  isRetracted: false,
  fileKey: null,
  rawReference: null,
  autoAddedAt: null,
};
const unknown: Row = {
  ...row,
  id: 'src-2',
  citationCount: null,
  venueCitedness: null,
  oaStatus: null,
};

function service(rows: Row[]) {
  const prisma = {
    document: { findFirst: async () => ({ id: 'doc-1' }) },
    // The library query also selects each row's collection memberships (migration 0036).
    source: { findMany: async () => rows.map((r) => ({ ...r, collectionItems: [] })) },
    sourceChunk: {
      findFirst: async ({ where }: { where: { sourceId: string } }) => {
        const source = rows.find((r) => r.id === where.sourceId);
        return source
          ? { id: 'chunk-1', text: 'Passage.', page: 3, section: 'Results', source }
          : null;
      },
    },
  };
  const storage = { signedUrl: async () => 'https://example.test/signed.pdf' };
  return new SourcesService(prisma as never, storage as never, {} as never, {} as never);
}

describe('GET /documents/:id/sources', () => {
  it('lists the fetched facts, and null for what was never looked up', async () => {
    const [known, notKnown] = await service([row, unknown]).listSources('user-1', 'doc-1');
    expect(known).toMatchObject({
      citationCount: 3595,
      venueCitedness: 3.1,
      oaStatus: 'gold',
      openAccess: true,
      hasFile: false,
    });
    expect(notKnown).toMatchObject({
      citationCount: null,
      venueCitedness: null,
      oaStatus: null,
      openAccess: null,
    });
  });

  it('a closed paper is closed, which is not the same as unknown', async () => {
    const [closed] = await service([{ ...row, oaStatus: 'closed' }]).listSources('user-1', 'doc-1');
    expect(closed?.openAccess).toBe(false);
  });
});

describe('GET /sources/:id/chunks/:chunkId', () => {
  it('returns the paper’s facts with the passage', async () => {
    const passage = await service([row]).passage('user-1', 'src-1', 'chunk-1');
    expect(passage.source).toMatchObject({
      citationCount: 3595,
      oaStatus: 'gold',
      openAccess: true,
      venueCitedness: 3.1,
    });
  });

  it('carries nulls, not zeros, when nothing was fetched', async () => {
    const passage = await service([unknown]).passage('user-1', 'src-2', 'chunk-1');
    expect(passage.source).toMatchObject({
      citationCount: null,
      oaStatus: null,
      openAccess: null,
      venueCitedness: null,
    });
  });
});
