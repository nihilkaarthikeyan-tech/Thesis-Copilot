/**
 * Indexing verification (ADR-0042). Only confirmed facts are "listed"; everything we cannot verify
 * stays "unknown", never "not-listed".
 */

import { describe, expect, it } from 'vitest';
import { indexingOf, OpenAlexIndexing } from '../src/indexing/provider.js';

describe('indexingOf', () => {
  it('reports DOAJ and a registered ISSN as listed, Scopus and WoS as unknown', () => {
    const status = indexingOf({ issn: ['1234-5678'], inDoaj: true });
    expect(status.indexes.doaj).toBe('listed');
    expect(status.indexes['issn-registered']).toBe('listed');
    expect(status.indexes.scopus).toBe('unknown');
    expect(status.indexes['web-of-science']).toBe('unknown');
    expect(status.listedIn).toEqual(['doaj', 'issn-registered']);
    expect(status.source).toBe('openalex');
  });

  it('never claims DOAJ absence — a non-DOAJ venue is unknown, not not-listed', () => {
    const status = indexingOf({ issn: ['1234-5678'], inDoaj: false });
    expect(status.indexes.doaj).toBe('unknown');
  });

  it('marks a venue with no ISSN as not registered', () => {
    const status = indexingOf({ issn: [], inDoaj: false });
    expect(status.indexes['issn-registered']).toBe('not-listed');
    expect(status.listedIn).toEqual([]);
  });
});

describe('OpenAlexIndexing', () => {
  it('maps a looked-up candidate, and returns null when the venue is unknown', async () => {
    const provider = new OpenAlexIndexing(async ({ openalexId }) =>
      openalexId === 'S1' ? { issn: ['1-1'], inDoaj: true } : null,
    );
    expect(await provider.forVenue({ openalexId: 'S1' })).toMatchObject({
      listedIn: ['doaj', 'issn-registered'],
    });
    expect(await provider.forVenue({ openalexId: 'S2' })).toBeNull();
    expect(provider.name).toBe('openalex');
  });
});
