/**
 * R31 (ADR-0122): the limit message every refused screen shows — which allowance, how many used
 * of how many, the reset date in the student's own calendar, and where to go next.
 */

import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/lib/api';
import { formatResetDate, limitLine, limitNotice, limitRefusal, limitText } from '../src/lib/limit';

const RESETS = '2026-11-01T00:00:00.000Z';
const INDIA = { locale: 'en-GB', timeZone: 'Asia/Kolkata' };

const capProblem = {
  type: 'CAP_EXCEEDED',
  title: 'Monthly limit reached',
  status: 429,
  detail: 'You have used all 10 of this month’s citation suggestions.',
  action: 'CITE',
  allowance: 'Citation suggestions',
  used: 10,
  cap: 10,
  resetsAt: RESETS,
};

describe('limitRefusal', () => {
  it('reads a cap refusal from an ApiError, a bare problem, or a stream event carrying one', () => {
    const expected = {
      kind: 'cap',
      allowance: 'Citation suggestions',
      used: 10,
      cap: 10,
      resetsAt: RESETS,
    };
    expect(limitRefusal(new ApiError(capProblem))).toEqual(expected);
    expect(limitRefusal(capProblem)).toEqual(expected);
    expect(limitRefusal({ code: 'CAP_EXCEEDED', message: 'x', problem: capProblem })).toEqual(
      expected,
    );
  });

  it('is null for every failure that is not a limit', () => {
    expect(limitRefusal(new ApiError({ type: 'NOT_FOUND', title: 'Not found', status: 404 }))).toBe(
      null,
    );
    expect(limitRefusal(new Error('Failed to fetch'))).toBe(null);
    expect(limitRefusal(null)).toBe(null);
    expect(limitRefusal('CAP_EXCEEDED')).toBe(null);
  });

  it('names the allowance from the action when the API did not, and assumes all were used', () => {
    // An API from before R31 sent only action, cap and resetsAt.
    expect(
      limitRefusal({ type: 'CAP_EXCEEDED', action: 'ASSIST', cap: 50, resetsAt: RESETS }),
    ).toEqual({
      kind: 'cap',
      allowance: 'Assist suggestions',
      used: 50,
      cap: 50,
      resetsAt: RESETS,
    });
  });

  it('tells a plan without the allowance from one used up', () => {
    expect(
      limitRefusal({
        type: 'CAP_EXCEEDED',
        action: 'COHERENCE',
        used: 0,
        cap: 0,
        resetsAt: RESETS,
      }),
    ).toEqual({ kind: 'notIncluded', allowance: 'Coherence checks' });
  });

  it('reads an ended trial, the ₹100 ceiling and the site budget as their own kinds', () => {
    expect(
      limitRefusal({
        type: 'CAP_EXCEEDED',
        status: 402,
        action: 'CHAT',
        cap: 0,
        trialEnded: true,
        trialEndedAt: '2026-10-03T09:00:00.000Z',
      }),
    ).toEqual({ kind: 'trial', endedAt: '2026-10-03T09:00:00.000Z' });
    expect(limitRefusal({ type: 'CEILING_EXCEEDED', resetsAt: RESETS })).toEqual({
      kind: 'ceiling',
      resetsAt: RESETS,
    });
    expect(limitRefusal({ type: 'PLATFORM_CEILING_EXCEEDED', resetsAt: RESETS })).toEqual({
      kind: 'platform',
      resetsAt: RESETS,
    });
  });
});

describe('formatResetDate', () => {
  it('shows the 1st as a date where the reset falls on it (India: 05:30 on the 1st)', () => {
    expect(formatResetDate(RESETS, INDIA)).toBe('1 Nov 2026');
  });

  it('adds the time where 00:00 UTC is still the 31st, so it is not read as a day early', () => {
    const shown = formatResetDate(RESETS, { locale: 'en-GB', timeZone: 'America/New_York' });
    expect(shown).toContain('31 Oct 2026');
    expect(shown).toContain('20:00');
  });

  it('never prints the ISO string, and passes a broken one through rather than "Invalid Date"', () => {
    expect(formatResetDate(RESETS, INDIA)).not.toContain('T00:00');
    expect(formatResetDate('not a date')).toBe('not a date');
  });
});

describe('limitText', () => {
  it('a used-up allowance: which one, used of how many, the reset date, the usage page', () => {
    const limit = limitRefusal(capProblem);
    if (!limit) throw new Error('unreachable');
    expect(limitText(limit, INDIA)).toEqual({
      title: 'Monthly limit reached',
      body: 'Citation suggestions: 10 of 10 used this month. Resets on 1 Nov 2026. Writing, editing and exporting still work.',
      link: { href: '/app/account', label: 'Usage and plans' },
    });
  });

  it('an allowance the plan does not include points at the plans', () => {
    expect(limitText({ kind: 'notIncluded', allowance: 'Coherence checks' })).toEqual({
      title: 'Not in your plan',
      body: 'Coherence checks: none included in your plan. Writing, editing and exporting still work.',
      link: { href: '/pricing', label: 'See plans' },
    });
  });

  it('an ended trial says when, that the theses are safe, and points at the plans', () => {
    const text = limitText({ kind: 'trial', endedAt: '2026-10-03T09:00:00.000Z' }, INDIA);
    expect(text.title).toBe('Free trial ended');
    expect(text.body).toContain('ended on 3 Oct 2026');
    expect(text.body).toContain('Your theses are safe');
    expect(text.body).not.toContain('Resets');
    expect(text.link).toEqual({ href: '/pricing', label: 'See plans' });
  });

  it('the ₹100 ceiling and the site budget say when the AI comes back', () => {
    expect(limitText({ kind: 'ceiling', resetsAt: RESETS }, INDIA).body).toContain(
      'It resets on 1 Nov 2026.',
    );
    const site = limitText({ kind: 'platform', resetsAt: RESETS }, INDIA);
    expect(site.body).toContain('AI features return on 1 Nov 2026.');
    expect(site.body).toContain('This is not your allowance');
    // Buying a plan would not help, so there is nothing to sell here.
    expect(site.link).toBe(null);
  });

  it('without a reset date it still names the day', () => {
    expect(limitText({ kind: 'ceiling', resetsAt: null }).body).toContain('the 1st of next month');
  });
});

describe('the editor strip', () => {
  it('carries the limit and reads as one line', () => {
    const limit = { kind: 'ceiling', resetsAt: RESETS } as const;
    const notice = limitNotice(limit);
    expect(notice.limit).toBe(limit);
    expect(notice.action).toBe(null);
    expect(notice.text).toBe(limitLine(limit));
    expect(notice.text.startsWith('Monthly AI limit reached. ')).toBe(true);
  });
});
