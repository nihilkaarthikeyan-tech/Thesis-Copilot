/**
 * The Voyage adapter, on the wire (2026-09-25). The hard-won rule: an adapter with no test is a
 * file nobody has run. This asserts the request body through the injected `fetch`, that the
 * billed tokens Voyage reports come back with the vectors, and that a wrong dimension is refused.
 */

import { describe, expect, it } from 'vitest';
import { VoyageEmbeddingProvider } from '../src/providers/anthropic.js';

function fakeVoyage(reply: unknown, status = 200) {
  const requests: Array<{ url: string; body: Record<string, unknown>; auth: string | null }> = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    requests.push({
      url: String(input),
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
      auth: headers.get('authorization'),
    });
    return new Response(JSON.stringify(reply), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof globalThis.fetch;
  return { requests, fetch };
}

const vector = (n: number) => Array.from({ length: n }, (_, i) => i / n);

describe('the Voyage embedding adapter', () => {
  it('sends the model and the texts with the key, and returns the billed tokens', async () => {
    const { requests, fetch } = fakeVoyage({
      data: [{ embedding: vector(4) }, { embedding: vector(4) }],
      usage: { total_tokens: 37 },
    });
    const voyage = new VoyageEmbeddingProvider({
      apiKey: 'pa-test',
      model: 'voyage-4',
      dims: 4,
      fetch,
    });

    const counted = await voyage.embedWithUsage(['first text', 'second text']);
    expect(counted.vectors).toHaveLength(2);
    expect(counted.tokens).toBe(37);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe('https://api.voyageai.com/v1/embeddings');
    expect(requests[0]?.body).toEqual({ input: ['first text', 'second text'], model: 'voyage-4' });
    expect(requests[0]?.auth).toBe('Bearer pa-test');

    // `embed` is the same call without the count (the fake answers two vectors whatever is sent).
    expect(await voyage.embed(['again'])).toHaveLength(2);
    expect(requests).toHaveLength(2);
    expect(requests[1]?.body).toEqual({ input: ['again'], model: 'voyage-4' });
  });

  it('makes no request for no texts', async () => {
    const { requests, fetch } = fakeVoyage({});
    const voyage = new VoyageEmbeddingProvider({ apiKey: 'k', model: 'voyage-4', dims: 4, fetch });
    expect(await voyage.embedWithUsage([])).toEqual({ vectors: [], tokens: 0 });
    expect(requests).toHaveLength(0);
  });

  it('refuses a vector of the wrong dimension rather than storing it', async () => {
    const { fetch } = fakeVoyage({ data: [{ embedding: vector(8) }], usage: { total_tokens: 3 } });
    const voyage = new VoyageEmbeddingProvider({ apiKey: 'k', model: 'voyage-4', dims: 4, fetch });
    await expect(voyage.embed(['x'])).rejects.toThrow(/EMBED_DIMS is 4/);
  });

  it('reports a refusal with the status and the body, which is what a 429 comes as', async () => {
    const { fetch } = fakeVoyage({ detail: 'reduced rate limits of 3 RPM' }, 429);
    const voyage = new VoyageEmbeddingProvider({ apiKey: 'k', model: 'voyage-4', dims: 4, fetch });
    await expect(voyage.embed(['x'])).rejects.toThrow(/429.*3 RPM/);
  });
});
