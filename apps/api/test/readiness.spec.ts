/**
 * Submission readiness.
 *
 * The arithmetic is trivial; the timezone handling is not, and it is the part that would go wrong
 * silently. A deadline is a calendar date on a university's calendar, so "days left" must not
 * change because the student flew somewhere — hence the UTC comparison this pins.
 */

import { describe, expect, it } from 'vitest';
import {
  type CheckSummary,
  daysBetween,
  readiness,
  URGENCY_DAYS,
  urgencyOf,
} from '../src/modules/export/readiness.js';

const check = (over: Partial<CheckSummary> & { check: string }): CheckSummary => ({
  label: 'A check',
  passed: true,
  findingCount: 0,
  ...over,
});

const TEN = [
  ...Array.from({ length: 10 }, (_, i) => check({ check: `C${i}` })),
] satisfies CheckSummary[];

const NOW = new Date('2026-09-21T10:00:00Z');

describe('counting the days', () => {
  it('counts whole calendar days, not elapsed hours', () => {
    // 10:00 to 09:00 the next morning is 23 hours and one day.
    expect(daysBetween(new Date('2026-09-21T10:00:00Z'), new Date('2026-09-22T09:00:00Z'))).toBe(1);
  });

  it('is the same number whatever time of day it is asked', () => {
    const deadline = new Date('2026-10-02T00:00:00Z');
    const morning = daysBetween(new Date('2026-09-21T00:01:00Z'), deadline);
    const midnight = daysBetween(new Date('2026-09-21T23:59:00Z'), deadline);
    expect(morning).toBe(midnight);
  });

  it('says zero on the day itself, not one', () => {
    expect(daysBetween(NOW, new Date('2026-09-21T23:00:00Z'))).toBe(0);
  });

  it('goes negative once the date has passed', () => {
    expect(daysBetween(NOW, new Date('2026-09-18T00:00:00Z'))).toBe(-3);
  });
});

describe('how urgent it is', () => {
  it('has no urgency at all without a deadline', () => {
    expect(urgencyOf(null)).toBe('none');
  });

  it('treats the last week as urgent', () => {
    expect(urgencyOf(URGENCY_DAYS.urgent)).toBe('urgent');
    expect(urgencyOf(0)).toBe('urgent');
  });

  it('treats three weeks as soon, because the work takes days not hours', () => {
    expect(urgencyOf(URGENCY_DAYS.urgent + 1)).toBe('soon');
    expect(urgencyOf(URGENCY_DAYS.soon)).toBe('soon');
  });

  it('is comfortable beyond that, and overdue behind', () => {
    expect(urgencyOf(URGENCY_DAYS.soon + 1)).toBe('comfortable');
    expect(urgencyOf(-1)).toBe('overdue');
  });
});

describe('the sentence a student reads', () => {
  it('asks for a date when there is none, rather than pretending to know', () => {
    const r = readiness({
      checks: [...TEN.slice(0, 9), check({ check: 'X', passed: false })],
      deadline: null,
      now: NOW,
    });
    expect(r.daysLeft).toBeNull();
    expect(r.headline).toContain('9 of 10 checks pass');
    expect(r.headline).toContain('Set a submission date');
  });

  it('joins the score to the time when both are known', () => {
    const r = readiness({
      checks: [
        ...TEN.slice(0, 8),
        check({ check: 'A', passed: false }),
        check({ check: 'B', passed: false }),
      ],
      deadline: new Date('2026-10-02T00:00:00Z'),
      now: NOW,
    });
    expect(r.headline).toBe('8 of 10 checks pass. Due in 11 days, with 2 checks left to fix.');
  });

  it('says "today" rather than "in 0 days"', () => {
    const r = readiness({ checks: TEN, deadline: new Date('2026-09-21T00:00:00Z'), now: NOW });
    expect(r.headline).toContain('due today');
  });

  it('is plain about a date that has passed', () => {
    const r = readiness({
      checks: [...TEN.slice(0, 9), check({ check: 'X', passed: false })],
      deadline: new Date('2026-09-18T00:00:00Z'),
      now: NOW,
    });
    expect(r.urgency).toBe('overdue');
    expect(r.headline).toContain('passed 3 days ago');
  });

  it('congratulates rather than warns when everything passes', () => {
    const r = readiness({ checks: TEN, deadline: new Date('2026-12-01T00:00:00Z'), now: NOW });
    expect(r.blocking).toEqual([]);
    expect(r.headline).toContain('Ready to submit');
  });
});

describe('what to fix first', () => {
  it('puts the check with the most findings at the top', () => {
    const r = readiness({
      checks: [
        check({ check: 'SMALL', passed: false, findingCount: 1 }),
        check({ check: 'BIG', passed: false, findingCount: 12 }),
        check({ check: 'PASSES' }),
      ],
      deadline: null,
      now: NOW,
    });
    expect(r.blocking.map((c) => c.check)).toEqual(['BIG', 'SMALL']);
  });

  it('never lists a passing check as blocking', () => {
    const r = readiness({ checks: TEN, deadline: null, now: NOW });
    expect(r.blocking).toEqual([]);
    expect(r.passed).toBe(10);
  });
});
