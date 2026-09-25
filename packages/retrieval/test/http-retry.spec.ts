/**
 * How the scholarly HTTP layer waits between retries (2026-09-25).
 *
 * OpenAlex answered every anonymous search with `503` and `Retry-After: 60` on 2026-09-25, and
 * honouring that twice held a student's proposal turn for two minutes. A background job with no
 * signal still waits the polite way; a request-bound caller passes a timeout and gets its error
 * in seconds.
 */

import { describe, expect, it } from 'vitest';
import { OpenAlexClient, ScholarlyError } from '../src/index.js';

const paused = () =>
  new Response(JSON.stringify({ error: 'Search temporarily unavailable' }), {
    status: 503,
    headers: { 'content-type': 'application/json', 'retry-after': '60' },
  });

describe('a 503 with Retry-After', () => {
  it('is waited out in full when nobody is waiting on the answer', async () => {
    const waits: number[] = [];
    let calls = 0;
    const client = new OpenAlexClient({
      mailto: 'test@example.com',
      fetch: async () => {
        calls += 1;
        return paused();
      },
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    await expect(client.searchTopic('rooftop solar')).rejects.toThrow(ScholarlyError);
    expect(calls).toBe(3);
    // Twice: between the three attempts. The rate limiter's own spacing is the 0 entries.
    expect(waits.filter((ms) => ms === 60_000)).toHaveLength(2);
  });

  it('gives up as soon as the caller’s timeout fires, not after the Retry-After', async () => {
    let calls = 0;
    const client = new OpenAlexClient({
      mailto: 'test@example.com',
      fetch: async () => {
        calls += 1;
        return paused();
      },
      // A real wait, so the test proves the timeout cuts it short rather than the wait being a no-op.
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 5_000))),
    });
    const started = Date.now();
    await expect(client.searchTopic('rooftop solar', 8, AbortSignal.timeout(150))).rejects.toThrow(
      /aborted/,
    );
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(calls).toBe(1);
  });
});
