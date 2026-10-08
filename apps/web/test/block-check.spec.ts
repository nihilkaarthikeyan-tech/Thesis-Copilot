/** A check on one paragraph (R26, ADR-0126): each press runs once, in the panel that owns it. */

import { describe, expect, it } from 'vitest';
import { blockCheckRequest, takeBlockCheck } from '../src/lib/block-check.js';

describe('block check requests', () => {
  it('is taken once, by the panel whose check it names', () => {
    const request = blockCheckRequest('proofread', 10, 42);
    expect(request).toMatchObject({ check: 'proofread', from: 10, to: 42, scope: 'paragraph' });
    // The tone panel and the examiner see it and leave it.
    expect(takeBlockCheck(request, 'tone')).toBe(false);
    expect(takeBlockCheck(request, 'examiner')).toBe(false);
    expect(takeBlockCheck(request, 'proofread')).toBe(true);
    // A remounted panel, or an effect run twice, does not spend a second unit on it.
    expect(takeBlockCheck(request, 'proofread')).toBe(false);
  });

  it('a second press on the same paragraph is a new request, even in the same millisecond', () => {
    const a = blockCheckRequest('examiner', 0, 30, 'selection');
    const b = blockCheckRequest('examiner', 0, 30, 'selection');
    expect(b.nonce).toBeGreaterThan(a.nonce);
    expect(takeBlockCheck(a, 'examiner')).toBe(true);
    expect(takeBlockCheck(b, 'examiner')).toBe(true);
  });

  it('nothing to take when there is no request', () => {
    expect(takeBlockCheck(null, 'proofread')).toBe(false);
    expect(takeBlockCheck(undefined, 'tone')).toBe(false);
  });
});
