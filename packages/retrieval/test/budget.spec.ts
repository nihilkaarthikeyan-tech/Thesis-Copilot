import { describe, expect, it } from 'vitest';
import { searchWithinBudget } from '../src/scholarly/budget.js';
import { MAX_RETRY_AFTER_MS, ScholarlyHttp } from '../src/scholarly/http.js';

describe('searchWithinBudget (ADR-0050)', () => {
  it('keeps a failing query from costing the others, one list per query', async () => {
    const skipped: string[] = [];
    const out = await searchWithinBudget(
      ['a', 'b', 'c'],
      async (q) => {
        if (q === 'b') throw new Error('429');
        return [{ title: q } as never];
      },
      { onSkip: (q) => skipped.push(q) },
    );
    expect(out.map((l) => l.length)).toEqual([1, 0, 1]);
    expect(skipped).toEqual(['b']);
  });

  it('skips the remaining queries once the index has used its budget', async () => {
    let clock = 0;
    const out = await searchWithinBudget(
      ['a', 'b', 'c'],
      async () => {
        clock += 50_000;
        return [{ title: 'x' } as never];
      },
      { now: () => clock, perIndexMs: 75_000 },
    );
    // a at 0 (ends 50 s), b at 50 s (ends 100 s), c at 100 s: over budget.
    expect(out.map((l) => l.length)).toEqual([1, 1, 0]);
  });

  it('gives each call a signal that aborts', async () => {
    const out = await searchWithinBudget(
      ['slow'],
      (_q, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
      { perCallMs: 20 },
    );
    expect(out).toEqual([[]]);
  });
});

describe('a long Retry-After fails instead of waiting', () => {
  it('throws at once when the service asks for more than the cap', async () => {
    const slept: number[] = [];
    let calls = 0;
    const http = new ScholarlyHttp('openalex', {
      mailto: 'ops@example.edu',
      attempts: 3,
      sleep: async (ms) => {
        slept.push(ms);
      },
      fetch: async () => {
        calls++;
        return new Response('{}', {
          status: 429,
          headers: { 'retry-after': String(MAX_RETRY_AFTER_MS / 1000 + 18_000) },
        });
      },
    });
    await expect(http.getJson('https://api.openalex.org/works')).rejects.toThrow('429');
    expect(calls).toBe(1);
    expect(slept.filter((ms) => ms > MAX_RETRY_AFTER_MS)).toEqual([]);
  });
});
