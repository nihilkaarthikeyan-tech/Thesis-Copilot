/**
 * The Account and Settings pages printed "VIVA" and "CHAPTER_BUILD", and the trial listed
 * "Coherence checks 0 / 0" as if it were an allowance.
 */

import { METERED_ACTIONS } from '@tc/config';
import { describe, expect, it } from 'vitest';
import { allowanceName, includedAllowances, notIncluded } from '../src/lib/action-names.js';

describe('allowanceName', () => {
  it('names every metered action in words', () => {
    for (const action of METERED_ACTIONS) {
      expect(allowanceName(action), action).not.toBe(action);
      expect(allowanceName(action), action).not.toMatch(/[A-Z]{2,}|_/);
    }
    expect(allowanceName('VIVA')).toBe('Viva practice');
    expect(allowanceName('CHAPTER_BUILD')).toBe('Chapter builds');
  });
});

describe('includedAllowances / notIncluded', () => {
  const trial = [
    { action: 'ASSIST', used: 3, cap: 50 },
    { action: 'COHERENCE', used: 0, cap: 0 },
    { action: 'CHAPTER_BUILD', used: 0, cap: 0 },
  ];

  it('lists only what the plan includes, and names the rest apart', () => {
    expect(includedAllowances(trial).map((a) => a.action)).toEqual(['ASSIST']);
    expect(notIncluded(trial)).toBe('Coherence checks, Chapter builds');
  });

  it('never hides a count that has been used', () => {
    const lines = [{ action: 'VIVA', used: 2, cap: 0 }];
    expect(includedAllowances(lines)).toHaveLength(1);
    expect(notIncluded(lines)).toBe('');
  });
});
