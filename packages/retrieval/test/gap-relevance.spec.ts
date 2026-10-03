/**
 * Gap-map relevance signal (ADR-0041). The classification is pinned on constructed themes so the
 * arithmetic over observed numbers — never a model — is stable.
 */

import { describe, expect, it } from 'vitest';
import { GAP_SIGNAL, type GapTheme, gapSignals } from '../src/gap/relevance.js';

const theme = (name: string, scores: number[], cites: number[] = []): GapTheme => ({
  name,
  candidates: scores.map((score, i) => ({ score, citationCount: cites[i] ?? null })),
});

describe('gapSignals', () => {
  it('returns nothing for no themes', () => {
    expect(gapSignals([])).toEqual([]);
  });

  it('flags a few-paper theme as sparse, never reading a relevance from it', () => {
    const [signal] = gapSignals([theme('Edge topic', [0.9])]);
    expect(signal?.gapClass).toBe('sparse');
    expect(signal?.gapScore).toBe(0);
  });

  it('calls a relevant, thinly-covered theme an open gap and ranks it first', () => {
    const signals = gapSignals([
      // Highly relevant, few papers, little citedness → the open gap.
      theme('Residual stress in WEDM of Hastelloy', [0.82, 0.8], [3, 5]),
      // Loosely relevant but a large, well-cited body → crowded.
      theme('General machining', Array(10).fill(0.3), Array(10).fill(400)),
    ]);
    expect(signals[0]?.name).toBe('Residual stress in WEDM of Hastelloy');
    expect(signals[0]?.gapClass).toBe('open');
    expect(signals[1]?.gapClass).toBe('crowded');
    // The open gap sorts ahead on gapScore.
    expect(signals[0]?.gapScore).toBeGreaterThan(signals[1]?.gapScore ?? 1);
  });

  it('calls a relevant, well-covered theme active', () => {
    const signals = gapSignals([
      theme('Hot topic', Array(12).fill(0.85), Array(12).fill(300)),
      theme('Side note', [0.2, 0.2], [1, 1]),
    ]);
    const hot = signals.find((s) => s.name === 'Hot topic');
    expect(hot?.gapClass).toBe('active');
  });

  it('reports a grounded median citation count and a 0–1 relevance', () => {
    const [signal] = gapSignals([theme('T', [0.5, 0.7, 0.9], [10, 20, 30])]);
    expect(signal?.medianCitations).toBe(20);
    expect(signal?.relevance).toBeCloseTo(0.7, 3);
    expect(signal?.relevance).toBeGreaterThanOrEqual(0);
    expect(signal?.relevance).toBeLessThanOrEqual(1);
  });

  it('treats a missing or negative score as zero relevance', () => {
    const t: GapTheme = {
      name: 'T',
      candidates: [
        { score: null, citationCount: null },
        { score: -0.2, citationCount: null },
      ],
    };
    const [signal] = gapSignals([t]);
    expect(signal?.relevance).toBe(0);
  });

  it('uses libraryCount for coverage volume once curating has started', () => {
    const base: GapTheme = {
      name: 'Kept nothing',
      candidates: theme('x', Array(8).fill(0.6)).candidates,
      libraryCount: 0,
    };
    const other: GapTheme = {
      name: 'Kept many',
      candidates: theme('y', Array(8).fill(0.6)).candidates,
      libraryCount: 8,
    };
    const signals = gapSignals([base, other]);
    const kept = signals.find((s) => s.name === 'Kept nothing');
    const many = signals.find((s) => s.name === 'Kept many');
    // Same found count and relevance, but the theme the student emptied is the opener gap.
    expect(kept?.gapScore ?? 0).toBeGreaterThan(many?.gapScore ?? 1);
  });

  it('exposes its thresholds as constants', () => {
    expect(GAP_SIGNAL.minForRelevance).toBe(2);
    expect(GAP_SIGNAL.volumeWeight).toBeGreaterThan(0);
    expect(GAP_SIGNAL.volumeWeight).toBeLessThan(1);
  });
});
