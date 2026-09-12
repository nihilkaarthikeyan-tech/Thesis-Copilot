/**
 * The progress view's two awkward parts, tested away from the database.
 *
 * `readWordCounts` reads a JSON column, so its shape is a claim rather than a guarantee — rows
 * written by older builds have no such key, and a half-written one would quietly understate the AI
 * share, which is the single number a student may have to disclose (§12.3). It is strict on
 * purpose, and these tests are what keep it strict.
 *
 * `daysBetween` looks trivial and is the sort of thing that reads "-0 days ago" in production.
 */

import { describe, expect, it } from 'vitest';
import { daysBetween, readWordCounts } from '../src/modules/documents/progress.service.js';

describe('reading the provenance column', () => {
  it('accepts a complete set', () => {
    expect(
      readWordCounts({ HUMAN: 900, ASSIST: 120, DRAFT: 300, COMMAND: 40, HUMAN_EDITED: 60 }),
    ).toEqual({ HUMAN: 900, ASSIST: 120, DRAFT: 300, COMMAND: 40, HUMAN_EDITED: 60 });
  });

  it('rejects a partial one rather than treating the gaps as zero', () => {
    // The failure this prevents: a row missing DRAFT reporting a higher human share than the truth.
    expect(readWordCounts({ HUMAN: 900, ASSIST: 120 })).toBe(null);
  });

  it('rejects nulls, arrays and non-objects', () => {
    for (const value of [null, undefined, [], 'HUMAN', 42, true]) {
      expect(readWordCounts(value), String(value)).toBe(null);
    }
  });

  it('rejects values that are not finite non-negative numbers', () => {
    const base = { HUMAN: 1, ASSIST: 1, DRAFT: 1, COMMAND: 1, HUMAN_EDITED: 1 };
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -5, '900', null]) {
      expect(readWordCounts({ ...base, DRAFT: bad }), String(bad)).toBe(null);
    }
  });

  it('accepts an all-zero set, which is a real state for an empty chapter', () => {
    const zeros = { HUMAN: 0, ASSIST: 0, DRAFT: 0, COMMAND: 0, HUMAN_EDITED: 0 };
    expect(readWordCounts(zeros)).toEqual(zeros);
  });

  it('ignores extra keys instead of refusing the row', () => {
    // A newer build adding a kind must not make this one report nothing at all.
    const withExtra = {
      HUMAN: 10,
      ASSIST: 0,
      DRAFT: 0,
      COMMAND: 0,
      HUMAN_EDITED: 0,
      SOMETHING_NEW: 7,
    };
    expect(readWordCounts(withExtra)?.HUMAN).toBe(10);
  });
});

describe('days since an edit', () => {
  const at = (iso: string) => new Date(iso);

  it('counts whole days', () => {
    expect(daysBetween(at('2026-09-01T10:00:00Z'), at('2026-09-04T10:00:00Z'))).toBe(3);
  });

  it('is zero for the same day', () => {
    expect(daysBetween(at('2026-09-04T01:00:00Z'), at('2026-09-04T23:59:00Z'))).toBe(0);
  });

  it('floors a partial day rather than rounding up', () => {
    expect(daysBetween(at('2026-09-01T00:00:00Z'), at('2026-09-02T23:00:00Z'))).toBe(1);
  });

  it('never goes negative when a clock disagrees', () => {
    // Server and row timestamps can cross; "-1 days ago" is not a thing to show anyone.
    expect(daysBetween(at('2026-09-05T00:00:00Z'), at('2026-09-01T00:00:00Z'))).toBe(0);
  });
});
