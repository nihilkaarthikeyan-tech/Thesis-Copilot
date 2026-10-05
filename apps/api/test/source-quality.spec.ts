/**
 * ADR-0076 — source quality: the facts a supervisor would query about a paper, never a verdict.
 */

import { describe, expect, it } from 'vitest';
import { QUALITY_ADVICE, qualityIssues } from '../src/modules/sources/library-hygiene.js';

const now = new Date('2026-10-05T00:00:00Z');
const clean = {
  isRetracted: false,
  isPreprint: false,
  citationCount: 12,
  venueCitedness: 1.4,
  year: 2021,
};

describe('qualityIssues', () => {
  it('has nothing to say about an ordinary, cited, published paper', () => {
    expect(qualityIssues(clean, now)).toEqual([]);
  });

  it('names a retraction first and a preprint', () => {
    expect(qualityIssues({ ...clean, isRetracted: true, isPreprint: true }, now)).toEqual([
      'RETRACTED',
      'PREPRINT',
    ]);
  });

  it('calls a paper uncited only after two years without a citation', () => {
    expect(qualityIssues({ ...clean, citationCount: 0, year: 2026 }, now)).toEqual([]);
    expect(qualityIssues({ ...clean, citationCount: 0, year: 2023 }, now)).toEqual(['UNCITED']);
  });

  it('flags a rarely cited journal, and says nothing when the figure is unknown', () => {
    expect(qualityIssues({ ...clean, venueCitedness: 0.2 }, now)).toEqual(['WEAK_VENUE']);
    expect(qualityIssues({ ...clean, venueCitedness: null }, now)).toEqual([]);
  });

  it('gives one plain sentence for every issue', () => {
    for (const advice of Object.values(QUALITY_ADVICE)) {
      expect(advice.length).toBeGreaterThan(20);
      expect(advice.endsWith('.')).toBe(true);
    }
  });
});
