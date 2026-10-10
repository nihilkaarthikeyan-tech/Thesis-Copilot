/**
 * ADR-0149: a search says which index did not answer. `web-scope.service.ts` used to turn a
 * failure into `[]`, which read as "no papers on this". The refusal here is the one production
 * recorded on 2026-10-10; no live call.
 */

import { ScholarlyError } from '@tc/retrieval';
import { describe, expect, it } from 'vitest';
import {
  outcomeOfCount,
  outcomeOfError,
  searchStatus,
  statusOf,
  withStatus,
} from '../src/modules/assist/search-status.js';

const budgetSpent = new ScholarlyError(
  'openalex',
  429,
  'Rate limit exceeded: Insufficient budget. This request costs $0.001 but you only have $0 remaining. Resets at midnight UTC.',
  { refused: true, until: Date.parse('2026-10-11T00:00:00Z') },
);

describe('search status (ADR-0149)', () => {
  it('names a refusing OpenAlex, says where the results came from, and marks the search degraded', () => {
    const status = searchStatus([
      outcomeOfError('openalex', budgetSpent),
      outcomeOfCount('semanticscholar', 0),
      outcomeOfCount('pubmed', 7),
    ]);
    expect(status.degraded).toBe(true);
    expect(status.indexes[0]).toMatchObject({
      reason: 'refused',
      until: '2026-10-11T00:00:00.000Z',
    });
    expect(status.notice).toBe(
      'OpenAlex is not answering right now; results come from Semantic Scholar and PubMed only — try again later.',
    );
  });

  it('says plainly when no index answered, rather than "no papers"', () => {
    const status = searchStatus([
      outcomeOfError('openalex', budgetSpent),
      outcomeOfError('semanticscholar', new ScholarlyError('semanticscholar', 429, 'Too Many Requests', { refused: true })),
    ]);
    expect(status.notice).toMatch(/^None of the paper indexes is answering right now/);
  });

  it('tells a timeout from a fault, and a minor index from the main one', () => {
    const timeout = new Error('The operation was aborted due to timeout');
    timeout.name = 'TimeoutError';
    expect(outcomeOfError('arxiv', timeout).reason).toBe('timeout');
    expect(outcomeOfError('pubmed', new Error('HTTP 500')).reason).toBe('failed');
    const status = searchStatus([outcomeOfCount('openalex', 12), outcomeOfError('arxiv', timeout)]);
    expect(status.degraded).toBe(false);
    expect(status.notice).toContain('arXiv is not answering');
  });

  it('says nothing when every index answered', () => {
    expect(searchStatus([outcomeOfCount('openalex', 0)])).toMatchObject({
      degraded: false,
      notice: null,
    });
  });

  it('rides on a result list, and a plain list from a mock has none', () => {
    const status = searchStatus([outcomeOfError('openalex', budgetSpent)]);
    expect(statusOf(withStatus([1, 2], status))?.degraded).toBe(true);
    expect(statusOf([1, 2])).toBeNull();
  });
});
