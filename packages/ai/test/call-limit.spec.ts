import { describe, expect, it } from 'vitest';
import { callSignal, MODEL_CALL_CEILING_MS } from '../src/providers/call-limit.js';

describe('callSignal (every model call has a time limit)', () => {
  it('aborts a call that passed no signal once the ceiling passes', async () => {
    const signal = callSignal(undefined, 20);
    expect(signal.aborted).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(signal.aborted).toBe(true);
  });

  it("still aborts when the caller's own signal fires first", () => {
    const caller = new AbortController();
    const signal = callSignal(caller.signal);
    expect(signal.aborted).toBe(false);
    caller.abort();
    expect(signal.aborted).toBe(true);
  });

  it('is longer than every explicit limit in the product, so it never decides one of them', () => {
    // The longest explicit limits: chapter build and draft-section calls, 180 s.
    expect(MODEL_CALL_CEILING_MS).toBeGreaterThan(180_000);
  });
});
