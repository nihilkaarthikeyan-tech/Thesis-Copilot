/**
 * The changelog is data a person edits by hand, so its shape is checked here: one unreleased entry
 * at most and only at the top, real dates, newest first, unique versions, no empty lines, and none
 * of the internal words a student should not have to read.
 */

import { describe, expect, it } from 'vitest';
import { CHANGELOG, formatChangelogDate } from '../src/content/changelog.js';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const VERSION = /^v\d+\.\d+\.\d+$/;

/** Versions compared as numbers, so v0.1.10 comes after v0.1.9. Positive when `a` is newer. */
function compareVersions(a: string, b: string): number {
  const pa = a.slice(1).split('.').map(Number);
  const pb = b.slice(1).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

describe('CHANGELOG', () => {
  it('has entries', () => {
    expect(CHANGELOG.length).toBeGreaterThan(0);
  });

  it('keeps unreleased work in one entry, at the top', () => {
    const unreleased = CHANGELOG.filter((entry) => entry.version === null);
    expect(unreleased.length).toBeLessThanOrEqual(1);
    if (unreleased.length === 1) expect(CHANGELOG[0]?.version).toBeNull();
  });

  it('gives every entry a real date, a title and at least one change', () => {
    for (const entry of CHANGELOG) {
      expect(entry.date, entry.version ?? 'unreleased').toMatch(ISO);
      expect(Number.isNaN(Date.parse(entry.date))).toBe(false);
      expect(entry.title.trim()).not.toBe('');
      expect(entry.changes.length).toBeGreaterThan(0);
      for (const change of entry.changes) expect(change.trim()).not.toBe('');
    }
  });

  it('lists releases newest first, each version once', () => {
    const released = CHANGELOG.filter((entry) => entry.version !== null);
    const versions = released.map((entry) => entry.version as string);
    expect(new Set(versions).size).toBe(versions.length);
    for (const version of versions) expect(version).toMatch(VERSION);
    for (let i = 1; i < released.length; i++) {
      const newer = released[i - 1] as (typeof released)[number];
      const older = released[i] as (typeof released)[number];
      expect(newer.date >= older.date, `${newer.version} before ${older.version}`).toBe(true);
      const cmp = compareVersions(newer.version as string, older.version as string);
      expect(cmp, `${newer.version} after ${older.version}`).toBeGreaterThan(0);
    }
  });

  it('speaks to students, not to the build', () => {
    const internal = /\b(ADR|Strong call|Fast call|gpt-|voyage|BullMQ|prompt A\.\d)/i;
    for (const entry of CHANGELOG) {
      for (const change of entry.changes) expect(change).not.toMatch(internal);
    }
  });
});

describe('formatChangelogDate', () => {
  it('prints a date in words without shifting the day', () => {
    expect(formatChangelogDate('2026-10-04')).toBe('4 October 2026');
  });
});
