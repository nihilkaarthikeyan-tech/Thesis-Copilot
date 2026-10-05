/**
 * The right-clicked link handed to the popup (ADR-0069): taken only while fresh and well-formed.
 */

import { describe, expect, it } from 'vitest';
import { freshPending, PENDING_TTL_MS } from '../src/pending.js';

const paper = {
  title: 'arXiv:1706.03762',
  doi: '10.48550/arxiv.1706.03762',
  reference: 'https://doi.org/10.48550/arxiv.1706.03762',
};

describe('a pending link', () => {
  it('is taken while fresh', () => {
    expect(freshPending({ paper, at: 1_000 }, 1_000 + PENDING_TTL_MS)).toEqual({
      paper,
      at: 1_000,
    });
  });

  it('is ignored when stale, from the future, or not the right shape', () => {
    expect(freshPending({ paper, at: 1_000 }, 1_001 + PENDING_TTL_MS)).toBeNull();
    expect(freshPending({ paper, at: 5_000 }, 1_000)).toBeNull();
    expect(freshPending({ paper: { title: 'x' }, at: 1_000 }, 1_000)).toBeNull();
    expect(freshPending('nope', 1_000)).toBeNull();
    expect(freshPending(undefined, 1_000)).toBeNull();
  });
});
