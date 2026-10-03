/**
 * Thesis lifecycle state machine (ADR-0043). The transition table and its guards are pinned here.
 */

import { describe, expect, it } from 'vitest';
import { applyEvent, availableEvents, type LifecycleContext } from '../src/lifecycle.js';

const ctx = (over: Partial<LifecycleContext> = {}): LifecycleContext => ({
  hasShare: false,
  hasComments: false,
  hasOpenComments: false,
  compliancePasses: false,
  ...over,
});

describe('applyEvent', () => {
  it('refuses an event that does not start from the current state', () => {
    const r = applyEvent('DRAFTING', 'submit', ctx({ compliancePasses: true }));
    expect(r.ok).toBe(false);
  });

  it('needs a share before review', () => {
    expect(applyEvent('DRAFTING', 'sendForReview', ctx()).ok).toBe(false);
    expect(applyEvent('DRAFTING', 'sendForReview', ctx({ hasShare: true }))).toEqual({
      ok: true,
      to: 'IN_REVIEW',
    });
  });

  it('gates markReady on compliance and open comments', () => {
    expect(applyEvent('REVISING', 'markReady', ctx({ compliancePasses: false })).ok).toBe(false);
    expect(
      applyEvent('REVISING', 'markReady', ctx({ compliancePasses: true, hasOpenComments: true }))
        .ok,
    ).toBe(false);
    expect(
      applyEvent('REVISING', 'markReady', ctx({ compliancePasses: true, hasOpenComments: false })),
    ).toEqual({ ok: true, to: 'READY' });
  });

  it('submits only from READY and only while compliance holds', () => {
    expect(applyEvent('READY', 'submit', ctx({ compliancePasses: true }))).toEqual({
      ok: true,
      to: 'SUBMITTED',
    });
    expect(applyEvent('READY', 'submit', ctx({ compliancePasses: false })).ok).toBe(false);
  });

  it('always lets the student go back to drafting or reopen a submission, unguarded', () => {
    expect(applyEvent('IN_REVIEW', 'backToDrafting', ctx())).toEqual({
      ok: true,
      to: 'DRAFTING',
    });
    expect(applyEvent('SUBMITTED', 'reopen', ctx())).toEqual({ ok: true, to: 'DRAFTING' });
  });
});

describe('availableEvents', () => {
  it('lists every event from a state with its allowed flag and reason', () => {
    const events = availableEvents('DRAFTING', ctx());
    const send = events.find((e) => e.event === 'sendForReview');
    expect(send?.allowed).toBe(false);
    expect(send?.reason).toBeTruthy();
    const ready = events.find((e) => e.event === 'markReady');
    expect(ready?.allowed).toBe(false);
  });

  it('marks an event allowed when its guard passes', () => {
    const events = availableEvents('DRAFTING', ctx({ hasShare: true }));
    expect(events.find((e) => e.event === 'sendForReview')?.allowed).toBe(true);
  });
});
