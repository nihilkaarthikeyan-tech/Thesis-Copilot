/**
 * What a client does when an index refuses it — ADR-0149 (2026-10-10).
 *
 * The 429 bodies and headers here are recorded, not invented: OpenAlex's "Insufficient budget"
 * answer to the production key on 2026-10-10 (with `x-ratelimit-remaining-usd: 0` and a
 * `retry-after` of the seconds to midnight UTC), and Semantic Scholar's keyless "Too Many
 * Requests" with no `Retry-After` at all, probed the same day. Nothing here reaches the network.
 */

import { describe, expect, it } from 'vitest';
import {
  classifyOpenAlexRequest,
  IndexHealth,
  nextMidnightUtc,
  OPENALEX_USD,
  OpenAlexClient,
  OpenAlexDiscovery,
  OpenAlexMeter,
  REFUSAL_BACKOFF_MS,
  ScholarlyError,
  ScholarlyHttp,
  SemanticScholarClient,
} from '../src/index.js';

/** 2026-10-10 14:00:00 UTC; midnight is ten hours away. */
const NOW = Date.UTC(2026, 9, 10, 14, 0, 0);
const TO_MIDNIGHT_S = 10 * 3600;

const budgetSpent = () =>
  new Response(
    JSON.stringify({
      error: 'Rate limit exceeded',
      message:
        'Insufficient budget. This request requires 10 credits ($0.001) but you only have $0 remaining. Resets at midnight UTC. Add prepaid funds at https://openalex.org/pricing',
      dailyRemainingUsd: 0,
      prepaidRemainingUsd: 0,
      creditsRequired: 10,
    }),
    {
      status: 429,
      headers: {
        'content-type': 'application/json',
        'x-ratelimit-remaining-usd': '0',
        'retry-after': String(TO_MIDNIGHT_S),
      },
    },
  );

const s2TooMany = () =>
  new Response(
    JSON.stringify({
      message:
        'Too Many Requests. Please wait and try again or apply for a key for higher rate limits. https://www.semanticscholar.org/product/api#api-key-form',
      code: '429',
    }),
    { status: 429, headers: { 'content-type': 'application/json' } },
  );

const ok = (body: unknown = { results: [], meta: { count: 0 } }) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

function harness(now: { t: number } = { t: NOW }) {
  const events: Array<Record<string, unknown>> = [];
  const health = new IndexHealth({ now: () => now.t, log: (e) => events.push(e) });
  const urls: string[] = [];
  return { health, events, urls, now };
}

describe('OpenAlex when the keyed daily budget is spent', () => {
  it('retries once without the key, remembers it, and every later request goes keyless until midnight UTC', async () => {
    const h = harness();
    const fetch = async (url: string) => {
      h.urls.push(url);
      return url.includes('api_key=') ? budgetSpent() : ok();
    };
    const options = {
      mailto: 'ops@example.edu',
      apiKey: 'prod-key',
      sleep: async () => undefined,
      fetch,
      health: h.health,
      now: () => h.now.t,
    };
    const discovery = new OpenAlexDiscovery(options);

    expect(await discovery.search('rooftop solar Karnataka')).toEqual([]);
    // One keyed request, one keyless retry: the search answered.
    expect(h.urls).toHaveLength(2);
    expect(h.urls[0]).toContain('api_key=');
    expect(h.urls[1]).not.toContain('api_key=');
    expect(h.urls[1]).toContain('mailto=ops%40example.edu');

    // A second client in the same process (the API builds one per request) does not pay again.
    await new OpenAlexDiscovery(options).search('again');
    expect(h.urls).toHaveLength(3);
    expect(h.urls[2]).not.toContain('api_key=');

    const state = await h.health.state('openalex');
    expect(state.keyedExhaustedUntil).toBe(NOW + TO_MIDNIGHT_S * 1000);
    expect(state.keyedExhaustedUntil).toBe(nextMidnightUtc(NOW));
    expect(state.refusedUntil).toBeNull();
    expect(state.reason).toMatch(/Insufficient budget/);
    expect(state.reason).not.toContain('prod-key');

    // One warning for the state change, not one per call.
    expect(h.events.filter((e) => /keyed budget spent/.test(String(e.msg)))).toHaveLength(1);
    for (const e of h.events) expect(JSON.stringify(e)).not.toContain('prod-key');

    // After the reset the key is tried again.
    h.now.t = nextMidnightUtc(NOW) + 1_000;
    const after: string[] = [];
    await new OpenAlexDiscovery({
      ...options,
      fetch: async (url: string) => {
        after.push(url);
        return ok();
      },
    }).search('next day');
    expect(after[0]).toContain('api_key=');
  });

  it('a spent anonymous budget is a refusal remembered until the reset, and nothing is sent before it', async () => {
    const h = harness();
    let calls = 0;
    const http = new ScholarlyHttp('openalex', {
      mailto: 'ops@example.edu',
      sleep: async () => undefined,
      fetch: async () => {
        calls += 1;
        return budgetSpent();
      },
      health: h.health,
      now: () => h.now.t,
    });
    const error = await http.getJson('https://api.openalex.org/works?search=x').catch((e) => e);
    expect(error).toBeInstanceOf(ScholarlyError);
    expect((error as ScholarlyError).refused).toBe(true);
    expect((error as ScholarlyError).until).toBe(NOW + TO_MIDNIGHT_S * 1000);
    // Never loops: hours is not a wait, it is a failure now.
    expect(calls).toBe(1);

    // The next request in the window is refused here, without a network call.
    await expect(http.getJson('https://api.openalex.org/works?search=y')).rejects.toMatchObject({
      refused: true,
    });
    expect(calls).toBe(1);
    expect((await h.health.state('openalex')).refusingSince).toBe(NOW);

    // Past the reset, it is sent again, and an answer clears the run of refusals.
    h.now.t = NOW + TO_MIDNIGHT_S * 1000 + 1;
    const answering = new ScholarlyHttp('openalex', {
      mailto: 'ops@example.edu',
      sleep: async () => undefined,
      fetch: async () => ok({ fine: true }),
      health: h.health,
      now: () => h.now.t,
    });
    expect(await answering.getJson('https://api.openalex.org/works?search=z')).toEqual({
      fine: true,
    });
    const state = await h.health.state('openalex');
    expect(state.refusedUntil).toBeNull();
    expect(state.refusingSince).toBeNull();
    expect(h.events.some((e) => /answering again/.test(String(e.msg)))).toBe(true);
  });
});

describe('Semantic Scholar answering 429 with no Retry-After', () => {
  it('backs off for a minute after its attempts, and is left alone until then', async () => {
    const h = harness();
    let calls = 0;
    const client = new SemanticScholarClient('s2-key', {
      mailto: 'ops@example.edu',
      attempts: 2,
      sleep: async () => undefined,
      fetch: async () => {
        calls += 1;
        return s2TooMany();
      },
      health: h.health,
      now: () => h.now.t,
    });
    await expect(client.search('rooftop solar')).rejects.toMatchObject({ refused: true });
    expect(calls).toBe(2);
    const state = await h.health.state('semanticscholar');
    expect(state.refusedUntil).toBe(NOW + REFUSAL_BACKOFF_MS);
    expect(state.reason).toMatch(/Too Many Requests/);

    await expect(client.search('again')).rejects.toMatchObject({ refused: true });
    expect(calls).toBe(2);

    h.now.t = NOW + REFUSAL_BACKOFF_MS + 1;
    await expect(client.search('later')).rejects.toMatchObject({ refused: true });
    expect(calls).toBe(4);
    // The run of refusals began at the first one and is still open.
    expect((await h.health.state('semanticscholar')).refusingSince).toBe(NOW);
  });
});

describe('the shared store', () => {
  it('is written on a change and read by another process, and a broken store never fails a request', async () => {
    const rows = new Map<string, string>();
    const store = {
      get: async (key: string) => rows.get(key) ?? null,
      set: async (key: string, value: string) => {
        rows.set(key, value);
        return 'OK' as const;
      },
    };
    const api = new IndexHealth({ store, now: () => NOW });
    await api.markKeyedExhausted('openalex', nextMidnightUtc(NOW), 'Insufficient budget');
    expect([...rows.keys()]).toEqual(['scholarly:health:openalex']);

    const worker = new IndexHealth({ store, now: () => NOW });
    expect(await worker.keyUsable('openalex')).toBe(false);
    expect((await worker.snapshot(['openalex', 'semanticscholar'])).map((s) => s.service)).toEqual([
      'openalex',
      'semanticscholar',
    ]);

    const broken = new IndexHealth({
      store: {
        get: async () => {
          throw new Error('redis down');
        },
        set: async () => {
          throw new Error('redis down');
        },
      },
      now: () => NOW,
    });
    await broken.markRefused('openalex', NOW + 1, 'x');
    expect(await broken.refusedUntil('openalex')).toBe(NOW + 1);
  });
});

describe('the day meter', () => {
  it('prices each kind of OpenAlex request as the pricing page does', () => {
    expect(
      classifyOpenAlexRequest('https://api.openalex.org/works?per-page=25&search=rooftop+solar'),
    ).toBe('search');
    expect(
      classifyOpenAlexRequest('https://api.openalex.org/works?search.semantic=barriers+to+solar'),
    ).toBe('search');
    expect(
      classifyOpenAlexRequest(
        'https://api.openalex.org/works?filter=title_and_abstract.search:solar,type:article&group_by=publication_year',
      ),
    ).toBe('search');
    expect(
      classifyOpenAlexRequest('https://api.openalex.org/works?filter=cites:W1,type:article'),
    ).toBe('list');
    expect(
      classifyOpenAlexRequest('https://api.openalex.org/sources?filter=ids.openalex:S1|S2'),
    ).toBe('list');
    expect(classifyOpenAlexRequest('https://api.openalex.org/works/doi:10.1038/x?mailto=a')).toBe(
      'lookup',
    );
    expect(classifyOpenAlexRequest('https://api.openalex.org/works/W123?select=id')).toBe('lookup');
  });

  it('counts what was sent, per UTC day, keyed or not, and never a refusal', async () => {
    const hash = new Map<string, Record<string, number>>();
    const store = {
      hincrby: async (key: string, field: string, n: number) => {
        const row = hash.get(key) ?? {};
        row[field] = (row[field] ?? 0) + n;
        hash.set(key, row);
        return row[field] as number;
      },
      hgetall: async (key: string) =>
        Object.fromEntries(Object.entries(hash.get(key) ?? {}).map(([k, v]) => [k, String(v)])),
      pexpire: async () => 1,
    };
    const meter = new OpenAlexMeter({ store, now: () => NOW });
    const health = new IndexHealth({ now: () => NOW });
    let calls = 0;
    const client = new OpenAlexClient({
      mailto: 'ops@example.edu',
      apiKey: 'k',
      sleep: async () => undefined,
      fetch: async () => {
        calls += 1;
        // The third request is the key's budget: it is retried keyless and that one is counted.
        return calls === 3 ? budgetSpent() : ok({ results: [] });
      },
      health,
      meter,
      now: () => NOW,
    });
    await client.search('A reference line');
    await client.byDoi('10.1038/nature14539');
    await client.searchTopic('rooftop solar');
    // Let the fire-and-forget writes land.
    await new Promise((r) => setImmediate(r));

    const day = await meter.today();
    expect(day.date).toBe('2026-10-10');
    expect(day).toMatchObject({ searches: 2, lookups: 1, lists: 0, keyed: 2 });
    expect(day.usd).toBeCloseTo(2 * OPENALEX_USD.search, 6);
    expect(day.shareOfKeyedBudget).toBeCloseTo(0.002, 6);
    expect([...hash.keys()]).toEqual(['scholarly:openalex:day:2026-10-10']);
  });
});
