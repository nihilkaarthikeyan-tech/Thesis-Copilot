/**
 * Overlap report (ADR-0042). A read-only plagiarism-style check: it flags copied runs, it does not
 * rewrite them. The arithmetic is pinned here so a long verbatim lift is always caught and an
 * original sentence is never falsely flagged.
 */

import { describe, expect, it } from 'vitest';
import { OVERLAP, overlapReport, ShingleSimilarity } from '../src/similarity/overlap.js';

const SOURCE = {
  sourceId: 'src-1',
  label: 'Smith 2021',
  text: 'Electrical discharge machining removes material through a series of rapid recurring electrical discharges between the electrode and the workpiece in a dielectric fluid.',
};

describe('overlapReport', () => {
  it('finds nothing when there are no sources or the passage is too short', () => {
    expect(overlapReport('A short bit.', []).verdict).toBe('clear');
    expect(overlapReport('tiny', [SOURCE]).matches).toEqual([]);
  });

  it('flags a long verbatim lift and quotes it back, attributed to the source', () => {
    const passage =
      'In this study, electrical discharge machining removes material through a series of rapid recurring electrical discharges between the electrode and the workpiece, which we analyse.';
    const report = overlapReport(passage, [SOURCE]);
    expect(report.verdict).toBe('high');
    expect(report.longestRunWords).toBeGreaterThanOrEqual(OVERLAP.minRunWords);
    expect(report.matches[0]?.sourceId).toBe('src-1');
    expect(report.matches[0]?.label).toBe('Smith 2021');
    expect(report.matches[0]?.quote.toLowerCase()).toContain('removes material through a series');
  });

  it('does not flag an original sentence that only shares common words', () => {
    const passage =
      'Our contribution is a new control strategy that improves surface finish on nickel alloys under flushing.';
    const report = overlapReport(passage, [SOURCE]);
    expect(report.verdict).toBe('clear');
    expect(report.matches).toEqual([]);
  });

  it('ratio rises with how much of the passage is copied', () => {
    const half =
      'We note that electrical discharge machining removes material through a series of rapid recurring electrical discharges, then we diverge entirely into our own distinct original experimental narrative here.';
    const report = overlapReport(half, [SOURCE]);
    expect(report.overlapRatio).toBeGreaterThan(0);
    expect(report.overlapRatio).toBeLessThan(1);
  });

  it('ShingleSimilarity is the read-only provider wrapper', () => {
    const provider = new ShingleSimilarity();
    expect(provider.name).toBe('shingle');
    expect(provider.report('tiny', [SOURCE]).verdict).toBe('clear');
  });
});
